// SPDX-License-Identifier: GPL-3.0-or-later
use std::fmt;
use std::path::{Path, PathBuf};

use serde::Deserialize;

const CACHE_FORMAT: u64 = 1;
const DEFAULT_MAX_ENTRIES: usize = 250_000;

const DEFAULT_EXCLUDES: &[&str] = &[
    // Build and dependency folders that are usually huge and never searched.
    "node_modules",
    "bower_components",
    "target",
    "__pycache__",
    "venv",
    "go/pkg/mod",
    "go/pkg/sumdb",
    "Android/Sdk",
    "snap",
    "Pods",
    // Hidden caches. The index skips hidden folders already; keeping them here
    // documents the intent and keeps the watcher from descending into them.
    ".cache",
    ".git",
    ".venv",
    ".cargo/registry",
    ".cargo/git",
    ".rustup/toolchains",
    ".m2/repository",
    ".gradle/caches",
    ".npm/_cacache",
    ".nuget/packages",
    ".local/share/Trash",
    ".local/share/Steam",
    ".local/share/containers",
    ".local/share/flatpak",
    ".var/app",
];

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Config {
    pub roots: Vec<PathBuf>,
    pub exclude_dirs: Vec<String>,
    pub max_entries: usize,
}

#[derive(Debug)]
pub enum ConfigError {
    Io(std::io::Error),
    Parse(toml::de::Error),
}

impl fmt::Display for ConfigError {
    fn fmt(&self, formatter: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Io(error) => write!(formatter, "cannot read config: {error}"),
            Self::Parse(error) => write!(formatter, "cannot parse config: {error}"),
        }
    }
}

impl std::error::Error for ConfigError {}

impl From<std::io::Error> for ConfigError {
    fn from(error: std::io::Error) -> Self {
        Self::Io(error)
    }
}

impl From<toml::de::Error> for ConfigError {
    fn from(error: toml::de::Error) -> Self {
        Self::Parse(error)
    }
}

#[derive(Debug, Default, Deserialize)]
#[serde(default)]
struct RawConfig {
    roots: Option<Vec<PathBuf>>,
    exclude_dirs: Option<Vec<String>>,
    max_entries: Option<usize>,
}

pub fn default_config(home: &Path) -> Config {
    Config {
        roots: vec![home.to_path_buf()],
        exclude_dirs: DEFAULT_EXCLUDES
            .iter()
            .map(|name| (*name).to_owned())
            .collect(),
        max_entries: DEFAULT_MAX_ENTRIES,
    }
}

impl Config {
    pub fn load(path: &Path, home: &Path) -> Result<Self, ConfigError> {
        match std::fs::read_to_string(path) {
            Ok(text) => Self::load_str(&text, home),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => Ok(default_config(home)),
            Err(error) => Err(error.into()),
        }
    }

    pub fn load_str(text: &str, home: &Path) -> Result<Self, ConfigError> {
        let raw: RawConfig = toml::from_str(text)?;
        let roots = raw
            .roots
            .unwrap_or_else(|| vec![home.to_path_buf()])
            .iter()
            .map(|root| expand_root(root, home))
            .collect();

        Ok(Self {
            roots,
            exclude_dirs: raw
                .exclude_dirs
                .unwrap_or_else(|| default_config(home).exclude_dirs)
                .into_iter()
                .map(|pattern| expand_exclude(&pattern, home))
                .collect(),
            max_entries: raw.max_entries.unwrap_or(DEFAULT_MAX_ENTRIES),
        })
    }

    pub fn fingerprint(&self) -> u64 {
        let mut hash = fnv1a(&CACHE_FORMAT.to_le_bytes(), FNV_OFFSET);

        for root in &self.roots {
            hash = fnv1a(root.as_os_str().as_encoded_bytes(), hash);
            hash = fnv1a(&[0xff], hash);
        }

        for exclude in &self.exclude_dirs {
            hash = fnv1a(exclude.as_bytes(), hash);
            hash = fnv1a(&[0xff], hash);
        }

        fnv1a(&self.max_entries.to_le_bytes(), hash)
    }
}

pub fn home_dir() -> PathBuf {
    std::env::var_os("HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."))
}

pub fn config_path() -> PathBuf {
    let config_home = std::env::var_os("XDG_CONFIG_HOME")
        .filter(|path| !path.is_empty())
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|home| PathBuf::from(home).join(".config")))
        .unwrap_or_else(|| PathBuf::from(".config"));

    config_home.join("sift").join("config.toml")
}

const FNV_OFFSET: u64 = 0xcbf2_9ce4_8422_2325;
const FNV_PRIME: u64 = 0x0000_0100_0000_01b3;

fn fnv1a(bytes: &[u8], mut hash: u64) -> u64 {
    for byte in bytes {
        hash ^= u64::from(*byte);
        hash = hash.wrapping_mul(FNV_PRIME);
    }
    hash
}

fn expand_root(root: &Path, home: &Path) -> PathBuf {
    if root == Path::new("~") {
        return home.to_path_buf();
    }

    if let Ok(rest) = root.strip_prefix("~") {
        return home.join(rest);
    }

    if root.is_absolute() {
        root.to_path_buf()
    } else {
        home.join(root)
    }
}

fn expand_exclude(pattern: &str, home: &Path) -> String {
    if pattern == "~" {
        return home.to_string_lossy().into_owned();
    }

    if let Some(rest) = pattern.strip_prefix("~/") {
        return home.join(rest).to_string_lossy().into_owned();
    }

    pattern.to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defaults_match_the_design() {
        let config = default_config(Path::new("/home/alice"));
        assert_eq!(config.roots, vec![PathBuf::from("/home/alice")]);
        assert_eq!(config.max_entries, 250_000);
        for exclude in [
            ".cache",
            ".local/share/Trash",
            "node_modules",
            ".git",
            "target",
            "__pycache__",
            ".venv",
            "venv",
            "go/pkg/mod",
            "go/pkg/sumdb",
            "Android/Sdk",
            "snap",
            "Pods",
            ".cargo/registry",
            ".local/share/Steam",
        ] {
            assert!(config.exclude_dirs.contains(&exclude.to_owned()));
        }
    }

    #[test]
    fn tilde_excludes_expand_against_home() {
        let config = Config::load_str(
            "exclude_dirs = [\"~/secret\", \"go/pkg/mod\", \"/data/raw\"]\n",
            Path::new("/home/alice"),
        )
        .unwrap();
        assert_eq!(config.exclude_dirs[0], "/home/alice/secret");
        assert_eq!(config.exclude_dirs[1], "go/pkg/mod");
        assert_eq!(config.exclude_dirs[2], "/data/raw");
    }

    #[test]
    fn tilde_and_relative_roots_expand_against_home() {
        let config =
            Config::load_str("roots = [\"~\", \"Documents\"]\n", Path::new("/home/alice")).unwrap();
        assert_eq!(
            config.roots,
            vec![
                PathBuf::from("/home/alice"),
                PathBuf::from("/home/alice/Documents")
            ]
        );
    }

    #[test]
    fn invalid_toml_is_an_error() {
        assert!(Config::load_str("roots = [", Path::new("/home/alice")).is_err());
    }

    #[test]
    fn missing_file_uses_defaults() {
        let config = Config::load(
            Path::new("/nonexistent/sift/config.toml"),
            Path::new("/home/alice"),
        )
        .unwrap();
        assert_eq!(config, default_config(Path::new("/home/alice")));
    }

    #[test]
    fn empty_roots_disables_the_file_index() {
        let config = Config::load_str("roots = []\n", Path::new("/home/alice")).unwrap();
        assert!(config.roots.is_empty());
    }

    #[test]
    fn fingerprint_changes_with_roots_and_excludes() {
        let config = default_config(Path::new("/home/alice"));
        let mut changed = config.clone();
        changed.roots.push(PathBuf::from("/data"));
        assert_ne!(config.fingerprint(), changed.fingerprint());

        let mut changed = config.clone();
        changed.exclude_dirs.push("build".to_owned());
        assert_ne!(config.fingerprint(), changed.fingerprint());
    }
}
