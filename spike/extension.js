// SPDX-License-Identifier: GPL-3.0-or-later
// Throwaway M0 spike: bounded backdrop clones + blur + rounded shader, and the
// Overview takeover hooks. Deleted in Task 2; only its measurements survive.

import Clutter from 'gi://Clutter';
import Cogl from 'gi://Cogl';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

const PATCHES = [
    'show', 'hide', 'toggle', 'focusSearch', 'showApps',
    'shouldToggleByCornerOrButton',
];
const PAD = 40;

const UNIFORMS = `
uniform float width;
uniform float height;
uniform float radius;
uniform float tintR;
uniform float tintG;
uniform float tintB;
uniform float tintAmount;
uniform float sheen;
uniform float rim;
uniform float rimWidth;
`;

const CODE = `
vec2 p = (cogl_tex_coord_in[0].xy * (vec2(width, height) + 3.0) - 2.0);
float r = min(radius, min(width, height) * 0.5);
vec2 halfSize = vec2(width, height) * 0.5;
vec2 q = abs(p - halfSize) - (halfSize - r);
float d = length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
float mask = clamp(0.5 - d, 0.0, 1.0);
float a = cogl_color_out.a;
vec3 tint = vec3(tintR, tintG, tintB);
cogl_color_out.rgb = mix(cogl_color_out.rgb, tint * a, tintAmount);
cogl_color_out.rgb += sheen * a * (1.0 - clamp(p.y / max(height, 1.0), 0.0, 1.0));
cogl_color_out.rgb += rim * a * exp(-abs(d) / max(rimWidth, 0.001));
cogl_color_out *= mask;
`;

const GlassEffect = GObject.registerClass({
    GTypeName: 'SiftSpikeGlassEffect',
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
            if (this._values[name] === value)
                continue;
            this._values[name] = value;
            this.set_uniform_float(name, 1, [value]);
            changed = true;
        }
        if (changed)
            this.queue_repaint();
    }
});

function percentile(values, p) {
    if (values.length === 0)
        return 0;
    const sorted = [...values].sort((a, b) => a - b);
    const index = (sorted.length - 1) * p;
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (index - lower);
}

class FrameMeter {
    constructor() {
        this._later = 0;
        this._last = 0;
        this._intervals = [];
    }

    start() {
        this.stop();
        this._last = 0;
        this._intervals = [];
        this._later = global.compositor.get_laters().add(
            Meta.LaterType.BEFORE_REDRAW, () => this._tick());
    }

    _tick() {
        const now = GLib.get_monotonic_time() / 1000;
        if (this._last !== 0)
            this._intervals.push(now - this._last);
        this._last = now;
        return GLib.SOURCE_CONTINUE;
    }

    stop() {
        if (this._later === 0)
            return;
        global.compositor.get_laters().remove(this._later);
        this._later = 0;
    }

    log(label) {
        const s = this.summary;
        log(`sift-spike ${label}: frames=${s.frames} ` +
            `p50=${s.p50.toFixed(2)} p95=${s.p95.toFixed(2)} max=${s.max.toFixed(2)}`);
    }

    get summary() {
        return {
            p50: percentile(this._intervals, 0.5),
            p95: percentile(this._intervals, 0.95),
            max: this._intervals.length ? Math.max(...this._intervals) : 0,
            frames: this._intervals.length,
        };
    }
}

const SiftSpikePanel = GObject.registerClass(
class SiftSpikePanel extends St.Widget {
    _init() {
        super._init({
            style_class: 'sift-spike-panel',
            reactive: true,
            can_focus: true,
            clip_to_allocation: true,
            visible: false,
        });

        this._rect = null;
        this._gridRect = false;
        this._grab = null;
        this._clones = [];
        this._rebuildLater = 0;
        this._meter = new FrameMeter();

        this._frame = new St.Widget({clip_to_allocation: true});
        this.add_child(this._frame);
        this._layers = new Clutter.Actor();
        this._frame.add_child(this._layers);
        this._blur = new Shell.BlurEffect({mode: Shell.BlurMode.ACTOR, radius: 40});
        this._frame.add_effect(this._blur);

        this._effect = null;
        try {
            this._effect = new GlassEffect();
            this.add_effect(this._effect);
            this._effect.setUniforms({
                radius: 18,
                tintR: 0.06, tintG: 0.07, tintB: 0.09,
                tintAmount: 0.45,
                sheen: 0.05,
                rim: 0.06,
                rimWidth: 1,
            });
        } catch (e) {
            logError(e, 'sift-spike: shader unavailable, using CSS');
        }

        const content = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
            style: 'padding: 24px; spacing: 8px;',
        });
        this.add_child(content);
        this._title = new St.Label({
            text: 'Sift glass spike',
            style_class: 'sift-spike-title',
        });
        this._hint = new St.Label({
            text: 'Super toggles · Ctrl+G grid rect · type to repaint · Esc closes',
            style_class: 'sift-spike-hint',
        });
        content.add_child(this._title);
        content.add_child(this._hint);

        this.connect('key-press-event', (_actor, event) => this._onKey(event));
        global.display.connectObject('restacked', () => this._queueRebuild(), this);
        this.connect('destroy', () => this._destroy());
    }

    open() {
        if (this.visible)
            return;

        this._applyRect();
        const grab = Main.pushModal(this, {actionMode: Shell.ActionMode.OVERVIEW});
        if (!grab)
            return;
        this._grab = grab;
        this.show();
        this.grab_key_focus();
        this._rebuildClones();
        this._meter.start();
    }

    close() {
        if (!this.visible)
            return;

        this._meter.stop();
        this._meter.log(this._gridRect ? 'grid' : 'search');
        if (this._grab) {
            Main.popModal(this._grab);
            this._grab = null;
        }
        this._clearClones();
        this.hide();
    }

    toggle() {
        if (this.visible)
            this.close();
        else
            this.open();
    }

    _applyRect() {
        const monitor = Main.layoutManager.primaryMonitor;
        const width = this._gridRect
            ? Math.min(1040, monitor.width - 40)
            : Math.min(720, monitor.width - 40);
        const height = this._gridRect
            ? Math.round(monitor.height * 0.7)
            : Math.min(420, monitor.height - 40);
        const x = monitor.x + Math.round((monitor.width - width) / 2);
        const y = monitor.y + Math.round(monitor.height * (this._gridRect ? 0.12 : 0.18));

        this._rect = {x, y, width, height};
        this.set_position(x, y);
        this.set_size(width, height);
        this._frame.set_position(-PAD, -PAD);
        this._frame.set_size(width + 2 * PAD, height + 2 * PAD);
        this._layers.set_size(width + 2 * PAD, height + 2 * PAD);
        this._effect?.setUniforms({width, height});
        this._hint.set_text(this._gridRect
            ? `grid rect ${width}×${height} · Ctrl+G search rect`
            : `search rect ${width}×${height} · Ctrl+G grid rect`);
        this._rebuildClones();
    }

    _queueRebuild() {
        if (!this.visible || this._rebuildLater)
            return;
        this._rebuildLater = global.compositor.get_laters().add(
            Meta.LaterType.BEFORE_REDRAW, () => {
                this._rebuildLater = 0;
                this._rebuildClones();
                return GLib.SOURCE_REMOVE;
            });
    }

    _clearClones() {
        for (const clone of this._clones)
            clone.destroy();
        this._clones = [];
    }

    _rebuildClones() {
        this._clearClones();
        if (!this.visible || !this._rect)
            return;

        const frameX = this._rect.x - PAD;
        const frameY = this._rect.y - PAD;
        const background = Main.layoutManager._backgroundGroup;
        const backgroundAt = background?.get_transformed_position();
        if (backgroundAt && backgroundAt.every(Number.isFinite)) {
            const wallpaper = new Clutter.Clone({source: background});
            wallpaper.set_position(backgroundAt[0] - frameX, backgroundAt[1] - frameY);
            this._layers.add_child(wallpaper);
            this._clones.push(wallpaper);
        }

        const windowActor = this._topWindow();
        if (!windowActor)
            return;

        const surface = windowActor.get_children()
            .find(child => child.constructor.$gtype?.name?.startsWith('MetaSurface')) ??
            windowActor;
        const [sx, sy] = surface.get_transformed_position();
        const clone = new Clutter.Clone({source: surface});
        clone.set_position(sx - frameX, sy - frameY);
        this._layers.add_child(clone);
        this._clones.push(clone);
    }

    _topWindow() {
        const area = {
            x: this._rect.x - PAD,
            y: this._rect.y - PAD,
            width: this._rect.width + 2 * PAD,
            height: this._rect.height + 2 * PAD,
        };
        const actors = global.get_window_actors().filter(actor => {
            const window = actor.meta_window;
            return actor.visible && !window.minimized &&
                window.get_window_type() === Meta.WindowType.NORMAL;
        });

        for (let i = actors.length - 1; i >= 0; i--) {
            const [x, y] = actors[i].get_transformed_position();
            const [width, height] = actors[i].get_transformed_size();
            if (x < area.x + area.width && x + width > area.x &&
                y < area.y + area.height && y + height > area.y)
                return actors[i];
        }
        return null;
    }

    _onKey(event) {
        const symbol = event.get_key_symbol();
        const state = event.get_state();

        if (symbol === Clutter.KEY_Escape) {
            this.close();
            return Clutter.EVENT_STOP;
        }
        if ((state & Clutter.ModifierType.CONTROL_MASK) &&
            (symbol === Clutter.KEY_g || symbol === Clutter.KEY_G)) {
            this._gridRect = !this._gridRect;
            this._applyRect();
            return Clutter.EVENT_STOP;
        }

        this._hint.set_text(`key ${Clutter.keyval_name(symbol)} · ` +
            `${this._rect.width}×${this._rect.height}`);
        return Clutter.EVENT_PROPAGATE;
    }

    _destroy() {
        this._meter.stop();
        if (this._rebuildLater) {
            global.compositor.get_laters().remove(this._rebuildLater);
            this._rebuildLater = 0;
        }
        this._clearClones();
    }
});

export default class SiftSpike extends Extension {
    enable() {
        this._keySettings = new Gio.Settings({schema_id: 'org.gnome.shell.keybindings'});
        this._saved = new Map();
        for (const name of PATCHES) {
            this._saved.set(name, {
                hasOwn: Object.prototype.hasOwnProperty.call(Main.overview, name),
                value: Main.overview[name],
            });
        }

        this._lastOpen = 0;
        this._panel = new SiftSpikePanel();
        Main.layoutManager.addChrome(this._panel);

        Main.overview.show = () => {
            this._lastOpen = Date.now();
            this._panel.open();
        };
        Main.overview.showApps = () => {
            this._lastOpen = Date.now();
            this._panel.open();
        };
        Main.overview.hide = () => this._panel.close();
        Main.overview.toggle = () => this._panel.toggle();
        Main.overview.focusSearch = () => {
            this._lastOpen = Date.now();
            this._panel.open();
        };
        Main.overview.shouldToggleByCornerOrButton = () =>
            Date.now() - this._lastOpen > 500;

        this._bindingAdded = false;
        if (this._keySettings.get_strv('toggle-overview').length > 0) {
            Main.wm.removeKeybinding('toggle-overview');
            Main.wm.addKeybinding(
                'toggle-overview',
                this._keySettings,
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                () => this._panel.toggle());
            this._bindingAdded = true;
        }

        this._swipeEnabled = Main.overview._swipeTracker.enabled;
        Main.overview._swipeTracker.enabled = false;
    }

    getTestAPI() {
        return {panel: this._panel};
    }

    disable() {
        this._panel?.close();

        for (const [name, saved] of this._saved) {
            if (saved.hasOwn)
                Main.overview[name] = saved.value;
            else
                delete Main.overview[name];
        }
        this._saved.clear();

        if (this._bindingAdded) {
            Main.wm.removeKeybinding('toggle-overview');
            Main.wm.addKeybinding(
                'toggle-overview',
                this._keySettings,
                Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
                Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
                () => Main.overview.toggle());
            this._bindingAdded = false;
        }

        Main.overview._swipeTracker.enabled = this._swipeEnabled;

        if (this._panel) {
            Main.layoutManager.removeChrome(this._panel);
            this._panel.destroy();
            this._panel = null;
        }

        this._keySettings = null;
        this._saved = null;
    }
}
