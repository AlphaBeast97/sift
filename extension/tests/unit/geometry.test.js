import {equal} from './assert.js';
import {searchPanel, gridPanel, workspacePanel} from '../../src/lib/geometry.js';

export function run() {
    const hd = {x: 0, y: 0, width: 1920, height: 1080};
    const search = searchPanel(hd, 32, 404);
    equal(search.width, 720);
    equal(search.height, 404);
    equal(search.x, 600);
    equal(search.y, 194);
    equal(search.rows, 6);

    const compact = searchPanel(hd, 32, 404, true);
    equal(compact.height, 60);
    equal(compact.rows, 0);

    const short = searchPanel(hd, 32, 248);
    equal(short.height, 248);
    equal(short.rows, 3);

    const small = searchPanel({x: 0, y: 0, width: 1024, height: 600}, 32, 900);
    equal(small.width, 563);
    equal(small.height, 462);
    equal(small.y, 108);
    equal(small.rows, 7);

    const portrait = searchPanel({x: 0, y: 0, width: 480, height: 800}, 32, 404);
    equal(portrait.width, 456);

    const tiny = searchPanel({x: 0, y: 0, width: 320, height: 240}, 32, 900);
    equal(tiny.width, 296);
    equal(tiny.height, 184);
    equal(tiny.rows, 1);

    const grid = gridPanel(hd, 32);
    equal(grid.width, 1040);
    equal(grid.height, 756);
    equal(grid.x, 440);
    equal(grid.y, 130);

    const portraitGrid = gridPanel({x: 0, y: 0, width: 480, height: 800}, 32);
    equal(portraitGrid.width, 456);

    const workspace = workspacePanel(hd, 32);
    equal(workspace.width, 1040);
    equal(workspace.height, 454);
    equal(workspace.x, 440);
    equal(workspace.y, 130);

    const portraitWorkspace =
        workspacePanel({x: 0, y: 0, width: 480, height: 800}, 32);
    equal(portraitWorkspace.width, 456);
    equal(portraitWorkspace.height, 336);

    const offset = searchPanel({x: 1920, y: 0, width: 1920, height: 1080}, 32, 404);
    equal(offset.x, 2520);
}
