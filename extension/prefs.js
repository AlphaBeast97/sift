// SPDX-License-Identifier: GPL-3.0-or-later
import Adw from 'gi://Adw';
import Gdk from 'gi://Gdk?version=4.0';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gtk from 'gi://Gtk?version=4.0';

import {ExtensionPreferences} from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import {findShortcutConflict, shortcutFromKey} from './src/lib/shortcuts.js';
import {Updater} from './src/updater.js';
import {usagePath} from './src/usage.js';

const BUS_NAME = 'io.github.alphabeast97.Sift';
const BUS_PATH = '/io/github/alphabeast97/Sift';
const BUS_IFACE = 'io.github.alphabeast97.Sift';
const SETTINGS_KEYS = [
    'glass-brightness', 'glass-light-brightness', 'glass-mode',
    'glass-style', 'animations', 'app-order', 'max-results',
    'search-height', 'web-search', 'web-search-engine', 'web-browser',
    'settings-search', 'fullscreen-guard', 'grid-labels', 'disable-overview',
    'update-check',
    'sift-search-shortcut', 'sift-apps-shortcut',
    'sift-workspaces-shortcut',
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

const SHORTCUT_TITLES = {
    'sift-search-shortcut': 'Search',
    'sift-apps-shortcut': 'App grid',
    'sift-workspaces-shortcut': 'Workspace view',
};

function shortcutBindings(settings, key) {
    const bindings = gnomeBindings();
    for (const [otherKey, title] of Object.entries(SHORTCUT_TITLES)) {
        if (otherKey === key)
            continue;
        const accel = shortcutAccel(settings, otherKey);
        if (accel)
            bindings.push({action: `Sift ${title.toLowerCase()}`, accels: [accel]});
    }
    return bindings;
}

function acceleratorLabel(accel) {
    const [ok, keyval, mods] = Gtk.accelerator_parse(accel);
    return ok ? Gtk.accelerator_get_label(keyval, mods) : accel;
}

// Keep in sync with extension/src/overview.js.
const OVERVIEW_DEFAULTS = {
    'sift-search-shortcut': '<Super>',
    'sift-apps-shortcut': '<Super>a',
    'sift-workspaces-shortcut': '<Super>Tab',
};

function shortcutAccel(settings, key) {
    const value = settings.get_user_value(key);
    const unset = value === null || value.get_strv().length === 0;
    if (unset && settings.get_boolean('disable-overview'))
        return OVERVIEW_DEFAULTS[key];
    return settings.get_strv(key)[0] ?? '';
}

function shortcutText(settings, key) {
    return acceleratorLabel(shortcutAccel(settings, key)) || 'Not set';
}

function recordShortcut(window, settings, key, title) {
    const dialog = new Adw.Dialog({
        title: `Set ${title.toLowerCase()} shortcut`,
        content_width: 400,
        follows_content_size: true,
    });

    const header = new Adw.HeaderBar();
    const cancel = new Gtk.Button({label: 'Cancel'});
    cancel.connect('clicked', () => dialog.close());
    header.pack_start(cancel);

    const content = new Gtk.Box({
        orientation: Gtk.Orientation.VERTICAL,
        spacing: 6,
        margin_top: 4,
        margin_bottom: 24,
        margin_start: 28,
        margin_end: 28,
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
    });

    content.append(new Gtk.Image({
        icon_name: 'input-keyboard-symbolic',
        pixel_size: 32,
        css_classes: ['card'],
        width_request: 64,
        height_request: 64,
        halign: Gtk.Align.CENTER,
        margin_bottom: 10,
    }));
    content.append(new Gtk.Label({
        label: 'Press the new shortcut',
        css_classes: ['title-3'],
    }));
    content.append(new Gtk.Label({
        label: 'Hold Ctrl, Alt, Shift or Super, then press another key.',
        wrap: true,
        justify: Gtk.Justification.CENTER,
        css_classes: ['dim-label'],
        max_width_chars: 34,
        margin_bottom: 12,
    }));

    const error = new Gtk.Label({
        wrap: true,
        justify: Gtk.Justification.CENTER,
        css_classes: ['error'],
        visible: false,
    });
    content.append(error);

    const current = new Gtk.Box({
        spacing: 8,
        halign: Gtk.Align.CENTER,
        valign: Gtk.Align.CENTER,
    });
    current.append(new Gtk.Label({
        label: shortcutText(settings, key),
        css_classes: ['keycap'],
    }));
    current.append(new Gtk.Label({
        label: 'Current shortcut',
        css_classes: ['dim-label'],
        valign: Gtk.Align.CENTER,
    }));
    content.append(current);

    const toolbar = new Adw.ToolbarView();
    toolbar.add_top_bar(header);
    toolbar.set_content(content);
    dialog.set_child(toolbar);

    const bindings = shortcutBindings(settings, key);
    const showError = message => {
        error.label = message;
        error.visible = true;
    };

    // Capture on the dialog itself: keys pressed while the Cancel button or
    // the dialog has focus must reach the recorder.
    const controller = new Gtk.EventControllerKey();
    controller.set_propagation_phase(Gtk.PropagationPhase.CAPTURE);
    dialog.add_controller(controller);
    controller.connect('key-pressed', (_controller, keyval, _keycode, state) => {
        if (keyval === Gdk.KEY_Escape) {
            dialog.close();
            return Gdk.EVENT_STOP;
        }

        const accel = shortcutFromKey(keyval, state);
        if (!accel)
            return Gdk.EVENT_STOP;

        const conflict = findShortcutConflict(accel, bindings);
        if (conflict) {
            showError(`Already used by ${conflict}.`);
            return Gdk.EVENT_STOP;
        }

        settings.set_strv(key, [accel]);
        dialog.close();
        return Gdk.EVENT_STOP;
    });

    dialog.present(window);
}

function addShortcutRow(group, window, settings, key, title, subtitle) {
    const row = valueRow(title, subtitle);
    const label = new Gtk.Label({
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
        label.label = shortcutText(settings, key);
        reset.sensitive = settings.get_user_value(key) !== null;
    };
    settings.connect(`changed::${key}`, sync);
    settings.connect('changed::disable-overview', sync);
    sync();
    button.connect('clicked', () => recordShortcut(window, settings, key, title));

    row.add_suffix(button);
    row.add_suffix(reset);
    group.add(row);
}

function addGuideShortcutRow(group, settings, key, title, action) {
    const row = valueRow(title);
    const sync = () => {
        row.subtitle = shortcutAccel(settings, key)
            ? `Press ${shortcutText(settings, key)} to ${action}.`
            : `No shortcut is set; add one under Search → Shortcuts to ${action}.`;
    };
    settings.connect(`changed::${key}`, sync);
    settings.connect('changed::disable-overview', sync);
    sync();
    group.add(row);
}

const ORDER_MODES = [
    ['az', 'A-Z'],
    ['recent', 'Recent'],
    ['most-used', 'Most used'],
    ['smart', 'Smart'],
];

function addOrderRow(group, settings) {
    const row = new Adw.ComboRow({
        title: 'Order apps',
        subtitle: 'Smart puts frequently and recently used apps first.',
        model: new Gtk.StringList({
            strings: ORDER_MODES.map(([, label]) => label),
        }),
    });
    const sync = () => {
        const index = ORDER_MODES.findIndex(([value]) =>
            value === settings.get_string('app-order'));
        row.selected = Math.max(0, index);
    };
    row.connect('notify::selected', () => {
        const mode = ORDER_MODES[row.selected]?.[0];
        if (mode && mode !== settings.get_string('app-order'))
            settings.set_string('app-order', mode);
    });
    settings.connect('changed::app-order', sync);
    sync();
    group.add(row);
    return row;
}

const ENGINE_MODES = [
    ['duckduckgo', 'DuckDuckGo'],
    ['google', 'Google'],
    ['bing', 'Bing'],
    ['startpage', 'Startpage'],
];

function browserChoices() {
    const apps = Gio.AppInfo.get_all_for_type('x-scheme-handler/https')
        .map(app => [app.get_id(), app.get_name()])
        .filter(([id]) => id)
        .sort((a, b) => a[1].localeCompare(b[1]));
    return [['', 'Default'], ...apps];
}

function addBrowserRow(group, settings) {
    const choices = browserChoices();
    const row = new Adw.ComboRow({
        title: 'Browser',
        subtitle: 'Default follows the system browser.',
        model: new Gtk.StringList({
            strings: choices.map(([, label]) => label),
        }),
    });
    const sync = () => {
        const index = choices.findIndex(([value]) =>
            value === settings.get_string('web-browser'));
        row.selected = Math.max(0, index);
    };
    row.connect('notify::selected', () => {
        const browser = choices[row.selected]?.[0];
        if (browser !== undefined &&
            browser !== settings.get_string('web-browser'))
            settings.set_string('web-browser', browser);
    });
    settings.connect('changed::web-browser', sync);
    settings.bind('web-search', row, 'sensitive', Gio.SettingsBindFlags.GET);
    sync();
    group.add(row);
    return row;
}

function addEngineRow(group, settings) {
    const row = new Adw.ComboRow({
        title: 'Search engine',
        subtitle: 'Used for the web row; typed addresses open directly.',
        model: new Gtk.StringList({
            strings: ENGINE_MODES.map(([, label]) => label),
        }),
    });
    const sync = () => {
        const index = ENGINE_MODES.findIndex(([value]) =>
            value === settings.get_string('web-search-engine'));
        row.selected = Math.max(0, index);
    };
    row.connect('notify::selected', () => {
        const engine = ENGINE_MODES[row.selected]?.[0];
        if (engine && engine !== settings.get_string('web-search-engine'))
            settings.set_string('web-search-engine', engine);
    });
    settings.connect('changed::web-search-engine', sync);
    settings.bind('web-search', row, 'sensitive', Gio.SettingsBindFlags.GET);
    sync();
    group.add(row);
    return row;
}

function addChoiceRow(group, settings, key, title, subtitle, choices) {
    const row = new Adw.ComboRow({
        title,
        subtitle,
        model: new Gtk.StringList({
            strings: choices.map(([, label]) => label),
        }),
    });
    const sync = () => {
        const index = choices.findIndex(([value]) =>
            value === settings.get_string(key));
        row.selected = Math.max(0, index);
    };
    row.connect('notify::selected', () => {
        const value = choices[row.selected]?.[0];
        if (value && value !== settings.get_string(key))
            settings.set_string(key, value);
    });
    // A stored choice that no longer exists (for example the old frosted
    // style) falls back to the first option instead of showing a stale row.
    if (choices.findIndex(([value]) =>
        value === settings.get_string(key)) < 0)
        settings.set_string(key, choices[0][0]);
    settings.connect(`changed::${key}`, sync);
    sync();
    group.add(row);
    return row;
}

function addIntRow(group, settings, key, title,
    {lower, upper, step, subtitle = value => String(value)} = {}) {
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
        row.subtitle = subtitle(settings.get_int(key));
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

function daemonConfigPath() {
    return GLib.build_filenamev([GLib.get_user_config_dir(), 'sift', 'config.toml']);
}

function readDaemonConfig() {
    const reply = Gio.DBus.session.call_sync(
        BUS_NAME, BUS_PATH, 'org.freedesktop.DBus.Properties', 'Get',
        new GLib.Variant('(ss)', [BUS_IFACE, 'Config']),
        null, Gio.DBusCallFlags.NONE, 3000, null);
    const unpacked = reply.deepUnpack();
    const value = Array.isArray(unpacked) ? unpacked[0] : unpacked;
    const json = typeof value?.deepUnpack === 'function' ? value.deepUnpack() : value;
    const parsed = JSON.parse(json);

    return {
        roots: Array.isArray(parsed.roots) ? parsed.roots : [],
        ignores: Array.isArray(parsed.exclude_dirs) ? parsed.exclude_dirs : [],
        maxEntries: Number.isInteger(parsed.max_entries) ? parsed.max_entries : 250000,
    };
}

function tomlString(value) {
    if (/[\r\n]/.test(value))
        throw new Error('A value cannot contain a new line.');
    return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
}

function writeDaemonConfig(config) {
    const text = `roots = [${config.roots.map(tomlString).join(', ')}]\n` +
        `exclude_dirs = [${config.ignores.map(tomlString).join(', ')}]\n` +
        `max_entries = ${Math.max(0, Math.round(config.maxEntries))}\n`;
    const path = daemonConfigPath();
    const file = Gio.File.new_for_path(path);
    const parent = file.get_parent();

    if (!parent.query_exists(null))
        parent.make_directory_with_parents(null);

    const [ok] = file.replace_contents(new TextEncoder().encode(text), null,
        false, Gio.FileCreateFlags.REPLACE_DESTINATION, null);
    if (!ok)
        throw new Error(`Could not save ${path}`);
}

function expandHomePath(path) {
    if (path === '~')
        return GLib.get_home_dir();
    if (path.startsWith('~/'))
        return GLib.build_filenamev([GLib.get_home_dir(), path.slice(2)]);
    return path;
}

function displayHomePath(path) {
    const home = GLib.get_home_dir();
    if (path === home)
        return '~';
    if (path.startsWith(`${home}/`))
        return `~${path.slice(home.length)}`;
    return path;
}

function reindexDaemon(window) {
    Gio.DBus.session.call(BUS_NAME, BUS_PATH, BUS_IFACE, 'Reindex',
        null, null, Gio.DBusCallFlags.NONE, 1000, null,
        (source, result) => {
            try {
                source.call_finish(result);
            } catch (error) {
                if (window.get_visible()) {
                    window.add_toast(new Adw.Toast({
                        title: `Index rebuild failed: ${error.message}`,
                    }));
                }
            }
        });
}

function setListRows(list, values, onRemove, emptyText) {
    let child = list.get_first_child();
    while (child) {
        const next = child.get_next_sibling();
        list.remove(child);
        child = next;
    }

    if (values.length === 0) {
        list.append(new Adw.ActionRow({title: emptyText, sensitive: false}));
        return;
    }

    for (const value of values) {
        const row = new Adw.ActionRow({title: displayHomePath(value)});
        const remove = new Gtk.Button({
            icon_name: 'user-trash-symbolic',
            tooltip_text: `Remove ${displayHomePath(value)}`,
            valign: Gtk.Align.CENTER,
            css_classes: ['flat'],
        });
        remove.connect('clicked', () => onRemove(value));
        row.add_suffix(remove);
        list.append(row);
    }
}

function addEntryRow(group, title, onApply) {
    const row = new Adw.EntryRow({title});
    row.show_apply_button = true;
    row.connect('apply', () => {
        const value = row.text.trim();
        if (!value)
            return;
        onApply(value);
        row.text = '';
    });
    group.add(row);
    return row;
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

        const animationsRow = new Adw.SwitchRow({
            title: 'Animations',
            subtitle: 'Animate opening and switching views.',
        });
        settings.bind('animations', animationsRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        appearanceGroup.add(animationsRow);

        addChoiceRow(appearanceGroup, settings, 'glass-mode', 'Glass mode',
            'Auto follows the system color scheme.',
            [['auto', 'Auto'], ['light', 'Light'], ['dark', 'Dark'],
                ['clear', 'Clear']]);
        addIntRow(appearanceGroup, settings, 'glass-brightness',
            'Dark glass brightness', {
                lower: 0,
                upper: 100,
                step: 5,
                subtitle: value => value <= 25 ? `Smoked (${value})` :
                    value >= 75 ? `Clear (${value})` : String(value),
            });
        addIntRow(appearanceGroup, settings, 'glass-light-brightness',
            'Light glass brightness', {
                lower: 0,
                upper: 100,
                step: 5,
                subtitle: value => value <= 25 ? `Dense (${value})` :
                    value >= 75 ? `Clear (${value})` : String(value),
            });
        addChoiceRow(appearanceGroup, settings, 'glass-style', 'Glass style',
            'Liquid bends the rim, Crystal sharpens the edge, Glow adds a halo, Flat skips the blur.',
            [['liquid', 'Liquid'], ['crystal', 'Crystal'], ['glow', 'Glow'],
                ['flat', 'Flat']]);

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
        const settingsRow = new Adw.SwitchRow({
            title: 'Search settings panels',
            subtitle: 'Include GNOME Settings results such as Displays and Wi-Fi.',
        });
        settings.bind('settings-search', settingsRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        resultsGroup.add(settingsRow);
        behavior.add(resultsGroup);

        const webGroup = new Adw.PreferencesGroup({
            title: 'Web',
            description: 'The web row sits below local results and only appears when there is room. Nothing is sent to the network until you open it.',
        });
        const webRow = new Adw.SwitchRow({
            title: 'Search the web',
            subtitle: 'Offer a last row that searches, or opens a typed address in your browser.',
        });
        settings.bind('web-search', webRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        webGroup.add(webRow);
        addBrowserRow(webGroup, settings);
        addEngineRow(webGroup, settings);
        behavior.add(webGroup);

        const fullscreenGroup = new Adw.PreferencesGroup({title: 'Fullscreen'});
        const fullscreenRow = new Adw.SwitchRow({
            title: 'Disable in fullscreen apps',
            subtitle: 'Ignore Sift shortcuts while an app is fullscreen.',
        });
        settings.bind('fullscreen-guard', fullscreenRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        fullscreenGroup.add(fullscreenRow);
        behavior.add(fullscreenGroup);

        const gridGroup = new Adw.PreferencesGroup({title: 'App grid'});
        const labelsRow = new Adw.SwitchRow({
            title: 'Show app labels',
            subtitle: 'Show app names under the icons.',
        });
        settings.bind('grid-labels', labelsRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        gridGroup.add(labelsRow);
        addOrderRow(gridGroup, settings);
        behavior.add(gridGroup);

        const learningGroup = new Adw.PreferencesGroup({
            title: 'Learning',
            description: 'Usage counts and repeated search choices stay on this machine.',
        });
        learningGroup.add(valueRow('How promotion works',
            'Pick a non-first app, file or folder result twice and it moves to the top for that query and its prefixes.'));
        const clearRow = valueRow('Clear learned ranking',
            'Remove usage counts and search choices.');
        const clearButton = new Gtk.Button({
            label: 'Clear',
            valign: Gtk.Align.CENTER,
        });
        let clearToast = null;
        clearButton.connect('clicked', () => {
            try {
                Gio.File.new_for_path(usagePath()).delete(null);
            } catch {
                // Already gone.
            }

            if (clearToast)
                return;
            clearToast = new Adw.Toast({title: 'Learned ranking cleared'});
            clearToast.connect('dismissed', () => {
                clearToast = null;
            });
            window.add_toast(clearToast);
        });
        clearRow.add_suffix(clearButton);
        learningGroup.add(clearRow);
        behavior.add(learningGroup);

        const shortcutGroup = new Adw.PreferencesGroup({
            title: 'Shortcuts',
            description: 'With the GNOME overview disabled, the defaults are Super, Super+A and Super+Tab; with it enabled, Ctrl+Space, Alt+A and Ctrl+Super+Tab. Sift never changes GNOME\'s shortcuts.',
        });
        const overviewRow = new Adw.SwitchRow({
            title: 'Disable the GNOME overview',
            subtitle: 'Super and Super+A open Sift instead; Activities, the hot corner, swipe and the login overview do nothing. Turn off to keep the GNOME overview.',
        });
        settings.bind('disable-overview', overviewRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        shortcutGroup.add(overviewRow);
        addShortcutRow(shortcutGroup, window, settings, 'sift-search-shortcut',
            'Search', 'Opens the Sift search panel.');
        addShortcutRow(shortcutGroup, window, settings, 'sift-apps-shortcut',
            'App grid', 'Opens the Sift app grid.');
        addShortcutRow(shortcutGroup, window, settings, 'sift-workspaces-shortcut',
            'Workspace view', 'Opens the workspace and window switcher.');
        behavior.add(shortcutGroup);

        window.add(behavior);
        window.add(this._filesPage(window));
        window.add(this._howToPage(settings));
        window.add(this._updatesPage(window, settings));
    }

    _updatesPage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: 'Updates',
            icon_name: 'software-update-available-symbolic',
        });

        const group = new Adw.PreferencesGroup({
            title: 'Sift updates',
            description: 'Sift checks GitHub once a day while enabled, and whenever this page opens. Only the release request is sent.',
        });

        const autoRow = new Adw.SwitchRow({
            title: 'Check for updates automatically',
            subtitle: 'Show a notification when a newer release is available.',
        });
        settings.bind('update-check', autoRow, 'active',
            Gio.SettingsBindFlags.DEFAULT);
        group.add(autoRow);

        group.add(valueRow('Installed version',
            `Sift ${this.metadata['version-name']}`));

        const statusRow = valueRow('Status', 'Checking for updates…');
        const checkButton = new Gtk.Button({
            label: 'Check now',
            valign: Gtk.Align.CENTER,
        });
        const installButton = new Gtk.Button({
            label: 'Install update',
            valign: Gtk.Align.CENTER,
            css_classes: ['suggested-action'],
            sensitive: false,
        });
        statusRow.add_suffix(checkButton);
        statusRow.add_suffix(installButton);
        group.add(statusRow);
        page.add(group);

        const systemWide = (this.dir?.get_path?.() ?? '').startsWith('/usr/');
        if (systemWide) {
            statusRow.subtitle =
                'Installed system-wide. Update it with your package manager.';
            checkButton.sensitive = false;
            return page;
        }

        const updater = new Updater({
            currentVersion: this.metadata['version-name'],
            onState: state => {
                statusRow.subtitle = state.message;
                checkButton.sensitive = !['checking', 'downloading', 'installing']
                    .includes(state.state);
                installButton.sensitive = state.state === 'available';
                if (state.state === 'done')
                    window.add_toast(new Adw.Toast({title: state.message}));
            },
        });

        window.connect('close-request', () => {
            updater.destroy();
            return false;
        });
        checkButton.connect('clicked', () => updater.check());
        installButton.connect('clicked', () => updater.install());
        updater.check();

        return page;
    }

    _filesPage(window) {
        const page = new Adw.PreferencesPage({
            title: 'Files',
            icon_name: 'folder-symbolic',
        });

        let config;
        try {
            config = readDaemonConfig();
        } catch {
            const group = new Adw.PreferencesGroup({title: 'File index'});
            group.add(valueRow('Index service unavailable',
                'The search service is not running. Start Sift, then reopen Preferences to change the index.'));
            page.add(group);
            return page;
        }

        let saveTimer = 0;
        const save = () => {
            if (saveTimer)
                GLib.source_remove(saveTimer);
            saveTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 400, () => {
                saveTimer = 0;
                try {
                    writeDaemonConfig(config);
                    reindexDaemon(window);
                } catch (error) {
                    window.add_toast(new Adw.Toast({
                        title: `Could not save the index settings: ${error.message}`,
                    }));
                }
                return GLib.SOURCE_REMOVE;
            });
        };

        const rootsGroup = new Adw.PreferencesGroup({
            title: 'Indexed folders',
            description: 'File and folder names under these folders are indexed. File contents are never read.',
        });
        const rootsList = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
        });
        const syncRoots = () => setListRows(rootsList, config.roots, path => {
            config.roots = config.roots.filter(root => root !== path);
            syncRoots();
            save();
        }, 'No folders are indexed.');
        rootsGroup.add(rootsList);
        addEntryRow(rootsGroup, 'Add a folder', value => {
            const path = expandHomePath(value);
            if (config.roots.includes(path))
                return;
            config.roots.push(path);
            syncRoots();
            save();
        });
        syncRoots();
        page.add(rootsGroup);

        const ignoreGroup = new Adw.PreferencesGroup({
            title: 'Ignored folders',
            description: 'A name like node_modules matches any folder with that name. A path like ~/Videos/raw or /mnt/backup matches that exact folder.',
        });
        const ignoreList = new Gtk.ListBox({
            selection_mode: Gtk.SelectionMode.NONE,
            css_classes: ['boxed-list'],
        });
        const syncIgnores = () => setListRows(ignoreList, config.ignores, value => {
            config.ignores = config.ignores.filter(ignore => ignore !== value);
            syncIgnores();
            save();
        }, 'Only the built-in ignores apply.');
        ignoreGroup.add(ignoreList);
        addEntryRow(ignoreGroup, 'Ignore another folder', value => {
            const path = expandHomePath(value);
            if (config.ignores.includes(path))
                return;
            config.ignores.push(path);
            syncIgnores();
            save();
        });
        syncIgnores();
        page.add(ignoreGroup);

        const limitsGroup = new Adw.PreferencesGroup({title: 'Limits'});
        const maxRow = new Adw.SpinRow({
            title: 'Maximum indexed entries',
            subtitle: 'Sift stops adding entries after this many.',
            adjustment: new Gtk.Adjustment({
                lower: 1000,
                upper: 2000000,
                step_increment: 10000,
                page_increment: 100000,
            }),
            value: config.maxEntries,
        });
        maxRow.connect('notify::value', () => {
            config.maxEntries = Math.round(maxRow.value);
            save();
        });
        limitsGroup.add(maxRow);

        const rebuildRow = valueRow('Rebuild the index',
            'Changes rebuild automatically. Use this if the index looks stale.');
        const rebuild = new Gtk.Button({
            label: 'Rebuild now',
            valign: Gtk.Align.CENTER,
        });
        rebuild.connect('clicked', () => reindexDaemon(window));
        rebuildRow.add_suffix(rebuild);
        limitsGroup.add(rebuildRow);
        page.add(limitsGroup);

        return page;
    }

    _howToPage(settings) {
        const page = new Adw.PreferencesPage({
            title: 'How to use',
            icon_name: 'help-about-symbolic',
        });

        const openGroup = new Adw.PreferencesGroup({
            title: 'Opening Sift',
            description: 'The shortcuts work from any app and can be changed under Search → Shortcuts.',
        });
        addGuideShortcutRow(openGroup, settings, 'sift-search-shortcut',
            'Search', 'open search');
        addGuideShortcutRow(openGroup, settings, 'sift-apps-shortcut',
            'App grid', 'open the app grid');
        addGuideShortcutRow(openGroup, settings, 'sift-workspaces-shortcut',
            'Workspace view', 'open the workspace switcher');
        openGroup.add(valueRow('Fullscreen apps',
            'Sift stays closed while an app is fullscreen. Turn off Disable in fullscreen apps under Search → Fullscreen to allow the shortcuts there.'));
        page.add(openGroup);

        const appearanceGroup = new Adw.PreferencesGroup({title: 'Appearance'});
        appearanceGroup.add(valueRow('Glass',
            'Pick Auto, Light, Dark or Clear under Appearance. Auto follows the system color scheme. Dark and Light have their own brightness sliders; lower keeps the glass denser and higher shows more desktop. Clear is a nearly transparent veil with clean light text. Liquid bends the backdrop at the rim, Crystal sharpens that bend into a bright edge, Glow replaces it with a soft halo, and Flat skips the blur.'));
        page.add(appearanceGroup);

        const searchGroup = new Adw.PreferencesGroup({title: 'Search'});
        searchGroup.add(valueRow('Start typing',
            'Search needs at least two characters and matches app, file and folder names.'));
        searchGroup.add(valueRow('Move around',
            '↑/↓ or Tab/Shift+Tab move, Page Up/Page Down jump, and Home/End go to the first or last result.'));
        searchGroup.add(valueRow('Open a result',
            'Enter opens the selected app or file. Ctrl+Enter opens apps in a new window and reveals files in the file manager. Esc closes Sift.'));
        searchGroup.add(valueRow('Calculator',
            'Try 2+2*3, 15% of 80, 1 km to m or 2 hours in minutes. Enter or Ctrl+C copies the result.'));
        searchGroup.add(valueRow('Web results',
            'Off by default. Turn on Search the web under Search → Web, then type an address like example.com or localhost:3000 to open it, or a phrase to get a last "Search the web" row. The row appears only when local results leave room, and Sift never contacts the network by itself. Pick Default or an installed browser under Search → Web.'));
        searchGroup.add(valueRow('Settings panels',
            'Off by default. Turn on Search settings panels under Search → Results, then type a panel name such as display, sound or wifi to open it directly. Multi-word queries try the meaningful words when needed.'));
        page.add(searchGroup);

        const gridGroup = new Adw.PreferencesGroup({title: 'App grid'});
        gridGroup.add(valueRow('Navigate apps',
            'Arrow keys move between apps, Page Up/Page Down change pages, and Home/End jump to the first or last app.'));
        gridGroup.add(valueRow('Type to search',
            'Start typing in the grid or workspace view to return to search with that text.'));
        gridGroup.add(valueRow('Open or manage an app',
            'Enter opens the app. Ctrl+Enter or middle-click opens a new window when supported. Right-click for app actions.'));
        gridGroup.add(valueRow('Order apps',
            'A-Z is the default. Recent, Most used and Smart use local launch counts; change the order under Search → App grid.'));
        page.add(gridGroup);

        const workspaceGroup = new Adw.PreferencesGroup({title: 'Windows and workspaces'});
        workspaceGroup.add(valueRow('Workspace view',
            'Click the window button in the search bar or use the workspace shortcut to see every workspace as a fixed-width card with large live thumbnails. About two and a half cards fit across, and each card shows a row and a half at a time; a partly visible card or row means there is more. Left/Right move between workspaces, Up/Down select a window, and Enter opens the selected window or workspace. Press the workspace shortcut again to return to search.'));
        workspaceGroup.add(valueRow('Move, create and close',
            'Drag a window onto the middle of another card to move it there. Drop it on a card edge, in a gap, or past the last card to create a workspace at that spot. Drag a workspace header to reorder it with its apps. Ctrl+Left/Right reorders the selected workspace and Shift+Left/Right moves the selected window. Click a close button to close a window or every window on a workspace; workspaces left empty disappear, and at most one empty workspace stays. Shift+wheel or a horizontal wheel pans the strip, a plain wheel pans it when not over a scrolling card, and dragging near an edge scrolls automatically.'));
        page.add(workspaceGroup);

        const filesGroup = new Adw.PreferencesGroup({title: 'Files and privacy'});
        filesGroup.add(valueRow('Names only',
            'Sift indexes file and folder names, never their contents.'));
        filesGroup.add(valueRow('What is skipped',
            'Hidden entries, symlinks, unreadable folders, other filesystems, and common build, dependency and cache folders are skipped.'));
        filesGroup.add(valueRow('Stays on this computer',
            'The index is stored locally and searches are not sent anywhere.'));
        filesGroup.add(valueRow('Usage stays local',
            'App launch counts and repeated search choices are stored in ~/.local/state/sift/usage.json. Clear them under Search → App grid.'));
        page.add(filesGroup);

        const limitsGroup = new Adw.PreferencesGroup({
            title: 'Limits',
            description: 'What Sift does not do yet.',
        });
        limitsGroup.add(valueRow('No content search',
            'Search does not look inside documents or files.'));
        limitsGroup.add(valueRow('Index size cap',
            'Sift stops adding entries at the maximum set on the Files page (250,000 by default).'));
        page.add(limitsGroup);

        return page;
    }
}