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
