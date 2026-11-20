import {assert, equal} from './assert.js';
import {detectUrl, engineLabel, searchUrl, webRow} from '../../src/lib/webSearch.js';

export function run() {
    equal(detectUrl('example.com').uri, 'https://example.com');
    equal(detectUrl('https://example.com/a?b=1').uri,
        'https://example.com/a?b=1');
    equal(detectUrl('HTTP://EXAMPLE.COM').uri, 'http://EXAMPLE.COM');
    equal(detectUrl('localhost:3000').uri, 'http://localhost:3000');
    equal(detectUrl('127.0.0.1:8080').uri, 'http://127.0.0.1:8080');
    equal(detectUrl('example.com:8443/path').uri,
        'https://example.com:8443/path');

    equal(detectUrl('example'), null);
    equal(detectUrl('3.14'), null);
    equal(detectUrl('999.1.1.1'), null);
    equal(detectUrl('src/main.rs'), null);
    equal(detectUrl('user@example.com'), null);
    equal(detectUrl('example .com'), null);
    equal(detectUrl('javascript:alert(1)'), null);

    equal(searchUrl('google', 'two words & more'),
        'https://www.google.com/search?q=two%20words%20%26%20more');
    equal(searchUrl('missing', 'a b'),
        'https://duckduckgo.com/?q=a%20b');
    equal(engineLabel('bing'), 'Bing');

    const search = webRow('two words', 'google', 'Brave');
    equal(search.kind, 'web');
    equal(search.key, 'web');
    equal(search.title, 'Search the web for “two words”');
    equal(search.subtitle, 'Google in Brave');
    equal(search.uri, 'https://www.google.com/search?q=two%20words');
    equal(search.icon, 'web-browser-symbolic');

    const open = webRow('example.com', 'google', 'Brave');
    equal(open.title, 'Open example.com');
    equal(open.subtitle, 'Open in Brave');
    equal(open.uri, 'https://example.com');
    equal(open.icon, 'web-browser-symbolic');

    assert(webRow('x') === null, 'short text has no web row');
    assert(webRow('   ') === null, 'blank text has no web row');
}
