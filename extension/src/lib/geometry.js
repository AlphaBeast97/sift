// SPDX-License-Identifier: GPL-3.0-or-later

export const ROW_HEIGHT = 52;
export const ENTRY_HEIGHT = 60;
const FOOTER_HEIGHT = 32;
const CHROME_HEIGHT = ENTRY_HEIGHT + FOOTER_HEIGHT;
const BOTTOM_MARGIN = 0.05;

function clamp(min, value, max) {
    return Math.min(Math.max(value, min), max);
}

export function searchPanel(monitor, topBarBottom, height = 404, compact = false) {
    const width = Math.floor(Math.min(monitor.width - 24,
        clamp(560, 0.55 * monitor.width, 720)));
    const top = Math.round(Math.max(topBarBottom + 12, monitor.height * 0.18));
    const maxHeight = monitor.height - top - monitor.height * BOTTOM_MARGIN;
    const expanded = Math.round(Math.min(Math.max(height, CHROME_HEIGHT + ROW_HEIGHT),
        maxHeight));
    const rows = compact ? 0 :
        Math.max(0, Math.floor((expanded - CHROME_HEIGHT) / ROW_HEIGHT));

    return {
        x: Math.round(monitor.x + (monitor.width - width) / 2),
        y: monitor.y + top,
        width,
        height: compact ? ENTRY_HEIGHT : expanded,
        rows,
    };
}

export function gridPanel(monitor, topBarBottom) {
    const width = Math.round(Math.min(monitor.width - 24,
        clamp(720, 0.72 * monitor.width, 1040)));
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

// The workspace strip is deliberately shallow: workspaces sit side by side,
// so it should use the width of the grid panel without covering the desktop.
export function workspacePanel(monitor, topBarBottom) {
    const grid = gridPanel(monitor, topBarBottom);
    const height = Math.round(Math.min(
        clamp(280, 0.42 * monitor.height, 460),
        monitor.height - (grid.y - monitor.y) - monitor.height * BOTTOM_MARGIN));

    return {...grid, height};
}
