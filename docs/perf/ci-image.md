# Pinned GNOME 51 CI image

`ci-image.yml` builds `tools/ci/gnome51/Dockerfile`; no job uses a stock rolling
tag. The image is `ghcr.io/<owner>/sift-gnome51:gnome51` in GHCR and is consumed
by digest in `shell-smoke.yml`.

## Pin

- Base image: `archlinux:base-20261101.0.620205`
- Snapshot: <https://archive.archlinux.org/repos/2026/11/01/>
- `gnome-shell` 1:51.1-1, `gjs` 2:1.90.1-1, `mesa` 1:26.2.6-1,
  `rust` 1:1.99.1-1, `nodejs` 26.13.0-1, `npm` 12.2.1-1.
- The snapshot dates from the GNOME 51 era; the earlier 2026-10-06 snapshot
  still had GNOME Shell 50.5 and cannot run the extension.

## Local check

```bash
make ci-image
make test-shell-container
```

- Local image: `sift-gnome51:local`, ID `pending`, size `pending`.
- Result: pending.
- Rendering: pending (llvmpipe surfaceless preferred; `xvfb-run` is the
  documented fallback).

## Triggers

Every workflow is manual and owner-only. `CI` and `Shell smoke` run from
`workflow_dispatch`; `CI` also runs on a PR only when the repository owner adds
the `ci` label. `CI image` is dispatched by hand or called by `Shell smoke`.
Every job checks `github.actor == github.repository_owner`; there is no push,
schedule, or automatic PR trigger. `Release` runs when the owner pushes a `v*`
tag.

## GHCR

Not published yet. After the first `CI image` run, record the pushed digest here
and use it in `shell-smoke.yml`; bootstrap the other workflows by running
`CI image` once so the `:gnome51` tag exists.
