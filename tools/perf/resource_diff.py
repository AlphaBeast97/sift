#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Builds the release resource report and diffs it against the last release."""

import json
import os
import sys
import urllib.error
import urllib.request

METRICS = [
    ("enable_ms", "Extension enable", "ms"),
    ("prewarm_ms", "Prewarm ready", "ms"),
    ("grid_first_open_max_frame_ms", "App grid first open, max frame", "ms"),
    ("grid_first_open_p95_frame_ms", "App grid first open, p95 frame", "ms"),
    ("workspace_first_open_max_frame_ms",
     "Workspace first open, max frame", "ms"),
    ("shell_rss_kb", "Shell RSS", "kb"),
]


def load(path):
    with open(path, encoding="utf-8") as handle:
        return json.load(handle)


def fetch_previous():
    repo = os.environ.get("GITHUB_REPOSITORY")
    token = os.environ.get("GITHUB_TOKEN")
    if not repo or not token:
        return None, None

    headers = {
        "Authorization": f"Bearer {token}",
        "Accept": "application/vnd.github+json",
        "User-Agent": "sift-release",
    }
    request = urllib.request.Request(
        f"https://api.github.com/repos/{repo}/releases?per_page=30",
        headers=headers,
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        releases = json.load(response)

    current_tag = os.environ.get("GITHUB_REF_NAME")
    release = next(
        (item for item in releases
         if not item.get("draft") and not item.get("prerelease") and
         item.get("tag_name") != current_tag),
        None,
    )
    if release is None:
        return None, None

    asset = next(
        (item for item in release.get("assets", [])
         if item.get("name") == "resource-report.json"),
        None,
    )
    if asset is None:
        return release.get("tag_name"), None

    headers["Accept"] = "application/octet-stream"
    request = urllib.request.Request(asset["url"], headers=headers)
    with urllib.request.urlopen(request, timeout=30) as response:
        return release.get("tag_name"), json.load(response)


def format_value(value, unit):
    if value is None:
        return "n/a"
    if unit == "kb":
        return f"{value / 1024:.1f} MiB"
    return f"{value:.1f}ms"


def format_delta(current, previous, unit):
    if current is None or previous is None:
        return "n/a"
    delta = current - previous
    if unit == "kb":
        text = f"{delta / 1024:+.1f} MiB"
    else:
        text = f"{delta:+.1f}ms"
    if previous == 0:
        return text
    return f"{text} ({delta / previous * 100:+.1f}%)"


def main():
    if len(sys.argv) < 2:
        print("usage: resource_diff.py CURRENT [PREVIOUS]", file=sys.stderr)
        return 2

    current = load(sys.argv[1])
    current_tag = os.environ.get("GITHUB_REF_NAME") or "this release"

    previous_tag = None
    previous = None
    if len(sys.argv) > 2:
        previous = load(sys.argv[2])
        previous_tag = sys.argv[2]
    else:
        try:
            previous_tag, previous = fetch_previous()
        except (urllib.error.URLError, OSError) as error:
            print(f"> Could not fetch the previous release: {error}")
            print()

    print("## Resource usage")
    print()

    summary = current.get("summary", {})
    if previous is None:
        print("First release: this report is the baseline. Later releases "
              "are compared against it.")
        print()
        print("| Metric | Value |")
        print("| --- | ---: |")
        for key, label, unit in METRICS:
            print(f"| {label} | {format_value(summary.get(key), unit)} |")
        return 0

    print(f"Compared with `{previous_tag}`.")
    print()
    print(f"| Metric | {previous_tag} | {current_tag} | Change |")
    print("| --- | ---: | ---: | ---: |")
    old = previous.get("summary", {})
    for key, label, unit in METRICS:
        value = summary.get(key)
        old_value = old.get(key)
        print(f"| {label} | {format_value(old_value, unit)} | "
              f"{format_value(value, unit)} | "
              f"{format_delta(value, old_value, unit)} |")
    return 0


if __name__ == "__main__":
    sys.exit(main())
