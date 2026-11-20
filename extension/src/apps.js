// SPDX-License-Identifier: GPL-3.0-or-later
import GioUnix from 'gi://GioUnix';
import Shell from 'gi://Shell';

import {rankApps} from './lib/appScore.js';
import {sortApps} from './lib/usage.js';
import {UsageStore} from './usage.js';

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

function isVisible(app) {
    const info = app.get_app_info();
    if (!info)
        return true;
    if (!info.should_show())
        return false;
    if (!(info instanceof GioUnix.DesktopAppInfo))
        return true;

    // "Open in …" helpers advertise file types but no categories: they are
    // context-menu verbs, not apps anyone launches on their own.
    return (info.get_categories() ?? '') !== '' ||
        (info.get_supported_types() ?? []).length === 0;
}

export class Apps {
    constructor(appSystem = Shell.AppSystem.get_default(), usage = new UsageStore()) {
        this._appSystem = appSystem;
        this._usage = usage;
        this._records = null;
        this._onChanged = null;
        this._installedId = 0;
        this._stateId = 0;
    }

    connect(onChanged = null, onInstalled = null) {
        if (this._installedId)
            return;

        this._onChanged = onChanged;
        this._onInstalled = onInstalled;
        this._installedId = this._appSystem.connect('installed-changed', () => {
            this._records = null;
            this._onInstalled?.();
        });
        this._stateId = this._appSystem.connect('app-state-changed',
            () => this._refreshRunning());
    }

    disconnect() {
        if (this._installedId)
            this._appSystem.disconnect(this._installedId);
        if (this._stateId)
            this._appSystem.disconnect(this._stateId);
        this._installedId = 0;
        this._stateId = 0;
        this._onChanged = null;
        this._onInstalled = null;
        this._records = null;
        this._usage?.destroy();
        this._usage = null;
    }

    search(query, limit = 4) {
        return rankApps(this._getRecords(), query, limit,
            this._usage?.learned(query) ?? null);
    }

    gridApps(mode = 'az') {
        return sortApps(this._getRecords(), mode, this._usage?.snapshot() ?? null);
    }

    recordLaunch(id) {
        this._usage?.recordLaunch(id);
    }

    recordSelection(query, id) {
        this._usage?.recordSelection(query, id);
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
                .filter(isVisible)
                .map(normalizeApp);
        }
        return this._records;
    }

    // Running state only changes the search boost. Updating the records in
    // place keeps the app grid and its tiles untouched.
    _refreshRunning() {
        if (!this._records)
            return;

        let changed = false;
        for (const record of this._records) {
            const running = record.app.state !== Shell.AppState.STOPPED;
            if (running === record.running)
                continue;
            record.running = running;
            changed = true;
        }

        if (changed)
            this._onChanged?.();
    }
}
