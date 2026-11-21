// SPDX-License-Identifier: GPL-3.0-or-later
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

const PADDING = 8;
const GAP = 10;
const HEADER_HEIGHT = 32;
const MIN_CARD_WIDTH = 180;
const MAX_CARD_WIDTH = 340;
const MAX_PREVIEW_HEIGHT = 150;
const DRAG_MAX_SIZE = 240;

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
            this._open = false;
            this._reloadId = 0;

            this._scroll = new St.ScrollView({
                style_class: 'sift-workspace-scroll',
                hscrollbar_policy: St.PolicyType.EXTERNAL,
                vscrollbar_policy: St.PolicyType.NEVER,
                x_expand: true,
                y_expand: true,
            });
            this._strip = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                layout_manager: new Clutter.FixedLayout(),
            });
            this._scroll.set_child(this._strip);
            this.add_child(this._scroll);

            this.connect('notify::allocation', () => this._layout());
        }

        get cards() {
            return this._cards.map(card => card.card);
        }

        get selectedIndex() {
            return this._selected;
        }

        get cardRecords() {
            return this._cards;
        }

        open() {
            this._open = true;
            this._rebuild();
        }

        close() {
            this._open = false;
            this._clear();
        }

        syncSize(width, height) {
            this._scroll.set_position(0, 0);
            this._scroll.set_size(Math.max(0, width), Math.max(0, height));
            this._layout();
        }

        select(index) {
            if (this._cards.length === 0)
                return;

            this._selected = Math.min(Math.max(index, 0), this._cards.length - 1);
            this._syncSelection();
        }

        moveSelection(delta) {
            this.select(this._selected + delta);
        }

        activateSelected() {
            const card = this._cards[this._selected];
            if (card)
                this._onActivateWorkspace?.(card.workspace);
        }

        _rebuild() {
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

            this.select(manager.get_active_workspace_index());
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
            // The card body has no buttons of its own, so a click there means
            // "switch to this workspace" too. Header and window clicks are
            // consumed by their own buttons before they reach the card.
            const activateCard = () => {
                activate();
                return Clutter.EVENT_STOP;
            };
            card.connect('enter-event', () => this.select(index));
            card.connect('button-press-event', activateCard);

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
            body.connect('button-press-event', activateCard);

            if (windows.length === 0) {
                list.add_child(new St.Label({
                    style_class: 'sift-workspace-empty',
                    text: 'Empty',
                    x_align: Clutter.ActorAlign.CENTER,
                }));
            }

            // Dropping a window tile on a card moves that window here.
            card._delegate = {
                handleDragOver: source => {
                    const window = source?.metaWindow;
                    if (!window)
                        return DND.DragMotionResult.CONTINUE;
                    return window.get_workspace() === workspace
                        ? DND.DragMotionResult.NO_DROP
                        : DND.DragMotionResult.MOVE_DROP;
                },
                acceptDrop: source => {
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
                body,
                list,
                windows: [],
            };
            for (const window of windows) {
                const tile = this._createWindowTile(window);
                record.windows.push(tile);
                list.add_child(tile.tile);
            }

            card.add_child(header);
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
            });
            preview.add_child(clone);

            const label = new St.Label({
                style_class: 'sift-window-title',
                x_expand: true,
                x_align: Clutter.ActorAlign.START,
                text: window.get_title() ?? 'Window',
            });
            label.clutter_text.ellipsize = Pango.EllipsizeMode.END;

            const box = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                style_class: 'sift-window-tile-content',
                x_expand: true,
            });
            box.add_child(preview);
            box.add_child(label);

            const tile = new St.Button({
                style_class: 'sift-window-tile',
                child: box,
                x_expand: true,
                can_focus: false,
                reactive: true,
                accessible_name: `Focus ${label.text}`,
            });
            tile.connect('clicked', () => this._onActivateWindow?.(window));

            // DND uses the delegate for the drag actor and hands it to the
            // workspace card, which reads metaWindow back out of it.
            tile._delegate = {
                metaWindow: window,
                getDragActor: () => this._createDragActor(actor,
                    sourceWidth, sourceHeight),
                getDragActorSource: () => tile,
            };
            const draggable = DND.makeDraggable(tile, {
                dragActorMaxSize: DRAG_MAX_SIZE,
                dragActorOpacity: 180,
            });
            draggable.connect('drag-begin', () =>
                tile.add_style_class_name('sift-window-dragging'));
            draggable.connect('drag-end', () => {
                tile.remove_style_class_name('sift-window-dragging');
                this._scheduleReload();
            });
            draggable.connect('drag-cancelled', () =>
                tile.remove_style_class_name('sift-window-dragging'));

            return {
                window,
                actorWidth: sourceWidth,
                actorHeight: sourceHeight,
                clone,
                preview,
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

        _layout() {
            if (this._cards.length === 0)
                return;

            const width = this._scroll.width;
            const height = this._scroll.height;
            if (width <= 0 || height <= 0)
                return;

            const count = this._cards.length;
            const available = width - PADDING * 2 - GAP * (count - 1);
            const cardWidth = Math.max(MIN_CARD_WIDTH,
                Math.min(MAX_CARD_WIDTH, Math.floor(available / count)));
            const cardHeight = Math.max(0, height - PADDING * 2);
            const innerWidth = Math.max(0, cardWidth - 16);
            const bodyHeight = Math.max(0, cardHeight - HEADER_HEIGHT - 16 - 8);
            const previewWidth = Math.max(0, innerWidth - 8);
            const previewHeight = Math.max(48, Math.min(MAX_PREVIEW_HEIGHT,
                Math.round(previewWidth * 9 / 16),
                Math.max(72, bodyHeight - 30)));

            for (let i = 0; i < count; i++) {
                const card = this._cards[i];
                card.card.set_size(cardWidth, cardHeight);
                card.card.set_position(
                    PADDING + i * (cardWidth + GAP), PADDING);
                card.header.set_size(innerWidth, HEADER_HEIGHT);
                card.body.set_size(innerWidth, bodyHeight);
                if (card.workspace.active)
                    card.card.add_style_class_name('sift-workspace-active');
                else
                    card.card.remove_style_class_name('sift-workspace-active');

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

            const stripWidth =
                PADDING * 2 + count * cardWidth + (count - 1) * GAP;
            this._strip.set_position(
                Math.max(0, Math.floor((width - stripWidth) / 2)), 0);
            this._strip.set_size(stripWidth, height);
            this._syncSelection();
        }

        _syncSelection() {
            for (let i = 0; i < this._cards.length; i++) {
                const card = this._cards[i];
                if (i === this._selected)
                    card.card.add_style_class_name('sift-workspace-selected');
                else
                    card.card.remove_style_class_name('sift-workspace-selected');
            }

            this._scrollSelectedIntoView();
        }

        _scrollSelectedIntoView() {
            const card = this._cards[this._selected];
            const adjustment = this._scroll.hadjustment;
            if (!card || !adjustment || adjustment.page_size <= 0)
                return;

            const left = card.card.x;
            const right = left + card.card.width;
            if (left < adjustment.value)
                adjustment.value = left;
            else if (right > adjustment.value + adjustment.page_size)
                adjustment.value = right - adjustment.page_size;
        }

        _scheduleReload() {
            if (!this._open || this._reloadId)
                return;

            this._reloadId = GLib.idle_add_once(GLib.PRIORITY_DEFAULT, () => {
                this._reloadId = 0;
                if (this._open)
                    this._rebuild();
            });
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
            this._clear();
            super.destroy();
        }
    });
