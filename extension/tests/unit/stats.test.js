import {almost, equal} from './assert.js';
import {percentile} from '../../src/lib/stats.js';

export function run() {
    equal(percentile([1, 2, 3, 4], 0.5), 2.5);
    almost(percentile([1, 2, 3, 4], 0.95), 3.85);
}
