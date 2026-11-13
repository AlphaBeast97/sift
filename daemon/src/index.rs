// SPDX-License-Identifier: GPL-3.0-or-later
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicUsize, Ordering};
use std::sync::{Mutex, RwLock, RwLockReadGuard};

use ignore::{WalkBuilder, WalkState};

use crate::config::Config;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum EntryKind {
    File,
    Dir,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Entry {
    pub path: PathBuf,
    pub name_lower: String,
    pub kind: EntryKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ScanResult {
    pub entries: Vec<Entry>,
    pub truncated: bool,
}

pub struct Index {
    state: RwLock<IndexState>,
}

#[derive(Debug)]
pub struct IndexState {
    pub entries: Vec<Entry>,
    pub truncated: bool,
}

impl IndexState {
    pub fn new(entries: Vec<Entry>, truncated: bool) -> Self {
        Self { entries, truncated }
    }
}

impl Index {
    pub fn new(entries: Vec<Entry>, truncated: bool) -> Self {
        Self {
            state: RwLock::new(IndexState::new(entries, truncated)),
        }
    }

    pub fn read(&self) -> RwLockReadGuard<'_, IndexState> {
        self.state.read().unwrap()
    }

    pub fn replace(&self, entries: Vec<Entry>, truncated: bool) {
        *self.state.write().unwrap() = IndexState::new(entries, truncated);
    }

    pub fn len(&self) -> usize {
        self.state.read().unwrap().entries.len()
    }
}

pub fn scan(config: &Config, cancel: &AtomicBool, progress: &AtomicUsize) -> ScanResult {
    let entries = Mutex::new(Vec::new());
    let truncated = AtomicBool::new(false);
    let cap = config.max_entries;

    for config_root in &config.roots {
        if truncated.load(Ordering::Relaxed) {
            break;
        }

        let root = config_root.clone();
        let mut builder = WalkBuilder::new(&root);
        builder
            .hidden(true)
            .ignore(false)
            .git_ignore(false)
            .git_global(false)
            .git_exclude(false)
            .follow_links(false)
            .same_file_system(true)
            .threads(4);

        let patterns = config.exclude_dirs.clone();
        builder.filter_entry(move |entry| {
            if entry.depth() == 0 {
                return true;
            }
            if !entry.file_type().is_some_and(|kind| kind.is_dir()) {
                return true;
            }
            let relative = entry.path().strip_prefix(&root).unwrap_or(entry.path());
            !is_excluded(relative, &patterns)
        });

        builder.build_parallel().run(|| {
            Box::new(|result| {
                if cancel.load(Ordering::Relaxed) {
                    return WalkState::Quit;
                }

                let entry = match result {
                    Ok(entry) => entry,
                    Err(_) => return WalkState::Continue,
                };
                if entry.depth() == 0 {
                    return WalkState::Continue;
                }

                let file_type = match entry.file_type() {
                    Some(file_type) => file_type,
                    None => return WalkState::Continue,
                };
                if file_type.is_symlink() {
                    return WalkState::Continue;
                }
                if !file_type.is_file() && !file_type.is_dir() {
                    return WalkState::Continue;
                }

                if progress.fetch_add(1, Ordering::Relaxed) >= cap {
                    truncated.store(true, Ordering::Relaxed);
                    return WalkState::Quit;
                }

                let kind = if file_type.is_dir() {
                    EntryKind::Dir
                } else {
                    EntryKind::File
                };
                entries.lock().unwrap().push(Entry {
                    path: entry.path().to_path_buf(),
                    name_lower: entry.file_name().to_string_lossy().to_lowercase(),
                    kind,
                });

                WalkState::Continue
            })
        });
    }

    let mut entries = entries.into_inner().unwrap();
    entries.sort_by(|left, right| left.path.cmp(&right.path));
    entries.dedup_by(|left, right| left.path == right.path);

    let truncated = truncated.load(Ordering::Relaxed);
    if entries.len() > cap {
        entries.truncate(cap);
        return ScanResult {
            entries,
            truncated: true,
        };
    }

    ScanResult { entries, truncated }
}

pub fn is_excluded(relative: &Path, patterns: &[String]) -> bool {
    let components: Vec<_> = relative
        .components()
        .filter_map(|component| component.as_os_str().to_str())
        .collect();

    patterns.iter().any(|pattern| {
        let pattern: Vec<_> = Path::new(pattern)
            .components()
            .filter_map(|component| component.as_os_str().to_str())
            .collect();

        match pattern.as_slice() {
            [] => false,
            [name] => components.contains(name),
            _ => components
                .windows(pattern.len())
                .any(|window| window == pattern.as_slice()),
        }
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(path: PathBuf) {
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        std::fs::write(path, b"x").unwrap();
    }

    #[test]
    fn skips_hidden_excluded_symlinks_and_caps() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path().join("visible.txt"));
        write(dir.path().join(".hidden"));
        write(dir.path().join("node_modules/pkg.js"));
        write(dir.path().join("deep/.git/config"));
        std::os::unix::fs::symlink(dir.path().join("visible.txt"), dir.path().join("link.txt"))
            .unwrap();

        let config = crate::config::default_config(dir.path());
        let found = scan(&config, &AtomicBool::new(false), &AtomicUsize::new(0));
        let names: Vec<_> = found
            .entries
            .iter()
            .map(|entry| entry.name_lower.as_str())
            .collect();
        assert!(names.contains(&"visible.txt"));
        assert!(!names.contains(&".hidden"));
        assert!(!names.contains(&"pkg.js"));
        assert!(!names.contains(&"config"));
        assert!(!names.contains(&"link.txt"));

        let mut capped = config.clone();
        capped.max_entries = 1;
        let found = scan(&capped, &AtomicBool::new(false), &AtomicUsize::new(0));
        assert_eq!(found.entries.len(), 1);
        assert!(found.truncated);
    }

    #[test]
    fn lowercases_unicode_names() {
        let dir = tempfile::tempdir().unwrap();
        write(dir.path().join("Ärger.TXT"));
        let found = scan(
            &crate::config::default_config(dir.path()),
            &AtomicBool::new(false),
            &AtomicUsize::new(0),
        );
        assert!(
            found
                .entries
                .iter()
                .any(|entry| entry.name_lower == "ärger.txt")
        );
    }

    #[test]
    fn excludes_match_names_and_paths() {
        let patterns = crate::config::default_config(Path::new("/home/alice")).exclude_dirs;
        assert!(is_excluded(Path::new("node_modules/pkg.js"), &patterns));
        assert!(is_excluded(Path::new("deep/.git/config"), &patterns));
        assert!(is_excluded(
            Path::new(".local/share/Trash/files/old"),
            &patterns
        ));
        assert!(is_excluded(Path::new("src/target/debug"), &patterns));
        assert!(!is_excluded(Path::new("src/main.rs"), &patterns));
    }

    #[test]
    fn index_swaps_snapshots() {
        let index = Index::new(Vec::new(), false);
        assert_eq!(index.len(), 0);

        index.replace(
            vec![Entry {
                path: PathBuf::from("/home/alice/a.txt"),
                name_lower: "a.txt".to_owned(),
                kind: EntryKind::File,
            }],
            true,
        );
        assert_eq!(index.len(), 1);
        assert!(index.read().truncated);
    }
}
