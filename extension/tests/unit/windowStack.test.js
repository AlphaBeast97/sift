// SPDX-License-Identifier: GPL-3.0-or-later
import {equal} from './assert.js';
import {backdropWindows} from '../../src/lib/windowStack.js';

const NORMAL = 1;

function windowActor({x = 0, y = 0, width = 100, height = 100,
    visible = true, minimized = false, type = NORMAL} = {}) {
    return {
        visible,
        meta_window: {minimized, get_window_type: () => type},
        get_transformed_position: () => [x, y],
        get_transformed_size: () => [width, height],
    };
}

export function run() {
    const area = {x: 0, y: 0, width: 200, height: 200};
    const bottom = windowActor({y: 100});
    const middle = windowActor({x: 50});
    const top = windowActor({x: 100, y: 100});

    const picked = backdropWindows([
        bottom,
        windowActor({visible: false}),
        middle,
        windowActor({minimized: true}),
        windowActor({type: 2}),
        top,
        windowActor({x: 500}),
    ], area, NORMAL);

    equal(picked.length, 3);
    equal(picked[0], bottom);
    equal(picked[1], middle);
    equal(picked[2], top);
    equal(backdropWindows([top, bottom], area, NORMAL)[0], top);
}
