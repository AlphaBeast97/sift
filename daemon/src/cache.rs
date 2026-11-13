// SPDX-License-Identifier: GPL-3.0-or-later
use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::os::unix::ffi::OsStrExt;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};

use crate::index::{Entry, EntryKind};

const MAGIC: &[u8; 8] = b"SIFTIDX1";
const VERSION: u32 = 1;
const MAX_ENTRIES: u64 = 10_000_000;
const MAX_PATH_LEN: usize = 4096;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CachedIndex {
    pub entries: Vec<Entry>,
    pub truncated: bool,
}

pub fn load(path: &Path, fingerprint: u64) -> Option<CachedIndex> {
    let bytes = fs::read(path).ok()?;
    parse(&bytes, fingerprint)
}

pub fn store(path: &Path, fingerprint: u64, entries: &[Entry], truncated: bool) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
        fs::set_permissions(parent, fs::Permissions::from_mode(0o700))?;
    }

    let mut bytes = Vec::with_capacity(29 + entries.len() * 64);
    bytes.extend_from_slice(MAGIC);
    bytes.extend_from_slice(&VERSION.to_le_bytes());
    bytes.extend_from_slice(&fingerprint.to_le_bytes());
    bytes.extend_from_slice(&(entries.len() as u64).to_le_bytes());
    bytes.push(u8::from(truncated));

    for entry in entries {
        bytes.push(match entry.kind {
            EntryKind::File => 0,
            EntryKind::Dir => 1,
        });
        let path = entry.path.as_os_str().as_bytes();
        bytes.extend_from_slice(&(path.len() as u32).to_le_bytes());
        bytes.extend_from_slice(path);
    }

    let mut temporary = path.as_os_str().to_owned();
    temporary.push(".tmp");
    let temporary = PathBuf::from(temporary);
    let mut file = OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(true)
        .mode(0o600)
        .open(&temporary)?;
    file.set_permissions(fs::Permissions::from_mode(0o600))?;
    file.write_all(&bytes)?;
    file.sync_all()?;
    drop(file);

    fs::rename(temporary, path)
}

fn parse(bytes: &[u8], fingerprint: u64) -> Option<CachedIndex> {
    let mut reader = Reader::new(bytes);

    if reader.take(MAGIC.len())? != MAGIC {
        return None;
    }
    if reader.u32()? != VERSION {
        return None;
    }
    if reader.u64()? != fingerprint {
        return None;
    }

    let count = reader.u64()?;
    if count > MAX_ENTRIES {
        return None;
    }
    let truncated = match reader.u8()? {
        0 => false,
        1 => true,
        _ => return None,
    };

    let mut entries = Vec::new();
    for _ in 0..count {
        let kind = match reader.u8()? {
            0 => EntryKind::File,
            1 => EntryKind::Dir,
            _ => return None,
        };

        let length = reader.u32()? as usize;
        if length > MAX_PATH_LEN {
            return None;
        }

        let path = PathBuf::from(std::ffi::OsStr::from_bytes(reader.take(length)?));
        let name_lower = path
            .file_name()
            .map(|name| name.to_string_lossy().to_lowercase())
            .unwrap_or_default();

        entries.push(Entry {
            path,
            name_lower,
            kind,
        });
    }

    if reader.remaining() != 0 {
        return None;
    }

    Some(CachedIndex { entries, truncated })
}

struct Reader<'a> {
    bytes: &'a [u8],
    offset: usize,
}

impl<'a> Reader<'a> {
    fn new(bytes: &'a [u8]) -> Self {
        Self { bytes, offset: 0 }
    }

    fn take(&mut self, length: usize) -> Option<&'a [u8]> {
        let end = self.offset.checked_add(length)?;
        let slice = self.bytes.get(self.offset..end)?;
        self.offset = end;
        Some(slice)
    }

    fn u8(&mut self) -> Option<u8> {
        Some(self.take(1)?[0])
    }

    fn u32(&mut self) -> Option<u32> {
        Some(u32::from_le_bytes(self.take(4)?.try_into().ok()?))
    }

    fn u64(&mut self) -> Option<u64> {
        Some(u64::from_le_bytes(self.take(8)?.try_into().ok()?))
    }

    fn remaining(&self) -> usize {
        self.bytes.len() - self.offset
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entry(path: &str, kind: EntryKind) -> Entry {
        let path = PathBuf::from(path);
        let name_lower = path
            .file_name()
            .map(|name| name.to_string_lossy().to_lowercase())
            .unwrap_or_default();
        Entry {
            path,
            name_lower,
            kind,
        }
    }

    #[test]
    fn round_trips_entries_and_truncation() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("index-v1.bin");
        let entries = vec![
            entry("/home/a/File.txt", EntryKind::File),
            entry("/home/a/dir", EntryKind::Dir),
        ];

        store(&path, 42, &entries, true).unwrap();
        let loaded = load(&path, 42).unwrap();
        assert_eq!(loaded.entries, entries);
        assert!(loaded.truncated);
        assert_eq!(
            fs::metadata(&path).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }

    #[test]
    fn fingerprint_and_version_mismatches_are_ignored() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("index-v1.bin");
        store(&path, 1, &[], false).unwrap();
        assert!(load(&path, 2).is_none());

        let mut bytes = fs::read(&path).unwrap();
        bytes[8..12].copy_from_slice(&99u32.to_le_bytes());
        fs::write(&path, bytes).unwrap();
        assert!(load(&path, 1).is_none());
    }

    #[test]
    fn corrupt_or_missing_cache_is_none() {
        let dir = tempfile::tempdir().unwrap();
        assert!(load(&dir.path().join("missing"), 1).is_none());

        let path = dir.path().join("index-v1.bin");
        fs::write(&path, b"junk").unwrap();
        assert!(load(&path, 1).is_none());

        store(&path, 1, &[], false).unwrap();
        let mut bytes = fs::read(&path).unwrap();
        bytes.push(0);
        fs::write(&path, bytes).unwrap();
        assert!(load(&path, 1).is_none());
    }

    #[test]
    fn creates_a_private_cache_directory() {
        let dir = tempfile::tempdir().unwrap();
        let cache_dir = dir.path().join("sift");
        let path = cache_dir.join("index-v1.bin");
        store(&path, 1, &[], false).unwrap();
        assert_eq!(
            fs::metadata(&cache_dir).unwrap().permissions().mode() & 0o777,
            0o700
        );
    }
}
