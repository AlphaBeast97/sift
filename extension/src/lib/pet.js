// SPDX-License-Identifier: GPL-3.0-or-later

export const PET_WIDTH = 88;
export const PET_HEIGHT = 78;

const PET_INSET = 28;
const PET_OVERLAP = 8;
const PET_MARGIN = 6;

/** Places the pet under the panel's lower-right corner, its head on the rim. */
export function petRect(panel) {
    return {
        x: Math.round(panel.x + panel.width - PET_WIDTH - PET_INSET),
        y: Math.round(panel.y + panel.height - PET_OVERLAP),
    };
}

export function petFits(panel, monitor) {
    const {x, y} = petRect(panel);
    return x >= monitor.x + PET_MARGIN &&
        y + PET_HEIGHT <= monitor.y + monitor.height - PET_MARGIN;
}

/** Pupil offset in pixels: up for the first row, down for the last. */
export function eyeLook(index, count) {
    const t = count > 1 && index >= 0
        ? Math.min(1, Math.max(0, index / (count - 1)))
        : 0;
    return {x: -1, y: -1 + 2 * t};
}
