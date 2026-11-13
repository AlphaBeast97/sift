import {equal} from './assert.js';
import {gridLayout, indexToCell, cellToIndex, moveSelection, pageSelection} from '../../src/lib/gridMath.js';

export function run() {
    const wide = gridLayout(1000, 600, 96, 100);
    equal(wide.columns, 8);
    equal(wide.rows, 4);
    equal(wide.pageSize, 32);
    equal(wide.pages, 4);

    const small = gridLayout(400, 400, 96, 100);
    equal(small.columns, 4);
    equal(small.rows, 3);
    equal(small.pages, 9);

    const dense = gridLayout(4000, 4000, 48, 100);
    equal(dense.columns, 10);
    equal(dense.rows, 6);
    equal(dense.pageSize, 60);
    equal(dense.pages, 2);

    equal(indexToCell(24, 6, 4).page, 1);
    equal(indexToCell(24, 6, 4).cell, 0);
    equal(cellToIndex(2, 3, 6, 4), 51);
    equal(moveSelection(5, 1, 0, 100, 6), 5);
    equal(moveSelection(99, 0, 1, 100, 6), 99);
    equal(pageSelection(0, -1, 100, 6, 4), 0);
    equal(pageSelection(0, 1, 100, 6, 4), 24);
}
