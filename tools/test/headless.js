// SPDX-License-Identifier: GPL-3.0-or-later
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

    const api = ext.getTestAPI();
    api.overlay.open();
    await Scripting.waitLeisure();
    assert(api.overlay.visible, 'overlay opens');
    assert(api.overlay.entry.clutter_text.has_key_focus(), 'entry has focus');

    api.overlay.showApps();
    await Scripting.waitLeisure();
    assert(api.overlay.view === 'grid', 'grid view opens');

    api.overlay.focusSearch();
    await Scripting.waitLeisure();
    assert(api.overlay.view === 'search', 'focusSearch returns to search');

    api.overlay.close();
    await Scripting.waitLeisure();
    assert(!api.overlay.visible, 'overlay closes');

    Main.extensionManager.disableExtension(UUID);
    await waitFor(() => Main.extensionManager.lookup(UUID)?.state === ExtensionState.INACTIVE,
        'extension is inactive on disable');

    Main.extensionManager.enableExtension(UUID);
    await waitFor(() => Main.extensionManager.lookup(UUID)?.state === ExtensionState.ACTIVE,
        'extension re-enables');

    print('sift shell smoke ok');
}
