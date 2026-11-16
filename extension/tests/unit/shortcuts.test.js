// SPDX-License-Identifier: GPL-3.0-or-later
import Gdk from 'gi://Gdk?version=4.0';

import {equal} from './assert.js';
import {
    acceleratorName,
    findShortcutConflict,
    shortcutFromKey,
} from '../../src/lib/shortcuts.js';

export function run() {
    equal(acceleratorName('<Primary>space'), '<Control>space');
    equal(acceleratorName('nonsense accelerator'), '');

    const bindings = [
        {action: 'switch applications', accels: ['<Alt>Tab']},
        {action: 'open search', accels: ['<Control>space']},
    ];
    equal(findShortcutConflict('<Alt>Tab', bindings), 'switch applications');
    equal(findShortcutConflict('<Primary>space', bindings), 'open search');
    equal(findShortcutConflict('<Alt>a', bindings), null);

    equal(shortcutFromKey(Gdk.KEY_a, Gdk.ModifierType.ALT_MASK), '<Alt>a');
    equal(shortcutFromKey(Gdk.KEY_a, 0), null);
    equal(shortcutFromKey(Gdk.KEY_Control_L, Gdk.ModifierType.CONTROL_MASK), null);
    equal(shortcutFromKey(Gdk.KEY_space,
        Gdk.ModifierType.CONTROL_MASK | Gdk.ModifierType.LOCK_MASK),
    '<Control>space');
}
