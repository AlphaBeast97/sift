// SPDX-License-Identifier: GPL-3.0-or-later
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Soup from 'gi://Soup?version=3.0';

import {
    isNewer,
    parseChecksums,
    RELEASE_API,
    releaseAssets,
} from './lib/update.js';

const UUID = 'sift@alphabeast97.github.io';
const ZIP = `${UUID}.shell-extension.zip`;
const ASSETS = ['install.sh', 'sift.sh', 'SHA256SUMS', 'siftd', ZIP];
const CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;
const USER_AGENT = 'sift-updater';

export function updateCachePath() {
    return GLib.build_filenamev([
        GLib.get_user_state_dir(), 'sift', 'update.json',
    ]);
}

function readCache() {
    try {
        const [ok, data] = GLib.file_get_contents(updateCachePath());
        if (!ok)
            return null;
        const parsed = JSON.parse(new TextDecoder().decode(data));
        return typeof parsed?.last === 'number' ? parsed : null;
    } catch {
        return null;
    }
}

function writeCache(tag) {
    try {
        const path = updateCachePath();
        GLib.mkdir_with_parents(GLib.path_get_dirname(path), 0o700);
        GLib.file_set_contents(path,
            JSON.stringify({last: Date.now(), tag}));
        GLib.chmod(path, 0o600);
    } catch {
        // A failed cache write must not break the update check.
    }
}

function readBytes(path) {
    const [ok, data] = GLib.file_get_contents(path);
    if (!ok)
        throw new Error(`Could not read ${path}`);
    return data;
}

export class Updater {
    constructor({currentVersion, onState}) {
        this._current = currentVersion;
        this._onState = onState ?? (() => {});
        this._session = new Soup.Session();
        this._cancellable = new Gio.Cancellable();
        this._release = null;
        this._checking = false;
        this._installing = false;
    }

    destroy() {
        this._cancellable.cancel();
        this._session.abort();
    }

    _state(state, message, extra = {}) {
        this._onState({state, message, ...extra});
    }

    checkIfDue() {
        const cache = readCache();
        if (cache && Date.now() - cache.last < CHECK_INTERVAL_MS)
            return;
        this.check({quiet: true, cache: true});
    }

    check({quiet = false, cache = false} = {}) {
        if (this._checking)
            return;
        this._checking = true;
        if (!quiet)
            this._state('checking', 'Checking for updates…');

        const message = Soup.Message.new('GET', RELEASE_API);
        if (!message) {
            this._checking = false;
            this._state('error', 'Could not create the update request.');
            return;
        }
        message.request_headers.append('Accept', 'application/vnd.github+json');
        message.request_headers.append('User-Agent', USER_AGENT);

        this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT,
            this._cancellable, (session, result) => {
                this._checking = false;
                try {
                    const bytes = session.send_and_read_finish(result);
                    if (message.status_code !== Soup.Status.OK)
                        throw new Error(`GitHub returned HTTP ${message.status_code}`);
                    const release = JSON.parse(
                        new TextDecoder().decode(bytes.get_data()));
                    this._release = release;
                    const tag = release.tag_name;
                    if (!tag)
                        throw new Error('The release has no tag.');
                    if (cache)
                        writeCache(tag);
                    if (isNewer(tag, this._current)) {
                        this._state('available',
                            `Sift ${tag} is available (installed: ${this._current}).`,
                            {tag});
                    } else if (!quiet) {
                        this._state('current',
                            `Sift ${this._current} is up to date.`);
                    }
                } catch (error) {
                    if (!this._cancellable.is_cancelled() && !quiet)
                        this._state('error', `Update check failed: ${error.message}`);
                }
            });
    }

    install() {
        if (this._installing || !this._release)
            return;
        const tag = this._release.tag_name;
        const assets = releaseAssets(this._release);
        const missing = ASSETS.filter(name => !assets.has(name));
        if (missing.length > 0) {
            this._state('error', `Release ${tag} is missing: ${missing.join(', ')}`);
            return;
        }

        this._installing = true;
        const safeTag = String(tag).replace(/[^0-9A-Za-z._-]/gu, '_');
        const dir = GLib.build_filenamev([
            GLib.get_user_cache_dir(), 'sift', `update-${safeTag}`,
        ]);
        try {
            GLib.mkdir_with_parents(dir, 0o700);
        } catch (error) {
            this._installing = false;
            this._state('error', `Could not create the update folder: ${error.message}`);
            return;
        }

        this._download(assets, dir, 0, error => {
            if (error) {
                this._installing = false;
                this._cleanup(dir);
                this._state('error', `Update failed: ${error.message}`);
                return;
            }

            try {
                this._verify(dir);
            } catch (verifyError) {
                this._installing = false;
                this._cleanup(dir);
                this._state('error', `Update failed: ${verifyError.message}`);
                return;
            }

            this._runInstaller(dir, tag);
        });
    }

    _download(assets, dir, index, done) {
        if (index >= ASSETS.length) {
            done(null);
            return;
        }

        const name = ASSETS[index];
        this._state('downloading',
            `Downloading ${name} (${index + 1}/${ASSETS.length})…`);

        const message = Soup.Message.new('GET', assets.get(name));
        if (!message) {
            done(new Error(`Could not create a request for ${name}`));
            return;
        }
        message.request_headers.append('User-Agent', USER_AGENT);

        this._session.send_and_read_async(message, GLib.PRIORITY_DEFAULT,
            this._cancellable, (session, result) => {
                try {
                    const bytes = session.send_and_read_finish(result);
                    if (message.status_code !== Soup.Status.OK)
                        throw new Error(`HTTP ${message.status_code} for ${name}`);
                    GLib.file_set_contents(GLib.build_filenamev([dir, name]),
                        bytes.get_data());
                    this._download(assets, dir, index + 1, done);
                } catch (error) {
                    done(error);
                }
            });
    }

    _verify(dir) {
        const sums = parseChecksums(
            new TextDecoder().decode(readBytes(GLib.build_filenamev([dir, 'SHA256SUMS']))));
        for (const name of ASSETS) {
            if (name === 'SHA256SUMS')
                continue;
            const expected = sums.get(name);
            if (!expected)
                throw new Error(`SHA256SUMS has no entry for ${name}`);
            const actual = GLib.compute_checksum_for_data(
                GLib.ChecksumType.SHA256,
                readBytes(GLib.build_filenamev([dir, name])));
            if (actual !== expected)
                throw new Error(`Checksum mismatch for ${name}`);
        }
    }

    _runInstaller(dir, tag) {
        this._state('installing', `Installing Sift ${tag}…`);
        const argv = [
            'bash',
            GLib.build_filenamev([dir, 'install.sh']),
            '--binary', GLib.build_filenamev([dir, 'siftd']),
            '--extension-zip', GLib.build_filenamev([dir, ZIP]),
        ];

        let proc;
        try {
            proc = Gio.Subprocess.new(argv,
                Gio.SubprocessFlags.STDOUT_PIPE |
                Gio.SubprocessFlags.STDERR_PIPE);
        } catch (error) {
            this._installing = false;
            this._cleanup(dir);
            this._state('error', `Could not start the installer: ${error.message}`);
            return;
        }

        proc.communicate_utf8_async(null, this._cancellable, (source, result) => {
            this._installing = false;
            try {
                const [, stdout, stderr] =
                    source.communicate_utf8_finish(result);
                if (!source.get_successful())
                    throw new Error(stderr.trim() || stdout.trim() ||
                        'the installer exited with an error');
                writeCache(tag);
                this._cleanup(dir);
                this._state('done',
                    `Sift ${tag} is installed. Log out and back in on Wayland to load it.`);
            } catch (error) {
                this._cleanup(dir);
                this._state('error', `Update failed: ${error.message}`);
            }
        });
    }

    _cleanup(dir) {
        try {
            Gio.Subprocess.new(['rm', '-rf', dir],
                Gio.SubprocessFlags.NONE).wait_check(null);
        } catch {
            // The cache is disposable.
        }
    }
}
