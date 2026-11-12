export function assert(condition, message = 'assertion failed') {
    if (!condition)
        throw new Error(message);
}

export function equal(actual, expected, message = `${actual} !== ${expected}`) {
    if (!Object.is(actual, expected))
        throw new Error(message);
}

export function almost(actual, expected, epsilon = 1e-6) {
    if (Math.abs(actual - expected) > epsilon)
        throw new Error(`${actual} !~ ${expected}`);
}
