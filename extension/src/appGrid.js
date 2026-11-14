// SPDX-License-Identifier: GPL-3.0-or-later
import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';

import * as AppDisplay from 'resource:///org/gnome/shell/ui/appDisplay.js';
import * as IconGrid from 'resource:///org/gnome/shell/ui/iconGrid.js';
import * as PageIndicators from 'resource:///org/gnome/shell/ui/pageIndicators.js';

import {gridLayout, moveSelection, pageSelection} from './lib/gridMath.js';

const CHUNK_SIZE = 30;

export const AppGrid = GObject.registerClass(
    class AppGrid extends St.BoxLayout {
        _init({apps = null, iconSize = 96, settings = null, onActivate = null} = {}) {
            super._init({
                orientation: Clutter.Orientation.VERTICAL,
                style_class: 'sift-app-grid',
                x_expand: true,
                y_expand: true,
            });

            this._apps = apps;
            this._settings = settings;
            this._onActivate = onActivate;
            this._iconSize = iconSize;
            this._records = [];
            this._tiles = [];
            this._selected = 0;
            this._columns = 6;
            this._rows = 4;
            this._dirty = true;
            this._needsBuild = false;
            this._buildIndex = 0;
            this._chunkId = 0;
            this._mapId = 0;

            const padding = new Clutter.Margin({
                left: 24,
                right: 24,
                top: 24,
                bottom: 24,
            });
            this._grid = new IconGrid.IconGrid({
                allow_incomplete_pages: true,
                page_padding: padding,
                column_spacing: 12,
                row_spacing: 12,
            });
            this._grid.setGridModes([{rows: this._rows, columns: this._columns}]);
            this._grid.layout_manager.fixed_icon_size = iconSize;
            this._grid.layout_manager.columns_per_page = this._columns;
            this._grid.layout_manager.rows_per_page = this._rows;

            this._scroll = new St.ScrollView({
                style_class: 'sift-app-grid-scroll',
                x_expand: true,
                y_expand: true,
                hscrollbar_policy: St.PolicyType.EXTERNAL,
                vscrollbar_policy: St.PolicyType.NEVER,
                child: this._grid,
            });
            this.add_child(this._scroll);

            this._indicators = new PageIndicators.PageIndicators(
                Clutter.Orientation.HORIZONTAL);
            this._indicators.connect('page-activated',
                (_indicators, page) => this.goToPage(page));
            this.add_child(this._indicators);

            this._grid.connect('pages-changed', () => this._syncPages());
            this._grid.connect('notify::allocation', () => this._layout());
        }

        get itemCount() {
            return this._records.length;
        }

        get selectedIndex() {
            return this._selected;
        }

        get iconSize() {
            return this._iconSize;
        }

        setApps(records = []) {
            this._records = records;
            this._selected = Math.min(this._selected,
                Math.max(0, records.length - 1));
            this._needsBuild = true;

            if (this.mapped)
                this._build();
        }

        setIconSize(size) {
            if (size === this._iconSize)
                return;

            this._iconSize = size;
            this._grid.layout_manager.fixed_icon_size = size;
            for (const tile of this._tiles) {
                tile.icon.setIconSize(size);
                tile.queue_relayout();
            }
            this._grid.queue_relayout();
            this._layout();
        }

        invalidate() {
            this._dirty = true;
        }

        open() {
            if (this._dirty) {
                this.setApps(this._apps ? this._apps.gridApps() : []);
                this._dirty = false;
            }

            if (this._needsBuild)
                this._startBuild();

            this._selected = 0;
            this._layout();
            this._applySelection();
        }

        close() {
            if (this._chunkId) {
                this._cancelChunks();
                this._needsBuild = true;
            }
            this._tiles[this._selected]?.setForcedHighlight(false);
        }

        select(index) {
            if (this.itemCount === 0)
                return;

            this._selected = Math.min(Math.max(index, 0), this.itemCount - 1);
            this._applySelection();
        }

        moveSelection(dx, dy) {
            this.select(moveSelection(this._selected, dx, dy,
                this.itemCount, this._columns));
        }

        page(direction) {
            this.select(pageSelection(this._selected, direction, this.itemCount,
                this._columns, this._rows));
        }

        activateSelected({newWindow = false} = {}) {
            const record = this._records[this._selected];
            if (record)
                this._onActivate?.(record, {newWindow});
        }

        goToPage(page, animate = true) {
            if (page < 0 || page >= this._grid.nPages)
                return;

            this._grid.goToPage(page, animate && this._animationsEnabled());
            this._indicators.setCurrentPosition(page);
        }

        destroy() {
            this._cancelChunks();
            this._tiles = [];
            super.destroy();
        }

        _build() {
            this._cancelChunks();

            for (const tile of this._tiles)
                tile.destroy();
            this._tiles = [];
            this._buildIndex = 0;
            this._needsBuild = false;
            this._layout();

            if (this._records.length === 0) {
                this._syncPages();
                return;
            }

            this._chunkId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE,
                () => this._addChunk());
        }

        _startBuild() {
            if (this.mapped) {
                this._build();
                return;
            }

            if (this._mapId)
                return;

            this._mapId = this.connect('map', () => {
                this._mapId = 0;
                if (this._needsBuild)
                    this._build();
            });
        }

        _addChunk() {
            const end = Math.min(this._buildIndex + CHUNK_SIZE,
                this._records.length);

            for (; this._buildIndex < end; this._buildIndex++) {
                const record = this._records[this._buildIndex];
                const tile = new AppDisplay.AppIcon(record.app, {
                    isDraggable: false,
                    expandTitleOnHover: false,
                });
                tile.can_focus = false;
                tile.popupMenu = () => {};
                tile.accessible_name = record.name;
                this._grid.appendItem(tile);
                tile.icon.setIconSize(this._iconSize);
                tile.queue_relayout();
                this._tiles.push(tile);
            }

            this._layout();
            this._syncPages();
            this._applySelection();

            if (this._buildIndex < this._records.length)
                return GLib.SOURCE_CONTINUE;

            this._chunkId = 0;
            return GLib.SOURCE_REMOVE;
        }

        _cancelChunks() {
            if (this._chunkId) {
                GLib.source_remove(this._chunkId);
                this._chunkId = 0;
            }
        }

        _layout() {
            const manager = this._grid.layout_manager;
            const width = manager.pageWidth;
            const height = manager.pageHeight;
            if (width <= 0 || height <= 0)
                return;

            const cell = Math.max(this._cellSize(), this._iconSize);
            const layout = gridLayout(width, height, cell,
                this.itemCount, {
                    columnSpacing: manager.columnSpacing,
                    rowSpacing: manager.rowSpacing,
                    padding: manager.pagePadding,
                });
            if (layout.columns === this._columns && layout.rows === this._rows)
                return;

            this._columns = layout.columns;
            this._rows = layout.rows;
            this._grid.setGridModes([{rows: layout.rows, columns: layout.columns}]);
            manager.columns_per_page = layout.columns;
            manager.rows_per_page = layout.rows;
            this._repage();
        }

        // The icon grid sizes cells from the whole tile (icon plus label), not
        // from the icon alone, so capacity has to measure the tiles.
        _cellSize() {
            let cell = 0;
            for (const tile of this._tiles) {
                cell = Math.max(cell,
                    tile.get_preferred_width(-1)[0],
                    tile.get_preferred_height(-1)[0]);
            }
            return cell > 0 ? cell : this._iconSize;
        }

        // Changing the page capacity leaves existing pages at the old size,
        // which makes overflowing icons draw over the next page.
        _repage() {
            if (this._tiles.length === 0)
                return;

            for (const tile of this._tiles)
                this._grid.removeItem(tile);
            for (const tile of this._tiles) {
                this._grid.appendItem(tile);
                // Appending makes the layout manager reapply its cached icon
                // size, which may predate a live size change.
                tile.icon.setIconSize(this._iconSize);
                tile.queue_relayout();
            }
        }

        _applySelection() {
            for (let i = 0; i < this._tiles.length; i++)
                this._tiles[i].setForcedHighlight(i === this._selected);

            const pageSize = this._columns * this._rows;
            this.goToPage(Math.floor(this._selected / pageSize));
        }

        _syncPages() {
            const pages = this._grid.nPages;
            this._indicators.setNPages(pages);
            this._indicators.setCurrentPosition(this._grid.currentPage);

            const dots = this._indicators.get_children();
            for (let i = 0; i < dots.length; i++)
                dots[i].accessible_name = `Page ${i + 1}`;
        }

        _animationsEnabled() {
            return St.Settings.get().enable_animations &&
                (this._settings?.get_boolean('animations') ?? true);
        }
    });
