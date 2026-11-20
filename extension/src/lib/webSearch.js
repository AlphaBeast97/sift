// SPDX-License-Identifier: GPL-3.0-or-later

export const ENGINES = [
    ['duckduckgo', 'DuckDuckGo', 'https://duckduckgo.com/?q='],
    ['google', 'Google', 'https://www.google.com/search?q='],
    ['bing', 'Bing', 'https://www.bing.com/search?q='],
    ['startpage', 'Startpage', 'https://www.startpage.com/sp/search?query='],
];

const SCHEME = /^(https?):\/\/(\S+)$/i;
const LOCALHOST = /^localhost(?::\d{1,5})?(?:[/?#]\S*)?$/i;
const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})(?::\d{1,5})?(?:[/?#]\S*)?$/;
const HOST = /^(?!-)[a-z0-9-]{1,63}(?:\.[a-z0-9-]{1,63})+(?::\d{1,5})?(?:[/?#]\S*)?$/i;

export function engineLabel(engine) {
    return ENGINES.find(([id]) => id === engine)?.[1] ?? ENGINES[0][1];
}

export function searchUrl(engine, query) {
    const template = ENGINES.find(([id]) => id === engine)?.[2] ?? ENGINES[0][2];
    return template + encodeURIComponent(query);
}

function authority(value) {
    return value.split(/[/?#]/)[0];
}

function validHost(value) {
    const labels = authority(value).replace(/:\d+$/, '').split('.');
    if (labels.some(label =>
        label.length === 0 || label.startsWith('-') || label.endsWith('-')))
        return false;
    return /^[a-z]{2,63}$/i.test(labels[labels.length - 1]);
}

function validIpv4(value) {
    const match = value.match(IPV4);
    return match !== null &&
        match.slice(1, 5).every(part => Number(part) <= 255);
}

// Returns the URI to open for a typed address. Plain hosts get https unless
// they are local, where http is the useful default.
export function detectUrl(text) {
    const value = text.trim();
    if (value.length < 2 || /\s/.test(value))
        return null;

    // Addresses with credentials look like URLs but should not be echoed or
    // opened from a launcher row; let the search engine handle them.
    if (value.includes('@'))
        return null;

    const scheme = value.match(SCHEME);
    if (scheme) {
        return {
            uri: `${scheme[1].toLowerCase()}://${scheme[2]}`,
            authority: authority(scheme[2]),
        };
    }

    if (LOCALHOST.test(value)) {
        return {
            uri: `http://${value}`,
            authority: authority(value),
        };
    }

    if (validIpv4(value)) {
        return {
            uri: `http://${value}`,
            authority: authority(value),
        };
    }

    if (HOST.test(value) && validHost(value)) {
        return {
            uri: `https://${value}`,
            authority: authority(value),
        };
    }

    return null;
}

// The last, lowest-priority search row. Returns null for short or empty text.
export function webRow(text, engine = 'duckduckgo', browserName = '') {
    const query = text.trim();
    if (query.length < 2)
        return null;

    const url = detectUrl(query);
    if (url) {
        return {
            kind: 'web',
            key: 'web',
            title: `Open ${url.authority}`,
            subtitle: browserName ? `Open in ${browserName}` : url.uri,
            uri: url.uri,
            icon: 'web-browser-symbolic',
        };
    }

    const label = engineLabel(engine);
    return {
        kind: 'web',
        key: 'web',
        title: `Search the web for “${query}”`,
        subtitle: browserName ? `${label} in ${browserName}` : label,
        uri: searchUrl(engine, query),
        icon: 'web-browser-symbolic',
    };
}
