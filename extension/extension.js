// SPDX-License-Identifier: GPL-3.0-or-later
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {Apps} from './src/apps.js';
import {OverviewTakeover} from './src/overview.js';
import {SiftOverlay} from './src/overlay.js';

export default class SiftExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._apps = new Apps();
        this._apps.connect(() => this._overlay?.onAppsChanged());
        this._overlay = new SiftOverlay({settings: this._settings, apps: this._apps});
        this._takeover = new OverviewTakeover({overlay: this._overlay});
        this._takeover.install();
    }

    disable() {
        this._takeover?.destroy();
        this._takeover = null;
        this._overlay?.destroy();
        this._overlay = null;
        this._apps?.disconnect();
        this._apps = null;
        this._settings = null;
    }

    getTestAPI() {
        return {
            extension: this,
            settings: this._settings,
            overlay: this._overlay,
            takeover: this._takeover,
            apps: this._apps,
            appGrid: this._overlay?.appGrid ?? null,
            glass: null,
            daemon: null,
        };
    }
}
