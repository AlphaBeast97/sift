// SPDX-License-Identifier: GPL-3.0-or-later

const PAGE_PADDING = 24;
const SPACING = 12;
const INDICATOR_HEIGHT = 28;

function clamp(min, value, max) {
    return Math.min(Math.max(value, min), max);
}

export function gridLayout(width, height, iconSize, itemCount) {
    const columns = clamp(4, Math.floor(
        (width - 2 * PAGE_PADDING + SPACING) / (iconSize + SPACING)), 10);
    const rows = clamp(2, Math.floor(
        (height - 2 * PAGE_PADDING - INDICATOR_HEIGHT + SPACING) /
            (iconSize + SPACING)), 6);
    const pageSize = columns * rows;

    return {
        columns,
        rows,
        pageSize,
        pages: Math.max(1, Math.ceil(itemCount / pageSize)),
    };
}

export function indexToCell(index, columns, rows) {
    const pageSize = columns * rows;
    return {
        page: Math.floor(index / pageSize),
        cell: index % pageSize,
    };
}

export function cellToIndex(page, cell, columns, rows) {
    return page * columns * rows + cell;
}

export function moveSelection(current, dx, dy, count, columns) {
    const column = current % columns;
    const nextColumn = column + dx;
    if (nextColumn < 0 || nextColumn >= columns)
        return current;

    const row = Math.floor(current / columns) + dy;
    if (row < 0)
        return current;

    const next = row * columns + nextColumn;
    return next >= count ? current : next;
}

export function pageSelection(current, direction, count, columns, rows) {
    if (count === 0)
        return 0;

    const pageSize = columns * rows;
    const page = Math.floor(current / pageSize);
    const lastPage = Math.max(0, Math.ceil(count / pageSize) - 1);
    const nextPage = Math.min(Math.max(page + direction, 0), lastPage);

    return Math.min(nextPage * pageSize + current % pageSize, count - 1);
}
