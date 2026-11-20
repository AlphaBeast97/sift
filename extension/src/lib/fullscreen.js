// SPDX-License-Identifier: GPL-3.0-or-later
export function isFullscreenWindow(window) {
    return window?.is_fullscreen?.() ?? false;
}
