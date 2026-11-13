// SPDX-License-Identifier: GPL-3.0-or-later
import St from 'gi://St';

/**
 * Task 21 replaces this stub with the backdrop clone + blur + shader layers.
 * For now it only owns a frame actor sized to the panel.
 */
export class GlassPanel {
    constructor() {
        this._frame = null;
        this._rect = null;
    }

    attach(panel) {
        if (this._frame)
            return;

        this._frame = new St.Widget({
            style_class: 'sift-glass',
            reactive: false,
        });
        panel.insert_child_at_index(this._frame, 0);
    }

    setRect(rect) {
        this._rect = rect;
        if (!this._frame)
            return;

        this._frame.set_position(0, 0);
        this._frame.set_size(rect.width, rect.height);
    }

    destroy() {
        this._frame?.destroy();
        this._frame = null;
        this._rect = null;
    }
}
