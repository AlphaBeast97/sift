// SPDX-License-Identifier: GPL-3.0-or-later
// Release resource report. Run with `make resources`; writes JSON to
// SIFT_RESOURCE_REPORT for the release notes.
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';

const UUID = 'sift@alphabeast97.github.io';

const now = () => GLib.get_monotonic_time() / 1000;

function median(values) {
    const sorted = values.filter(value => value !== null).sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : null;
}

function readRssKb() {
    try {
        const [ok, data] = GLib.file_get_contents('/proc/self/status');
        if (!ok)
            return null;
        const match = new TextDecoder().decode(data)
            .match(/^VmRSS:\s+(\d+) kB/m);
        return match ? Number(match[1]) : null;
    } catch {
        return null;
    }
}

class FrameMeter {
    constructor() {
        this._later = 0;
        this._last = 0;
        this._intervals = [];
    }

    start() {
        this._last = 0;
        this._intervals = [];
        this._later = global.compositor.get_laters().add(
            Meta.LaterType.BEFORE_REDRAW, () => this._tick());
    }

    _tick() {
        const time = now();
        if (this._last !== 0)
            this._intervals.push(time - this._last);
        this._last = time;
        return GLib.SOURCE_CONTINUE;
    }

    stop() {
        if (this._later === 0)
            return;
        global.compositor.get_laters().remove(this._later);
        this._later = 0;
    }

    get summary() {
        const sorted = [...this._intervals].sort((a, b) => a - b);
        return {
            p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0,
            p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0,
            max: sorted.length ? sorted[sorted.length - 1] : 0,
            frames: sorted.length,
        };
    }
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

function state() {
    return Main.extensionManager.lookup(UUID)?.state;
}

async function measureOpen(api, view) {
    const meter = new FrameMeter();
    const start = now();
    api.overlay.open(view);
    const openTime = now() - start;
    meter.start();
    await waitFor(() => !api.overlay.animating, `${view} settles`, 3000);
    await Scripting.waitLeisure();
    meter.stop();
    const frames = meter.summary;
    api.overlay.close({immediate: true});
    await Scripting.waitLeisure();
    return {openTime, ...frames};
}

export async function run() {
    await waitFor(() => state() === ExtensionState.ACTIVE,
        'the extension starts active');

    const cycles = [];
    for (let index = 0; index < 4; index++) {
        Main.extensionManager.disableExtension(UUID);
        await waitFor(() => state() === ExtensionState.INACTIVE,
            'the extension is inactive');

        const enableStart = now();
        Main.extensionManager.enableExtension(UUID);
        await waitFor(() => state() === ExtensionState.ACTIVE,
            'the extension is active');
        const enableTime = now() - enableStart;

        const api = Extension.lookupByUUID(UUID).getTestAPI();
        const prewarmStart = now();
        await waitFor(() => api.overlay._prewarmPainted &&
            !api.overlay._prewarming, 'the prewarm paints', 10000);
        const prewarmTime = now() - prewarmStart;

        // Alternate which view opens first so both get a real first open.
        const firstView = index % 2 === 0 ? 'grid' : 'workspace';
        const secondView = firstView === 'grid' ? 'workspace' : 'grid';
        const first = await measureOpen(api, firstView);
        const second = await measureOpen(api, secondView);
        cycles.push({
            enableTime,
            prewarmTime,
            firstView,
            first,
            second,
            rssKb: readRssKb(),
        });
    }

    const firsts = view => cycles.filter(cycle => cycle.firstView === view)
        .map(cycle => cycle.first);
    const summary = {
        enable_ms: median(cycles.map(cycle => cycle.enableTime)),
        prewarm_ms: median(cycles.map(cycle => cycle.prewarmTime)),
        grid_first_open_max_frame_ms:
            median(firsts('grid').map(result => result.max)),
        grid_first_open_p95_frame_ms:
            median(firsts('grid').map(result => result.p95)),
        workspace_first_open_max_frame_ms:
            median(firsts('workspace').map(result => result.max)),
        workspace_first_open_p95_frame_ms:
            median(firsts('workspace').map(result => result.p95)),
        shell_rss_kb: median(cycles.map(cycle => cycle.rssKb)),
    };

    const report = {
        version: 1,
        os: GLib.get_os_info('PRETTY_NAME'),
        cycles,
        summary,
    };
    const json = JSON.stringify(report, null, 2);
    print(`SIFT_RESOURCE ${JSON.stringify(summary)}`);

    const path = GLib.getenv('SIFT_RESOURCE_REPORT');
    if (path && !GLib.file_set_contents(path, json))
        throw new Error(`cannot write ${path}`);
}
