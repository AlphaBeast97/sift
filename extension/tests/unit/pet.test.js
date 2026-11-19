// SPDX-License-Identifier: GPL-3.0-or-later
import {almost, equal} from './assert.js';
import {PET_HEIGHT, PET_WIDTH, eyeLook, petFits, petRect} from '../../src/lib/pet.js';

export function run() {
    const panel = {x: 600, y: 194, width: 720, height: 404};
    const rect = petRect(panel);
    equal(rect.x + PET_WIDTH, panel.x + panel.width - 28);
    equal(rect.y, panel.y + panel.height - 8);

    const monitor = {x: 0, y: 0, width: 1920, height: 1080};
    equal(petFits(panel, monitor), true);
    equal(petFits({x: 0, y: 1000, width: 720, height: 100}, monitor), false);
    equal(petFits({x: 0, y: 800, width: 720, height: 100}, monitor), true);

    const first = eyeLook(0, 6);
    equal(first.x, -1);
    almost(first.y, -1);
    const last = eyeLook(5, 6);
    equal(last.x, -1);
    almost(last.y, 1);
    almost(eyeLook(2, 5).y, 0);
    almost(eyeLook(-1, 0).y, -1);
    almost(eyeLook(0, 1).y, -1);
    equal(PET_HEIGHT, 78);
}
