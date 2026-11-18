// SPDX-License-Identifier: GPL-3.0-or-later
import GioUnix from 'gi://GioUnix';
import Shell from 'gi://Shell';

import {rankApps} from './lib/appScore.js';

export function normalizeApp(app) {
    const info = app.get_app_info();
    const desktop = info instanceof GioUnix.DesktopAppInfo ? info : null;
    const name = app.get_name();
    const genericName = desktop?.get_generic_name() ?? '';
    const keywords = desktop?.get_keywords() ?? [];

    return {
        id: app.get_id(),
        name,
        lowerName: name.toLocaleLowerCase(),
        genericName,
        lowerGeneric: genericName.toLocaleLowerCase(),
        keywords,
        lowerKeywords: keywords.map(keyword => keyword.toLocaleLowerCase()),
        lowerId: app.get_id().toLocaleLowerCase(),
        running: app.state !== Shell.AppState.STOPPED,
        app,
    };
}

export class Apps {
    constructor(appSystem = Shell.AppSystem.get_default()) {
        this._appSystem = appSystem;
        this._records = null;
        this._onChanged = null;
        this._installedId = 0;
        this._stateId = 0;
    }

    connect(onChanged = null) {
        if (this._installedId)
            return;

        this._onChanged = onChanged;
        this._installedId = this._appSystem.connect('installed-changed',
            () => this._invalidate());
        this._stateId = this._appSystem.connect('app-state-changed',
            () => this._invalidate());
    }

    disconnect() {
        if (this._installedId)
            this._appSystem.disconnect(this._installedId);
        if (this._stateId)
            this._appSystem.disconnect(this._stateId);
        this._installedId = 0;
        this._stateId = 0;
        this._onChanged = null;
        this._records = null;
    }

    search(query, limit = 4) {
        return rankApps(this._getRecords(), query, limit);
    }

    gridApps() {
        return this._getRecords()
            .sort((a, b) => a.name.localeCompare(b.name));
    }

    _getRecords() {
        if (!this._records) {
            const apps = new Map();
            for (const info of this._appSystem.get_installed()) {
                const app = this._appSystem.lookup_app(info.get_id());
                if (app)
                    apps.set(app.get_id(), app);
            }
            for (const app of this._appSystem.get_running())
                apps.set(app.get_id(), app);
            this._records = [...apps.values()]
                .map(normalizeApp)
                .filter(record => record.app.get_app_info()?.should_show() ?? true);
        }
        return this._records;
    }

    _invalidate() {
        this._records = null;
        this._onChanged?.();
    }
}
