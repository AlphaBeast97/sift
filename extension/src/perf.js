import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import {percentile} from './lib/stats.js';

export class FrameMeter {
    constructor() {
        this._later = 0;
        this._last = 0;
        this._intervals = [];
    }

    start() {
        this.stop();
        this._last = 0;
        this._intervals = [];
        this._later = global.compositor.get_laters().add(
            Meta.LaterType.BEFORE_REDRAW, () => this._tick());
    }

    _tick() {
        const now = GLib.get_monotonic_time() / 1000;
        if (this._last !== 0)
            this._intervals.push(now - this._last);
        this._last = now;
        return GLib.SOURCE_CONTINUE;
    }

    stop() {
        if (this._later === 0)
            return;

        global.compositor.get_laters().remove(this._later);
        this._later = 0;
    }

    get summary() {
        return {
            p50: percentile(this._intervals, 0.5),
            p95: percentile(this._intervals, 0.95),
            max: this._intervals.length ? Math.max(...this._intervals) : 0,
            frames: this._intervals.length,
        };
    }
}
