// SPDX-License-Identifier: GPL-3.0-or-later
export const GLASS_PAD = 32;
export const GLASS_RADIUS = 18;
const GLASS_REACH = 24;

export const GLASS_MODES = ['auto', 'light', 'dark', 'clear'];
export const GLASS_STYLES = ['liquid', 'crystal', 'glow', 'flat'];

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));
const mix = (a, b, t) => a + (b - a) * t;
const mixArray = (a, b, t) => a.map((value, i) => mix(value, b[i], t));
const moreFill = (fill, amount) =>
    [...fill.slice(0, 3), clamp(fill[3] + amount, 0, 1)];
const lessFill = (fill, amount) =>
    [...fill.slice(0, 3), clamp(fill[3] - amount, 0, 1)];

// Brightness blends these linearly: 0 dense, 100 clear. The light floor stays
// low enough to show the desktop, but still bright enough for dark text.
const DARK = {
    dark: {fill: [0.02, 0.025, 0.03, 0.34], lo: 0.00, span: 0.32, deep: 0.45,
        knee: 0.45, sheen: 0.01, glow: 0.02},
    clear: {fill: [0.03, 0.04, 0.05, 0.24], lo: 0.03, span: 0.50, deep: 0.35,
        knee: 0.30, sheen: 0.03, glow: 0.05},
};
const LIGHT = {
    dark: {fill: [0.92, 0.93, 0.96, 0.14], lo: 0.36, span: 0.40, deep: 0.15,
        knee: 0.45},
    clear: {fill: [0.95, 0.96, 0.98, 0.08], lo: 0.44, span: 0.46, deep: 0.10,
        knee: 0.45},
};

// Clear is a colour-true veil with the highlights pulled down: dark desktops
// stay clear, bright ones get enough tint for shadowless white text.
const CLEAR = {
    fill: [0.02, 0.025, 0.035, 0.07],
    lo: 0.02,
    span: 0.88,
    deep: 0.30,
    knee: 0.50,
    sheen: 0.02,
    glow: 0.05,
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
    const clear = mode === 'clear';
    const dark = glassIsDark({mode, systemDark});
    const brightness = clear
        ? 100
        : clamp(dark ? darkBrightness : lightBrightness, 0, 100);
    const t = brightness / 100;
    const a = clear ? CLEAR : dark ? DARK.dark : LIGHT.dark;
    const b = clear ? CLEAR : dark ? DARK.clear : LIGHT.clear;

    const params = {
        brightness,
        style: GLASS_STYLES.includes(style) ? style : 'liquid',
        radius: GLASS_RADIUS,
        blurRadius: clear ? 6 : Math.round(mix(30, 14, t)),
        fill: mixArray(a.fill, b.fill, t),
        lo: mix(a.lo, b.lo, t),
        span: mix(a.span, b.span, t),
        gamma: 1,
        deep: mix(a.deep, b.deep, t),
        knee: mix(a.knee, b.knee, t),
        saturation: dark ? mix(1.00, 1.15, t) : mix(1.15, 1.60, t),
        sheen: dark ? mix(a.sheen, b.sheen, t) : 0,
        glow: dark ? mix(a.glow, b.glow, t) : 0,
        reach: GLASS_REACH,
        lens: clear ? 24 : mix(8, 26, t),
        band: clear ? 26 : mix(20, 24, t),
        spread: clear ? 0.80 : mix(0.30, 0.70, t),
        rim: clear ? 0.55 : mix(0.15, 0.50, t),
        rimWidth: 1.1,
        rimColour: dark ? [1, 1, 1] : [0.12, 0.12, 0.14],
    };

    if (params.style === 'crystal') {
        // A sharper, wider bend with a thin bright edge, and less haze.
        params.lens *= 2.2;
        params.band *= 0.45;
        params.spread = Math.min(1.2, params.spread * 1.6);
        params.rim *= 1.35;
        params.sheen *= 0.6;
        params.glow *= 0.5;
        params.fill = lessFill(params.fill, 0.02);
    } else if (params.style === 'glow') {
        // No bend at the rim: a soft halo sits inside the edge instead. Light
        // glass starts at zero glow, so give the halo a visible floor there.
        params.lens = 0;
        params.band = 0;
        params.rim *= 0.8;
        params.sheen = Math.max(params.sheen, 0.05);
        params.glow = Math.max(params.glow * 3, 0.10);
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
