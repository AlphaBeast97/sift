// SPDX-License-Identifier: GPL-3.0-or-later
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

use crate::cache;
use crate::config::Config;
use crate::dbus::Command;
use crate::index::{self, Index, ScanResult};
use crate::status::StatusModel;

const CACHE_REFRESH_SECS: u64 = 600;
const TICK_MS: u64 = 500;

enum ScanOutcome {
    Finished { cache_ok: bool },
    Cancelled,
}

pub fn root_strings(config: &Config) -> Vec<String> {
    config
        .roots
        .iter()
        .map(|root| root.to_string_lossy().into_owned())
        .collect()
}

pub fn spawn_manager(
    config_path: PathBuf,
    config: Arc<RwLock<Config>>,
    cache_path: PathBuf,
    index: Arc<Index>,
    status: Arc<StatusModel>,
    commands: mpsc::UnboundedReceiver<Command>,
    scan_delay: Duration,
) -> JoinHandle<()> {
    let (scan_tx, scan_rx) = mpsc::unbounded_channel();
    let manager = Manager {
        config_path,
        home: crate::config::home_dir(),
        config,
        cache_path,
        index,
        status,
        scan_delay,
        scan_tx,
        cancel: Arc::new(AtomicBool::new(false)),
        progress: Arc::new(AtomicUsize::new(0)),
        dirty: false,
        scanning: false,
        quitting: false,
        quit_ack: None,
    };

    tokio::spawn(async move { manager.run(commands, scan_rx).await })
}

struct Manager {
    config_path: PathBuf,
    home: PathBuf,
    config: Arc<RwLock<Config>>,
    cache_path: PathBuf,
    index: Arc<Index>,
    status: Arc<StatusModel>,
    scan_delay: Duration,
    scan_tx: mpsc::UnboundedSender<ScanOutcome>,
    cancel: Arc<AtomicBool>,
    progress: Arc<AtomicUsize>,
    dirty: bool,
    scanning: bool,
    quitting: bool,
    quit_ack: Option<oneshot::Sender<()>>,
}

impl Manager {
    async fn run(
        mut self,
        mut commands: mpsc::UnboundedReceiver<Command>,
        mut scan_rx: mpsc::UnboundedReceiver<ScanOutcome>,
    ) {
        self.start_scan();

        let mut ticker = tokio::time::interval(Duration::from_millis(TICK_MS));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        loop {
            tokio::select! {
                command = commands.recv(), if !self.quitting => {
                    match command {
                        Some(Command::Reindex) => {
                            if self.scanning {
                                continue;
                            }
                            self.reload_config();
                            self.start_scan();
                        }
                        Some(Command::EnsureFresh) => {
                            if self.scanning {
                                continue;
                            }
                            let last = self.status.snapshot().last_reconcile;
                            if unix_now().saturating_sub(last) >= CACHE_REFRESH_SECS {
                                self.start_scan();
                            }
                        }
                        Some(Command::Quit(ack)) => {
                            self.begin_quit(Some(ack));
                            if !self.scanning {
                                self.finalize_quit().await;
                                return;
                            }
                        }
                        None => {
                            self.begin_quit(None);
                            if !self.scanning {
                                self.finalize_quit().await;
                                return;
                            }
                        }
                    }
                }
                outcome = scan_rx.recv() => {
                    match outcome {
                        Some(ScanOutcome::Finished { cache_ok }) => {
                            self.scanning = false;
                            self.dirty = !cache_ok;
                            if !cache_ok {
                                eprintln!("siftd: could not write index cache");
                            }
                        }
                        Some(ScanOutcome::Cancelled) | None => {
                            self.scanning = false;
                        }
                    }

                    if self.quitting {
                        self.finalize_quit().await;
                        return;
                    }
                }
                _ = ticker.tick(), if self.scanning => {
                    let progress = self.progress.load(Ordering::Relaxed);
                    let current = self.index.len();
                    self.status.update(|status| status.indexed = current.max(progress));
                }
            }
        }
    }

    fn start_scan(&mut self) {
        let config = self.config.read().unwrap().clone();
        let fingerprint = config.fingerprint();
        let index = self.index.clone();
        let status = self.status.clone();
        let cache_path = self.cache_path.clone();
        let cancel = self.cancel.clone();
        let progress = self.progress.clone();
        let scan_tx = self.scan_tx.clone();
        let scan_delay = self.scan_delay;

        let (count, truncated) = {
            let state = index.read();
            (state.entries.len(), state.truncated)
        };
        status.update(|status| {
            status.state = "indexing".to_owned();
            status.indexed = count;
            status.truncated = truncated;
        });

        progress.store(0, Ordering::Relaxed);
        cancel.store(false, Ordering::Relaxed);
        self.scanning = true;

        tokio::spawn(async move {
            if !scan_delay.is_zero() {
                tokio::time::sleep(scan_delay).await;
            }

            if cancel.load(Ordering::Relaxed) {
                let _ = scan_tx.send(ScanOutcome::Cancelled);
                return;
            }

            let scan_cancel = Arc::clone(&cancel);
            let result =
                tokio::task::spawn_blocking(move || index::scan(&config, &scan_cancel, &progress))
                    .await;

            if cancel.load(Ordering::Relaxed) {
                let _ = scan_tx.send(ScanOutcome::Cancelled);
                return;
            }

            let ScanResult { entries, truncated } = match result {
                Ok(result) => result,
                Err(error) => {
                    eprintln!("siftd: scan worker failed: {error}");
                    let _ = scan_tx.send(ScanOutcome::Cancelled);
                    return;
                }
            };

            index.replace(entries, truncated);
            status.update(|status| {
                status.indexed = index.len();
                status.truncated = truncated;
                status.state = "ready".to_owned();
                status.last_reconcile = unix_now();
            });

            let cache_ok = store_cache(&cache_path, fingerprint, &index).is_ok();
            let _ = scan_tx.send(ScanOutcome::Finished { cache_ok });
        });
    }

    fn reload_config(&mut self) {
        match Config::load(&self.config_path, &self.home) {
            Ok(config) => {
                let roots = root_strings(&config);
                *self.config.write().unwrap() = config;
                self.status.update(|status| status.roots = roots);
            }
            Err(error) => {
                eprintln!("siftd: {error}; keeping the previous config");
            }
        }
    }

    fn begin_quit(&mut self, ack: Option<oneshot::Sender<()>>) {
        self.cancel.store(true, Ordering::Relaxed);
        self.quitting = true;
        self.quit_ack = ack;
    }

    async fn finalize_quit(&mut self) {
        if self.dirty {
            if self.write_cache() {
                self.dirty = false;
            } else {
                eprintln!("siftd: could not flush index cache");
            }
        }

        if let Some(ack) = self.quit_ack.take() {
            let _ = ack.send(());
        }

        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    fn write_cache(&self) -> bool {
        let fingerprint = self.config.read().unwrap().fingerprint();
        store_cache(&self.cache_path, fingerprint, &self.index).is_ok()
    }
}

fn store_cache(cache_path: &Path, fingerprint: u64, index: &Index) -> std::io::Result<()> {
    let state = index.read();
    cache::store(cache_path, fingerprint, &state.entries, state.truncated)
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}
