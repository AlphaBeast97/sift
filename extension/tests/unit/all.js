import {run as appScore} from './appScore.test.js';
import {run as format} from './format.test.js';
import {run as geometry} from './geometry.test.js';
import {run as glassParams} from './glassParams.test.js';
import {run as gridMath} from './gridMath.test.js';
import {run as keys} from './keys.test.js';
import {run as merge} from './merge.test.js';
import {run as stats} from './stats.test.js';

const tests = [
    ['stats', stats],
    ['geometry', geometry],
    ['keys', keys],
    ['appScore', appScore],
    ['format', format],
    ['glassParams', glassParams],
    ['merge', merge],
    ['gridMath', gridMath],
];

for (const [name, run] of tests) {
    run();
    print(`ok ${name}`);
}
