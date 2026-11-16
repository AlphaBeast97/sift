// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as OverviewControls from 'resource:///org/gnome/shell/ui/overviewControls.js';

const PATCHED = ['show', 'hide', 'toggle', 'focusSearch', 'showApps',
    'shouldToggleByCornerOrButton', 'runStartupAnimation'];
const SIFT_SHORTCUTS = ['sift-search-shortcut', 'sift-apps-shortcut'];
const ACTIVATION_GUARD_MS = 500;

export class OverviewTakeover {
    constructor({overlay, settings}) {
        this._overlay = overlay;
        this._settings = settings;
        this._saved = {};
        this._lastOpen = 0;
        this._swipeEnabled = false;
        this._keySettings = null;
        this._keybindingInstalled = false;
        this._appsKeybindingInstalled = false;
        this._startupShowingId = 0;
        this._shortcutsInstalled = false;
        this._settingsId = 0;
        this._installed = false;
    }

    get installed() {
        return this._installed;
    }

    install() {
        if (this._shortcutsInstalled)
            return;

        this._addSiftShortcut('sift-search-shortcut', () => this.toggle());
        this._addSiftShortcut('sift-apps-shortcut', () => this.toggleApps());
        this._shortcutsInstalled = true;

        this._settingsId = this._settings.connect('changed::overview-takeover',
            () => this._syncOverview());
        this._syncOverview();
    }

    destroy() {
        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = 0;
        }

        this._uninstallOverview();

        if (this._shortcutsInstalled) {
            for (const key of SIFT_SHORTCUTS)
                Main.wm.removeKeybinding(key);
            this._shortcutsInstalled = false;
        }
    }

    toggle() {
        if (this._overlay.visible)
            this._overlay.close();
        else
            this._showSearch();
    }

    toggleApps() {
        if (this._overlay.visible && this._overlay.view === 'grid')
            this._overlay.focusSearch();
        else
            this._showApps();
    }

    _syncOverview() {
        const enabled = this._settings.get_boolean('overview-takeover');
        if (enabled === this._installed)
            return;

        if (enabled)
            this._installOverview();
        else
            this._uninstallOverview();
    }

    _installOverview() {
        if (this._installed)
            return;

        if (!Main.overview || !Main.overview._swipeTracker ||
            !OverviewControls.ControlsState || typeof Main.pushModal !== 'function')
            throw new Error('Sift: GNOME Shell overview internals are unavailable');

        for (const name of PATCHED) {
            this._saved[name] = {
                hasOwn: Object.prototype.hasOwnProperty.call(Main.overview, name),
                value: Main.overview[name],
            };
        }

        const openSearch = () => this._showSearch();
        const openGrid = () => this._showApps();

        Main.overview.show = (state = OverviewControls.ControlsState.WINDOW_PICKER) => {
            if (state === OverviewControls.ControlsState.APP_GRID)
                openGrid();
            else
                openSearch();
        };
        Main.overview.showApps = openGrid;
        Main.overview.hide = () => {
            this._overlay.close();
            this._closeNative();
        };
        Main.overview.toggle = () => {
            if (this._overlay.visible)
                this._overlay.close();
            else
                openSearch();
        };
        Main.overview.focusSearch = () => {
            this._lastOpen = Date.now();
            this._closeNative(() => this._overlay.focusSearch());
        };
        Main.overview.shouldToggleByCornerOrButton = () =>
            !this._overlay.animating && Date.now() - this._lastOpen >= ACTIVATION_GUARD_MS;

        // GNOME shows its own overview during login. Sift replaces that
        // overview, so let the desktop appear directly instead of flashing it.
        Main.overview.runStartupAnimation = async () => {};

        // The shell starts the animation before extensions are enabled, so
        // also dismiss the overview as soon as it appears.
        if (Main.layoutManager._startingUp) {
            const id = Main.overview.connect('showing', () => {
                Main.overview.disconnect(id);
                if (this._startupShowingId === id)
                    this._startupShowingId = 0;
                if (Main.layoutManager._startingUp)
                    this._dismissNative();
            });
            this._startupShowingId = id;
        }

        this._keySettings = new Gio.Settings({schema_id: 'org.gnome.shell.keybindings'});
        if (this._keySettings.get_strv('toggle-overview').length > 0) {
            Main.wm.removeKeybinding('toggle-overview');
            Main.wm.addKeybinding('toggle-overview', this._keySettings,
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                () => this.toggle());
            this._keybindingInstalled = true;
        }

        if (this._keySettings.get_strv('toggle-application-view').length > 0) {
            Main.wm.removeKeybinding('toggle-application-view');
            Main.wm.addKeybinding('toggle-application-view', this._keySettings,
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                () => this.toggleApps());
            this._appsKeybindingInstalled = true;
        }

        if (Main.overview.visible)
            this._dismissNative();

        this._swipeEnabled = Main.overview._swipeTracker.enabled;
        Main.overview._swipeTracker.enabled = false;
        this._installed = true;
    }

    _uninstallOverview() {
        if (!this._installed)
            return;

        this._overlay.close();

        if (this._startupShowingId) {
            Main.overview.disconnect(this._startupShowingId);
            this._startupShowingId = 0;
        }

        for (const name of PATCHED) {
            const saved = this._saved[name];
            if (saved.hasOwn)
                Main.overview[name] = saved.value;
            else
                delete Main.overview[name];
        }
        this._saved = {};

        if (this._keybindingInstalled) {
            Main.wm.removeKeybinding('toggle-overview');
            Main.wm.addKeybinding('toggle-overview', this._keySettings,
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                () => Main.overview.toggle());
            this._keybindingInstalled = false;
        }

        if (this._appsKeybindingInstalled) {
            Main.wm.removeKeybinding('toggle-application-view');
            Main.wm.addKeybinding('toggle-application-view', this._keySettings,
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                () => {
                    if (Main.overview.visible)
                        Main.overview.dash.showAppsButton.checked =
                            !Main.overview.dash.showAppsButton.checked;
                    else
                        Main.overview.show(OverviewControls.ControlsState.APP_GRID);
                });
            this._appsKeybindingInstalled = false;
        }
        this._keySettings = null;

        Main.overview._swipeTracker.enabled = this._swipeEnabled;
        this._installed = false;
    }

    _addSiftShortcut(key, handler) {
        Main.wm.addKeybinding(key, this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            handler);
    }

    _showSearch() {
        this._lastOpen = Date.now();
        this._closeNative(() => this._overlay.open('search'));
    }

    _showApps() {
        this._lastOpen = Date.now();
        this._closeNative(() => this._overlay.showApps());
    }

    _hideNative() {
        if (this._saved.hide)
            this._saved.hide.value.call(Main.overview);
        else
            Main.overview.hide();
    }

    // Hiding the group as well makes the startup overview vanish instantly
    // instead of animating out after it has already been visible.
    _dismissNative() {
        this._hideNative();
        Main.layoutManager.hideOverview();
    }

    // The native overview keeps its modal grab until its hide animation ends,
    // so opening Sift straight away would fail to grab and stay hidden.
    _closeNative(callback = null) {
        if (!Main.overview.visible) {
            callback?.();
            return;
        }

        if (!callback) {
            this._hideNative();
            return;
        }

        const id = Main.overview.connect('hidden', () => {
            Main.overview.disconnect(id);
            GLib.idle_add(GLib.PRIORITY_DEFAULT, () => {
                callback();
                return GLib.SOURCE_REMOVE;
            });
        });
        this._hideNative();
    }
}
