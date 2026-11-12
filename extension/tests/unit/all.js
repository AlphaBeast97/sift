import {run as stats} from './stats.test.js';

const tests = [
    ['stats', stats],
];

for (const [name, run] of tests) {
    run();
    print(`ok ${name}`);
}
