#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
"""Smoke test for the release body composer."""

import json
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
VERSION = json.loads(
    (ROOT / "extension" / "metadata.json").read_text(encoding="utf-8"))["version-name"]
REPORT = json.loads(
    (ROOT / "docs" / "release-notes" / f"{VERSION}-resources.json")
    .read_text(encoding="utf-8"))

result = subprocess.run(
    [sys.executable, str(ROOT / "tools" / "release" / "release_body.py"),
     f"v{VERSION}"],
    check=True, capture_output=True, text=True)

body = result.stdout
assert "## Resource usage" in body
assert "## Full changelog" in body
assert "### Added" in body
assert "See [CHANGELOG.md]" not in body
assert f"{REPORT['summary']['shell_rss_kb'] / 1024:.1f} MiB" in body
print("ok release body")
