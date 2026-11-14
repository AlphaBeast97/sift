// SPDX-License-Identifier: GPL-3.0-or-later
import {almost, equal} from './assert.js';
import {glassParams} from '../../src/lib/glassParams.js';

export function run() {
    equal(glassParams({mode: 'auto'}).effectiveMode, 'liquid');
    equal(glassParams({mode: 'auto', fallback: 'frosted'}).effectiveMode, 'frosted');
    equal(glassParams({mode: 'off'}).effectiveMode, 'off');
    equal(glassParams({mode: 'liquid', blurRadius: 0}).blurRadius, 0);
    almost(glassParams({mode: 'liquid', opacity: 0.72}).opacity, 0.72);
    equal(glassParams({mode: 'liquid', dark: true}).tint.length, 3);
}