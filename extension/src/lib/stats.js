export function percentile(values, p) {
    if (values.length === 0)
        return 0;

    const sorted = [...values].sort((a, b) => a - b);
    const index = (sorted.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);

    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}
