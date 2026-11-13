// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as OverviewControls from 'resource:///org/gnome/shell/ui/overviewControls.js';

const PATCHED = ['show', 'hide', 'toggle', 'focusSearch', 'showApps', 'shouldToggleByCornerOrButton'];
const ACTIVATION_GUARD_MS = 500;

export class OverviewTakeover {
    constructor({overlay}) {
        this._overlay = overlay;
        this._saved = {};
        this._lastOpen = 0;
        this._swipeEnabled = false;
        this._keySettings = null;
        this._keybindingInstalled = false;
        this._installed = false;
    }

    get installed() {
        return this._installed;
    }

    install() {
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

        const openSearch = () => {
            this._closeNative();
            this._lastOpen = Date.now();
            this._overlay.open('search');
        };
        const openGrid = () => {
            this._closeNative();
            this._lastOpen = Date.now();
            this._overlay.showApps();
        };

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
            this._closeNative();
            this._lastOpen = Date.now();
            this._overlay.focusSearch();
        };
        Main.overview.shouldToggleByCornerOrButton = () =>
            !this._overlay.animating && Date.now() - this._lastOpen >= ACTIVATION_GUARD_MS;

        this._keySettings = new Gio.Settings({schema_id: 'org.gnome.shell.keybindings'});
        if (this._keySettings.get_strv('toggle-overview').length > 0) {
            Main.wm.removeKeybinding('toggle-overview');
            Main.wm.addKeybinding('toggle-overview', this._keySettings,
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                () => this._overlay.toggle());
            this._keybindingInstalled = true;
        }

        if (Main.overview.visible)
            this._closeNative();

        this._swipeEnabled = Main.overview._swipeTracker.enabled;
        Main.overview._swipeTracker.enabled = false;
        this._installed = true;
    }

    destroy() {
        if (!this._installed)
            return;

        this._overlay.close();

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
        this._keySettings = null;

        Main.overview._swipeTracker.enabled = this._swipeEnabled;
        this._installed = false;
    }

    _closeNative() {
        if (!Main.overview.visible)
            return;

        this._saved.hide.value.call(Main.overview);
    }
}
