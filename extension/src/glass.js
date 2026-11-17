// SPDX-License-Identifier: GPL-3.0-or-later
// Derived from Isle (https://github.com/zickrian/isle), GPL-3.0-or-later.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Graphene from 'gi://Graphene';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {GLASS_PAD, glassParams} from './lib/glassParams.js';
import {intersects, unionRect, windowPlaces} from './lib/windowStack.js';

const UNIFORMS = `
uniform float width;
uniform float height;
uniform float radius;
uniform vec4 fill;
uniform vec3 rimColour;
uniform float saturation;
uniform float lo;
uniform float span;
uniform float gamma;
uniform float deep;
uniform float knee;
uniform float sheen;
uniform float glow;
uniform float reach;
uniform float lens;
uniform float band;
uniform float spread;
uniform float rim;
uniform float rimWidth;
`;

const FUNCTIONS = `
float siftInner(vec2 p, vec2 size, float radius) {
    vec2 q = abs(p - size * 0.5) - (size * 0.5 - vec2(radius));
    return radius - length(max(q, vec2(0.0))) - min(max(q.x, q.y), 0.0);
}
vec2 siftNormal(vec2 p, vec2 size, float radius) {
    return normalize(vec2(
        siftInner(p + vec2(1.0, 0.0), size, radius) -
            siftInner(p - vec2(1.0, 0.0), size, radius),
        siftInner(p + vec2(0.0, 1.0), size, radius) -
            siftInner(p - vec2(0.0, 1.0), size, radius)) + 1e-5);
}
`;

// Clutter's effect texture is 3 px larger than the actor, 2 of them before it.
const effectPoint = size => `(cogl_tex_coord_in[0].xy * (${size} + 3.0) - 2.0)`;

const CODE = `
vec2 size = vec2(width, height);
vec2 p = ${effectPoint('size')};
float r = min(radius, min(width, height) * 0.5);
float inner = siftInner(p, size, r);
float body = clamp(inner + 0.5, 0.0, 1.0);

if (lens > 0.0 && inner >= 0.0 && inner < band) {
    vec2 n = siftNormal(p, size, r);
    vec2 shift = n * lens * pow(1.0 - inner / band, 2.0) / (size + 3.0);
    vec2 uv = cogl_tex_coord_in[0].xy;
    vec4 bent = texture2D(cogl_sampler0, uv + shift);
    cogl_color_out = vec4(
        texture2D(cogl_sampler0, uv + shift * (1.0 + spread)).r,
        bent.g,
        texture2D(cogl_sampler0, uv + shift * (1.0 - spread)).b,
        bent.a) * cogl_color_in;
}

float alpha = max(cogl_color_out.a, 0.0001);
vec3 rgb = cogl_color_out.rgb / alpha;
float luma = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
rgb = lo + span * pow(max(luma, 0.0), gamma) *
    (1.0 - deep * smoothstep(knee, 1.0, luma)) +
    (rgb - luma) * span * saturation;
rgb += sheen * (1.0 - clamp(p.y / max(height, 1.0), 0.0, 1.0));
if (inner >= 0.0) {
    rgb += glow * exp(-inner / reach) *
        (0.3 + 0.7 * clamp(p.y / max(height, 1.0), 0.0, 1.0));
}
if (rim > 0.0 && inner >= 0.0 && inner < rimWidth * 8.0) {
    vec2 facing = -siftNormal(p, size, r);
    vec2 light = normalize(vec2(-1.0, -1.25));
    float lit = pow(max(dot(facing, light), 0.0), 1.6) +
        0.6 * pow(max(dot(facing, -light), 0.0), 1.6);
    float strength = clamp(rim * (0.22 + lit) *
        (exp(-inner / rimWidth) + 0.3 * exp(-inner / (rimWidth * 3.5))),
        0.0, 1.0);
    rgb = mix(rgb, rimColour, strength);
}
rgb = mix(rgb, fill.rgb, fill.a);
cogl_color_out = vec4(clamp(rgb, 0.0, 1.0), 1.0) * cogl_color_out.a * body;
`;

const GlassEffect = GObject.registerClass({
    GTypeName: 'SiftGlassEffect',
}, class GlassEffect extends Clutter.ShaderEffect {
    _init() {
        super._init();
        this._values = {};
    }

    vfunc_get_static_snippet() {
        return Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT,
            UNIFORMS + FUNCTIONS, CODE);
    }

    setUniforms(values) {
        let changed = false;

        for (const [name, value] of Object.entries(values)) {
            const key = Array.isArray(value) ? value.join('|') : value;
            if (this._values[name] === key)
                continue;

            this._values[name] = key;
            this.set_uniform_float(name, Array.isArray(value) ? value.length : 1,
                Array.isArray(value) ? value : [value]);
            changed = true;
        }

        if (changed)
            this.queue_repaint();
    }
});

// What a copy of a window follows of it: a clone draws its source without the
// source's own fade and motion.
const MIRRORED = ['opacity', 'scale-x', 'scale-y', 'pivot-point',
    'translation-x', 'translation-y'];

// The surfaces alone: other extensions draw into the window actor, and a copy
// of that would paint their effects a second time.
function surfaceOf(actor) {
    return actor.get_children().find(child =>
        child.constructor.$gtype?.name?.startsWith('MetaSurface')) ?? actor;
}

// A copy that tells Clutter it draws only within `paintArea`, so a change in
// its source redraws just that part of the screen.
const AreaClone = GObject.registerClass({
    GTypeName: 'SiftAreaClone',
}, class AreaClone extends Clutter.Clone {
    _init(source, {mirror = null} = {}) {
        super._init({source});
        this._area = null;
        this._bindings = mirror
            ? MIRRORED.map(name =>
                mirror.bind_property(name, this, name,
                    GObject.BindingFlags.SYNC_CREATE)) : [];
        this.connect('destroy', () =>
            this._bindings.forEach(binding => binding.unbind()));
    }

    set paintArea(area) {
        const old = this._area;
        if (old && ['x', 'y', 'width', 'height']
            .every(key => old[key] === area[key]))
            return;
        this._area = area;
        // Clutter keeps the last volume until told: redraws would stay there.
        this.invalidate_paint_volume();
    }

    vfunc_get_paint_volume(volume) {
        if (!this._area)
            return false;
        volume.set_origin(new Graphene.Point3D({
            x: this._area.x, y: this._area.y, z: 0,
        }));
        volume.set_width(this._area.width);
        volume.set_height(this._area.height);
        return true;
    }
});

export class GlassPanel {
    constructor({settings = null} = {}) {
        this._settings = settings;
        this._panel = null;
        this._shape = null;
        this._frame = null;
        this._layers = null;
        this._blur = null;
        this._effect = null;
        this._rect = null;
        this._windows = new Map();
        this._wallpaper = null;
        this._bar = null;
        this._watched = new Set();
        this._places = null;
        this._union = null;
        this._later = 0;
        this._open = false;
        this._shaderFailed = false;
        this._blurFailed = false;
        this._cloneFailed = false;
        this._warned = new Set();
        this._params = glassParams();
        this.applySettings();
    }

    get rect() {
        return this._rect;
    }

    get cloneCount() {
        return this._windows.size + (this._wallpaper ? 1 : 0) +
            (this._bar ? 1 : 0);
    }

    get blurRadius() {
        return this._params.blurRadius;
    }

    get brightness() {
        return this._params.brightness;
    }

    get fallback() {
        return this._shaderFailed || this._blurFailed;
    }

    attach(panel) {
        if (this._panel)
            this.destroy();

        this._panel = panel;
        this._shape = new St.Widget({
            layout_manager: new Clutter.FixedLayout(),
            clip_to_allocation: true,
            reactive: false,
            visible: false,
        });
        this._frame = new St.Widget({
            clip_to_allocation: true,
            reactive: false,
        });
        this._layers = new Clutter.Actor();
        this._frame.add_child(this._layers);
        this._shape.add_child(this._frame);
        panel.insert_child_at_index(this._shape, 0);

        try {
            this._effect = new GlassEffect();
            this._shape.add_effect(this._effect);
        } catch (error) {
            this._fallback('shader', error);
        }

        try {
            this._blur = new Shell.BlurEffect({
                mode: Shell.BlurMode.ACTOR,
                radius: this._params.blurRadius,
            });
            this._frame.add_effect(this._blur);
        } catch (error) {
            this._fallback('blur', error);
        }

        this.applySettings();
    }

    setRect(rect) {
        if (!rect)
            return;

        this._rect = rect;
        if (!this._shape)
            return;

        this._shape.set_size(rect.width, rect.height);
        this._frame.set_position(-GLASS_PAD, -GLASS_PAD);
        this._frame.set_size(rect.width + 2 * GLASS_PAD,
            rect.height + 2 * GLASS_PAD);
        this._layers.set_size(rect.width + 2 * GLASS_PAD,
            rect.height + 2 * GLASS_PAD);
        this._updateUniforms();

        if (!this._open)
            return;

        this._union = unionRect(this._union, this._padded(rect));
        this._syncWindows();
    }

    settle() {
        if (!this._rect)
            return;
        this._union = this._padded(this._rect);
        this._syncWindows();
    }

    open() {
        if (this._open)
            return;

        this._open = true;
        this.applySettings();
        this._connectDisplay();

        try {
            this._wallpaper = new AreaClone(Main.layoutManager._backgroundGroup);
            this._layers.add_child(this._wallpaper);
        } catch (error) {
            this._failClone(error);
        }

        try {
            this._bar = new AreaClone(Main.panel);
            this._layers.add_child(this._bar);
        } catch (error) {
            this._failClone(error);
        }

        this._union = this._padded(this._rect);
        this._syncWindows();
        this._shape.visible = !this._shaderFailed;
    }

    close() {
        this._open = false;
        this._cancelLater();

        this._windows.forEach(clone => clone.destroy());
        this._windows.clear();
        this._wallpaper?.destroy();
        this._bar?.destroy();
        this._wallpaper = null;
        this._bar = null;
        this._disconnectDisplay();
        this._union = null;
        this._places = null;

        if (this._shape)
            this._shape.visible = false;
    }

    applySettings() {
        this._params = this._readParams();

        if (this._panel) {
            if (this.fallback)
                this._panel.add_style_class_name('sift-glass-fallback');
            else
                this._panel.remove_style_class_name('sift-glass-fallback');
        }

        if (this._blur)
            this._blur.radius = this._params.blurRadius;

        this._updateUniforms();
    }

    destroy() {
        this.close();

        if (this._effect) {
            this._shape?.remove_effect(this._effect);
            this._effect = null;
        }

        this._shape?.destroy();
        this._shape = null;
        this._frame = null;
        this._layers = null;
        this._blur = null;
        this._panel = null;
        this._rect = null;
    }

    _readParams() {
        return glassParams({
            brightness: this._settings
                ? this._settings.get_int('glass-brightness') : 50,
            dark: St.Settings.get().color_scheme !==
                St.SystemColorScheme.PREFER_LIGHT,
        });
    }

    _updateUniforms() {
        if (!this._effect || !this._rect)
            return;

        const params = this._params;
        this._effect.setUniforms({
            width: this._rect.width,
            height: this._rect.height,
            radius: params.radius,
            fill: params.fill,
            rimColour: params.rimColour,
            saturation: params.saturation,
            lo: params.lo,
            span: params.span,
            gamma: params.gamma,
            deep: params.deep,
            knee: params.knee,
            sheen: params.sheen,
            glow: params.glow,
            reach: params.reach,
            lens: params.lens,
            band: params.band,
            spread: params.spread,
            rim: params.rim,
            rimWidth: params.rimWidth,
        });
    }

    _warn(kind, error) {
        if (this._warned.has(kind))
            return;
        this._warned.add(kind);
        console.warn(`Sift: liquid glass unavailable (${kind}): ` +
            `${error.message ?? error}`);
    }

    _fallback(kind, error) {
        this._warn(kind, error);

        if (kind === 'shader') {
            this._shaderFailed = true;
            if (this._effect) {
                this._shape?.remove_effect(this._effect);
                this._effect = null;
            }
            if (this._blur)
                this._blur.enabled = false;
            if (this._shape)
                this._shape.visible = false;
        } else if (kind === 'blur') {
            this._blurFailed = true;
        }

        this.applySettings();
    }

    _failClone(error) {
        this._cloneFailed = true;
        this._warn('clone', error);
        this.applySettings();
    }

    _connectDisplay() {
        global.window_group.connectObject('child-added', () => this._queueSync(),
            'child-removed', () => this._queueSync(), this);
        global.display.connectObject('restacked', () => this._queueSync(), this);

        const barBox = Main.layoutManager.panelBox;
        barBox?.connectObject('notify::allocation', () => this._queueSync(),
            'notify::mapped', () => this._queueSync(),
            'notify::translation-y', () => this._queueSync(), this);
        Main.panel?.connectObject('notify::allocation', () => this._queueSync(),
            this);
    }

    _disconnectDisplay() {
        global.window_group.disconnectObject(this);
        global.display.disconnectObject(this);
        Main.layoutManager.panelBox?.disconnectObject(this);
        Main.panel?.disconnectObject(this);

        this._watched.forEach(actor => {
            try {
                actor.disconnectObject(this);
            } catch {
                // The window actor may already be gone.
            }
        });
        this._watched.clear();
    }

    _windowPlaces() {
        if (this._places)
            return this._places;

        const actors = global.get_window_actors();
        // Every window is watched once: a move can bring it under the glass.
        for (const actor of actors) {
            if (this._watched.has(actor))
                continue;

            this._watched.add(actor);
            actor.connectObject(
                'notify::allocation', () => this._queueSync(),
                'notify::visible', () => this._queueSync(),
                'child-added', () => this._queueSync(),
                'child-removed', () => this._queueSync(),
                'destroy', () => {
                    this._watched.delete(actor);
                    this._queueSync();
                }, this);
        }

        this._places = windowPlaces(actors);
        return this._places;
    }

    _queueSync() {
        this._places = null;
        if (!this._open || this._later)
            return;

        this._later = global.compositor.get_laters().add(
            Meta.LaterType.BEFORE_REDRAW, () => {
                this._later = 0;
                this._syncWindows();
                return GLib.SOURCE_REMOVE;
            });
    }

    _cancelLater() {
        if (!this._later)
            return;

        global.compositor.get_laters().remove(this._later);
        this._later = 0;
    }

    _padded(rect) {
        if (!rect)
            return null;

        return {
            x: rect.x - GLASS_PAD,
            y: rect.y - GLASS_PAD,
            width: rect.width + 2 * GLASS_PAD,
            height: rect.height + 2 * GLASS_PAD,
        };
    }

    _syncWindows() {
        if (!this._open || !this._union || !this._layers)
            return;

        const under = this._windowPlaces()
            .filter(place => intersects(this._union, place));
        const actors = new Set(under.map(place => place.actor));

        for (const [actor, clone] of this._windows) {
            if (actors.has(actor))
                continue;
            clone.destroy();
            this._windows.delete(actor);
        }

        let below = this._wallpaper;
        for (const {actor} of under) {
            let clone = this._windows.get(actor);
            const source = surfaceOf(actor);
            if (clone && clone.source !== source) {
                clone.destroy();
                clone = null;
            }

            if (!clone) {
                try {
                    clone = new AreaClone(source, {mirror: actor});
                } catch (error) {
                    this._failClone(error);
                    continue;
                }
                this._windows.set(actor, clone);
                this._layers.add_child(clone);
            }

            if (clone.get_previous_sibling() !== below)
                this._layers.set_child_above_sibling(clone, below);
            below = clone;
        }

        if (this._bar && this._bar.get_previous_sibling() !== below)
            this._layers.set_child_above_sibling(this._bar, below);

        this._placeCopies();
    }

    _placeCopies() {
        const frame = this._padded(this._rect);
        if (!frame || !this._layers)
            return;

        this._layers.set_position(-frame.x, -frame.y);
        const place = (clone, x, y) => {
            clone.set_position(x, y);
            clone.paintArea = {
                x: frame.x - x,
                y: frame.y - y,
                width: frame.width,
                height: frame.height,
            };
        };

        if (this._wallpaper)
            place(this._wallpaper, 0, 0);

        if (this._bar) {
            const barBox = Main.layoutManager.panelBox;
            this._bar.visible = barBox.mapped;
            place(this._bar,
                barBox.x + barBox.translation_x + Main.panel.x,
                barBox.y + barBox.translation_y + Main.panel.y);
        }

        this._windows.forEach((clone, actor) => {
            if (clone.source === actor) {
                place(clone, actor.x, actor.y);
                return;
            }

            const scale = actor.get_child_transform?.()?.get_x_scale?.() || 1;
            clone.set_size(clone.source.width * scale,
                clone.source.height * scale);
            place(clone, actor.x + clone.source.x * scale,
                actor.y + clone.source.y * scale);
        });
    }
}
