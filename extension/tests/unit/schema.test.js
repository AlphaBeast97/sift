// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';

import {assert, equal} from './assert.js';

const SCHEMA = 'org.gnome.shell.extensions.sift';

export function run() {
    const source = Gio.SettingsSchemaSource.get_default();
    const schema = source.lookup(SCHEMA, true);
    assert(schema !== null, 'schema is installed');
    const settings = new Gio.Settings({schema_id: SCHEMA});

    equal(settings.get_int('glass-brightness'), 50);
    equal(settings.get_int('glass-light-brightness'), 50);
    equal(settings.get_string('glass-mode'), 'auto');
    equal(settings.get_string('glass-style'), 'liquid');
    equal(settings.get_boolean('animations'), true);
    equal(settings.get_string('app-order'), 'az');
    equal(settings.get_int('max-results'), 6);
    equal(settings.get_int('search-height'), 404);
    equal(settings.get_boolean('web-search'), false);
    equal(settings.get_string('web-search-engine'), 'duckduckgo');
    equal(settings.get_string('web-browser'), '');
    equal(settings.get_boolean('settings-search'), false);
    equal(settings.get_boolean('fullscreen-guard'), true);
    equal(settings.get_boolean('grid-labels'), true);
    equal(settings.get_boolean('disable-overview'), true);
    equal(settings.get_strv('sift-search-shortcut').join(','), '<Control>space');
    equal(settings.get_strv('sift-apps-shortcut').join(','), '<Alt>a');
    equal(settings.get_strv('sift-workspaces-shortcut').join(','),
        '<Control><Super>Tab');

    const range = key => settings.get_range(key).recursiveUnpack()[1];

    equal(range('glass-brightness').join(','), '0,100');
    equal(range('glass-light-brightness').join(','), '0,100');
    equal(range('max-results').join(','), '4,12');
    equal(range('search-height').join(','), '144,716');

    equal(schema.list_keys().sort().join(','),
        'animations,app-order,disable-overview,fullscreen-guard,glass-brightness,glass-light-brightness,glass-mode,glass-style,grid-labels,max-results,search-height,settings-search,sift-apps-shortcut,sift-search-shortcut,sift-workspaces-shortcut,web-browser,web-search,web-search-engine');
}
