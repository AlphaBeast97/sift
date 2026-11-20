import {run as appScore} from './appScore.test.js';
import {run as format} from './format.test.js';
import {run as geometry} from './geometry.test.js';
import {run as glassParams} from './glassParams.test.js';
import {run as gridMath} from './gridMath.test.js';
import {run as keys} from './keys.test.js';
import {run as merge} from './merge.test.js';
import {run as shortcuts} from './shortcuts.test.js';
import {run as spring} from './spring.test.js';
import {run as stats} from './stats.test.js';
import {run as usage} from './usage.test.js';
import {run as webSearch} from './webSearch.test.js';
import {run as windowStack} from './windowStack.test.js';

const tests = [
    ['stats', stats],
    ['geometry', geometry],
    ['keys', keys],
    ['appScore', appScore],
    ['format', format],
    ['glassParams', glassParams],
    ['merge', merge],
    ['shortcuts', shortcuts],
    ['spring', spring],
    ['gridMath', gridMath],
    ['usage', usage],
    ['webSearch', webSearch],
    ['windowStack', windowStack],
];

for (const [name, run] of tests) {
    run();
    print(`ok ${name}`);
}
