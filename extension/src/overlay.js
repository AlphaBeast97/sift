// SPDX-License-Identifier: GPL-3.0-or-later
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {GlassPanel} from './glass.js';
import {gridPanel, searchPanel} from './lib/geometry.js';
import {resolveKey} from './lib/keys.js';
import {ResultsView} from './results.js';

const OPEN_ANIMATION_MS = 120;

export const SiftOverlay = GObject.registerClass({
    Signals: {
        'closed': {},
    },
}, class SiftOverlay extends St.Widget {
    _init({settings, onActivate = null} = {}) {
        super._init({
            name: 'siftOverlay',
            reactive: true,
            visible: false,
            layout_manager: new Clutter.BinLayout(),
        });

        this._settings = settings;
        this._onActivate = onActivate;
        this._view = 'search';
        this._monitorIndex = 0;
        this._maxRows = settings.get_int('max-results');
        this._grab = null;
        this._destroyed = false;

        this._panel = new St.Widget({
            style_class: 'sift-panel',
            reactive: true,
            layout_manager: new Clutter.BinLayout(),
        });
        this._panel.set_pivot_point(0.5, 0.5);
        this.add_child(this._panel);

        this._glass = new GlassPanel();
        this._glass.attach(this._panel);

        const content = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            x_expand: true,
            y_expand: true,
        });
        this._panel.add_child(content);

        const entryBar = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'sift-entry-bar',
            x_expand: true,
        });
        const searchIcon = new St.Icon({
            icon_name: 'edit-find-symbolic',
            icon_size: 20,
            style_class: 'sift-search-icon',
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._entry = new St.Entry({
            hint_text: 'Sift Search',
            style_class: 'sift-entry',
            x_expand: true,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._entry.accessible_name = 'Sift Search';
        this._gridIcon = new St.Icon({
            icon_name: 'view-app-grid-symbolic',
            icon_size: 18,
        });
        this._gridButton = new St.Button({
            style_class: 'sift-grid-button',
            child: this._gridIcon,
            can_focus: false,
            reactive: true,
            accessible_name: 'Show all applications',
        });
        this._gridButton.connect('clicked', () => this._toggleView());

        entryBar.add_child(searchIcon);
        entryBar.add_child(this._entry);
        entryBar.add_child(this._gridButton);

        this._results = new ResultsView({maxRows: this._maxRows});
        this._results.onActivate = (row, options) => this._onActivate?.(row, options);

        this._gridView = new St.Widget({
            style_class: 'sift-grid-view',
            visible: false,
            x_expand: true,
            y_expand: true,
        });

        const footer = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'sift-footer',
            x_expand: true,
        });
        this._footerLabel = new St.Label({
            style_class: 'sift-footer-hint',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        footer.add_child(this._footerLabel);

        content.add_child(entryBar);
        content.add_child(this._results);
        content.add_child(this._gridView);
        content.add_child(footer);

        this._footerLabel.text = this.footerText;

        Main.layoutManager.addChrome(this);

        this.connect('captured-event', (_actor, event) => {
            if (event.type() !== Clutter.EventType.KEY_PRESS)
                return Clutter.EVENT_PROPAGATE;

            const symbol = Clutter.keyval_name(event.get_key_symbol());
            return this.handleKey(symbol, event.get_state());
        });
        this.connect('button-press-event', (_actor, event) => {
            const [x, y] = event.get_coords();
            const [px, py] = this._panel.get_transformed_position();
            const [width, height] = this._panel.get_transformed_size();

            if (x < px || x >= px + width || y < py || y >= py + height) {
                this.close();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        this._settingsId = settings.connect('changed::max-results', () => {
            this._maxRows = settings.get_int('max-results');
            if (this.visible && this._view === 'search')
                this._applyGeometry();
        });
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => {
            if (!this.visible)
                return;
            const view = this._view;
            this.close();
            this.open(view);
        });
    }

    get view() {
        return this._view;
    }

    get entry() {
        return this._entry;
    }

    get rows() {
        return this._results.rows;
    }

    get maxRows() {
        return this._maxRows;
    }

    get selectedIndex() {
        return this._results.selectedIndex;
    }

    get rowCount() {
        return this._results.rowCount;
    }

    get footerText() {
        if (this._view === 'grid')
            return '←→↑↓ Navigate · Enter Open · Esc Close';
        return '↑↓ Navigate · Enter Open · Esc Close';
    }

    setRows(rows) {
        this._results.setRows(rows);
    }

    setMaxRows(maxRows) {
        this._maxRows = maxRows;
        if (this._view === 'search')
            this._applyGeometry();
    }

    open(view = 'search') {
        if (this._destroyed || Main.sessionMode.currentMode !== 'user')
            return;

        if (this.visible) {
            this._setView(view);
            this._entry.clutter_text.grab_key_focus();
            return;
        }

        this._monitorIndex = global.display.get_current_monitor();
        this._maxRows = this._settings.get_int('max-results');
        this._setView(view);

        const grab = Main.pushModal(this, {actionMode: Shell.ActionMode.OVERVIEW});
        if (!grab)
            return;

        this._grab = grab;
        this._syncFullscreen();
        this.show();
        this._animateOpen();
        this._entry.clutter_text.grab_key_focus();
    }

    close() {
        if (this._destroyed)
            return;

        if (this._grab) {
            const grab = this._grab;
            this._grab = null;
            Main.popModal(grab);
        }

        if (!this.visible)
            return;

        this.remove_all_transitions();
        this._panel.remove_all_transitions();
        this.visible = false;
        this._entry.text = '';
        this._results.setRows([]);
        this.emit('closed');
    }

    hide() {
        this.close();
    }

    toggle() {
        if (this.visible)
            this.close();
        else
            this.open('search');
    }

    showApps() {
        if (this.visible)
            this._setView('grid');
        else
            this.open('grid');
    }

    focusSearch() {
        if (!this.visible)
            this.open('search');
        else
            this._setView('search');

        this._entry.clutter_text.grab_key_focus();
    }

    handleKey(symbol, state = 0, preedit) {
        const composing = preedit ?? this._entry.clutter_text.has_preedit();
        if (composing)
            return Clutter.EVENT_PROPAGATE;

        const ctrl = (state & Clutter.ModifierType.CONTROL_MASK) !== 0;
        const shift = (state & Clutter.ModifierType.SHIFT_MASK) !== 0;
        const action = resolveKey(symbol, {
            ctrl,
            shift,
            view: this._view,
            selectedKind: this._results.selectedRow?.kind ?? null,
        });

        if (!action)
            return Clutter.EVENT_PROPAGATE;

        if (action === 'search-type') {
            this._setView('search');
            return Clutter.EVENT_PROPAGATE;
        }

        // In search the entry owns left/right for caret movement.
        if (this._view === 'search' && (action === 'left' || action === 'right'))
            return Clutter.EVENT_PROPAGATE;

        this._perform(action, ctrl);
        return Clutter.EVENT_STOP;
    }

    destroy() {
        if (this._destroyed)
            return;

        this._destroyed = true;

        if (this._grab) {
            const grab = this._grab;
            this._grab = null;
            Main.popModal(grab);
        }

        if (this._settingsId) {
            this._settings.disconnect(this._settingsId);
            this._settingsId = 0;
        }
        if (this._monitorsId) {
            Main.layoutManager.disconnect(this._monitorsId);
            this._monitorsId = 0;
        }

        this._glass?.destroy();
        this._glass = null;
        Main.layoutManager.removeChrome(this);
        super.destroy();
    }

    _perform(action, ctrl) {
        switch (action) {
            case 'close':
                this.close();
                break;
            case 'activate':
                this._results.activateSelected({newWindow: false});
                break;
            case 'activate-new':
                this._results.activateSelected({newWindow: true});
                break;
            case 'copy':
                this._copySelected();
                break;
            case 'next':
            case 'down':
                this._results.move(1);
                break;
            case 'prev':
            case 'up':
                this._results.move(-1);
                break;
            case 'page-next':
                this._results.page(1);
                break;
            case 'page-prev':
                this._results.page(-1);
                break;
            case 'first':
                this._results.select(0);
                break;
            case 'last':
                this._results.select(this._results.rowCount - 1);
                break;
            default:
                this._dispatchGrid(action, ctrl);
                break;
        }
    }

    _dispatchGrid(action, ctrl) {
        const grid = this._grid;
        if (!grid)
            return;

        switch (action) {
            case 'grid-left':
                grid.moveSelection(-1, 0);
                break;
            case 'grid-right':
                grid.moveSelection(1, 0);
                break;
            case 'grid-up':
                grid.moveSelection(0, -1);
                break;
            case 'grid-down':
                grid.moveSelection(0, 1);
                break;
            case 'grid-page-prev':
                grid.page(-1);
                break;
            case 'grid-page-next':
                grid.page(1);
                break;
            case 'grid-first':
                grid.select(0);
                break;
            case 'grid-last':
                grid.select(grid.itemCount - 1);
                break;
            case 'grid-activate':
                grid.activateSelected({newWindow: ctrl});
                break;
        }
    }

    _copySelected() {
        const result = this._results.selectedRow?.result;
        if (result == null)
            return;

        St.Clipboard.get_default().set_text(St.ClipboardType.CLIPBOARD, String(result));
        this.close();
    }

    _toggleView() {
        this._setView(this._view === 'grid' ? 'search' : 'grid');
        this._entry.clutter_text.grab_key_focus();
    }

    _setView(view) {
        this._view = view === 'grid' ? 'grid' : 'search';

        const grid = this._view === 'grid';
        this._results.visible = !grid;
        this._gridView.visible = grid;
        this._gridIcon.icon_name = grid ? 'edit-find-symbolic' : 'view-app-grid-symbolic';
        this._gridButton.accessible_name = grid ? 'Show search' : 'Show all applications';

        if (grid)
            this._entry.text = '';

        this._footerLabel.text = this.footerText;
        this._applyGeometry();
    }

    _applyGeometry() {
        const monitor = Main.layoutManager.monitors[this._monitorIndex] ??
            Main.layoutManager.primaryMonitor;
        if (!monitor)
            return;

        const panelBox = Main.layoutManager.panelBox;
        const topBarBottom = panelBox ? panelBox.y + panelBox.height : monitor.y;

        if (this._view === 'grid') {
            this._setPanelRect(gridPanel(monitor, topBarBottom));
            return;
        }

        const rect = searchPanel(monitor, topBarBottom, this._maxRows);
        this._results.setMaxRows(rect.rows);
        this._setPanelRect(rect);
    }

    _setPanelRect(rect) {
        this._rect = rect;
        this._panel.set_position(rect.x, rect.y);
        this._panel.set_size(rect.width, rect.height);
        this._glass.setRect(rect);
    }

    _syncFullscreen() {
        this.set_position(0, 0);
        this.set_size(global.screen_width, global.screen_height);
    }

    _animateOpen() {
        this.remove_all_transitions();
        this._panel.remove_all_transitions();

        if (!this._animationsEnabled()) {
            this.opacity = 255;
            this._panel.set_scale(1, 1);
            return;
        }

        this.opacity = 0;
        this._panel.set_scale(0.98, 0.98);
        this.ease({
            opacity: 255,
            duration: OPEN_ANIMATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
        this._panel.ease({
            scale_x: 1,
            scale_y: 1,
            duration: OPEN_ANIMATION_MS,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    }

    _animationsEnabled() {
        return this._settings.get_boolean('animations') &&
            St.Settings.get().enable_animations;
    }
});
