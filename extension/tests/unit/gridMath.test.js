import {equal} from './assert.js';
import {
    gridLayout, presetLayout, parseGridSize,
    indexToCell, cellToIndex, moveSelection, pageSelection,
} from '../../src/lib/gridMath.js';

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

    // A preset is honoured when its smallest tiles fit and reduced when not.
    const roomy = presetLayout(1040, 726, 8, 3, 65, {
        columnSpacing: 12,
        rowSpacing: 12,
        padding: {left: 24, right: 24, top: 24, bottom: 24},
    });
    equal(roomy.columns, 8);
    equal(roomy.rows, 3);

    const short = presetLayout(904, 374, 3, 8, 65, {
        columnSpacing: 12,
        rowSpacing: 12,
        padding: {left: 24, right: 24, top: 24, bottom: 24},
    });
    equal(short.columns, 3);
    equal(short.rows, 4);

    const narrow = presetLayout(904, 374, 8, 3, 65, {
        columnSpacing: 12,
        rowSpacing: 12,
        padding: {left: 24, right: 24, top: 24, bottom: 24},
    });
    equal(narrow.columns, 8);
    equal(narrow.rows, 3);

    const parsed = parseGridSize('8x3');
    equal(parsed.columns, 8);
    equal(parsed.rows, 3);
    equal(parseGridSize('auto'), null);
    equal(parseGridSize('0x3'), null);
    equal(parseGridSize('8X3'), null);

    equal(indexToCell(24, 6, 4).page, 1);
    equal(indexToCell(24, 6, 4).cell, 0);
    equal(cellToIndex(2, 3, 6, 4), 51);
    equal(moveSelection(5, 1, 0, 100, 6), 5);
    equal(moveSelection(99, 0, 1, 100, 6), 99);
    equal(pageSelection(0, -1, 100, 6, 4), 0);
    equal(pageSelection(0, 1, 100, 6, 4), 24);
}
