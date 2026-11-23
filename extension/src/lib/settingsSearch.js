// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BUS_NAME = 'org.gnome.Settings.SearchProvider';
const OBJECT_PATH = '/org/gnome/Settings/SearchProvider';
const INTERFACE = 'org.gnome.Shell.SearchProvider2';
export const DEFAULT_ICON = 'org.gnome.Settings-symbolic';

// Provider matching is fuzzy; question words pull unrelated panels into
// natural-language queries ("what" alone matches Notifications).
const STOPWORDS = new Set([
    'a', 'an', 'and', 'are', 'can', 'do', 'does', 'for', 'how', 'i', 'in',
    'is', 'me', 'my', 'of', 'on', 'or', 'the', 'to', 'what', 'when',
    'where', 'who', 'why', 'with', 'you',
]);

function wordKey(word) {
    return word.replace(/[^\p{L}\p{N}]/gu, '').toLocaleLowerCase();
}

// A single word must start a word in the panel title or description, so
// "Work" does not drag in "Network" just because it contains "work".
export function metaMatches(meta, text) {
    const words = text.trim().split(/\s+/u).filter(Boolean);
    if (words.length !== 1)
        return true;

    const needle = wordKey(words[0]);
    if (!needle)
        return true;

    return `${meta.name} ${meta.description}`.split(/\s+/u)
        .some(word => wordKey(word).startsWith(needle));
}

export function fallbackWords(text) {
    const words = text.split(/\s+/u)
        .filter(Boolean)
        .slice(0, 4)
        .map(word => word.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, ''))
        .filter(word => word.length >= 3 && !STOPWORDS.has(wordKey(word)));
    return [...new Set(words)];
}

function call(proxy, method, parameters) {
    return new Promise((resolve, reject) => {
        proxy.call(method, parameters, Gio.DBusCallFlags.NONE, -1, null,
            (source, result) => {
                try {
                    resolve(source.call_finish(result));
                } catch (error) {
                    reject(error);
                }
            });
    });
}

export function iconName(variant) {
    const [kind, data] = variant.deepUnpack();
    if (kind !== 'themed')
        return DEFAULT_ICON;
    return data.deepUnpack()[0] ?? DEFAULT_ICON;
}

export function parseMeta(meta) {
    return {
        id: meta.id?.deepUnpack() ?? '',
        name: meta.name?.deepUnpack() ?? '',
        description: meta.description?.deepUnpack() ?? '',
        icon: meta.icon ? iconName(meta.icon) : DEFAULT_ICON,
    };
}

export function settingsRow(meta, terms) {
    return {
        kind: 'setting',
        key: `setting:${meta.id}`,
        title: meta.name || meta.id,
        subtitle: meta.description,
        icon: meta.icon,
        settingId: meta.id,
        terms,
    };
}

export class SettingsSearch {
    constructor() {
        this._proxy = null;
        this._connecting = null;
    }

    _connect() {
        if (this._proxy)
            return Promise.resolve(this._proxy);
        if (!this._connecting) {
            this._connecting = new Promise((resolve, reject) => {
                Gio.DBusProxy.new_for_bus(
                    Gio.BusType.SESSION, Gio.DBusProxyFlags.NONE, null,
                    BUS_NAME, OBJECT_PATH, INTERFACE, null,
                    (_source, result) => {
                        try {
                            resolve(Gio.DBusProxy.new_for_bus_finish(result));
                        } catch (error) {
                            reject(error);
                        }
                    });
            }).then(proxy => {
                this._proxy = proxy;
                return proxy;
            }).finally(() => {
                this._connecting = null;
            });
        }
        return this._connecting;
    }

    async _ids(proxy, terms) {
        const reply = await call(proxy, 'GetInitialResultSet',
            new GLib.Variant('(as)', [terms]));
        return reply.deepUnpack()[0];
    }

    async search(text, limit = 4) {
        if (!text || STOPWORDS.has(wordKey(text)))
            return [];

        try {
            const proxy = await this._connect();
            let ids = await this._ids(proxy, [text]);

            // The provider matches phrases and single words, not token sets;
            // retry meaningful words so "gnome display settings" finds Displays
            // without turning "what is ..." into unrelated panels.
            const words = fallbackWords(text);
            if (ids.length === 0 && text.includes(' ') && words.length > 0) {
                ids = [];
                for (const word of words) {
                    const found = await this._ids(proxy, [word]);
                    ids.push(...found);
                }
                ids = [...new Set(ids)];
            }

            ids = ids.slice(0, limit);
            if (ids.length === 0)
                return [];

            const reply = await call(proxy, 'GetResultMetas',
                new GLib.Variant('(as)', [ids]));
            return reply.deepUnpack()[0]
                .map(parseMeta)
                .filter(meta => meta.id)
                .map(meta => settingsRow(meta, [text]));
        } catch {
            // Settings search is optional; local results still work without it.
            return [];
        }
    }

    activate(row, timestamp = 0) {
        this._connect().then(proxy => call(proxy, 'ActivateResult',
            new GLib.Variant('(sasu)',
                [row.settingId, row.terms, timestamp])))
            .catch(error => logError(error, 'sift: cannot open settings'));
    }
}
