#!/usr/bin/env python3
# SPDX-License-Identifier: GPL-3.0-or-later
import json
import zipfile
import xml.etree.ElementTree as ET
from pathlib import Path

root = Path(__file__).resolve().parents[2]
meta = json.loads((root / 'extension/metadata.json').read_text())
assert meta['uuid'] == 'sift@alphabeast97.github.io', meta['uuid']
assert meta['shell-version'] == ['51'], meta['shell-version']
assert meta['session-modes'] == ['user'], meta['session-modes']
assert meta['settings-schema'] == 'org.gnome.shell.extensions.sift', meta['settings-schema']

schema = ET.parse(root / 'extension/schemas/org.gnome.shell.extensions.sift.gschema.xml')
assert schema.getroot().find("./schema[@id='org.gnome.shell.extensions.sift']") is not None

zip_path = root / 'dist' / f"{meta['uuid']}.shell-extension.zip"
with zipfile.ZipFile(zip_path) as z:
    names = set(z.namelist())
    prefs = z.read('prefs.js').decode()

required = {
    'metadata.json',
    'extension.js',
    'prefs.js',
    'stylesheet.css',
    'src/overlay.js',
    'src/overview.js',
    'src/results.js',
    'src/apps.js',
    'src/appGrid.js',
    'src/glass.js',
    'src/lib/appScore.js',
    'src/lib/geometry.js',
    'src/lib/gridMath.js',
    'src/lib/keys.js',
    'src/lib/merge.js',
    'schemas/org.gnome.shell.extensions.sift.gschema.xml',
}
missing = required - names
assert not missing, f'missing from zip: {sorted(missing)}'

assert "resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js" in prefs, \
    'prefs.js imports the GNOME 51 preferences module'
print('ok pack')
