// SPDX-License-Identifier: GPL-3.0-or-later
import Clutter from 'gi://Clutter';
import GObject from 'gi://GObject';
import Pango from 'gi://Pango';
import St from 'gi://St';

const PAGE_STEP = 5;

export const ResultsView = GObject.registerClass(
    class ResultsView extends St.BoxLayout {
        _init({maxRows = 12} = {}) {
            super._init({
                orientation: Clutter.Orientation.VERTICAL,
                style_class: 'sift-results',
                x_expand: true,
                y_expand: true,
            });

            this._maxRows = maxRows;
            this._rows = [];
            this._selected = -1;
            this._onActivate = null;
            this._rowActors = [];

            for (let i = 0; i < 12; i++)
                this._rowActors.push(this._createRow(i));
        }

        _createRow(index) {
            const actor = new St.Button({
                style_class: 'sift-row',
                x_expand: true,
                reactive: true,
                track_hover: true,
                can_focus: false,
                visible: false,
            });

            const content = new St.BoxLayout({
                orientation: Clutter.Orientation.HORIZONTAL,
                style_class: 'sift-row-content',
                x_expand: true,
            });
            const icon = new St.Icon({
                icon_size: 28,
                style_class: 'sift-row-icon',
                icon_name: 'application-x-executable-symbolic',
                y_align: Clutter.ActorAlign.CENTER,
            });
            const text = new St.BoxLayout({
                orientation: Clutter.Orientation.VERTICAL,
                x_expand: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            const title = new St.Label({
                style_class: 'sift-row-title',
                x_expand: true,
                x_align: Clutter.ActorAlign.START,
            });
            const subtitle = new St.Label({
                style_class: 'sift-row-subtitle',
                x_expand: true,
                x_align: Clutter.ActorAlign.START,
            });

            title.clutter_text.ellipsize = Pango.EllipsizeMode.END;
            subtitle.clutter_text.ellipsize = Pango.EllipsizeMode.END;

            text.add_child(title);
            text.add_child(subtitle);
            content.add_child(icon);
            content.add_child(text);
            actor.set_child(content);

            actor.connect('clicked', () => this.activateAt(index));
            actor.connect('notify::hover', () => {
                if (actor.hover)
                    this.select(index);
            });

            this.add_child(actor);
            return {actor, icon, title, subtitle};
        }

        set onActivate(callback) {
            this._onActivate = callback;
        }

        get rows() {
            return this._rows;
        }

        get rowCount() {
            return Math.min(this._rows.length, this._maxRows, this._rowActors.length);
        }

        get selectedIndex() {
            return this._selected;
        }

        get selectedRow() {
            return this._selected >= 0 ? this._rows[this._selected] ?? null : null;
        }

        setRows(rows = []) {
            this._rows = rows;
            const count = this.rowCount;

            for (let i = 0; i < this._rowActors.length; i++) {
                const {actor, icon, title, subtitle} = this._rowActors[i];
                const row = i < count ? rows[i] : null;

                actor.visible = row !== null;
                if (!row)
                    continue;

                title.text = row.title ?? '';
                subtitle.text = row.subtitle ?? '';
                subtitle.visible = Boolean(row.subtitle);
                actor.accessible_name = row.title ?? '';

                if (typeof row.icon === 'string') {
                    icon.gicon = null;
                    icon.icon_name = row.icon;
                } else if (row.icon) {
                    icon.icon_name = null;
                    icon.gicon = row.icon;
                } else {
                    icon.gicon = null;
                    icon.icon_name = 'application-x-executable-symbolic';
                }
            }

            if (this._selected < 0 && count > 0)
                this._selected = 0;
            else if (this._selected >= count)
                this._selected = count > 0 ? 0 : -1;

            this._syncSelection();
        }

        setMaxRows(maxRows) {
            this._maxRows = Math.max(0, Math.min(maxRows, this._rowActors.length));
            this.setRows(this._rows);
        }

        select(index) {
            if (this.rowCount === 0)
                return;

            const next = Math.max(0, Math.min(index, this.rowCount - 1));
            if (next === this._selected)
                return;

            this._selected = next;
            this._syncSelection();
        }

        move(delta) {
            this.select(this._selected + delta);
        }

        page(direction) {
            this.move(direction * PAGE_STEP);
        }

        activateAt(index) {
            this.select(index);
            this.activateSelected({newWindow: false});
        }

        activateSelected({newWindow = false} = {}) {
            const row = this.selectedRow;
            if (row)
                this._onActivate?.(row, {newWindow});
        }

        _syncSelection() {
            for (let i = 0; i < this._rowActors.length; i++) {
                const {actor} = this._rowActors[i];
                const selected = i === this._selected;
                if (selected)
                    actor.add_style_class_name('sift-row-selected');
                else
                    actor.remove_style_class_name('sift-row-selected');
            }
        }
    });
