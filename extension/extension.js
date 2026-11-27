// SPDX-License-Identifier: GPL-3.0-or-later
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {Apps} from './src/apps.js';
import {Daemon} from './src/daemon.js';
import {OverviewBlocker} from './src/overview.js';
import {SiftOverlay} from './src/overlay.js';
import {Updater} from './src/updater.js';

export default class SiftExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        this._updater = new Updater({
            currentVersion: this.metadata['version-name'],
            onState: state => {
                if (state.state !== 'available')
                    return;
                Main.notify('Sift update available',
                    `Sift ${state.tag} is available. Open Sift preferences to install it.`);
            },
        });
        if (this._settings.get_boolean('update-check'))
            this._updater.checkIfDue();
        this._apps = new Apps();
        this._apps.connect(() => this._overlay?.onAppsChanged(),
            () => this._overlay?.onAppsInstalled());
        this._daemon = new Daemon({
            version: this.metadata['version-name'],
            onChanged: () => this._overlay?.onDaemonChanged(),
        });
        this._overlay = new SiftOverlay({
            settings: this._settings,
            apps: this._apps,
            daemon: this._daemon,
        });
        this._daemon.enable();
        this._blocker = new OverviewBlocker({
            overlay: this._overlay,
            settings: this._settings,
        });
        this._blocker.install();
    }

    disable() {
        this._updater?.destroy();
        this._updater = null;
        this._blocker?.destroy();
        this._blocker = null;
        this._overlay?.destroy();
        this._overlay = null;
        this._daemon?.disable();
        this._daemon = null;
        this._apps?.disconnect();
        this._apps = null;
        this._settings = null;
    }

    getTestAPI() {
        return {
            extension: this,
            settings: this._settings,
            overlay: this._overlay,
            blocker: this._blocker,
            apps: this._apps,
            appGrid: this._overlay?.appGrid ?? null,
            workspaceView: this._overlay?.workspaceView ?? null,
            glass: this._overlay?.glass ?? null,
            daemon: this._daemon,
        };
    }
}
