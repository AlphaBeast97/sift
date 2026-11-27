// SPDX-License-Identifier: GPL-3.0-or-later

export const RELEASE_API =
    'https://api.github.com/repos/AlphaBeast97/sift/releases/latest';

export function parseVersion(value) {
    const match = String(value ?? '').trim().match(/^v?(\d+)\.(\d+)\.(\d+)/u);
    if (!match)
        return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function compareVersions(a, b) {
    const left = parseVersion(a);
    const right = parseVersion(b);
    if (!left || !right)
        return 0;
    for (let i = 0; i < 3; i++) {
        if (left[i] !== right[i])
            return left[i] < right[i] ? -1 : 1;
    }
    return 0;
}

export function isNewer(candidate, current) {
    return compareVersions(candidate, current) > 0;
}

export function parseChecksums(text) {
    const sums = new Map();
    for (const line of String(text ?? '').split('\n')) {
        const match = line.trim().match(/^([0-9a-f]{64})\s+\*?(.+)$/iu);
        if (match)
            sums.set(match[2].trim(), match[1].toLowerCase());
    }
    return sums;
}

export function releaseAssets(release) {
    const assets = new Map();
    for (const asset of release?.assets ?? []) {
        if (asset?.name && asset?.browser_download_url)
            assets.set(asset.name, asset.browser_download_url);
    }
    return assets;
}
