// SPDX-License-Identifier: GPL-3.0-or-later
import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {GLASS_PAD, glassParams} from './lib/glassParams.js';

const UNIFORMS = `
uniform float width;
uniform float height;
uniform float radius;
uniform vec3 tint;
uniform float opacity;
uniform float saturation;
uniform float lens;
uniform float rim;
uniform float sheen;
`;

const CODE = `
vec2 uv = cogl_tex_coord_in[0].xy;
vec2 size = vec2(width, height);
vec2 frameSize = size + 2.0 * ${GLASS_PAD.toFixed(1)};
vec2 p = uv * frameSize - ${GLASS_PAD.toFixed(1)};
vec2 center = size * 0.5;
float r = min(radius, min(width, height) * 0.5);
vec2 q = abs(p - center) - (center - vec2(r));
float d = length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;
float mask = clamp(0.5 - d, 0.0, 1.0);
vec4 c = cogl_color_out;
float g = dot(c.rgb, vec3(0.2126, 0.7152, 0.0722));
vec3 rgb = clamp(mix(vec3(g), c.rgb, saturation), 0.0, 1.0);
rgb = mix(rgb, tint, opacity);
rgb += sheen * (1.0 - p.y / max(height, 1.0)) *
    (1.0 - p.y / max(height, 1.0));
float edge = exp(-max(-d, 0.0) / max(lens, 0.001));
rgb *= mix(1.0, 0.92, edge);
rgb += rim * exp(-abs(d));
cogl_color_out = vec4(rgb, 1.0) * mask;
`;

const GlassEffect = GObject.registerClass({
    GTypeName: 'SiftGlassEffect',
}, class GlassEffect extends Clutter.ShaderEffect {
    _init() {
        super._init();
        this._values = {};
    }

    vfunc_get_static_snippet() {
        return Cogl.Snippet.new(Cogl.SnippetHook.FRAGMENT, UNIFORMS, CODE);
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

function intersects(a, b) {
    return a.x < b.x + b.width && a.x + a.width > b.x &&
        a.y < b.y + b.height && a.y + a.height > b.y;
}

export class GlassPanel {
    constructor({settings = null} = {}) {
        this._settings = settings;
        this._panel = null;
        this._holder = null;
        this._frame = null;
        this._layers = null;
        this._blur = null;
        this._effect = null;
        this._rect = null;
        this._clones = [];
        this._displaySignals = [];
        this._windows = [];
        this._rebuildLater = 0;
        this._open = false;
        this._shaderFailed = false;
        this._cloneFailed = false;
        this._warned = false;
        this._params = glassParams();
        this.applySettings();
    }

    get effectiveMode() {
        if (this._params.effectiveMode === 'liquid' &&
            (this._shaderFailed || this._cloneFailed))
            return 'frosted';
        return this._params.effectiveMode;
    }

    get blurRadius() {
        return this.effectiveMode === 'off' ? 0 : this._params.blurRadius;
    }

    get rect() {
        return this._rect;
    }

    get cloneCount() {
        return this._clones.length;
    }

    attach(panel) {
        if (this._panel)
            this.destroy();

        this._panel = panel;
        this._holder = new Clutter.Actor({
            layout_manager: new Clutter.FixedLayout(),
            reactive: false,
        });
        this._frame = new St.Widget({
            clip_to_allocation: true,
            reactive: false,
            visible: false,
        });
        this._layers = new Clutter.Actor();
        this._frame.add_child(this._layers);
        this._holder.add_child(this._frame);
        panel.insert_child_at_index(this._holder, 0);

        try {
            this._effect = new GlassEffect();
            this._frame.add_effect(this._effect);
        } catch (error) {
            this._fallback(error);
        }

        try {
            this._blur = new Shell.BlurEffect({
                mode: Shell.BlurMode.ACTOR,
                radius: this._params.blurRadius,
            });
            this._frame.add_effect(this._blur);
        } catch (error) {
            this._fallback(error);
        }

        this.applySettings();
    }

    setRect(rect) {
        if (!rect)
            return;

        this._rect = rect;
        if (!this._frame)
            return;

        this._holder.set_size(rect.width, rect.height);
        this._frame.set_position(-GLASS_PAD, -GLASS_PAD);
        this._frame.set_size(rect.width + 2 * GLASS_PAD,
            rect.height + 2 * GLASS_PAD);
        this._layers.set_size(rect.width + 2 * GLASS_PAD,
            rect.height + 2 * GLASS_PAD);
        this._updateUniforms();

        if (this._open)
            this._rebuildClones();
    }

    open() {
        if (this._open)
            return;

        this._open = true;
        this.applySettings();
        this._connectDisplay();
        this._rebuildClones();
    }

    close() {
        this._open = false;
        this._cancelRebuild();
        this._clearClones();
        this._disconnectDisplay();

        if (this._frame)
            this._frame.visible = false;
    }

    applySettings() {
        this._params = this._readSettings();
        this._setPanelStyle();

        if (!this._panel)
            return;

        if (this._blur) {
            this._blur.radius = this.blurRadius;
            this._blur.enabled = this.effectiveMode !== 'off';
        }

        if (this._effect) {
            this._effect.enabled = this.effectiveMode === 'liquid' ||
                (this.effectiveMode === 'frosted' && !this._cloneFailed);
            this._updateUniforms();
        }

        if (this._frame)
            this._frame.visible = this._open && this.effectiveMode !== 'off';

        if (this.effectiveMode === 'off')
            this._clearClones();
    }

    destroy() {
        this.close();

        if (this._effect) {
            this._frame?.remove_effect(this._effect);
            this._effect = null;
        }

        this._holder?.destroy();
        this._holder = null;
        this._frame = null;
        this._layers = null;
        this._blur = null;
        this._panel = null;
        this._rect = null;
    }

    _readSettings() {
        const fallback = this._shaderFailed || this._cloneFailed
            ? 'frosted'
            : 'liquid';

        if (!this._settings) {
            return glassParams({
                fallback,
                dark: St.Settings.get().color_scheme !==
                    St.SystemColorScheme.PREFER_LIGHT,
            });
        }

        return glassParams({
            mode: this._settings.get_string('glass-mode'),
            opacity: this._settings.get_double('glass-opacity'),
            blurRadius: this._settings.get_int('blur-radius'),
            tint: this._settings.get_double('glass-tint'),
            dark: St.Settings.get().color_scheme !==
                St.SystemColorScheme.PREFER_LIGHT,
            fallback,
        });
    }

    _setPanelStyle() {
        if (!this._panel)
            return;

        for (const style of ['liquid', 'frosted', 'off'])
            this._panel.remove_style_class_name(`sift-glass-${style}`);

        this._panel.add_style_class_name(`sift-glass-${this.effectiveMode}`);
    }

    _updateUniforms() {
        if (!this._effect || !this._rect)
            return;

        // Frosted keeps the shader only for its rounded mask.
        const maskOnly = this.effectiveMode === 'frosted';

        this._effect.setUniforms({
            width: this._rect.width,
            height: this._rect.height,
            radius: this._params.radius,
            tint: maskOnly ? [0, 0, 0] : this._params.tint,
            opacity: maskOnly ? 0 : this._params.opacity,
            saturation: maskOnly ? 1 : this._params.saturation,
            lens: maskOnly ? 0 : this._params.lens,
            rim: maskOnly ? 0 : this._params.rim,
            sheen: maskOnly ? 0 : this._params.sheen,
        });
    }

    _fallback(error) {
        if (!this._warned) {
            this._warned = true;
            console.warn(`Sift: liquid glass unavailable, using frosted glass: ${error.message}`);
        }

        this._shaderFailed = true;
        if (this._effect) {
            this._frame?.remove_effect(this._effect);
            this._effect = null;
        }

        this.applySettings();
    }

    _connectDisplay() {
        if (this._displaySignals.length > 0)
            return;

        this._displaySignals.push(
            [global.display, global.display.connect('restacked',
                () => this._queueRebuild())],
            [global.display, global.display.connect('window-created',
                () => this._queueRebuild())]);
    }

    _disconnectDisplay() {
        for (const [source, id] of this._displaySignals)
            source.disconnect(id);
        this._displaySignals = [];
        this._disconnectWindows();
    }

    _connectWindows() {
        this._disconnectWindows();

        for (const actor of global.get_window_actors()) {
            this._windows.push(actor);
            actor.connectObject('notify::visible',
                () => this._queueRebuild(), this);
        }
    }

    _disconnectWindows() {
        for (const actor of this._windows) {
            try {
                actor.disconnectObject(this);
            } catch {
                // The window actor may already be gone.
            }
        }
        this._windows = [];
    }

    _queueRebuild() {
        if (!this._open || this._rebuildLater || this.effectiveMode === 'off')
            return;

        this._rebuildLater = global.compositor.get_laters().add(
            Meta.LaterType.BEFORE_REDRAW, () => {
                this._rebuildLater = 0;
                this._rebuildClones();
                return GLib.SOURCE_REMOVE;
            });
    }

    _cancelRebuild() {
        if (!this._rebuildLater)
            return;

        global.compositor.get_laters().remove(this._rebuildLater);
        this._rebuildLater = 0;
    }

    _clearClones() {
        for (const clone of this._clones)
            clone.destroy();
        this._clones = [];
    }

    _rebuildClones() {
        this._cancelRebuild();
        this._clearClones();

        if (!this._open || !this._rect || !this._layers ||
            this.effectiveMode === 'off')
            return;

        try {
            this._addBackgroundClone();
            this._addWindowClone();
            this._addPanelClone();
            this._connectWindows();
        } catch (error) {
            this._cloneFailed = true;
            this._clearClones();
            if (!this._warned) {
                this._warned = true;
                console.warn(`Sift: cannot clone the backdrop, using frosted glass: ${error.message}`);
            }
            this._params = this._readSettings();
            this._setPanelStyle();
            if (this._effect)
                this._effect.enabled = false;
            if (this._blur)
                this._blur.enabled = true;
        }
    }

    _frameOrigin() {
        return [this._rect.x - GLASS_PAD, this._rect.y - GLASS_PAD];
    }

    _addClone(source, x, y) {
        const clone = new Clutter.Clone({source});
        clone.set_position(x, y);
        this._layers.add_child(clone);
        this._clones.push(clone);
    }

    _addBackgroundClone() {
        const background = Main.layoutManager._backgroundGroup;
        if (!background)
            return;

        const position = background.get_transformed_position();
        if (!position.every(Number.isFinite))
            return;

        const [frameX, frameY] = this._frameOrigin();
        this._addClone(background, position[0] - frameX, position[1] - frameY);
    }

    _paddedRect() {
        return {
            x: this._rect.x - GLASS_PAD,
            y: this._rect.y - GLASS_PAD,
            width: this._rect.width + 2 * GLASS_PAD,
            height: this._rect.height + 2 * GLASS_PAD,
        };
    }

    _topWindow() {
        const area = this._paddedRect();
        const actors = global.get_window_actors().filter(actor => {
            const window = actor.meta_window;
            return actor.visible && !window.minimized &&
                window.get_window_type() === Meta.WindowType.NORMAL;
        });

        for (let i = actors.length - 1; i >= 0; i--) {
            const [x, y] = actors[i].get_transformed_position();
            const [width, height] = actors[i].get_transformed_size();
            if (intersects(area, {x, y, width, height}))
                return actors[i];
        }

        return null;
    }

    _addWindowClone() {
        const actor = this._topWindow();
        if (!actor)
            return;

        const surface = actor.get_children().find(child =>
            child.constructor.$gtype?.name?.startsWith('MetaSurface')) ?? actor;
        const position = surface.get_transformed_position();
        if (!position.every(Number.isFinite))
            return;

        const [frameX, frameY] = this._frameOrigin();
        this._addClone(surface, position[0] - frameX, position[1] - frameY);
    }

    _addPanelClone() {
        const panelBox = Main.layoutManager.panelBox;
        if (!panelBox || !Main.panel?.visible)
            return;

        const area = this._paddedRect();
        if (!intersects(area, {
            x: panelBox.x,
            y: panelBox.y,
            width: panelBox.width,
            height: panelBox.height,
        }))
            return;

        const position = Main.panel.get_transformed_position();
        if (!position.every(Number.isFinite))
            return;

        const [frameX, frameY] = this._frameOrigin();
        this._addClone(Main.panel, position[0] - frameX, position[1] - frameY);
    }
}