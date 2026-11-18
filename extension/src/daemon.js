// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const BUS_NAME = 'io.github.alphabeast97.Sift';
const OBJECT_PATH = '/io/github/alphabeast97/Sift';
const INTERFACE = 'io.github.alphabeast97.Sift';
const CALL_TIMEOUT_MS = 500;
const RETRY_MS = 5000;

const INTERFACE_XML = `
<node>
  <interface name="io.github.alphabeast97.Sift">
    <method name="Ping">
      <arg type="s" direction="out"/>
    </method>
    <method name="Query">
      <arg type="s" direction="in"/>
      <arg type="u" direction="in"/>
      <arg type="s" direction="out"/>
    </method>
    <method name="Reindex"/>
    <method name="EnsureFresh"/>
    <method name="Quit"/>
    <property name="Status" type="s" access="read"/>
    <property name="Config" type="s" access="read"/>
    <signal name="StatusChanged">
      <arg type="s"/>
    </signal>
  </interface>
</node>`;

export class Daemon {
    constructor({version = null, onChanged = null} = {}) {
        this._version = version;
        this._onChanged = onChanged;
        this._proxy = null;
        this._cancellable = null;
        this._nameOwner = null;
        this._status = null;
        this._retryAt = 0;
        this._disabled = false;
        this._versionWarned = false;
    }

    get available() {
        return this._proxy !== null && this._nameOwner !== null;
    }

    get unavailable() {
        return !this.available;
    }

    get status() {
        return this._status;
    }

    enable() {
        if (this._proxy || this._disabled)
            return;

        this._cancellable = new Gio.Cancellable();
        const info = Gio.DBusNodeInfo.new_for_xml(INTERFACE_XML).interfaces[0];

        Gio.DBusProxy.new_for_bus(
            Gio.BusType.SESSION,
            Gio.DBusProxyFlags.NONE,
            info,
            BUS_NAME,
            OBJECT_PATH,
            INTERFACE,
            this._cancellable,
            (source, result) => {
                if (this._disabled)
                    return;

                try {
                    this._proxy = Gio.DBusProxy.new_for_bus_finish(result);
                } catch (error) {
                    if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                        console.warn(`Sift: cannot create the daemon proxy: ${error.message}`);
                    this._changed();
                    return;
                }

                this._nameOwner = this._proxy.g_name_owner ?? null;
                this._proxy.connect('g-signal', (_proxy, _sender, name, params) => {
                    if (name === 'StatusChanged')
                        this._setStatus(params.deepUnpack()[0]);
                });
                this._proxy.connect('notify::g-name-owner', () => this._nameOwnerChanged());
                this._readStatus();
                this._pingForVersion();
                this._changed();
            });
    }

    disable() {
        this._disabled = true;
        this._cancellable?.cancel();
        this._cancellable = null;
        this._proxy = null;
        this._nameOwner = null;
        this._status = null;
    }

    query(text, limit = 20) {
        if (!this.available)
            return Promise.reject(new Error('siftd is not running'));
        if (Date.now() < this._retryAt)
            return Promise.reject(new Error('siftd retry backoff'));

        return this._call('Query', new GLib.Variant('(su)', [text, limit]))
            .then(reply => {
                this._retryAt = 0;
                const json = JSON.parse(reply.deepUnpack()[0]);
                return {
                    files: Array.isArray(json.files) ? json.files : [],
                    calc: json.calc ?? null,
                };
            })
            .catch(error => {
                this._retryAt = Date.now() + RETRY_MS;
                throw error;
            });
    }

    ping() {
        return this._call('Ping', null).then(reply => {
            this._retryAt = 0;
            return reply.deepUnpack()[0];
        });
    }

    ensureFresh() {
        this._fire('EnsureFresh');
    }

    reindex() {
        this._fire('Reindex');
    }

    _fire(method) {
        if (!this.available || Date.now() < this._retryAt)
            return;

        this._call(method, null).catch(() => {
            this._retryAt = Date.now() + RETRY_MS;
        });
    }

    _call(method, params) {
        if (!this._proxy)
            return Promise.reject(new Error('siftd is not running'));

        return new Promise((resolve, reject) => {
            this._proxy.call(
                method,
                params,
                Gio.DBusCallFlags.NONE,
                CALL_TIMEOUT_MS,
                null,
                (proxy, result) => {
                    try {
                        resolve(proxy.call_finish(result));
                    } catch (error) {
                        reject(error);
                    }
                });
        });
    }

    _pingForVersion() {
        this.ping()
            .then(version => {
                if (this._versionWarned || !this._version)
                    return;
                const base = String(version).split('+')[0];
                if (base !== this._version) {
                    this._versionWarned = true;
                    console.warn(`Sift: daemon version ${version} does not match extension ${this._version}`);
                }
            })
            .catch(() => {});
    }

    _nameOwnerChanged() {
        this._nameOwner = this._proxy?.g_name_owner ?? null;
        this._retryAt = 0;
        this._readStatus();
        this._changed();
    }

    _readStatus() {
        const variant = this._proxy?.get_cached_property('Status');
        if (variant)
            this._setStatus(variant.deepUnpack());
    }

    _setStatus(json) {
        try {
            this._status = JSON.parse(json);
        } catch {
            this._status = null;
        }
        this._changed();
    }

    _changed() {
        this._onChanged?.();
    }
}