// SPDX-License-Identifier: GPL-3.0-or-later
import {almost, assert, equal} from './assert.js';
import {
    GLASS_PAD,
    GLASS_STYLES,
    glassIsDark,
    glassParams,
} from '../../src/lib/glassParams.js';

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

    assert(glassIsDark({mode: 'auto', systemDark: true}), 'auto follows dark');
    assert(!glassIsDark({mode: 'auto', systemDark: false}), 'auto follows light');
    assert(glassIsDark({mode: 'dark', systemDark: false}), 'dark wins');
    assert(!glassIsDark({mode: 'light', systemDark: true}), 'light wins');
    assert(glassIsDark({mode: 'clear', systemDark: false}),
        'clear uses light text');

    const dark0 = glassParams({mode: 'dark', darkBrightness: 0});
    const dark50 = glassParams({mode: 'dark', darkBrightness: 50});
    const dark100 = glassParams({mode: 'dark', darkBrightness: 100});
    equal(dark0.blurRadius, 30);
    equal(dark50.blurRadius, 22);
    equal(dark100.blurRadius, 14);
    equal(dark0.radius, 18);
    almost(dark0.fill[3], 0.34);
    almost(dark100.fill[3], 0.24);
    equal(dark0.rimColour.join(','), '1,1,1');

    const light0 = glassParams({mode: 'light', lightBrightness: 0});
    const light50 = glassParams({mode: 'light', lightBrightness: 50});
    const light100 = glassParams({mode: 'light', lightBrightness: 100});
    almost(light0.lo, 0.36);
    almost(light100.lo, 0.44);
    equal(light0.sheen, 0);
    equal(light100.glow, 0);
    equal(light0.rimColour.join(','), '0.12,0.12,0.14');
    assert(toneOut(light50, 0.9) < 0.80,
        'light glass shows the desktop instead of painting it white');

    // The sliders are independent: the other mode's value changes nothing.
    almost(glassParams({mode: 'dark', darkBrightness: 20,
        lightBrightness: 90}).fill[3],
    glassParams({mode: 'dark', darkBrightness: 20}).fill[3]);
    almost(glassParams({mode: 'light', lightBrightness: 20,
        darkBrightness: 90}).fill[3],
    glassParams({mode: 'light', lightBrightness: 20}).fill[3]);

    const clear = glassParams({mode: 'clear', darkBrightness: 0,
        lightBrightness: 0});
    equal(clear.brightness, 100);
    almost(clear.fill[3], 0.05);
    assert(toneOut(clear, 0.9) > 0.65 && toneOut(clear, 0.9) < 0.80,
        'clear stays transparent over a bright desktop');
    assert(toneOut(clear, 0) < 0.04,
        'clear keeps the dark desktop visible');

    for (const mode of ['dark', 'light']) {
        for (const backdrop of [0, 0.25, 0.5, 0.75, 1]) {
            let previous = -Infinity;
            for (const brightness of [0, 25, 50, 75, 100]) {
                const params = glassParams({
                    mode,
                    ...(mode === 'dark'
                        ? {darkBrightness: brightness}
                        : {lightBrightness: brightness}),
                });
                const tone = toneOut(params, backdrop);
                assert(tone > previous,
                    `brightness rises at luma ${backdrop} (${mode})`);
                previous = tone;
            }
        }
    }

    for (const brightness of [0, 50, 100]) {
        assert(toneOut(glassParams({mode: 'dark',
            darkBrightness: brightness}), 1) <= 0.30,
        `dark guardrail at ${brightness}`);
        assert(toneOut(glassParams({mode: 'light',
            lightBrightness: brightness}), 0) >= 0.40,
        `light guardrail at ${brightness}`);
    }

    equal(GLASS_STYLES.join(','), 'liquid,crystal,glow,flat');
    const liquid = glassParams({mode: 'dark'});
    const crystal = glassParams({mode: 'dark', style: 'crystal'});
    const glow = glassParams({mode: 'dark', style: 'glow'});
    const flat = glassParams({mode: 'dark', style: 'flat'});
    assert(crystal.lens > liquid.lens, 'crystal bends the backdrop harder');
    assert(crystal.band < liquid.band, 'crystal keeps the bend at the edge');
    assert(crystal.rim > liquid.rim, 'crystal brightens the rim');
    assert(crystal.fill[3] < liquid.fill[3], 'crystal keeps less haze');
    equal(glow.lens, 0);
    equal(glow.band, 0);
    assert(glow.glow > liquid.glow, 'glow adds a soft halo');
    assert(glow.sheen >= liquid.sheen, 'glow keeps a sheen');
    assert(glassParams({mode: 'light', style: 'glow'}).glow > 0,
        'the halo is visible on light glass too');
    equal(flat.blurRadius, 0);
    equal(flat.rim, 0);
    assert(flat.fill[3] > liquid.fill[3], 'flat keeps the most tint');
    equal(glassParams({mode: 'dark', style: 'frosted'}).style, 'liquid');
}
