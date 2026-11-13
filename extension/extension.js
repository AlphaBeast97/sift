// SPDX-License-Identifier: GPL-3.0-or-later
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {SiftOverlay} from './src/overlay.js';

export default class SiftExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._overlay = new SiftOverlay({settings: this._settings});
    }

    disable() {
        this._overlay?.destroy();
        this._overlay = null;
        this._settings = null;
    }

    getTestAPI() {
        return {
            extension: this,
            settings: this._settings,
            overlay: this._overlay,
            takeover: null,
            appGrid: null,
            glass: null,
            daemon: null,
        };
    }
}
