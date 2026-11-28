#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Renders the measured resource table for the release notes."""

import json
import sys

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


def main():
    if len(sys.argv) != 2:
        print("usage: resource_report.py REPORT", file=sys.stderr)
        return 2

    with open(sys.argv[1], encoding="utf-8") as handle:
        summary = json.load(handle).get("summary", {})

    print("## Resource usage")
    print()
    print("Measured on the release runner. Shell RSS is the whole headless "
          "GNOME Shell process, so treat it as a trend rather than Sift's "
          "exact footprint.")
    print()
    print("| Metric | Value |")
    print("| --- | ---: |")
    for key, label, unit in METRICS:
        print(f"| {label} | {format_value(summary.get(key), unit)} |")
    return 0


if __name__ == "__main__":
    sys.exit(main())
