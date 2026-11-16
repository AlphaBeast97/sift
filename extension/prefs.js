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
    'max-results', 'search-height', 'grid-size', 'grid-labels',
];
const GRID_SIZES = ['auto', '3x8', '4x6', '6x4', '8x3'];
const GRID_LABELS = [
    'Automatic', '3 columns × 8 rows', '4 columns × 6 rows',
    '6 columns × 4 rows', '8 columns × 3 rows',
];

function valueRow(title, subtitle = '') {
    return new Adw.ActionRow({title, subtitle});
}

function resetButton(settings, key) {
    const button = new Gtk.Button({
        icon_name: 'edit-undo-symbolic',
        tooltip_text: 'Reset to default',
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
    });
    button.sensitive = settings.get_user_value(key) !== null;
    button.connect('clicked', () => settings.reset(key));
    return button;
}

function addDoubleRow(group, settings, key, title, {lower, upper, step}) {
    const row = valueRow(title);
    const reset = resetButton(settings, key);
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
        reset.sensitive = settings.get_user_value(key) !== null;
    };

    settings.bind(key, adjustment, 'value', Gio.SettingsBindFlags.DEFAULT);
    settings.connect(`changed::${key}`, sync);
    sync();

    row.add_suffix(scale);
    row.add_suffix(reset);
    group.add(row);
}

function addIntRow(group, settings, key, title, {lower, upper, step}) {
    const row = valueRow(title);
    const reset = resetButton(settings, key);
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
        reset.sensitive = settings.get_user_value(key) !== null;
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
    row.add_suffix(reset);
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
        let resetToast = null;
        resetButton.connect('clicked', () => {
            for (const key of SETTINGS_KEYS)
                settings.reset(key);

            if (resetToast)
                return;

            resetToast = new Adw.Toast({title: 'Settings reset'});
            resetToast.connect('dismissed', () => {
                resetToast = null;
            });
            window.add_toast(resetToast);
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
        addIntRow(resultsGroup, settings, 'search-height', 'Panel height (px)',
            {lower: 144, upper: 716, step: 52});
        addIntRow(resultsGroup, settings, 'max-results', 'Maximum results',
            {lower: 4, upper: 12, step: 1});
        behavior.add(resultsGroup);

        const gridGroup = new Adw.PreferencesGroup({title: 'App grid'});
        const sizeRow = new Adw.ComboRow({
            title: 'Grid size',
            subtitle: 'The panel stays the same size; icons shrink or grow to fit.',
            model: new Gtk.StringList({strings: GRID_LABELS}),
        });
        sizeRow.selected = Math.max(0,
            GRID_SIZES.indexOf(settings.get_string('grid-size')));
        sizeRow.connect('notify::selected', () => {
            const size = GRID_SIZES[sizeRow.selected];
            if (settings.get_string('grid-size') !== size)
                settings.set_string('grid-size', size);
        });
        settings.connect('changed::grid-size', () => {
            const selected = Math.max(0,
                GRID_SIZES.indexOf(settings.get_string('grid-size')));
            if (sizeRow.selected !== selected)
                sizeRow.selected = selected;
        });
        gridGroup.add(sizeRow);

        const labelsRow = new Adw.SwitchRow({
            title: 'Show app labels',
            subtitle: 'Show app names under the icons.',
        });
        settings.bind('grid-labels', labelsRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        gridGroup.add(labelsRow);
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