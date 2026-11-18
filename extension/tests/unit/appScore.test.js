import {equal} from './assert.js';
import {rankApps} from '../../src/lib/appScore.js';

const app = (id, name, extra = {}) => ({
    id, name, lowerName: name.toLowerCase(), genericName: '', lowerGeneric: '',
    keywords: [], lowerKeywords: [], lowerId: id.toLowerCase(), running: false, ...extra,
});

export function run() {
    const apps = [
        app('firefox.desktop', 'Firefox'),
        app('files.desktop', 'Files'),
        app('nautilus.desktop', 'Nautilus', {keywords: ['files'], lowerKeywords: ['files']}),
        app('text.desktop', 'Text Editor', {genericName: 'Text Editor', lowerGeneric: 'text editor'}),
        app('web.desktop', 'GNOME Web'),
        app('ffx.desktop', 'Ffx'),
    ];
    equal(rankApps(apps, 'firefox', 4)[0].id, 'firefox.desktop');
    const ffx = rankApps(apps, 'ffx', 4);
    equal(ffx[0].id, 'ffx.desktop');
    equal(ffx[1].id, 'firefox.desktop');
    equal(rankApps(apps, 'files', 4)[0].id, 'files.desktop');
    equal(rankApps(apps, 'naut', 4)[0].id, 'nautilus.desktop');
    equal(rankApps(apps, 'web', 1).length, 1);
    equal(rankApps(apps, '', 4).length, 0);
    equal(rankApps(apps, 'fire', 1).length, 1);

    const exact = rankApps([app('fire.desktop', 'Fire'), app('firefox.desktop', 'Firefox')],
        'fire', 2);
    equal(exact[0].id, 'fire.desktop');

    const tie = rankApps([app('long.desktop', 'Zeta Long'), app('short.desktop', 'Zeta')],
        'zeta', 2);
    equal(tie[0].id, 'short.desktop');

    const wordPrefix = rankApps([
        app('zenith.desktop', 'Zenith'),
        app('zen.desktop', 'Zen Browser'),
    ], 'zen', 2);
    equal(wordPrefix[0].id, 'zen.desktop');

    const running = rankApps([
        app('note.desktop', 'Note'),
        app('notes.desktop', 'Notes', {running: true}),
    ], 'not', 2);
    equal(running[0].id, 'notes.desktop');
}
