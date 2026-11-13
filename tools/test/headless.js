// SPDX-License-Identifier: GPL-3.0-or-later
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as OverviewControls from 'resource:///org/gnome/shell/ui/overviewControls.js';
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
    await waitFor(() => !Main.overview.visible, 'enable closes a pre-existing overview');
    api = Extension.lookupByUUID(UUID).getTestAPI();
    assert(api.takeover.installed, 'takeover reinstalled');

    print('sift shell smoke ok');
}
