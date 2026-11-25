# Pinned GNOME 51 CI image

`ci-image.yml` builds `tools/ci/gnome51/Dockerfile`; no job uses a stock rolling
tag. The image is `ghcr.io/alphabeast97/sift-gnome51:gnome51` in GHCR and is consumed
by digest in `shell-smoke.yml`.

## Pin

- Base image: `archlinux:base-20261101.0.620205`
- Snapshot: <https://archive.archlinux.org/repos/2026/11/01/>
- `gnome-shell` 1:51.1-1, `gjs` 2:1.90.1-1, `mesa` 1:26.2.6-1,
  `rust` 1:1.99.1-1, `nodejs` 26.13.0-1, `npm` 12.2.1-1.
- Installed packages: `dbus`, `git`, `gnome-shell`, `gsettings-desktop-schemas`,
  `make`, `mesa`, `npm`, `python`, `rust`, `ttf-dejavu`. `rust` supplies gcc and
  clippy; `npm` supplies nodejs; `gnome-shell` supplies gjs and glib2.
  `gnome-terminal` and Xvfb are not installed: the smoke test uses a tiny test
  `.desktop` entry and the headless backend. The missing `adwaita-morning.jpg`
  warning from the perf background is harmless; the shell falls back and still
  starts.
- The snapshot dates from the GNOME 51 era; the earlier 2026-10-06 snapshot
  still had GNOME Shell 50.5 and cannot run the extension.

## Local check

```bash
make ci-image
make test-shell-container
```

- Local image: `sift-gnome51:local`, ID `9a69f977752e`, size 4.02GB, built
  2026-11-14 with the original package set.
- Result: build succeeded locally in 2435s, almost entirely package downloads.
  The lean Dockerfile is validated by `CI image` on GitHub instead of another
  local build.
- Rendering: llvmpipe surfaceless; the manual `Shell smoke` passes.

## Triggers

Every workflow is owner-only. `CI` runs on pushes to `main` and on a pull
request only after the owner adds the `ci` label, or by hand. `Shell smoke` runs
by hand only; it calls `CI image`. `CI image` is dispatched by hand or called by
`Shell smoke`. `Release` runs when the owner pushes a `v*` tag; it runs the
checks first, then builds and publishes the artifacts.

The container `Shell smoke` currently hangs at shell startup: GNOME Shell 51
constructs its screenshot UI during startup, which requests
`org.gnome.Shell.Screencast`, and the recorder service never answers inside the
container. The host `make test-shell` passes, so the job is no longer triggered
on pushes. Treat a container run as experimental until the recorder service is
fixed or stubbed.

## GHCR

- Published as `ghcr.io/alphabeast97/sift-gnome51:gnome51`; `Shell smoke` pulls
  the pushed digest built in the same run. The path is hardcoded lowercase
  because GHCR rejects repository names that contain uppercase letters.
- First GitHub build: 4m15s in `Shell smoke` run 43548590019 (2026-11-14), down
  from 2435s locally. The digest is not recorded because the workflow token has
  no `read:packages` scope.
- First smoke attempt failed before the shell started: `dbus-daemon` could not
  look up the container uid in `/etc/passwd`. The smoke job and
  `make test-shell-container` now mount the host `/etc/passwd` and `/etc/group`
  read-only so any host uid resolves.
- Containers also have no system bus, which GNOME Shell 51 requires; the test
  harness starts a private one and exports `DBUS_SYSTEM_BUS_ADDRESS` when
  `/run/dbus/system_bus_socket` is absent. `make test-shell-container` passes
  with it using the local image.
- `Shell smoke` passes on GitHub in run 43605275298 (2026-11-14): cached image
  job 26s, smoke 3m26s including the Rust build, extension pack, and
  `sift shell smoke ok`.
- `CI` passes on GitHub in run 43605698050: extension job 4m23s (npm ci, lint,
  unit tests, pack), Rust job 2m21s (fmt, clippy, tests).
