// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {
    emptyUsage,
    learnedCounts,
    parseUsage,
    pruneUsage,
    recordAppLaunch,
    recordSelection,
} from './lib/usage.js';

export function usagePath() {
    return GLib.build_filenamev([GLib.get_user_state_dir(), 'sift', 'usage.json']);
}

// Usage is tiny and changes only on launches, so a debounced synchronous write
// is cheaper than a D-Bus service and keeps the data inspectable.
export class UsageStore {
    constructor(path = usagePath()) {
        this._path = path;
        this._file = Gio.File.new_for_path(path);
        this._data = this._load();
        this._fileExists = this._file.query_exists(null);
        this._saveId = 0;
        this._destroyed = false;
    }

    _load() {
        try {
            const [ok, contents] = this._file.load_contents(null);
            if (!ok)
                return emptyUsage();
            return parseUsage(new TextDecoder().decode(contents));
        } catch {
            return emptyUsage();
        }
    }

    // The preferences clear action deletes the file. Drop the memory copy too,
    // otherwise the next launch would write the old counts back.
    _refresh() {
        const exists = this._file.query_exists(null);
        if (this._fileExists && !exists)
            this._data = emptyUsage();
        this._fileExists = exists;
    }

    learned(query) {
        this._refresh();
        return learnedCounts(this._data, query);
    }

    settingCount(id) {
        this._refresh();
        let count = this._data.apps[id]?.count ?? 0;
        for (const entries of Object.values(this._data.queries))
            count = Math.max(count, entries[id]?.count ?? 0);
        return count;
    }

    snapshot() {
        this._refresh();
        return this._data;
    }

    recordLaunch(id, now = Date.now()) {
        this._refresh();
        recordAppLaunch(this._data, id, now);
        this._scheduleSave();
    }

    recordSelection(query, id, now = Date.now()) {
        this._refresh();
        recordSelection(this._data, query, id, now);
        this._scheduleSave();
    }

    _scheduleSave() {
        if (this._saveId || this._destroyed)
            return;

        this._saveId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 1, () => {
            this._saveId = 0;
            this._save();
            return GLib.SOURCE_REMOVE;
        });
    }

    _save() {
        if (this._destroyed)
            return;

        this._refresh();
        pruneUsage(this._data);
        try {
            GLib.mkdir_with_parents(GLib.path_get_dirname(this._path), 0o755);
            GLib.file_set_contents(this._path, JSON.stringify(this._data));
            this._fileExists = true;
        } catch (error) {
            logError(error, 'sift: failed to save usage');
        }
    }

    flush() {
        if (!this._saveId)
            return;

        GLib.source_remove(this._saveId);
        this._saveId = 0;
        this._save();
    }

    destroy() {
        this.flush();
        this._destroyed = true;
    }
}
