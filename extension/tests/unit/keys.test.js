import {equal} from './assert.js';
import {resolveKey} from '../../src/lib/keys.js';

export function run() {
    equal(resolveKey('Escape', {preedit: true, view: 'search'}), null);
    equal(resolveKey('Escape', {preedit: false, view: 'search'}), 'close');
    equal(resolveKey('Escape', {preedit: false, view: 'grid'}), 'close');
    equal(resolveKey('Return', {view: 'search'}), 'activate');
    equal(resolveKey('Return', {ctrl: true, selectedKind: 'file', view: 'search'}), 'activate-new');
    equal(resolveKey('c', {ctrl: true, selectedKind: 'calc', view: 'search'}), 'copy');
    equal(resolveKey('c', {ctrl: true, selectedKind: 'app', view: 'search'}), null);
    equal(resolveKey('Tab', {view: 'search'}), 'next');
    equal(resolveKey('Tab', {shift: true, view: 'search'}), 'prev');
    equal(resolveKey('Page_Down', {view: 'search'}), 'page-next');
    equal(resolveKey('Home', {view: 'search'}), 'first');
    equal(resolveKey('End', {view: 'search'}), 'last');
    equal(resolveKey('a', {view: 'grid'}), 'search-type');
    equal(resolveKey('a', {view: 'grid', ctrl: true}), null);
    equal(resolveKey('Left', {view: 'search'}), 'left');
    equal(resolveKey('Left', {view: 'grid'}), 'grid-left');
    equal(resolveKey('Up', {view: 'grid'}), 'grid-up');
    equal(resolveKey('Page_Down', {view: 'grid'}), 'grid-page-next');
    equal(resolveKey('Page_Up', {view: 'grid'}), 'grid-page-prev');
    equal(resolveKey('Return', {view: 'workspace'}), 'workspace-activate');
    equal(resolveKey('Left', {view: 'workspace'}), 'workspace-left');
    equal(resolveKey('Right', {view: 'workspace'}), 'workspace-right');
    equal(resolveKey('Home', {view: 'workspace'}), 'workspace-first');
    equal(resolveKey('End', {view: 'workspace'}), 'workspace-last');
    equal(resolveKey('a', {view: 'workspace'}), 'search-type');
    equal(resolveKey('a', {view: 'workspace', ctrl: true}), null);
    equal(resolveKey('Home', {view: 'grid'}), 'grid-first');
    equal(resolveKey('End', {view: 'grid'}), 'grid-last');
    equal(resolveKey('Return', {view: 'grid'}), 'grid-activate');
}
