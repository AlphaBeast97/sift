import {run as appScore} from './appScore.test.js';
import {run as geometry} from './geometry.test.js';
import {run as keys} from './keys.test.js';
import {run as merge} from './merge.test.js';
import {run as stats} from './stats.test.js';

const tests = [
    ['stats', stats],
    ['geometry', geometry],
    ['keys', keys],
    ['appScore', appScore],
    ['merge', merge],
];

for (const [name, run] of tests) {
    run();
    print(`ok ${name}`);
}
