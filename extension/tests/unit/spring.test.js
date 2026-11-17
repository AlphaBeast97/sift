// SPDX-License-Identifier: GPL-3.0-or-later
import {almost, assert, equal} from './assert.js';
import {MOVE, Spring} from '../../src/lib/spring.js';

export function run() {
    const spring = new Spring(0, MOVE);
    assert(spring.settled, 'a spring starts at rest');
    spring.setTarget(100);

    let frames = 0;
    while (!spring.settled && frames < 600) {
        spring.step(1 / 60);
        frames++;
    }
    assert(spring.settled, 'the spring settles');
    almost(spring.value, 100);
    equal(spring.velocity, 0);
    assert(frames < 300, 'the move settles in under five seconds');

    spring.reset(10);
    equal(spring.value, 10);
    equal(spring.target, 10);
    equal(spring.velocity, 0);

    spring.setTarget(0);
    spring.step(0.1);
    const velocity = spring.velocity;
    spring.setTarget(50);
    equal(spring.velocity, velocity, 'retargeting keeps the velocity');

    spring.reset(0);
    spring.setTarget(100);
    spring.step(10);
    assert(Number.isFinite(spring.value), 'a huge frame stays finite');

    spring.reset(0);
    spring.setTarget(100);
    spring.step(1 / 240);
    spring.setTarget(0);
    assert(spring.value > 0 && spring.value < 1,
        'a reversal starts from the current value');
}
