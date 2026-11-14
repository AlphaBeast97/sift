// SPDX-License-Identifier: GPL-3.0-or-later
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

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

// Pages are laid out horizontally; an icon that outgrows its page or cell
// overlaps the next page or the next icon.
function gridFits(grid) {
    const manager = grid.layout_manager;
    for (let page = 0; page < grid.nPages; page++) {
        const items = grid.getItemsAtPage(page).filter(item => item.visible);
        for (let i = 0; i < items.length; i++) {
            const a = items[i].allocation;
            if (a.x1 - page * manager.pageWidth < -1 ||
                a.x2 - page * manager.pageWidth > manager.pageWidth + 1 ||
                a.y1 < -1 || a.y2 > manager.pageHeight + 1)
                return false;

            for (let j = i + 1; j < items.length; j++) {
                const b = items[j].allocation;
                if (a.x1 < b.x2 && b.x1 < a.x2 &&
                    a.y1 < b.y2 && b.y1 < a.y2)
                    return false;
            }
        }
    }
    return true;
}

async function waitForGrid(grid, message) {
    try {
        await waitFor(() => gridFits(grid), message, 2000);
    } catch (error) {
        const manager = grid.layout_manager;
        print(`${message}: page=${manager.pageWidth}x${manager.pageHeight} ` +
            `cols=${manager.columns_per_page} rows=${manager.rows_per_page} ` +
            `pages=${grid.nPages} cell=${manager._getChildrenMaxSize()}`);
        for (let page = 0; page < grid.nPages; page++) {
            const items = grid.getItemsAtPage(page).filter(i => i.visible);
            let x2 = -Infinity;
            let y2 = -Infinity;
            for (const item of items) {
                x2 = Math.max(x2, item.allocation.x2 - page * manager.pageWidth);
                y2 = Math.max(y2, item.allocation.y2);
            }
            print(` page ${page}: ${items.length} maxX=${x2} maxY=${y2}`);
        }
        const tile = grid.getItemsAtPage(0).find(i => i.visible);
        if (tile) {
            print(` tile iconSize=${tile.icon.iconSize} ` +
                `tile=${tile.get_preferred_width(-1)[0]}x` +
                `${tile.get_preferred_height(-1)[0]} ` +
                `icon=${tile.icon.get_preferred_width(-1)[0]}x` +
                `${tile.icon.get_preferred_height(-1)[0]} ` +
                `appGrid=${grid.get_parent().width}x${grid.get_parent().height}`);
        }
        throw error;
    }
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
    assert(!api.overlay.emptyVisible, 'the empty query shows only the search bar');
    assert(api.glass.rect.height === 60,
        'the empty query uses the compact bar height');
    assert(api.overlay.entry.accessible_name === 'Search', 'entry is named Search');

    Main.overview.show(OverviewControls.ControlsState.APP_GRID);
    await Scripting.waitLeisure();
    assert(api.overlay.view === 'grid', 'show(APP_GRID) opens grid');

    Main.overview.focusSearch();
    await Scripting.waitLeisure();
    assert(api.overlay.view === 'search' && api.overlay.entry.clutter_text.has_key_focus(),
        'focusSearch focuses the entry text');

    const installed = Shell.AppSystem.get_default().get_installed();
    const target = installed.find(a => a.get_name().length >= 4 &&
        installed.filter(b => b.get_name() === a.get_name()).length === 1);
    assert(target !== undefined, 'installed apps available');
    api.overlay.entry.set_text(target.get_name());
    await Scripting.waitLeisure();
    assert(api.overlay.rowCount > 0, 'app results render');
    assert(!api.overlay.emptyVisible, 'results hide the empty state');
    assert(api.overlay.rows[0].title === target.get_name(), 'exact app name ranks first');
    assert(api.glass.rect.height === 404,
        'typing expands the panel to its fixed height');

    if (GLib.getenv('SIFT_E2E') !== '1') {
        api.overlay.entry.set_text(target.get_name());
        await Scripting.waitLeisure();
        await waitFor(() => api.overlay.rowCount > 0, 'apps still work', 2000);

        // Skip when the installed daemon answers on this session bus.
        if (api.overlay.footerText === 'Search service unavailable') {
            await waitFor(() => api.overlay.footerText === 'Search service unavailable',
                'footer reports the missing service', 2000);

            api.overlay.entry.set_text(target.get_name().slice(0, -1));
            await Scripting.waitLeisure();
            await Scripting.sleep(100);
            assert(api.overlay.footerText === 'Search service unavailable',
                'the service footer does not stack');
        }
    }

    if (GLib.getenv('SIFT_E2E') === '1') {
        api.overlay.open();
        api.overlay.entry.set_text('sift-e2e-report');
        await Scripting.waitLeisure();
        await waitFor(() => api.overlay.rows.some(r =>
            r.kind === 'file' && r.title === 'sift-e2e-report.pdf'), 'file result', 3000);

        api.overlay.entry.set_text('1+1');
        await waitFor(() => api.overlay.rows.some(r =>
            r.kind === 'calc' && r.title === '2'), 'calc result', 3000);

        for (const text of ['s', 'si', 'sif', 'sift'])
            api.overlay.entry.set_text(text);
        await Scripting.sleep(600);
        assert(api.overlay.rows.every(r => r.kind !== 'calc'), 'stale calc reply dropped');
    }

    const fake = {files: [], calc: {expression: '1+1', result: '2'}};
    api.daemon.query = () => Promise.resolve(fake);
    api.overlay.entry.set_text(target.get_name());
    await Scripting.waitLeisure();
    await waitFor(() => api.overlay.rows.some(row => row.kind === 'calc'),
        'calc row merges', 2000);
    assert(api.overlay.rows[0].kind === 'calc', 'calc ranks before apps');

    api.overlay.handleKey('Down', 0);
    const selectedKey = api.overlay.rows[api.overlay.selectedIndex].key;
    assert(api.overlay.rows[api.overlay.selectedIndex].kind === 'app',
        'an app row is selected');

    fake.files = [{path: '/tmp/sift-report.pdf', name: 'sift-report.pdf', kind: 'file'}];
    api.overlay.entry.set_text(`${target.get_name()} `);
    await Scripting.waitLeisure();
    await waitFor(() => api.overlay.rows.some(row => row.kind === 'file'),
        'file results render', 2000);
    assert(api.overlay.rows[api.overlay.selectedIndex].key === selectedKey,
        'selection survives a file tail');

    api.settings.set_int('max-results', 4);
    await Scripting.waitLeisure();
    assert(api.overlay.maxRows === 4 && api.overlay.rowCount <= 4,
        'max-results applies live without reopening');
    assert(api.glass.rect.height === 404,
        'max-results does not change the panel height');
    api.settings.set_int('max-results', 6);
    api.overlay.entry.set_text('');

    api.settings.set_int('max-results', 12);
    api.settings.set_int('search-height', 300);
    fake.files = Array.from({length: 20}, (_, i) => ({
        path: `/tmp/sift-scroll-${i}.txt`,
        name: `sift-scroll-${i}.txt`,
        kind: 'file',
    }));
    api.overlay.entry.set_text('scroll');
    await Scripting.waitLeisure();
    await waitFor(() => api.overlay.rowCount === 12, 'overflow rows render', 2000);
    assert(api.glass.rect.height === 300,
        'the panel height setting applies live');

    const visibleRows = Math.round((api.glass.rect.height - 92) / 52);
    assert(visibleRows < api.overlay.rowCount, 'overflowing results fit in rows');
    api.overlay.handleKey('End', 0);
    await Scripting.waitLeisure();
    assert(api.overlay.selectedIndex === 11, 'End selects the last result');
    assert(api.overlay.scrollView.vadjustment.value > 0,
        'keyboard selection scrolls into view');

    api.settings.set_int('max-results', 6);
    api.settings.set_int('search-height', 404);
    fake.files = [];
    api.overlay.entry.set_text('');
    await Scripting.waitLeisure();

    const savedGlassMode = api.settings.get_string('glass-mode');
    const savedBlurRadius = api.settings.get_int('blur-radius');
    const savedAnimations = api.settings.get_boolean('animations');
    const searchRect = api.glass.rect;

    api.settings.set_string('glass-mode', 'liquid');
    await Scripting.waitLeisure();
    assert(api.glass.effectiveMode === 'liquid', 'glass mode applies live');

    api.settings.set_int('blur-radius', 0);
    await Scripting.waitLeisure();
    assert(api.glass.blurRadius === 0, 'blur radius applies live');

    api.settings.set_string('glass-mode', 'off');
    await Scripting.waitLeisure();
    assert(api.glass.effectiveMode === 'off', 'glass off applies live');

    api.settings.set_string('glass-mode', savedGlassMode);
    api.settings.set_int('blur-radius', savedBlurRadius);
    await Scripting.waitLeisure();
    assert(api.glass.effectiveMode === 'off' || api.glass.cloneCount > 0,
        'clones return when glass is re-enabled');

    api.settings.set_boolean('animations', false);
    await Scripting.waitLeisure();
    api.overlay.close();
    api.overlay.open();
    await Scripting.waitLeisure();
    assert(api.overlay.visible && !api.overlay.animating,
        'opens without animation');
    api.settings.set_boolean('animations', savedAnimations);
    await Scripting.waitLeisure();

    api.overlay.entry.set_text('fire');
    api.overlay.showApps();
    await Scripting.waitLeisure();
    assert(api.overlay.view === 'grid', 'grid view is active');
    assert(api.overlay.entry.text === '', 'entering grid clears query');
    assert(api.glass.rect.width > searchRect.width, 'glass rect follows the grid');
    assert(api.appGrid.iconSize === 96, 'default icon size');
    await waitFor(() => api.appGrid.itemCount > 0, 'grid apps load', 2000);
    await waitFor(() => !api.appGrid._chunkId, 'grid build settles', 2000);
    await Scripting.waitLeisure();
    await waitForGrid(api.appGrid._grid, 'grid icons fit their pages');

    api.overlay.handleKey('t', 0);
    api.overlay.entry.set_text('t');
    await Scripting.waitLeisure();
    assert(api.overlay.view === 'search' && api.overlay.entry.text === 't',
        'typing returns to search');

    api.overlay.showApps();
    await Scripting.waitLeisure();
    api.settings.set_int('grid-icon-size', 64);
    await Scripting.waitLeisure();
    assert(api.appGrid.iconSize === 64, 'icon size applies live');
    await waitForGrid(api.appGrid._grid, 'grid icons fit after shrinking');
    api.settings.set_int('grid-icon-size', 96);
    await Scripting.waitLeisure();
    await waitForGrid(api.appGrid._grid, 'grid icons fit after growing');

    api.overlay.handleKey('Escape', 0);
    await waitFor(() => !api.overlay.visible, 'escape closes the grid');
    assert(api.glass.cloneCount === 0, 'clones removed on close');

    api.overlay.open();
    await Scripting.waitLeisure();

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
