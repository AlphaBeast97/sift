// SPDX-License-Identifier: GPL-3.0-or-later

const PRINTABLE_NAMES = new Set([
    'space', 'period', 'comma', 'apostrophe', 'minus', 'equal', 'semicolon',
    'slash', 'grave', 'bracketleft', 'bracketright', 'backslash', 'plus',
    'asterisk', 'underscore', 'quotedbl', 'numbersign', 'dollar', 'percent',
    'ampersand', 'parenleft', 'parenright', 'exclam', 'question', 'colon',
    'less', 'greater', 'bar', 'asciitilde',
]);

const RETURN_KEYS = new Set(['Return', 'KP_Enter', 'ISO_Enter']);

function isPrintable(symbol) {
    return symbol.length === 1 || PRINTABLE_NAMES.has(symbol);
}

export function resolveKey(symbol, {ctrl = false, shift = false, preedit = false,
    view = 'search', selectedKind = null} = {}) {
    if (preedit)
        return null;

    if (symbol === 'Escape')
        return 'close';

    if (view === 'grid') {
        if (RETURN_KEYS.has(symbol))
            return 'grid-activate';
        if (symbol === 'Left')
            return 'grid-left';
        if (symbol === 'Right')
            return 'grid-right';
        if (symbol === 'Up')
            return 'grid-up';
        if (symbol === 'Down')
            return 'grid-down';
        if (symbol === 'Page_Up')
            return 'grid-page-prev';
        if (symbol === 'Page_Down')
            return 'grid-page-next';
        if (symbol === 'Home')
            return 'grid-first';
        if (symbol === 'End')
            return 'grid-last';
        if (!ctrl && isPrintable(symbol))
            return 'search-type';
        return null;
    }

    if (RETURN_KEYS.has(symbol)) {
        if (!ctrl)
            return 'activate';
        return selectedKind === 'app' || selectedKind === 'file' || selectedKind === 'dir'
            ? 'activate-new'
            : null;
    }

    if (symbol === 'c' && ctrl)
        return selectedKind === 'calc' ? 'copy' : null;

    if (ctrl)
        return null;

    if (symbol === 'Tab' || symbol === 'ISO_Left_Tab')
        return shift ? 'prev' : 'next';
    if (symbol === 'Up')
        return 'up';
    if (symbol === 'Down')
        return 'down';
    if (symbol === 'Left')
        return 'left';
    if (symbol === 'Right')
        return 'right';
    if (symbol === 'Page_Up')
        return 'page-prev';
    if (symbol === 'Page_Down')
        return 'page-next';
    if (symbol === 'Home')
        return 'first';
    if (symbol === 'End')
        return 'last';

    return null;
}
