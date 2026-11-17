// SPDX-License-Identifier: GPL-3.0-or-later
// Derived from Isle (https://github.com/zickrian/isle), GPL-3.0-or-later.

const MAX_STEP = 1 / 240;
const MAX_FRAME = 0.25;
const REST_DISTANCE = 0.25;
const REST_SPEED = 2;

/** Panel y and view geometry: ~3.5% overshoot, at rest well under a second. */
export const MOVE = {stiffness: 180, damping: 22};

export class Spring {
    constructor(value, config = MOVE) {
        this.value = value;
        this.target = value;
        this.velocity = 0;
        this.config = config;
    }

    setTarget(target, config = this.config) {
        this.target = target;
        this.config = config;
    }

    reset(value) {
        this.value = this.target = value;
        this.velocity = 0;
    }

    get settled() {
        return Math.abs(this.value - this.target) < REST_DISTANCE &&
            Math.abs(this.velocity) < REST_SPEED;
    }

    step(dt) {
        let remaining = Math.min(Math.max(dt, 0), MAX_FRAME);
        while (remaining > 0 && !this.settled) {
            const h = Math.min(remaining, MAX_STEP);
            const {stiffness, damping} = this.config;
            const acceleration = -stiffness * (this.value - this.target) -
                damping * this.velocity;
            this.velocity += acceleration * h;
            this.value += this.velocity * h;
            remaining -= h;
        }
        if (this.settled) {
            this.value = this.target;
            this.velocity = 0;
            return true;
        }
        return false;
    }
}
