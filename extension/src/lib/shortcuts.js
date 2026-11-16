// SPDX-License-Identifier: GPL-3.0-or-later
import Gdk from 'gi://Gdk?version=4.0';
import Gtk from 'gi://Gtk?version=4.0';

const MODIFIER_KEYS = new Set([
    Gdk.KEY_Shift_L, Gdk.KEY_Shift_R,
    Gdk.KEY_Control_L, Gdk.KEY_Control_R,
    Gdk.KEY_Alt_L, Gdk.KEY_Alt_R,
    Gdk.KEY_Meta_L, Gdk.KEY_Meta_R,
    Gdk.KEY_Super_L, Gdk.KEY_Super_R,
    Gdk.KEY_Hyper_L, Gdk.KEY_Hyper_R,
    Gdk.KEY_Caps_Lock, Gdk.KEY_Num_Lock,
    Gdk.KEY_ISO_Level3_Shift, Gdk.KEY_ISO_Level5_Shift,
]);

export function acceleratorName(accelerator) {
    const [ok, keyval, mods] = Gtk.accelerator_parse(accelerator);
    return ok ? Gtk.accelerator_name(keyval, mods) : '';
}

// Returns null for a modifier by itself or a key without a modifier.
export function shortcutFromKey(keyval, state) {
    if (MODIFIER_KEYS.has(keyval))
        return null;

    const mods = state & Gtk.accelerator_get_default_mod_mask();
    if (mods === 0)
        return null;

    return Gtk.accelerator_name(keyval, mods);
}

export function findShortcutConflict(accelerator, bindings) {
    const wanted = acceleratorName(accelerator);
    if (!wanted)
        return null;

    for (const {action, accels} of bindings) {
        if (accels.some(accel => acceleratorName(accel) === wanted))
            return action;
    }
    return null;
}
