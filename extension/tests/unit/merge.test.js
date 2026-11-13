import {equal} from './assert.js';
import {calcRow, fileRow, mergeRows, selectionAfter} from '../../src/lib/merge.js';

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

    const calcResult = calcRow(calc);
    equal(calcResult.key, 'calc');
    equal(calcResult.title, '2');
    equal(calcResult.subtitle, '1+1');

    const daemonFiles = [
        {path: '/home/a/report.pdf', name: 'report.pdf', kind: 'file'},
        {path: '/home/a/docs', name: 'docs', kind: 'dir'},
    ];
    const fileRows = mergeRows({files: daemonFiles.map(f => fileRow(f, '/home/a'))}, 6);
    equal(fileRows[0].subtitle, '~');
    equal(fileRows[0].key, 'file:/home/a/report.pdf');
    equal(fileRows[1].kind, 'dir');
    equal(fileRow({path: 'relative', name: 'x', kind: 'file'}, '/home/a'), null);
    equal(fileRow({path: '/a', name: '', kind: 'file'}, '/home/a'), null);
    equal(fileRow({path: '/a/b.txt', name: 'b.txt', kind: 'file'}, '/a').subtitle, '~');
}