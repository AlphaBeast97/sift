import {equal} from './assert.js';
import {gridLayout, indexToCell, cellToIndex, moveSelection, pageSelection} from '../../src/lib/gridMath.js';

export function run() {
    const wide = gridLayout(1000, 600, 96, 100);
    equal(wide.columns, 8);
    equal(wide.rows, 5);
    equal(wide.pageSize, 40);
    equal(wide.pages, 3);

    const small = gridLayout(400, 400, 96, 100);
    equal(small.columns, 3);
    equal(small.rows, 3);
    equal(small.pages, 12);

    const dense = gridLayout(4000, 4000, 48, 100);
    equal(dense.columns, 10);
    equal(dense.rows, 6);
    equal(dense.pageSize, 60);
    equal(dense.pages, 2);

    // Shell's icon grid pads 18/24 and sizes cells from the whole tile.
    const shell = gridLayout(904, 373, 145, 24, {
        columnSpacing: 12,
        rowSpacing: 12,
        padding: {left: 18, right: 18, top: 24, bottom: 24},
    });
    equal(shell.columns, 5);
    equal(shell.rows, 2);
    equal(shell.pages, 3);

    const tight = gridLayout(100, 100, 200, 1);
    equal(tight.columns, 1);
    equal(tight.rows, 1);

    equal(indexToCell(24, 6, 4).page, 1);
    equal(indexToCell(24, 6, 4).cell, 0);
    equal(cellToIndex(2, 3, 6, 4), 51);
    equal(moveSelection(5, 1, 0, 100, 6, 4), 5);
    equal(moveSelection(99, 0, 1, 100, 6, 4), 99);
    // Arrows stay on the page: no wrap from its top or bottom row.
    equal(moveSelection(24, 0, -1, 100, 6, 4), 24);
    equal(moveSelection(23, 0, 1, 100, 6, 4), 23);
    equal(moveSelection(24, 0, 1, 100, 6, 4), 30);
    equal(moveSelection(25, -1, 0, 100, 6, 4), 24);
    equal(moveSelection(48, 0, 1, 50, 6, 4), 48);
    equal(pageSelection(0, -1, 100, 6, 4), 0);
    equal(pageSelection(0, 1, 100, 6, 4), 24);
}
