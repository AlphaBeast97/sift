// SPDX-License-Identifier: GPL-3.0-or-later
import {abbreviatePath, parentPath} from './format.js';

export function appRow(record) {
    return {
        kind: 'app',
        key: `app:${record.id}`,
        title: record.name,
        subtitle: record.genericName || record.id,
        app: record.app,
        icon: record.app.get_icon(),
    };
}

export function calcRow(calc) {
    return {
        kind: 'calc',
        key: 'calc',
        title: String(calc.result),
        subtitle: calc.expression,
        result: calc.result,
    };
}

export function fileRow(file, home) {
    if (!file || typeof file.path !== 'string' || !file.path.startsWith('/'))
        return null;
    if (file.kind !== 'file' && file.kind !== 'dir')
        return null;
    if (typeof file.name !== 'string' || file.name.length === 0)
        return null;

    return {
        kind: file.kind,
        key: `file:${file.path}`,
        title: file.name,
        subtitle: abbreviatePath(parentPath(file.path), home),
        path: file.path,
        icon: file.kind === 'dir' ? 'folder-symbolic' : 'text-x-generic-symbolic',
    };
}

export function mergeRows({calc = null, apps = [], files = []} = {}, maxRows) {
    const rows = [];
    if (calc)
        rows.push(calcRow(calc));
    rows.push(...apps, ...files);
    return rows.slice(0, Math.max(0, maxRows));
}

export function selectionAfter(rows, key) {
    const index = rows.findIndex(row => row.key === key);
    return index >= 0 ? index : 0;
}
