// SPDX-License-Identifier: GPL-3.0-or-later
use std::cmp::Ordering;
use std::path::{Path, PathBuf};

use nucleo_matcher::pattern::{CaseMatching, Normalization, Pattern};
use nucleo_matcher::{Matcher, Utf32Str};

use crate::index::{Entry, EntryKind};

const MAX_LIMIT: usize = 50;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Match {
    pub path: PathBuf,
    pub name: String,
    pub kind: EntryKind,
    pub score: u32,
}

pub fn query(entries: &[Entry], text: &str, limit: usize) -> Vec<Match> {
    let text = text.trim();
    if text.is_empty() {
        return Vec::new();
    }

    let limit = limit.clamp(1, MAX_LIMIT);
    let needle = text.to_lowercase();
    let pattern = Pattern::parse(text, CaseMatching::Ignore, Normalization::Smart);
    if pattern.atoms.is_empty() {
        return Vec::new();
    }

    let simple = !needle.chars().any(|character| {
        character.is_whitespace() || matches!(character, '^' | '!' | '$' | '\'' | '\\')
    });

    let mut matcher = Matcher::default();
    let mut buffer = Vec::new();
    let mut candidates: Vec<Candidate> = Vec::new();

    for entry in entries {
        if simple
            && needle.is_ascii()
            && entry.name_lower.is_ascii()
            && !is_subsequence(&needle, &entry.name_lower)
        {
            continue;
        }

        let Some(score) =
            pattern.score(Utf32Str::new(&entry.name_lower, &mut buffer), &mut matcher)
        else {
            continue;
        };

        candidates.push((score, entry.path.components().count(), entry));
    }

    if candidates.len() > limit {
        candidates.select_nth_unstable_by(limit - 1, compare_candidates);
        candidates.truncate(limit);
    }
    candidates.sort_unstable_by(compare_candidates);

    candidates
        .into_iter()
        .map(|(score, _, entry)| Match {
            path: entry.path.clone(),
            name: display_name(&entry.path),
            kind: entry.kind,
            score,
        })
        .collect()
}

type Candidate<'a> = (u32, usize, &'a Entry);

fn compare_candidates(
    (score_a, depth_a, entry_a): &Candidate<'_>,
    (score_b, depth_b, entry_b): &Candidate<'_>,
) -> Ordering {
    score_b
        .cmp(score_a)
        .then_with(|| entry_a.name_lower.len().cmp(&entry_b.name_lower.len()))
        .then_with(|| depth_a.cmp(depth_b))
        .then_with(|| entry_a.path.cmp(&entry_b.path))
}

fn is_subsequence(needle: &str, haystack: &str) -> bool {
    let mut haystack = haystack.chars();
    needle
        .chars()
        .all(|needle_character| haystack.any(|character| character == needle_character))
}

fn display_name(path: &Path) -> String {
    path.file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default()
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
    fn ranks_exact_prefix_substring_and_subsequence() {
        let entries = vec![
            entry("/h/report.pdf", EntryKind::File),
            entry("/h/report2.pdf", EntryKind::File),
            entry("/h/my-report.pdf", EntryKind::File),
            entry("/h/r-e-p-o-r-t.txt", EntryKind::File),
        ];

        let got = query(&entries, "report", 10);
        assert_eq!(got[0].name, "report.pdf");
        assert_eq!(got[1].name, "report2.pdf");
        assert_eq!(got.last().unwrap().name, "r-e-p-o-r-t.txt");
    }

    #[test]
    fn is_case_insensitive_and_trims() {
        let entries = vec![entry("/h/ÄRGER.TXT", EntryKind::File)];
        assert_eq!(query(&entries, "  ärger ", 10).len(), 1);
    }

    #[test]
    fn clamps_limit_and_handles_empty() {
        let entries = vec![entry("/h/a.txt", EntryKind::File); 10];
        assert_eq!(query(&entries, "a", 500).len(), 10);
        assert!(query(&entries, "   ", 10).is_empty());
        assert_eq!(query(&entries, "a", 0).len(), 1);
    }

    #[test]
    fn answers_from_a_quarter_million_entries() {
        let entries: Vec<Entry> = (0..250_000)
            .map(|index| entry(&format!("/h/file-{index:06}.txt"), EntryKind::File))
            .collect();

        let got = query(&entries, "file-249999", 10);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].name, "file-249999.txt");
    }

    #[test]
    #[ignore = "performance benchmark; run with make perf"]
    fn benchmark_query_latency() {
        use std::time::Instant;

        // The default cap is 250k entries, so measure the worst realistic size.
        let entries: Vec<Entry> = (0..250_000)
            .map(|index| {
                entry(
                    &format!("/h/project-{:04}/file-{index:06}.txt", index % 2000),
                    EntryKind::File,
                )
            })
            .collect();

        for (label, text) in [
            ("exact", "file-249999"),
            ("prefix", "file-24"),
            ("fuzzy", "projfile"),
            ("multi-word", "project 0421 file"),
        ] {
            query(&entries, text, 20);
            let runs = 100;
            let mut times = Vec::with_capacity(runs);
            for _ in 0..runs {
                let start = Instant::now();
                let _ = query(&entries, text, 20);
                times.push(start.elapsed().as_secs_f64() * 1000.0);
            }
            times.sort_by(|left, right| left.total_cmp(right));
            let mean = times.iter().sum::<f64>() / runs as f64;
            println!(
                "query {label:<10} p50 {:>6.2}ms p95 {:>6.2}ms mean {:>6.2}ms",
                times[runs / 2],
                times[(runs * 95 / 100).min(runs - 1)],
                mean
            );
        }
    }

    #[test]
    fn keeps_only_the_best_of_many_matches() {
        let entries: Vec<Entry> = (0..1_000)
            .map(|index| {
                entry(
                    &format!("/h/dir-{index:03}/match-{index:03}.txt"),
                    EntryKind::File,
                )
            })
            .collect();

        let got = query(&entries, "match", 5);
        assert_eq!(got.len(), 5);
        assert_eq!(got[0].name, "match-000.txt");
        assert_eq!(got[4].name, "match-004.txt");
    }

    #[test]
    fn ties_prefer_the_shorter_name_then_the_shallower_path() {
        let entries = vec![
            entry("/h/alphabeta.txt", EntryKind::File),
            entry("/h/deep/alpha.txt", EntryKind::File),
            entry("/h/alpha.txt", EntryKind::File),
        ];

        let got = query(&entries, "alpha", 10);
        assert_eq!(got[0].name, "alpha.txt");
        assert_eq!(got[0].path, PathBuf::from("/h/alpha.txt"));
        assert_eq!(got[1].name, "alpha.txt");
        assert_eq!(got[1].path, PathBuf::from("/h/deep/alpha.txt"));
        assert_eq!(got[2].name, "alphabeta.txt");
    }
}
