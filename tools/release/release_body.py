#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Compose the GitHub release body from the notes, resource report, and changelog."""

import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
METRICS = [
    ("enable_ms", "Extension enable", "ms"),
    ("prewarm_ms", "Prewarm ready", "ms"),
    ("grid_first_open_max_frame_ms", "App grid first open, max frame", "ms"),
    ("grid_first_open_p95_frame_ms", "App grid first open, p95 frame", "ms"),
    ("workspace_first_open_max_frame_ms",
     "Workspace first open, max frame", "ms"),
    ("shell_rss_kb", "Shell RSS", "kb"),
]


def format_value(value, unit):
    if value is None:
        return "n/a"
    if unit == "kb":
        return f"{value / 1024:.1f} MiB"
    return f"{value:.1f}ms"


def resource_section(path):
    report = json.loads(path.read_text(encoding="utf-8"))
    summary = report.get("summary", {})
    measured = f"Measured locally on {report.get('os') or 'Linux'}"
    if report.get("date"):
        measured += f" on {report['date']}"
    measured += (" with `make resources`. Shell RSS is the whole headless GNOME "
                 "Shell process, so treat it as a trend rather than Sift's exact "
                 "footprint.")
    lines = [
        "### Resource usage",
        "",
        measured,
        "",
        "| Metric | Value |",
        "| --- | ---: |",
    ]
    for key, label, unit in METRICS:
        lines.append(f"| {label} | {format_value(summary.get(key), unit)} |")
    return "\n".join(lines)


def changelog_section(path, version):
    text = path.read_text(encoding="utf-8")
    match = re.search(
        rf"^## \[{re.escape(version)}\][^\n]*\n(.*?)(?=^## \[|\Z)",
        text, re.MULTILINE | re.DOTALL)
    if not match:
        raise SystemExit(f"CHANGELOG.md has no section for {version}")
    return "## Full changelog\n\n" + match.group(1).strip()


def main():
    if len(sys.argv) != 2:
        print("usage: release_body.py VERSION", file=sys.stderr)
        return 2

    version = sys.argv[1].removeprefix("v")
    notes = ROOT / "docs" / "release-notes" / f"{version}.md"
    resources = ROOT / "docs" / "release-notes" / f"{version}-resources.json"
    changelog = ROOT / "CHANGELOG.md"
    for path in (notes, resources, changelog):
        if not path.is_file():
            print(f"missing {path.relative_to(ROOT)}", file=sys.stderr)
            return 1

    parts = [
        notes.read_text(encoding="utf-8").rstrip(),
        changelog_section(changelog, version),
        resource_section(resources),
    ]
    print("\n\n".join(parts))
    return 0


if __name__ == "__main__":
    sys.exit(main())
