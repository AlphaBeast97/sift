// SPDX-License-Identifier: GPL-3.0-or-later
// Headless shell benchmark. Run with `make perf`; prints Markdown so the
// README numbers come from this command instead of a stale measurement.
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as Scripting from 'resource:///org/gnome/shell/ui/scripting.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import {ExtensionState} from 'resource:///org/gnome/shell/misc/extensionUtils.js';

const UUID = 'sift@alphabeast97.github.io';

function now() {
    return GLib.get_monotonic_time() / 1000;
}

function median(values) {
    const sorted = [...values].sort((left, right) => left - right);
    return sorted[Math.floor(sorted.length / 2)];
}

function format(milliseconds) {
    return `${milliseconds.toFixed(1)}ms`;
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

async function enable() {
    const start = now();
    Main.extensionManager.enableExtension(UUID);
    await waitFor(() => state() === ExtensionState.ACTIVE,
        'the extension is active');
    return now() - start;
}

export async function run() {
    await waitFor(() => state() === ExtensionState.ACTIVE,
        'the extension starts active');

    const enableTimes = [];
    for (let index = 0; index < 3; index++) {
        Main.extensionManager.disableExtension(UUID);
        await waitFor(() => state() === ExtensionState.INACTIVE,
            'the extension is inactive');
        enableTimes.push(await enable());
    }
    await Scripting.waitLeisure();

    const api = Extension.lookupByUUID(UUID).getTestAPI();
    const apps = Shell.AppSystem.get_default().get_installed()
        .filter(app => app.should_show());
    const target = apps.find(app => app.get_name().length >= 4);

    let start = now();
    const snapshot = api.apps.gridApps('az');
    const snapshotTime = now() - start;

    start = now();
    api.apps.gridApps('az');
    const cachedSnapshotTime = now() - start;

    const searchTimes = [];
    if (target) {
        for (let index = 0; index < 50; index++) {
            start = now();
            api.apps.search(target.get_name(), 8);
            searchTimes.push(now() - start);
        }
    }

    api.overlay.close({immediate: true});
    await Scripting.waitLeisure();

    const openTimes = [];
    for (let index = 0; index < 5; index++) {
        start = now();
        api.overlay.open('search');
        openTimes.push(now() - start);
        await Scripting.waitLeisure();
        api.overlay.close({immediate: true});
        await Scripting.waitLeisure();
    }

    api.overlay.open('search');
    await Scripting.waitLeisure();
    const typeTimes = [];
    if (target) {
        for (let index = 0; index < 10; index++) {
            api.overlay.entry.set_text('');
            await Scripting.waitLeisure();
            start = now();
            api.overlay.entry.set_text(target.get_name());
            typeTimes.push(now() - start);
            await Scripting.waitLeisure();
        }
    }
    api.overlay.entry.set_text('');
    await Scripting.waitLeisure();
    api.overlay.close({immediate: true});
    await Scripting.waitLeisure();

    api.overlay._prewarmGrid();
    await waitFor(() => !api.appGrid._chunkId &&
        api.appGrid._tiles.length === api.appGrid.itemCount,
    'the grid prewarms', 10000);

    const gridTimes = [];
    for (let index = 0; index < 3; index++) {
        start = now();
        api.overlay.open('grid');
        gridTimes.push(now() - start);
        await Scripting.waitLeisure();
        api.overlay.close({immediate: true});
        await Scripting.waitLeisure();
    }

    print('');
    print(`<!-- ${global.stage.width}x${global.stage.height}, ${apps.length} apps, ` +
        `${snapshot.length} grid entries -->`);
    print('| Path | Time |');
    print('| --- | --- |');
    print(`| Extension enable (disable to active) | ${format(median(enableTimes))} |`);
    print(`| App snapshot, first call (${snapshot.length} apps) | ${format(snapshotTime)} |`);
    print(`| App snapshot, cached | ${format(cachedSnapshotTime)} |`);
    print(`| App search, exact name | ${format(median(searchTimes))} |`);
    print(`| Search open, warm | ${format(median(openTimes))} |`);
    print(`| Typing an exact app name | ${format(median(typeTimes))} |`);
    print(`| App grid open, prewarmed | ${format(median(gridTimes))} |`);
}
