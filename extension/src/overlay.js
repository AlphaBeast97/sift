// SPDX-License-Identifier: GPL-3.0-or-later
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Shell from 'gi://Shell';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';

import {GlassPanel} from './glass.js';
import {gridPanel, searchPanel} from './lib/geometry.js';
import {resolveKey} from './lib/keys.js';
import {appRow, fileRow, mergeRows, selectionAfter} from './lib/merge.js';
import {MOVE, Spring} from './lib/spring.js';
import {AppGrid} from './appGrid.js';
import {loadFileIcon, openFile, revealFile} from './files.js';
import {EaseDriver, SpringDriver} from './motion.js';
import {ResultsView} from './results.js';

const OPEN_FADE_MS = 120;
const CLOSE_FADE_MS = 120;
const CONTENT_OUT_MS = 80;
const CONTENT_IN_MS = 120;
const QUERY_DEBOUNCE_MS = 40;
const MIN_QUERY_LENGTH = 2;
const FILE_QUERY_LIMIT = 20;
const GLASS_KEYS = new Set(['glass-brightness', 'animations']);

export const SiftOverlay = GObject.registerClass({
    Signals: {
        'closed': {},
    },
}, class SiftOverlay extends St.Widget {
    _init({settings, apps = null, daemon = null, onActivate = null} = {}) {
        super._init({
            name: 'siftOverlay',
            reactive: true,
            visible: false,
            layout_manager: new Clutter.FixedLayout(),
        });

        this._settings = settings;
        this._apps = apps;
        this._daemon = daemon;
        this._onActivate = onActivate;
        this._view = 'search';
        this._monitorIndex = 0;
        this._maxRows = settings.get_int('max-results');
        this._searchHeight = settings.get_int('search-height');
        this._grab = null;
        this._destroyed = false;
        this._state = 'closed';
        this._motionDone = true;
        this._openFade = false;
        this._revealPending = false;
        this._shownView = 'search';
        this._onSettled = null;
        this._geometryTravel = 0;
        this._viewToken = 0;
        this._ease = null;
        this._content = null;
        this._suspendGeometry = false;
        this._daemonCalc = null;
        this._daemonFiles = [];
        this._home = GLib.get_home_dir();
        this._serviceUnavailable = false;
        this._queryTimer = 0;
        this._queryGeneration = 0;
        this._queryBusy = false;
        this._latestQuery = null;
        this._reindexTimer = 0;
        this._prewarmId = 0;
        this._afterClose = null;
        this._themeId = 0;

        this._syncTheme();
        this._themeId = St.Settings.get().connect('notify::color-scheme', () => {
            this._syncTheme();
            this.applySettings();
        });

        this._panel = new St.Widget({
            style_class: 'sift-panel',
            reactive: true,
            clip_to_allocation: true,
            layout_manager: new Clutter.FixedLayout(),
        });
        this.add_child(this._panel);

        this._glass = new GlassPanel({settings: this._settings});
        this._glass.attach(this._panel);

        this._content = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
        });
        this._panel.add_child(this._content);

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
        this._entry.accessible_name = 'Search';
        this._gridIcon = new St.Icon({
            icon_name: 'view-app-grid-symbolic',
            icon_size: 18,
        });
        this._gridButton = new St.Button({
            style_class: 'sift-grid-button',
            child: this._gridIcon,
            can_focus: false,
            reactive: true,
            y_align: Clutter.ActorAlign.CENTER,
            accessible_name: 'Show all applications',
        });
        this._gridButton.connect('clicked', () => this._toggleView());

        entryBar.add_child(searchIcon);
        entryBar.add_child(this._entry);
        entryBar.add_child(this._gridButton);

        this._entry.clutter_text.connect('text-changed', () => this._onTextChanged());

        this._results = new ResultsView({maxRows: this._maxRows});
        this._results.onActivate = (row, options) => this._activateRow(row, options);

        this._scroll = new St.ScrollView({
            style_class: 'sift-scroll',
            hscrollbar_policy: St.PolicyType.NEVER,
            vscrollbar_policy: St.PolicyType.EXTERNAL,
            x_expand: true,
            y_expand: true,
        });
        this._scroll.set_child(this._results);

        this._empty = new St.Widget({
            style_class: 'sift-empty',
            x_expand: true,
            y_expand: true,
            layout_manager: new Clutter.BinLayout(),
            visible: false,
        });
        const emptyContent = new St.BoxLayout({
            orientation: Clutter.Orientation.VERTICAL,
            style_class: 'sift-empty-content',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._emptyTitle = new St.Label({
            style_class: 'sift-empty-title',
            x_align: Clutter.ActorAlign.CENTER,
            text: 'Search apps, files, and calculations',
        });
        this._emptyHint = new St.Label({
            style_class: 'sift-empty-hint',
            x_align: Clutter.ActorAlign.CENTER,
            text: '↑↓ Navigate · Enter Open · Esc Close',
        });
        this._showAppsButton = new St.Button({
            style_class: 'sift-empty-button',
            label: 'Show all applications',
            x_align: Clutter.ActorAlign.CENTER,
            can_focus: false,
        });
        this._showAppsButton.connect('clicked', () => this.showApps());
        emptyContent.add_child(this._emptyTitle);
        emptyContent.add_child(this._emptyHint);
        emptyContent.add_child(this._showAppsButton);
        this._empty.add_child(emptyContent);

        this._gridView = new St.Widget({
            style_class: 'sift-grid-view',
            visible: false,
            x_expand: true,
            y_expand: true,
            clip_to_allocation: true,
            layout_manager: new Clutter.FixedLayout(),
        });
        this._grid = new AppGrid({
            apps,
            showLabels: settings.get_boolean('grid-labels'),
            settings,
            onActivate: (record, options) => this._activateRow(appRow(record), options),
            onClose: () => this.close(),
        });
        this._gridView.add_child(this._grid);

        this._schedulePrewarm();

        const footer = new St.BoxLayout({
            orientation: Clutter.Orientation.HORIZONTAL,
            style_class: 'sift-footer',
            x_expand: true,
        });
        this._footer = footer;
        this._footerLabel = new St.Label({
            style_class: 'sift-footer-hint',
            x_expand: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        this._statusLabel = new St.Label({
            style_class: 'sift-footer-hint',
            y_align: Clutter.ActorAlign.CENTER,
            visible: false,
        });
        footer.add_child(this._footerLabel);
        footer.add_child(this._statusLabel);

        this._content.add_child(entryBar);
        this._content.add_child(this._scroll);
        this._content.add_child(this._empty);
        this._content.add_child(this._gridView);
        this._content.add_child(footer);

        this._springs = {
            x: new Spring(0, MOVE),
            y: new Spring(0, MOVE),
            width: new Spring(0, MOVE),
            height: new Spring(0, MOVE),
        };
        this._motion = new SpringDriver(this._panel, Object.values(this._springs),
            () => this._onMotionFrame());

        this._footerLabel.text = '↑↓ Navigate · Enter Open · Esc Close';
        this._syncFooter();

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
                this.refreshApps();
        });
        this._gridLabelsId = settings.connect('changed::grid-labels', () => {
            this._grid?.setShowLabels(settings.get_boolean('grid-labels'));
        });
        this._searchHeightId = settings.connect('changed::search-height', () => {
            this._searchHeight = settings.get_int('search-height');
            if (this.visible && this._view === 'search')
                this._applyGeometry();
        });
        this._glassSettingsId = settings.connect('changed', (_settings, key) => {
            if (GLASS_KEYS.has(key))
                this.applySettings();
        });
        this._monitorsId = Main.layoutManager.connect('monitors-changed', () => {
            if (!this.visible)
                return;
            const view = this._view;
            this.close({immediate: true});
            this.open(view);
        });
    }

    get view() {
        return this._view;
    }

    get closing() {
        return this._state === 'closing';
    }

    get animating() {
        return this._state === 'opening' || this._state === 'closing' ||
            this._motion.running || this._openFade || this._ease?.running;
    }

    get entry() {
        return this._entry;
    }

    get appGrid() {
        return this._grid;
    }

    get glass() {
        return this._glass;
    }

    get scrollView() {
        return this._scroll;
    }

    get emptyVisible() {
        return this._empty.visible;
    }

    applySettings() {
        this._glass?.applySettings();
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
        if (this._daemon?.unavailable || this._serviceUnavailable)
            return 'Search service unavailable';

        const status = this._daemon?.status;
        if (status?.state === 'degraded' || status?.watcher === 'unavailable' ||
            status?.watcher === 'partial')
            return 'Search index degraded';
        if (status?.truncated)
            return 'Search index truncated';
        if (status?.state === 'indexing' || status?.state === 'starting')
            return 'Indexing files…';
        return '';
    }

    setRows(rows) {
        this._results.setRows(rows);
    }

    refreshApps() {
        if (this._view !== 'search')
            return;

        this._results.setMaxRows(this._maxRows);
        const previous = this._results.selectedRow?.key ?? null;
        const records = this._apps
            ? this._apps.search(this._entry.text, Math.min(4, this._maxRows))
            : [];
        const rows = mergeRows({
            calc: this._daemonCalc,
            apps: records.map(appRow),
            files: this._daemonFiles
                .map(file => fileRow(file, this._home))
                .filter(Boolean),
        }, this._maxRows);

        this._results.setRows(rows);
        this._results.select(selectionAfter(rows, previous));
        this._syncEmptyState();

        if (this.visible && this._view === 'search')
            this._applyGeometry(true);

        for (let i = 0; i < this._results.rowCount; i++) {
            const row = this._results.rows[i];
            if (row?.kind !== 'file' && row?.kind !== 'dir')
                continue;
            const icon = this._results.iconAt(i);
            if (icon)
                loadFileIcon(row.path, icon);
        }
    }

    onAppsChanged() {
        this._grid?.invalidate();
        this.refreshApps();
        if (!this.visible)
            this._grid?.prewarm();
    }

    onDaemonChanged() {
        if (!this._daemon)
            return;

        if (!this._daemon.unavailable)
            this._serviceUnavailable = false;
        this._syncFooter();
    }

    _onTextChanged() {
        if (this._state === 'closing' || this._state === 'closed')
            return;

        this._queryGeneration++;
        this._cancelQueryTimer();
        this._daemonCalc = null;
        this._daemonFiles = [];
        this.refreshApps();
        this._results.select(0);
        this._scroll.vadjustment.value = 0;
        this._scheduleQuery();
    }

    _scheduleQuery() {
        if (!this._daemon || this._view !== 'search')
            return;

        const text = this._entry.text.trim();
        if (text.length < MIN_QUERY_LENGTH)
            return;

        const generation = this._queryGeneration;
        this._queryTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, QUERY_DEBOUNCE_MS, () => {
            this._queryTimer = 0;
            this._enqueueQuery(text, generation);
            return GLib.SOURCE_REMOVE;
        });
    }

    _enqueueQuery(text, generation) {
        this._latestQuery = {text, generation};
        if (!this._queryBusy)
            this._sendQuery();
    }

    _sendQuery() {
        const query = this._latestQuery;
        if (!query)
            return;

        this._latestQuery = null;
        this._queryBusy = true;

        this._daemon.query(query.text, FILE_QUERY_LIMIT)
            .then(result => {
                if (query.generation !== this._queryGeneration)
                    return;
                this._serviceUnavailable = false;
                this._daemonCalc = result.calc;
                this._daemonFiles = result.files;
                this.refreshApps();
                this._syncFooter();
            })
            .catch(() => {
                if (query.generation !== this._queryGeneration)
                    return;
                this._serviceUnavailable = true;
                this._daemonCalc = null;
                this._daemonFiles = [];
                this.refreshApps();
                this._syncFooter();
            })
            .finally(() => {
                this._queryBusy = false;
                if (this._latestQuery && this._latestQuery.generation === this._queryGeneration)
                    this._sendQuery();
                else
                    this._latestQuery = null;
            });
    }

    _cancelQueryTimer() {
        if (!this._queryTimer)
            return;

        GLib.source_remove(this._queryTimer);
        this._queryTimer = 0;
    }

    _syncFooter() {
        if (!this._statusLabel)
            return;

        const text = this.footerText;
        this._statusLabel.text = text;
        this._statusLabel.visible = text !== '';
    }

    // Builds the app grid while the overlay is hidden, so the first open does
    // not create every tile in the middle of its animation.
    _schedulePrewarm() {
        if (this._prewarmId || this._destroyed)
            return;

        this._prewarmId = GLib.timeout_add_seconds(GLib.PRIORITY_LOW, 5, () => {
            this._prewarmId = 0;
            if (this._destroyed)
                return GLib.SOURCE_REMOVE;

            if (this.visible) {
                this._schedulePrewarm();
                return GLib.SOURCE_REMOVE;
            }

            this._grid?.prewarm();
            return GLib.SOURCE_REMOVE;
        });
    }

    _syncTheme() {
        const dark = St.Settings.get().color_scheme !==
            St.SystemColorScheme.PREFER_LIGHT;
        for (const name of ['sift-dark', 'sift-light'])
            this.remove_style_class_name(name);
        this.add_style_class_name(dark ? 'sift-dark' : 'sift-light');
    }

    _syncEmptyState() {
        const search = this.visible && this._view === 'search';
        const query = this._entry.text.trim();
        const empty = search && query !== '' && this._results.rowCount === 0;

        this._empty.visible = empty;
        this._scroll.visible = search && query !== '' && !empty;
        this._results.visible = search && query !== '' && !empty;
        this._footer.visible = !search || query !== '';

        if (empty)
            this._emptyTitle.text = 'No matches';
    }

    _scrollSelectionIntoView() {
        const index = this._results.selectedIndex;
        const row = index >= 0 ? this._results.rowActorAt(index) : null;
        if (!row)
            return;

        const adjustment = this._scroll.vadjustment;
        if (adjustment.page_size <= 0)
            return;

        const top = row.y;
        const bottom = top + row.height;
        if (top < adjustment.value)
            adjustment.value = top;
        else if (bottom > adjustment.value + adjustment.page_size)
            adjustment.value = bottom - adjustment.page_size;
    }

    setMaxRows(maxRows) {
        this._maxRows = maxRows;
        if (this._view === 'search')
            this._applyGeometry();
    }

    open(view = 'search') {
        if (this._destroyed || Main.sessionMode.currentMode !== 'user')
            return;

        if (this._state === 'closing') {
            this._reopen(view);
            return;
        }

        if (this.visible) {
            this._setView(view);
            this._entry.clutter_text.grab_key_focus();
            return;
        }

        this._monitorIndex = global.display.get_current_monitor();
        this._maxRows = this._settings.get_int('max-results');
        this._searchHeight = this._settings.get_int('search-height');
        this._state = 'opening';
        this._viewToken++;

        const target = this._targetRect(view);
        if (!target) {
            this._state = 'closed';
            return;
        }

        // The grid lays out once, at its target size, before it is shown.
        this._content.remove_all_transitions();
        this._sizeContent(target.width, target.height);
        this._content.set_position(0, 0);
        this._setViewState(view);
        this._applyGeometry(false);

        const grab = Main.pushModal(this, {actionMode: Shell.ActionMode.OVERVIEW});
        if (!grab) {
            this._state = 'closed';
            return;
        }

        this._grab = grab;
        this.reactive = true;
        this._syncFullscreen();
        this.show();
        this.refreshApps();
        this._glass?.applySettings();

        this._sizeContent(target.width, target.height);
        this._content.set_position(0, 0);
        this._content.opacity = 255;

        if (!this._animationsEnabled()) {
            this.opacity = 255;
            this._panel.set_position(target.x, target.y);
            this._panel.set_size(target.width, target.height);
            this._glass?.setRect(target);
            this._glass?.open();
            this._seedSprings(target);
            this._state = 'open';
        } else {
            this._panel.set_position(target.x, target.y + 12);
            this.opacity = 0;
            this._seedSprings({...target, y: target.y + 12});
            this._glass?.setRect(this._panelRect());
            this._glass?.open();
            this._openFade = true;
            this.ease({
                opacity: 255,
                duration: OPEN_FADE_MS,
                mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
                onComplete: () => {
                    this._openFade = false;
                    this._finishOpening();
                },
            });
            this._springTo(target);
        }

        this._entry.clutter_text.grab_key_focus();
        this._daemon?.ensureFresh();
        this._syncFooter();
    }

    close({immediate = false, then = null} = {}) {
        if (this._destroyed || this._state === 'closed' ||
            this._state === 'closing')
            return;

        this._state = 'closing';
        this._afterClose = then;
        this._motion.stop();
        if (this._grab) {
            const grab = this._grab;
            this._grab = null;
            Main.popModal(grab);
        }

        this.reactive = false;
        this._queryGeneration++;
        this._cancelQueryTimer();
        this._latestQuery = null;
        this._daemonCalc = null;
        this._daemonFiles = [];

        if (immediate || !this._animationsEnabled()) {
            this._finishClose();
            return;
        }

        this._ease?.destroy();
        const start = this._panelRect();
        const startY = start.y;
        const endY = this._rect.y + 8;
        const startOpacity = this.opacity;
        this._ease = new EaseDriver(this._panel, CLOSE_FADE_MS, progress => {
            const y = startY + (endY - startY) * progress;
            this._panel.set_position(this._panel.x, y);
            this._glass?.setRect({...start, y});
            this.opacity = Math.round(startOpacity * (1 - progress));
        }, () => this._finishClose());
        this._ease.start();
    }

    _finishClose() {
        this._ease?.destroy();
        this._ease = null;
        this._motion.stop();
        if (this._grab) {
            const grab = this._grab;
            this._grab = null;
            Main.popModal(grab);
        }
        this.reactive = false;
        this.remove_all_transitions();
        this._content.remove_all_transitions();
        this._openFade = false;
        this._revealPending = false;
        this._viewToken++;
        this._state = 'closed';
        this.visible = false;
        this._glass?.close();
        this._grid?.close();
        this._entry.text = '';
        this._results.setRows([]);
        this._syncEmptyState();
        this._syncFooter();
        this._content.opacity = 255;
        this.opacity = 255;
        this._rect = null;

        const after = this._afterClose;
        this._afterClose = null;
        this.emit('closed');
        after?.();
    }

    _reopen(view) {
        this._afterClose = null;
        const grab = Main.pushModal(this, {actionMode: Shell.ActionMode.OVERVIEW});
        if (!grab) {
            this._finishClose();
            return;
        }

        this._grab = grab;
        this.reactive = true;
        this._ease?.destroy();
        this._ease = null;
        this.remove_all_transitions();
        this._viewToken++;
        this._state = 'opening';
        this._motionDone = false;
        this._revealPending = false;

        const target = this._targetRect(view);
        if (!target) {
            this._finishClose();
            return;
        }

        this._content.remove_all_transitions();
        this._sizeContent(target.width, target.height);
        this._content.set_position(0, 0);
        this._suspendGeometry = true;
        this._setViewState(view);
        this._suspendGeometry = false;
        this._rect = target;
        this._content.opacity = 255;

        this._seedSprings(this._panelRect());
        this._springTo(target);

        this._openFade = true;
        this.ease({
            opacity: 255,
            duration: OPEN_FADE_MS,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                this._openFade = false;
                this._finishOpening();
            },
        });

        this._entry.clutter_text.grab_key_focus();
    }

    hide() {
        this.close();
    }

    toggle() {
        if (this._state === 'closing')
            this.open('search');
        else if (this.visible)
            this.close();
        else
            this.open('search');
    }

    showApps() {
        if (this._state === 'closing') {
            this.open('grid');
            return;
        }

        if (this.visible)
            this._setView('grid');
        else
            this.open('grid');
    }

    focusSearch() {
        if (this._state === 'closing' || !this.visible)
            this.open('search');
        else
            this._setView('search');

        this._entry.clutter_text.grab_key_focus();
    }

    handleKey(symbol, state = 0, preedit) {
        if (this._destroyed || this._state === 'closing' ||
            this._state === 'closed')
            return Clutter.EVENT_PROPAGATE;

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
        this._state = 'closed';
        this._afterClose = null;
        this._motion?.destroy();
        this._ease?.destroy();
        this._ease = null;
        this._queryGeneration++;
        this._cancelQueryTimer();
        if (this._reindexTimer) {
            GLib.source_remove(this._reindexTimer);
            this._reindexTimer = 0;
        }
        if (this._prewarmId) {
            GLib.source_remove(this._prewarmId);
            this._prewarmId = 0;
        }

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
        if (this._gridLabelsId) {
            this._settings.disconnect(this._gridLabelsId);
            this._gridLabelsId = 0;
        }
        if (this._searchHeightId) {
            this._settings.disconnect(this._searchHeightId);
            this._searchHeightId = 0;
        }
        if (this._glassSettingsId) {
            this._settings.disconnect(this._glassSettingsId);
            this._glassSettingsId = 0;
        }
        if (this._themeId) {
            St.Settings.get().disconnect(this._themeId);
            this._themeId = 0;
        }

        this._grid?.destroy();
        this._grid = null;
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
                this._scrollSelectionIntoView();
                break;
            case 'prev':
            case 'up':
                this._results.move(-1);
                this._scrollSelectionIntoView();
                break;
            case 'page-next':
                this._results.page(1);
                this._scrollSelectionIntoView();
                break;
            case 'page-prev':
                this._results.page(-1);
                this._scrollSelectionIntoView();
                break;
            case 'first':
                this._results.select(0);
                this._scrollSelectionIntoView();
                break;
            case 'last':
                this._results.select(this._results.rowCount - 1);
                this._scrollSelectionIntoView();
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
    }

    _activateRow(row, {newWindow = false} = {}) {
        if (row.kind === 'file' || row.kind === 'dir') {
            if (!Gio.File.new_for_path(row.path).query_exists(null)) {
                this._daemonFiles = this._daemonFiles
                    .filter(file => file.path !== row.path);
                this.refreshApps();
                this._scheduleReindex();
                return;
            }
        }

        // Launch after the fade: a window that takes focus or covers the
        // screen must not cut the close animation short.
        const activate = () => {
            if (row.kind === 'app' && row.app) {
                if (newWindow && row.app.can_open_new_window())
                    row.app.open_new_window(-1);
                else
                    row.app.activate();
            } else if (row.kind === 'file' || row.kind === 'dir') {
                if (newWindow)
                    revealFile(row.path);
                else
                    openFile(row.path);
            } else if (row.kind === 'calc') {
                this._copySelected();
            }

            this._onActivate?.(row, {newWindow});
        };

        this.close({then: activate});
    }

    _scheduleReindex() {
        if (this._reindexTimer)
            return;

        this._reindexTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 500, () => {
            this._reindexTimer = 0;
            this._daemon?.reindex();
            return GLib.SOURCE_REMOVE;
        });
    }

    _toggleView() {
        this._setView(this._view === 'grid' ? 'search' : 'grid');
        this._entry.clutter_text.grab_key_focus();
    }

    _setView(view) {
        const next = view === 'grid' ? 'grid' : 'search';
        if (next === this._view) {
            this._entry.clutter_text.grab_key_focus();
            return;
        }

        // Toggled back before the outgoing content faded: stay on the view
        // that is still on screen instead of flashing it out and in again.
        if (next === this._shownView) {
            this._content.remove_all_transitions();
            this._content.opacity = 255;
            this._revealPending = false;
            this._view = next;
            if (next === 'grid')
                this._entry.text = '';
            const target = this._targetRect(next);
            if (target) {
                this._rect = target;
                this._springTo(target);
            }
            this._entry.clutter_text.grab_key_focus();
            return;
        }

        this._content.remove_all_transitions();
        this._viewToken++;

        if (!this.visible || !this._animationsEnabled() ||
            (this._state !== 'open' && this._state !== 'opening')) {
            this._revealPending = false;
            this._content.opacity = 255;
            this._setViewState(next);
            this._applyGeometry(false);
            this._finishOpening();
            return;
        }

        const token = this._viewToken;
        const target = this._targetRect(next);
        if (!target)
            return;

        // Leaving the grid: install the search view now so results are visible
        // while the panel springs, instead of after a content fade.
        if (next === 'search') {
            this._view = next;
            this._rect = target;
            this._revealPending = false;
            this._content.remove_all_transitions();
            this._content.opacity = 255;
            this._content.set_position(0, 0);
            this._sizeContent(target.width, target.height);
            this._setViewState(next);
            this._springTo(target);
            this._finishOpening();
            return;
        }

        this._view = next;
        this._rect = target;
        this._revealPending = false;
        this._springTo(target);

        this._content.ease({
            opacity: 0,
            duration: CONTENT_OUT_MS,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
            onComplete: () => {
                if (token !== this._viewToken ||
                    (this._state !== 'open' && this._state !== 'opening'))
                    return;

                // The outgoing content is hidden by opacity 0; resize while it
                // is invisible so the incoming grid lays out once at its target.
                this._sizeContent(target.width, target.height);
                this._content.set_position(0, 0);
                this._setViewState(next);
                this._content.opacity = 0;
                this._revealPending = true;

                if (this._allSettled() ||
                    this._travelLeft() <=
                        Math.max(1, this._geometryTravel * 0.2))
                    this._reveal(token);
            },
        });
    }

    _setViewState(view) {
        this._view = view === 'grid' ? 'grid' : 'search';
        this._shownView = this._view;

        const grid = this._view === 'grid';
        this._results.visible = !grid;
        this._gridView.visible = grid;
        this._gridIcon.icon_name = grid
            ? 'edit-find-symbolic' : 'view-app-grid-symbolic';
        this._gridButton.accessible_name = grid
            ? 'Show search' : 'Show all applications';

        if (grid) {
            this._entry.text = '';
            this._grid.open();
        } else {
            this._grid.close();
            this.refreshApps();
        }

        this._footerLabel.text = grid
            ? '←→↑↓ Navigate · Enter Open · Esc Close'
            : '↑↓ Navigate · Enter Open · Esc Close';
        this._syncEmptyState();
        this._syncFooter();
    }

    _targetRect(view = this._view) {
        const monitor = Main.layoutManager.monitors[this._monitorIndex] ??
            Main.layoutManager.primaryMonitor;
        if (!monitor)
            return null;

        const panelBox = Main.layoutManager.panelBox;
        const topBarBottom = panelBox ? panelBox.y + panelBox.height : monitor.y;

        if (view === 'grid')
            return gridPanel(monitor, topBarBottom);

        const compact = this._entry.text.trim() === '';
        return searchPanel(monitor, topBarBottom, this._searchHeight, compact);
    }

    _applyGeometry(animate = false) {
        if (this._suspendGeometry)
            return;

        const rect = this._targetRect();
        if (!rect)
            return;

        if (this._rect && this._rect.x === rect.x && this._rect.y === rect.y &&
            this._rect.width === rect.width && this._rect.height === rect.height)
            return;

        if (!this.visible || !animate || !this._animationsEnabled() ||
            this._state !== 'open') {
            this._setPanelRectInstant(rect);
            return;
        }

        const growing = rect.width >= this._content.width &&
            rect.height >= this._content.height;
        this._rect = rect;

        if (growing)
            this._sizeContent(rect.width, rect.height);

        this._springTo(rect, growing ? null : () => {
            this._sizeContent(rect.width, rect.height);
        });
    }

    _panelRect() {
        return {
            x: this._panel.x,
            y: this._panel.y,
            width: this._panel.width,
            height: this._panel.height,
        };
    }

    // The content and grid are sized from code, never from their children:
    // the icon grid is several pages wide and would otherwise push its
    // parents wider and taller while it builds. 92 = entry bar 60 + footer 32;
    // the grid is inset 8 px on the sides and bottom.
    _sizeContent(width, height) {
        this._content.set_size(width, height);

        const gridHeight = Math.max(0, height - 92);
        this._gridView.set_size(width, gridHeight);
        this._grid.set_position(8, 0);
        this._grid.set_size(Math.max(0, width - 16), Math.max(0, gridHeight - 8));
        this._grid.syncSize();
    }

    _seedSprings(rect) {
        this._motion.stop();
        this._springs.x.reset(rect.x);
        this._springs.y.reset(rect.y);
        this._springs.width.reset(rect.width);
        this._springs.height.reset(rect.height);
        this._motionDone = true;
    }

    _springTo(rect, onSettled = null) {
        this._springs.x.setTarget(rect.x);
        this._springs.y.setTarget(rect.y);
        this._springs.width.setTarget(rect.width);
        this._springs.height.setTarget(rect.height);
        this._geometryTravel = Math.max(
            Math.abs(rect.x - this._springs.x.value),
            Math.abs(rect.y - this._springs.y.value),
            Math.abs(rect.width - this._springs.width.value),
            Math.abs(rect.height - this._springs.height.value));
        this._onSettled = onSettled;
        this._motionDone = false;
        this._motion.start();
    }

    _allSettled() {
        return Object.values(this._springs).every(spring => spring.settled);
    }

    _travelLeft() {
        return Math.max(
            Math.abs(this._springs.x.target - this._springs.x.value),
            Math.abs(this._springs.y.target - this._springs.y.value),
            Math.abs(this._springs.width.target - this._springs.width.value),
            Math.abs(this._springs.height.target - this._springs.height.value));
    }

    _onMotionFrame() {
        const rect = {
            x: this._springs.x.value,
            y: this._springs.y.value,
            width: Math.round(this._springs.width.value),
            height: Math.round(this._springs.height.value),
        };
        this._panel.set_position(rect.x, rect.y);
        this._panel.set_size(rect.width, rect.height);
        this._glass?.setRect(rect);

        if (this._revealPending &&
            this._travelLeft() <= Math.max(1, this._geometryTravel * 0.2))
            this._reveal(this._viewToken);

        if (!this._allSettled())
            return;

        this._panel.set_position(this._rect.x, this._rect.y);
        this._panel.set_size(this._rect.width, this._rect.height);
        this._glass?.setRect(this._rect);
        this._glass?.settle();
        this._motionDone = true;

        if (this._revealPending)
            this._reveal(this._viewToken);

        const settled = this._onSettled;
        this._onSettled = null;
        settled?.();
        this._finishOpening();
    }

    _reveal(token) {
        if (token !== this._viewToken || !this._revealPending)
            return;

        this._revealPending = false;
        this._content.remove_all_transitions();
        this._content.opacity = 0;
        this._content.ease({
            opacity: 255,
            duration: CONTENT_IN_MS,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
    }

    _finishOpening() {
        if (this._state !== 'opening' || this._openFade || !this._motionDone)
            return;
        this._state = 'open';
    }

    _setPanelRectInstant(rect) {
        if (this._rect && this._rect.x === rect.x && this._rect.y === rect.y &&
            this._rect.width === rect.width && this._rect.height === rect.height)
            return;

        this._rect = rect;
        this._panel.set_position(rect.x, rect.y);
        this._panel.set_size(rect.width, rect.height);
        this._content.remove_all_transitions();
        this._revealPending = false;
        this._content.set_position(0, 0);
        this._sizeContent(rect.width, rect.height);
        this._seedSprings(rect);
        this._glass?.setRect(rect);
        this._glass?.settle();
    }

    _syncFullscreen() {
        this.set_position(0, 0);
        this.set_size(global.screen_width, global.screen_height);
    }

    _animationsEnabled() {
        return this._settings.get_boolean('animations') &&
            St.Settings.get().enable_animations;
    }
});
