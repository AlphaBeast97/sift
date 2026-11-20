// SPDX-License-Identifier: GPL-3.0-or-later
import {equal} from './assert.js';
import {isFullscreenWindow} from '../../src/lib/fullscreen.js';

export function run() {
    equal(isFullscreenWindow(null), false);
    equal(isFullscreenWindow({}), false);
    equal(isFullscreenWindow({is_fullscreen: () => false}), false);
    equal(isFullscreenWindow({is_fullscreen: () => true}), true);
}
