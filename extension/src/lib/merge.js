// SPDX-License-Identifier: GPL-3.0-or-later

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
