// SPDX-License-Identifier: GPL-3.0-or-later
import GLib from 'gi://GLib';

import {assert, equal} from './assert.js';
import {
    DEFAULT_ICON,
    fallbackWords,
    iconName,
    metaMatches,
    parseMeta,
    settingsRow,
} from '../../src/lib/settingsSearch.js';

export function run() {
    equal(fallbackWords('what is weather tomorrow?').join(','),
        'weather,tomorrow');
    equal(fallbackWords('gnome display settings').join(','),
        'gnome,display,settings');
    equal(fallbackWords('is display').join(','), 'display');
    equal(fallbackWords('what').join(','), '');
    equal(fallbackWords('a b c').join(','), '');

    const themed = new GLib.Variant('(sv)', ['themed',
        new GLib.Variant('as',
            ['org.gnome.Settings-display-symbolic', 'org.gnome.Settings-display'])]);
    equal(iconName(themed), 'org.gnome.Settings-display-symbolic');

    const empty = new GLib.Variant('(sv)',
        ['themed', new GLib.Variant('as', [])]);
    equal(iconName(empty), DEFAULT_ICON);

    const file = new GLib.Variant('(sv)',
        ['file', new GLib.Variant('s', '/tmp/icon.png')]);
    equal(iconName(file), DEFAULT_ICON);

    const meta = parseMeta({
        id: new GLib.Variant('s', 'display'),
        name: new GLib.Variant('s', 'Displays'),
        description: new GLib.Variant('s', 'Use Night Light'),
        icon: themed,
    });
    equal(meta.id, 'display');
    equal(meta.name, 'Displays');
    equal(meta.description, 'Use Night Light');
    equal(meta.icon, 'org.gnome.Settings-display-symbolic');

    equal(metaMatches(meta, 'disp'), true);
    equal(metaMatches(meta, 'night'), true);
    equal(metaMatches(meta, 'work'), false);
    equal(metaMatches(
        {name: 'Network', description: 'Control how you connect'}, 'work'),
    false);
    equal(metaMatches({name: 'Work', description: ''}, 'work'), true);
    equal(metaMatches(meta, 'gnome display'), true);

    const row = settingsRow(meta, ['display']);
    equal(row.kind, 'setting');
    equal(row.key, 'setting:display');
    equal(row.title, 'Displays');
    equal(row.subtitle, 'Use Night Light');
    equal(row.settingId, 'display');
    assert(row.terms.join(',') === 'display', 'the row keeps its query terms');
}
