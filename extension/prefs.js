// SPDX-License-Identifier: GPL-3.0-or-later
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {findShortcutConflict, shortcutFromKey} from './src/lib/shortcuts.js';

const GLASS_MODES = ['auto', 'liquid', 'frosted', 'off'];
const MODE_LABELS = ['Auto', 'Liquid', 'Frosted', 'Off'];
const BUS_NAME = 'io.github.alphabeast97.Sift';
const BUS_PATH = '/io/github/alphabeast97/Sift';
const BUS_IFACE = 'io.github.alphabeast97.Sift';
const SETTINGS_KEYS = [
    'glass-mode', 'glass-opacity', 'blur-radius', 'glass-tint', 'animations',
    'max-results', 'search-height', 'grid-labels', 'overview-takeover',
    'sift-search-shortcut', 'sift-apps-shortcut',
];
const GNOME_BINDING_SCHEMAS = [
    'org.gnome.shell.keybindings',
    'org.gnome.desktop.wm.keybindings',
    'org.gnome.mutter.keybindings',
    'org.gnome.settings-daemon.plugins.media-keys',
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

function gnomeBindings() {
    const bindings = [];

    for (const schemaId of GNOME_BINDING_SCHEMAS) {
        const schema = Gio.SettingsSchemaSource.get_default()?.lookup(schemaId, true);
        if (!schema)
            continue;

        const gnome = new Gio.Settings({settings_schema: schema});
        for (const key of gnome.list_keys()) {
            const type = gnome.get_value(key).get_type_string();
            const accels = type === 'as'
                ? gnome.get_strv(key)
                : type === 's' ? [gnome.get_string(key)] : [];
            if (accels.length > 0) {
                bindings.push({
                    action: `GNOME's ${key.replaceAll('-', ' ')}`,
                    accels,
                });
            }
        }
    }

    const media = new Gio.Settings({
        schema_id: 'org.gnome.settings-daemon.plugins.media-keys',
    });
    for (const path of media.get_strv('custom-keybindings')) {
        const custom = new Gio.Settings({
            schema_id: 'org.gnome.settings-daemon.plugins.media-keys.custom-keybinding',
            path,
        });
        const accel = custom.get_string('binding');
        if (accel) {
            bindings.push({
                action: custom.get_string('name') || 'a custom shortcut',
                accels: [accel],
            });
        }
    }

    return bindings;
}

function shortcutBindings(settings, key) {
    const bindings = gnomeBindings();
    const otherKey = key === 'sift-search-shortcut'
        ? 'sift-apps-shortcut' : 'sift-search-shortcut';
    const other = settings.get_strv(otherKey);
    if (other.length > 0)
        bindings.push({action: 'Sift\'s other shortcut', accels: other});
    return bindings;
}

function recordShortcut(window, settings, key, title) {
    const dialog = new Gtk.Dialog({
        transient_for: window,
        modal: true,
        title: `Set ${title}`,
        use_header_bar: true,
    });
    const cancel = dialog.add_button('Cancel', Gtk.ResponseType.CANCEL);
    cancel.connect('clicked', () => dialog.close());

    const content = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 12,
        margin_top: 24,
        margin_bottom: 24,
        margin_start: 24,
        margin_end: 24,
    });
    const prompt = new Gtk.Label({
        label: 'Press the new shortcut.',
        wrap: true,
    });
    const error = new Gtk.Label({
        wrap: true,
        css_classes: ['error'],
    });
    content.append(prompt);
    content.append(error);
    dialog.get_content_area().append(content);
    const bindings = shortcutBindings(settings, key);

    // Capture on the window: focus starts on the Cancel button, so a
    // controller on the content box never sees the key presses.
    const controller = new Gtk.EventControllerKey();
    controller.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
    dialog.add_controller(controller);
    controller.connect('key-pressed', (_controller, keyval, _keycode, state) => {
        if (keyval === Gdk.KEY_Escape) {
            dialog.close();
            return Gdk.EVENT_STOP;
        }

        const accel = shortcutFromKey(keyval, state);
        if (!accel) {
            error.label = 'Hold Ctrl, Alt, Shift or Super and press another key.';
            return Gdk.EVENT_STOP;
        }

        const conflict = findShortcutConflict(accel, bindings);
        if (conflict) {
            error.label = `Already used by ${conflict}.`;
            return Gdk.EVENT_STOP;
        }

        settings.set_strv(key, [accel]);
        dialog.close();
        return Gdk.EVENT_STOP;
    });

    dialog.present();
}

function addShortcutRow(group, window, settings, key, title, subtitle) {
    const row = valueRow(title, subtitle);
    const label = new Gtk.ShortcutLabel({
        accelerator: settings.get_strv(key)[0] ?? '',
        disabled_text: 'Not set',
        valign: Gtk.Align.CENTER,
    });
    const button = new Gtk.Button({
        child: label,
        valign: Gtk.Align.CENTER,
        css_classes: ['flat'],
        tooltip_text: 'Change shortcut',
    });
    const reset = resetButton(settings, key);

    const sync = () => {
        label.accelerator = settings.get_strv(key)[0] ?? '';
        reset.sensitive = settings.get_user_value(key) !== null;
    };
    settings.connect(`changed::${key}`, sync);
    button.connect('clicked', () => recordShortcut(window, settings, key, title));

    row.add_suffix(button);
    row.add_suffix(reset);
    group.add(row);
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
        const labelsRow = new Adw.SwitchRow({
            title: 'Show app labels',
            subtitle: 'Show app names under the icons.',
        });
        settings.bind('grid-labels', labelsRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        gridGroup.add(labelsRow);
        behavior.add(gridGroup);

        const shortcutGroup = new Adw.PreferencesGroup({
            title: 'Shortcuts',
            description: 'Sift never changes the GNOME shortcuts.',
        });
        const takeoverRow = new Adw.SwitchRow({
            title: 'Replace the GNOME overview',
            subtitle: 'Super, Activities, the hot corner and Super+A open Sift. Turn off to keep the GNOME overview; the shortcuts below still open Sift.',
        });
        settings.bind('overview-takeover', takeoverRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        shortcutGroup.add(takeoverRow);
        addShortcutRow(shortcutGroup, window, settings, 'sift-search-shortcut',
            'Search', 'Opens the Sift search panel.');
        addShortcutRow(shortcutGroup, window, settings, 'sift-apps-shortcut',
            'App grid', 'Opens the Sift app grid.');
        behavior.add(shortcutGroup);

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