// SPDX-License-Identifier: GPL-3.0-or-later
import {equal} from './assert.js';
import {abbreviatePath, parentPath} from '../../src/lib/format.js';

export function run() {
    equal(abbreviatePath('/home/a', '/home/a'), '~');
    equal(abbreviatePath('/home/a/docs/report.pdf', '/home/a'),
        '~/docs/report.pdf');
    equal(abbreviatePath('/srv/report.pdf', '/home/a'), '/srv/report.pdf');
    equal(abbreviatePath('/home/ab/report.pdf', '/home/a'),
        '/home/ab/report.pdf');
    equal(parentPath('/home/a/docs/report.pdf'), '/home/a/docs');
    equal(parentPath('/report.pdf'), '/');
}