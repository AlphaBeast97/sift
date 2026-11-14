// SPDX-License-Identifier: GPL-3.0-or-later
import Adw from 'gi://Adw';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

const GLASS_MODES = ['auto', 'liquid', 'frosted', 'off'];
const MODE_LABELS = ['Auto', 'Liquid', 'Frosted', 'Off'];
const BUS_NAME = 'io.github.alphabeast97.Sift';
const BUS_PATH = '/io/github/alphabeast97/Sift';
const BUS_IFACE = 'io.github.alphabeast97.Sift';
const SETTINGS_KEYS = [
    'glass-mode', 'glass-opacity', 'blur-radius', 'glass-tint', 'animations',
    'max-results', 'grid-icon-size',
];

function valueRow(title, subtitle = '') {
    return new Adw.ActionRow({title, subtitle});
}

function addDoubleRow(group, settings, key, title, {lower, upper, step}) {
    const row = valueRow(title);
    const adjustment = new Gtk.Adjustment({
        lower,
        upper,
        step_increment: step,
        page_increment: step * 2,
    });
    const scale = new Gtk.Scale({
        adjustment,
        digits: 2,
        draw_value: false,
        hexpand: true,
        valign: Gtk.Align.CENTER,
        width_request: 200,
    });

    const sync = () => {
        row.subtitle = settings.get_double(key).toFixed(2);
    };

    settings.bind(key, adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
    settings.connect(`changed::${key}`, sync);
    sync();

    row.add_suffix(scale);
    group.add(row);
}

function addIntRow(group, settings, key, title, {lower, upper, step}) {
    const row = valueRow(title);
    const adjustment = new Gtk.Adjustment({
        lower,
        upper,
        step_increment: step,
        page_increment: step * 2,
    });
    const scale = new Gtk.Scale({
        adjustment,
        digits: 0,
        draw_value: false,
        hexpand: true,
        valign: Gtk.Align.CENTER,
        width_request: 200,
    });

    const sync = () => {
        row.subtitle = String(settings.get_int(key));
    };

    adjustment.value = settings.get_int(key);
    adjustment.connect('value-changed', () => {
        settings.set_int(key, Math.round(adjustment.value));
    });
    settings.connect(`changed::${key}`, () => {
        adjustment.value = settings.get_int(key);
        sync();
    });
    sync();

    row.add_suffix(scale);
    group.add(row);
}

export default class SiftPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        window.set_default_size(600, 720);
        window.set_search_enabled(true);
        window.title = 'Sift';

        const appearance = new Adw.PreferencesPage({
            title: 'Appearance',
            icon_name: 'applications-graphics-symbolic',
        });
        const appearanceGroup = new Adw.PreferencesGroup({
            title: 'Glass',
            description: 'The search overlay uses the desktop behind it as its backdrop.',
        });

        const modeRow = new Adw.ComboRow({
            title: 'Mode',
            model: new Gtk.StringList({strings: MODE_LABELS}),
        });
        modeRow.selected = Math.max(0,
            GLASS_MODES.indexOf(settings.get_string('glass-mode')));
        modeRow.connect('notify::selected', () => {
            const mode = GLASS_MODES[modeRow.selected];
            if (settings.get_string('glass-mode') !== mode)
                settings.set_string('glass-mode', mode);
        });
        settings.connect('changed::glass-mode', () => {
            const selected = Math.max(0,
                GLASS_MODES.indexOf(settings.get_string('glass-mode')));
            if (modeRow.selected !== selected)
                modeRow.selected = selected;
        });
        appearanceGroup.add(modeRow);

        const animationsRow = new Adw.SwitchRow({
            title: 'Animations',
            subtitle: 'Animate opening and switching views.',
        });
        settings.bind('animations', animationsRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        appearanceGroup.add(animationsRow);

        addDoubleRow(appearanceGroup, settings, 'glass-opacity', 'Opacity',
            {lower: 0.30, upper: 0.95, step: 0.05});
        addIntRow(appearanceGroup, settings, 'blur-radius', 'Blur radius',
            {lower: 0, upper: 64, step: 1});
        addDoubleRow(appearanceGroup, settings, 'glass-tint', 'Tint',
            {lower: 0, upper: 1, step: 0.05});

        appearance.add(appearanceGroup);

        const resetGroup = new Adw.PreferencesGroup();
        const resetRow = valueRow('Reset all settings',
            'Restore every Sift setting to its default.');
        const resetButton = new Gtk.Button({
            label: 'Reset',
            valign: Gtk.Align.CENTER,
        });
        resetButton.connect('clicked', () => {
            for (const key of SETTINGS_KEYS)
                settings.reset(key);
            window.add_toast(new Adw.Toast({title: 'Settings reset'}));
        });
        resetRow.add_suffix(resetButton);
        resetGroup.add(resetRow);
        appearance.add(resetGroup);

        window.add(appearance);

        const behavior = new Adw.PreferencesPage({
            title: 'Search',
            icon_name: 'edit-find-symbolic',
        });
        const resultsGroup = new Adw.PreferencesGroup({title: 'Results'});
        addIntRow(resultsGroup, settings, 'max-results', 'Maximum results',
            {lower: 4, upper: 12, step: 1});
        behavior.add(resultsGroup);

        const gridGroup = new Adw.PreferencesGroup({title: 'App grid'});
        addIntRow(gridGroup, settings, 'grid-icon-size', 'Icon size',
            {lower: 48, upper: 128, step: 1});
        behavior.add(gridGroup);

        const indexGroup = new Adw.PreferencesGroup({title: 'File indexing'});
        const indexRow = valueRow('Search home folder',
            'File and directory names are indexed. File contents are never read.');
        const rebuild = new Gtk.Button({
            label: 'Rebuild index',
            valign: Gtk.Align.CENTER,
        });
        rebuild.connect('clicked', () => {
            Gio.DBus.session.call(BUS_NAME, BUS_PATH, BUS_IFACE, 'Reindex',
                null, null, Gio.DBusCallFlags.NONE, 1000, null,
                (source, result) => {
                    try {
                        source.call_finish(result);
                    } catch (error) {
                        window.add_toast(new Adw.Toast({
                            title: `Index rebuild failed: ${error.message}`,
                        }));
                    }
                });
        });
        indexRow.add_suffix(rebuild);
        indexGroup.add(indexRow);
        behavior.add(indexGroup);

        window.add(behavior);
    }
}