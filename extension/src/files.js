// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

const ICON_CACHE_LIMIT = 256;
const FILE_MANAGER_BUS = 'org.freedesktop.FileManager1';
const FILE_MANAGER_PATH = '/org/freedesktop/FileManager1';
const FILE_MANAGER_INTERFACE = 'org.freedesktop.FileManager1';

const iconCache = new Map();

export function loadFileIcon(path, iconActor) {
    if (iconCache.has(path)) {
        applyIcon(iconActor, iconCache.get(path));
        return;
    }

    if (!Object.prototype.hasOwnProperty.call(iconActor, '_siftIconLoad')) {
        iconActor._siftIconLoad = null;
        iconActor.connect('destroy', () => {
            iconActor._siftIconLoad?.cancel();
            iconActor._siftIconLoad = null;
        });
    }
    iconActor._siftIconLoad?.cancel();

    const cancellable = new Gio.Cancellable();
    iconActor._siftIconLoad = cancellable;
    const file = Gio.File.new_for_path(path);

    file.query_info_async(
        'standard::icon',
        Gio.FileQueryInfoFlags.NONE,
        GLib.PRIORITY_LOW,
        cancellable,
        (source, result) => {
            let icon = null;
            try {
                icon = source.query_info_finish(result).get_icon();
            } catch (error) {
                if (!error.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.CANCELLED))
                    icon = null;
            }

            remember(path, icon);
            if (icon && iconActor._siftIconLoad === cancellable)
                iconActor.gicon = icon;
        });
}

export function openFile(path) {
    const uri = Gio.File.new_for_path(path).get_uri();
    Gio.AppInfo.launch_default_for_uri_async(uri, null, null, (source, result) => {
        try {
            Gio.AppInfo.launch_default_for_uri_finish(result);
        } catch (error) {
            console.warn(`Sift: cannot open ${path}: ${error.message}`);
        }
    });
}

export function revealFile(path) {
    const uri = Gio.File.new_for_path(path).get_uri();

    Gio.DBus.session.call(
        FILE_MANAGER_BUS,
        FILE_MANAGER_PATH,
        FILE_MANAGER_INTERFACE,
        'ShowItems',
        new GLib.Variant('(as)', [[uri]]),
        null,
        Gio.DBusCallFlags.NONE,
        500,
        null,
        (source, result) => {
            try {
                source.call_finish(result);
            } catch {
                const parent = Gio.File.new_for_path(path).get_parent();
                if (parent)
                    openFile(parent.get_path());
            }
        });
}

function remember(path, icon) {
    iconCache.set(path, icon);
    if (iconCache.size <= ICON_CACHE_LIMIT)
        return;

    const oldest = iconCache.keys().next().value;
    iconCache.delete(oldest);
}

function applyIcon(iconActor, icon) {
    if (icon)
        iconActor.gicon = icon;
}