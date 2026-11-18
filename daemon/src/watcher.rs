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
    Rescan,
    Failed,
}

pub fn spawn_watcher(
    config: &Config,
    tx: mpsc::UnboundedSender<WatcherEvent>,
) -> notify::Result<(RecommendedWatcher, bool)> {
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
    let mut failed = 0;
    for root in &config.roots {
        let (root_watched, root_failed) = add_tree(&mut watcher, config, root);
        watched += root_watched;
        failed += root_failed;
    }

    // A configured root that cannot be watched at all is a real failure; a
    // single unreadable subfolder is not. The scan skips both.
    if !config.roots.is_empty() && watched == 0 {
        return Err(notify::Error::generic("no indexed folder could be watched"));
    }

    tokio::spawn(async move {
        let mut pending = HashSet::new();

        while let Some(first) = raw_rx.recv().await {
            let mut rescan = match first {
                Ok(event) => absorb(event, &mut pending),
                Err(_) => {
                    let _ = tx.send(WatcherEvent::Failed);
                    false
                }
            };

            tokio::time::sleep(DEBOUNCE).await;

            loop {
                match raw_rx.try_recv() {
                    Ok(Ok(event)) => rescan |= absorb(event, &mut pending),
                    Ok(Err(_)) => {
                        let _ = tx.send(WatcherEvent::Failed);
                    }
                    Err(TryRecvError::Empty | TryRecvError::Disconnected) => break,
                }
            }

            if rescan {
                // A rescan makes the individual paths irrelevant.
                pending.clear();
                if tx.send(WatcherEvent::Rescan).is_err() {
                    break;
                }
            } else if !pending.is_empty() {
                let mut paths: Vec<_> = pending.drain().collect();
                paths.sort();
                if tx.send(WatcherEvent::Changed(paths)).is_err() {
                    break;
                }
            }
        }
    });

    Ok((watcher, failed > 0))
}

/// Returns true when events may have been lost and the tree must be rescanned.
fn absorb(event: Event, pending: &mut HashSet<PathBuf>) -> bool {
    if event.need_rescan() {
        return true;
    }
    pending.extend(event.paths);
    false
}

/// Watch every folder under `path` that the index would include. Recursive
/// watches follow symlinks and fail as a whole when one folder is unreadable,
/// so each folder gets its own non-recursive watch instead. Returns the number
/// of folders watched and the number that could not be watched.
pub fn add_tree(watcher: &mut RecommendedWatcher, config: &Config, path: &Path) -> (usize, usize) {
    let Some(root) = index::containing_root(&config.roots, path) else {
        return (0, 0);
    };
    if !index::is_indexable(config, root, path, true) {
        return (0, 0);
    }

    let Ok(metadata) = std::fs::symlink_metadata(path) else {
        return (0, 0);
    };
    if metadata.file_type().is_symlink() || !metadata.is_dir() {
        return (0, 0);
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
        index::is_indexable(&filter_config, &filter_root, entry.path(), true)
    });

    let mut watched = 0;
    let mut failed = 0;
    for entry in builder.build().flatten() {
        let Some(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() || !file_type.is_dir() {
            continue;
        }
        if watch_folder(watcher, entry.path()) {
            watched += 1;
        } else {
            failed += 1;
        }
    }

    (watched, failed)
}

fn watch_folder(watcher: &mut RecommendedWatcher, path: &Path) -> bool {
    watcher.watch(path, RecursiveMode::NonRecursive).is_ok()
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
        assert_eq!(add_tree(&mut watcher, &config, &visible), (1, 0));
        assert_eq!(add_tree(&mut watcher, &config, &hidden), (0, 0));
        assert_eq!(add_tree(&mut watcher, &config, &excluded), (0, 0));

        let (tx, _rx) = mpsc::unbounded_channel();
        let (_, partial) = spawn_watcher(&config, tx).unwrap();
        assert!(!partial, "a readable tree is watched in full");
    }

    #[test]
    fn failed_watches_are_counted() {
        let mut watcher = notification_watcher();
        assert!(watch_folder(&mut watcher, Path::new("/")));
        assert!(!watch_folder(
            &mut watcher,
            &PathBuf::from("/").join("x".repeat(5000))
        ));
    }

    #[test]
    fn overflow_events_request_a_rescan() {
        use notify::event::{CreateKind, Flag};

        let mut pending = HashSet::new();
        let overflow = Event::new(EventKind::Other).set_flag(Flag::Rescan);
        assert!(absorb(overflow, &mut pending));
        assert!(pending.is_empty());

        let changed = Event::new(EventKind::Create(CreateKind::File))
            .add_path(PathBuf::from("/tmp/new.txt"));
        assert!(!absorb(changed, &mut pending));
        assert!(pending.contains(Path::new("/tmp/new.txt")));
    }
}
