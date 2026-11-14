# Sift Implementation Plan

> **For whoever implements this:** work the tasks in order and commit at each task's commit step. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship Sift for GNOME Shell 51: a Super/Activities overlay with instant app search, a paged app grid, a Rust file/calculator daemon, liquid glass with a frosted fallback, and an Adwaita preferences window — with a real local and CI test pipeline.

**Architecture:** GJS owns the shell: Overview takeover, focus, keyboard, rows, app grid, glass, and preferences. A single Rust process, `siftd`, owns the home-directory filename index, fuzzy matching, and `fend-core` evaluation, reached over the session bus. Apps stay in GJS via `Shell.AppSystem`.

**Tech Stack:** GNOME Shell 51 / GJS 1.90, Rust 1.99, zbus 6, tokio, `ignore`, `notify` 8, `nucleo-matcher`, `fend-core`, Adwaita, GSettings, dbus-run-session, `gnome-shell-test-tool --headless`.

**Spec:** `docs/superpowers/specs/2026-11-11-sift-design.md`

## Global Constraints

- GNOME Shell **51 only**; `metadata.json` declares `"shell-version": ["51"]` and `"session-modes": ["user"]`.
- UUID `sift@alphabeast97.github.io`; daemon `siftd`; bus `io.github.alphabeast97.Sift`; object `/io/github/alphabeast97/Sift`; schema `org.gnome.shell.extensions.sift`; settings path `/org/gnome/shell/extensions/sift/`.
- License **GPL-3.0-or-later**. Keep `THIRD_PARTY_NOTICES` current for `nucleo-matcher` (MPL-2.0), `fend-core` (MIT), and Isle-derived shader math (GPL-3.0-or-later, `https://github.com/zickrian/isle`).
- No network access at runtime. No live currency rates. No file-content reads.
- No shell poll loops and no idle timers. Timers only for the 40 ms query debounce, the 500 ms watcher debounce / status throttle, the 30 s dirty-cache flush while dirty, and animations.
- Search view: panel width `clamp(560, 0.55 × monitor width, 720)`; top 18% of monitor height clamped below the top bar; row height 52 px; entry 60 px; footer 32 px; default `max-results` 6.
- Grid view: panel width `clamp(720, 0.72 × monitor width, 1040)`; top 12% of monitor height; height at most 70% of monitor height; icon size default 96; columns 4–10; rows 2–6; page padding 24; spacing 12.
- Settings defaults: `glass-mode=auto`, `glass-opacity=0.72`, `blur-radius=40`, `glass-tint=0.45`, `animations=true`, `max-results=6`, `grid-icon-size=96`.
- File index: roots `~` by default, hidden skipped, symlinks not followed, same filesystem, cap 250,000, excludes `.cache`, `.local/share/Trash`, `node_modules`, `.git`, `target`, `__pycache__`, `.venv`, `venv`.
- D-Bus query length ≤ 128 UTF-8 bytes; limit 1–50; 500 ms extension timeout; one query in flight; stale replies dropped.
- Conventional commits (`feat:`, `fix:`, `docs:`, `test:`, `ci:`, `build:`, `refactor:`, `chore:`), one coherent change per commit. Never push or create a GitHub remote before the M5 approval gate.
- Every task ends with its tests passing and its own commit.

## Review Focus

The spec implies these inputs but no single task's happy path exercises them. Each one has a test below.

1. **Rapid typing and stale asynchronous replies** — results must always match the text currently in the entry, and the selected row must not jump to a different item when only the file/calc tail changes. (Task 19 merge/selection tests; Task 20 rapid-typing headless test.)
2. **Daemon missing, slow, or crashed** — apps must still search, and the footer must say once that the service is unavailable rather than silently showing nothing. (Task 18 headless no-daemon test.)
3. **IME composition and printable keys in the grid** — Escape during preedit must not close Sift, while a printable key in grid view must switch to search and become the first query character. (Task 6 key-state tests; Task 9 headless grid test.)
4. **Small, large, and offset monitors** — the panel must stay on-screen below the top bar, and the results height must cap and scroll instead of overflowing. (Task 6 geometry tests; Task 23 manual multi-monitor check.)
5. **Index churn** — renames, deletes of whole subtrees, hidden/excluded paths, symlinks, and the 250k cap must never leave duplicate or stale entries. (Task 11 walker tests; Task 17 `apply_batch` tests.)

---

## M0 — Spike

### Task 1: Glass and takeover spike

**Files:**
- Create: `spike/metadata.json`, `spike/extension.js`, `spike/stylesheet.css`
- Create: `extension/src/perf.js`, `extension/src/lib/stats.js`
- Create: `tools/perf/frame-meter.js`
- Create: `extension/tests/unit/assert.js`, `all.js`, `stats.test.js`
- Create: `docs/perf/m0-spike.md`

**Interfaces:**
- Produces: `export class FrameMeter { start(); stop(); get summary(); }` in `extension/src/perf.js`; `summary` is `{p50, p95, max, frames}` in milliseconds.
- Produces: `export function percentile(values, p)` in `extension/src/lib/stats.js`.
- Produces: `tools/perf/frame-meter.js` re-exports `FrameMeter` and `percentile`.

- [ ] **Step 1: Build the throwaway spike extension**

Create a minimal extension (throwaway UUID) with a centered 720×420 panel, one wallpaper clone and one window-surface clone, `Shell.BlurEffect` in `ACTOR` mode, and a rounded `Clutter.ShaderEffect` adapted from Isle's `glass.js` / `shader.js`. Shadow `Main.overview.show/hide/toggle/showApps/focusSearch` with the wrappers from design §8.2, set `Main.overview._swipeTracker.enabled = false`, and call `Main.pushModal(panel, {actionMode: Shell.ActionMode.OVERVIEW})` on open. Include a second 1040×70%-height panel rect behind a temporary Ctrl+G toggle (Super+G is intercepted by Mutter's overlay key) for the grid-size measurement.

- [ ] **Step 2: Add the frame meter**

```js
// extension/src/perf.js
export class FrameMeter {
    // start(): register one Meta.LaterType.BEFORE_REDRAW later that reschedules itself
    // stop(): remove the later
    // summary: {p50, p95, max, frames} from the recorded frame intervals
}
```

Add `export function percentile(values, p)` in `extension/src/lib/stats.js` so the summary is testable; `perf.js` imports it. `tools/perf/frame-meter.js` re-exports both for scripts.

- [ ] **Step 3: Install the spike on the real session and record measurements**

Run:

```bash
mkdir -p /tmp/spike-pack
gnome-extensions pack spike -o /tmp/spike-pack --force
gnome-extensions install --force /tmp/spike-pack/<spike-uuid>.shell-extension.zip
gnome-extensions enable <spike-uuid>
```

Log out and back in if the running shell has not seen the extension (installing
over a running shell does not reload changed code). The meter logs each close;
record in `docs/perf/m0-spike.md`:

- search rect and grid rect frame P50/P95/max, open, typing, close;
- clone correctness over a window, video, fullscreen app, and with Blur my Shell enabled;
- whether clips/shader compile on this GPU and at 100% and 200% scaling;
- Super / Activities / hot corner / `showApps` / Super+A / second Super / disable restore behavior;
- chosen starting blur radius, tint, saturation, lens, rim values.

- [ ] **Step 4: Check the meter's math**

Add `extension/tests/unit/stats.test.js`:

```js
import {equal} from './assert.js';
import {percentile} from '../../src/lib/stats.js';

export function run() {
    equal(percentile([1, 2, 3, 4], 0.5), 2.5);
    equal(percentile([1, 2, 3, 4], 0.95), 3.85);
}
```

plus the minimal `assert.js`/`all.js` runner that Task 3 extends, and run:

```bash
gjs -m extension/tests/unit/all.js
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add spike extension/src tools/perf extension/tests docs/perf/m0-spike.md
git commit -m "chore: add glass and overview spike"
```

---

### Task 2: Record M0 decisions and remove the spike

**Files:**
- Create: `docs/research/glass-spike.md`
- Modify: `docs/perf/m0-spike.md`
- Delete: `spike/`

**Interfaces:**
- Produces: the final glass constants and hook list that Tasks 21–23 consume.

- [ ] **Step 1: Write the findings**

`docs/research/glass-spike.md` records, with numbers from Task 1:

- the confirmed Overview hook list (or corrections to design §8);
- whether liquid glass is viable for the search rect and separately for the grid rect;
- the exact shader constants, blur radius, and fallback decision;
- any clone kinds that must be skipped (video, fullscreen, BMS);
- the frame-meter command and how to read it.

- [ ] **Step 2: Delete the spike**

```bash
git rm -r spike
```

- [ ] **Step 3: Verify no reference to the spike remains**

Run: `git grep -n "sift-spike[@]"`
Expected: no output.

- [ ] **Step 4: Commit**

```bash
git add docs/research/glass-spike.md docs/perf/m0-spike.md
git commit -m "docs: record m0 glass and takeover findings"
```

---

## M1 — Extension foundation

### Task 3: Repo scaffolding, extension skeleton, schema, and GJS test harness

**Files:**
- Create: `LICENSE` (copy `/usr/share/common-licenses/GPL-3`)
- Create: `.editorconfig`, `.gitignore`, `rust-toolchain.toml`
- Create: `README.md` (name, status, one-command install placeholder)
- Create: `THIRD_PARTY_NOTICES`
- Create: `package.json`, `package-lock.json`, `eslint.config.js`
- Create: `Makefile`
- Create: `extension/metadata.json`, `extension/extension.js`, `extension/stylesheet.css`
- Create: `extension/schemas/org.gnome.shell.extensions.sift.gschema.xml`
- Create: `extension/tests/unit/schema.test.js`, `schema.js`
- Modify: `extension/tests/unit/assert.js`, `all.js`
- Test: `extension/tests/unit/schema.test.js`

**Interfaces:**
- Produces: `export default class SiftExtension extends Extension` with `enable()`, `disable()`, `getTestAPI()`.
- Produces: settings defaults and ranges listed in Global Constraints.
- Produces: `make build`, `make lint`, `make test-gjs`, `make test-schema`, `make test`.

- [ ] **Step 1: Write the schema test**

```js
// extension/tests/unit/schema.test.js
import Gio from 'gi://Gio';
import {assert, equal, almost} from './assert.js';

export function run() {
    const source = Gio.SettingsSchemaSource.get_default();
    const schema = source.lookup('org.gnome.shell.extensions.sift', true);
    assert(schema !== null, 'schema is installed');
    const settings = new Gio.Settings({schema_id: 'org.gnome.shell.extensions.sift'});

    equal(settings.get_string('glass-mode'), 'auto');
    almost(settings.get_double('glass-opacity'), 0.72);
    equal(settings.get_int('blur-radius'), 40);
    almost(settings.get_double('glass-tint'), 0.45);
    equal(settings.get_boolean('animations'), true);
    equal(settings.get_int('max-results'), 6);
    equal(settings.get_int('grid-icon-size'), 96);
    const range = key => settings.get_range(key).recursiveUnpack()[1];

    equal(range('max-results').join(','), '4,12');
    equal(range('blur-radius').join(','), '0,64');
    almost(range('glass-opacity')[0], 0.30);
    almost(range('glass-opacity')[1], 0.95);
    almost(range('glass-tint')[0], 0.0);
    almost(range('glass-tint')[1], 1.0);
    equal(range('grid-icon-size').join(','), '48,128');
    equal(schema.list_keys().sort().join(','),
        'animations,blur-radius,glass-mode,glass-opacity,glass-tint,grid-icon-size,max-results');
}
```

`assert.js` exports `assert(cond, message)`, `equal(actual, expected, message)`, `almost(actual, expected, epsilon = 1e-6)`. `all.js` imports the pure unit tests (all `*.test.js` except `schema.test.js`, which needs the compiled schema environment), runs each `run()`, prints `ok <name>`, and exits non-zero on the first throw. `schema.js` is the one-line runner: import `run` from `./schema.test.js`, call it, print `ok schema`.

- [ ] **Step 2: Run the schema test and watch it fail**

Run: `gjs -m extension/tests/unit/schema.js`
Expected: FAIL — the schema is not installed yet (`Gio.Settings` throws).

- [ ] **Step 3: Add the schema, metadata, and skeleton**

Schema keys exactly as in Global Constraints; enum `glass-mode` with nicks `auto`, `liquid`, `frosted`, `off`. Metadata:

```json
{
  "uuid": "sift@alphabeast97.github.io",
  "name": "Sift",
  "description": "Fast search, a calculator, and an app grid with liquid glass for GNOME Shell.",
  "shell-version": ["51"],
  "session-modes": ["user"],
  "settings-schema": "org.gnome.shell.extensions.sift",
  "version-name": "0.1.0"
}
```

`extension.js`:

```js
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

export default class SiftExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
    }

    disable() {
        this._settings = null;
    }

    getTestAPI() {
        return {extension: this, settings: this._settings};
    }
}
```

- [ ] **Step 4: Add Makefile and lint config**

Targets required now:

```make
UUID := sift@alphabeast97.github.io
SCHEMA := schemas/org.gnome.shell.extensions.sift.gschema.xml

test-gjs:
	gjs -m extension/tests/unit/all.js

test-schema:
	@tmp=$$(mktemp -d); \
	glib-compile-schemas --strict --targetdir "$$tmp" extension/schemas; \
	GSETTINGS_SCHEMA_DIR="$$tmp" GSETTINGS_BACKEND=keyfile XDG_CONFIG_HOME="$$tmp" \
		gjs -m extension/tests/unit/schema.js; \
	rm -rf "$$tmp"

lint:
	npx eslint extension tools

build:
	mkdir -p dist
	gnome-extensions pack extension --schema=$(SCHEMA) -o dist --force

test: test-gjs test-schema lint
```

The zip carries only the schema XML; `gnome-extensions install` (and the shell's
downloader) runs `glib-compile-schemas` in the installed `schemas/` directory.
Do not add `gschemas.compiled` to the zip by hand.

`schema.test.js` is a module exporting `run()`; `schema.js` is a one-line runner that calls `run()` and prints `ok schema`. ESLint flat config: 4 spaces, single quotes, semicolons, `no-unused-vars`, `no-undef`, with GJS globals `global`, `print`, `log`, `logError`, `_`, `N_`, `C_`. Commit `package-lock.json` from `npm install`.

- [ ] **Step 5: Run the tests**

Run:

```bash
npm install
make test
make build
```

Expected: `make test` prints `ok schema` and ESLint exits 0; `make build` writes `dist/sift@alphabeast97.github.io.shell-extension.zip`.

- [ ] **Step 6: Commit**

```bash
git add LICENSE README.md THIRD_PARTY_NOTICES .editorconfig .gitignore rust-toolchain.toml \
  package.json package-lock.json eslint.config.js Makefile extension
git commit -m "feat: scaffold sift extension with settings schema"
```

---

### Task 4: Headless GNOME Shell smoke harness

**Files:**
- Create: `tools/test/run-shell-test.sh`, `tools/test/headless.js`
- Modify: `Makefile`
- Test: `tools/test/headless.js`

**Interfaces:**
- Consumes: `dist/sift@alphabeast97.github.io.shell-extension.zip` from Task 3.
- Produces: `make test-shell`, which packs and runs the automation script in a private session bus.
- Produces: `assert` and `waitFor` helpers inside `headless.js` (not exported).

- [ ] **Step 1: Write the smoke script**

```js
// tools/test/headless.js
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';

const UUID = 'sift@alphabeast97.github.io';

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

async function waitFor(predicate, message, timeout = 5000) {
    const deadline = Date.now() + timeout;
    while (Date.now() < deadline) {
        if (predicate())
            return;
        await Scripting.sleep(20);
    }
    throw new Error(message);
}

export async function run() {
    await waitFor(() => Extension.lookupByUUID(UUID) !== null,
        'extension instance exists');
    const ext = Extension.lookupByUUID(UUID);
    assert(ext.getTestAPI().settings !== null, 'extension enabled');
    await waitFor(() => Main.extensionManager.lookup(UUID)?.state === ExtensionState.ACTIVE,
        'extension is active');
    await Scripting.waitLeisure();

    Main.extensionManager.disableExtension(UUID);
    await waitFor(() => Main.extensionManager.lookup(UUID)?.state === ExtensionState.INACTIVE,
        'extension is inactive on disable');

    Main.extensionManager.enableExtension(UUID);
    await waitFor(() => Main.extensionManager.lookup(UUID)?.state === ExtensionState.ACTIVE,
        'extension re-enables');
}
```

- [ ] **Step 2: Write the runner**

```bash
#!/usr/bin/env bash
set -euo pipefail
root=$(cd "$(dirname "$0")/../.." && pwd)
exec dbus-run-session -- \
    gnome-shell-test-tool --headless \
    --extension "$root/dist/sift@alphabeast97.github.io.shell-extension.zip" \
    "$root/tools/test/headless.js"
```

The Makefile target builds the zip first: `test-shell: build`, then
`tools/test/run-shell-test.sh`. Add `test-shell` to `.PHONY` and
`chmod +x tools/test/run-shell-test.sh`.

- [ ] **Step 3: Run it**

Run: `make test-shell`
Expected: exit 0 with no `Script failed` or extension exception in the output. If the shell reports a missing EGL/GBM device, run `MESA_LOADER_DRIVER_OVERRIDE=llvmpipe make test-shell` and record the needed variable in the runner's comment.

- [ ] **Step 4: Commit**

```bash
git add tools/test Makefile
git commit -m "test: add headless shell smoke harness"
```

---

### Task 5: Pinned GNOME 51 test container and workflow files

**Files:**
- Create: `tools/ci/gnome51/Dockerfile`
- Create: `.github/workflows/ci.yml`, `.github/workflows/ci-image.yml`, `.github/workflows/shell-smoke.yml`, `.github/workflows/release.yml`
- Create: `docs/perf/ci-image.md`
- Create: `tools/test/check_pack.py`
- Modify: `Makefile`

**Interfaces:**
- Produces: `make ci-image` (local docker build), `make test-shell-container` (run the harness in the image), and `make check-pack` (metadata and zip sanity).
- Produces: image reference and digest recorded in `docs/perf/ci-image.md` for later GHCR publishing.

- [ ] **Step 1: Write the Dockerfile**

Pin an `archive.archlinux.org` snapshot with GNOME Shell 51.1 (2026-11-01 is
verified: gnome-shell 51.1, gjs 1.90.1, Mesa 26.2.6, Rust 1.99.1) and the
matching `archlinux:base-20261101.0.620205` image. Install: `gnome-shell`, `gjs`,
`mesa`, `dbus`, `glib2`, `gsettings-desktop-schemas`, `gnome-terminal`, `nodejs`,
`npm`, `python`, `ttf-dejavu`, `git`, `base-devel`, `rust`, plus
`xorg-server-xvfb` as the documented fallback. Set `ENV GSETTINGS_BACKEND=keyfile`.

- [ ] **Step 2: Build and run locally**

```bash
docker build -t sift-gnome51:local tools/ci/gnome51
docker run --rm -v "$PWD:/src" -w /src sift-gnome51:local make test-shell
```

Add the Makefile wrappers:

```make
ci-image:
	docker build -t sift-gnome51:local tools/ci/gnome51

test-shell-container:
	docker run --rm \
		--user "$$(id -u):$$(id -g)" \
		-e HOME=/tmp \
		-e XDG_RUNTIME_DIR=/tmp/sift-runtime \
		-v "$(CURDIR):/src" -w /src \
		sift-gnome51:local \
		sh -c 'mkdir -p /tmp/sift-runtime && chmod 700 /tmp/sift-runtime && make test-shell'
```

`test-shell-container` builds inside the image as the host uid, so it needs no
GNOME tooling on the host and leaves no root-owned `dist/` (important for a
plain GitHub runner). Expected: the smoke test passes on llvmpipe. If EGL fails,
add the `xvfb-run` path from design §18.2 and record which path the image uses.

- [ ] **Step 3: Write the workflows but do not push**

- `ci.yml`: Rust fmt/clippy/test, GJS lint/unit/schema, extension pack sanity, D-Bus integration. Every job runs inside the same pinned `sift-gnome51` image; do not assume `ubuntu-latest` has GNOME 51 typelibs. Run `npm ci` before `make test`; pack sanity is `tools/test/check_pack.py` (UUID, shell 51, schema id, required zip entries), exposed as `make check-pack`.
- `ci-image.yml`: build the Dockerfile and push to `ghcr.io/<owner>/sift-gnome51` with a digest, on `workflow_dispatch`, `main`, and `workflow_call`. The reusable call lets `shell-smoke.yml` build by digest.
- `shell-smoke.yml`: calls the image workflow, then `needs` its digest, logs in to GHCR, and runs `make test-shell` inside the container; main, nightly, and manual only.
- `release.yml`: on tag push, build `dist/siftd`, the extension zip, and `dist/SHA256SUMS` in the pinned image, then attach all three to the GitHub release with `softprops/action-gh-release`.
Do not add a remote or push. Record the local image ID and the exact package snapshot URL in `docs/perf/ci-image.md`.

- [ ] **Step 4: Commit**

```bash
git add tools/ci tools/test/check_pack.py .github docs/perf/ci-image.md Makefile
git commit -m "ci: add pinned gnome 51 test image and workflows"
```

---

### Task 6: Overlay shell, geometry, and key state

**Files:**
- Create: `extension/src/overlay.js`, `extension/src/glass.js` (stub in this task), `extension/src/results.js`
- Create: `extension/src/lib/geometry.js`, `extension/src/lib/keys.js`
- Create: `extension/tests/unit/geometry.test.js`, `keys.test.js`
- Modify: `extension/tests/unit/all.js`, `extension/extension.js`, `extension/stylesheet.css`
- Test: `extension/tests/unit/geometry.test.js`, `keys.test.js`

**Interfaces:**
- Produces: `export function searchPanel(monitor, topBarBottom, maxRows) -> {x, y, width, height, rows}` and `export function gridPanel(monitor, topBarBottom) -> {x, y, width, height}`.
- Produces: `export function resolveKey(symbol, {ctrl, shift, preedit, view, selectedKind}) -> string|null`; symbols are `Clutter.keyval_name()` strings; `view` is `'search'` or `'grid'` and scopes the grid actions (`grid-left`, `grid-activate`, …).
- Produces: `export class SiftOverlay` with `constructor({settings})`, `open(view = 'search')`, `close()`, `hide()`, `toggle()`, `showApps()`, `focusSearch()`, `setMaxRows(n)`, `handleKey(symbol, state, preedit)`, `destroy()`, getters `visible`, `view`, `entry`, `rows`, `maxRows`, `selectedIndex`, `rowCount`, `footerText`.
- Produces: `GlassPanel` stub with `attach(panel)`, `setRect(rect)`, `destroy()` so Task 21 can replace its body.

- [ ] **Step 1: Write geometry tests**

```js
// extension/tests/unit/geometry.test.js
import {equal} from './assert.js';
import {searchPanel, gridPanel} from '../../src/lib/geometry.js';

export function run() {
    const hd = {x: 0, y: 0, width: 1920, height: 1080};
    const search = searchPanel(hd, 32, 6);
    equal(search.width, 720);
    equal(search.height, 404);
    equal(search.x, 600);
    equal(search.y, 194);
    equal(search.rows, 6);

    const small = searchPanel({x: 0, y: 0, width: 1024, height: 600}, 32, 12);
    equal(small.width, 563);
    equal(small.height, 456);
    equal(small.y, 108);
    equal(small.rows, 7);

    const grid = gridPanel(hd, 32);
    equal(grid.width, 1040);
    equal(grid.height, 756);
    equal(grid.x, 440);
    equal(grid.y, 130);

    const offset = searchPanel({x: 1920, y: 0, width: 1920, height: 1080}, 32, 6);
    equal(offset.x, 2520);
}
```

`rows` is `min(maxRows, floor((monitor.height - y - 5% bottom margin - 92) / 52))`; height is `92 + rows × 52`. The width is `clamp(560, 0.55 × monitor width, 720)` and the top is `round(max(top bar bottom + 12, 18% of monitor height))`. Width, height, and rows use `Math.floor`; grid width/height/top use `Math.round`, and both rects are centered with `Math.round`.

- [ ] **Step 2: Write key-state tests**

```js
// extension/tests/unit/keys.test.js
import {equal} from './assert.js';
import {resolveKey} from '../../src/lib/keys.js';

export function run() {
    equal(resolveKey('Escape', {preedit: true, view: 'search'}), null);
    equal(resolveKey('Escape', {preedit: false, view: 'search'}), 'close');
    equal(resolveKey('Escape', {preedit: false, view: 'grid'}), 'close');
    equal(resolveKey('Return', {view: 'search'}), 'activate');
    equal(resolveKey('Return', {ctrl: true, selectedKind: 'file', view: 'search'}), 'activate-new');
    equal(resolveKey('c', {ctrl: true, selectedKind: 'calc', view: 'search'}), 'copy');
    equal(resolveKey('c', {ctrl: true, selectedKind: 'app', view: 'search'}), null);
    equal(resolveKey('Tab', {view: 'search'}), 'next');
    equal(resolveKey('Tab', {shift: true, view: 'search'}), 'prev');
    equal(resolveKey('Page_Down', {view: 'search'}), 'page-next');
    equal(resolveKey('Home', {view: 'search'}), 'first');
    equal(resolveKey('End', {view: 'search'}), 'last');
    equal(resolveKey('a', {view: 'grid'}), 'search-type');
    equal(resolveKey('a', {view: 'grid', ctrl: true}), null);
    equal(resolveKey('Left', {view: 'search'}), 'left');
    equal(resolveKey('Left', {view: 'grid'}), 'grid-left');
    equal(resolveKey('Up', {view: 'grid'}), 'grid-up');
    equal(resolveKey('Page_Down', {view: 'grid'}), 'grid-page-next');
    equal(resolveKey('Page_Up', {view: 'grid'}), 'grid-page-prev');
    equal(resolveKey('Home', {view: 'grid'}), 'grid-first');
    equal(resolveKey('End', {view: 'grid'}), 'grid-last');
    equal(resolveKey('Return', {view: 'grid'}), 'grid-activate');
}
```

- [ ] **Step 3: Run them and watch them fail**

Run: `make test-gjs`
Expected: FAIL — modules not found.

- [ ] **Step 4: Implement geometry, keys, and the overlay shell**

Overlay actor tree:

```text
SiftOverlay (fullscreen St.Widget, reactive, chrome, hidden)
└── panel (St.Widget, style_class sift-panel)
    ├── glass (GlassPanel stub)
    └── content (St.BoxLayout, vertical)
        ├── entryBar (St.BoxLayout, 60 px: search icon, St.Entry, grid button)
        ├── results (ResultsView viewport, 52 px rows)
        └── footer (32 px)
```

Open sequence: refuse unless `Main.sessionMode.currentMode === 'user'`; choose `global.display.get_current_monitor()`; compute geometry; `Main.pushModal(this, {actionMode: Shell.ActionMode.OVERVIEW})`; store the returned grab and bail if falsy; show; focus `this.entry`; send nothing to the daemon yet; animate opacity 0→255 and scale 0.98→1 over 120 ms (0 ms when `animations` is false or `St.Settings.get().enable_animations` is false). Close: pop that exact grab, hide, clear query, emit `closed`. Connect `captured-event` for keys and `button-press-event` for click-outside; close only when the event coordinates are outside the panel rect. In `handleKey`, read `preedit` from `this.entry.clutter_text.has_preedit()`; when it is true, return `EVENT_PROPAGATE` without acting so the IME owns the key. Connect `monitors-changed` to close and reopen at the new monitor. Set `this.reactive = true` so backdrop clicks are delivered. Attach the fullscreen actor to chrome once in the constructor with `Main.layoutManager.addChrome(this)` (input tracking is automatic); open/close only show/hide it, and `destroy()` calls `Main.layoutManager.removeChrome(this)`. Apart from the `preedit` case above, `handleKey` returns `EVENT_STOP` only when `resolveKey` yields an action and `EVENT_PROPAGATE` otherwise, so printable keys reach the entry.

`ResultsView` starts with 12 reusable rows and `setMaxRows(n)`. For this task it renders placeholder rows from an injected `rows` array; Task 8 fills real content. The overlay reads `maxRows` from `settings` on open, recomputes geometry when `changed::max-results` fires while open, and forwards the new limit to both `ResultsView` and the panel height.

`GlassPanel` stub only creates an empty frame actor and stores the rect; no blur or clones yet.

- [ ] **Step 5: Run the tests**

Run: `make test-gjs`
Expected: PASS for geometry and keys; the stats test from Task 1 still passes.

- [ ] **Step 6: Commit**

```bash
git add extension/src extension/tests extension/extension.js extension/stylesheet.css
git commit -m "feat: add sift overlay shell and geometry"
```

---

### Task 7: Overview takeover

**Files:**
- Create: `extension/src/overview.js`
- Modify: `extension/extension.js`
- Test: `tools/test/headless.js` (extend)

**Interfaces:**
- Consumes: `SiftOverlay` methods from Task 6.
- Produces: `export class OverviewTakeover` with `constructor({overlay, settings, metadataVersion})`, `install()`, `destroy()`, getter `installed`.
- Produces: `SiftExtension.getTestAPI()` returns `{extension, settings, overlay, takeover, appGrid, glass, daemon}` (later items null until their tasks).

- [ ] **Step 1: Extend the headless test**

After enable, add `import * as OverviewControls from 'resource:///org/gnome/shell/ui/overviewControls.js';` to the top of `headless.js`, then assert:

```js
let api = ext.getTestAPI();
Main.overview.toggle();
await Scripting.waitLeisure();
assert(api.overlay.visible, 'Super/overview toggle opens Sift');
Main.overview.toggle();
await Scripting.waitLeisure();
assert(!api.overlay.visible, 'second toggle closes Sift');

Main.overview.show();
await Scripting.waitLeisure();
assert(api.overlay.visible && api.overlay.view === 'search', 'show() opens search');

Main.overview.show(OverviewControls.ControlsState.APP_GRID);
await Scripting.waitLeisure();
assert(api.overlay.view === 'grid', 'show(APP_GRID) opens grid');

Main.overview.focusSearch();
await Scripting.waitLeisure();
assert(api.overlay.view === 'search' && api.overlay.entry.clutter_text.has_key_focus(),
    'focusSearch focuses the entry text');

Main.overview.hide();
await Scripting.waitLeisure();
assert(!api.overlay.visible, 'hide() closes');

// A restored session (or another extension) can show the native overview
// behind the takeover; hide must still dismiss it.
Object.getPrototypeOf(Main.overview).show.call(Main.overview);
await Scripting.waitLeisure();
assert(Main.overview.visible, 'native overview shown behind the takeover');
Main.overview.hide();
await Scripting.waitLeisure();
assert(!Main.overview.visible, 'hide closes the native overview too');
```

Then disable via the extension manager and assert the grabs and patches are gone:

```js
Main.extensionManager.disableExtension(UUID);
await waitFor(() => Main.extensionManager.lookup(UUID)?.state === ExtensionState.INACTIVE,
    'extension is inactive on disable');
assert(Main.modalCount === 0, 'modal grab released');
assert(api.takeover.installed === false, 'takeover uninstalled');
assert(!Object.prototype.hasOwnProperty.call(Main.overview, 'show'), 'show restored');
assert(!Object.prototype.hasOwnProperty.call(Main.overview, 'toggle'), 'toggle restored');
assert(Main.overview._swipeTracker.enabled, 'swipe tracker restored');
Main.overview.toggle();
await Scripting.waitLeisure();
assert(Main.overview.visible, 'stock overview opens after disable');
Main.overview.hide();
await Scripting.waitLeisure();

Main.overview.show();
await Scripting.waitLeisure();
assert(Main.overview.visible, 'native overview shown before enable');
Main.extensionManager.enableExtension(UUID);
await waitFor(() => Main.extensionManager.lookup(UUID)?.state === ExtensionState.ACTIVE,
    'extension re-enables after the restore check');
assert(!Main.overview.visible, 'enable closes a pre-existing overview');
api = Extension.lookupByUUID(UUID).getTestAPI();
```

Later tasks insert their assertions **before** this disable block so they run against the enabled extension. Do not call methods on the destroyed overlay after `disableExtension`; use `let api = ext.getTestAPI();`.

- [ ] **Step 2: Run it and watch it fail**

Run: `make test-shell`
Expected: FAIL — `Main.overview.toggle()` opens the native overview, not Sift.

- [ ] **Step 3: Implement the patch set**

Follow design §8.2 exactly. For each of `show`, `hide`, `toggle`, `focusSearch`, `showApps`, `shouldToggleByCornerOrButton`:

- record `hasOwn = Object.prototype.hasOwnProperty.call(Main.overview, name)` and the current value;
- assign a wrapper; store the wrapper in `this._wrappers[name]`;
- on destroy, restore the exact saved value if `hasOwn`, otherwise `delete Main.overview[name]`.

Before returning from `install()`, if the native overview is visible, close it with
the saved original `hide`. Every wrapper that opens Sift does the same first, and
`hide()` closes Sift and then calls the saved original if the native overview is
still visible; otherwise Escape cannot dismiss a restored overview.

`show(state)` maps `state === OverviewControls.ControlsState.APP_GRID` to `overlay.showApps()`, otherwise `overlay.open('search')`. `shouldToggleByCornerOrButton()` returns false while the overlay is animating and for 0.5 s after the last open; otherwise true.

Handle `toggle-overview` only when `Gio.Settings` for `org.gnome.shell.keybindings` has a non-empty `toggle-overview` binding: remove and re-add it with `Main.wm.addKeybinding(...)` using that settings object, `Meta.KeyBindingFlags.IGNORE_AUTOREPEAT`, `Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW`, and `() => overlay.toggle()`. On destroy, remove ours and re-add the stock dynamic handler `() => Main.overview.toggle()` with the same settings/flags/modes.

Disable the swipe tracker by storing and setting `Main.overview._swipeTracker.enabled = false`; restore the old value on destroy.

Fail loudly at install if any of `Main.overview`, `Main.overview._swipeTracker`, `OverviewControls.ControlsState`, or `Main.pushModal` is missing: throw before patching anything.

Wire `enable()` in this order: settings → overlay → takeover; `disable()` reverses it (takeover first, then overlay). `getTestAPI()` returns the property object described above with `appGrid`, `glass`, and `daemon` still `null`.

- [ ] **Step 4: Run the headless test**

Run: `make test-shell`
Expected: PASS for all entry points and both pre-existing-overview cases.

- [ ] **Step 5: Commit**

```bash
git add extension/src/overview.js extension/extension.js tools/test/headless.js
git commit -m "feat: take over the gnome overview entry points"
```

---

### Task 8: App snapshot, scoring, rows, and activation

**Files:**
- Create: `extension/src/apps.js`
- Create: `extension/src/lib/appScore.js`, `extension/src/lib/merge.js`
- Create: `extension/tests/unit/appScore.test.js`, `merge.test.js`
- Modify: `extension/src/results.js`, `extension/src/overlay.js`, `extension/extension.js`, `tools/test/headless.js`
- Test: `extension/tests/unit/appScore.test.js`, `merge.test.js`, `tools/test/headless.js`

**Interfaces:**
- Produces: `export class Apps { constructor(appSystem); connect(); disconnect(); search(query, limit) -> record[]; gridApps() -> record[]; }`
- Produces: `export function normalizeApp(app) -> record`, `export function rankApps(records, query, limit) -> record[]`.
- Produces: `export function mergeRows({calc, apps, files}, maxRows) -> row[]`, `export function appRow(record) -> row`, `export function calcRow(calc) -> row`, `export function selectionAfter(rows, key) -> number`.
- Row shape: `{kind: 'calc'|'app'|'file', key, title, subtitle, icon, app?, path?, result?}`.

- [ ] **Step 1: Write scoring tests**

```js
// extension/tests/unit/appScore.test.js
import {equal} from './assert.js';
import {rankApps} from '../../src/lib/appScore.js';

const app = (id, name, extra = {}) => ({
    id, name, lowerName: name.toLowerCase(), genericName: '', lowerGeneric: '',
    keywords: [], lowerKeywords: [], lowerId: id.toLowerCase(), running: false, ...extra,
});

export function run() {
    const apps = [
        app('firefox.desktop', 'Firefox'),
        app('files.desktop', 'Files'),
        app('nautilus.desktop', 'Nautilus', {keywords: ['files'], lowerKeywords: ['files']}),
        app('text.desktop', 'Text Editor', {genericName: 'Text Editor', lowerGeneric: 'text editor'}),
        app('web.desktop', 'GNOME Web'),
        app('ffx.desktop', 'Ffx'),
    ];
    equal(rankApps(apps, 'firefox', 4)[0].id, 'firefox.desktop');
    const ffx = rankApps(apps, 'ffx', 4);
    equal(ffx[0].id, 'ffx.desktop');
    equal(ffx[1].id, 'firefox.desktop');
    equal(rankApps(apps, 'files', 4)[0].id, 'files.desktop');
    equal(rankApps(apps, 'naut', 4)[0].id, 'nautilus.desktop');
    equal(rankApps(apps, 'web', 1).length, 1);
    equal(rankApps(apps, '', 4).length, 0);
    equal(rankApps(apps, 'fire', 1).length, 1);
}
```

Add a shorter-name tie-break assertion and a running-bonus assertion.

- [ ] **Step 2: Write merge/selection tests**

```js
// extension/tests/unit/merge.test.js
import {equal} from './assert.js';
import {mergeRows, selectionAfter} from '../../src/lib/merge.js';

export function run() {
    const calc = {expression: '1+1', result: '2'};
    const apps = [{kind: 'app', key: 'app:a.desktop', title: 'A'}];
    const files = [{kind: 'file', key: 'file:/tmp/a.txt', title: 'a.txt'}];
    const rows = mergeRows({calc, apps, files}, 6);
    equal(rows.map(r => r.key).join(','), 'calc,app:a.desktop,file:/tmp/a.txt');
    equal(mergeRows({calc, apps, files}, 2).length, 2);
    equal(selectionAfter(rows, 'app:a.desktop'), 1);
    equal(selectionAfter(rows, 'file:gone'), 0);
}
```

- [ ] **Step 3: Run them and watch them fail**

Run: `make test-gjs`
Expected: FAIL — `appScore.js` / `merge.js` not found.

- [ ] **Step 4: Implement apps and rows**

`Apps` builds records from `Shell.AppSystem.get_default().get_installed()` plus running apps, deduplicated by `get_id()`. For desktop info use `GioUnix.DesktopAppInfo` (`import GioUnix from 'gi://GioUnix'`) for `get_generic_name()` and `get_keywords()`, guarded by `instanceof`. `gridApps()` keeps only `app.should_show()` records and sorts by `name.localeCompare()`. Connect `installed-changed` and `app-state-changed` to refresh; disconnect on destroy.

Scores: exact name 1000; name prefix 800; word-boundary prefix 600; substring 400; subsequence 200; keyword/generic substring 100; +20 running. Tie-break shorter name, then `localeCompare`.

Rows: `appRow(record)` maps a record to `{kind: 'app', key: 'app:' + id, title: name, subtitle: genericName || id, app, icon: app.get_icon()}`. `calcRow` maps a daemon calc result to `{kind: 'calc', key: 'calc', title: result, subtitle: expression, result}`. `mergeRows` treats absent `calc`/`apps`/`files` as absent/empty, prepends `calcRow(calc)` when present, then appends the app rows and file rows in that order, and slices to `maxRows`. The overlay calls `Apps.search(query, Math.min(4, maxRows))` so apps never exceed four rows, and renders app matches synchronously on every text change before the 40 ms daemon debounce. Apps render `row.icon` into a reused `St.Icon` (`gicon`). Each row is a reactive `St.Button`; a click activates it and stops button-press propagation so the overlay's click-outside handler does not close first. Enter activates; Ctrl+Enter calls `app.open_new_window(-1)` when `can_open_new_window()`, else activates; both close the overlay. Default selection = first row; after a rows update keep `selectionAfter(rows, oldKey)`.

- [ ] **Step 5: Extend headless and run**

Add `import Shell from 'gi://Shell';` to the top of `headless.js`, then:

```js
const installed = Shell.AppSystem.get_default().get_installed();
const target = installed.find(a => a.get_name().length >= 4 &&
    installed.filter(b => b.get_name() === a.get_name()).length === 1);
assert(target !== undefined, 'installed apps available');
api.overlay.open();
api.overlay.entry.set_text(target.get_name());
await Scripting.waitLeisure();
assert(api.overlay.rowCount > 0, 'app results render');
assert(api.overlay.rows[0].title === target.get_name(), 'exact app name ranks first');

api.settings.set_int('max-results', 4);
await Scripting.waitLeisure();
assert(api.overlay.maxRows === 4 && api.overlay.rowCount <= 4,
    'max-results applies live without reopening');
api.settings.set_int('max-results', 6);
```

Expected: `make test-gjs` and `make test-shell` pass.

- [ ] **Step 6: Commit**

```bash
git add extension/src extension/tests tools/test/headless.js
git commit -m "feat: add application search and result rows"
```

---

### Task 9: App grid view

**Files:**
- Create: `extension/src/lib/gridMath.js`, `extension/tests/unit/gridMath.test.js`
- Create: `extension/src/appGrid.js`
- Modify: `extension/src/overlay.js`, `extension/extension.js`, `extension/stylesheet.css`, `tools/test/headless.js`
- Test: `extension/tests/unit/gridMath.test.js`, `tools/test/headless.js`

**Interfaces:**
- Produces: `export function gridLayout(width, height, iconSize, itemCount) -> {columns, rows, pages, pageSize}`.
- Produces: `export function indexToCell(index, columns, rows) -> {page, cell}`, `cellToIndex(page, cell, columns, rows) -> number`, `moveSelection(current, dx, dy, count, columns) -> number`, `pageSelection(current, direction, count, columns, rows) -> number`.
- Produces: `export class AppGrid` with `constructor({apps, iconSize, onActivate})` (the constructor receives the `Apps` service; `setApps` receives `gridApps()` records; `onActivate(record, {newWindow})` is called on launch), `open()`, `close()`, `setIconSize(size)`, `setApps(records)`, `moveSelection(dx, dy)`, `page(direction)`, `select(index)`, `activateSelected({newWindow})`, `destroy()`, getters `itemCount`, `selectedIndex`, `iconSize`.

- [ ] **Step 1: Write grid math tests**

```js
// extension/tests/unit/gridMath.test.js
import {equal} from './assert.js';
import {gridLayout, indexToCell, cellToIndex, moveSelection, pageSelection} from '../../src/lib/gridMath.js';

export function run() {
    const wide = gridLayout(1000, 600, 96, 100);
    equal(wide.columns, 8);
    equal(wide.rows, 4);
    equal(wide.pageSize, 32);
    equal(wide.pages, 4);

    const small = gridLayout(400, 400, 96, 100);
    equal(small.columns, 4);
    equal(small.rows, 3);
    equal(small.pages, 9);

    const dense = gridLayout(4000, 4000, 48, 100);
    equal(dense.columns, 10);
    equal(dense.rows, 6);
    equal(dense.pageSize, 60);
    equal(dense.pages, 2);

    equal(indexToCell(24, 6, 4).page, 1);
    equal(indexToCell(24, 6, 4).cell, 0);
    equal(cellToIndex(2, 3, 6, 4), 51);
    equal(moveSelection(5, 1, 0, 100, 6), 5);
    equal(moveSelection(99, 0, 1, 100, 6), 99);
    equal(pageSelection(0, -1, 100, 6, 4), 0);
    equal(pageSelection(0, 1, 100, 6, 4), 24);
}
```

`gridLayout` uses page padding 24, spacing 12, and a 28 px indicator strip; `columns` clamps to 4–10 and `rows` to 2–6, then `pages = max(1, ceil(itemCount / pageSize))`. It receives the scroll view's available width and height (the grid panel minus the 60 px entry and any padding), not the whole panel. `moveSelection` clamps at the grid edges; `pageSelection` keeps the same in-page cell when possible.

- [ ] **Step 2: Run and watch it fail**

Run: `make test-gjs`
Expected: FAIL — `gridMath.js` not found.

- [ ] **Step 3: Implement the grid**

`AppGrid` layout:

```text
AppGrid (St.BoxLayout, vertical)
├── St.ScrollView (hscrollbar EXTERNAL, vscrollbar NEVER, x/y expand)
│   └── IconGrid.IconGrid (horizontal, fixed icon size, page padding 24, spacing 12)
└── PageIndicators.PageIndicators (28 px strip)
```

On open: if dirty or empty, create `AppDisplay.AppIcon(record.app, {isDraggable: false})` actors in idle chunks of 30, set `can_focus = false`, and shadow `tile.popupMenu = () => {}` so v1 has no context menus. Construct the grid with `new IconGrid.IconGrid({allow_incomplete_pages: true})` so the last page keeps its natural order, then `grid.setGridModes([{rows, columns}])`, `grid.layout_manager.fixed_icon_size = iconSize`, `grid.connect('pages-changed', ...)` and `PageIndicators.setNPages/setCurrentPosition`; after `setNPages`, iterate `indicators.get_children()` and set each dot's `accessible_name` to `Page N`. First tile `setForcedHighlight(true)` on open. `goToPage(page, animate)` with animation off when `animations` is false. Rebuild only after `installed-changed` while the grid is closed. `SiftOverlay.destroy()` calls `appGrid.destroy()`; `close()` clears the forced highlight and keeps the cached actors.

Overlay: the entry's grid button opens the grid from search and returns to search from the grid (clearing the query when entering the grid). View switch clears the query, resizes in one 150 ms ease (0 ms when animations off), stops entry text propagation while keeping focus, and dispatches `grid-*` actions to `AppGrid`. `grid-first`/`grid-last` call `select(0)`/`select(itemCount - 1)`; `grid-page-*` call `page(±1)`. Handles the `search-type` action by switching to search before returning `EVENT_PROPAGATE`.

- [ ] **Step 4: Extend headless**

```js
api.overlay.open();
api.overlay.entry.set_text('fire');
api.overlay.showApps();
await Scripting.waitLeisure();
assert(api.overlay.view === 'grid', 'grid view is active');
assert(api.overlay.entry.text === '', 'entering grid clears query');
assert(api.appGrid.iconSize === 96, 'default icon size');

api.overlay.entry.set_text('t');
await Scripting.waitLeisure();
assert(api.overlay.view === 'search' && api.overlay.entry.text === 't', 'typing returns to search');

api.settings.set_int('grid-icon-size', 64);
await Scripting.waitLeisure();
assert(api.appGrid.iconSize === 64, 'icon size applies live');
```

Add: wait until `api.appGrid.itemCount > 0` (loop with `Scripting.sleep(20)`, max 2 s), `showApps()` opens the grid, Escape closes from grid, and Super+A routing is covered by the `show(APP_GRID)` test in Task 7.

- [ ] **Step 5: Run**

Run: `make test-gjs && make test-shell`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add extension/src extension/tests extension/stylesheet.css extension/extension.js tools/test/headless.js
git commit -m "feat: add lazy paged app grid"
```

---

## M2 — Daemon and search

### Task 10: Rust crate, config, and Makefile wiring

**Files:**
- Create: `daemon/Cargo.toml`, `daemon/src/main.rs`, `daemon/src/config.rs`
- Modify: `Makefile`, `.gitignore`
- Test: `daemon/src/config.rs` (`#[cfg(test)] mod tests`)

**Interfaces:**
- Produces: `Config { roots: Vec<PathBuf>, exclude_dirs: Vec<String>, max_entries: usize }`, `Config::load(path: &Path, home: &Path) -> Result<Config, ConfigError>`, `Config::load_str(text: &str, home: &Path) -> Result<Config, ConfigError>`, `Config::fingerprint(&self) -> u64`, `default_config(home: &Path) -> Config`, `config_path() -> PathBuf`.
- Produces: `make test-rust`, `make build` now also builds `target/release/siftd`.

- [ ] **Step 1: Write config tests**

Add these under `#[cfg(test)] mod tests` in `daemon/src/config.rs`:

```rust
#[test]
fn defaults_match_the_design() {
    let cfg = default_config(Path::new("/home/alice"));
    assert_eq!(cfg.roots, vec![PathBuf::from("/home/alice")]);
    assert_eq!(cfg.max_entries, 250_000);
    assert!(cfg.exclude_dirs.contains(&"node_modules".to_string()));
    assert!(cfg.exclude_dirs.contains(&".local/share/Trash".to_string()));
}

#[test]
fn tilde_and_relative_roots_expand_against_home() {
    let cfg = Config::load_str("roots = [\"~\", \"Documents\"]\n", Path::new("/home/alice")).unwrap();
    assert_eq!(cfg.roots, vec![PathBuf::from("/home/alice"), PathBuf::from("/home/alice/Documents")]);
}

#[test]
fn invalid_toml_is_an_error() {
    assert!(Config::load_str("roots = [", Path::new("/home/alice")).is_err());
}

#[test]
fn fingerprint_changes_with_roots_and_excludes() {
    let a = default_config(Path::new("/home/alice"));
    let mut b = a.clone();
    b.roots.push(PathBuf::from("/data"));
    assert_ne!(a.fingerprint(), b.fingerprint());
}
```

- [ ] **Step 2: Run and watch it fail**

Run: `cargo test --manifest-path daemon/Cargo.toml`
Expected: FAIL — crate does not exist.

- [ ] **Step 3: Create the crate and config**

`Cargo.toml` dependencies: `fend-core = "1.5.9"`, `ignore = "0.4.34"`, `nucleo-matcher = "0.3.1"`, `notify = "8.2.2"`, `serde = { version = "1", features = ["derive"] }`, `serde_json = "1"`, `toml = "1.1"`, `zbus = { version = "6.2.1", default-features = false, features = ["tokio", "tokio-multithread", "proxy", "service"] }`, `tokio = { version = "1", features = ["macros", "rt-multi-thread", "signal"] }`; dev: `tempfile = "3"`. `edition = "2024"`, `license = "GPL-3.0-or-later"`, `rust-version = "1.99"`. Commit `Cargo.lock`.

`Config` uses `#[serde(default)]`. Missing file → defaults; malformed file → `Err`; the daemon logs and falls back to defaults on startup, while `Reindex` keeps the last good config on error. `~`/relative expansion happens in `load_str`/`load`. Fingerprint is a stable FNV-1a over roots, excludes, max_entries, and a cache-format constant.

`main.rs` for now prints `siftd 0.1.0` for `--version` and exits and declares `mod config;`; D-Bus arrives in Task 15. Add `daemon/target/` to `.gitignore`.

- [ ] **Step 4: Wire Makefile**

```make
test-rust:
	dbus-run-session -- cargo test --manifest-path daemon/Cargo.toml

test: test-gjs test-schema test-rust lint

build: daemon extension
daemon:
	cargo build --release --manifest-path daemon/Cargo.toml
extension:
	mkdir -p dist
	gnome-extensions pack extension --schema=$(SCHEMA) -o dist --force
```

- [ ] **Step 5: Run**

Run: `make test-rust`
Expected: all config tests pass.

- [ ] **Step 6: Commit**

```bash
git add daemon Makefile .gitignore
git commit -m "feat: add siftd config and crate scaffolding"
```

---

### Task 11: Home walker and filters

**Files:**
- Create: `daemon/src/index.rs`
- Test: `daemon/src/index.rs` (`#[cfg(test)] mod tests`)

**Interfaces:**
- Produces: `Entry { path: PathBuf, name_lower: String, kind: EntryKind }`, `EntryKind::{File, Dir}`; derive `Debug, Clone, PartialEq, Eq` so cache round-trip tests can compare them.
- Produces: `ScanResult { entries: Vec<Entry>, truncated: bool }`, `scan(config: &Config, cancel: &AtomicBool, progress: &AtomicUsize) -> ScanResult`.
- Produces: `Index { state: RwLock<IndexState> }`, `IndexState { entries: Vec<Entry>, truncated: bool }` with `new(entries, truncated)`, `read() -> RwLockReadGuard<IndexState>`, `replace(entries, truncated)`, `len()`; Task 17 adds `apply_batch` and `has_path`.
- Produces: `is_excluded(relative: &Path, patterns: &[String]) -> bool`.

- [ ] **Step 1: Write walker tests**

```rust
#[test]
fn skips_hidden_excluded_symlinks_and_caps() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path().join("visible.txt"));
    write(dir.path().join(".hidden"));
    write(dir.path().join("node_modules/pkg.js"));
    write(dir.path().join("deep/.git/config"));
    std::os::unix::fs::symlink(dir.path().join("visible.txt"), dir.path().join("link.txt")).unwrap();

    let cfg = default_config(dir.path());
    let found = scan(&cfg, &AtomicBool::new(false), &AtomicUsize::new(0));
    let names: Vec<_> = found.entries.iter().map(|e| e.name_lower.as_str()).collect();
    assert!(names.contains(&"visible.txt"));
    assert!(!names.contains(&".hidden"));
    assert!(!names.contains(&"pkg.js"));
    assert!(!names.contains(&"config"));
    assert!(!names.contains(&"link.txt"));

    let mut capped = cfg.clone();
    capped.max_entries = 1;
    let found = scan(&capped, &AtomicBool::new(false), &AtomicUsize::new(0));
    assert_eq!(found.entries.len(), 1);
    assert!(found.truncated);
}

#[test]
fn lowercases_unicode_names() {
    let dir = tempfile::tempdir().unwrap();
    write(dir.path().join("Ärger.TXT"));
    let found = scan(&default_config(dir.path()), &AtomicBool::new(false), &AtomicUsize::new(0));
    assert!(found.entries.iter().any(|e| e.name_lower == "ärger.txt"));
}
```

- [ ] **Step 2: Run and watch it fail**

Run: `make test-rust`
Expected: FAIL — `scan` not found.

- [ ] **Step 3: Implement the walker**

`ignore::WalkBuilder` with `.hidden(true)` (skip hidden), `.ignore(false)`, `.git_ignore(false)`, `.git_global(false)`, `.git_exclude(false)`, `.follow_links(false)`, `.same_file_system(true)`, `.threads(4)`, `.filter_entry(...)` for excludes. Skip the root entry itself (`depth == 0`) and any entry whose `file_type()` is a symlink; `follow_links(false)` still yields the link entry. Include regular files and directories. Lowercase with `to_lowercase()`.

Use `build_parallel().run(...)`: each thread locks a `Mutex<Vec<Entry>>`, increments an `AtomicUsize` progress, returns `WalkState::Quit` when `cancel` is set or the cap is reached. If a thread quits at the cap, set `truncated = true`; after the walk, truncate the vector to `max_entries` so parallel overshoot cannot exceed the cap. Sort entries by `path` before returning so the cache and tests are deterministic. Also add the `Index` wrapper here: `IndexState` holds the vector and flag, `new`/`replace` swap both under one write lock, `read` returns the guard, `len` reads it. Task 17 grows this type rather than introducing it.

`write(path)` in the tests creates parent directories and the file; define it once in the test module.

- [ ] **Step 4: Run**

Run: `make test-rust`
Expected: walker tests pass.

- [ ] **Step 5: Commit**

```bash
git add daemon/src/index.rs daemon/src/config.rs daemon/src/main.rs
git commit -m "feat: walk the home directory with filters and a cap"
```

---

### Task 12: Versioned cache

**Files:**
- Create: `daemon/src/cache.rs`
- Test: `daemon/src/cache.rs` (`#[cfg(test)] mod tests`)

**Interfaces:**
- Consumes: `Entry`, `EntryKind` from Task 11.
- Produces: `CachedIndex { entries: Vec<Entry>, truncated: bool }`, `load(path: &Path, fingerprint: u64) -> Option<CachedIndex>`, `store(path: &Path, fingerprint: u64, entries: &[Entry], truncated: bool) -> io::Result<()>`.
- Cache path: `$XDG_CACHE_HOME/sift/index-v1.bin` (fallback `$HOME/.cache/sift/index-v1.bin`), file 0600, directory 0700.

- [ ] **Step 1: Write cache tests**

```rust
#[test]
fn round_trips_entries_and_truncation() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("index-v1.bin");
    let entries = vec![entry("/home/a/File.txt", EntryKind::File), entry("/home/a/dir", EntryKind::Dir)];
    store(&path, 42, &entries, true).unwrap();
    let loaded = load(&path, 42).unwrap();
    assert_eq!(loaded.entries, entries);
    assert!(loaded.truncated);
    assert_eq!(std::fs::metadata(&path).unwrap().permissions().mode() & 0o777, 0o600);
}

#[test]
fn fingerprint_and_version_mismatches_are_ignored() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("index-v1.bin");
    store(&path, 1, &[], false).unwrap();
    assert!(load(&path, 2).is_none());
    let mut bytes = std::fs::read(&path).unwrap();
    bytes[8..12].copy_from_slice(&99u32.to_le_bytes());
    std::fs::write(&path, bytes).unwrap();
    assert!(load(&path, 1).is_none());
}

#[test]
fn corrupt_or_missing_cache_is_none() {
    let dir = tempfile::tempdir().unwrap();
    assert!(load(&dir.path().join("missing"), 1).is_none());
    let path = dir.path().join("index-v1.bin");
    std::fs::write(&path, b"junk").unwrap();
    assert!(load(&path, 1).is_none());
}
```

- [ ] **Step 2: Run and watch it fail**

Run: `make test-rust`
Expected: FAIL — `load` not found.

- [ ] **Step 3: Implement the format**

Header: 8-byte magic `SIFTIDX1`, `u32` version 1, `u64` fingerprint, `u64` count, `u8` truncated. Then per entry: `u8` kind, `u32` path-byte length, path bytes. Lowercase names are derived on load from the basename. Reject count > 10,000,000, path lengths > 4096, unknown kinds, and trailing bytes. Write to `index-v1.bin.tmp`, `sync_all`, rename; create the cache directory with mode 0700 and the file with mode 0600. Any read/parse error is `None`; write errors propagate to the caller for logging.

- [ ] **Step 4: Run**

Run: `make test-rust`
Expected: cache tests pass.

- [ ] **Step 5: Commit**

```bash
git add daemon/src/cache.rs daemon/src/main.rs
git commit -m "feat: add versioned index cache"
```

---

### Task 13: Fuzzy query

**Files:**
- Create: `daemon/src/query.rs`
- Test: `daemon/src/query.rs` (`#[cfg(test)] mod tests`)

**Interfaces:**
- Consumes: `Entry`, `EntryKind`.
- Produces: `Match { path: PathBuf, name: String, kind: EntryKind, score: u32 }`, `query(entries: &[Entry], text: &str, limit: usize) -> Vec<Match>`.

- [ ] **Step 1: Write query tests**

```rust
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
        .map(|i| entry(&format!("/h/file-{i:06}.txt"), EntryKind::File))
        .collect();
    let got = query(&entries, "file-249999", 10);
    assert_eq!(got.len(), 1);
    assert_eq!(got[0].name, "file-249999.txt");
}
```

Add a test where two entries have the same score: the shorter name wins, then the shallower path.

- [ ] **Step 2: Run and watch it fail**

Run: `make test-rust`
Expected: FAIL — `query` not found.

- [ ] **Step 3: Implement**

Trim; if empty return `vec![]`. Clamp `limit` to `1..=50`. Lowercase query once. Cheap `is_subsequence` prefilter over `name_lower`. Then `nucleo_matcher::Pattern::parse(text, CaseMatching::Ignore, Normalization::Smart)` and `pattern.score(Utf32Str::new(&entry.name_lower, &mut buf), &mut matcher)`; reuse one `Matcher`. Sort by score desc, `name_lower.len()` asc, path component count asc, path asc. Return the top K.

- [ ] **Step 4: Run**

Run: `make test-rust`
Expected: query tests pass.

- [ ] **Step 5: Commit**

```bash
git add daemon/src/query.rs daemon/src/main.rs
git commit -m "feat: rank filename matches with nucleo"
```

---

### Task 14: Calculator

**Files:**
- Create: `daemon/src/calc.rs`
- Test: `daemon/src/calc.rs` (`#[cfg(test)] mod tests`)

**Interfaces:**
- Produces: `CalcResult { expression: String, result: String }`, `evaluate(input: &str, deadline: Duration) -> Option<CalcResult>`, `looks_like_calculation(input: &str) -> bool`.

- [ ] **Step 1: Write calculator tests**

```rust
#[test]
fn evaluates_arithmetic_and_units() {
    assert_eq!(evaluate("1+1", Duration::from_millis(25)).unwrap().result, "2");
    assert_eq!(evaluate("1 km to m", Duration::from_millis(25)).unwrap().result, "1000 m");
    assert_eq!(evaluate("2 hours in minutes", Duration::from_millis(25)).unwrap().result, "120 minutes");
}

#[test]
fn rejects_plain_numbers_and_non_calculations() {
    assert!(evaluate("42", Duration::from_millis(25)).is_none());
    assert!(evaluate("firefox", Duration::from_millis(25)).is_none());
    assert!(evaluate("1+", Duration::from_millis(25)).is_none());
    assert!(evaluate("", Duration::from_millis(25)).is_none());
}

#[test]
fn strips_a_leading_equals_and_rejects_currency() {
    assert_eq!(evaluate("= 3*7", Duration::from_millis(25)).unwrap().result, "21");
    assert!(evaluate("10 USD to EUR", Duration::from_millis(25)).is_none());
}

#[test]
fn enforces_the_input_cap_and_deadline_type() {
    assert!(evaluate(&"1+".repeat(300), Duration::from_millis(25)).is_none());
    let deadline = Deadline::new(Duration::ZERO);
    assert!(deadline.should_interrupt());
}
```

- [ ] **Step 2: Run and watch it fail**

Run: `make test-rust`
Expected: FAIL — `evaluate` not found.

- [ ] **Step 3: Implement**

`looks_like_calculation`: trim; true if it starts with `=`, or contains an ASCII alphabetic character (`[a-zA-Z]`) or one of `+-*/^%()`. Cap input at 512 bytes. Strip one leading `=` for evaluation. Fresh `Context` per call. `Deadline { end: Instant }` implements `fend_core::Interrupt`; `should_interrupt()` is `Instant::now() >= self.end`. Evaluate with `evaluate_with_interrupt`; return `None` on error, empty result, or `result.trim() == expression.trim()`. `expression` is the trimmed original input.

- [ ] **Step 4: Run**

Run: `make test-rust`
Expected: calculator tests pass.

- [ ] **Step 5: Commit**

```bash
git add daemon/src/calc.rs daemon/src/main.rs
git commit -m "feat: evaluate calculator expressions with fend"
```

---

### Task 15: Status model and D-Bus interface

**Files:**
- Create: `daemon/src/status.rs`, `daemon/src/dbus.rs`
- Test: `daemon/src/status.rs`, `daemon/src/dbus.rs` (`#[cfg(test)] mod tests`)

**Interfaces:**
- Produces: `Status { state: String, indexed: usize, roots: Vec<String>, truncated: bool, watcher: String, last_reconcile: u64 }`, `StatusModel::new(roots) -> Arc<StatusModel>`, `snapshot() -> Status`, `to_json() -> String`, `update(f: impl FnOnce(&mut Status)) -> bool` (true when the JSON changed), and a `tokio::sync::broadcast` receiver for signals.
- Produces: `SiftService` with D-Bus methods `Ping -> s`, `Query(s,u) -> s`, `Reindex`, `EnsureFresh`, `Quit`, property `Status -> s`, signal `StatusChanged(s)`.
- Produces: `pub fn validate_query(text: &str, limit: u32) -> Result<(), QueryError>` (raw byte length ≤ 128, limit 1–50).
- Produces: `Command::{Reindex, EnsureFresh, Quit(tokio::sync::oneshot::Sender<()>)}`, sent on an unbounded channel.
- Produces: `pub const BUS_NAME`, `OBJECT_PATH`, `INTERFACE`, `pub fn version() -> String`.

- [ ] **Step 1: Write status and validation tests**

```rust
#[test]
fn status_json_shape() {
    let model = StatusModel::new(vec!["/home/alice".into()]);
    let json: serde_json::Value = serde_json::from_str(&model.to_json()).unwrap();
    assert_eq!(json["state"], "starting");
    assert_eq!(json["indexed"], 0);
    assert_eq!(json["roots"][0], "/home/alice");
    assert_eq!(json["truncated"], false);
    assert_eq!(json["watcher"], "ok");
    assert_eq!(json["last_reconcile"], 0);
}

#[test]
fn update_reports_change() {
    let model = StatusModel::new(vec![]);
    assert!(model.update(|s| s.state = "indexing".into()));
    assert!(!model.update(|s| s.state = "indexing".into()));
}

#[test]
fn query_validation() {
    assert!(validate_query(&"x".repeat(129), 10).is_err());
    assert!(validate_query("x", 0).is_err());
    assert!(validate_query("x", 51).is_err());
    assert!(validate_query("x", 10).is_ok());
}
```

- [ ] **Step 2: Run and watch it fail**

Run: `make test-rust`
Expected: FAIL — modules missing.

- [ ] **Step 3: Implement**

`StatusModel` holds `RwLock<Status>` and a `broadcast::Sender<String>` (JSON). `update` compares JSON before sending. `SiftService` holds `Arc<Index>`, `Arc<StatusModel>`, `Arc<RwLock<Config>>`, and the command sender.

Use `#[zbus::interface(name = "io.github.alphabeast97.Sift")]`. `Query` calls `validate_query` for raw byte length ≤ 128 and limit 1..=50; on error return `zbus::fdo::Error::InvalidArgs`. It builds `{"files":[{"path","name","kind"}...],"calc":...}` with `files` from `query()` and `calc` omitted when `None`. `Status` property returns `model.to_json()`. `Reindex`/`EnsureFresh` send commands and return immediately. `Quit` creates a oneshot, sends `Command::Quit(tx)`, and awaits the ack with a 2 s timeout so the cache is flushed before the reply. `Ping` returns `version()` (`CARGO_PKG_VERSION` + `+` + `SIFT_GIT_HASH` or `unknown`).

- [ ] **Step 4: Run**

Run: `make test-rust`
Expected: status and validation tests pass.

- [ ] **Step 5: Commit**

```bash
git add daemon/src/status.rs daemon/src/dbus.rs daemon/src/main.rs
git commit -m "feat: add sift dbus interface and status model"
```

---

### Task 16: Daemon lifecycle, cache, and integration tests

**Files:**
- Create: `daemon/src/manager.rs`
- Create: `daemon/tests/dbus.rs`
- Create: `packaging/io.github.alphabeast97.Sift.service.in`
- Modify: `daemon/src/main.rs`, `Makefile`
- Test: `daemon/tests/dbus.rs`

**Interfaces:**
- Produces: `spawn_manager(config_path: PathBuf, initial: Config, cache_path: PathBuf, index: Arc<Index>, status: Arc<StatusModel>, commands: UnboundedReceiver<Command>) -> JoinHandle<()>`.
- Consumes: `Index::new`, `Index::read`, `Index::replace`, `Index::len` from Task 11; Task 17 adds `apply_batch`.
- Produces: daemon args `--config PATH`, `--cache PATH`, `--scan-delay-ms N` (test-only), `--version`.

- [ ] **Step 1: Write the D-Bus integration test**

```rust
#[tokio::test]
async fn cold_start_query_reindex_quit_and_second_instance() {
    let tmp = tempfile::tempdir().unwrap();
    let home = tmp.path().join("home");
    std::fs::create_dir_all(home.join("docs")).unwrap();
    std::fs::write(home.join("docs/report.pdf"), b"x").unwrap();
    let config = tmp.path().join("config.toml");
    std::fs::write(&config, format!("roots = [\"{}\"]\n", home.display())).unwrap();
    let cache = tmp.path().join("cache.bin");

    let mut child = spawn_daemon(&config, &cache, &["--scan-delay-ms", "1000"]);
    let proxy = wait_for_proxy().await;
    wait_for_status(&proxy, "\"state\":\"indexing\"").await;
    let ping: String = proxy.call("Ping", &()).await.unwrap();
    assert!(ping.starts_with("0.1.0"));

    let cold: String = proxy.call("Query", &("report", 10u32)).await.unwrap();
    assert!(cold.contains("\"files\":[]"), "cold start answers without a cache");

    let invalid = proxy.call::<_, _, String>("Query", &("x".repeat(129), 10u32)).await;
    assert!(invalid.is_err(), "over-long queries are rejected");
    let bad_limit = proxy.call::<_, _, String>("Query", &("report", 0u32)).await;
    assert!(bad_limit.is_err(), "limit 0 is rejected");

    wait_for_status(&proxy, "\"state\":\"ready\"").await;
    let warm: String = proxy.call("Query", &("report", 10u32)).await.unwrap();
    assert!(warm.contains("report.pdf"));
    assert!(cache.exists(), "ready scan writes the cache");
    let json: serde_json::Value = serde_json::from_str(&warm).unwrap();
    assert!(json["files"].is_array(), "files is an array");
    assert!(json.get("calc").is_none(), "calc is omitted when absent");
    let _: () = proxy.call("EnsureFresh", &()).await.unwrap();

    let mut second = spawn_daemon(&config, &cache, &[]);
    assert!(wait_for_exit(&mut second, Duration::from_secs(2)).await,
        "second instance exits when the bus name is taken");

    std::fs::write(&config, "roots = []\n").unwrap();
    let _: () = proxy.call("Reindex", &()).await.unwrap();
    let during: String = proxy.call("Query", &("report", 10u32)).await.unwrap();
    assert!(during.contains("report.pdf"), "rebuild keeps the previous snapshot");
    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    loop {
        let reply: String = proxy.call("Query", &("report", 10u32)).await.unwrap();
        if reply.contains("\"files\":[]")
            break;
        assert!(tokio::time::Instant::now() < deadline, "reindex never emptied the index");
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    let _: () = proxy.call("Quit", &()).await.unwrap();
    assert!(wait_for_exit(&mut child, Duration::from_secs(2)).await, "Quit exits");
}
```

`spawn_daemon` uses `env!("CARGO_BIN_EXE_siftd")` with `--config`, `--cache`, optional `--scan-delay-ms`. The test is `#[tokio::test]` and uses async `zbus::Connection`/`zbus::Proxy`; `Proxy::call` returns the deserialized reply directly, so there is no `.body()`. Add `tokio` to `[dev-dependencies]` with the `macros`, `rt`, and `time` features. Helpers: `wait_for_proxy().await` opens the session connection, builds the proxy with `zbus::Proxy::new(...).await`, and polls `NameHasOwner`; `wait_for_status(&proxy, ...).await` polls `proxy.get_property::<String>("Status").await` for a JSON substring; `wait_for_exit(&mut child, ...).await` polls `try_wait` (no extra dependency). The whole suite runs under `dbus-run-session` via `make test-rust`.

- [ ] **Step 2: Run and watch it fail**

Run: `make test-rust`
Expected: FAIL — `siftd` binary or `spawn_manager` missing.

- [ ] **Step 3: Implement lifecycle**

Startup order: read config (defaults on error), load cache (empty on error), create `Index`/`StatusModel`, build the zbus session connection with `.name(BUS_NAME)?.serve_at(OBJECT_PATH, service)?.build()`. If `build()` fails with `zbus::Error::NameTaken`, log and exit 0; other errors are fatal. Spawn `spawn_manager`, passing both the initial config and its path (so `Reindex` re-reads the file); spawn a signal task that reads the broadcast receiver and calls `connection.emit_signal(None::<&str>, OBJECT_PATH, INTERFACE, "StatusChanged", &(json,))`; emit at most twice per second by throttling in the model/task.

`spawn_manager`:

1. Set `status.state = "indexing"` and spawn a `spawn_blocking` full scan; while it runs, a 500 ms ticker updates `indexed` from the progress atomic and emits at most twice per second.
2. On completion, `index.replace(entries)`, `status.indexed`, `truncated`, `state = ready` (or `degraded` if the watcher is unavailable), `last_reconcile = now`, write the cache.
3. Handle commands: `Reindex` re-reads config from `config_path`, keeps the old config on error, no-ops while scanning; `EnsureFresh` rebuilds only when not scanning and `last_reconcile` is older than 10 minutes; `Quit` cancels the scan, flushes the cache if dirty, sends the oneshot ack, waits one 50 ms tick so the method reply is written, drops the connection, and exits.
4. On cache load, queries answer immediately; a cold start is empty until the first scan. During a rebuild the previous entries remain live.

Service file template:

```ini
[D-BUS Service]
Name=io.github.alphabeast97.Sift
Exec=@BINDIR@/siftd
```

- [ ] **Step 4: Run**

Run: `make test-rust`
Expected: integration tests pass, including `Quit` flush and second-instance exit.

- [ ] **Step 5: Commit**

```bash
git add daemon packaging Makefile
git commit -m "feat: serve the daemon over dbus with lifecycle commands"
```

---

### Task 17: Watcher and incremental updates

**Files:**
- Create: `daemon/src/watcher.rs`
- Modify: `daemon/src/manager.rs`
- Test: `daemon/src/index.rs` (`apply_batch` tests), `daemon/src/watcher.rs` (failure test)

**Interfaces:**
- Produces: `Index::apply_batch(&self, config: &Config, paths: &[PathBuf]) -> bool` (true if changed), sorted and deduplicated.
- Produces: `Index::has_path(&self, path: &Path) -> bool` (binary search over the sorted entries).
- Produces: `enum WatcherEvent { Changed(Vec<PathBuf>), Failed }` and `spawn_watcher(roots, tx: UnboundedSender<WatcherEvent>) -> notify::Result<RecommendedWatcher>`; the watcher task debounces events 500 ms into one `Changed` batch, and sends `Failed` for a runtime notify error.

- [ ] **Step 1: Write incremental tests**

```rust
#[test]
fn apply_batch_adds_removes_and_renames() {
    let dir = tempfile::tempdir().unwrap();
    let old = dir.path().join("old");
    let new = dir.path().join("new");
    std::fs::create_dir(&old).unwrap();
    std::fs::write(old.join("a.txt"), b"x").unwrap();
    let cfg = default_config(dir.path());
    let index = Index::new(vec![], false);
    index.apply_batch(&cfg, &[old.clone()]);
    assert!(index.has_path(&old.join("a.txt")));

    std::fs::rename(&old, &new).unwrap();
    index.apply_batch(&cfg, &[old.clone(), new.clone()]);
    assert!(!index.has_path(&old.join("a.txt")));
    assert!(index.has_path(&new.join("a.txt")));

    std::fs::remove_dir_all(&new).unwrap();
    index.apply_batch(&cfg, &[new.clone()]);
    assert_eq!(index.len(), 0);
}

#[test]
fn apply_batch_ignores_hidden_excluded_and_duplicates() {
    let dir = tempfile::tempdir().unwrap();
    std::fs::write(dir.path().join(".secret"), b"x").unwrap();
    std::fs::write(dir.path().join("ok.txt"), b"x").unwrap();
    let cfg = default_config(dir.path());
    let index = Index::new(vec![], false);
    assert!(index.apply_batch(&cfg, &[dir.path().join("ok.txt"), dir.path().join("ok.txt")]));
    assert!(!index.apply_batch(&cfg, &[dir.path().join("ok.txt")]));
    index.apply_batch(&cfg, &[dir.path().join(".secret")]);
    assert_eq!(index.len(), 1);
}
```

- [ ] **Step 2: Run and watch it fail**

Run: `make test-rust`
Expected: FAIL — `apply_batch` not found.

- [ ] **Step 3: Implement**

Start `notify::recommended_watcher` after the first complete scan; watch each existing root recursively. An initial watch failure is returned as `Err`; the manager logs once, sets `status.watcher = "unavailable"` and `state = "degraded"`, and leaves the index usable. The watcher task collects event paths into a `HashSet<PathBuf>`; after the first event, sleep 500 ms, drain the channel with `try_recv`, send one `WatcherEvent::Changed(paths)`, and send `WatcherEvent::Failed` when a callback yields `Err` (the manager applies the same degraded status). The manager consumes `Changed` and calls `apply_batch` under one write lock. No event → no timer.

`apply_batch`: sort/dedupe paths; for each, if it still exists, add the file or walk the subtree with the same filters and cap; if it does not, remove it and every descendant. Enforce `config.max_entries` across the whole index (stop adding and set `truncated` at the cap). Keep `Vec<Entry>` sorted by path and use binary search for dedupe. On a change, mark the cache dirty; a 30 s one-shot timer while dirty stores the cache and clears the flag (no timer when clean). `Quit` flushes immediately. `EnsureFresh` remains the recovery path when the watcher is unavailable.

- [ ] **Step 4: Run**

Run: `make test-rust`
Expected: incremental tests pass.

- [ ] **Step 5: Commit**

```bash
git add daemon/src/index.rs daemon/src/watcher.rs daemon/src/manager.rs daemon/src/main.rs
git commit -m "feat: keep the index current with inotify"
```

---

### Task 18: Extension daemon proxy, footer, and backoff

**Files:**
- Create: `extension/src/daemon.js`
- Modify: `extension/src/overlay.js`, `extension/src/results.js`, `extension/extension.js`, `tools/test/headless.js`
- Test: `tools/test/headless.js`

**Interfaces:**
- Produces: `export class Daemon` with `enable()`, `disable()`, `query(text, limit) -> Promise<{files, calc}>`, `ensureFresh()`, `reindex()`, `ping()`, getters `available`, `status`, `unavailable`.
- Produces: overlay footer strings and one-shot `service unavailable` behavior.

- [ ] **Step 1: Extend the no-daemon headless test**

`make test-shell` runs with no D-Bus service. Add `import GLib from 'gi://GLib';` to the top of `headless.js`, then assert only when `GLib.getenv('SIFT_E2E') !== '1'` (Task 20 runs the same script with a daemon):

```js
api.overlay.open();
api.overlay.entry.set_text('term');
await Scripting.waitLeisure();
await waitFor(() => api.overlay.rowCount > 0, 'apps still work', 2000);
await waitFor(() => api.overlay.footerText === 'Search service unavailable',
    'footer reports the missing service', 2000);
```

Also assert a second query does not stack another footer/message and does not throw.

- [ ] **Step 2: Run and watch it fail**

Run: `make test-shell`
Expected: FAIL — no footer / daemon module.

- [ ] **Step 3: Implement the proxy**

`Gio.DBusProxy.new_for_bus(Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, interfaceInfo, 'io.github.alphabeast97.Sift', '/io/github/alphabeast97/Sift', 'io.github.alphabeast97.Sift', null, callback)`; use the `Status` cached property, `g-signal` for `StatusChanged`, and `notify::g-name-owner` for availability. Calls use a 500 ms timeout and `reply.deepUnpack()[0]` for strings; parse JSON. On failure set `_retryAt = Date.now() + 5000`; while backoff is active, reject immediately without a bus call. Reset on success. `enable()` calls `Ping` once and logs a version warning once if it differs from `metadata['version-name']`.

Overlay: 40 ms debounce; at most one query in flight; keep only the newest pending query; drop replies whose generation is stale. File queries start at 2 characters. On open, `ensureFresh()` fire-and-forget. Footer precedence: unavailable > degraded/truncated > indexing; otherwise empty.

- [ ] **Step 4: Run**

Run: `make test-shell`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src tools/test/headless.js
git commit -m "feat: connect sift to siftd over dbus"
```

---

### Task 19: File and calculator rows

**Files:**
- Create: `extension/src/files.js`
- Modify: `extension/src/lib/merge.js`, `extension/src/results.js`, `extension/src/overlay.js`
- Test: `extension/tests/unit/merge.test.js` (extend), `tools/test/headless.js` (extend)

**Interfaces:**
- Consumes: `calcRow` and `mergeRows` from Task 8.
- Produces: `fileRow(file, home) -> row|null` in `lib/merge.js`; `home` is needed to abbreviate the subtitle to `~`.
- Produces: `openFile(path)`, `revealFile(path)`, `loadFileIcon(path, iconActor)` in `files.js`.
- Produces: overlay actions for file open/reveal and calc copy.

- [ ] **Step 1: Extend merge tests**

```js
const files = [
    {path: '/home/a/report.pdf', name: 'report.pdf', kind: 'file'},
    {path: '/home/a/docs', name: 'docs', kind: 'dir'},
];
const rows = mergeRows({files: files.map(f => fileRow(f, '/home/a'))}, 6);
equal(rows[0].subtitle, '~');
equal(rows[0].key, 'file:/home/a/report.pdf');
equal(rows[1].kind, 'file');
equal(fileRow({path: 'relative', name: 'x', kind: 'file'}, '/home/a'), null);
equal(fileRow({path: '/a', name: '', kind: 'file'}, '/home/a'), null);
```

Also assert `calcRow({expression: '1+1', result: '2'})` has `key: 'calc'`, `title: '2'`, `subtitle: '1+1'`.

- [ ] **Step 2: Run and watch it fail**

Run: `make test-gjs`
Expected: FAIL — `fileRow` not found.

- [ ] **Step 3: Implement actions and icons**

`fileRow` requires an absolute path, non-empty name, and kind `file` or `dir`; the subtitle is the parent directory with `home` replaced by `~` (Task 25 moves this into `lib/format.js`). The overlay passes `GLib.get_home_dir()`. `loadFileIcon` uses `query_info_async('standard::icon', ...)` with a 256-entry FIFO `Map`, cancelled on destroy. `openFile` uses `Gio.AppInfo.launch_default_for_uri_async`; `revealFile` calls `org.freedesktop.FileManager1.ShowItems` on the session bus and falls back to opening the parent directory. If a path is missing at activation, remove the row and call `reindex()` once after a 500 ms one-shot.

Calc Enter / Ctrl+C copies `result` with `St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, result)` and closes on Enter only. File Ctrl+Enter reveals; app Ctrl+Enter opens a new window.

- [ ] **Step 4: Extend headless**

Start `siftd` for the E2E variant in Task 20; here assert app and calc rows merge in order and selection stays on the same key after a file tail arrives. Use a fake `daemon.query` response injected through the test API if the real daemon is not running.

- [ ] **Step 5: Run**

Run: `make test-gjs && make test-shell`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add extension/src extension/tests tools/test/headless.js
git commit -m "feat: render file and calculator results"
```

---

### Task 20: End-to-end daemon headless test

**Files:**
- Modify: `tools/test/run-shell-test.sh`, `tools/test/headless.js`, `Makefile`
- Create: `tools/test/fixtures/home/Documents/sift-e2e-report.pdf`

**Interfaces:**
- Consumes: `target/release/siftd` and the extension zip.
- Produces: `SIFT_E2E=1 make test-shell` starts the daemon on the private session bus, uses a temp `HOME`, and asserts file + calc rows.

- [ ] **Step 1: Extend the runner**

Replace the final `exec dbus-run-session -- gnome-shell-test-tool ...` with an exported-script wrapper, so the daemon can start on the same private bus before the shell and the cleanup trap still runs:

```bash
export SIFT_ROOT="$root"
export SIFT_ZIP="$root/dist/$uuid.shell-extension.zip"
export SIFT_SCRIPT="$root/tools/test/headless.js"
exec dbus-run-session -- bash -c '
set -euo pipefail
if [ "${SIFT_E2E:-0}" = 1 ]; then
    tmp=$(mktemp -d)
    export HOME="$tmp/home"
    export XDG_CONFIG_HOME="$tmp/config"
    export XDG_CACHE_HOME="$tmp/cache"
    mkdir -p "$HOME" "$XDG_CONFIG_HOME/sift" "$XDG_CACHE_HOME"
    cp -r "$SIFT_ROOT/tools/test/fixtures/home/." "$HOME/"
    printf "roots = [\"%s\"]\n" "$HOME" > "$XDG_CONFIG_HOME/sift/config.toml"
    "$SIFT_ROOT/target/release/siftd" \
        --config "$XDG_CONFIG_HOME/sift/config.toml" \
        --cache "$XDG_CACHE_HOME/sift/index-v1.bin" &
    daemon_pid=$!
    trap "kill $daemon_pid 2>/dev/null || true; rm -rf $tmp" EXIT
    until gdbus call --session --dest org.freedesktop.DBus \
        --object-path /org/freedesktop/DBus \
        --method org.freedesktop.DBus.NameHasOwner \
        io.github.alphabeast97.Sift 2>/dev/null | grep -q true; do
        kill -0 "$daemon_pid"
        sleep 0.02
    done
fi
gnome-shell-test-tool --headless --extension "$SIFT_ZIP" "$SIFT_SCRIPT"
'
```

Do not use `exec` for `gnome-shell-test-tool`; the EXIT trap must kill the daemon and remove the temp home.

- [ ] **Step 2: Extend headless**

```js
if (GLib.getenv('SIFT_E2E') === '1') {
    api.overlay.open();
    api.overlay.entry.set_text('sift-e2e-report');
    await Scripting.waitLeisure();
    await waitFor(() => api.overlay.rows.some(r =>
        r.kind === 'file' && r.title === 'sift-e2e-report.pdf'), 'file result', 3000);

    api.overlay.entry.set_text('1+1');
    await waitFor(() => api.overlay.rows.some(r =>
        r.kind === 'calc' && r.title === '2'), 'calc result', 3000);

    // Rapid typing: the last query owns the rows.
    for (const text of ['s', 'si', 'sif', 'sift'])
        api.overlay.entry.set_text(text);
    await Scripting.sleep(600);
    assert(api.overlay.rows.every(r => r.kind !== 'calc'), 'stale calc reply dropped');
}
```

- [ ] **Step 3: Run**

```bash
make build
SIFT_E2E=1 make test-shell
```

Expected: PASS with both a file row and a calc row; `git diff --exit-code` clean.

- [ ] **Step 4: Commit**

```bash
git add tools/test Makefile
git commit -m "test: cover file and calculator search end to end"
```

---

## M3 — Glass integration

### Task 21: Bounded backdrop clones, blur, and shader

**Files:**
- Replace: `extension/src/glass.js` (Task 6 stub)
- Create: `extension/src/lib/glassParams.js`, `extension/tests/unit/glassParams.test.js`
- Modify: `extension/stylesheet.css`, `extension/src/overlay.js`
- Test: `extension/tests/unit/glassParams.test.js`

**Interfaces:**
- Produces: `export function glassParams({mode, opacity, blurRadius, tint, dark, fallback}) -> {effectiveMode, opacity, blurRadius, tint: [r,g,b], saturation, lens, rim, radius}`; `fallback` defaults to `'liquid'` and is what `auto` resolves to when the caller has already detected that liquid glass failed.
- Produces: `export class GlassPanel` with `attach(panel)`, `setRect(rect)`, `open()`, `close()`, `applySettings()`, `destroy()`, getters `effectiveMode`, `blurRadius`, `rect`, `cloneCount`.
- Consumes: M0 constants from `docs/research/glass-spike.md`.

- [ ] **Step 1: Write parameter tests**

```js
// extension/tests/unit/glassParams.test.js
import {equal, almost} from './assert.js';
import {glassParams} from '../../src/lib/glassParams.js';

export function run() {
    equal(glassParams({mode: 'auto'}).effectiveMode, 'liquid');
    equal(glassParams({mode: 'auto', fallback: 'frosted'}).effectiveMode, 'frosted');
    equal(glassParams({mode: 'off'}).effectiveMode, 'off');
    equal(glassParams({mode: 'liquid', blurRadius: 0}).blurRadius, 0);
    almost(glassParams({mode: 'liquid', opacity: 0.72}).opacity, 0.72);
    equal(glassParams({mode: 'liquid', dark: true}).tint.length, 3);
}
```

- [ ] **Step 2: Run and watch it fail**

Run: `make test-gjs`
Expected: FAIL — `glassParams.js` not found.

- [ ] **Step 3: Implement the glass**

Panel actor: `frame` (clips, `Shell.BlurEffect({mode: Shell.BlurMode.ACTOR, radius})`) containing `layers`; clones are `Clutter.Clone` actors clipped to the panel rect plus blur padding. Wallpaper source `Main.layoutManager._backgroundGroup`; window sources are each window actor's surface child (first child) for windows intersecting the padded rect; top-bar source `Main.panel` only when the rect intersects `panelBox`. Rebuild clones on open and on `restacked` / `window-created` / window `notify::visible`, coalesced through one `Meta.LaterType.BEFORE_REDRAW` later. Never poll.

Shader: adapt Isle's `shaderEffect` helper (`Clutter.ShaderEffect` + `Cogl.Snippet` via `vfunc_get_static_snippet`, `effectPoint`, uniform setter) with attribution. Uniforms: width, height, radius, tint (vec3), opacity, saturation, lens, rim. GLSL: rounded-rect SDF mask with 1 px AA, tint, saturation, top sheen, inward lens 2–3 px, 1 px rim. Constants live in `glassParams.js`.

Fallback: wrap effect/clone creation in `try/catch`; on failure log once, set `effectiveMode = 'frosted'`, remove the shader, keep the frame blur, and set a CSS rounded translucent panel. `off` removes clones/blur and uses the flat CSS panel.

`applySettings()` updates uniforms/blur in place; `setRect(rect)` updates the frame/clone geometry without rebuilding during an animation.

- [ ] **Step 4: Run**

Run: `make test-gjs`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src/glass.js extension/src/lib/glassParams.js extension/tests extension/stylesheet.css
git commit -m "feat: render bounded liquid glass"
```

---

### Task 22: Glass settings, view switch, and cleanup

**Files:**
- Modify: `extension/src/glass.js`, `extension/src/overlay.js`, `extension/extension.js`, `tools/test/headless.js`
- Test: `tools/test/headless.js`

**Interfaces:**
- Consumes: `glassParams` and `GlassPanel`.
- Produces: live `glass-mode`, `glass-opacity`, `blur-radius`, `glass-tint`, and `animations` handling; no reopen.
- Produces: `getTestAPI().glass` is the overlay's live `GlassPanel`; its `effectiveMode` and `blurRadius` getters reflect the applied settings.

- [ ] **Step 1: Extend headless settings assertions**

```js
api.settings.set_string('glass-mode', 'off');
await Scripting.waitLeisure();
assert(api.glass.effectiveMode === 'off', 'glass mode applies live');

api.settings.set_int('blur-radius', 0);
api.settings.set_double('glass-opacity', 0.5);
api.settings.set_double('glass-tint', 0.2);
await Scripting.waitLeisure();
assert(api.glass.blurRadius === 0, 'blur radius applies live');

api.settings.set_boolean('animations', false);
api.overlay.close();
api.overlay.open();
await Scripting.waitLeisure();
assert(api.overlay.visible, 'opens without animation');
```

Also open the grid, assert `api.glass.rect` equals the grid panel rect, close, reopen, and assert `api.glass.cloneCount === 0` when closed.

- [ ] **Step 2: Run and watch it fail**

Run: `make test-shell`
Expected: FAIL — live glass changes not wired.

- [ ] **Step 3: Implement**

Extension connects `changed::glass-mode|glass-opacity|blur-radius|glass-tint|animations` and calls `overlay.applySettings()`. Overlay forwards to `glass.applySettings()` and updates animation durations. On view switch: compute both rects, build clones for the target rect, freeze rebuilds during the 150 ms panel resize, then resume. On close: destroy clones, disconnect window signals, remove the pending later, hide frame and shader. If grid glass throws, fall back to frosted for the grid only and log once.

- [ ] **Step 4: Run**

Run: `make test-shell`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/src extension/extension.js tools/test/headless.js
git commit -m "feat: apply glass settings live and clean up clones"
```

---

### Task 23: Real-session performance gate

**Files:**
- Create: `docs/perf/m3-glass.md`
- Modify: `extension/src/perf.js` (only if measurement needs a counter)
- Test: manual measurement script (below)

**Interfaces:**
- Consumes: `FrameMeter` and the `SIFT_PERF=1` path.
- Produces: the release decision: liquid default or frosted default, plus the measured numbers.

- [ ] **Step 1: Measure**

On GNOME 51.1 / Intel i915, with `SIFT_PERF=1`:

- 20 open/close cycles; record P50/P95/max frame interval, long frames, and open latency;
- type a 10-character query repeatedly; record frame interval and keystroke→file-merge latency;
- open the grid, page through it, resize the window; record the 1040×70% rect;
- repeat with Blur my Shell enabled, at 100% and 200% scaling, on two monitors, and over a fullscreen video.

- [ ] **Step 2: Decide**

Record in `docs/perf/m3-glass.md`. If the grid rect misses P95 ≤ 16.7 ms, set grid glass to frosted while search stays liquid, as design §12.3 allows. If the search rect misses, set `auto` to frosted and record why. Do not add runtime auto-switching.

- [ ] **Step 3: Verify no leaks**

Run 20 cycles and assert clone count returns to zero and the extension JS heap stays ≤ 25 MB (use the shell's `--perf` output or `sysprof-cli` notes). Record in the same document.

- [ ] **Step 4: Commit**

```bash
git add docs/perf/m3-glass.md extension/src/perf.js
git commit -m "docs: record m3 glass performance"
```

---

## M4 — Polish and packaging

### Task 24: Preferences window

**Files:**
- Create: `extension/prefs.js`
- Modify: `Makefile` (`prefs` target), `tools/test/headless.js` (schema sanity only)
- Test: `extension/tests/unit/schema.test.js` already covers keys; manual prefs check below.

**Interfaces:**
- Produces: `export default class SiftPreferences extends ExtensionPreferences` with `fillPreferencesWindow(window)`.
- Consumes: all seven settings keys; `Reindex` D-Bus method.

- [ ] **Step 1: Implement the window**

`window.set_default_size(600, 720)`, `set_search_enabled(true)`, title "Sift". Pages/groups:

- Appearance: `Adw.ComboRow` for glass mode (Auto, Liquid, Frosted, Off), `Adw.SwitchRow` for animations, and `Adw.ActionRow` + 200 px `Gtk.Scale` for opacity (0.30–0.95, step 0.05), blur radius (0–64, step 1), and tint (0–1, step 0.05). The row subtitle shows the current value.
- Results: `Adw.ActionRow` + `Gtk.Scale` for max results (4–12, step 1).
- App grid: `Adw.ActionRow` + `Gtk.Scale` for icon size (48–128, step 1).
- File indexing: `Adw.ActionRow` with the explanation as subtitle and a `Gtk.Button` suffix labelled `Rebuild index`. The button calls `Reindex` with `Gio.DBus.session.call` and a 1 s timeout; on error show an `Adw.Toast`.

Bindings are explicit because the key types do not all match the widget properties:

- booleans: `settings.bind('animations', row, 'active', Gio.SettingsBindFlags.DEFAULT)`;
- doubles: `settings.bind(key, scale, 'value', Gio.SettingsBindFlags.DEFAULT)` with `scale.digits = 2` and `scale.round_digits = 2`;
- string enum: keep `const GLASS_MODES = ['auto', 'liquid', 'frosted', 'off']`; on `notify::selected` call `settings.set_string('glass-mode', GLASS_MODES[row.selected])`, and on `changed::glass-mode` set `row.selected = GLASS_MODES.indexOf(settings.get_string('glass-mode'))`;
- ints: a small `bindIntScale(settings, key, scale, step, lower, upper)` helper sets `scale.value = settings.get_int(key)` on `changed::key` and calls `settings.set_int(key, Math.round(scale.value))` on `notify::value`, with `digits: 0` and a `Gtk.Adjustment` using the schema range.

The window reads `this.getSettings()`.

- [ ] **Step 2: Check the window**

Run:

```bash
make build
gnome-extensions install --force dist/sift@alphabeast97.github.io.shell-extension.zip
gnome-extensions enable sift@alphabeast97.github.io
gnome-extensions prefs sift@alphabeast97.github.io
```

Expected: window opens; changing every control updates the open overlay without reopening; closing and reopening persists; `gsettings reset-recursively org.gnome.shell.extensions.sift` restores defaults; "Rebuild index" with `roots = []` empties file results.

- [ ] **Step 3: Commit**

```bash
git add extension/prefs.js Makefile
git commit -m "feat: add adwaita preferences window"
```

---

### Task 25: Theme, accessibility, and presentation polish

**Files:**
- Modify: `extension/stylesheet.css`, `extension/src/overlay.js`, `extension/src/appGrid.js`, `extension/src/results.js`, `extension/src/lib/format.js`
- Create: `extension/tests/unit/format.test.js`
- Test: `extension/tests/unit/format.test.js`, `tools/test/headless.js`

**Interfaces:**
- Produces: `abbreviatePath(path, home) -> string`, `parentPath(path) -> string`; overlay uses them for file subtitles.
- Produces: light/dark tinting from `St.Settings.get().color_scheme`, accessible names, high-contrast border.

- [ ] **Step 1: Write format tests**

```js
import {equal} from './assert.js';
import {abbreviatePath, parentPath} from '../../src/lib/format.js';

export function run() {
    equal(abbreviatePath('/home/a', '/home/a'), '~');
    equal(abbreviatePath('/home/a/docs/report.pdf', '/home/a'), '~/docs/report.pdf');
    equal(abbreviatePath('/srv/report.pdf', '/home/a'), '/srv/report.pdf');
    equal(parentPath('/home/a/docs/report.pdf'), '/home/a/docs');
}
```

- [ ] **Step 2: Run and watch it fail**

Run: `make test-gjs`
Expected: FAIL — `format.js` not found.

- [ ] **Step 3: Implement polish**

- Use `St.SystemColorScheme.PREFER_DARK`/`PREFER_LIGHT` to pick text/tint colors; never hard-code a light-only text color.
- Set accessible names: entry "Search", grid button "Show all applications", each result row title, each grid tile (via `AppIcon` label), each page dot "Page N".
- Selection/hover: visible 2 px high-contrast border and translucent fill; keyboard selection never relies on hover.
- File subtitle = `abbreviatePath(parentPath(path), GLib.get_home_dir())`.
- Empty state: short hint, keyboard hints, "Show all applications" button (120 px tall).
- Footer: hints left, status right only while indexing/degraded/unavailable.
- 100+ app grid: ensure idle chunks keep the panel interactive and the scroll pages update.

- [ ] **Step 4: Run**

Run: `make test-gjs && make test-shell`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add extension/stylesheet.css extension/src extension/tests tools/test/headless.js
git commit -m "feat: polish theming, labels, and path display"
```

---

### Task 26: Installer, docs, notices, and release artifacts

**Files:**
- Create: `packaging/install.sh`
- Create: `README.md` (complete), `THIRD_PARTY_NOTICES` (complete)
- Modify: `Makefile` (`install`, `prefs`, `uninstall`, `release`), `extension/metadata.json` if the URL changes
- Create: `dist/SHA256SUMS` via `make release` (not committed)

**Interfaces:**
- Produces: `packaging/install.sh [--prefix DIR] [--binary PATH] [--extension-zip PATH] [--uninstall [--purge]]`.
- Produces: `make install`, `make prefs`, `make uninstall`, `make release`.

- [ ] **Step 1: Implement the installer**

`set -euo pipefail`; check `command -v gnome-extensions`, `gjs`, and `gnome-shell --version` matching `GNOME Shell 51`. Install sequence: `Quit` via `gdbus` (ignore errors), wait up to 2 s for the name to disappear, install the binary to `$prefix/bin/siftd` through a temp file + `mv`, write `"${XDG_DATA_HOME:-$prefix/share}/dbus-1/services/io.github.alphabeast97.Sift.service"` with the absolute `Exec`, pack and `gnome-extensions install --force`, `gnome-extensions enable`. Print the Wayland logout note only when the shell has not loaded the extension. Uninstall: disable, uninstall, remove binary and service file; `--purge` also removes `~/.config/sift` and `~/.cache/sift`. When `--binary` / `--extension-zip` are omitted, use `dist/siftd` and `dist/sift@alphabeast97.github.io.shell-extension.zip` relative to the repo root.

Add the exact Makefile targets:

```make
PREFIX ?= $(HOME)/.local

release: build
	install -m 0755 target/release/siftd dist/siftd
	cd dist && sha256sum siftd $(UUID).shell-extension.zip > SHA256SUMS

install: release
	packaging/install.sh --prefix "$(PREFIX)"

prefs:
	gnome-extensions prefs $(UUID)

uninstall:
	packaging/install.sh --uninstall --prefix "$(PREFIX)" $(if $(PURGE),--purge)
```

- [ ] **Step 2: Test the installer syntax and uninstall path**

Run:

```bash
bash -n packaging/install.sh
make release
ls dist/sift@alphabeast97.github.io.shell-extension.zip dist/siftd dist/SHA256SUMS
(cd dist && sha256sum -c SHA256SUMS)
```

Expected: no syntax errors; all three artifacts exist; the checksum check passes.

- [ ] **Step 3: Document**

README: what Sift is, requirements (GNOME 51, session bus), `make install`, Super/Activities/hot corner, Super+A, typing, calculator Enter copies, file open/reveal, `gnome-extensions prefs`, config file (`roots`, excludes, `max_entries`), uninstall, troubleshooting (daemon absent, logout note, BMS optional), and the test commands. `THIRD_PARTY_NOTICES`: Isle attribution URL, `nucleo-matcher` MPL-2.0, `fend-core` MIT, and a note that no BMS code is required.

- [ ] **Step 4: Commit**

```bash
git add packaging README.md THIRD_PARTY_NOTICES Makefile extension/metadata.json
git commit -m "feat: add one-command installer and release artifacts"
```

---

## M5 — Verification and handover

### Task 27: Full verification and approval gate

**Files:**
- Create: `docs/perf/release-checklist.md`
- Modify: any file needed for findings.

**Interfaces:**
- Produces: the signed-off local build; only after that, a GitHub remote and a push.

- [ ] **Step 1: Run the full automated suite**

```bash
make test
make test-shell
SIFT_E2E=1 make test-shell
```

Expected: all pass; no skipped tests.

- [ ] **Step 2: Run the manual matrix**

From design §18.1:

- warm open, typing, 60 fps frame meter, light/dark, 100%/200% scaling, two monitors, fullscreen, BMS on/off, disable/enable, logout/login;
- Super, Activities, hot corner, Super+A, second Super, Escape, click-outside, IME composition;
- app grid: 100+ apps, paging, dots, keys, typing switch, icon-size live, no drag/folders/context menus;
- prefs: every control live, persistence, reset, "Rebuild index" with `roots = []`;
- fresh-user install, upgrade (rerun), uninstall, `--purge`;
- no home filenames on the lock screen; extension disables on lock and re-enables on unlock.

Record pass/fail and evidence in `docs/perf/release-checklist.md`.

- [ ] **Step 3: Stop for user verification**

Ask the user to run the local build and approve it. Do not create a remote, push, tag, publish the CI image, or enable required checks before that approval.

- [ ] **Step 4: After approval only**

Create the GitHub repository, push `main`, publish the pinned image to GHCR and record its digest, enable the workflows, then tag the release. Use the release job's artifacts and `SHA256SUMS`.

- [ ] **Step 5: Commit**

```bash
git add docs/perf/release-checklist.md
git commit -m "docs: record release verification"
```

---

## Self-Review Notes

- **Spec coverage:** §7 lifecycle → Tasks 7/16/22; §8 takeover → Task 7; §9 search → Tasks 8/13/14/18/19; §10 index → Tasks 11/12/17; §11 D-Bus → Tasks 15/16; §12 glass → Tasks 1/21/22/23; §13 UI/prefs → Tasks 6/8/9/24/25; §14 performance → Tasks 1/13/20/23; §15 failures → Tasks 12/16/18/19; §16 security → Tasks 10/15/26; §17 layout → Tasks 3/5/26; §18 testing/CI → Tasks 4/5/20/27; §19 packaging → Task 26; §20 milestones → M0–M5.
- **Type consistency:** `SiftOverlay` getters (`visible`, `view`, `rows`, `selectedIndex`, `rowCount`, `footerText`) are the same names used by the headless tests; `Apps.search` returns the record shape consumed by `rankApps` and `appRow`; `mergeRows` consumes row arrays; `Index::read`/`replace`/`apply_batch` are used by Tasks 16/17 exactly as defined.
- **Review Focus tests:** rapid typing/stale replies → Task 19 selection test + Task 20 rapid-typing test; daemon missing → Task 18; IME/printable keys → Task 6/9; monitor geometry → Task 6/23; index churn → Task 11/17.
- **Proportion:** task bodies name signatures, tests, and the exact values from the design; they do not reproduce the shader or the full UI code.
