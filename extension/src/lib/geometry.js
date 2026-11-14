// SPDX-License-Identifier: GPL-3.0-or-later

export const ROW_HEIGHT = 52;
export const ENTRY_HEIGHT = 60;
const FOOTER_HEIGHT = 32;
const CHROME_HEIGHT = ENTRY_HEIGHT + FOOTER_HEIGHT;
const BOTTOM_MARGIN = 0.05;

function clamp(min, value, max) {
    return Math.min(Math.max(value, min), max);
}

export function searchPanel(monitor, topBarBottom, maxRows = 6, compact = false) {
    const width = Math.floor(clamp(560, 0.55 * monitor.width, 720));
    const top = Math.round(Math.max(topBarBottom + 12, monitor.height * 0.18));
    const fit = Math.floor(
        (monitor.height - top - monitor.height * BOTTOM_MARGIN - CHROME_HEIGHT) /
        ROW_HEIGHT);
    const rows = compact ? 0 : Math.max(0, Math.min(maxRows, fit));

    return {
        x: Math.round(monitor.x + (monitor.width - width) / 2),
        y: monitor.y + top,
        width,
        height: compact ? ENTRY_HEIGHT : CHROME_HEIGHT + rows * ROW_HEIGHT,
        rows,
    };
}

export function gridPanel(monitor, topBarBottom) {
    const width = Math.round(clamp(720, 0.72 * monitor.width, 1040));
    const top = Math.round(Math.max(topBarBottom + 12, monitor.height * 0.12));
    const height = Math.round(Math.min(monitor.height * 0.7,
        monitor.height - top - monitor.height * BOTTOM_MARGIN));

    return {
        x: Math.round(monitor.x + (monitor.width - width) / 2),
        y: monitor.y + top,
        width,
        height,
    };
}
