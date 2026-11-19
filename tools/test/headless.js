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

    // The GNOME overview is disabled by default; Super and Super+A are Sift's
    // defaults, and every other GNOME trigger does nothing.
    assert(api.settings.get_boolean('disable-overview'),
        'the GNOME overview is disabled by default');
    assert(Main.overview.shouldToggleByCornerOrButton() === false,
        'the hot corner is disabled');
    Main.overview.toggle();
    Main.overview.show();
    Main.overview.focusSearch();
    Main.layoutManager.showOverview();
    await Scripting.waitLeisure();
    assert(!Main.overview.visible, 'GNOME overview shortcuts do nothing');
    assert(!Main.layoutManager.overviewGroup.visible,
        'the overview group cannot be shown directly');
    assert(!api.overlay.visible, 'the unmentioned overview triggers do not open Sift');
    assert(!Main.wm._allowedKeybindings['sift-search-shortcut'],
        'the search key is unbound while Super is the default');
    assert(!Main.wm._allowedKeybindings['sift-apps-shortcut'],
        'the app-grid key is unbound while Super+A is the default');

    global.display.emit('overlay-key');
    await waitFor(() => api.overlay.visible && api.overlay.view === 'search',
        'Super opens Sift search', 2000);
    await settle(api, 'the first search settles');
    global.display.emit('overlay-key');
    await waitFor(() => !api.overlay.visible, 'Super closes Sift search', 2000);

    // The idle prewarm must learn the real page size. Otherwise the first
    // open repages every tile in the middle of the animation.
    api.overlay._prewarmGrid();
    await waitFor(() => !api.appGrid._chunkId &&
        api.appGrid._tiles.length === api.appGrid.itemCount,
    'the hidden grid prewarms', 3000);
    assert(api.appGrid.itemCount > 0, 'the prewarmed grid has apps');
    assert(api.appGrid._grid.layout_manager.pageWidth > 0,
        'the prewarmed grid learns its page size');

    Main.overview.show(OverviewControls.ControlsState.APP_GRID);
    await waitFor(() => api.overlay.visible && api.overlay.view === 'grid',
        'Super+A opens the Sift app grid', 2000);
    await settle(api, 'the first grid settles');
    Main.overview.show(OverviewControls.ControlsState.APP_GRID);
    await waitFor(() => api.overlay.visible && api.overlay.view === 'search',
        'Super+A again returns to search', 2000);
    await settle(api, 'the first grid returns to search');
    await closeOverlay(api);

    api.blocker.toggle();
    await waitFor(() => api.overlay.visible && api.overlay.view === 'search',
        'the Sift search shortcut opens search', 2000);
    await settle(api, 'the shortcut search settles');
    assert(!api.overlay.emptyVisible, 'the empty query shows only the search bar');
    assert(api.glass.rect.height === 60,
        'the empty query uses the compact bar height');
    assert(api.overlay.entry.accessible_name === 'Search', 'entry is named Search');

    api.blocker.toggleApps();
    await waitFor(() => api.overlay.visible && api.overlay.view === 'grid',
        'the Sift app-grid shortcut opens the grid', 2000);
    await settle(api, 'the shortcut grid settles');

    api.overlay.focusSearch();
    await waitFor(() => api.overlay.visible && api.overlay.view === 'search',
        'focusSearch returns to search', 2000);
    await settle(api, 'focusSearch settles');
    assert(api.overlay.entry.clutter_text.has_key_focus(),
        'focusSearch focuses the entry text');

    const installed = Shell.AppSystem.get_default().get_installed();
    const shown = installed.filter(a => a.should_show());
    const target = shown.find(a => a.get_name().length >= 4 &&
        shown.filter(b => b.get_name() === a.get_name()).length === 1);
    assert(target !== undefined, 'installed apps available');
    api.overlay.entry.set_text(target.get_name());
    await Scripting.waitLeisure();
    await waitFor(() => api.glass.rect.height === 404 && !api.overlay.animating,
        'typing settles the expanded height', 2000);
    assert(api.overlay.rowCount > 0, 'app results render');
    assert(!api.overlay.emptyVisible, 'results hide the empty state');
    assert(api.overlay.rows[0].title === target.get_name(), 'exact app name ranks first');
    assert(api.glass.rect.height === 404,
        'typing expands the panel to its fixed height');

    const hidden = installed.find(a => !a.should_show());
    if (hidden) {
        api.overlay.entry.set_text(hidden.get_name());
        await Scripting.waitLeisure();
        assert(!api.overlay.rows.some(row =>
            row.kind === 'app' && row.title === hidden.get_name()),
        'hidden desktop entries do not appear in search');
    }

    // File-type helpers ("Open in …") have MIME types but no categories.
    const handlers = installed.filter(a => a.should_show() &&
        (a.get_categories?.() ?? '') === '' &&
        (a.get_supported_types?.() ?? []).length > 0);
    if (handlers.length) {
        const ids = new Set(api.apps.gridApps().map(record => record.id));
        assert(handlers.every(a => !ids.has(a.get_id())),
            'file-type helpers do not appear as apps');
    }

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
    // Force a text change: the earlier block may have left this exact text in
    // the entry, and setting the same text emits no text-changed signal.
    api.overlay.entry.set_text('');
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
    await waitFor(() => api.overlay.scrollView.vadjustment.upper >
        api.overlay.scrollView.vadjustment.page_size,
    'overflow content is scrollable', 2000);
    await waitFor(() => api.glass.rect.height === 300 && !api.overlay.animating,
        'the panel height setting settles', 2000);
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
    await waitFor(() => api.glass.rect.height === 60 && !api.overlay.animating,
        'clearing the query settles the compact bar', 2000);

    const savedBrightness = api.settings.get_int('glass-brightness');
    const savedAnimations = api.settings.get_boolean('animations');
    const searchRect = api.glass.rect;
    const clones = api.glass.cloneCount;

    api.settings.set_boolean('animations', true);
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

    api.settings.set_int('glass-brightness', 50);
    await Scripting.waitLeisure();
    assert(api.glass.blurRadius === 22, 'the default brightness blurs 22 px');

    api.settings.set_int('glass-brightness', savedBrightness);
    await Scripting.waitLeisure();
    assert(api.glass.brightness === savedBrightness,
        'brightness is restored');

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
    const gridHeight = api.appGrid.height;
    await settle(api, 'the grid settles before close');
    assert(api.appGrid.height === gridHeight,
        'the grid keeps its size from the first opening frame');
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
    assert(api.overlay.closing, 'activation starts the close fade');
    await waitFor(() => !api.overlay.visible,
        'activation closes the overlay', 2000);
    assert(api.glass.cloneCount === 0,
        'activation removes the copies when the fade ends');

    // A grid switch requested while search is still opening must animate from
    // the compact bar, not snap to the finished grid.
    api.overlay.open('search');
    await waitFor(() => api.overlay.visible && api.overlay.view === 'search',
        'search opens for the early grid switch', 2000);
    api.blocker.toggleApps();
    assert(api.glass.rect.height === 60,
        'the early grid switch starts from the compact search bar');
    await waitFor(() => api.overlay.view === 'grid',
        'the early grid switch changes view', 2000);
    await settle(api, 'the early grid switch settles');
    assert(api.glass.rect.height > 60,
        'the early grid switch follows the geometry spring');
    await closeOverlay(api);

    api.settings.set_boolean('animations', false);
    await Scripting.waitLeisure();
    await openOverlay(api, 'search');
    assert(api.overlay.visible && !api.overlay.animating,
        'opens without animation');
    api.settings.set_boolean('animations', savedAnimations);
    await Scripting.waitLeisure();

    api.overlay.entry.set_text('fire');
    api.blocker.toggleApps();
    await waitFor(() => api.overlay.visible && api.overlay.view === 'grid',
        'the app-grid shortcut switches views', 2000);
    await settle(api, 'the grid view settles');
    assert(api.overlay.view === 'grid', 'grid view is active');
    assert(api.overlay.entry.text === '', 'entering grid clears query');
    assert(api.glass.rect.width > searchRect.width, 'glass rect follows the grid');
    assert(api.appGrid.iconSize === 96, 'default icon size');
    await waitFor(() => api.appGrid.itemCount > 0, 'grid apps load', 2000);
    await waitFor(() => !api.appGrid._chunkId, 'grid build settles', 2000);
    await Scripting.waitLeisure();
    await waitForGrid(api.appGrid._grid, 'grid icons fit their pages');

    const indicator = api.appGrid._indicators;
    assert(indicator.width > 0, 'page indicators have their dots');
    assert(Math.abs(indicator.x + indicator.width / 2 -
        api.appGrid.width / 2) <= 1, 'page indicators are centered');

    // Moving inside the page must not restart the page scroll; that repeated
    // scroll is what made the tiles re-settle on every arrow key.
    const grid = api.appGrid._grid;
    const goToPage = grid.goToPage.bind(grid);
    let pageMoves = 0;
    grid.goToPage = (...args) => {
        pageMoves++;
        return goToPage(...args);
    };
    const beforeArrow = api.appGrid.selectedIndex;
    api.overlay.handleKey('Right', 0);
    await Scripting.waitLeisure();
    assert(api.appGrid.selectedIndex === beforeArrow + 1,
        'right selects the next app');
    assert(pageMoves === 0, 'moving inside a page does not scroll the page');
    delete grid.goToPage;

    // Scrolling moves whole pages; native scrolling used to stop between.
    const gridScroll = api.appGrid._scroll;
    assert(!gridScroll.enable_mouse_scrolling &&
        !gridScroll.enable_touch_scrolling,
    'the grid disables native partial scrolling');
    assert(gridScroll.has_actions(),
        'the grid scroll view handles scrolls');
    if (api.appGrid._grid.nPages > 1) {
        const gridManager = api.appGrid._grid.layout_manager;
        const hadjustment = api.appGrid._grid.hadjustment;
        api.appGrid._onScroll(0, 1);
        await waitFor(() => api.appGrid._grid.currentPage === 1,
            'a scroll turns to the next page', 2000);
        await waitFor(
            () => Math.abs(hadjustment.value - gridManager.pageWidth) < 1,
            'the scroll settles on a whole page', 2000);
        api.appGrid._onScroll(0, -1);
        await waitFor(() => api.appGrid._grid.currentPage === 0,
            'a scroll turns back a page', 2000);
        await waitFor(() => Math.abs(hadjustment.value) < 1,
            'the scroll settles on the first page', 2000);
    }

    api.overlay.handleKey('t', 0);
    assert(api.overlay.animating && !api.overlay._gridView.visible,
        'the search view appears before the grid morph ends');
    api.overlay.entry.set_text('t');
    assert(api.overlay.animating && api.overlay._results.visible,
        'the search results appear before the grid morph ends');
    await Scripting.waitLeisure();
    assert(api.overlay.view === 'search' && api.overlay.entry.text === 't',
        'typing returns to search');

    api.blocker.toggleApps();
    await Scripting.waitLeisure();
    assert(api.overlay.view === 'grid', 'toggle opens the grid from search');
    await settle(api, 'the grid after typing settles');

    api.settings.set_boolean('grid-labels', false);
    await Scripting.waitLeisure();
    await waitForGrid(api.appGrid._grid, 'grid fits without labels');
    const manager = api.appGrid._grid.layout_manager;
    const offColumns = api.appGrid._columns;
    const offRows = api.appGrid._rows;
    const offCell = manager._getChildrenMaxSize();
    const offIcon = api.appGrid.iconSize;
    assert(api.appGrid._tiles.every(tile => !tile.icon.label.visible),
        'labels hide live');
    api.settings.set_boolean('grid-labels', true);
    await Scripting.waitLeisure();
    await waitForGrid(api.appGrid._grid, 'grid fits with labels');
    assert(api.appGrid._columns === offColumns &&
        api.appGrid._rows === offRows,
    'labels do not change the grid capacity');
    assert(manager._getChildrenMaxSize() === offCell,
        'labels do not enlarge the grid cell');
    assert(api.appGrid.iconSize === offIcon,
        'labels do not change the icon size');

    api.overlay.handleKey('Escape', 0);
    await waitFor(() => !api.overlay.visible, 'escape closes the grid');
    assert(api.glass.cloneCount === 0, 'clones removed on close');

    // A mouse activation goes through Sift, so the grid closes like Enter.
    await openOverlay(api, 'grid');
    const clickedRecord = api.appGrid._records[0];
    const clickedApp = clickedRecord.app;
    const activateApp = clickedApp.activate;
    let activations = 0;
    clickedApp.activate = () => {
        activations++;
    };
    api.appGrid._tiles[0].activate();
    assert(api.overlay.closing, 'a tile click starts the close fade');
    await waitFor(() => !api.overlay.visible,
        'a tile click closes the app grid', 2000);
    assert(activations === 1, 'the app opens after the fade');
    clickedApp.activate = activateApp;

    await openOverlay(api, 'grid');
    api.appGrid._tiles[0].popupMenu();
    assert(api.appGrid._tiles[0]._menu !== null,
        'right-click opens the normal app menu');
    api.appGrid._tiles[0]._menu.close();
    await Scripting.waitLeisure();
    await closeOverlay(api);

    // A layout change while closed must be right on the next open, not only
    // after closing and opening again.
    api.settings.set_boolean('grid-labels', false);
    await Scripting.waitLeisure();
    api.blocker.toggleApps();
    await waitFor(() => api.appGrid.itemCount > 0,
        'grid opens after a closed label change', 2000);
    await waitFor(() => !api.appGrid._chunkId,
        'grid settles after a closed label change', 2000);
    assert(api.appGrid._tiles.every(tile => !tile.icon.label.visible),
        'first open after a closed label change hides labels');
    assert(api.appGrid._columns === offColumns && api.appGrid._rows === offRows,
        'first open without labels keeps the cell capacity');
    await waitForGrid(api.appGrid._grid,
        'first open after a closed label change fits');
    await closeOverlay(api);
    api.settings.set_boolean('grid-labels', true);
    await Scripting.waitLeisure();

    api.blocker.toggleApps();
    await waitFor(() => api.overlay.visible && api.overlay.view === 'grid',
        'the Sift app-grid shortcut opens the grid from closed', 2000);
    await settle(api, 'the reopened grid from closed settles');
    assert(api.overlay.view === 'grid',
        'the Sift app-grid shortcut opens the grid from closed');
    await closeOverlay(api);

    // Nothing else opens the overview while it is disabled.
    assert(Main.overview.shouldToggleByCornerOrButton() === false,
        'the hot corner stays disabled');
    Main.overview.toggle();
    Main.overview.show();
    Main.layoutManager.showOverview();
    await Scripting.waitLeisure();
    assert(!Main.overview.visible, 'overview triggers do nothing while disabled');
    assert(!Main.layoutManager.overviewGroup.visible,
        'the overview group stays hidden while disabled');
    assert(!api.overlay.visible, 'overview triggers do not open Sift');

    // Enabling the GNOME overview restores all of its triggers; Sift's pair
    // keeps working and closes the overview when it opens.
    api.settings.set_boolean('disable-overview', false);
    await Scripting.waitLeisure();
    assert(api.blocker.installed === false,
        'the GNOME overview can be enabled');
    assert(!Object.prototype.hasOwnProperty.call(Main.overview, 'show'),
        'overview show restored when enabled');
    assert(!Object.prototype.hasOwnProperty.call(Main.overview, 'toggle'),
        'overview toggle restored when enabled');
    assert(!Object.prototype.hasOwnProperty.call(Main.overview, 'runStartupAnimation'),
        'startup animation restored when enabled');
    assert(!Object.prototype.hasOwnProperty.call(Main.layoutManager, 'showOverview'),
        'layout showOverview restored when enabled');
    assert(Main.overview._swipeTracker.enabled,
        'overview swipe restored when enabled');
    assert(Main.wm._allowedKeybindings['sift-search-shortcut'],
        'the Sift search shortcut stays bound with the overview on');
    assert(Main.wm._allowedKeybindings['sift-apps-shortcut'],
        'the Sift app-grid shortcut stays bound with the overview on');

    Main.overview.toggle();
    await waitFor(() => Main.overview.visible,
        'Super opens the GNOME overview when enabled', 2000);
    api.blocker.toggle();
    await waitFor(() => api.overlay.visible && api.overlay.view === 'search',
        'the Sift search shortcut opens over the GNOME overview', 2000);
    await waitFor(() => !Main.overview.visible,
        'the Sift search shortcut closes the GNOME overview', 2000);
    await settle(api, 'search over the GNOME overview settles');
    await closeOverlay(api);

    Main.overview.show();
    await waitFor(() => Main.overview.visible,
        'the GNOME overview reopens for the app-grid check', 2000);
    api.blocker.toggleApps();
    await waitFor(() => api.overlay.visible && api.overlay.view === 'grid',
        'the Sift app-grid shortcut opens over the GNOME overview', 2000);
    await waitFor(() => !Main.overview.visible,
        'the Sift app-grid shortcut closes the GNOME overview', 2000);
    await settle(api, 'the grid over the GNOME overview settles');
    await closeOverlay(api);

    // Disabling again takes the Super defaults back and suppresses the rest.
    api.settings.set_boolean('disable-overview', true);
    await Scripting.waitLeisure();
    assert(api.blocker.installed, 'the GNOME overview can be disabled again');
    assert(!Main.wm._allowedKeybindings['sift-search-shortcut'],
        'the search key is unbound while Super is the default again');
    assert(!Main.wm._allowedKeybindings['sift-apps-shortcut'],
        'the app-grid key is unbound while Super+A is the default again');
    Main.overview.toggle();
    Main.overview.show();
    await Scripting.waitLeisure();
    assert(!Main.overview.visible,
        'the GNOME overview stays closed after disabling again');
    assert(!api.overlay.visible, 'GNOME overview triggers do not open Sift');
    global.display.emit('overlay-key');
    await waitFor(() => api.overlay.visible, 'Super opens Sift again', 2000);
    await settle(api, 'the reopened search settles');
    global.display.emit('overlay-key');
    await waitFor(() => !api.overlay.visible,
        'Super closes Sift again', 2000);

    // A custom accelerator replaces the default and stays bound.
    api.settings.set_strv('sift-search-shortcut', ['<Control>k']);
    await Scripting.waitLeisure();
    assert(Main.wm._allowedKeybindings['sift-search-shortcut'],
        'a custom search shortcut is bound');
    global.display.emit('overlay-key');
    await Scripting.waitLeisure();
    assert(!api.overlay.visible,
        'Super stops opening Sift once the search shortcut is customized');
    api.blocker.toggle();
    await waitFor(() => api.overlay.visible,
        'Sift opens after customizing the search shortcut', 2000);
    await settle(api, 'the custom-shortcut search settles');
    api.blocker.toggle();
    await waitFor(() => !api.overlay.visible,
        'Sift closes after customizing the search shortcut', 2000);
    api.settings.reset('sift-search-shortcut');
    await Scripting.waitLeisure();
    assert(!Main.wm._allowedKeybindings['sift-search-shortcut'],
        'the custom search binding is released on reset');
    assert(api.settings.get_strv('sift-search-shortcut')[0] === '<Control>space',
        'the search shortcut default is restored');
    global.display.emit('overlay-key');
    await waitFor(() => api.overlay.visible,
        'Super opens Sift again after reset', 2000);
    await settle(api, 'the reset search settles');
    global.display.emit('overlay-key');
    await waitFor(() => !api.overlay.visible,
        'Super closes Sift again after reset', 2000);

    api.settings.set_strv('sift-apps-shortcut', ['<Control>j']);
    await Scripting.waitLeisure();
    assert(Main.wm._allowedKeybindings['sift-apps-shortcut'],
        'a custom app-grid shortcut is bound');
    Main.overview.show(OverviewControls.ControlsState.APP_GRID);
    await Scripting.waitLeisure();
    assert(!api.overlay.visible,
        'Super+A stops opening the grid once the app-grid shortcut is customized');
    api.blocker.toggleApps();
    await waitFor(() => api.overlay.visible && api.overlay.view === 'grid',
        'Sift opens the grid after customizing the app-grid shortcut', 2000);
    await settle(api, 'the custom grid shortcut settles');
    await closeOverlay(api);
    api.settings.reset('sift-apps-shortcut');
    await Scripting.waitLeisure();
    assert(!Main.wm._allowedKeybindings['sift-apps-shortcut'],
        'the custom app-grid binding is released on reset');
    assert(api.settings.get_strv('sift-apps-shortcut')[0] === '<Alt>a',
        'the app-grid shortcut default is restored');
    Main.overview.show(OverviewControls.ControlsState.APP_GRID);
    await waitFor(() => api.overlay.visible && api.overlay.view === 'grid',
        'Super+A opens the grid again after reset', 2000);
    await settle(api, 'the reset grid settles');
    await closeOverlay(api);

    Main.extensionManager.disableExtension(UUID);
    await waitFor(() => Main.extensionManager.lookup(UUID)?.state === ExtensionState.INACTIVE,
        'extension is inactive on disable');
    assert(Main.modalCount === 0, 'modal grab released');
    assert(api.blocker.installed === false, 'overview blocker uninstalled');
    assert(!Main.wm._allowedKeybindings['sift-search-shortcut'],
        'the search shortcut is unbound on disable');
    assert(!Main.wm._allowedKeybindings['sift-apps-shortcut'],
        'the app-grid shortcut is unbound on disable');
    assert(!Object.prototype.hasOwnProperty.call(Main.overview, 'show'), 'show restored');
    assert(!Object.prototype.hasOwnProperty.call(Main.overview, 'toggle'), 'toggle restored');
    assert(!Object.prototype.hasOwnProperty.call(Main.overview, 'runStartupAnimation'),
        'startup animation restored');
    assert(!Object.prototype.hasOwnProperty.call(Main.layoutManager, 'showOverview'),
        'layout showOverview restored');
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
    assert(api.blocker.installed, 'overview blocker reinstalled');
    assert(!Main.wm._allowedKeybindings['sift-search-shortcut'],
        'the search key is unbound again while Super is the default');
    assert(!Main.wm._allowedKeybindings['sift-apps-shortcut'],
        'the app-grid key is unbound again while Super+A is the default');
    global.display.emit('overlay-key');
    await waitFor(() => api.overlay.visible && api.overlay.view === 'search',
        'Super opens Sift after re-enabling', 2000);
    await settle(api, 'the re-enabled search settles');
    global.display.emit('overlay-key');
    await waitFor(() => !api.overlay.visible,
        'Super closes Sift after re-enabling', 2000);

    print('sift shell smoke ok');
}
