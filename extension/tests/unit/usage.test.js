// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import {almost, assert, equal} from './assert.js';
import {LEARNED_THRESHOLD, rankApps} from '../../src/lib/appScore.js';
import {
    appUseScore,
    emptyUsage,
    learnedCounts,
    normalizeQuery,
    parseUsage,
    pruneUsage,
    recordAppLaunch,
    recordSelection,
    smartScore,
    sortApps,
} from '../../src/lib/usage.js';
import {UsageStore} from '../../src/usage.js';

const DAY = 86400000;
const NOW = 1700000000000;

const app = (id, name) => ({
    id, name, lowerName: name.toLowerCase(), genericName: '', lowerGeneric: '',
    keywords: [], lowerKeywords: [], lowerId: id.toLowerCase(), running: false,
});

function records() {
    return [
        app('a.desktop', 'Alpha'),
        app('b.desktop', 'Beta'),
        app('g.desktop', 'Gamma'),
    ];
}

function ids(list) {
    return list.map(record => record.id).join(',');
}

function usageWith(...record) {
    const usage = emptyUsage();
    for (const entry of record)
        recordAppLaunch(usage, ...entry);
    return usage;
}

export function run() {
    equal(normalizeQuery('  Foo   Bar '), 'foo bar');

    const decayed = emptyUsage();
    recordAppLaunch(decayed, 'a.desktop', NOW);
    decayed.apps['a.desktop'].count = 2;
    almost(appUseScore(decayed, 'a.desktop', NOW + 30 * DAY), 1);

    const az = sortApps(records(), 'az');
    equal(ids(az), 'a.desktop,b.desktop,g.desktop');

    const recent = usageWith(
        ['a.desktop', NOW - 2 * DAY],
        ['b.desktop', NOW - DAY]);
    equal(ids(sortApps(records(), 'recent', recent, NOW)),
        'b.desktop,a.desktop,g.desktop');

    const mostUsed = usageWith(
        ['b.desktop', NOW], ['b.desktop', NOW], ['a.desktop', NOW]);
    equal(ids(sortApps(records(), 'most-used', mostUsed, NOW)),
        'b.desktop,a.desktop,g.desktop');

    const tied = usageWith(['a.desktop', NOW], ['b.desktop', NOW]);
    equal(ids(sortApps(records(), 'most-used', tied, NOW)),
        'a.desktop,b.desktop,g.desktop');

    const smart = usageWith(
        ['a.desktop', NOW - 100 * DAY], ['a.desktop', NOW - 100 * DAY],
        ['b.desktop', NOW]);
    assert(smartScore(smart, 'b.desktop', NOW) >
        smartScore(smart, 'a.desktop', NOW),
    'a recent launch outranks an old habit');
    equal(ids(sortApps(records(), 'smart', smart, NOW)),
        'b.desktop,a.desktop,g.desktop');

    const learned = emptyUsage();
    recordSelection(learned, 'A', 'g.desktop', NOW);
    equal(ids(rankApps(records(), 'a', 4, learnedCounts(learned, 'a'))),
        'a.desktop,b.desktop,g.desktop');

    for (let i = 1; i < LEARNED_THRESHOLD; i++)
        recordSelection(learned, 'a', 'g.desktop', NOW);
    equal(ids(rankApps(records(), 'a', 4, learnedCounts(learned, 'a'))),
        'g.desktop,a.desktop,b.desktop');

    recordSelection(learned, 'a', 'b.desktop', NOW);
    recordSelection(learned, 'a', 'b.desktop', NOW);
    recordSelection(learned, 'a', 'b.desktop', NOW);
    equal(ids(rankApps(records(), 'a', 4, learnedCounts(learned, 'a'))),
        'b.desktop,g.desktop,a.desktop');

    const prefixed = emptyUsage();
    recordSelection(prefixed, 'fi', 'g.desktop', NOW);
    equal(learnedCounts(prefixed, 'f').get('g.desktop'), 1);
    equal(learnedCounts(prefixed, 'fil').get('g.desktop'), 1);
    equal(learnedCounts(prefixed, 'file manager').get('g.desktop'), 1);
    assert(learnedCounts(prefixed, 'x') === null, 'unrelated queries stay cold');

    recordSelection(prefixed, 'file manager', 'g.desktop', NOW);
    equal(learnedCounts(prefixed, 'file').get('g.desktop'), 2);
    recordSelection(prefixed, 'al', 'g.desktop', NOW);
    recordSelection(prefixed, 'al', 'g.desktop', NOW);
    equal(ids(rankApps(records(), 'a', 4, learnedCounts(prefixed, 'a'))),
        'g.desktop,a.desktop,b.desktop');

    const parsed = parseUsage(JSON.stringify({
        version: 1,
        apps: {'a.desktop': {count: 2, last: NOW}},
        queries: {a: {'g.desktop': {count: 2, last: NOW}}},
    }));
    equal(parsed.apps['a.desktop'].count, 2);
    equal(parsed.queries.a['g.desktop'].count, 2);
    equal(Object.keys(parseUsage('not json').apps).length, 0);
    equal(Object.keys(parseUsage('{"version":2}').apps).length, 0);

    const pruned = emptyUsage();
    for (let i = 0; i < 305; i++)
        recordAppLaunch(pruned, `app${i}.desktop`, NOW + i);
    pruneUsage(pruned);
    equal(Object.keys(pruned.apps).length, 300);
    assert(pruned.apps['app304.desktop'], 'pruning keeps the most recent');
    assert(!pruned.apps['app0.desktop'], 'pruning drops the oldest');

    const path = GLib.build_filenamev([GLib.get_tmp_dir(), 'sift-usage-test.json']);
    const file = Gio.File.new_for_path(path);
    try {
        file.delete(null);
    } catch {
        // No previous test file.
    }

    const store = new UsageStore(path);
    store.recordLaunch('a.desktop', NOW);
    store.recordSelection('Term', 'b.desktop', NOW);
    store.recordSelection('Term', 'setting:display', NOW);
    store.recordSelection('Term', 'setting:display', NOW);
    store.flush();

    const loaded = new UsageStore(path);
    equal(loaded.snapshot().apps['a.desktop'].count, 1);
    equal(loaded.learned(' term ').get('b.desktop'), 1);
    equal(loaded.settingCount('setting:display'), 2);
    equal(loaded.settingCount('c.desktop'), 0);
    loaded.destroy();

    file.delete(null);
    equal(loaded.learned('term'), null);
    equal(Object.keys(loaded.snapshot().apps).length, 0);
    store.destroy();
}
