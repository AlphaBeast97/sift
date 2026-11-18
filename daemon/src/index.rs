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

    pub fn has_path(&self, path: &Path) -> bool {
        self.state
            .read()
            .unwrap()
            .entries
            .binary_search_by(|entry| entry.path.as_path().cmp(path))
            .is_ok()
    }

    pub fn apply_batch(&self, config: &Config, paths: &[PathBuf]) -> bool {
        if paths.is_empty() || config.roots.is_empty() {
            return false;
        }

        let mut paths = paths.to_vec();
        paths.sort();
        paths.dedup();

        let mut state = self.state.write().unwrap();
        let mut changed = false;
        let mut additions = Vec::new();

        // Remove first so a rename frees its slots before the new subtree is added.
        for path in &paths {
            if path.exists() {
                additions.push(path.clone());
            } else {
                changed |= remove_subtree(&mut state.entries, path);
            }
        }

        for path in additions {
            let Some(root) = containing_root(&config.roots, &path) else {
                changed |= remove_subtree(&mut state.entries, &path);
                continue;
            };

            let Ok(metadata) = std::fs::symlink_metadata(&path) else {
                changed |= remove_subtree(&mut state.entries, &path);
                continue;
            };
            if metadata.file_type().is_symlink() || !is_indexable(config, root, &path) {
                changed |= remove_subtree(&mut state.entries, &path);
                continue;
            }

            let kind = if metadata.is_dir() {
                EntryKind::Dir
            } else if metadata.is_file() {
                EntryKind::File
            } else {
                changed |= remove_subtree(&mut state.entries, &path);
                continue;
            };

            // Walking a folder again for every event that names it made each
            // read of the tree enqueue another read of the tree.
            let known = path == *root ||
                state
                    .entries
                    .binary_search_by(|entry| entry.path.as_path().cmp(&path))
                    .is_ok();

            if path != *root {
                changed |= insert_entry(
                    &mut state,
                    Entry {
                        name_lower: lower_name(&path),
                        path: path.clone(),
                        kind,
                    },
                    config.max_entries,
                );
            }

            if kind == EntryKind::Dir && !known {
                let remaining = config.max_entries.saturating_sub(state.entries.len());
                if remaining == 0 {
                    state.truncated = true;
                    continue;
                }
                for entry in walk_subtree(config, root, &path, remaining) {
                    changed |= insert_entry(&mut state, entry, config.max_entries);
                }
            }
        }

        changed
    }
}

fn lower_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().to_lowercase())
        .unwrap_or_default()
}

pub(crate) fn containing_root<'a>(roots: &'a [PathBuf], path: &Path) -> Option<&'a Path> {
    roots
        .iter()
        .filter(|root| path.starts_with(root))
        .max_by_key(|root| root.components().count())
        .map(PathBuf::as_path)
}

pub(crate) fn is_indexable(config: &Config, root: &Path, path: &Path) -> bool {
    let Ok(relative) = path.strip_prefix(root) else {
        return false;
    };

    if relative.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .is_some_and(|name| name.starts_with('.'))
    }) {
        return false;
    }

    if config.exclude_dirs.iter().any(|pattern| {
        let pattern = Path::new(pattern);
        pattern.is_absolute() && path.starts_with(pattern)
    }) {
        return false;
    }

    !is_excluded(relative, &config.exclude_dirs)
}

fn remove_subtree(entries: &mut Vec<Entry>, path: &Path) -> bool {
    let start = entries.partition_point(|entry| entry.path.as_path() < path);
    let mut end = start;
    while end < entries.len() && entries[end].path.starts_with(path) {
        end += 1;
    }

    if start == end {
        return false;
    }

    entries.drain(start..end);
    true
}

fn insert_entry(state: &mut IndexState, entry: Entry, cap: usize) -> bool {
    match state
        .entries
        .binary_search_by(|existing| existing.path.cmp(&entry.path))
    {
        Ok(index) => {
            if state.entries[index] == entry {
                false
            } else {
                state.entries[index] = entry;
                true
            }
        }
        Err(index) => {
            if state.entries.len() >= cap {
                state.truncated = true;
                return false;
            }
            state.entries.insert(index, entry);
            true
        }
    }
}

fn walk_subtree(config: &Config, root: &Path, path: &Path, limit: usize) -> Vec<Entry> {
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
        .same_file_system(true);

    builder.filter_entry(move |entry| {
        if entry.depth() == 0 {
            return true;
        }
        if !entry.file_type().is_some_and(|kind| kind.is_dir()) {
            return true;
        }
        is_indexable(&filter_config, &filter_root, entry.path())
    });

    let mut entries = Vec::new();
    for result in builder.build() {
        let Ok(entry) = result else { continue };
        if entry.depth() == 0 {
            continue;
        }
        let Some(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_symlink() || (!file_type.is_file() && !file_type.is_dir()) {
            continue;
        }

        entries.push(Entry {
            path: entry.path().to_path_buf(),
            name_lower: lower_name(entry.path()),
            kind: if file_type.is_dir() {
                EntryKind::Dir
            } else {
                EntryKind::File
            },
        });

        if entries.len() >= limit {
            break;
        }
    }

    entries
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

        let filter_config = config.clone();
        let filter_root = root.clone();
        builder.filter_entry(move |entry| {
            if entry.depth() == 0 {
                return true;
            }
            if !entry.file_type().is_some_and(|kind| kind.is_dir()) {
                return true;
            }
            is_indexable(&filter_config, &filter_root, entry.path())
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
    fn absolute_excludes_match_paths_under_a_root() {
        let config = crate::config::Config::load_str(
            "roots = [\"~/work\"]\nexclude_dirs = [\"~/work/private\", \"go/pkg/mod\"]\n",
            Path::new("/home/alice"),
        )
        .unwrap();
        let root = Path::new("/home/alice/work");
        assert!(!is_indexable(
            &config,
            root,
            Path::new("/home/alice/work/private/notes.txt")
        ));
        assert!(!is_indexable(
            &config,
            root,
            Path::new("/home/alice/work/go/pkg/mod/cache.txt")
        ));
        assert!(is_indexable(
            &config,
            root,
            Path::new("/home/alice/work/public/notes.txt")
        ));
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

    #[test]
    fn apply_batch_adds_removes_and_renames() {
        let dir = tempfile::tempdir().unwrap();
        let old = dir.path().join("old");
        let new = dir.path().join("new");
        std::fs::create_dir(&old).unwrap();
        std::fs::write(old.join("a.txt"), b"x").unwrap();
        let cfg = crate::config::default_config(dir.path());
        let index = Index::new(vec![], false);
        index.apply_batch(&cfg, std::slice::from_ref(&old));
        assert!(index.has_path(&old.join("a.txt")));

        std::fs::rename(&old, &new).unwrap();
        index.apply_batch(&cfg, &[old.clone(), new.clone()]);
        assert!(!index.has_path(&old.join("a.txt")));
        assert!(index.has_path(&new.join("a.txt")));

        std::fs::remove_dir_all(&new).unwrap();
        index.apply_batch(&cfg, std::slice::from_ref(&new));
        assert_eq!(index.len(), 0);
    }

    #[test]
    fn apply_batch_ignores_hidden_excluded_and_duplicates() {
        let dir = tempfile::tempdir().unwrap();
        std::fs::write(dir.path().join(".secret"), b"x").unwrap();
        std::fs::write(dir.path().join("ok.txt"), b"x").unwrap();
        let cfg = crate::config::default_config(dir.path());
        let index = Index::new(vec![], false);
        assert!(index.apply_batch(
            &cfg,
            &[dir.path().join("ok.txt"), dir.path().join("ok.txt")]
        ));
        assert!(!index.apply_batch(&cfg, &[dir.path().join("ok.txt")]));
        index.apply_batch(&cfg, &[dir.path().join(".secret")]);
        assert_eq!(index.len(), 1);
    }
}
