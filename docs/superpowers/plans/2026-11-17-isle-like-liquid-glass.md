# Sift — Isle-like Liquid Glass and Motion — Implementation Plan

> **For the implementing agent:** work the tasks in order and commit at each task's commit
> step. Steps use checkbox (`- [ ]`) syntax. Read the design first:
> [`docs/superpowers/specs/2026-11-17-isle-like-liquid-glass-design.md`](../specs/2026-11-17-isle-like-liquid-glass-design.md).

**Goal:** replace the flat, mode-switched glass with one liquid-glass surface, one
Brightness control, an accurate bounded backdrop, and Isle-like spring motion.

**Architecture:**

- `GlassPanel` owns a rounded `shape` with the mask/tone shader, a padded `frame` with
  Shell's blur, and cached `AreaClone` copies of the wallpaper, windows, and top bar.
- `glassParams()` maps one 0–100 brightness and the colour scheme onto the dark or light
  preset.
- `Spring` is pure math; `SpringDriver` steps it from a `Clutter.Timeline`; `EaseDriver`
  runs the timed fades while the glass follows the panel each frame.
- `SiftOverlay` uses `Clutter.FixedLayout`, keeps content at one explicit size during a
  transition, springs open/compact/view geometry, and ends close with its fade.

**Tech stack:** GNOME Shell 51.1, GJS 1.90.1, Clutter/Cogl, St, `Clutter.ShaderEffect`
with a `Cogl.Snippet`, `Shell.BlurEffect`, GSettings, Adwaita, GJS unit tests, and the
headless shell test.

**Isle reference:** `/home/alphabeast97/Downloads/isle`, commit `1dcfd74`:

- `gnome-extension/src/glass.js` — `AreaClone` (252), `GlassBackdrop` (283),
  `_windowPlaces` (405), `_syncWindows` (496), `_placeCopies` (545).
- `gnome-extension/src/spring.js` — `Spring` (23), `SpringDriver` (71).
- `gnome-extension/src/shader.js` — `effectPoint` (17), `shaderEffect` (37).

Isle is GPL-3.0-or-later. Keep the SPDX header, add
`// Derived from Isle (https://github.com/zickrian/isle), GPL-3.0-or-later.` above the
ported `AreaClone`, spring, and shader code. `THIRD_PARTY_NOTICES` already credits Isle.

## Global constraints

- No Rust, daemon, search, shortcut-key, or app-grid-feature changes.
- No new preference beyond `glass-brightness`; keep `animations`.
- One style: liquid. No mode/opacity/blur/tint keys, rows, or CSS classes.
- GNOME Shell 51 only. Shader = `Clutter.ShaderEffect` + `Cogl.Snippet`.
- Glass stays bounded to panel + `GLASS_PAD`; no fullscreen blur.
- Conventional commits, one coherent change per commit. Do not tag or release.
- `main` is the branch. Do not push until the user approves the final result.

## Build order

The schema, glass, and overlay changes are interdependent. Tasks 1–4 add pure modules and
unit tests. Task 5 replaces the glass and schema, Task 6–7 the overlay, Task 8 the
stylesheet, Task 9 the headless suite. `make test-gjs`, `make test-schema`, and
`make lint` run at every task; `make test-shell` is the gate from Task 9 on. Do not install
the extension on the desktop until Task 10.

## Review focus

Each input below needs a test because no single happy path covers it:

1. **Brightness** — monotonic at every backdrop luma, and the dark/light guardrails hold at
   brightness 0, 50, and 100 (Task 1).
2. **Retargeted geometry** — a spring reversed mid-flight keeps a union of every frame, so
   no clone appears or disappears at the moving edge (Task 2 union tests, Task 5
   `_syncWindows`, Task 9 view-switch/reopen test).
3. **Close and reopen** — the modal grab and input are released at close start; a second
   Super/Super+A during the 120 ms fade reopens the requested view without a flash
   (Task 6, Task 8, Task 9).
4. **View switch** — outgoing content keeps its size for the 80 ms fade; the grid lays out
   once at the target size; text never reflows per frame (Task 7, Task 9).
5. **Animations off** — every transition snaps and creates no timeline (Task 6–7, Task 9).
6. **Live brightness** — blur radius and uniforms change without touching geometry or
   clones (Task 5, Task 9).

---

## Task 1: Brightness presets and unit tests

**Files:**
- Modify: `extension/src/lib/glassParams.js`
- Modify: `extension/tests/unit/glassParams.test.js`

**Interfaces:**
- Produces: `GLASS_PAD = 32`, `GLASS_RADIUS = 18`,
  `glassParams({brightness = 50, dark = true})` returning
  `{brightness, radius, blurRadius, fill, saturation, lo, span, gamma, deep, knee, sheen, glow, reach, lens, band, spread, rim, rimWidth, rimColour}`.
- `fill` is `[r, g, b, a]`; `rimColour` is `[r, g, b]`.

- [ ] **Step 1: Write the failing test**

Replace `extension/tests/unit/glassParams.test.js` with:

```js
// SPDX-License-Identifier: GPL-3.0-or-later
import {almost, assert, equal} from './assert.js';
import {GLASS_PAD, glassParams} from '../../src/lib/glassParams.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mix = (a, b, t) => a + (b - a) * t;
const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
};

// The shader's tone + fill path, without rim/sheen/glow: a conservative floor.
function toneOut(params, backdropLuma) {
    const tone = params.lo + params.span *
        Math.pow(backdropLuma, params.gamma) *
        (1 - params.deep * smoothstep(params.knee, 1, backdropLuma));
    return mix(tone, luma(params.fill), params.fill[3]);
}

export function run() {
    equal(GLASS_PAD, 32);

    const dark0 = glassParams({brightness: 0, dark: true});
    const dark50 = glassParams({brightness: 50, dark: true});
    const dark100 = glassParams({brightness: 100, dark: true});
    equal(dark0.blurRadius, 30);
    equal(dark50.blurRadius, 22);
    equal(dark100.blurRadius, 14);
    equal(dark0.radius, 18);
    almost(dark0.fill[3], 0.34);
    almost(dark100.fill[3], 0.24);
    equal(dark0.rimColour.join(','), '1,1,1');

    const light0 = glassParams({brightness: 0, dark: false});
    const light100 = glassParams({brightness: 100, dark: false});
    almost(light0.lo, 0.55);
    almost(light100.lo, 0.64);
    equal(light0.sheen, 0);
    equal(light100.glow, 0);
    equal(light0.rimColour.join(','), '0.12,0.12,0.14');

    for (const dark of [true, false]) {
        for (const backdrop of [0, 0.25, 0.5, 0.75, 1]) {
            let previous = -Infinity;
            for (const brightness of [0, 25, 50, 75, 100]) {
                const value = toneOut(glassParams({brightness, dark}), backdrop);
                assert(value > previous,
                    `brightness rises at luma ${backdrop} (dark=${dark})`);
                previous = value;
            }
        }
    }

    for (const brightness of [0, 50, 100]) {
        assert(toneOut(glassParams({brightness, dark: true}), 1) <= 0.30,
            `dark guardrail at ${brightness}`);
        assert(toneOut(glassParams({brightness, dark: false}), 0) >= 0.60,
            `light guardrail at ${brightness}`);
    }
}
```

- [ ] **Step 2: Replace the presets**

In `extension/src/lib/glassParams.js`, delete the old constants (`GLASS_BLUR_RADIUS`,
`GLASS_OPACITY`, `GLASS_TINT`, `GLASS_SATURATION`, `GLASS_LENS`, `GLASS_RIM`,
`GLASS_SHEEN`, `DARK_TINT`, `LIGHT_TINT`, `tintColor`, and the `mode`/`fallback` arguments).
Write:

```js
// SPDX-License-Identifier: GPL-3.0-or-later
export const GLASS_PAD = 32;
export const GLASS_RADIUS = 18;
const GLASS_REACH = 24;

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mix = (a, b, t) => a + (b - a) * t;
const mixArray = (a, b, t) => a.map((value, i) => mix(value, b[i], t));

// Brightness blends these linearly: 0 dark smoked, 100 clear.
const DARK = {
    dark: {fill: [0.02, 0.025, 0.03, 0.34], lo: 0.00, span: 0.32, deep: 0.45,
        knee: 0.45, sheen: 0.01, glow: 0.02},
    clear: {fill: [0.03, 0.04, 0.05, 0.24], lo: 0.03, span: 0.50, deep: 0.35,
        knee: 0.30, sheen: 0.03, glow: 0.05},
};
const LIGHT = {
    dark: {fill: [0.93, 0.94, 0.96, 0.26], lo: 0.55, span: 0.28, deep: 0.12, knee: 0.40},
    clear: {fill: [0.96, 0.97, 0.99, 0.20], lo: 0.64, span: 0.32, deep: 0.10, knee: 0.40},
};

export function glassParams({brightness = 50, dark = true} = {}) {
    const value = clamp(brightness, 0, 100);
    const t = value / 100;
    const a = dark ? DARK.dark : LIGHT.dark;
    const b = dark ? DARK.clear : LIGHT.clear;

    return {
        brightness: value,
        radius: GLASS_RADIUS,
        blurRadius: Math.round(mix(30, 14, t)),
        fill: mixArray(a.fill, b.fill, t),
        lo: mix(a.lo, b.lo, t),
        span: mix(a.span, b.span, t),
        gamma: 1,
        deep: mix(a.deep, b.deep, t),
        knee: mix(a.knee, b.knee, t),
        saturation: mix(1.00, 1.15, t),
        sheen: dark ? mix(a.sheen, b.sheen, t) : 0,
        glow: dark ? mix(a.glow, b.glow, t) : 0,
        reach: GLASS_REACH,
        lens: mix(8, 26, t),
        band: mix(20, 24, t),
        spread: mix(0.30, 0.70, t),
        rim: mix(0.15, 0.50, t),
        rimWidth: 1.1,
        rimColour: dark ? [1, 1, 1] : [0.12, 0.12, 0.14],
    };
}
```

- [ ] **Step 3: Run the unit test**

```bash
gjs -m extension/tests/unit/all.js
```

Expected: `ok glassParams` and every other test still passes.

- [ ] **Step 4: Commit**

```bash
git add extension/src/lib/glassParams.js extension/tests/unit/glassParams.test.js
git commit -m "feat: map glass brightness onto dark and light presets"
```

---

## Task 2: Window places, intersection, and union

**Files:**
- Modify: `extension/src/lib/windowStack.js`
- Modify: `extension/tests/unit/windowStack.test.js`

**Interfaces:**
- Produces: `windowPlaces(actors)` → `{actor, x, y, width, height}[]`, bottom-first,
  excluding invisible, minimized, and override-redirect windows.
- Produces: `intersects(a, b)` (unchanged) and `unionRect(a, b)` (either side may be
  `null`).

- [ ] **Step 1: Write the failing test**

Replace `extension/tests/unit/windowStack.test.js` with:

```js
// SPDX-License-Identifier: GPL-3.0-or-later
import {equal} from './assert.js';
import {intersects, unionRect, windowPlaces} from '../../src/lib/windowStack.js';

function actor({x = 0, y = 0, width = 100, height = 100, visible = true,
    minimized = false, override = false} = {}) {
    return {
        x, y, width, height, visible,
        meta_window: {minimized, is_override_redirect: () => override},
    };
}

export function run() {
    const bottom = actor({y: 100});
    const dialog = actor({x: 50, type: 2});
    const top = actor({x: 100, y: 100});

    const places = windowPlaces([
        bottom,
        actor({visible: false}),
        dialog,
        actor({minimized: true}),
        actor({override: true}),
        top,
    ]);

    equal(places.length, 3);
    equal(places[0].actor, bottom);
    equal(places[1].actor, dialog);
    equal(places[2].actor, top);
    equal(places[1].x, 50);

    const area = {x: 0, y: 0, width: 200, height: 200};
    equal(intersects(area, {x: 199, y: 0, width: 10, height: 10}), true);
    equal(intersects(area, {x: 200, y: 0, width: 10, height: 10}), false);

    equal(unionRect(null, area), area);
    const union = unionRect({x: 10, y: 20, width: 30, height: 40},
        {x: 70, y: 0, width: 10, height: 10});
    equal(`${union.x},${union.y},${union.width},${union.height}`, '10,0,70,60');
}
```

- [ ] **Step 2: Implement**

Replace `extension/src/lib/windowStack.js` with:

```js
// SPDX-License-Identifier: GPL-3.0-or-later

export function intersects(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x &&
        a.y < b.y + b.height && a.y + a.height > b.y;
}

export function unionRect(a, b) {
    if (!a)
        return b;
    if (!b)
        return a;

    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return {
        x,
        y,
        width: Math.max(a.x + a.width, b.x + b.width) - x,
        height: Math.max(a.y + a.height, b.y + b.height) - y,
    };
}

// Every visible window, dialogs included, in stacking order (bottom first). The
// glass filters these places against its moving frame; override-redirect menus
// are not copied because their actor is not a normal window surface.
export function windowPlaces(actors) {
    return actors.filter(actor => {
        const window = actor.meta_window;
        return window && actor.visible && !window.minimized &&
            !window.is_override_redirect();
    }).map(actor => ({
        actor,
        x: actor.x,
        y: actor.y,
        width: actor.width,
        height: actor.height,
    }));
}
```

- [ ] **Step 3: Run the unit test**

```bash
gjs -m extension/tests/unit/all.js
```

Expected: `ok windowStack`.

- [ ] **Step 4: Commit**

```bash
git add extension/src/lib/windowStack.js extension/tests/unit/windowStack.test.js
git commit -m "feat: cache visible window places for the glass backdrop"
```

## Task 3: Pure spring math and unit tests

**Files:**
- Create: `extension/src/lib/spring.js`
- Create: `extension/tests/unit/spring.test.js`
- Modify: `extension/tests/unit/all.js`

**Interfaces:**
- Produces: `MOVE = {stiffness: 180, damping: 22}`; `Spring` with `value`, `target`,
  `velocity`, `config`, `setTarget(target, config?)`, `reset(value)`, `settled`, `step(dt)`.

- [ ] **Step 1: Write the failing test**

Create `extension/tests/unit/spring.test.js`:

```js
// SPDX-License-Identifier: GPL-3.0-or-later
import {almost, assert, equal} from './assert.js';
import {MOVE, Spring} from '../../src/lib/spring.js';

export function run() {
    const spring = new Spring(0, MOVE);
    assert(spring.settled, 'a spring starts at rest');
    spring.setTarget(100);

    let frames = 0;
    while (!spring.settled && frames < 600) {
        spring.step(1 / 60);
        frames++;
    }
    assert(spring.settled, 'the spring settles');
    almost(spring.value, 100);
    equal(spring.velocity, 0);
    assert(frames < 300, 'the move settles in under five seconds');

    spring.reset(10);
    equal(spring.value, 10);
    equal(spring.target, 10);
    equal(spring.velocity, 0);

    spring.setTarget(0);
    spring.step(0.1);
    const velocity = spring.velocity;
    spring.setTarget(50);
    equal(spring.velocity, velocity, 'retargeting keeps the velocity');

    spring.reset(0);
    spring.setTarget(100);
    spring.step(10);
    assert(Number.isFinite(spring.value), 'a huge frame stays finite');

    spring.reset(0);
    spring.setTarget(100);
    spring.step(1 / 240);
    spring.setTarget(0);
    assert(spring.value > 0 && spring.value < 1,
        'a reversal starts from the current value');
}
```

Register it in `extension/tests/unit/all.js`:

```js
import {run as spring} from './spring.test.js';
```

and add `['spring', spring],` to the `tests` array.

- [ ] **Step 2: Implement**

Create `extension/src/lib/spring.js` (ported from Isle):

```js
// SPDX-License-Identifier: GPL-3.0-or-later
// Derived from Isle (https://github.com/zickrian/isle), GPL-3.0-or-later.

const MAX_STEP = 1 / 240;
const MAX_FRAME = 0.25;
const REST_DISTANCE = 0.25;
const REST_SPEED = 2;

/** Panel y and view geometry: ~3.5% overshoot, at rest well under a second. */
export const MOVE = {stiffness: 180, damping: 22};

export class Spring {
    constructor(value, config = MOVE) {
        this.value = value;
        this.target = value;
        this.velocity = 0;
        this.config = config;
    }

    setTarget(target, config = this.config) {
        this.target = target;
        this.config = config;
    }

    reset(value) {
        this.value = this.target = value;
        this.velocity = 0;
    }

    get settled() {
        return Math.abs(this.value - this.target) < REST_DISTANCE &&
            Math.abs(this.velocity) < REST_SPEED;
    }

    step(dt) {
        let remaining = Math.min(Math.max(dt, 0), MAX_FRAME);
        while (remaining > 0 && !this.settled) {
            const h = Math.min(remaining, MAX_STEP);
            const {stiffness, damping} = this.config;
            const acceleration = -stiffness * (this.value - this.target) -
                damping * this.velocity;
            this.velocity += acceleration * h;
            this.value += this.velocity * h;
            remaining -= h;
        }
        if (this.settled) {
            this.value = this.target;
            this.velocity = 0;
            return true;
        }
        return false;
    }
}
```

- [ ] **Step 3: Run and commit**

```bash
gjs -m extension/tests/unit/all.js
git add extension/src/lib/spring.js extension/tests/unit/spring.test.js extension/tests/unit/all.js
git commit -m "feat: add retargetable spring math"
```

---

## Task 4: Frame and timed-ease drivers

**Files:**
- Create: `extension/src/motion.js`

**Interfaces:**
- Produces: `SpringDriver(actor, springs, onFrame)` with `running`, `start()`, `stop()`,
  `destroy()`.
- Produces: `EaseDriver(actor, durationMs, onFrame, onComplete = null)` with `running`,
  `start()`, `stop()`, `destroy()`. `onFrame(progress)` receives an eased 0–1 value;
  `onComplete()` runs once at 1.

- [ ] **Step 1: Implement the spring driver**

Create `extension/src/motion.js`:

```js
// SPDX-License-Identifier: GPL-3.0-or-later
// Derived from Isle (https://github.com/zickrian/isle), GPL-3.0-or-later.

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';

/** Steps springs once per frame of `actor`, then calls `onFrame`, until all rest. */
export class SpringDriver {
    constructor(actor, springs, onFrame) {
        this._springs = springs;
        this._onFrame = onFrame;
        this._lastFrame = 0;
        this._timeline = new Clutter.Timeline({
            actor,
            duration: 1000,
            repeat_count: -1,
        });
        this._timeline.connect('new-frame', () => this._tick());
    }

    get running() {
        return this._timeline?.is_playing() ?? false;
    }

    start() {
        if (!this._timeline || this._timeline.is_playing())
            return;
        this._lastFrame = GLib.get_monotonic_time();
        this._timeline.start();
    }

    stop() {
        this._timeline?.stop();
    }

    _tick() {
        const now = GLib.get_monotonic_time();
        const dt = (now - this._lastFrame) / 1e6;
        this._lastFrame = now;

        let settled = true;
        for (const spring of this._springs)
            settled = spring.step(dt) && settled;
        this._onFrame();
        if (settled)
            this._timeline.stop();
    }

    destroy() {
        this.stop();
        this._timeline?.run_dispose();
        this._timeline = null;
    }
}

/** Eases 0–1 over `duration` ms with EASE_OUT_CUBIC, tied to `actor`'s frame clock. */
export class EaseDriver {
    constructor(actor, duration, onFrame, onComplete = null) {
        this._duration = Math.max(1, duration);
        this._onFrame = onFrame;
        this._onComplete = onComplete;
        this._started = 0;
        this._done = false;
        this._timeline = new Clutter.Timeline({actor, duration: this._duration});
        this._timeline.connect('new-frame', () => this._tick(false));
        this._timeline.connect('completed', () => this._tick(true));
    }

    get running() {
        return this._timeline?.is_playing() ?? false;
    }

    start() {
        if (!this._timeline || this._timeline.is_playing() || this._done)
            return;
        this._started = GLib.get_monotonic_time();
        this._timeline.start();
    }

    stop() {
        this._timeline?.stop();
    }

    _tick(force) {
        if (this._done)
            return;

        const elapsed = (GLib.get_monotonic_time() - this._started) / 1000;
        const t = force ? 1 : Math.min(elapsed / this._duration, 1);
        const eased = 1 - Math.pow(1 - t, 3);
        this._onFrame(eased);

        if (t < 1)
            return;

        this._done = true;
        this._timeline.stop();
        this._onComplete?.();
    }

    destroy() {
        this.stop();
        this._timeline?.run_dispose();
        this._timeline = null;
    }
}
```

- [ ] **Step 2: Lint and commit**

```bash
make lint
git add extension/src/motion.js
git commit -m "feat: add spring and timed-ease frame drivers"
```

`motion.js` imports GI modules, so it is not part of the plain-GJS unit suite; the
headless shell exercises it.

---

## Task 5: Brightness schema, preferences, and the glass rewrite

**Files:**
- Modify: `extension/schemas/org.gnome.shell.extensions.sift.gschema.xml`
- Modify: `extension/prefs.js`
- Modify: `extension/src/glass.js`
- Modify: `extension/tests/unit/schema.test.js`

**Interfaces produced by `GlassPanel`:**
- `get rect()`, `get cloneCount()`, `get blurRadius()`, `get brightness()`,
  `get fallback()`.
- `attach(panel)`, `setRect(rect)`, `settle()`, `open()`, `close()`, `applySettings()`,
  `destroy()`.
- `setRect()` updates the shape/frame and re-filters/re-places existing copies; it never
  rebuilds the backdrop. `settle()` prunes the spring union to the current frame.
- `freeze()`, `thaw()`, `effectiveMode`, and the mode getters are deleted.

- [ ] **Step 1: Replace the schema keys**

In `extension/schemas/org.gnome.shell.extensions.sift.gschema.xml`, delete the
`glass-mode` enum and the `glass-mode`, `glass-opacity`, `blur-radius`, and `glass-tint`
keys. Add:

```xml
    <key name="glass-brightness" type="i">
      <range min="0" max="100"/>
      <default>50</default>
      <summary>Glass brightness</summary>
      <description>0 is dark smoked glass; 100 shows the desktop through clear bright glass. Higher values mean less darkening, not more white paint.</description>
    </key>
```

Keep `animations`. The schema now has exactly:
`animations, disable-overview, glass-brightness, grid-labels, max-results, search-height,
sift-apps-shortcut, sift-search-shortcut`.

- [ ] **Step 2: Update the schema test**

Replace the key assertions in `extension/tests/unit/schema.test.js`:

```js
    equal(settings.get_int('glass-brightness'), 50);
    equal(settings.get_boolean('animations'), true);
    equal(settings.get_int('max-results'), 6);
    equal(settings.get_int('search-height'), 404);
    equal(settings.get_boolean('grid-labels'), true);
    equal(settings.get_boolean('disable-overview'), true);
    equal(settings.get_strv('sift-search-shortcut').join(','), '<Control>space');
    equal(settings.get_strv('sift-apps-shortcut').join(','), '<Alt>a');

    const range = key => settings.get_range(key).recursiveUnpack()[1];

    equal(range('glass-brightness').join(','), '0,100');
    equal(range('max-results').join(','), '4,12');
    equal(range('search-height').join(','), '144,716');

    equal(schema.list_keys().sort().join(','),
        'animations,disable-overview,glass-brightness,grid-labels,max-results,search-height,sift-apps-shortcut,sift-search-shortcut');
```

- [ ] **Step 3: Replace the preferences rows**

In `extension/prefs.js`:

- Delete `GLASS_MODES` and `MODE_LABELS`.
- Set `SETTINGS_KEYS` to `['glass-brightness', 'animations', 'max-results',
  'search-height', 'grid-labels', 'disable-overview', 'sift-search-shortcut',
  'sift-apps-shortcut']`.
- Give `addIntRow` an optional subtitle function and use it in `sync()`:

```js
function addIntRow(group, settings, key, title,
    {lower, upper, step, subtitle = value => String(value)} = {}) {
    // ... existing row/adjustment/scale setup ...
    const sync = () => {
        row.subtitle = subtitle(settings.get_int(key));
        reset.sensitive = settings.get_user_value(key) !== null;
    };
```

- Delete the Mode `Adw.ComboRow` block and the Opacity, Blur radius, and Tint rows.
- Add, after the Animations switch:

```js
        addIntRow(appearanceGroup, settings, 'glass-brightness', 'Brightness', {
            lower: 0,
            upper: 100,
            step: 5,
            subtitle: value => value <= 25 ? `Dark (${value})` :
                value >= 75 ? `Clear (${value})` : String(value),
        });
```

The Animations switch stays. Search and app-grid pages are unchanged.

- [ ] **Step 4: Rewrite the shader constants**

In `extension/src/glass.js`:

- Delete the old `UNIFORMS`, `CODE`, `GlassEffect`, `_frozen`, `_rebuildLater`,
  `_displaySignals`, `_windows`, `_clones`, `_fallback` mode logic, and the
  `freeze()`/`thaw()` methods.
- Add imports: `Graphene`, and
  `import {GLASS_PAD, GLASS_RADIUS, glassParams} from './lib/glassParams.js';`
  plus `import {intersects, unionRect, windowPlaces} from './lib/windowStack.js';`.
- Keep `// SPDX-License-Identifier: GPL-3.0-or-later` and add
  `// Derived from Isle (https://github.com/zickrian/isle), GPL-3.0-or-later.`

Use these declarations:

```js
const UNIFORMS = `
uniform float width;
uniform float height;
uniform float radius;
uniform vec4 fill;
uniform vec3 rimColour;
uniform float saturation;
uniform float lo;
uniform float span;
uniform float gamma;
uniform float deep;
uniform float knee;
uniform float sheen;
uniform float glow;
uniform float reach;
uniform float lens;
uniform float band;
uniform float spread;
uniform float rim;
uniform float rimWidth;
`;

const FUNCTIONS = `
float siftInner(vec2 p, vec2 size, float radius) {
    vec2 q = abs(p - size * 0.5) - (size * 0.5 - vec2(radius));
    return radius - length(max(q, vec2(0.0))) - min(max(q.x, q.y), 0.0);
}
vec2 siftNormal(vec2 p, vec2 size, float radius) {
    return normalize(vec2(
        siftInner(p + vec2(1.0, 0.0), size, radius) -
            siftInner(p - vec2(1.0, 0.0), size, radius),
        siftInner(p + vec2(0.0, 1.0), size, radius) -
            siftInner(p - vec2(0.0, 1.0), size, radius)) + 1e-5);
}
`;
```

`effectPoint` is the Isle correction; keep it local:

```js
const effectPoint = size => `(cogl_tex_coord_in[0].xy * (${size} + 3.0) - 2.0)`;
```

- [ ] **Step 5: Write the fragment passes**

In `CODE`, in this order:

```glsl
vec2 size = vec2(width, height);
vec2 p = ${effectPoint('size')};
float r = min(radius, min(width, height) * 0.5);
float inner = siftInner(p, size, r);
float body = clamp(inner + 0.5, 0.0, 1.0);

if (lens > 0.0 && inner >= 0.0 && inner < band) {
    vec2 n = siftNormal(p, size, r);
    vec2 shift = n * lens * pow(1.0 - inner / band, 2.0) / (size + 3.0);
    vec2 uv = cogl_tex_coord_in[0].xy;
    vec4 bent = texture2D(cogl_sampler0, uv + shift);
    cogl_color_out = vec4(
        texture2D(cogl_sampler0, uv + shift * (1.0 + spread)).r,
        bent.g,
        texture2D(cogl_sampler0, uv + shift * (1.0 - spread)).b,
        bent.a) * cogl_color_in;
}

float alpha = max(cogl_color_out.a, 0.0001);
vec3 rgb = cogl_color_out.rgb / alpha;
float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
rgb = lo + span * pow(max(luma, 0.0), gamma) *
    (1.0 - deep * smoothstep(knee, 1.0, luma)) +
    (rgb - luma) * span * saturation;
rgb += sheen * (1.0 - clamp(p.y / max(height, 1.0), 0.0, 1.0));
if (inner >= 0.0) {
    rgb += glow * exp(-inner / reach) *
        (0.3 + 0.7 * clamp(p.y / max(height, 1.0), 0.0, 1.0));
}
if (rim > 0.0 && inner >= 0.0 && inner < rimWidth * 8.0) {
    vec2 facing = -siftNormal(p, size, r);
    vec2 light = normalize(vec2(-1.0, -1.25));
    float lit = pow(max(dot(facing, light), 0.0), 1.6) +
        0.6 * pow(max(dot(facing, -light), 0.0), 1.6);
    float strength = clamp(rim * (0.22 + lit) *
        (exp(-inner / rimWidth) + 0.3 * exp(-inner / (rimWidth * 3.5))),
        0.0, 1.0);
    rgb = mix(rgb, rimColour, strength);
}
rgb = mix(rgb, fill.rgb, fill.a);
cogl_color_out = vec4(clamp(rgb, 0.0, 1.0), 1.0) * cogl_color_out.a * body;
```

The final line keeps `cogl_color_out.a`, so the panel's open/close opacity fades the
glass. No `vec4(rgb, 1.0)` that throws the input alpha away.

- [ ] **Step 6: Build the actor tree**

Replace `attach()` with:

```js
attach(panel) {
    if (this._panel)
        this.destroy();

    this._panel = panel;
    this._shape = new St.Widget({
        layout_manager: new Clutter.FixedLayout(),
        clip_to_allocation: true,
        reactive: false,
        visible: false,
    });
    this._frame = new St.Widget({
        clip_to_allocation: true,
        reactive: false,
    });
    this._layers = new Clutter.Actor();
    this._frame.add_child(this._layers);
    this._shape.add_child(this._frame);
    panel.insert_child_at_index(this._shape, 0);

    try {
        this._effect = new GlassEffect();
        this._shape.add_effect(this._effect);
    } catch (error) {
        this._fallback('shader', error);
    }

    try {
        this._blur = new Shell.BlurEffect({
            mode: Shell.BlurMode.ACTOR,
            radius: this._params.blurRadius,
        });
        this._frame.add_effect(this._blur);
    } catch (error) {
        this._fallback('blur', error);
    }

    this.applySettings();
}
```

`GlassEffect` is unchanged in shape (a `Clutter.ShaderEffect` with
`vfunc_get_static_snippet()` returning `Cogl.Snippet.new(Cogl.Snippet.FRAGMENT,
UNIFORMS + FUNCTIONS, CODE)` and the existing `setUniforms` compare-and-repaint).

`setRect()`:

```js
setRect(rect) {
    if (!rect)
        return;

    this._rect = rect;
    if (!this._shape)
        return;

    this._shape.set_size(rect.width, rect.height);
    this._frame.set_position(-GLASS_PAD, -GLASS_PAD);
    this._frame.set_size(rect.width + 2 * GLASS_PAD,
        rect.height + 2 * GLASS_PAD);
    this._layers.set_size(rect.width + 2 * GLASS_PAD,
        rect.height + 2 * GLASS_PAD);
    this._updateUniforms();

    if (!this._open)
        return;

    this._union = unionRect(this._union, this._padded(rect));
    this._syncWindows();
}
```

`settle()` sets `this._union = this._padded(this._rect)` and calls `_syncWindows()`.

- [ ] **Step 7: Add `AreaClone` and cached places**

Port Isle's `AreaClone` with `Graphene.Point3D`, `paintArea`, `invalidate_paint_volume`,
and the six mirror bindings (`opacity`, `scale-x`, `scale-y`, `pivot-point`,
`translation-x`, `translation-y`). Use the same `MIRRORED` array and `surfaceOf(actor)`.

The fields are `_windows` (Map actor→clone), `_wallpaper`, `_bar`, `_watched` (Set),
`_places` (null or array), `_union` (null or rect), `_later` (0), `_open`, and
`_shaderFailed`/`_blurFailed`/`_cloneFailed`/`_warned`.

- `_windowPlaces()` watches every `global.get_window_actors()` actor once for
  `notify::allocation`, `notify::visible`, `child-added`, `child-removed`, and `destroy`,
  then returns `windowPlaces(global.get_window_actors())`.
- `_queueSync()` sets `_places = null`; if open and no later, adds
  `global.compositor.get_laters().add(Meta.LaterType.BEFORE_REDRAW, ...)`.
  The callback clears `_later`, calls `_syncWindows()`, and returns
  `GLib.SOURCE_REMOVE`.
- `_connectDisplay()` uses `connectObject` on `global.window_group`
  (`child-added`, `child-removed`), `global.display` (`restacked`),
  `Main.layoutManager.panelBox` (`notify::allocation`, `notify::mapped`,
  `notify::translation-y`), and `Main.panel` (`notify::allocation`), all with `this`.
- `_disconnectDisplay()` calls `disconnectObject(this)` on those four sources and every
  watched actor, then clears `_watched`.
- `_syncWindows()` filters `_windowPlaces()` with `intersects(this._union, place)`,
  destroys clones no longer under it, recreates only when `surfaceOf(actor)` changed,
  creates new `AreaClone(source, {mirror: actor})`, reorders children to wallpaper →
  windows bottom-to-top → bar, then calls `_placeCopies()`.
- `_placeCopies()` computes `frame = this._padded(this._rect)` and sets `_layers` to
  `-frame.x, -frame.y`; wallpaper at 0,0; each window
  at `actor.x + source.x * scale`, `actor.y + source.y * scale`, sized
  `source.width * scale` × `source.height * scale`, with
  `scale = actor.get_child_transform?.()?.get_x_scale?.() || 1`; the bar at
  `panelBox.x + panelBox.translation_x + Main.panel.x` and likewise y; every clone's
  `paintArea` is the current padded frame in clone-local coordinates.
- `open()` connects signals, creates the wallpaper and bar clones, sets
  `_union = _padded(_rect)`, syncs, and shows the shape.
- `close()` clears the later, clones and watchers, disconnects, hides the shape, and
  nulls `_union`/`_places`.

- [ ] **Step 8: Uniforms, brightness, and fallback**

```js
_readParams() {
    return glassParams({
        brightness: this._settings
            ? this._settings.get_int('glass-brightness') : 50,
        dark: St.Settings.get().color_scheme !==
            St.SystemColorScheme.PREFER_LIGHT,
    });
}
```

`applySettings()` reads the params, sets `this._blur.radius = this._params.blurRadius`,
updates the panel class (`sift-glass-fallback` only when `this.fallback`), and calls
`_updateUniforms()`. `_updateUniforms()` sends every uniform including `width`,
`height`, `radius = this._params.radius`, `fill` (vec4), and `rimColour` (vec3).
A brightness change only calls this path; it does not touch `setRect`, clones, or motion.

`get blurRadius()` returns `this._params.blurRadius`; `get brightness()` returns
`this._params.brightness`; `get fallback()` returns
`this._shaderFailed || this._blurFailed`; `get cloneCount()` returns
`this._windows.size + (this._wallpaper ? 1 : 0) + (this._bar ? 1 : 0)`.

`_fallback(kind, error)` logs once (`Sift: liquid glass unavailable (${kind}): ...`),
sets the matching failed flag, removes the shader effect when the shader failed, and calls
`applySettings()`. `applySettings()` guards `if (this._blur)` before setting its radius.
Clone failures are caught in `_syncWindows`: set `_cloneFailed`, keep the copies that
work, warn once, and never throw out of the overlay.

- [ ] **Step 9: Run and commit**

```bash
make lint
gjs -m extension/tests/unit/all.js
make test-schema
git add extension/schemas extension/prefs.js extension/src/glass.js extension/tests/unit/schema.test.js
git commit -m "feat: replace glass modes with one brightness control"
```

The extension cannot run between this commit and the overlay rewrite: `overlay.js` still
calls `freeze()`, `thaw()`, and mode getters. Do not install it yet.

---

## Task 6: Overlay state machine, fixed layout, and open/close

**Files:**
- Modify: `extension/src/overlay.js`

**Interfaces:**
- Adds `get closing()`, `get animating()` (true while opening, closing, a spring runs, or a
  fade runs), `close({immediate = false})`, and `_state`
  (`closed`/`opening`/`open`/`closing`).
- Removes `_glassThawTimer`, `_scheduleGlassThaw()`, `_cancelGlassThaw()`, and every
  `freeze()`/`thaw()` call.
- `_animationsEnabled()` is unchanged.

- [ ] **Step 1: Replace the panel and content actors**

At the top of `overlay.js` add:

```js
import {MOVE, Spring} from './lib/spring.js';
import {EaseDriver, SpringDriver} from './motion.js';
```

Replace `OPEN_ANIMATION_MS`/`VIEW_ANIMATION_MS` with:

```js
const OPEN_FADE_MS = 120;
const CLOSE_FADE_MS = 120;
const CONTENT_OUT_MS = 80;
const CONTENT_IN_MS = 120;
```

Initialize the state before building actors:

```js
this._state = 'closed';
this._motionDone = true;
this._openFade = false;
this._revealPending = false;
this._onSettled = null;
this._geometryTravel = 0;
this._viewToken = 0;
this._ease = null;
this._content = null;
this._suspendGeometry = false;
```

Delete `_animating` and `_glassThawTimer`.

The panel becomes a fixed-layout container:

```js
this._panel = new St.Widget({
    style_class: 'sift-panel',
    reactive: true,
    clip_to_allocation: true,
    layout_manager: new Clutter.FixedLayout(),
});
this.add_child(this._panel);
```

Delete `set_pivot_point`. Build the content as now, but store it:

```js
this._content = new St.BoxLayout({
    orientation: Clutter.Orientation.VERTICAL,
});
this._panel.add_child(this._content);
```

Change every `content.add_child(...)` to `this._content.add_child(...)`.

After the glass attaches, create the four springs and the driver:

```js
this._springs = {
    x: new Spring(0, MOVE),
    y: new Spring(0, MOVE),
    width: new Spring(0, MOVE),
    height: new Spring(0, MOVE),
};
this._motion = new SpringDriver(this._panel, Object.values(this._springs),
    () => this._onMotionFrame());
```

The glass inserts its shape at index 0; the content is added after, so content paints on
top.

- [ ] **Step 2: Add the state getters**

```js
get closing() {
    return this._state === 'closing';
}

get animating() {
    return this._state === 'opening' || this._state === 'closing' ||
        this._motion.running || this._openFade || this._ease?.running;
}
```

- [ ] **Step 3: Add instant frame helpers**

```js
_panelRect() {
    return {
        x: this._panel.x,
        y: this._panel.y,
        width: this._panel.width,
        height: this._panel.height,
    };
}

_seedSprings(rect) {
    this._motion.stop();
    this._springs.x.reset(rect.x);
    this._springs.y.reset(rect.y);
    this._springs.width.reset(rect.width);
    this._springs.height.reset(rect.height);
}

_springTo(rect, onSettled = null) {
    this._springs.x.setTarget(rect.x);
    this._springs.y.setTarget(rect.y);
    this._springs.width.setTarget(rect.width);
    this._springs.height.setTarget(rect.height);
    this._geometryTravel = Math.max(
        Math.abs(rect.x - this._springs.x.value),
        Math.abs(rect.y - this._springs.y.value),
        Math.abs(rect.width - this._springs.width.value),
        Math.abs(rect.height - this._springs.height.value));
    this._onSettled = onSettled;
    this._motionDone = false;
    this._motion.start();
}

_allSettled() {
    return Object.values(this._springs).every(spring => spring.settled);
}

_onMotionFrame() {
    const rect = {
        x: this._springs.x.value,
        y: this._springs.y.value,
        width: Math.round(this._springs.width.value),
        height: Math.round(this._springs.height.value),
    };
    this._panel.set_position(rect.x, rect.y);
    this._panel.set_size(rect.width, rect.height);
    this._glass?.setRect(rect);

    if (!this._allSettled())
        return;

    this._panel.set_position(this._rect.x, this._rect.y);
    this._panel.set_size(this._rect.width, this._rect.height);
    this._glass?.setRect(this._rect);
    this._glass?.settle();
    this._motionDone = true;

    const settled = this._onSettled;
    this._onSettled = null;
    settled?.();
    this._finishOpening();
}

_finishOpening() {
    if (this._state !== 'opening' || this._openFade || !this._motionDone)
        return;
    this._state = 'open';
}

_setPanelRectInstant(rect) {
    if (this._rect && this._rect.x === rect.x && this._rect.y === rect.y &&
        this._rect.width === rect.width && this._rect.height === rect.height)
        return;

    this._rect = rect;
    this._panel.set_position(rect.x, rect.y);
    this._panel.set_size(rect.width, rect.height);
    this._content.set_position(0, 0);
    this._content.set_size(rect.width, rect.height);
    this._seedSprings(rect);
    this._glass?.setRect(rect);
    this._glass?.settle();
}
```

- [ ] **Step 4: Replace `open()`**

```js
open(view = 'search') {
    if (this._destroyed || Main.sessionMode.currentMode !== 'user')
        return;

    if (this._state === 'closing') {
        this._reopen(view);
        return;
    }

    if (this.visible) {
        this._setView(view);
        this._entry.clutter_text.grab_key_focus();
        return;
    }

    this._monitorIndex = global.display.get_current_monitor();
    this._maxRows = this._settings.get_int('max-results');
    this._searchHeight = this._settings.get_int('search-height');
    this._state = 'opening';
    this._viewToken++;
    this._setViewState(view);
    this._applyGeometry(false);

    const grab = Main.pushModal(this, {actionMode: Shell.ActionMode.OVERVIEW});
    if (!grab) {
        this._state = 'closed';
        return;
    }

    this._grab = grab;
    this.reactive = true;
    this._syncFullscreen();
    this.show();
    this.refreshApps();
    this._glass?.applySettings();

    const target = this._rect;
    if (!target) {
        this._finishClose();
        return;
    }
    this._content.set_size(target.width, target.height);
    this._content.set_position(0, 0);
    this._content.opacity = 255;

    if (!this._animationsEnabled()) {
        this.opacity = 255;
        this._panel.set_position(target.x, target.y);
        this._glass?.setRect(target);
        this._glass?.open();
        this._seedSprings(target);
        this._state = 'open';
    } else {
        this._panel.set_position(target.x, target.y + 12);
        this.opacity = 0;
        this._seedSprings({...target, y: target.y + 12});
        this._glass?.setRect(this._panelRect());
        this._glass?.open();
        this._openFade = true;
        this.ease({
            opacity: 255,
            duration: OPEN_FADE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                this._openFade = false;
                this._finishOpening();
            },
        });
        this._springTo(target);
    }

    this._entry.clutter_text.grab_key_focus();
    this._daemon?.ensureFresh();
    this._syncFooter();
}
```

`_setViewState(view)` sets `this._view`, the grid/results visibility, the grid button icon
and label, calls `_grid.open()` or `_grid.close()` + `refreshApps()`, and updates the
footer and empty state. It is the old `_setView()` body without the glass freeze/thaw and
without geometry.

- [ ] **Step 5: Replace `close()` and add `_reopen()`**

```js
close({immediate = false} = {}) {
    if (this._destroyed || this._state === 'closed' || this._state === 'closing')
        return;

    this._state = 'closing';
    this._motion.stop();
    if (this._grab) {
        const grab = this._grab;
        this._grab = null;
        Main.popModal(grab);
    }

    this.reactive = false;
    this._queryGeneration++;
    this._cancelQueryTimer();
    this._latestQuery = null;
    this._daemonCalc = null;
    this._daemonFiles = [];

    if (immediate || !this._animationsEnabled()) {
        this._finishClose();
        return;
    }

    this._ease?.destroy();
    const startY = this._panel.y;
    const endY = this._rect.y + 8;
    const startOpacity = this.opacity;
    this._ease = new EaseDriver(this._panel, CLOSE_FADE_MS, progress => {
        const y = startY + (endY - startY) * progress;
        this._panel.set_position(this._panel.x, y);
        this._glass?.setRect({...this._rect, y});
        this.opacity = Math.round(startOpacity * (1 - progress));
    }, () => this._finishClose());
    this._ease.start();
}

_finishClose() {
    this._ease?.destroy();
    this._ease = null;
    this._motion.stop();
    if (this._grab) {
        const grab = this._grab;
        this._grab = null;
        Main.popModal(grab);
    }
    this.reactive = false;
    this.remove_all_transitions();
    this._content.remove_all_transitions();
    this._openFade = false;
    this._revealPending = false;
    this._viewToken++;
    this._state = 'closed';
    this.visible = false;
    this._glass?.close();
    this._grid?.close();
    this._entry.text = '';
    this._results.setRows([]);
    this._syncEmptyState();
    this._syncFooter();
    this._content.opacity = 255;
    this.opacity = 255;
    this._rect = null;
    this.emit('closed');
}
```

`_reopen(view)`:

```js
_reopen(view) {
    const grab = Main.pushModal(this, {actionMode: Shell.ActionMode.OVERVIEW});
    if (!grab) {
        this._finishClose();
        return;
    }

    this._grab = grab;
    this.reactive = true;
    this._ease?.destroy();
    this._ease = null;
    this.remove_all_transitions();
    this._viewToken++;
    this._state = 'opening';
    this._motionDone = false;
    this._revealPending = false;

    this._suspendGeometry = true;
    this._setViewState(view);
    this._suspendGeometry = false;
    this._rect = this._targetRect();
    if (!this._rect) {
        this._finishClose();
        return;
    }

    this._content.remove_all_transitions();
    this._content.set_size(this._rect.width, this._rect.height);
    this._content.set_position(0, 0);
    this._content.opacity = 255;

    this._seedSprings(this._panelRect());
    this._springTo(this._rect);

    this._openFade = true;
    this.ease({
        opacity: 255,
        duration: OPEN_FADE_MS,
        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        onComplete: () => {
            this._openFade = false;
            this._finishOpening();
        },
    });

    this._entry.clutter_text.grab_key_focus();
}
```

`open()` while closing never resets opacity to 0: it eases from the current overlay
opacity. The old easing driver is destroyed first, so y and opacity continue from where
they are.

- [ ] **Step 6: Remove old geometry and animation paths**

Replace the old `_setPanelRect`, `_animateOpen`, and `_setView` bodies:

- `_applyGeometry(animate = false)` calls `_targetRect()` and, for this task,
  `_setPanelRectInstant(rect)`; Task 7 replaces the instant call with springs.
- `_targetRect()` keeps the current monitor/panel-box lookup and returns
  `gridPanel(monitor, topBarBottom)` or
  `searchPanel(monitor, topBarBottom, this._searchHeight, compact)`.
- `_setView(view)` for now: if the view is unchanged, focus the entry; otherwise
  `_setViewState(view); _applyGeometry(false);`.
- `toggle()`, `showApps()`, and `focusSearch()` treat `closing` as not open:

```js
    toggle() {
        if (this._state === 'closing')
            this.open('search');
        else if (this.visible)
            this.close();
        else
            this.open('search');
    }

    showApps() {
        if (this._state === 'closing') {
            this.open('grid');
            return;
        }
        if (this.visible)
            this._setView('grid');
        else
            this.open('grid');
    }

    focusSearch() {
        if (this._state === 'closing' || !this.visible)
            this.open('search');
        else
            this._setView('search');
        this._entry.clutter_text.grab_key_focus();
    }
```

- Delete `_scheduleGlassThaw`, `_cancelGlassThaw`, and all `_glass.freeze()`/`thaw()`.
- In `refreshApps()`, set `this._results.setMaxRows(this._maxRows)` first, then call
  `_applyGeometry(this.visible && this._view === 'search')`.
- `_activateRow` calls `this.close({immediate: true})` after `_onActivate`.
- The monitors handler calls `this.close({immediate: true}); this.open(view);`.
- `GLASS_KEYS` becomes `new Set(['glass-brightness', 'animations'])`.
- The `max-results` handler updates `this._maxRows` and calls `refreshApps()` without
  `_applyGeometry`: rows are independent of the panel height.
- The `search-height` handler calls `_applyGeometry()` when visible.
- `destroy()` calls `this._motion?.destroy()`, `this._ease?.destroy()`, and the glass
  destroy; no thaw timer.

- [ ] **Step 7: Run and commit**

```bash
make lint
git add extension/src/overlay.js
git commit -m "feat: give the overlay an open and close state machine"
```

---

## Task 7: Spring search, grid, and view transitions

**Files:**
- Modify: `extension/src/overlay.js`

**Interfaces:**
- `_applyGeometry(animate)` retargets the four `MOVE` springs instead of snapping.
- `_setView(view)` keeps the outgoing content size for 80 ms, applies the new view state,
  resizes the content once, and reveals it near the end of the geometry spring.
- No new public API.

- [ ] **Step 1: Replace `_applyGeometry`**

```js
_applyGeometry(animate = false) {
    if (this._suspendGeometry)
        return;

    const rect = this._targetRect();
    if (!rect)
        return;

    if (this._rect && this._rect.x === rect.x && this._rect.y === rect.y &&
        this._rect.width === rect.width && this._rect.height === rect.height)
        return;

    if (!this.visible || !animate || !this._animationsEnabled() ||
        this._state !== 'open') {
        this._setPanelRectInstant(rect);
        return;
    }

    const growing = rect.width >= this._content.width &&
        rect.height >= this._content.height;
    this._rect = rect;

    if (growing)
        this._content.set_size(rect.width, rect.height);

    this._springTo(rect, growing ? null : () => {
        this._content.set_size(rect.width, rect.height);
    });
}
```

`_targetRect()` is the old `_applyGeometry` body without setting anything:

```js
_targetRect(view = this._view) {
    const monitor = Main.layoutManager.monitors[this._monitorIndex] ??
        Main.layoutManager.primaryMonitor;
    if (!monitor)
        return null;

    const panelBox = Main.layoutManager.panelBox;
    const topBarBottom = panelBox ? panelBox.y + panelBox.height : monitor.y;

    if (view === 'grid')
        return gridPanel(monitor, topBarBottom);

    const compact = this._entry.text.trim() === '';
    return searchPanel(monitor, topBarBottom, this._searchHeight, compact);
}
```

`_targetRect()` only measures. `refreshApps()` owns the row cap via
`this._results.setMaxRows(this._maxRows)`; `max-results` never changes the panel height.

- [ ] **Step 2: Add the reveal threshold**

Add to `_onMotionFrame`, after the glass `setRect` call and before the settle check:

```js
    if (this._revealPending &&
        this._travelLeft() <= Math.max(1, this._geometryTravel * 0.2))
        this._reveal(this._viewToken);
```

Add:

```js
_travelLeft() {
    return Math.max(
        Math.abs(this._springs.x.target - this._springs.x.value),
        Math.abs(this._springs.y.target - this._springs.y.value),
        Math.abs(this._springs.width.target - this._springs.width.value),
        Math.abs(this._springs.height.target - this._springs.height.value));
}

_reveal(token) {
    if (token !== this._viewToken || !this._revealPending)
        return;
    this._revealPending = false;
    this._content.remove_all_transitions();
    this._content.opacity = 0;
    this._content.ease({
        opacity: 255,
        duration: CONTENT_IN_MS,
        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
    });
}
```

At the settle branch, before `_finishOpening()`:

```js
    if (this._revealPending)
        this._reveal(this._viewToken);
```

- [ ] **Step 3: Replace `_setView` with the animated switch**

```js
_setView(view) {
    const next = view === 'grid' ? 'grid' : 'search';
    if (next === this._view) {
        this._entry.clutter_text.grab_key_focus();
        return;
    }

    this._content.remove_all_transitions();
    this._viewToken++;

    if (!this.visible || this._state !== 'open' ||
        !this._animationsEnabled()) {
        this._revealPending = false;
        this._content.opacity = 255;
        this._setViewState(next);
        this._applyGeometry(false);
        return;
    }

    const token = this._viewToken;
    const target = this._targetRect(next);
    if (!target)
        return;
    this._view = next;
    this._rect = target;
    this._revealPending = false;
    this._springTo(target);

    this._content.ease({
        opacity: 0,
        duration: CONTENT_OUT_MS,
        mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        onComplete: () => {
            if (token !== this._viewToken || this._state !== 'open')
                return;

            // The outgoing content is hidden by opacity 0; resize while it
            // is invisible so the incoming grid lays out once at its target.
            this._content.set_size(target.width, target.height);
            this._content.set_position(0, 0);
            this._setViewState(next);
            this._content.opacity = 0;
            this._revealPending = true;

            if (this._allSettled() ||
                this._travelLeft() <= Math.max(1, this._geometryTravel * 0.2))
                this._reveal(token);
        },
    });
}
```

`_setViewState(next)` still sets `this._view = next`; the assignment above makes
`overlay.view` report the requested view immediately while the old children stay visible
for the fade.

- [ ] **Step 4: Keep compact and setting changes on the same path**

- `refreshApps()` calls `_applyGeometry(this.visible && this._view === 'search')`.
- The `search-height` setting handler updates `this._searchHeight` and calls
  `_applyGeometry()`.
- The first keystroke grows compact → expanded: `_applyGeometry` sees a growing target,
  sizes the content before the spring, and the panel clip reveals the results.
- Clearing the query shrinks the panel; the content keeps its expanded size until the
  spring settles, then resizes once.
- `max-results` continues to call `refreshApps()` without `_applyGeometry`.
- `_setPanelRectInstant` removes content transitions and resets `_revealPending` before
  snapping:

```js
    this._content.remove_all_transitions();
    this._revealPending = false;
```

- [ ] **Step 5: Run and commit**

```bash
make lint
git add extension/src/overlay.js
git commit -m "feat: spring the search, grid, and view geometry"
```

---

## Task 8: Reopen the requested view from the close fade

**Files:**
- Modify: `extension/src/overview.js`

**Interfaces:**
- `toggle()` and `toggleApps()` check `overlay.closing` before treating a visible overlay
  as already open. No keybinding changes.

- [ ] **Step 1: Update the two handlers**

```js
    toggle() {
        if (this._overlay.closing)
            this._overlay.open('search');
        else if (this._overlay.visible)
            this._overlay.close();
        else
            this._closeNative(() => this._overlay.open('search'));
    }

    toggleApps() {
        if (this._overlay.closing)
            this._overlay.open('grid');
        else if (this._overlay.visible && this._overlay.view === 'grid')
            this._overlay.focusSearch();
        else
            this._closeNative(() => this._overlay.showApps());
    }
```

A second Super during close reopens search; a second Super+A reopens the grid. Super in
an open grid still closes Sift; Super+A in an open grid still focuses search.

- [ ] **Step 2: Run and commit**

```bash
make lint
git add extension/src/overview.js
git commit -m "fix: reopen the requested view while Sift is closing"
```

---

## Task 9: Stylesheet for one glass style and readable text

**Files:**
- Modify: `extension/stylesheet.css`

**Interfaces:**
- One panel rule, one fallback class, and scheme-specific text/icon shadows. No
  `sift-glass-liquid`, `sift-glass-frosted`, or `sift-glass-off` selectors.

- [ ] **Step 1: Replace the panel rules**

Replace lines 3–21 with:

```css
.sift-panel {
    background-color: transparent;
    /* The shader paints the fill and the rounded edge; a CSS border would sit
       outside the shader's antialiased cut. */
}

.sift-panel.sift-glass-fallback {
    background-color: rgba(28, 30, 36, 0.92);
    border-radius: 18px;
}
```

The light scheme's fallback keeps the same dark panel for legibility; the shader is the
only style that follows the scheme.

- [ ] **Step 2: Add text and icon shadows**

After the existing `.sift-light` rules, append:

```css
/* The glass brightness never flips the text colour: dark scheme stays white,
   light scheme stays dark. These soft shadows hold the contrast over windows. */
.sift-dark .sift-entry,
.sift-dark .sift-entry StLabel.hint-text,
.sift-dark .sift-row-title,
.sift-dark .sift-row-subtitle,
.sift-dark .sift-footer-hint,
.sift-dark .sift-empty-title,
.sift-dark .sift-empty-hint,
.sift-dark .sift-empty-button {
    text-shadow: 0 1px 3px rgba(0, 0, 0, 0.55);
}

.sift-dark .sift-search-icon,
.sift-dark .sift-row-icon,
.sift-dark .sift-grid-button {
    icon-shadow: 0 1px 3px rgba(0, 0, 0, 0.55);
}

.sift-light .sift-entry,
.sift-light .sift-entry StLabel.hint-text,
.sift-light .sift-row-title,
.sift-light .sift-row-subtitle,
.sift-light .sift-footer-hint,
.sift-light .sift-empty-title,
.sift-light .sift-empty-hint,
.sift-light .sift-empty-button {
    text-shadow: 0 1px 2px rgba(255, 255, 255, 0.65);
}

.sift-light .sift-search-icon,
.sift-light .sift-row-icon,
.sift-light .sift-grid-button {
    icon-shadow: 0 1px 2px rgba(255, 255, 255, 0.65);
}
```

- [ ] **Step 3: Run and commit**

```bash
make lint
git add extension/stylesheet.css
git commit -m "style: paint one liquid glass and shadow its text"
```

---

## Task 10: Headless shell coverage and verification

**Files:**
- Modify: `tools/test/headless.js`

**Interfaces:**
- Adds `openOverlay(api, view)`, `closeOverlay(api)`, and `settle(api)` helpers.
- Removes every `glass-mode`/`glass-opacity`/`blur-radius`/`glass-tint` assertion and
  every immediate `glass.rect` assertion after a transition.

- [ ] **Step 1: Add the async helpers**

Next to `waitFor`:

```js
async function settle(api, message = 'the overlay settles') {
    await waitFor(() => !api.overlay.animating, message, 2000);
}

async function openOverlay(api, view = 'search') {
    api.overlay.open(view);
    await waitFor(() => api.overlay.visible && api.overlay.view === view,
        `the overlay opens ${view}`, 2000);
    await settle(api, `the overlay settles ${view}`);
}

async function closeOverlay(api, options) {
    api.overlay.close(options);
    await waitFor(() => !api.overlay.visible, 'the overlay closes', 2000);
}
```

- [ ] **Step 2: Replace the old glass assertions**

Delete the `savedGlassMode`, `savedBlurRadius`, and the `set_string('glass-mode')`,
`set_int('blur-radius')`, and `effectiveMode` block. Replace it with:

```js
    const savedBrightness = api.settings.get_int('glass-brightness');
    const clones = api.glass.cloneCount;
    api.settings.set_int('glass-brightness', 0);
    await Scripting.waitLeisure();
    assert(api.glass.brightness === 0 && api.glass.blurRadius === 30,
        'dark brightness applies live');
    assert(api.glass.cloneCount === clones,
        'brightness does not rebuild the backdrop');

    api.settings.set_int('glass-brightness', 100);
    await Scripting.waitLeisure();
    assert(api.glass.brightness === 100 && api.glass.blurRadius === 14,
        'clear brightness applies live');
    assert(api.glass.cloneCount === clones,
        'the clear end keeps the same copies');

    api.settings.set_int('glass-brightness', savedBrightness);
    await Scripting.waitLeisure();
    assert(api.glass.blurRadius === 22, 'the default brightness blurs 22 px');
```

Add the settle/reopen checks after the brightness block:

```js
    await openOverlay(api, 'search');
    api.overlay.close();
    assert(api.overlay.closing, 'close reports the closing state');
    assert(!api.overlay.reactive, 'close releases input at once');
    assert(Main.modalCount === 0, 'close pops the modal grab at once');
    api.blocker.toggle();
    await waitFor(() => api.overlay.visible && !api.overlay.closing,
        'Super reopens search during close', 2000);
    await settle(api, 'the reopened search settles');
    assert(api.overlay.view === 'search', 'reopening keeps search');
    await closeOverlay(api);

    api.blocker.toggleApps();
    await waitFor(() => api.overlay.visible && api.overlay.view === 'grid',
        'Super+A opens the grid for the close test', 2000);
    await settle(api, 'the grid settles before close');
    api.overlay.close();
    assert(api.overlay.closing, 'the grid starts its close fade');
    api.blocker.toggleApps();
    await waitFor(() => api.overlay.visible && !api.overlay.closing,
        'Super+A reopens the grid during close', 2000);
    await settle(api, 'the reopened grid settles');
    assert(api.overlay.view === 'grid', 'reopening keeps the grid');
    await closeOverlay(api);

    await openOverlay(api, 'search');
    api.overlay._activateRow({kind: 'calc', result: '2'});
    assert(!api.overlay.visible,
        'activation closes immediately, without the fade');
    assert(api.glass.cloneCount === 0, 'activation removes the copies at once');
```

`_activateRow` is already used by the tests as a private entry point; a calc row does no
file or app work.

- [ ] **Step 3: Wait for every transition**

- After each `blocker.toggle()`, `blocker.toggleApps()`, `focusSearch()`,
  `overlay.open()`, or `Main.overview.show(APP_GRID)` open, wait for the expected view and
  call `settle(api)` before asserting `glass.rect`.
- Replace every `api.overlay.close(); await Scripting.waitLeisure();` with
  `await closeOverlay(api);` (leave the `close()` + immediate reopen in the animations-off
  block, which is synchronous).
- Every close through `global.display.emit('overlay-key')`, `blocker.toggle()`, or
  `blocker.toggleApps()` now fades: replace the following `await Scripting.waitLeisure();
  assert(!api.overlay.visible, ...)` with
  `await waitFor(() => !api.overlay.visible, '<label>', 2000);` and keep the assertion
  message on `waitFor`. This applies to the Super close checks near the top, after the
  custom-shortcut reset, and after re-enabling the extension.
- Typing: after `entry.set_text(...)`, `await waitFor(() =>
  api.glass.rect.height === 404, 'typing settles the expanded height', 2000);` before
  the height assertion.
- Clearing: wait for `glass.rect.height === 60`.
- `search-height = 300`: wait for `glass.rect.height === 300` before computing
  `visibleRows`.
- View switch: wait for `!api.overlay.animating` before
  `glass.rect.width > searchRect.width` and before switching back.
- Escape: after `handleKey('Escape')`, assert `api.overlay.closing` immediately, then
  `await waitFor(() => !api.overlay.visible, ...)`, then `cloneCount === 0`.
- The animations-off block:

```js
    api.settings.set_boolean('animations', false);
    await Scripting.waitLeisure();
    await closeOverlay(api);
    await openOverlay(api, 'search');
    assert(api.overlay.visible && !api.overlay.animating,
        'opens without animation');
    api.settings.set_boolean('animations', savedAnimations);
```

- Remove the duplicate back-to-back `overlay.close()` calls; one `closeOverlay` is enough.

- [ ] **Step 4: Run the full automated gate**

```bash
make lint
make test-gjs
make test-schema
make test-shell
```

Expected: all pass, and the headless run ends with `sift shell smoke ok`.

- [ ] **Step 5: Install and reload**

```bash
make install
gnome-extensions disable sift@alphabeast97.github.io
gnome-extensions enable sift@alphabeast97.github.io
journalctl -f -o cat /usr/bin/gnome-shell
```

Expected: no Sift warnings or errors, and the preferences window shows only Brightness
and Animations in the Glass group.

- [ ] **Step 6: Commit**

```bash
git add tools/test/headless.js
git commit -m "test: cover brightness, springs, close, and reopen"
```

- [ ] **Step 7: Hand over for visual approval**

Ask the user to check, on the real session:

- Search starts compact, expands on the first keystroke, and collapses when cleared; the
  results are revealed by the clip and never reflow.
- Search ↔ grid grows/shrinks without stretched text or icons.
- Close slides/fades, releases input at once, and a second Super/Super+A during the fade
  reopens the right view without a flash.
- Brightness 0, 50, and 100 look intentional; dark-scheme white text and light-scheme
  dark text stay readable over a white window at 100.
- Light glass over a white window still shows its dark edge at 0, 50, and 100.
- Overlapping windows and a dialog behind the panel stack correctly; moving a window
  updates the backdrop without a clone pop during a view switch.
- Open, typing, view switches, and close feel like constant 60 fps at 1.25 scale.

Do not tag or publish. If the user asks for tuning, change only preset numbers,
`MOVE`, or the reveal fraction.

---

## Self-review checklist (run before handing over)

- [ ] Design §5.1: one `glass-brightness` key, presets, pad/radius, live update.
- [ ] Design §5.2: fixed layout, shape/frame/content tree, no CSS border or modes.
- [ ] Design §5.3: `AreaClone`, cached places, coalesced sync, union, no rebuild on move.
- [ ] Design §5.4: `effectPoint`, lens, tone, saturation, sheen, glow, rim mix, fill,
  input alpha.
- [ ] Design §5.5: `MOVE`, springs, open/close, compact, view switch, reopen, snap close,
  animations off.
- [ ] Design §5.7: every listed file touched, no new preference.
- [ ] Every new branch has a unit or headless check; no clone walk or window walk in the
  per-frame path.
- [ ] `git status` clean after the final commit; no tag and no push.
