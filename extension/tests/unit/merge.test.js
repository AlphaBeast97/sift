import {equal} from './assert.js';
import {mergeRows, selectionAfter} from '../../src/lib/merge.js';

export function run() {
    const calc = {expression: '1+1', result: '2'};
    const apps = [{kind: 'app', key: 'app:a.desktop', title: 'A'}];
    const files = [{kind: 'file', key: 'file:/tmp/a.txt', title: 'a.txt'}];
    const rows = mergeRows({calc, apps, files}, 6);
    equal(rows.map(r => r.key).join(','), 'calc,app:a.desktop,file:/tmp/a.txt');
    equal(mergeRows({calc, apps, files}, 2).length, 2);
    equal(mergeRows({}, 6).length, 0);
    equal(selectionAfter(rows, 'app:a.desktop'), 1);
    equal(selectionAfter(rows, 'file:gone'), 0);
}
