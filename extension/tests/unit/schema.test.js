// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';

import {almost, assert, equal} from './assert.js';

const SCHEMA = 'org.gnome.shell.extensions.sift';

export function run() {
    const source = Gio.SettingsSchemaSource.get_default();
    const schema = source.lookup(SCHEMA, true);
    assert(schema !== null, 'schema is installed');
    const settings = new Gio.Settings({schema_id: SCHEMA});

    equal(settings.get_string('glass-mode'), 'auto');
    almost(settings.get_double('glass-opacity'), 0.72);
    equal(settings.get_int('blur-radius'), 40);
    almost(settings.get_double('glass-tint'), 0.45);
    equal(settings.get_boolean('animations'), true);
    equal(settings.get_int('max-results'), 6);
    equal(settings.get_int('grid-icon-size'), 96);

    const range = key => settings.get_range(key).recursiveUnpack()[1];

    equal(range('max-results').join(','), '4,12');
    equal(range('blur-radius').join(','), '0,64');
    almost(range('glass-opacity')[0], 0.30);
    almost(range('glass-opacity')[1], 0.95);
    almost(range('glass-tint')[0], 0.0);
    almost(range('glass-tint')[1], 1.0);
    equal(range('grid-icon-size').join(','), '48,128');

    equal(schema.list_keys().sort().join(','),
        'animations,blur-radius,glass-mode,glass-opacity,glass-tint,grid-icon-size,max-results');
}
