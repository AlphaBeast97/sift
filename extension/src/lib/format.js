// SPDX-License-Identifier: GPL-3.0-or-later

export function parentPath(path) {
    const index = path.lastIndexOf('/');
    return index > 0 ? path.slice(0, index) : '/';
}

export function abbreviatePath(path, home) {
    if (!home)
        return path;
    if (path === home)
        return '~';
    if (path.startsWith(`${home}/`))
        return `~${path.slice(home.length)}`;
    return path;
}