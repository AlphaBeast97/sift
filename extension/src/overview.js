// SPDX-License-Identifier: GPL-3.0-or-later
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {ControlsState} from 'resource:///org/gnome/shell/ui/overviewControls.js';

const PATCHED = ['show', 'showApps', 'toggle', 'focusSearch',
    'shouldToggleByCornerOrButton', 'runStartupAnimation', 'hide'];
const LAYOUT_PATCHED = ['showOverview'];
const SEARCH_KEY = 'sift-search-shortcut';
const APPS_KEY = 'sift-apps-shortcut';
const WORKSPACES_KEY = 'sift-workspaces-shortcut';
const KEY_FLAGS = Meta.KeyBindingFlags.IGNORE_AUTOREPEAT;
const KEY_MODES = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW;

// With GNOME's overview disabled, an unset shortcut keeps the Super defaults;
// with it enabled, the schema defaults (Ctrl+Space / Alt+A) are bound.
export class OverviewBlocker {
    constructor({overlay, settings}) {
        this._overlay = overlay;
        this._settings = settings;
        this._saved = {};
        this._savedLayout = {};
        this._swipeEnabled = false;
        this._startupShowingId = 0;
        this._overlayKeyId = 0;
        this._switchHijacked = false;
        this._bound = new Set();
        this._settingsIds = [];
        this._installed = false;
    }

    get installed() {
        return this._installed;
    }

    install() {
        if (this._settingsIds.length > 0)
            return;

        for (const key of ['disable-overview', SEARCH_KEY, APPS_KEY, WORKSPACES_KEY]) {
            this._settingsIds.push(this._settings.connect(`changed::${key}`,
                () => this._sync()));
        }

        this._sync();
    }

    destroy() {
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];

        for (const key of [SEARCH_KEY, APPS_KEY, WORKSPACES_KEY]) {
            if (this._bound.delete(key))
                Main.wm.removeKeybinding(key);
        }

        this._unblock();
    }

    toggle() {
        if (this._overlay.closing)
            this._overlay.open('search');
        else if (this._overlay.visible)
            this._overlay.close();
        else
            this._closeNative(() => this._overlay.open('search'));
    }

    toggleApps() {
        if (this._overlay.closing)
            this._overlay.open('grid');
        else if (this._overlay.visible && this._overlay.view === 'grid')
            this._overlay.focusSearch();
        else
            this._closeNative(() => this._overlay.showApps());
    }

    toggleWorkspaces() {
        if (this._overlay.closing)
            this._overlay.open('workspace');
        else if (this._overlay.visible && this._overlay.view === 'workspace')
            this._overlay.close();
        else
            this._closeNative(() => this._overlay.open('workspace'));
    }

    _sync() {
        const blocked = this._settings.get_boolean('disable-overview');
        if (blocked)
            this._block();
        else
            this._unblock();

        // With the overview disabled and no recorded shortcut, Super+Tab
        // belongs to the workspace view instead of GNOME's app switcher.
        this._setSwitcherHijack(blocked && this._isDefault(WORKSPACES_KEY));

        for (const [key, handler] of [
            [SEARCH_KEY, () => this.toggle()],
            [APPS_KEY, () => this.toggleApps()],
            [WORKSPACES_KEY, () => this.toggleWorkspaces()],
        ]) {
            // A disabled overview takes over the Super defaults; a recorded
            // shortcut replaces its default and is always bound.
            const bind = !blocked || !this._isDefault(key);
            if (bind && !this._bound.has(key)) {
                Main.wm.addKeybinding(key, this._settings,
                    KEY_FLAGS, KEY_MODES, handler);
                this._bound.add(key);
            } else if (!bind && this._bound.delete(key)) {
                Main.wm.removeKeybinding(key);
            }
        }

        const overlayKey = blocked && this._isDefault(SEARCH_KEY);
        if (overlayKey && !this._overlayKeyId) {
            this._overlayKeyId = global.display.connect('overlay-key',
                () => this.toggle());
        } else if (!overlayKey && this._overlayKeyId) {
            global.display.disconnect(this._overlayKeyId);
            this._overlayKeyId = 0;
        }
    }

    _setSwitcherHijack(on) {
        if (on === this._switchHijacked)
            return;

        Main.wm.setCustomKeybindingHandler('switch-applications',
            on ? KEY_MODES : Shell.ActionMode.NORMAL,
            on ? () => this.toggleWorkspaces()
                : Main.wm._startSwitcher.bind(Main.wm));
        this._switchHijacked = on;
    }

    _isDefault(key) {
        const value = this._settings.get_user_value(key);
        return value === null || value.get_strv().length === 0;
    }

    _block() {
        if (this._installed)
            return;

        for (const name of PATCHED) {
            this._saved[name] = {
                hasOwn: Object.prototype.hasOwnProperty.call(Main.overview, name),
                value: Main.overview[name],
            };
        }
        for (const name of LAYOUT_PATCHED) {
            this._savedLayout[name] = {
                hasOwn: Object.prototype.hasOwnProperty.call(Main.layoutManager, name),
                value: Main.layoutManager[name],
            };
        }

        // Super alone goes through Mutter's overlay-key signal and GNOME's
        // handler calls toggle(); the no-op keeps Super+Tab, Activities and
        // the shell D-Bus from opening anything, while _sync listens for the
        // overlay key separately. Super+A arrives as show(APP_GRID).
        Main.overview.show = state => {
            if (state === ControlsState.APP_GRID && this._isDefault(APPS_KEY))
                this.toggleApps();
        };
        Main.overview.showApps = () => {};
        Main.overview.toggle = () => {};
        Main.overview.focusSearch = () => {};
        Main.overview.shouldToggleByCornerOrButton = () => false;
        Main.layoutManager.showOverview = () => {};

        // Login goes straight to the desktop instead of showing the overview.
        Main.overview.runStartupAnimation = async () => {};

        // The shell starts the animation before extensions are enabled, so
        // also dismiss the overview as soon as it appears.
        if (Main.layoutManager._startingUp) {
            const id = Main.overview.connect('showing', () => {
                Main.overview.disconnect(id);
                if (this._startupShowingId === id)
                    this._startupShowingId = 0;
                if (Main.layoutManager._startingUp)
                    this._dismiss();
            });
            this._startupShowingId = id;
        }

        if (Main.overview.visible)
            this._dismiss();

        this._swipeEnabled = Main.overview._swipeTracker.enabled;
        Main.overview._swipeTracker.enabled = false;
        this._installed = true;
    }

    _unblock() {
        if (!this._installed)
            return;

        this._setSwitcherHijack(false);

        if (this._startupShowingId) {
            Main.overview.disconnect(this._startupShowingId);
            this._startupShowingId = 0;
        }

        if (this._overlayKeyId) {
            global.display.disconnect(this._overlayKeyId);
            this._overlayKeyId = 0;
        }

        for (const name of PATCHED) {
            const saved = this._saved[name];
            if (saved.hasOwn)
                Main.overview[name] = saved.value;
            else
                delete Main.overview[name];
        }
        this._saved = {};

        for (const name of LAYOUT_PATCHED) {
            const saved = this._savedLayout[name];
            if (saved.hasOwn)
                Main.layoutManager[name] = saved.value;
            else
                delete Main.layoutManager[name];
        }
        this._savedLayout = {};

        Main.overview._swipeTracker.enabled = this._swipeEnabled;
        this._installed = false;
    }

    _hideNative() {
        const hide = this._saved.hide?.value ?? Main.overview.hide;
        hide.call(Main.overview);
    }

    // Hide it through the native path only: hiding the group directly stops
    // the controls from allocating, which stalls the startup animation and
    // leaves its full-screen input blocker in place.
    _dismiss() {
        this._hideNative();
    }

    // The native overview keeps its modal grab until its hide animation ends,
    // so opening Sift straight away would fail to grab and stay hidden.
    _closeNative(callback) {
        if (!Main.overview.visible) {
            callback();
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
