// SPDX-License-Identifier: GPL-3.0-or-later

export const APP_HALF_LIFE_DAYS = 30;
export const SMART_RECENCY_HALF_LIFE_DAYS = 7;
export const SMART_RECENCY_WEIGHT = 0.5;
export const MAX_APPS = 300;
export const MAX_QUERIES = 200;
export const MAX_QUERY_APPS = 20;

const DAY_MS = 86400000;

export function normalizeQuery(query) {
    return String(query ?? '').trim().replace(/\s+/gu, ' ').toLocaleLowerCase();
}

export function emptyUsage() {
    return {version: 1, apps: {}, queries: {}};
}

function validEntries(map) {
    const entries = {};
    for (const [key, entry] of Object.entries(map ?? {})) {
        if (typeof entry?.count !== 'number' || typeof entry?.last !== 'number')
            continue;
        entries[key] = {
            count: Math.max(0, entry.count),
            last: Math.max(0, entry.last),
        };
    }
    return entries;
}

export function parseUsage(text) {
    try {
        const data = JSON.parse(text);
        if (data?.version !== 1 || typeof data.apps !== 'object' ||
            typeof data.queries !== 'object')
            return emptyUsage();

        const queries = {};
        for (const [query, entries] of Object.entries(data.queries))
            queries[query] = validEntries(entries);

        return {version: 1, apps: validEntries(data.apps), queries};
    } catch {
        return emptyUsage();
    }
}

export function decay(count, last, now, halfLifeDays) {
    if (!count || !last)
        return 0;
    const ageDays = Math.max(0, (now - last) / DAY_MS);
    return count * 2 ** (-ageDays / halfLifeDays);
}

export function appUseScore(usage, id, now) {
    const entry = usage?.apps?.[id];
    return entry ? decay(entry.count, entry.last, now, APP_HALF_LIFE_DAYS) : 0;
}

export function smartScore(usage, id, now) {
    const entry = usage?.apps?.[id];
    if (!entry)
        return 0;
    return decay(entry.count, entry.last, now, APP_HALF_LIFE_DAYS) +
        SMART_RECENCY_WEIGHT *
        decay(1, entry.last, now, SMART_RECENCY_HALF_LIFE_DAYS);
}

export function learnedCounts(usage, query) {
    const entries = usage?.queries?.[normalizeQuery(query)];
    if (!entries)
        return null;
    return new Map(Object.entries(entries)
        .map(([id, entry]) => [id, entry.count]));
}

export function recordAppLaunch(usage, id, now) {
    const entry = usage.apps[id] ?? (usage.apps[id] = {count: 0, last: 0});
    entry.count++;
    entry.last = now;
}

export function recordSelection(usage, query, id, now) {
    const key = normalizeQuery(query);
    if (!key)
        return;

    const entries = usage.queries[key] ?? (usage.queries[key] = {});
    const entry = entries[id] ?? (entries[id] = {count: 0, last: 0});
    entry.count++;
    entry.last = now;
}

export function sortApps(records, mode = 'az', usage = null, now = Date.now()) {
    const byName = (a, b) => a.name.localeCompare(b.name);
    const sorted = [...records];

    if (mode === 'recent') {
        sorted.sort((a, b) =>
            (usage?.apps?.[b.id]?.last ?? 0) -
            (usage?.apps?.[a.id]?.last ?? 0) || byName(a, b));
    } else if (mode === 'most-used') {
        sorted.sort((a, b) =>
            appUseScore(usage, b.id, now) - appUseScore(usage, a.id, now) ||
            byName(a, b));
    } else if (mode === 'smart') {
        sorted.sort((a, b) =>
            smartScore(usage, b.id, now) - smartScore(usage, a.id, now) ||
            byName(a, b));
    } else {
        sorted.sort(byName);
    }

    return sorted;
}

function pruneMap(map, max) {
    const entries = Object.entries(map);
    if (entries.length <= max)
        return map;

    entries.sort((a, b) => (b[1].last ?? 0) - (a[1].last ?? 0));
    return Object.fromEntries(entries.slice(0, max));
}

export function pruneUsage(usage) {
    usage.apps = pruneMap(usage.apps, MAX_APPS);
    usage.queries = pruneMap(usage.queries, MAX_QUERIES);
    for (const [query, entries] of Object.entries(usage.queries))
        usage.queries[query] = pruneMap(entries, MAX_QUERY_APPS);
    return usage;
}
