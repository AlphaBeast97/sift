// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BUS_NAME = 'org.gnome.Settings.SearchProvider';
const OBJECT_PATH = '/org/gnome/Settings/SearchProvider';
const INTERFACE = 'org.gnome.Shell.SearchProvider2';
export const DEFAULT_ICON = 'org.gnome.Settings-symbolic';

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

    async search(text, limit = 2) {
        try {
            const proxy = await this._connect();
            let ids = await this._ids(proxy, [text]);

            // The provider matches phrases and single words, not token sets;
            // retry word by word so "gnome display settings" still finds Displays.
            const words = text.split(/\s+/u).filter(Boolean);
            if (ids.length === 0 && words.length > 1) {
                ids = [];
                for (const word of words)
                    ids.push(...await this._ids(proxy, [word]));
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
