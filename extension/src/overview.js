// SPDX-License-Identifier: GPL-3.0-or-later
import GLib from 'gi://GLib';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const PATCHED = ['show', 'showApps', 'toggle', 'shouldToggleByCornerOrButton',
    'runStartupAnimation', 'hide'];
const LAYOUT_PATCHED = ['showOverview'];
const KEY_FLAGS = Meta.KeyBindingFlags.IGNORE_AUTOREPEAT;
const KEY_MODES = Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW;

// Sift's shortcuts always work; the switch only decides whether GNOME's own
// overview (and its triggers) stays available.
export class OverviewBlocker {
    constructor({overlay, settings}) {
        this._overlay = overlay;
        this._settings = settings;
        this._saved = {};
        this._savedLayout = {};
        this._swipeEnabled = false;
        this._startupShowingId = 0;
        this._settingsIds = [];
        this._installed = false;
    }

    get installed() {
        return this._installed;
    }

    install() {
        if (this._settingsIds.length > 0)
            return;

        this._settingsIds.push(this._settings.connect('changed::disable-overview',
            () => this._sync()));

        Main.wm.addKeybinding('sift-search-shortcut', this._settings,
            KEY_FLAGS, KEY_MODES, () => this.toggle());
        Main.wm.addKeybinding('sift-apps-shortcut', this._settings,
            KEY_FLAGS, KEY_MODES, () => this.toggleApps());

        this._sync();
    }

    destroy() {
        for (const id of this._settingsIds)
            this._settings.disconnect(id);
        this._settingsIds = [];

        Main.wm.removeKeybinding('sift-search-shortcut');
        Main.wm.removeKeybinding('sift-apps-shortcut');

        this._unblock();
    }

    toggle() {
        if (this._overlay.visible)
            this._overlay.close();
        else
            this._closeNative(() => this._overlay.open('search'));
    }

    toggleApps() {
        if (this._overlay.visible && this._overlay.view === 'grid')
            this._overlay.focusSearch();
        else
            this._closeNative(() => this._overlay.showApps());
    }

    _sync() {
        if (this._settings.get_boolean('disable-overview'))
            this._block();
        else
            this._unblock();
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

        Main.overview.show = () => {};
        Main.overview.showApps = () => {};
        Main.overview.toggle = () => {};
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

    // Hiding the group as well makes the startup overview vanish instantly
    // instead of animating out after it has already been visible.
    _dismiss() {
        this._hideNative();
        Main.layoutManager.hideOverview();
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
