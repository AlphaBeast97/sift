// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as OverviewControls from 'resource:///org/gnome/shell/ui/overviewControls.js';

const PATCHED = ['show', 'hide', 'toggle', 'focusSearch', 'showApps',
    'shouldToggleByCornerOrButton', 'runStartupAnimation'];
const ACTIVATION_GUARD_MS = 500;
const KEY_FLAGS = Meta.KeyBindingFlags.IGNORE_AUTOREPEAT;
const KEY_MODES = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW;

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
        this._settingsIds = [];
        this._searchInstalled = false;
        this._appsInstalled = false;
        this._installed = false;
    }

    get installed() {
        return this._installed;
    }

    install() {
        if (this._settingsIds.length > 0)
            return;

        const keys = ['overview-takeover', 'sift-search-shortcut',
            'sift-apps-shortcut'];
        for (const key of keys)
            this._settingsIds.push(this._settings.connect(`changed::${key}`,
                () => this._sync()));
        this._sync();
    }

    destroy() {
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];

        this._uninstallOverview();

        this._bindSift('sift-search-shortcut', () => {}, false);
        this._bindSift('sift-apps-shortcut', () => {}, false);
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

    _sync() {
        const takeover = this._settings.get_boolean('overview-takeover');

        if (takeover)
            this._installOverview();
        else
            this._uninstallOverview();

        if (this._installed)
            this._syncNativeTriggers();

        // One pair only: with the takeover on and no custom shortcut, the
        // GNOME overview triggers are the Sift shortcuts. A recorded shortcut
        // replaces its default trigger instead of adding a second one.
        this._bindSift('sift-search-shortcut', () => this.toggle(),
            !takeover || this._hasCustom('sift-search-shortcut'));
        this._bindSift('sift-apps-shortcut', () => this.toggleApps(),
            !takeover || this._hasCustom('sift-apps-shortcut'));
    }

    _hasCustom(key) {
        return this._settings.get_user_value(key) !== null;
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
            // A custom search shortcut releases Super to GNOME.
            if (this._hasCustom('sift-search-shortcut')) {
                this._nativeToggle();
                return;
            }
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

        if (Main.overview.visible)
            this._dismissNative();

        this._swipeEnabled = Main.overview._swipeTracker.enabled;
        Main.overview._swipeTracker.enabled = false;
        this._installed = true;
    }

    // Super and Super+A open Sift unless that action has a custom shortcut,
    // in which case they go back to GNOME's own overview behavior.
    _syncNativeTriggers() {
        const customSearch = this._hasCustom('sift-search-shortcut');
        const customApps = this._hasCustom('sift-apps-shortcut');

        Main.wm.removeKeybinding('toggle-overview');
        this._keybindingInstalled = false;
        if (this._keySettings.get_strv('toggle-overview').length > 0) {
            Main.wm.addKeybinding('toggle-overview', this._keySettings,
                KEY_FLAGS, KEY_MODES,
                customSearch ? () => this._nativeToggle() : () => this.toggle());
            this._keybindingInstalled = true;
        }

        Main.wm.removeKeybinding('toggle-application-view');
        this._appsKeybindingInstalled = false;
        if (this._keySettings.get_strv('toggle-application-view').length > 0) {
            Main.wm.addKeybinding('toggle-application-view', this._keySettings,
                KEY_FLAGS, KEY_MODES,
                customApps ? () => this._nativeApps() : () => this.toggleApps());
            this._appsKeybindingInstalled = true;
        }
    }

    _uninstallOverview() {
        if (!this._installed)
            return;

        this._overlay.close();

        if (this._startupShowingId) {
            Main.overview.disconnect(this._startupShowingId);
            this._startupShowingId = 0;
        }

        if (this._keybindingInstalled) {
            Main.wm.removeKeybinding('toggle-overview');
            this._keybindingInstalled = false;
        }

        if (this._appsKeybindingInstalled) {
            Main.wm.removeKeybinding('toggle-application-view');
            this._appsKeybindingInstalled = false;
        }

        for (const name of PATCHED) {
            const saved = this._saved[name];
            if (saved.hasOwn)
                Main.overview[name] = saved.value;
            else
                delete Main.overview[name];
        }
        this._saved = {};

        if (this._keySettings.get_strv('toggle-overview').length > 0) {
            Main.wm.addKeybinding('toggle-overview', this._keySettings,
                KEY_FLAGS, KEY_MODES, () => Main.overview.toggle());
        }

        if (this._keySettings.get_strv('toggle-application-view').length > 0) {
            Main.wm.addKeybinding('toggle-application-view', this._keySettings,
                KEY_FLAGS, KEY_MODES, () => {
                    if (Main.overview.visible) {
                        Main.overview.dash.showAppsButton.checked =
                            !Main.overview.dash.showAppsButton.checked;
                    } else {
                        Main.overview.show(OverviewControls.ControlsState.APP_GRID);
                    }
                });
        }
        this._keySettings = null;

        Main.overview._swipeTracker.enabled = this._swipeEnabled;
        this._installed = false;
    }

    _bindSift(key, handler, wanted) {
        const installed = key === 'sift-search-shortcut'
            ? this._searchInstalled : this._appsInstalled;
        if (wanted === installed)
            return;

        if (wanted)
            Main.wm.addKeybinding(key, this._settings, KEY_FLAGS, KEY_MODES, handler);
        else
            Main.wm.removeKeybinding(key);

        if (key === 'sift-search-shortcut')
            this._searchInstalled = wanted;
        else
            this._appsInstalled = wanted;
    }

    // Force GNOME's own overview, bypassing the wrappers.
    _nativeShow(state) {
        this._overlay.close();
        this._saved.show.value.call(Main.overview, state);
    }

    _nativeToggle() {
        if (Main.overview.visible) {
            this._hideNative();
            return;
        }
        this._nativeShow(OverviewControls.ControlsState.WINDOW_PICKER);
    }

    _nativeApps() {
        if (Main.overview.visible) {
            Main.overview.dash.showAppsButton.checked =
                !Main.overview.dash.showAppsButton.checked;
            return;
        }
        this._nativeShow(OverviewControls.ControlsState.APP_GRID);
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
