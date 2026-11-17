// SPDX-License-Identifier: GPL-3.0-or-later

export function intersects(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x &&
        a.y < b.y + b.height && a.y + a.height > b.y;
}

// Actors arrive in stacking order (bottom first); cloning them in this order
// keeps the backdrop stack behind the panel.
export function backdropWindows(actors, area, windowType) {
    return actors.filter(actor => {
        const window = actor.meta_window;
        if (!window || !actor.visible || window.minimized ||
            window.get_window_type() !== windowType)
            return false;

        const [x, y] = actor.get_transformed_position();
        const [width, height] = actor.get_transformed_size();
        return intersects(area, {x, y, width, height});
    });
}
