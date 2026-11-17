// SPDX-License-Identifier: GPL-3.0-or-later
import {almost, assert, equal} from './assert.js';
import {GLASS_PAD, glassParams} from '../../src/lib/glassParams.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const mix = (a, b, t) => a + (b - a) * t;
const luma = ([r, g, b]) => 0.2126 * r + 0.7152 * g + 0.0722 * b;
const smoothstep = (a, b, x) => {
    const t = clamp((x - a) / (b - a), 0, 1);
    return t * t * (3 - 2 * t);
};

// The shader's tone + fill path, without rim/sheen/glow: a conservative floor.
function toneOut(params, backdropLuma) {
    const tone = params.lo + params.span *
        Math.pow(backdropLuma, params.gamma) *
        (1 - params.deep * smoothstep(params.knee, 1, backdropLuma));
    return mix(tone, luma(params.fill), params.fill[3]);
}

export function run() {
    equal(GLASS_PAD, 32);

    const dark0 = glassParams({brightness: 0, dark: true});
    const dark50 = glassParams({brightness: 50, dark: true});
    const dark100 = glassParams({brightness: 100, dark: true});
    equal(dark0.blurRadius, 30);
    equal(dark50.blurRadius, 22);
    equal(dark100.blurRadius, 14);
    equal(dark0.radius, 18);
    almost(dark0.fill[3], 0.34);
    almost(dark100.fill[3], 0.24);
    equal(dark0.rimColour.join(','), '1,1,1');

    const light0 = glassParams({brightness: 0, dark: false});
    const light100 = glassParams({brightness: 100, dark: false});
    almost(light0.lo, 0.55);
    almost(light100.lo, 0.64);
    equal(light0.sheen, 0);
    equal(light100.glow, 0);
    equal(light0.rimColour.join(','), '0.12,0.12,0.14');

    for (const dark of [true, false]) {
        for (const backdrop of [0, 0.25, 0.5, 0.75, 1]) {
            let previous = -Infinity;
            for (const brightness of [0, 25, 50, 75, 100]) {
                const value = toneOut(glassParams({brightness, dark}), backdrop);
                assert(value > previous,
                    `brightness rises at luma ${backdrop} (dark=${dark})`);
                previous = value;
            }
        }
    }

    for (const brightness of [0, 50, 100]) {
        assert(toneOut(glassParams({brightness, dark: true}), 1) <= 0.30,
            `dark guardrail at ${brightness}`);
        assert(toneOut(glassParams({brightness, dark: false}), 0) >= 0.60,
            `light guardrail at ${brightness}`);
    }
}
