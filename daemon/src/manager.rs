// SPDX-License-Identifier: GPL-3.0-or-later
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Arc, RwLock};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use notify::RecommendedWatcher;
use tokio::sync::{mpsc, oneshot};
use tokio::task::JoinHandle;

use crate::cache;
use crate::config::Config;
use crate::dbus::Command;
use crate::index::{self, Index, ScanResult};
use crate::status::StatusModel;
use crate::watcher::{self, WatcherEvent};

const CACHE_REFRESH_SECS: u64 = 600;
const CACHE_WRITE_DELAY: Duration = Duration::from_secs(30);
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
    let (watch_tx, watch_rx) = mpsc::unbounded_channel();
    let manager = Manager {
        config_path,
        home: crate::config::home_dir(),
        config,
        cache_path,
        index,
        status,
        scan_delay: (scan_delay != Duration::ZERO).then_some(scan_delay),
        scan_tx,
        watch_tx,
        watcher: None,
        watcher_config: None,
        watcher_ok: true,
        pending: Vec::new(),
        cache_deadline: None,
        cancel: Arc::new(AtomicBool::new(false)),
        progress: Arc::new(AtomicUsize::new(0)),
        dirty: false,
        scanning: false,
        reindex_pending: false,
        quitting: false,
        quit_ack: None,
    };

    tokio::spawn(async move { manager.run(commands, scan_rx, watch_rx).await })
}

struct Manager {
    config_path: PathBuf,
    home: PathBuf,
    config: Arc<RwLock<Config>>,
    cache_path: PathBuf,
    index: Arc<Index>,
    status: Arc<StatusModel>,
    scan_delay: Option<Duration>,
    scan_tx: mpsc::UnboundedSender<ScanOutcome>,
    watch_tx: mpsc::UnboundedSender<WatcherEvent>,
    watcher: Option<RecommendedWatcher>,
    watcher_config: Option<u64>,
    watcher_ok: bool,
    pending: Vec<PathBuf>,
    cache_deadline: Option<tokio::time::Instant>,
    cancel: Arc<AtomicBool>,
    progress: Arc<AtomicUsize>,
    dirty: bool,
    scanning: bool,
    reindex_pending: bool,
    quitting: bool,
    quit_ack: Option<oneshot::Sender<()>>,
}

impl Manager {
    async fn run(
        mut self,
        mut commands: mpsc::UnboundedReceiver<Command>,
        mut scan_rx: mpsc::UnboundedReceiver<ScanOutcome>,
        mut watch_rx: mpsc::UnboundedReceiver<WatcherEvent>,
    ) {
        self.start_watcher();
        self.start_scan();

        let mut ticker = tokio::time::interval(Duration::from_millis(TICK_MS));
        ticker.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);

        loop {
            let cache_deadline = self.cache_deadline;

            tokio::select! {
                command = commands.recv(), if !self.quitting => {
                    match command {
                        Some(Command::Reindex) => {
                            if self.scanning {
                                self.reindex_pending = true;
                                continue;
                            }
                            self.reload_config();
                            self.start_watcher();
                            self.start_scan();
                        }
                        Some(Command::EnsureFresh) => {
                            if self.scanning {
                                continue;
                            }
                            if !self.watcher_ok {
                                self.start_watcher();
                                if self.watcher_ok {
                                    // Events missed while the watcher was down
                                    // need a fresh scan to close the gap.
                                    self.start_scan();
                                    continue;
                                }
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
                                self.schedule_cache_write();
                            }

                            let state = if self.watcher_ok { "ready" } else { "degraded" };
                            self.status.update(|status| status.state = state.to_owned());

                            // Changes seen during the scan are not part of its snapshot.
                            let pending = std::mem::take(&mut self.pending);
                            if !pending.is_empty() {
                                self.apply_changes(&pending);
                            }
                        }
                        Some(ScanOutcome::Cancelled) | None => {
                            self.scanning = false;
                        }
                    }

                    if self.reindex_pending && !self.quitting {
                        self.reindex_pending = false;
                        self.reload_config();
                        self.start_watcher();
                        self.start_scan();
                    }

                    if self.quitting {
                        self.finalize_quit().await;
                        return;
                    }
                }
                event = watch_rx.recv(), if self.watcher.is_some() => {
                    match event {
                        Some(WatcherEvent::Changed(paths)) => {
                            if self.scanning {
                                self.pending.extend(paths);
                            } else {
                                self.apply_changes(&paths);
                            }
                        }
                        Some(WatcherEvent::Failed) | None => {
                            if self.watcher_ok {
                                eprintln!("siftd: file watcher failed; file results may be stale");
                            }
                            self.watcher_failed();
                        }
                    }
                }
                _ = tokio::time::sleep_until(
                    cache_deadline.unwrap_or_else(tokio::time::Instant::now)
                ), if cache_deadline.is_some() => {
                    if self.write_cache() {
                        self.dirty = false;
                        self.cache_deadline = None;
                    } else {
                        eprintln!("siftd: could not write index cache");
                        self.schedule_cache_write();
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

    fn start_watcher(&mut self) {
        let config = self.config.read().unwrap().clone();
        let fingerprint = config.fingerprint();
        if self.watcher.is_some() && self.watcher_config == Some(fingerprint) {
            return;
        }

        self.watcher = None;
        self.watcher_config = Some(fingerprint);

        match watcher::spawn_watcher(&config, self.watch_tx.clone()) {
            Ok(watcher) => {
                self.watcher = Some(watcher);
                if !self.watcher_ok {
                    self.watcher_ok = true;
                    self.status
                        .update(|status| status.watcher = "ok".to_owned());
                }
            }
            Err(error) => {
                if self.watcher_ok {
                    eprintln!("siftd: file watcher unavailable: {error}");
                }
                self.watcher_failed();
            }
        }
    }

    fn watcher_failed(&mut self) {
        self.watcher = None;
        self.watcher_config = None;
        self.watcher_ok = false;

        let scanning = self.scanning;
        self.status.update(|status| {
            status.watcher = "unavailable".to_owned();
            if !scanning {
                status.state = "degraded".to_owned();
            }
        });
    }

    fn apply_changes(&mut self, paths: &[PathBuf]) {
        let config = self.config.read().unwrap().clone();

        // New folders need their own watches; existing ones already have them.
        if let Some(watcher) = self.watcher.as_mut() {
            for path in paths {
                if self.index.has_path(path) {
                    continue;
                }
                let Ok(metadata) = std::fs::symlink_metadata(path) else {
                    continue;
                };
                if metadata.is_dir() && !metadata.file_type().is_symlink() {
                    watcher::add_tree(watcher, &config, path);
                }
            }
        }

        if !self.index.apply_batch(&config, paths) {
            return;
        }

        self.schedule_cache_write();

        let (indexed, truncated) = {
            let state = self.index.read();
            (state.entries.len(), state.truncated)
        };
        self.status.update(|status| {
            status.indexed = indexed;
            status.truncated = truncated;
        });
    }

    fn schedule_cache_write(&mut self) {
        self.dirty = true;
        if self.cache_deadline.is_none() {
            self.cache_deadline = Some(tokio::time::Instant::now() + CACHE_WRITE_DELAY);
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
        // Startup smoothing only: a later reindex must not wait again.
        let scan_delay = self.scan_delay.take().unwrap_or(Duration::ZERO);

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
        self.watcher = None;
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
    // Encode under the read lock, then write outside it: fsync and rename must
    // not stall queries behind a writer waiting for the lock.
    let bytes = {
        let state = index.read();
        cache::encode(fingerprint, &state.entries, state.truncated)
    };
    cache::write_atomic(cache_path, &bytes)
}

fn unix_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs())
        .unwrap_or(0)
}
