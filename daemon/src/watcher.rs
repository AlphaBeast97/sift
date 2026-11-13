// SPDX-License-Identifier: GPL-3.0-or-later
use std::collections::HashSet;
use std::path::PathBuf;
use std::time::Duration;

use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::mpsc;
use tokio::sync::mpsc::error::TryRecvError;

const DEBOUNCE: Duration = Duration::from_millis(500);

#[derive(Debug)]
pub enum WatcherEvent {
    Changed(Vec<PathBuf>),
    Failed,
}

pub fn spawn_watcher(
    roots: &[PathBuf],
    tx: mpsc::UnboundedSender<WatcherEvent>,
) -> notify::Result<RecommendedWatcher> {
    let (raw_tx, mut raw_rx) = mpsc::unbounded_channel::<notify::Result<Event>>();
    let mut watcher = notify::recommended_watcher(move |event| {
        let _ = raw_tx.send(event);
    })?;

    for root in roots {
        watcher.watch(root, RecursiveMode::Recursive)?;
    }

    tokio::spawn(async move {
        let mut pending = HashSet::new();

        while let Some(first) = raw_rx.recv().await {
            match first {
                Ok(event) => pending.extend(event.paths),
                Err(_) => {
                    let _ = tx.send(WatcherEvent::Failed);
                    continue;
                }
            }

            tokio::time::sleep(DEBOUNCE).await;

            loop {
                match raw_rx.try_recv() {
                    Ok(Ok(event)) => pending.extend(event.paths),
                    Ok(Err(_)) => {
                        let _ = tx.send(WatcherEvent::Failed);
                    }
                    Err(TryRecvError::Empty | TryRecvError::Disconnected) => break,
                }
            }

            if !pending.is_empty() {
                let mut paths: Vec<_> = pending.drain().collect();
                paths.sort();
                if tx.send(WatcherEvent::Changed(paths)).is_err() {
                    break;
                }
            }
        }
    });

    Ok(watcher)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_missing_root_fails_to_watch() {
        let dir = tempfile::tempdir().unwrap();
        let missing = dir.path().join("gone");
        let (tx, _rx) = mpsc::unbounded_channel();
        assert!(spawn_watcher(&[missing], tx).is_err());
    }
}
