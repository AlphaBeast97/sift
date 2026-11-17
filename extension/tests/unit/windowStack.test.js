// SPDX-License-Identifier: GPL-3.0-or-later
import {equal} from './assert.js';
import {intersects, unionRect, windowPlaces} from '../../src/lib/windowStack.js';

function actor({x = 0, y = 0, width = 100, height = 100, visible = true,
    minimized = false, override = false} = {}) {
    return {
        x, y, width, height, visible,
        meta_window: {minimized, is_override_redirect: () => override},
    };
}

export function run() {
    const bottom = actor({y: 100});
    const dialog = actor({x: 50});
    const top = actor({x: 100, y: 100});

    const places = windowPlaces([
        bottom,
        actor({visible: false}),
        dialog,
        actor({minimized: true}),
        actor({override: true}),
        top,
    ]);

    equal(places.length, 3);
    equal(places[0].actor, bottom);
    equal(places[1].actor, dialog);
    equal(places[2].actor, top);
    equal(places[1].x, 50);

    const area = {x: 0, y: 0, width: 200, height: 200};
    equal(intersects(area, {x: 199, y: 0, width: 10, height: 10}), true);
    equal(intersects(area, {x: 200, y: 0, width: 10, height: 10}), false);

    equal(unionRect(null, area), area);
    const union = unionRect({x: 10, y: 20, width: 30, height: 40},
        {x: 70, y: 0, width: 10, height: 10});
    equal(`${union.x},${union.y},${union.width},${union.height}`, '10,0,70,60');
}
