import {run as geometry} from './geometry.test.js';
import {run as keys} from './keys.test.js';
import {run as stats} from './stats.test.js';

const tests = [
    ['stats', stats],
    ['geometry', geometry],
    ['keys', keys],
];

for (const [name, run] of tests) {
    run();
    print(`ok ${name}`);
}
