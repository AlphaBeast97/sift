// SPDX-License-Identifier: GPL-3.0-or-later
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use std::time::Duration;

use ignore::WalkBuilder;
use notify::event::EventKind;
use notify::{Event, RecommendedWatcher, RecursiveMode, Watcher};
use tokio::sync::mpsc;
use tokio::sync::mpsc::error::TryRecvError;

use crate::config::Config;
use crate::index;

const DEBOUNCE: Duration = Duration::from_millis(500);

#[derive(Debug)]
pub enum WatcherEvent {
    Changed(Vec<PathBuf>),
    Failed,
}

pub fn spawn_watcher(
    config: &Config,
    tx: mpsc::UnboundedSender<WatcherEvent>,
) -> notify::Result<RecommendedWatcher> {
    let (raw_tx, mut raw_rx) = mpsc::unbounded_channel::<notify::Result<Event>>();
    let mut watcher = notify::recommended_watcher(move |event: notify::Result<Event>| {
        // Opening folders is not a change. Forwarding opens made the scan and
        // every subtree walk enqueue another walk of their own reads.
        if matches!(&event, Ok(event) if matches!(&event.kind, EventKind::Access(_))) {
            return;
        }
        let _ = raw_tx.send(event);
    })?;

    let mut watched = 0;
    for root in &config.roots {
        watched += add_tree(&mut watcher, config, root);
    }

    // A configured root that cannot be watched at all is a real failure; a
    // single unreadable subfolder is not. The scan skips both.
    if !config.roots.is_empty() && watched == 0 {
        return Err(notify::Error::generic("no indexed folder could be watched"));
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

/// Watch every folder under `path` that the index would include. Recursive
/// watches follow symlinks and fail as a whole when one folder is unreadable,
/// so each folder gets its own non-recursive watch instead.
pub fn add_tree(watcher: &mut RecommendedWatcher, config: &Config, path: &Path) -> usize {
    let Some(root) = index::containing_root(&config.roots, path) else {
        return 0;
    };
    if !index::is_indexable(config, root, path) {
        return 0;
    }

    let Ok(metadata) = std::fs::symlink_metadata(path) else {
        return 0;
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return 0;
    }

    let filter_config = config.clone();
    let filter_root = root.to_path_buf();
    let mut builder = WalkBuilder::new(path);
    builder
        .hidden(true)
        .ignore(false)
        .git_ignore(false)
        .git_global(false)
        .git_exclude(false)
        .follow_links(false)
        .same_file_system(true)
        .threads(1);

    builder.filter_entry(move |entry| {
        if entry.depth() == 0 {
            return true;
        }
        if !entry.file_type().is_some_and(|kind| kind.is_dir()) {
            return true;
        }
        index::is_indexable(&filter_config, &filter_root, entry.path())
    });

    let mut watched = 0;
    for entry in builder.build().flatten() {
        let Some(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() || !file_type.is_dir() {
            continue;
        }
        if watcher
            .watch(entry.path(), RecursiveMode::NonRecursive)
            .is_ok()
        {
            watched += 1;
        }
    }

    watched
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::default_config;

    fn config_for(root: &Path) -> Config {
        default_config(root)
    }

    fn notification_watcher() -> RecommendedWatcher {
        notify::recommended_watcher(|_| {}).unwrap()
    }

    #[tokio::test]
    async fn a_missing_root_fails_to_watch() {
        let dir = tempfile::tempdir().unwrap();
        let mut config = config_for(dir.path());
        config.roots = vec![dir.path().join("gone")];
        let (tx, _rx) = mpsc::unbounded_channel();
        assert!(spawn_watcher(&config, tx).is_err());
    }

    #[tokio::test]
    async fn reads_do_not_report_changes() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join("file.txt"), b"x").unwrap();
        let config = config_for(dir.path());
        let (tx, mut rx) = mpsc::unbounded_channel();
        let _watcher = spawn_watcher(&config, tx).unwrap();

        for entry in std::fs::read_dir(dir.path()).unwrap().flatten() {
            let _ = std::fs::read(entry.path());
        }
        tokio::time::sleep(Duration::from_millis(700)).await;
        assert!(rx.try_recv().is_err(), "reads must not look like changes");

        std::fs::write(dir.path().join("new.txt"), b"x").unwrap();
        let event = tokio::time::timeout(Duration::from_secs(3), rx.recv())
            .await
            .expect("a write must be reported")
            .unwrap();
        assert!(matches!(
            event,
            WatcherEvent::Changed(paths) if paths.iter().any(|path| path.ends_with("new.txt"))
        ));
    }

    #[tokio::test]
    async fn skips_hidden_excluded_and_symlinked_folders() {
        let dir = tempfile::tempdir().unwrap();
        let visible = dir.path().join("visible");
        let hidden = dir.path().join(".hidden");
        let excluded = dir.path().join("node_modules");
        std::fs::create_dir_all(&visible).unwrap();
        std::fs::create_dir_all(&hidden).unwrap();
        std::fs::create_dir_all(&excluded).unwrap();
        std::os::unix::fs::symlink("/does/not/exist", visible.join("link")).unwrap();

        let config = config_for(dir.path());
        let mut watcher = notification_watcher();
        assert_eq!(add_tree(&mut watcher, &config, &visible), 1);
        assert_eq!(add_tree(&mut watcher, &config, &hidden), 0);
        assert_eq!(add_tree(&mut watcher, &config, &excluded), 0);

        let (tx, _rx) = mpsc::unbounded_channel();
        assert!(spawn_watcher(&config, tx).is_ok());
    }
}
