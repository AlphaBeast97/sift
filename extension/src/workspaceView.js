// SPDX-License-Identifier: GPL-3.0-or-later
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import {WORKSPACE_GAP, WORKSPACE_PADDING, workspaceCardWidth}
    from './lib/geometry.js';

const HEADER_HEIGHT = 32;
const CARD_PADDING = 8;
const CARD_BORDER = 2;
const CARD_SPACING = 6;
const LIST_PADDING_X = 4;
const LIST_PADDING_Y = 6;
const LIST_SPACING = 8;
const TILE_PADDING = 4;
const TILE_BORDER = 1;
const TILE_SPACING = 3;
const TITLE_HEIGHT = 15;
const MIN_PREVIEW_HEIGHT = 24;
// The panel is sized for 1.5 rows; the half tile hints at scrolling.
const VISIBLE_PREVIEWS = 1.5;
const DRAG_MAX_SIZE = 240;
const DROP_EDGE = 24;
const SCROLL_STEP = 48;
const SCROLL_SCALE = 240;
const AUTO_SCROLL_MARGIN = 48;
const AUTO_SCROLL_STEP = 10;

const clamp = (value, min, max) => Math.max(min, Math.min(max, value));

// Workspaces are global in GNOME, so one strip shows every workspace and
// every window on it, whichever monitor the window is on.
export const WorkspaceView = GObject.registerClass(
    class WorkspaceView extends St.Widget {
        _init({onActivateWorkspace = null, onActivateWindow = null} = {}) {
            super._init({
                style_class: 'sift-workspace-view',
                visible: false,
                clip_to_allocation: true,
                layout_manager: new Clutter.FixedLayout(),
            });

            this._onActivateWorkspace = onActivateWorkspace;
            this._onActivateWindow = onActivateWindow;
            this._cards = [];
            this._selected = 0;
            this._selectedWindow = -1;
            this._open = false;
            this._reloadId = 0;
            this._offset = 0;
            this._maxOffset = 0;
            this._pruning = false;
            this._displayIds = [];
            this._managerIds = [];
            this._windowIds = new Map();
            this._dragScrollId = 0;

            // A fixed layout keeps card positions under our control while the
            // strip is panned; a box layout would fight the offsets.
            this._strip = new St.Widget({
                style_class: 'sift-workspace-strip',
                layout_manager: new Clutter.FixedLayout(),
            });
            this.add_child(this._strip);

            // Dropping in the gaps or beyond the last card inserts a new
            // workspace; the cards handle drops on their own middles.
            this.reactive = true;
            this._delegate = {
                handleDragOver: source =>
                    source?.metaWindow || source?.kind === 'workspace'
                        ? DND.DragMotionResult.MOVE_DROP
                        : DND.DragMotionResult.CONTINUE,
                acceptDrop: (source, actor, x) => {
                    if (!source?.metaWindow && source?.kind !== 'workspace')
                        return false;

                    const index = this._insertIndexAt(x);
                    if (source.kind === 'workspace')
                        return this._moveWorkspaceTo(source.workspace, index);
                    this._insertWorkspaceAt(index, source.metaWindow);
                    return true;
                },
            };

            // Workspaces that do not fit are panned: Shift+wheel (or a
            // horizontal wheel) moves the strip sideways, and keyboard
            // selection keeps the selected card in view.
            this.connect('captured-event', (actor, event) =>
                event.type() === Clutter.EventType.SCROLL
                    ? this._handleScroll(event)
                    : Clutter.EVENT_PROPAGATE);
            this.connect('notify::allocation', () => this._layout());
        }

        get cards() {
            return this._cards.map(card => card.card);
        }

        get selectedIndex() {
            return this._selected;
        }

        get selectedWindowIndex() {
            return this._selectedWindow;
        }

        get cardRecords() {
            return this._cards;
        }

        open() {
            this._open = true;
            this._connectSignals();
            this._rebuild();
        }

        close() {
            this._open = false;
            this._disconnectSignals();
            this._endDragScroll();
            this._clear();
        }

        syncSize() {
            this._layout();
        }

        select(index) {
            if (this._cards.length === 0)
                return;

            const next = clamp(index, 0, this._cards.length - 1);
            if (next !== this._selected)
                this._selectedWindow = -1;
            this._selected = next;
            this._syncSelection();
        }

        moveSelection(delta) {
            this.select(this._selected + delta);
        }

        selectWindow(delta) {
            const card = this._cards[this._selected];
            if (!card || card.windows.length === 0)
                return;

            if (this._selectedWindow < 0)
                this._selectedWindow = delta > 0 ? 0 : card.windows.length - 1;
            else
                this._selectedWindow = clamp(this._selectedWindow + delta,
                    0, card.windows.length - 1);
            this._syncSelection();
        }

        moveSelectedWorkspace(delta) {
            const card = this._cards[this._selected];
            if (!card)
                return;

            const manager = global.workspace_manager;
            const target = clamp(this._selected + delta,
                0, manager.n_workspaces - 1);
            if (target === this._selected)
                return;

            manager.reorder_workspace(card.workspace, target);
            this._rebuild(target);
        }

        moveSelectedWindow(delta) {
            const card = this._cards[this._selected];
            const tile = this._selectedWindow >= 0
                ? card?.windows[this._selectedWindow] : null;
            if (!tile)
                return;

            const manager = global.workspace_manager;
            const target = clamp(this._selected + delta,
                0, manager.n_workspaces - 1);
            if (target === this._selected)
                return;

            tile.window.change_workspace(
                manager.get_workspace_by_index(target));
            this._rebuild(target);
        }

        activateSelected() {
            const card = this._cards[this._selected];
            if (!card)
                return;

            const tile = this._selectedWindow >= 0
                ? card.windows[this._selectedWindow] : null;
            if (tile)
                this._onActivateWindow?.(tile.window);
            else
                this._onActivateWorkspace?.(card.workspace);
        }

        _watchWindow(window) {
            if (!window || this._windowIds.has(window))
                return;
            this._windowIds.set(window, window.connect('unmanaged', () => {
                this._windowIds.delete(window);
                this._scheduleReload();
            }));
        }

        _connectSignals() {
            if (this._displayIds.length > 0)
                return;

            this._displayIds.push(global.display.connect('window-created',
                (_display, window) => {
                    this._watchWindow(window);
                    this._scheduleReload();
                }));
            for (const actor of global.get_window_actors())
                this._watchWindow(actor.meta_window);
            this._managerIds.push(global.workspace_manager.connect(
                'notify::n-workspaces', () => this._scheduleReload()));
        }

        _disconnectSignals() {
            for (const id of this._displayIds)
                global.display.disconnect(id);
            for (const id of this._managerIds)
                global.workspace_manager.disconnect(id);
            for (const [window, id] of this._windowIds) {
                try {
                    window.disconnect(id);
                } catch {
                    // The window may already be gone.
                }
            }
            this._displayIds = [];
            this._managerIds = [];
            this._windowIds.clear();
        }

        // One empty workspace is the spare GNOME keeps. Anything emptier goes
        // as soon as the window it held is closed, even while the view is open.
        _pruneEmptyWorkspaces() {
            const manager = global.workspace_manager;
            if (manager.n_workspaces <= 1)
                return;

            const empty = [];
            let hasWindows = false;
            for (let i = 0; i < manager.n_workspaces; i++) {
                const workspace = manager.get_workspace_by_index(i);
                if (workspace.list_windows().length === 0)
                    empty.push(workspace);
                else
                    hasWindows = true;
            }

            if (!hasWindows || empty.length === 0)
                return;

            // Keep the last empty workspace, the dynamic one at the end.
            const keep = empty[empty.length - 1];
            this._pruning = true;
            for (const workspace of empty) {
                if (workspace === keep || manager.n_workspaces <= 1)
                    continue;
                manager.remove_workspace(workspace, global.get_current_time());
            }
            this._pruning = false;
        }

        _rebuild(selectedIndex = null) {
            this._pruneEmptyWorkspaces();
            this._clear();
            const manager = global.workspace_manager;
            const active = manager.get_active_workspace();
            const actors = global.get_window_actors()
                .map(actor => actor.meta_window)
                .filter(window => this._isShown(window));

            for (let i = 0; i < manager.n_workspaces; i++) {
                const workspace = manager.get_workspace_by_index(i);
                const windows = actors
                    .filter(window =>
                        window.located_on_workspace(workspace) &&
                        (!window.is_on_all_workspaces() ||
                            workspace === active))
                    .sort((a, b) =>
                        a.get_stable_sequence() - b.get_stable_sequence());
                this._cards.push(this._createCard(workspace, i, windows));
            }

            this._selected = selectedIndex === null
                ? manager.get_active_workspace_index()
                : clamp(selectedIndex, 0, this._cards.length - 1);
            this._selectedWindow = -1;
            this._layout();
        }

        // Minimized windows are left out like the GNOME overview does; sticky
        // windows appear once, on the active workspace, instead of on all.
        _isShown(window) {
            const actor = window.get_compositor_private();
            return !window.skip_taskbar &&
                window.showing_on_its_workspace() &&
                actor !== null && actor.width > 0 && actor.height > 0;
        }

        _createCard(workspace, index, windows) {
            const card = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                style_class: 'sift-workspace',
                reactive: true,
            });
            const title = new St.Label({
                style_class: 'sift-workspace-title',
                x_expand: true,
                x_align: Clutter.ActorAlign.START,
                text: `Workspace ${index + 1}`,
            });
            title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            const count = new St.Label({
                style_class: 'sift-workspace-count',
                text: windows.length === 1
                    ? '1 window' : `${windows.length} windows`,
            });
            const headerBox = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                style_class: 'sift-workspace-header-box',
                x_expand: true,
            });
            headerBox.add_child(title);
            headerBox.add_child(count);

            const activate = () => {
                this.select(index);
                this._onActivateWorkspace?.(workspace);
            };
            const header = new St.Button({
                style_class: 'sift-workspace-header',
                child: headerBox,
                x_expand: true,
                can_focus: false,
                reactive: true,
                accessible_name: `Switch to workspace ${index + 1}`,
            });
            header.connect('clicked', activate);

            const closeButton = new St.Button({
                style_class: 'sift-workspace-close',
                child: new St.Icon({
                    icon_name: 'window-close-symbolic',
                    icon_size: 12,
                }),
                can_focus: false,
                reactive: true,
                visible: windows.length > 0,
                y_align: Clutter.ActorAlign.CENTER,
                accessible_name: `Close all windows on workspace ${index + 1}`,
            });
            closeButton.connect('clicked', () => this._closeWorkspace(windows));

            // The header is both the switch button and the drag handle, so a
            // workspace can be dragged to a new position in the strip.
            header._delegate = {
                kind: 'workspace',
                workspace,
                getDragActor: () =>
                    this._createWorkspaceDragActor(index, windows.length),
                getDragActorSource: () => header,
            };
            const draggable = DND.makeDraggable(header, {
                dragActorMaxSize: DRAG_MAX_SIZE,
                dragActorOpacity: 180,
            });
            draggable.connect('drag-begin', () => {
                card.add_style_class_name('sift-workspace-dragging');
                this._beginDragScroll();
            });
            draggable.connect('drag-end', () => {
                card.remove_style_class_name('sift-workspace-dragging');
                this._endDragScroll();
                this._scheduleReload();
            });
            draggable.connect('drag-cancelled', () => {
                card.remove_style_class_name('sift-workspace-dragging');
                this._endDragScroll();
            });

            const headerRow = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                style_class: 'sift-workspace-header-row',
                x_expand: true,
            });
            headerRow.add_child(header);
            headerRow.add_child(closeButton);

            const body = new St.ScrollView({
                style_class: 'sift-workspace-body',
                hscrollbar_policy: St.PolicyType.NEVER,
                vscrollbar_policy: St.PolicyType.EXTERNAL,
                x_expand: true,
                y_expand: true,
            });
            const list = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                style_class: 'sift-workspace-list',
                x_expand: true,
            });
            body.set_child(list);

            // Empty card space switches to the workspace. The event source is
            // null inside a scroll view, so hit-test to tell tiles apart.
            body.connect('button-press-event', (actor, event) => {
                const [x, y] = event.get_coords();
                let hit = global.stage.get_actor_at_pos(
                    Clutter.PickMode.REACTIVE, x, y);
                while (hit) {
                    if (hit._delegate?.metaWindow)
                        return Clutter.EVENT_PROPAGATE;
                    hit = hit.get_parent();
                }
                activate();
                return Clutter.EVENT_STOP;
            });

            if (windows.length === 0) {
                list.add_child(new St.Label({
                    style_class: 'sift-workspace-empty',
                    text: 'Empty',
                    x_align: Clutter.ActorAlign.CENTER,
                }));
            }

            // Dropping on the middle of a card moves into that workspace.
            // Dropping on a card edge inserts a new workspace at that gap, so
            // an app or a whole workspace can be placed between two cards.
            card._delegate = {
                handleDragOver: (source, actor, x) => {
                    const edge = this._dropEdge(x, card.width);
                    if (edge !== 0) {
                        if (source?.kind !== 'workspace') {
                            return source?.metaWindow
                                ? DND.DragMotionResult.MOVE_DROP
                                : DND.DragMotionResult.CONTINUE;
                        }
                        const insertAt = edge < 0 ? index : index + 1;
                        const from = source.workspace.index?.() ?? -1;
                        return this._workspaceInsertIndex(from, insertAt) === from
                            ? DND.DragMotionResult.NO_DROP
                            : DND.DragMotionResult.MOVE_DROP;
                    }

                    if (source?.kind === 'workspace') {
                        return source.workspace === workspace
                            ? DND.DragMotionResult.NO_DROP
                            : DND.DragMotionResult.MOVE_DROP;
                    }
                    const window = source?.metaWindow;
                    if (!window)
                        return DND.DragMotionResult.CONTINUE;
                    return window.get_workspace() === workspace
                        ? DND.DragMotionResult.NO_DROP
                        : DND.DragMotionResult.MOVE_DROP;
                },
                acceptDrop: (source, actor, x) => {
                    const edge = this._dropEdge(x, card.width);
                    if (edge !== 0) {
                        if (source?.kind === 'workspace') {
                            return this._moveWorkspaceTo(source.workspace,
                                edge < 0 ? index : index + 1);
                        }
                        const window = source?.metaWindow;
                        if (!window)
                            return false;
                        this._insertWorkspaceAt(edge < 0 ? index : index + 1,
                            window);
                        return true;
                    }

                    if (source?.kind === 'workspace') {
                        if (source.workspace === workspace)
                            return false;
                        global.workspace_manager.reorder_workspace(
                            source.workspace, index);
                        this._scheduleReload();
                        return true;
                    }
                    const window = source?.metaWindow;
                    if (!window || window.get_workspace() === workspace)
                        return false;
                    window.change_workspace(workspace);
                    this._scheduleReload();
                    return true;
                },
            };

            const record = {
                workspace,
                index,
                card,
                header,
                headerRow,
                closeButton,
                title,
                count,
                body,
                list,
                windows: [],
            };
            for (const window of windows) {
                const tile = this._createWindowTile(window);
                record.windows.push(tile);
                list.add_child(tile.tile);
            }

            card.add_child(headerRow);
            card.add_child(body);
            this._strip.add_child(card);
            return record;
        }

        _createWindowTile(window) {
            const actor = window.get_compositor_private();
            const rect = window.get_frame_rect();
            const sourceWidth = actor.width > 0 ? actor.width : rect.width;
            const sourceHeight = actor.height > 0 ? actor.height : rect.height;
            const clone = new Clutter.Clone({source: actor});
            const preview = new St.Widget({
                style_class: 'sift-window-preview',
                clip_to_allocation: true,
                layout_manager: new Clutter.FixedLayout(),
                reactive: true,
            });
            preview.add_child(clone);

            const label = new St.Label({
                style_class: 'sift-window-title',
                x_expand: true,
                x_align: Clutter.ActorAlign.START,
                reactive: true,
                text: window.get_title() ?? 'Window',
            });
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;

            const closeButton = new St.Button({
                style_class: 'sift-window-close',
                child: new St.Icon({
                    icon_name: 'window-close-symbolic',
                    icon_size: 12,
                }),
                can_focus: false,
                reactive: true,
                y_align: Clutter.ActorAlign.CENTER,
                accessible_name: `Close ${label.text}`,
            });
            closeButton.connect('clicked', () => this._closeWindow(window));

            const titleRow = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                style_class: 'sift-window-title-row',
                x_expand: true,
            });
            titleRow.add_child(label);
            titleRow.add_child(closeButton);

            const tile = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                style_class: 'sift-window-tile',
                x_expand: true,
                can_focus: false,
                reactive: true,
                accessible_name: `Focus ${label.text}`,
            });
            tile.add_child(preview);
            tile.add_child(titleRow);

            // DND uses the delegate for the drag actor and hands it to the
            // workspace card, which reads metaWindow back out of it. Only the
            // thumbnail and title drag, so the close button keeps its clicks.
            const dragDelegate = {
                metaWindow: window,
                getDragActor: () => this._createDragActor(actor,
                    sourceWidth, sourceHeight),
                getDragActorSource: () => preview,
            };
            tile._delegate = dragDelegate;

            for (const surface of [preview, label]) {
                surface._delegate = dragDelegate;
                const draggable = DND.makeDraggable(surface, {
                    dragActorMaxSize: DRAG_MAX_SIZE,
                    dragActorOpacity: 180,
                });
                draggable.connect('drag-begin', () => {
                    tile.add_style_class_name('sift-window-dragging');
                    this._beginDragScroll();
                });
                draggable.connect('drag-end', () => {
                    tile.remove_style_class_name('sift-window-dragging');
                    this._endDragScroll();
                    this._scheduleReload();
                });
                draggable.connect('drag-cancelled', () => {
                    tile.remove_style_class_name('sift-window-dragging');
                    this._endDragScroll();
                });

                const clickGesture = new Clutter.ClickGesture();
                clickGesture.connect('recognize', () =>
                    this._onActivateWindow?.(window));
                surface.add_action(clickGesture);
            }

            return {
                window,
                actorWidth: sourceWidth,
                actorHeight: sourceHeight,
                clone,
                preview,
                closeButton,
                tile,
            };
        }

        _createDragActor(actor, width, height) {
            const size = 200;
            const box = new St.Widget({
                style_class: 'sift-window-drag',
                width: size,
                height: Math.max(1, Math.round(size * height / width)),
                clip_to_allocation: true,
                layout_manager: new Clutter.FixedLayout(),
            });
            const clone = new Clutter.Clone({source: actor});
            const scale = Math.min(size / width,
                box.height / Math.max(1, height));
            clone.set_scale(scale, scale);
            clone.set_position(
                Math.round((size - width * scale) / 2),
                Math.round((box.height - height * scale) / 2));
            box.add_child(clone);
            return box;
        }

        _createWorkspaceDragActor(index, count) {
            const box = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                style_class: 'sift-workspace-drag',
            });
            box.add_child(new St.Label({
                style_class: 'sift-workspace-title',
                text: `Workspace ${index + 1}`,
            }));
            box.add_child(new St.Label({
                style_class: 'sift-workspace-count',
                text: count === 1 ? '1 window' : `${count} windows`,
            }));
            return box;
        }

        _layout() {
            if (this._cards.length === 0)
                return;

            const width = this.width;
            const height = this.height;
            if (width <= 0 || height <= 0)
                return;

            const count = this._cards.length;
            const cardWidth = workspaceCardWidth(width);
            const cardHeight = Math.max(0, height - WORKSPACE_PADDING * 2);
            const innerWidth = Math.max(0, cardWidth -
                CARD_PADDING * 2 - CARD_BORDER * 2);
            const bodyHeight = Math.max(0, cardHeight -
                CARD_PADDING * 2 - CARD_BORDER * 2 -
                HEADER_HEIGHT - CARD_SPACING);
            const previewWidth = Math.max(0, innerWidth -
                LIST_PADDING_X * 2 - TILE_PADDING * 2 - TILE_BORDER * 2);
            const contentWidth = count * cardWidth + (count - 1) * WORKSPACE_GAP;
            const firstX = Math.max(WORKSPACE_PADDING,
                Math.floor((width - contentWidth) / 2));
            const stripWidth = Math.max(width, WORKSPACE_PADDING * 2 +
                contentWidth);
            this._strip.set_size(stripWidth, height);
            this._maxOffset = Math.max(0, stripWidth - width);

            for (let i = 0; i < count; i++) {
                const card = this._cards[i];
                card.left = firstX + i * (cardWidth + WORKSPACE_GAP);
                card.card.set_position(card.left, WORKSPACE_PADDING);
                card.card.set_size(cardWidth, cardHeight);
                card.headerRow.set_size(innerWidth, HEADER_HEIGHT);
                card.body.set_size(innerWidth, bodyHeight);
                if (card.workspace.active)
                    card.card.add_style_class_name('sift-workspace-active');
                else
                    card.card.remove_style_class_name('sift-workspace-active');

                const slots = Math.min(card.windows.length,
                    VISIBLE_PREVIEWS);
                const fitHeight = slots > 0
                    ? Math.floor((bodyHeight - LIST_PADDING_Y -
                        LIST_SPACING * (Math.ceil(slots) - 1)) / slots) -
                        TILE_PADDING * 2 - TILE_BORDER * 2 -
                        TILE_SPACING - TITLE_HEIGHT
                    : 0;
                let previewHeight = Math.round(previewWidth * 9 / 16);
                if (fitHeight > MIN_PREVIEW_HEIGHT)
                    previewHeight = Math.min(previewHeight, fitHeight);
                previewHeight = Math.max(MIN_PREVIEW_HEIGHT, previewHeight);

                for (const window of card.windows) {
                    window.preview.set_size(previewWidth, previewHeight);
                    const scale = Math.min(
                        previewWidth / Math.max(1, window.actorWidth),
                        previewHeight / Math.max(1, window.actorHeight));
                    window.clone.set_scale(scale, scale);
                    window.clone.set_position(
                        Math.round((previewWidth -
                            window.actorWidth * scale) / 2),
                        Math.round((previewHeight -
                            window.actorHeight * scale) / 2));
                }
            }

            this._updateOffset();
            this._syncSelection();
        }

        _dropEdge(x, width) {
            if (typeof x !== 'number' || width <= DROP_EDGE * 2)
                return 0;
            if (x <= DROP_EDGE)
                return -1;
            if (x >= width - DROP_EDGE)
                return 1;
            return 0;
        }

        _insertIndexAt(x) {
            if (typeof x !== 'number')
                return this._cards.length;

            const contentX = x + this._offset;
            let index = 0;
            for (const card of this._cards) {
                if (contentX > card.left + card.card.width / 2)
                    index++;
            }
            return index;
        }

        _workspaceInsertIndex(from, insertAt) {
            return insertAt > from ? insertAt - 1 : insertAt;
        }

        _insertWorkspaceAt(index, window) {
            const manager = global.workspace_manager;
            const time = global.get_current_time();
            manager.append_new_workspace(false, time);
            const workspace =
                manager.get_workspace_by_index(manager.n_workspaces - 1);
            const target = index >= this._cards.length
                ? manager.n_workspaces - 1
                : clamp(index, 0, manager.n_workspaces - 1);
            if (target !== manager.n_workspaces - 1)
                manager.reorder_workspace(workspace, target);
            window.change_workspace(workspace);
            this._scheduleReload();
        }

        _moveWorkspaceTo(workspace, insertAt) {
            const manager = global.workspace_manager;
            const from = workspace.index?.() ?? -1;
            if (from < 0)
                return false;

            const target = clamp(
                this._workspaceInsertIndex(from, insertAt),
                0, manager.n_workspaces - 1);
            if (target === from)
                return false;

            manager.reorder_workspace(workspace, target);
            this._scheduleReload();
            return true;
        }

        _beginDragScroll() {
            if (this._dragScrollId || this._maxOffset <= 0)
                return;

            this._dragScrollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 16,
                () => {
                    if (!this._open || this._maxOffset <= 0)
                        return GLib.SOURCE_CONTINUE;

                    const [x, y] = global.get_pointer();
                    const [viewX, viewY] = this.get_transformed_position();
                    if (y < viewY - AUTO_SCROLL_MARGIN ||
                        y > viewY + this.height + AUTO_SCROLL_MARGIN)
                        return GLib.SOURCE_CONTINUE;

                    if (x < viewX + AUTO_SCROLL_MARGIN)
                        this._panBy(-AUTO_SCROLL_STEP);
                    else if (x > viewX + this.width - AUTO_SCROLL_MARGIN)
                        this._panBy(AUTO_SCROLL_STEP);
                    return GLib.SOURCE_CONTINUE;
                });
        }

        _endDragScroll() {
            if (!this._dragScrollId)
                return;
            GLib.source_remove(this._dragScrollId);
            this._dragScrollId = 0;
        }

        _panBy(delta) {
            this._offset = clamp(this._offset + delta, 0, this._maxOffset);
            this._updateOffset();
        }

        _pointerOverScrollingCard() {
            const [x, y] = global.get_pointer();
            let hit = global.stage.get_actor_at_pos(
                Clutter.PickMode.REACTIVE, x, y);
            while (hit) {
                const record = this._cards.find(card => card.body === hit);
                if (record) {
                    const adjustment = record.body.vadjustment;
                    return adjustment.upper > adjustment.page_size + 1;
                }
                if (hit === this)
                    return false;
                hit = hit.get_parent();
            }
            return false;
        }

        _handleScroll(event) {
            if (this._maxOffset <= 0)
                return Clutter.EVENT_PROPAGATE;

            const direction = event.get_scroll_direction();
            const shift =
                (event.get_state() & Clutter.ModifierType.SHIFT_MASK) !== 0;
            const scrollingCard = this._pointerOverScrollingCard();
            let delta = 0;
            if (direction === Clutter.ScrollDirection.SMOOTH) {
                const [dx, dy] = event.get_scroll_delta();
                if (dx !== 0 || shift)
                    delta = (dx || dy) * SCROLL_SCALE;
                else if (!scrollingCard)
                    delta = dy * SCROLL_SCALE;
            } else if (direction === Clutter.ScrollDirection.LEFT) {
                delta = -SCROLL_STEP;
            } else if (direction === Clutter.ScrollDirection.RIGHT) {
                delta = SCROLL_STEP;
            } else if (shift || !scrollingCard) {
                delta = direction === Clutter.ScrollDirection.UP
                    ? -SCROLL_STEP : SCROLL_STEP;
            }

            if (delta === 0)
                return Clutter.EVENT_PROPAGATE;

            this._panBy(delta);
            return Clutter.EVENT_STOP;
        }

        _updateOffset() {
            this._offset = clamp(this._offset, 0, this._maxOffset);
            this._strip.x = -Math.round(this._offset);
        }

        _syncSelection() {
            for (let i = 0; i < this._cards.length; i++) {
                const card = this._cards[i];
                if (i === this._selected)
                    card.card.add_style_class_name('sift-workspace-selected');
                else
                    card.card.remove_style_class_name('sift-workspace-selected');

                for (let j = 0; j < card.windows.length; j++) {
                    if (i === this._selected && j === this._selectedWindow)
                        card.windows[j].tile.add_style_class_name(
                            'sift-window-selected');
                    else
                        card.windows[j].tile.remove_style_class_name(
                            'sift-window-selected');
                }
            }

            this._scrollSelectedIntoView();
            this._scrollSelectedWindowIntoView();
        }

        _scrollSelectedIntoView() {
            const card = this._cards[this._selected];
            if (!card || this._maxOffset <= 0)
                return;

            const right = card.left + card.card.width;
            if (card.left - WORKSPACE_PADDING < this._offset)
                this._offset = card.left - WORKSPACE_PADDING;
            else if (right + WORKSPACE_PADDING > this._offset + this.width)
                this._offset = right + WORKSPACE_PADDING - this.width;
            this._updateOffset();
        }

        _scrollSelectedWindowIntoView() {
            const card = this._cards[this._selected];
            const tile = this._selectedWindow >= 0
                ? card?.windows[this._selectedWindow] : null;
            const adjustment = card?.body.vadjustment;
            if (!tile || !adjustment || adjustment.page_size <= 0)
                return;

            const top = tile.tile.y;
            const bottom = top + tile.tile.height;
            if (top < adjustment.value)
                adjustment.value = top;
            else if (bottom > adjustment.value + adjustment.page_size)
                adjustment.value = bottom - adjustment.page_size;
        }

        _closeWindow(window) {
            window.delete(global.get_current_time());
            this._scheduleReload(250);
        }

        _closeWorkspace(windows) {
            for (const window of windows)
                window.delete(global.get_current_time());
            this._scheduleReload(250);
        }

        _scheduleReload(delay = 0) {
            if (!this._open || this._reloadId || this._pruning)
                return;

            const reload = () => {
                this._reloadId = 0;
                if (this._open)
                    this._rebuild(this._selected);
            };
            this._reloadId = delay > 0
                ? GLib.timeout_add_once(GLib.PRIORITY_DEFAULT, delay, reload)
                : GLib.idle_add_once(GLib.PRIORITY_DEFAULT, reload);
        }

        _clear() {
            if (this._reloadId) {
                GLib.source_remove(this._reloadId);
                this._reloadId = 0;
            }
            for (const card of this._cards)
                card.card.destroy();
            this._cards = [];
        }

        destroy() {
            this._open = false;
            this._disconnectSignals();
            this._endDragScroll();
            this._clear();
            super.destroy();
        }
    });
