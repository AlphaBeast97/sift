// SPDX-License-Identifier: GPL-3.0-or-later

export function intersects(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x &&
        a.y < b.y + b.height && a.y + a.height > b.y;
}

export function unionRect(a, b) {
    if (!a)
        return b;
    if (!b)
        return a;

    const x = Math.min(a.x, b.x);
    const y = Math.min(a.y, b.y);
    return {
        x,
        y,
        width: Math.max(a.x + a.width, b.x + b.width) - x,
        height: Math.max(a.y + a.height, b.y + b.height) - y,
    };
}

// Every visible window, dialogs included, in stacking order (bottom first). The
// glass filters these places against its moving frame; override-redirect menus
// are not copied because their actor is not a normal window surface.
export function windowPlaces(actors) {
    return actors.filter(actor => {
        const window = actor.meta_window;
        return window && actor.visible && !window.minimized &&
            !window.is_override_redirect();
    }).map(actor => ({
        actor,
        x: actor.x,
        y: actor.y,
        width: actor.width,
        height: actor.height,
    }));
}
