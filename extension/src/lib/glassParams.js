// SPDX-License-Identifier: GPL-3.0-or-later

export const GLASS_PAD = 40;
export const GLASS_RADIUS = 18;
export const GLASS_BLUR_RADIUS = 40;
export const GLASS_OPACITY = 0.72;
export const GLASS_TINT = 0.45;
export const GLASS_SATURATION = 1.1;
export const GLASS_LENS = 2.5;
export const GLASS_RIM = 0.06;
export const GLASS_SHEEN = 0.05;

// M0 starting values: the tint colour is roughly [0.06, 0.07, 0.09] at the
// default strength of 0.45. A stronger tint scales it towards black.
const DARK_TINT = [0.11, 0.13, 0.16];
const LIGHT_TINT = [0.95, 0.96, 0.98];

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function tintColor(strength, dark) {
    const amount = clamp(strength, 0, 1);
    if (dark)
        return DARK_TINT.map(channel => channel * (1 - amount));
    return LIGHT_TINT.map(channel => channel * (1 - amount * 0.12));
}

export function glassParams({
    mode = 'auto',
    opacity = GLASS_OPACITY,
    blurRadius = GLASS_BLUR_RADIUS,
    tint = GLASS_TINT,
    dark = true,
    fallback = 'liquid',
} = {}) {
    const effectiveMode = mode === 'auto'
        ? (fallback === 'frosted' ? 'frosted' : 'liquid')
        : mode;

    return {
        effectiveMode,
        opacity: clamp(opacity, 0, 1),
        blurRadius: clamp(blurRadius, 0, 64),
        tint: tintColor(tint, dark),
        saturation: GLASS_SATURATION,
        lens: GLASS_LENS,
        rim: GLASS_RIM,
        sheen: GLASS_SHEEN,
        radius: GLASS_RADIUS,
    };
}