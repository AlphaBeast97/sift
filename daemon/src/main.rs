// SPDX-License-Identifier: GPL-3.0-or-later
use std::path::PathBuf;
use std::sync::{Arc, RwLock};
use std::time::Duration;

use tokio::signal::unix::{signal, SignalKind};
use tokio::sync::{mpsc, oneshot};

mod cache;
mod calc;
mod config;
mod dbus;
mod index;
mod manager;
mod query;
mod status;
mod watcher;

use config::Config;
use dbus::SiftService;
use index::Index;
use status::StatusModel;

struct Options {
    config: PathBuf,
    cache: PathBuf,
    scan_delay: Duration,
}

#[tokio::main]
async fn main() {
    let options = match parse_args() {
        Ok(Some(options)) => options,
        Ok(None) => return,
        Err(message) => {
            eprintln!("siftd: {message}");
            std::process::exit(2);
        }
    };

    let home = config::home_dir();
    let config = Config::load(&options.config, &home).unwrap_or_else(|error| {
        eprintln!("siftd: {error}; using defaults");
        config::default_config(&home)
    });

    let cached = cache::load(&options.cache, config.fingerprint());
    if cached.is_none() && options.cache.exists() {
        eprintln!("siftd: cached index is stale or unreadable; scanning from scratch");
    }
    let (entries, truncated) = match cached {
        Some(cached) => (cached.entries, cached.truncated),
        None => (Vec::new(), false),
    };

    let index = Arc::new(Index::new(entries, truncated));
    let status = StatusModel::new(manager::root_strings(&config));
    let config = Arc::new(RwLock::new(config));
    let (commands, commands_rx) = mpsc::unbounded_channel();
    let shutdown = commands.clone();
    let service = SiftService::new(
        Arc::clone(&index),
        Arc::clone(&status),
        Arc::clone(&config),
        commands,
    );

    let connection = match zbus::connection::Builder::session()
        .name(dbus::BUS_NAME)
        // One daemon per session: never replace or yield the name to another instance.
        .replace_existing_names(false)
        .allow_name_replacements(false)
        .serve_at(dbus::OBJECT_PATH, service)
        .build()
        .await
    {
        Ok(connection) => connection,
        Err(zbus::Error::NameTaken) => {
            eprintln!("siftd: bus name already owned");
            return;
        }
        Err(error) => {
            eprintln!("siftd: cannot connect to the session bus: {error}");
            std::process::exit(1);
        }
    };

    let mut signals = status.subscribe();
    let signal_connection = connection.clone();
    let signal_task = tokio::spawn(async move {
        let mut last: Option<tokio::time::Instant> = None;

        loop {
            match signals.recv().await {
                Ok(status) => {
                    if let Some(last) = last {
                        let elapsed = last.elapsed();
                        if elapsed < Duration::from_millis(500) {
                            tokio::time::sleep(Duration::from_millis(500) - elapsed).await;
                        }
                    }
                    last = Some(tokio::time::Instant::now());

                    let result = signal_connection
                        .emit_signal(
                            None::<&str>,
                            dbus::OBJECT_PATH,
                            dbus::INTERFACE,
                            "StatusChanged",
                            &(status,),
                        )
                        .await;
                    if result.is_err() {
                        break;
                    }
                }
                Err(tokio::sync::broadcast::error::RecvError::Lagged(_)) => continue,
                Err(tokio::sync::broadcast::error::RecvError::Closed) => break,
            }
        }
    });

    let mut manager = manager::spawn_manager(
        options.config,
        config,
        options.cache,
        index,
        status,
        commands_rx,
        options.scan_delay,
    );

    let mut terminate =
        signal(SignalKind::terminate()).expect("cannot install the SIGTERM handler");
    let mut interrupt =
        signal(SignalKind::interrupt()).expect("cannot install the SIGINT handler");

    tokio::select! {
        result = &mut manager => {
            if let Err(error) = result {
                eprintln!("siftd: manager stopped unexpectedly: {error}");
            }
        }
        () = connection.closed() => {
            // A daemon whose session bus is gone can never serve a client
            // again. Exit instead of lingering across logout or test buses.
            stop(&shutdown, &mut manager).await;
        }
        _ = terminate.recv() => {
            // Logout and systemctl stop send SIGTERM; flush before leaving.
            stop(&shutdown, &mut manager).await;
        }
        _ = interrupt.recv() => {
            stop(&shutdown, &mut manager).await;
        }
    }

    signal_task.abort();
    drop(connection);
}

async fn stop(
    shutdown: &mpsc::UnboundedSender<dbus::Command>,
    manager: &mut tokio::task::JoinHandle<()>,
) {
    let (ack, _done) = oneshot::channel();
    let _ = shutdown.send(dbus::Command::Quit(ack));
    let _ = manager.await;
}

fn parse_args() -> Result<Option<Options>, String> {
    let mut args = std::env::args().skip(1);
    let mut config = config::config_path();
    let mut cache = cache::cache_path();
    let mut scan_delay = Duration::ZERO;

    while let Some(argument) = args.next() {
        match argument.as_str() {
            "--version" => {
                println!("siftd {}", env!("CARGO_PKG_VERSION"));
                return Ok(None);
            }
            "--config" => config = PathBuf::from(next_value(&mut args, "--config")?),
            "--cache" => cache = PathBuf::from(next_value(&mut args, "--cache")?),
            "--scan-delay-ms" => {
                let value = next_value(&mut args, "--scan-delay-ms")?;
                let millis = value
                    .parse()
                    .map_err(|_| format!("invalid --scan-delay-ms: {value}"))?;
                scan_delay = Duration::from_millis(millis);
            }
            other => return Err(format!("unknown argument: {other}")),
        }
    }

    Ok(Some(Options {
        config,
        cache,
        scan_delay,
    }))
}

fn next_value(args: &mut impl Iterator<Item = String>, option: &str) -> Result<String, String> {
    args.next().ok_or_else(|| format!("{option} needs a value"))
}
