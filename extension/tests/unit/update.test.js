// SPDX-License-Identifier: GPL-3.0-or-later
import {assert, equal} from './assert.js';
import {
    compareVersions,
    isNewer,
    parseChecksums,
    parseVersion,
    releaseAssets,
} from '../../src/lib/update.js';

const SHA = 'a'.repeat(64);

export function run() {
    equal(parseVersion('v1.2.3')?.join('.'), '1.2.3');
    equal(parseVersion('1.2.3')?.join('.'), '1.2.3');
    equal(parseVersion('nope'), null);

    equal(compareVersions('v1.2.3', '1.2.4'), -1);
    equal(compareVersions('v2.0.0', '1.9.9'), 1);
    equal(compareVersions('v1.0.0', '1.0.0'), 0);
    assert(isNewer('v1.1.0', '1.0.0'), 'a newer tag is newer');
    assert(!isNewer('v1.0.0', '1.0.0'), 'the same tag is not newer');

    const sums = parseChecksums(
        `${SHA}  siftd\n${SHA} *sift@example.zip\nignored\n`);
    equal(sums.get('siftd'), SHA);
    equal(sums.get('sift@example.zip'), SHA);
    equal(sums.size, 2);

    const assets = releaseAssets({
        assets: [
            {name: 'siftd', browser_download_url: 'https://example.test/siftd'},
            {name: 'missing'},
        ],
    });
    equal(assets.get('siftd'), 'https://example.test/siftd');
    equal(assets.size, 1);
}
