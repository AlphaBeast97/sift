import {equal} from './assert.js';
import {
    calcRow,
    defaultSelection,
    fileRow,
    mergeRows,
    selectionAfter,
    splitLearned,
} from '../../src/lib/merge.js';

export function run() {
    const calc = {expression: '1+1', result: '2'};
    const apps = [{kind: 'app', key: 'app:a.desktop', title: 'A'}];
    const files = [{kind: 'file', key: 'file:/tmp/a.txt', title: 'a.txt'}];
    const rows = mergeRows({calc, apps, files}, 6);
    equal(rows.map(r => r.key).join(','), 'calc,app:a.desktop,file:/tmp/a.txt');
    equal(mergeRows({calc, apps, files}, 2).length, 2);
    equal(mergeRows({}, 6).length, 0);

    const web = {kind: 'web', key: 'web', title: 'Search the web for “x”'};
    equal(mergeRows({apps, web}, 6).map(r => r.key).join(','),
        'app:a.desktop,web');
    equal(mergeRows({apps, web}, 1).map(r => r.key).join(','),
        'app:a.desktop');
    equal(mergeRows({calc, web}, 2).map(r => r.key).join(','), 'calc,web');
    equal(mergeRows({calc, web}, 1).map(r => r.key).join(','), 'calc');

    const setting = {kind: 'setting', key: 'setting:display'};
    equal(mergeRows({apps, settings: [setting], files}, 6)
        .map(r => r.key).join(','),
    'app:a.desktop,setting:display,file:/tmp/a.txt');
    equal(mergeRows({apps, settings: [setting]}, 1)
        .map(r => r.key).join(','), 'app:a.desktop');
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

    const learned = splitLearned([
        {key: 'file:/a.txt'},
        {key: 'file:/b.txt'},
        {key: 'file:/c'},
    ], new Map([['file:/b.txt', 2]]), 2);
    equal(learned.promoted.map(row => row.key).join(','), 'file:/b.txt');
    equal(learned.rest.map(row => row.key).join(','), 'file:/a.txt,file:/c');
    equal(splitLearned([{key: 'file:/a.txt'}], null).rest.length, 1);
    equal(splitLearned([
        {key: 'file:/a.txt'},
        {key: 'file:/b.txt'},
    ], new Map([['file:/b.txt', 1]])).rest.map(row => row.key).join(','),
    'file:/a.txt,file:/b.txt');

    // A learned folder leaves the file group and lands above apps and files.
    const folder = {key: 'file:/home/a/Documents', kind: 'dir'};
    const promoted = mergeRows({
        calc,
        promoted: [folder],
        apps,
    }, 6);
    equal(promoted.map(row => row.key).join(','),
        'calc,file:/home/a/Documents,app:a.desktop');

    // Selection follows a learned folder that takes first place from an app.
    equal(defaultSelection([folder, ...apps], 'app:a.desktop', 0, [folder]), 0);
    // A late settings row that becomes the first row also takes the selection.
    equal(defaultSelection([setting, ...apps], 'app:a.desktop', 0), 0);
    // Rows that arrive below a selected lower row leave the selection alone.
    equal(defaultSelection([setting, ...apps], 'app:a.desktop', 1), 1);
    equal(defaultSelection([...apps, web], 'web', 1), 0);
}