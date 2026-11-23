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

// The workspace strip shows two and a half cards across. Each card is sized
// from the width it gets, so the half card is always the pan hint.
export const WORKSPACE_GAP = 10;
export const WORKSPACE_PADDING = 8;

export function workspaceCardWidth(viewWidth) {
    const available = viewWidth - WORKSPACE_PADDING * 2 - WORKSPACE_GAP * 2;
    return Math.max(120, Math.floor(available / 2.5));
}

// One and a half 16:9 thumbnails are enough vertically; the rest scrolls.
// 166 is the entry bar, footer, view inset and card chrome around the body.
export function workspacePanelHeight(panelWidth) {
    const card = workspaceCardWidth(panelWidth - 16);
    const preview = Math.round((card - 38) * 9 / 16);
    const tile = preview + 28;
    return Math.round(1.5 * tile + 8 + 6) + 166;
}

// The workspace strip uses the width of the grid panel without covering the
// desktop. The height leaves room for a row and a half of window thumbnails.
export function workspacePanel(monitor, topBarBottom) {
    const grid = gridPanel(monitor, topBarBottom);
    const available = Math.max(0, monitor.height - (grid.y - monitor.y) -
        monitor.height * BOTTOM_MARGIN);

    return {...grid, height: Math.min(workspacePanelHeight(grid.width), available)};
}
