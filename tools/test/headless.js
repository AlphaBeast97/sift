// SPDX-License-Identifier: GPL-3.0-or-later
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Shell from 'gi://Shell';

import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';
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
    assert(!api.settings.get_boolean('web-search'),
        'web search is off by default');
    assert(!api.settings.get_boolean('settings-search'),
        'settings search is off by default');

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
    assert(!Main.wm._allowedKeybindings['sift-workspaces-shortcut'],
        'the workspace key is unbound while Super+Tab is the default');
    assert(api.blocker._overviewHijacked,
        'Super+Tab opens the workspace view while the overview is off');
    assert((Main.wm._allowedKeybindings['toggle-overview'] &
        Shell.ActionMode.OVERVIEW) !== 0,
    'the Super+Tab handler is registered for the overview mode');

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

    // The web row is a last resort and never displaces a local result.
    api.settings.set_boolean('web-search', true);
    await Scripting.waitLeisure();
    api.overlay.entry.set_text('sift-no-such-app-or-file-zzz');
    await Scripting.waitLeisure();
    await waitFor(() => api.overlay.rowCount > 0, 'the web row renders', 2000);
    const weakRows = api.overlay.rows;
    assert(weakRows[weakRows.length - 1].kind === 'web',
        'a weak query ends with the web row');
    assert(weakRows[weakRows.length - 1].title.startsWith('Search the web'),
        'the web row names the action');

    api.overlay.entry.set_text('example.com');
    await Scripting.waitLeisure();
    await waitFor(() => api.overlay.rows.some(row => row.kind === 'web'),
        'an address offers to open', 2000);
    const address = api.overlay.rows.find(row => row.kind === 'web');
    assert(address.title === 'Open example.com',
        'an address offers to open the host');
    assert(address.uri === 'https://example.com',
        'an address opens with https');

    api.overlay.entry.set_text(target.get_name());
    await Scripting.waitLeisure();
    assert(api.overlay.rows[0].kind === 'app' &&
        api.overlay.rows[0].title === target.get_name(),
    'the web row does not displace an exact app');

    api.settings.set_boolean('web-search', false);
    await Scripting.waitLeisure();
    assert(!api.overlay.rows.some(row => row.kind === 'web'),
        'turning web search off hides the row');
    api.settings.set_boolean('web-search', true);
    await Scripting.waitLeisure();

    const defaultBrowser = Gio.AppInfo.get_default_for_uri_scheme('https');
    if (defaultBrowser?.get_id()) {
        api.settings.set_string('web-browser', defaultBrowser.get_id());
        await Scripting.waitLeisure();
        api.overlay.entry.set_text('example.com');
        await Scripting.waitLeisure();
        await waitFor(() => api.overlay.rows.some(row => row.kind === 'web'),
            'a chosen browser still opens addresses', 2000);
        const chosen = api.overlay.rows.find(row => row.kind === 'web');
        assert(chosen.subtitle === `Open in ${defaultBrowser.get_name()}`,
            'the chosen browser is named');
    }

    api.settings.set_string('web-browser', 'sift-missing-browser.desktop');
    await Scripting.waitLeisure();
    api.overlay.entry.set_text('example.com');
    await Scripting.waitLeisure();
    await waitFor(() => api.overlay.rows.some(row => row.kind === 'web'),
        'a missing browser falls back to the default', 2000);
    api.settings.set_string('web-browser', '');
    await Scripting.waitLeisure();

    // Settings arrive after files. The late first row takes the selection, so
    // the file that briefly held it must not stay selected.
    api.settings.set_boolean('settings-search', true);
    await Scripting.waitLeisure();
    const realQuery = api.daemon.query;
    api.daemon.query = () => Promise.resolve({
        files: [{path: '/tmp/notification-notes.txt',
            name: 'notification-notes.txt', kind: 'file'}],
    });
    api.overlay._settingsSearch.search = async () => {
        await Scripting.sleep(120);
        return [{
            kind: 'setting',
            key: 'setting:notifications',
            title: 'Notifications',
            subtitle: 'Control which notifications are displayed and what they show',
            icon: 'org.gnome.Settings-notifications-symbolic',
            settingId: 'notifications',
            terms: ['notification'],
        }];
    };
    api.overlay.entry.set_text('notification');
    await Scripting.waitLeisure();
    await waitFor(() => api.overlay.rows.some(row => row.kind === 'file'),
        'a file result appears before settings', 2000);
    assert(api.overlay.selectedIndex === 0 &&
        api.overlay.rows[0].kind === 'file',
    'the first file starts selected');
    await waitFor(() => api.overlay.rows.some(row => row.kind === 'setting'),
        'the settings result arrives late', 4000);
    assert(api.overlay.selectedIndex === 0 &&
        api.overlay.rows[0].kind === 'setting',
    'the late first settings row takes the selection');
    delete api.overlay._settingsSearch.search;
    api.daemon.query = realQuery;

    api.overlay.entry.set_text('display');
    await Scripting.waitLeisure();
    await waitFor(() => api.overlay.rows.some(row => row.kind === 'setting'),
        'settings panels appear', 4000);
    const panel = api.overlay.rows.find(row => row.kind === 'setting');
    assert(panel.title === 'Displays', 'settings search finds Displays');
    assert(panel.key === 'setting:display', 'the settings row is stable');

    api.overlay.entry.set_text('gnome display settings');
    await Scripting.waitLeisure();
    await waitFor(() => api.overlay.rows.some(row => row.kind === 'setting'),
        'multi-word settings queries fall back to words', 4000);
    assert(api.overlay.rows.find(row => row.kind === 'setting').title ===
        'Displays', 'multi-word settings query finds Displays');
    assert(api.overlay.rows[api.overlay.selectedIndex].kind !== 'web',
        'the web row does not keep the selection when settings arrive');

    api.overlay.entry.set_text('display');
    await Scripting.waitLeisure();
    await waitFor(() => api.overlay.rows.some(row => row.kind === 'setting'),
        'settings panels appear again', 4000);
    api.apps.recordSelection('display', 'setting:display');
    api.apps.recordSelection('display', 'setting:display');
    api.overlay.refreshApps();
    assert(api.overlay.rows[0].key === 'setting:display',
        'a learned settings panel ranks first');
    assert(api.overlay.selectedIndex === 0,
        'the promoted settings panel keeps the default selection');

    // An exact folder name must not be pushed out by weak settings matches
    // ("Network" contains "work").
    const savedQuery = api.daemon.query;
    const savedSearch = api.overlay._settingsSearch.search;
    api.daemon.query = () => Promise.resolve({
        files: [{path: '/home/sift/Work', name: 'Work', kind: 'dir'}],
        calc: null,
    });
    api.overlay._settingsSearch.search = async () => [
        {
            kind: 'setting',
            key: 'setting:network',
            title: 'Network',
            subtitle: 'Control how you connect to the internet',
            icon: 'org.gnome.Settings-network-symbolic',
            settingId: 'network',
            terms: ['Work'],
        },
        {
            kind: 'setting',
            key: 'setting:wwan',
            title: 'Mobile Network',
            subtitle: 'Connect to mobile broadband',
            icon: 'org.gnome.Settings-network-symbolic',
            settingId: 'wwan',
            terms: ['Work'],
        },
    ];
    api.overlay.entry.set_text('');
    api.overlay.entry.set_text('Work');
    await waitFor(() => api.overlay.rows.some(row =>
        row.kind === 'dir' && row.title === 'Work'),
    'the exact folder appears', 3000);
    await Scripting.sleep(150);
    assert(api.overlay.rows.some(row =>
        row.kind === 'dir' && row.title === 'Work'),
    'an exact folder match survives settings search');
    assert(!api.overlay.rows.some(row => row.kind === 'setting'),
        'weak settings matches leave room for the folder');
    api.daemon.query = savedQuery;
    api.overlay._settingsSearch.search = savedSearch;

    api.apps.recordLaunch('setting:display');
    api.apps.recordLaunch('setting:display');
    api.overlay.entry.set_text('screen');
    await Scripting.waitLeisure();
    await waitFor(() => api.overlay.rows.some(row => row.key === 'setting:display'),
        'a visited panel appears for another query', 4000);
    assert(api.overlay.rows[0].key === 'setting:display',
        'a visited settings panel ranks first across queries');

    api.settings.set_boolean('settings-search', false);
    await Scripting.waitLeisure();
    assert(!api.overlay.rows.some(row => row.kind === 'setting'),
        'turning settings search off hides panels');
    api.settings.set_boolean('settings-search', true);
    await waitFor(() => api.overlay.rows.some(row => row.kind === 'setting'),
        'turning settings search on brings panels back', 4000);

    api.overlay.entry.set_text('what is weather tomorrow?');
    await Scripting.waitLeisure();
    await Scripting.sleep(600);
    assert(!api.overlay.rows.some(row => row.kind === 'setting'),
        'question words do not pull settings panels');

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

    api.overlay.handleKey('Home', 0);
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
    const savedLight = api.settings.get_int('glass-light-brightness');
    const savedMode = api.settings.get_string('glass-mode');
    const savedStyle = api.settings.get_string('glass-style');
    const savedAnimations = api.settings.get_boolean('animations');
    const searchRect = api.glass.rect;
    const clones = api.glass.cloneCount;

    api.settings.set_boolean('animations', true);
    api.settings.set_string('glass-mode', 'dark');
    api.settings.set_int('glass-brightness', 0);
    await Scripting.waitLeisure();
    assert(api.glass.brightness === 0 && api.glass.blurRadius === 30,
        'dark glass brightness applies live');
    assert(api.overlay.has_style_class_name('sift-dark'),
        'dark glass uses light text');
    assert(api.glass.cloneCount === clones,
        'brightness does not rebuild the backdrop');

    api.settings.set_int('glass-brightness', 100);
    await Scripting.waitLeisure();
    assert(api.glass.brightness === 100 && api.glass.blurRadius === 14,
        'the clear end of dark glass applies live');
    assert(api.glass.cloneCount === clones,
        'the clear end keeps the same copies');

    api.settings.set_int('glass-brightness', 50);
    await Scripting.waitLeisure();
    assert(api.glass.blurRadius === 22, 'the default brightness blurs 22 px');

    api.settings.set_string('glass-mode', 'light');
    api.settings.set_int('glass-light-brightness', 0);
    await Scripting.waitLeisure();
    assert(api.glass.brightness === 0 && api.glass.blurRadius === 30,
        'the light slider is independent');
    assert(api.overlay.has_style_class_name('sift-light'),
        'light glass uses dark text');

    api.settings.set_string('glass-mode', 'clear');
    await Scripting.waitLeisure();
    assert(api.glass.brightness === 100 && api.glass.blurRadius === 6,
        'clear glass keeps the backdrop crisp');
    assert(!api.overlay.has_style_class_name('sift-dark') &&
        api.overlay.has_style_class_name('sift-clear'),
    'clear glass uses light text without a shadow');

    api.settings.set_string('glass-style', 'crystal');
    await Scripting.waitLeisure();
    assert(api.glass.style === 'crystal' && api.glass.blurRadius === 6,
        'crystal sharpens the edge without more blur');

    api.settings.set_string('glass-style', 'glow');
    await Scripting.waitLeisure();
    assert(api.glass.style === 'glow' && api.glass.blurRadius === 6,
        'glow keeps the same backdrop');

    api.settings.set_string('glass-style', 'flat');
    await Scripting.waitLeisure();
    assert(api.glass.style === 'flat' && api.glass.blurRadius === 0,
        'flat glass skips the blur');

    api.settings.set_string('glass-style', savedStyle);
    api.settings.set_int('glass-light-brightness', savedLight);
    api.settings.set_int('glass-brightness', savedBrightness);
    api.settings.set_string('glass-mode', 'dark');
    await Scripting.waitLeisure();
    assert(api.glass.brightness === savedBrightness,
        'brightness is restored');
    api.settings.set_string('glass-mode', savedMode);
    await Scripting.waitLeisure();
    assert(!api.overlay.has_style_class_name('sift-clear'),
        'leaving clear drops the extra style');

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

    // Typing before the open spring finishes must grow the bar from the
    // compact height instead of snapping to the full panel.
    api.overlay.entry.set_text('');
    api.overlay.open('search');
    await waitFor(() => api.overlay.visible && api.overlay.view === 'search',
        'search opens for early typing', 2000);
    api.overlay.entry.set_text('a');
    assert(api.glass.rect.height < 404,
        'typing during the open spring does not snap to the full panel');
    await settle(api, 'the early typing grows the panel');
    assert(api.glass.rect.height === 404,
        'the early typing settles at the search height');
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

    // A changed order re-sorts the open grid, not only the next one.
    const lastRecord = api.appGrid._records[api.appGrid._records.length - 1];
    for (let i = 0; i < 3; i++)
        api.apps.recordLaunch(lastRecord.id);
    const tilesBefore = new Map(api.appGrid._tiles.map(tile => [tile._siftId, tile]));
    api.settings.set_string('app-order', 'most-used');
    await waitFor(() => api.appGrid._records[0]?.id === lastRecord.id,
        'most-used order applies to the open grid', 2000);
    assert(api.appGrid._tiles.every(tile =>
        tilesBefore.get(tile._siftId) === tile),
    'an order change reuses the existing tiles');
    api.settings.set_string('app-order', 'az');

    // Installs and removals reconcile the tile set instead of rebuilding it.
    const gridRecords = api.appGrid._records;
    api.appGrid.setApps(gridRecords.slice(0, -1));
    assert(api.appGrid.itemCount === gridRecords.length - 1 &&
        api.appGrid._tiles.length === gridRecords.length - 1,
    'a removal drops only the missing tile');
    api.appGrid.refresh();
    assert(api.appGrid.itemCount === gridRecords.length &&
        api.appGrid._tiles.length === gridRecords.length,
    'an install adds the missing tile back');

    // The install signal reconciles the open grid instead of rebuilding it.
    const idsBefore = api.appGrid._tiles.map(tile => tile._siftId);
    api.apps._appSystem.emit('installed-changed');
    await Scripting.waitLeisure();
    assert(api.appGrid._tiles.length === idsBefore.length &&
        api.appGrid._tiles.every((tile, index) =>
            tile._siftId === idsBefore[index]),
    'the install signal keeps the existing tiles');

    // A launch changes running state only; the grid must not be invalidated.
    const sample = api.apps._getRecords()[0];
    const running = sample.running;
    sample.running = !running;
    api.apps._refreshRunning();
    assert(sample.running === running, 'running state updates in place');
    assert(!api.appGrid._dirty, 'an app state change leaves the grid alone');

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

    // The workspace view shows one column per workspace and moves a window
    // onto the card it was dropped on.
    const wsManager = global.workspace_manager;
    const originalWorkspaces = wsManager.n_workspaces;
    const originalIndex = wsManager.get_active_workspace_index();
    if (wsManager.n_workspaces < 2)
        wsManager.append_new_workspace(false, global.get_current_time());

    await openOverlay(api, 'search');
    api.overlay._toggleWorkspaces();
    await waitFor(() => api.overlay.view === 'workspace',
        'the window button opens the workspace view', 2000);
    await settle(api, 'the workspace view settles');
    assert(api.overlay.view === 'workspace', 'the workspace view opens');
    assert(api.workspaceView.visible, 'workspace columns are visible');
    assert(api.workspaceView.cards.length === wsManager.n_workspaces,
        'one column per workspace');
    assert(api.workspaceView.cards.every(card =>
        card.width === api.workspaceView.cards[0].width && card.width > 300),
    'workspace cards share the width that shows two and a half of them');
    const previews = api.workspaceView.cardRecords
        .flatMap(record => record.windows.map(window => window.preview));
    assert(previews.every(preview =>
        preview.width === api.workspaceView.cards[0].width - 38 &&
        preview.height >= 150),
    'window thumbnails fill the larger cards');
    assert(api.workspaceView.selectedIndex ===
        wsManager.get_active_workspace_index(), 'the active workspace is selected');

    api.overlay.handleKey('Right', 0);
    await Scripting.waitLeisure();
    assert(api.workspaceView.selectedIndex ===
        Math.min(wsManager.get_active_workspace_index() + 1,
            wsManager.n_workspaces - 1), 'right selects the next workspace');
    api.overlay.handleKey('Left', 0);
    await Scripting.waitLeisure();
    assert(api.workspaceView.selectedIndex ===
        wsManager.get_active_workspace_index(), 'left returns to the active workspace');

    const sourceWorkspace = wsManager.get_workspace_by_index(0);
    const targetCard = api.workspaceView.cardRecords.find(record =>
        record.workspace !== sourceWorkspace);
    assert(targetCard !== undefined, 'a second workspace takes a drop');
    let movedTo = null;
    const source = {
        metaWindow: {
            get_workspace: () => sourceWorkspace,
            change_workspace: workspace => {
                movedTo = workspace;
            },
        },
    };
    assert(targetCard.card._delegate.handleDragOver(source) ===
        DND.DragMotionResult.MOVE_DROP, 'another workspace accepts a move');
    assert(targetCard.card._delegate.acceptDrop(source),
        'the workspace accepts the drop');
    assert(movedTo === targetCard.workspace,
        'the window moves to the dropped workspace');
    await Scripting.waitLeisure();

    // Header drags carry the workspace, and dropping one reorders the strip.
    const dragRecord = api.workspaceView.cardRecords[0];
    const dropRecord = api.workspaceView
        .cardRecords[api.workspaceView.cardRecords.length - 1];
    assert(dragRecord.header._delegate?.kind === 'workspace',
        'a workspace header is a drag source');
    const draggedWorkspace = dragRecord.workspace;
    assert(dropRecord.card._delegate.acceptDrop({
        kind: 'workspace',
        workspace: draggedWorkspace,
    }), 'a workspace accepts another workspace drop');
    await Scripting.waitLeisure();
    assert(wsManager.get_workspace_by_index(dropRecord.index) ===
        draggedWorkspace, 'the dropped workspace moves to that position');
    wsManager.reorder_workspace(draggedWorkspace, 0);
    api.workspaceView._scheduleReload();
    await Scripting.waitLeisure();

    // A drop on a card edge inserts a workspace at that gap instead of only
    // moving the window into an existing workspace.
    const edgeCard = api.workspaceView.cardRecords[0];
    let edgeMoved = null;
    const edgeSource = {
        metaWindow: {
            get_workspace: () => wsManager.get_workspace_by_index(1),
            change_workspace: workspace => {
                edgeMoved = workspace;
            },
        },
    };
    const beforeEdge = wsManager.n_workspaces;
    assert(edgeCard.card._delegate.handleDragOver(
        edgeSource, null, 2, 10) === DND.DragMotionResult.MOVE_DROP,
    'the left edge of a card accepts a new workspace');
    assert(edgeCard.card._delegate.acceptDrop(edgeSource, null, 2, 10),
        'dropping on the edge moves the window');
    assert(wsManager.n_workspaces === beforeEdge + 1,
        'an edge drop creates a workspace');
    assert(edgeMoved === wsManager.get_workspace_by_index(0),
        'the new workspace lands in the gap before the card');

    // Dropping past the last card uses the empty strip as an end drop target.
    let endMoved = null;
    const endSource = {
        metaWindow: {
            get_workspace: () => wsManager.get_workspace_by_index(0),
            change_workspace: workspace => {
                endMoved = workspace;
            },
        },
    };
    assert(api.workspaceView._delegate.acceptDrop(endSource, null,
        api.workspaceView.width - 2, 10),
    'the end of the strip accepts a new workspace');
    assert(endMoved === wsManager.get_workspace_by_index(
        wsManager.n_workspaces - 1),
    'a drop past the cards appends a workspace');
    api.workspaceView._scheduleReload();
    await Scripting.waitLeisure();

    // A horizontal wheel notch pans the overflowing strip. The empty test
    // workspaces are pruned on reload, so lend the strip some room here.
    const rightScroll = {
        get_scroll_direction: () => Clutter.ScrollDirection.RIGHT,
        get_state: () => 0,
        get_scroll_delta: () => [0, 0],
    };
    api.workspaceView._offset = 0;
    api.workspaceView._maxOffset = 200;
    assert(api.workspaceView._handleScroll(rightScroll) ===
        Clutter.EVENT_STOP, 'the strip handles a horizontal wheel notch');
    assert(api.workspaceView._offset > 0,
        'a horizontal wheel notch pans the strip');
    api.workspaceView._maxOffset = 0;
    api.workspaceView._offset = 0;

    api.workspaceView._scheduleReload();
    await Scripting.waitLeisure();

    // Ctrl+Left/Right reorder the selected workspace.
    const firstWorkspace = wsManager.get_workspace_by_index(0);
    api.workspaceView.select(0);
    api.overlay.handleKey('Right', Clutter.ModifierType.CONTROL_MASK);
    await Scripting.waitLeisure();
    assert(wsManager.get_workspace_by_index(1) === firstWorkspace,
        'Ctrl+Right moves the selected workspace right');
    api.overlay.handleKey('Left', Clutter.ModifierType.CONTROL_MASK);
    await Scripting.waitLeisure();
    assert(wsManager.get_workspace_by_index(0) === firstWorkspace,
        'Ctrl+Left moves it back');

    // The close-all button hands every window on the card to delete().
    let closedWindows = 0;
    api.workspaceView._closeWorkspace([
        {delete: () => closedWindows++},
        {delete: () => closedWindows++},
    ]);
    assert(closedWindows === 2,
        'the workspace close button closes every window');
    if (api.workspaceView._reloadId) {
        GLib.source_remove(api.workspaceView._reloadId);
        api.workspaceView._reloadId = 0;
    }

    let closedWindow = 0;
    api.workspaceView._closeWindow({delete: () => closedWindow++});
    assert(closedWindow === 1, 'a window close button closes that window');
    if (api.workspaceView._reloadId) {
        GLib.source_remove(api.workspaceView._reloadId);
        api.workspaceView._reloadId = 0;
    }

    const activateWorkspace = api.workspaceView._onActivateWorkspace;
    let activated = null;
    api.workspaceView._onActivateWorkspace = workspace => {
        activated = workspace;
        activateWorkspace(workspace);
    };
    api.workspaceView.select(0);
    api.overlay.handleKey('Return', 0);
    await waitFor(() => !api.overlay.visible,
        'Enter activates the selected workspace', 2000);
    assert(activated !== null, 'the selected workspace is activated');
    assert(wsManager.get_active_workspace_index() === 0,
        'Enter switches to the selected workspace');
    api.workspaceView._onActivateWorkspace = activateWorkspace;

    api.blocker.toggleWorkspaces();
    await waitFor(() => api.overlay.visible &&
        api.overlay.view === 'workspace',
    'the workspace shortcut opens the workspace view', 2000);
    await settle(api, 'the workspace shortcut settles');
    assert(api.glass.rect.height >= 460 && api.glass.rect.height <= 500,
        'the workspace view fits a row and a half of thumbnails');

    const clickTarget = api.workspaceView.cardRecords.find(record =>
        record.index !== wsManager.get_active_workspace_index());
    assert(clickTarget !== undefined, 'a second workspace is clickable');
    clickTarget.header.emit('clicked', clickTarget.header);
    await waitFor(() => !api.overlay.visible,
        'clicking a workspace header closes the view', 2000);
    await waitFor(() =>
        wsManager.get_active_workspace_index() === clickTarget.index,
    'clicking a workspace header switches workspace', 2000);

    api.blocker.toggleWorkspaces();
    await waitFor(() => api.overlay.visible &&
        api.overlay.view === 'workspace',
    'the workspace shortcut reopens the workspace view', 2000);
    await settle(api, 'the reopened workspace view settles');
    api.blocker.toggleWorkspaces();
    await waitFor(() => api.overlay.visible &&
        api.overlay.view === 'search',
    'the workspace shortcut returns to search', 2000);
    await closeOverlay(api);

    while (wsManager.n_workspaces > originalWorkspaces) {
        wsManager.remove_workspace(
            wsManager.get_workspace_by_index(wsManager.n_workspaces - 1),
            global.get_current_time());
    }
    if (wsManager.get_active_workspace_index() !== originalIndex)
        wsManager.get_workspace_by_index(originalIndex).activate(
            global.get_current_time());

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
    assert(Main.wm._allowedKeybindings['sift-workspaces-shortcut'],
        'the Sift workspace shortcut is bound with the overview on');
    assert(!api.blocker._overviewHijacked,
        'Super+Tab returns to the overview when the overview is on');

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
    assert(!Main.wm._allowedKeybindings['sift-workspaces-shortcut'],
        'the workspace key is unbound while Super+Tab is the default again');
    assert(api.blocker._overviewHijacked,
        'Super+Tab is taken over again when the overview is off');

    // A recorded workspace shortcut leaves GNOME's Super+Tab alone.
    api.settings.set_strv('sift-workspaces-shortcut', ['<Control><Alt>w']);
    await Scripting.waitLeisure();
    assert(!api.blocker._overviewHijacked,
        'a recorded shortcut returns Super+Tab to GNOME');
    assert(Main.wm._allowedKeybindings['sift-workspaces-shortcut'],
        'the recorded workspace shortcut is bound');
    api.settings.reset('sift-workspaces-shortcut');
    await Scripting.waitLeisure();
    assert(api.blocker._overviewHijacked,
        'resetting the shortcut takes Super+Tab back');
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
