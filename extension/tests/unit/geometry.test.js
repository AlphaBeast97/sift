import {equal} from './assert.js';
import {searchPanel, gridPanel} from '../../src/lib/geometry.js';

export function run() {
    const hd = {x: 0, y: 0, width: 1920, height: 1080};
    const search = searchPanel(hd, 32, 6);
    equal(search.width, 720);
    equal(search.height, 404);
    equal(search.x, 600);
    equal(search.y, 194);
    equal(search.rows, 6);

    const compact = searchPanel(hd, 32, 6, true);
    equal(compact.height, 60);
    equal(compact.rows, 0);

    const small = searchPanel({x: 0, y: 0, width: 1024, height: 600}, 32, 12);
    equal(small.width, 563);
    equal(small.height, 456);
    equal(small.y, 108);
    equal(small.rows, 7);

    const grid = gridPanel(hd, 32);
    equal(grid.width, 1040);
    equal(grid.height, 756);
    equal(grid.x, 440);
    equal(grid.y, 130);

    const offset = searchPanel({x: 1920, y: 0, width: 1920, height: 1080}, 32, 6);
    equal(offset.x, 2520);
}
