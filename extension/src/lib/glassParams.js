// SPDX-License-Identifier: GPL-3.0-or-later
export const GLASS_PAD = 32;
export const GLASS_RADIUS = 18;
const GLASS_REACH = 24;

export const GLASS_MODES = ['auto', 'light', 'dark', 'clear'];
export const GLASS_STYLES = ['liquid', 'frosted', 'flat'];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mix = (a, b, t) => a + (b - a) * t;
const mixArray = (a, b, t) => a.map((value, i) => mix(value, b[i], t));
const moreFill = (fill, amount) =>
    [...fill.slice(0, 3), clamp(fill[3] + amount, 0, 1)];

// Brightness blends these linearly: 0 dark smoked, 100 clear.
const DARK = {
    dark: {fill: [0.02, 0.025, 0.03, 0.34], lo: 0.00, span: 0.32, deep: 0.45,
        knee: 0.45, sheen: 0.01, glow: 0.02},
    clear: {fill: [0.03, 0.04, 0.05, 0.24], lo: 0.03, span: 0.50, deep: 0.35,
        knee: 0.30, sheen: 0.03, glow: 0.05},
};
const LIGHT = {
    dark: {fill: [0.93, 0.94, 0.96, 0.26], lo: 0.55, span: 0.28, deep: 0.12, knee: 0.40},
    clear: {fill: [0.96, 0.97, 0.99, 0.20], lo: 0.64, span: 0.32, deep: 0.10, knee: 0.40},
};

// Clear keeps light text and the faint smoke tint that makes it readable.
export function glassIsDark({mode = 'auto', systemDark = true} = {}) {
    if (mode === 'dark' || mode === 'clear')
        return true;
    if (mode === 'light')
        return false;
    return systemDark;
}

export function glassParams({
    mode = 'auto',
    systemDark = true,
    darkBrightness = 50,
    lightBrightness = 50,
    style = 'liquid',
} = {}) {
    const dark = glassIsDark({mode, systemDark});
    const brightness = mode === 'clear'
        ? 85
        : clamp(dark ? darkBrightness : lightBrightness, 0, 100);
    const t = brightness / 100;
    const a = dark ? DARK.dark : LIGHT.dark;
    const b = dark ? DARK.clear : LIGHT.clear;

    const params = {
        brightness,
        style: GLASS_STYLES.includes(style) ? style : 'liquid',
        radius: GLASS_RADIUS,
        blurRadius: Math.round(mix(30, 14, t)),
        fill: mixArray(a.fill, b.fill, t),
        lo: mix(a.lo, b.lo, t),
        span: mix(a.span, b.span, t),
        gamma: 1,
        deep: mix(a.deep, b.deep, t),
        knee: mix(a.knee, b.knee, t),
        saturation: mix(1.00, 1.15, t),
        sheen: dark ? mix(a.sheen, b.sheen, t) : 0,
        glow: dark ? mix(a.glow, b.glow, t) : 0,
        reach: GLASS_REACH,
        lens: mix(8, 26, t),
        band: mix(20, 24, t),
        spread: mix(0.30, 0.70, t),
        rim: mix(0.15, 0.50, t),
        rimWidth: 1.1,
        rimColour: dark ? [1, 1, 1] : [0.12, 0.12, 0.14],
    };

    if (params.style === 'frosted') {
        params.blurRadius += 8;
        params.lens = 0;
        params.band = 0;
        params.rim *= 0.7;
        params.sheen *= 0.6;
        params.fill = moreFill(params.fill, 0.06);
    } else if (params.style === 'flat') {
        params.blurRadius = 0;
        params.lens = 0;
        params.band = 0;
        params.rim = 0;
        params.sheen = 0;
        params.glow = 0;
        params.saturation = 1;
        params.fill = moreFill(params.fill, 0.12);
    }

    return params;
}
