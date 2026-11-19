// SPDX-License-Identifier: GPL-3.0-or-later

const SCORE = {
    exact: 1000,
    wordPrefix: 900,
    prefix: 800,
    word: 600,
    substring: 400,
    subsequence: 200,
    meta: 100,
    running: 20,
};

// Two consistent choices are enough to promote a result; one click is noise.
export const LEARNED_THRESHOLD = 2;
const LEARNED_BOOST = 1200;

function isWordStart(text, index) {
    if (index === 0)
        return true;
    return /[\s\-_.]/u.test(text[index - 1]);
}

function endsWord(text, index) {
    return index >= text.length || /[\s\-_.]/u.test(text[index]);
}

function isSubsequence(query, text) {
    let position = 0;
    for (const character of text) {
        if (character === query[position])
            position++;
        if (position === query.length)
            return true;
    }
    return false;
}

function score(record, query) {
    if (record.lowerName === query)
        return SCORE.exact;

    if (record.lowerName.startsWith(query)) {
        return endsWord(record.lowerName, query.length)
            ? SCORE.wordPrefix
            : SCORE.prefix;
    }

    const at = record.lowerName.indexOf(query);
    if (at >= 0)
        return isWordStart(record.lowerName, at) ? SCORE.word : SCORE.substring;

    if (isSubsequence(query, record.lowerName))
        return SCORE.subsequence;

    if (record.lowerKeywords.some(keyword => keyword.includes(query)))
        return SCORE.meta;

    if (record.lowerGeneric.includes(query))
        return SCORE.meta;

    if (record.lowerId.includes(query))
        return SCORE.meta;

    return 0;
}

function compare(a, b) {
    if (b.score !== a.score)
        return b.score - a.score;
    if (a.record.name.length !== b.record.name.length)
        return a.record.name.length - b.record.name.length;
    return a.record.name.localeCompare(b.record.name);
}

export function rankApps(records, query, limit = 4, learned = null) {
    const needle = query.trim().toLocaleLowerCase();
    if (!needle || limit <= 0)
        return [];

    const matches = [];
    for (const record of records) {
        const value = score(record, needle);
        if (value === 0)
            continue;

        const count = learned?.get(record.id) ?? 0;
        const boost = count >= LEARNED_THRESHOLD ? LEARNED_BOOST + count : 0;
        matches.push({
            record,
            score: value + boost + (record.running ? SCORE.running : 0),
        });
    }

    matches.sort(compare);
    return matches.slice(0, limit).map(match => match.record);
}
