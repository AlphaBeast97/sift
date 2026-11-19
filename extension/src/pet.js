// SPDX-License-Identifier: GPL-3.0-or-later
import cairo from 'cairo';
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import {PET_HEIGHT, PET_WIDTH, eyeLook, petFits, petRect} from './lib/pet.js';

const TAIL_X = 54;
const TAIL_Y = 16;
const TAIL_WIDTH = 32;
const TAIL_HEIGHT = 54;
const INK = [0.11, 0.118, 0.141];
const PALETTE = {
    dark: {
        body: [0.929, 0.941, 0.957],
        shade: [0.796, 0.824, 0.863],
        inner: [0.667, 0.698, 0.741],
        nose: [0.58, 0.612, 0.663],
    },
    light: {
        body: [0.949, 0.957, 0.969],
        shade: [0.835, 0.855, 0.882],
        inner: [0.604, 0.635, 0.678],
        nose: [0.51, 0.541, 0.596],
    },
};

function ellipse(cr, cx, cy, rx, ry) {
    cr.save();
    cr.translate(cx, cy);
    cr.scale(rx, ry);
    cr.arc(0, 0, 1, 0, 2 * Math.PI);
    cr.restore();
}

function fill(cr, colour, alpha = 1) {
    cr.setSourceRGBA(colour[0], colour[1], colour[2], alpha);
}

function outline(cr, width = 2, alpha = 1) {
    cr.setSourceRGBA(INK[0], INK[1], INK[2], alpha);
    cr.setLineWidth(width);
}

/**
 * A peeking cat drawn once per theme; all motion is transform and opacity on
 * cached actors, so no JS runs per frame while it idles.
 */
export const Pet = GObject.registerClass(class SiftPet extends St.Widget {
    constructor({dark = true} = {}) {
        super({
            style_class: 'sift-pet',
            reactive: false,
            visible: false,
            width: PET_WIDTH,
            height: PET_HEIGHT,
            layout_manager: new Clutter.FixedLayout(),
        });

        this._dark = dark;
        this._animations = true;
        this._enabled = true;
        this._active = false;
        this._fits = false;
        this._panel = null;
        this._monitor = null;
        this._blinkId = 0;

        this.set_pivot_point(0.5, 1);

        this._tail = new St.DrawingArea({
            x: TAIL_X,
            y: TAIL_Y,
            width: TAIL_WIDTH,
            height: TAIL_HEIGHT,
        });
        this._tail.set_pivot_point(0.22, 0.94);
        this._tail.connect('repaint', () => this._drawTail());

        this._body = new St.DrawingArea({
            width: PET_WIDTH,
            height: PET_HEIGHT,
        });
        this._body.connect('repaint', () => this._drawBody());

        this._eyes = [34, 47].map(x => {
            const eye = new St.Widget({
                style_class: 'sift-pet-eye',
                width: 7,
                height: 9,
                x,
                y: 21,
                layout_manager: new Clutter.FixedLayout(),
                reactive: false,
            });
            eye.set_pivot_point(0.5, 0.5);
            eye.add_child(new St.Widget({
                style_class: 'sift-pet-catchlight',
                width: 2,
                height: 2,
                x: 1,
                y: 1,
            }));
            return eye;
        });

        this.add_child(this._tail);
        this.add_child(this._body);
        for (const eye of this._eyes)
            this.add_child(eye);
    }

    get active() {
        return this._active;
    }

    setDark(dark) {
        if (dark === this._dark)
            return;

        this._dark = dark;
        this._body.queue_repaint();
        this._tail.queue_repaint();
    }

    setAnimations(enabled) {
        if (enabled === this._animations)
            return;

        this._animations = enabled;
        if (enabled) {
            if (this._active)
                this._blinkSoon();
        } else {
            this._cancelBlink();
            this._settle();
        }
    }

    setEnabled(enabled) {
        this._enabled = enabled;
        if (!enabled)
            this.hide();
    }

    follow(panel, monitor) {
        this._panel = panel;
        this._monitor = monitor;
        this._place();
    }

    activate() {
        if (!this._enabled) {
            this.hide();
            return;
        }

        if (this._active) {
            this._place();
            return;
        }

        this._active = true;
        this._place();
        if (!this._fits) {
            this.visible = false;
            return;
        }

        this._settle();
        if (!this._animations) {
            this.visible = true;
            return;
        }

        this.opacity = 0;
        this.set_translation(0, 22, 0);
        this.visible = true;
        this.ease({
            translation_y: 0,
            opacity: 255,
            duration: 220,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                if (this._active)
                    this._blinkSoon();
            },
        });
    }

    deactivate() {
        if (!this._active) {
            this.hide();
            return;
        }

        this._active = false;
        this._cancelBlink();

        if (!this._animations || !this.visible) {
            this.hide();
            return;
        }

        this.remove_all_transitions();
        this.ease({
            translation_y: 24,
            opacity: 0,
            duration: 160,
            mode: Clutter.AnimationMode.EASE_IN_CUBIC,
            onComplete: () => this.hide(),
        });
    }

    hide() {
        this._active = false;
        this._cancelBlink();
        this.visible = false;
        this.opacity = 255;
        this._settle();
    }

    lookAt(index, count) {
        const look = eyeLook(index, count);
        for (const eye of this._eyes)
            eye.set_translation(look.x, look.y, 0);
    }

    destroy() {
        this._cancelBlink();
        this._active = false;
        this.remove_all_transitions();
        super.destroy();
    }

    _place() {
        if (!this._panel || !this._monitor)
            return;

        this._fits = petFits(this._panel, this._monitor);
        if (!this._fits) {
            this.visible = false;
            return;
        }

        const {x, y} = petRect(this._panel);
        this.set_position(x, y);
        if (this._active)
            this.visible = true;
    }

    _settle() {
        this.remove_all_transitions();
        this.set_scale(1, 1);
        this.set_translation(0, 0, 0);

        for (const eye of this._eyes) {
            eye.remove_all_transitions();
            eye.set_scale(1, 1);
            eye.set_translation(0, 0, 0);
        }

        this._tail.remove_all_transitions();
        this._tail.rotation_angle_z = 0;

        if (this._active)
            this.opacity = 255;
    }

    _blinkSoon() {
        this._cancelBlink();
        this._blinkId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._blinkId = 0;
            if (this._active)
                this._blink();
            return GLib.SOURCE_REMOVE;
        });
    }

    _cancelBlink() {
        if (!this._blinkId)
            return;

        GLib.source_remove(this._blinkId);
        this._blinkId = 0;
    }

    _blink() {
        for (const eye of this._eyes) {
            eye.ease({
                scale_y: 0.12,
                duration: 70,
                mode: Clutter.AnimationMode.EASE_IN_QUAD,
                onComplete: () => {
                    if (!this._active)
                        return;
                    eye.ease({
                        scale_y: 1,
                        duration: 90,
                        mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                    });
                },
            });
        }
    }

    _drawTail() {
        const cr = this._tail.get_context();
        const palette = PALETTE[this._dark ? 'dark' : 'light'];

        cr.setLineCap(cairo.LineCap.ROUND);
        cr.moveTo(7, 51);
        cr.curveTo(28, 48, 33, 24, 23, 4);
        outline(cr, 9);
        cr.strokePreserve();
        fill(cr, palette.body);
        cr.setLineWidth(5);
        cr.stroke();

        cr.$dispose();
    }

    _drawBody() {
        const cr = this._body.get_context();
        const palette = PALETTE[this._dark ? 'dark' : 'light'];

        ellipse(cr, 44, 55, 21, 21);
        fill(cr, palette.body);
        cr.fillPreserve();
        outline(cr);
        cr.stroke();

        ellipse(cr, 44, 69, 14, 5);
        fill(cr, palette.shade, 0.8);
        cr.fill();

        for (const side of [-1, 1]) {
            cr.moveTo(44 + side * 20, 17);
            cr.lineTo(44 + side * 13, 1);
            cr.lineTo(44 + side * 4, 12);
            cr.closePath();
            fill(cr, palette.body);
            cr.fillPreserve();
            outline(cr);
            cr.stroke();
        }

        for (const side of [-1, 1]) {
            cr.moveTo(44 + side * 17, 14);
            cr.lineTo(44 + side * 12, 5);
            cr.lineTo(44 + side * 7, 12);
            cr.closePath();
            fill(cr, palette.inner, 0.9);
            cr.fill();
        }

        ellipse(cr, 44, 27, 23, 20);
        fill(cr, palette.body);
        cr.fillPreserve();
        outline(cr);
        cr.stroke();

        cr.moveTo(41, 33);
        cr.lineTo(47, 33);
        cr.lineTo(44, 37);
        cr.closePath();
        fill(cr, palette.nose);
        cr.fill();

        outline(cr, 1.2, 0.7);
        cr.moveTo(44, 37);
        cr.curveTo(44, 41, 40, 41, 38, 39);
        cr.moveTo(44, 37);
        cr.curveTo(44, 41, 48, 41, 50, 39);
        cr.stroke();

        outline(cr, 1, 0.45);
        for (const [x1, y1, x2, y2] of [
            [26, 33, 12, 30],
            [26, 36, 11, 36],
            [62, 33, 76, 30],
            [62, 36, 77, 36],
        ]) {
            cr.moveTo(x1, y1);
            cr.lineTo(x2, y2);
        }
        cr.stroke();

        for (const x of [31, 57]) {
            ellipse(cr, x, 71, 9, 5.5);
            fill(cr, palette.body);
            cr.fillPreserve();
            outline(cr);
            cr.stroke();

            outline(cr, 1, 0.5);
            cr.moveTo(x - 2.5, 71);
            cr.lineTo(x - 2.5, 74.5);
            cr.moveTo(x + 2.5, 71);
            cr.lineTo(x + 2.5, 74.5);
            cr.stroke();
        }

        cr.$dispose();
    }
});
