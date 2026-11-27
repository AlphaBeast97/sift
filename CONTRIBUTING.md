# Contributing to Sift

Thanks for helping improve Sift. Bug reports, accessibility reports, and focused
pull requests are all welcome.

## Before you start

- Open an issue before a large change so the approach can be discussed.
- Keep pull requests focused. Unrelated refactors and formatting changes make a
  change harder to review.
- Report security problems privately as described in [SECURITY.md](SECURITY.md),
  not in a public issue.
- By participating you agree to the [Code of Conduct](CODE_OF_CONDUCT.md).

## Requirements

Sift targets **GNOME Shell 51** only. It runs in the user session on Wayland or
X11 and needs a session bus.

| Purpose | Debian/Ubuntu | Fedora | Arch | openSUSE |
| --- | --- | --- | --- | --- |
| Shell, GJS, GLib tools | `gnome-shell gjs libglib2.0-bin` | `gnome-shell gjs glib2` | `gnome-shell gjs glib2` | `gnome-shell gjs glib2-tools` |
| Tests and lint | `nodejs npm` | `nodejs npm` | `nodejs npm` | `nodejs npm` |
| Rust daemon | [rustup](https://rustup.rs/) | rustup | rustup | rustup |

The repository pins Rust 1.99.1 in `rust-toolchain.toml`; rustup installs it
automatically.

## Set up

```bash
git clone https://github.com/AlphaBeast97/sift.git
cd sift
npm ci
make test
```

Install the current checkout with `make install`. The installer writes only
under `~/.local`, uses D-Bus activation, and never needs root or the network.

## Checks

Run the checks that match your change before opening a pull request:

```bash
make test          # GJS unit tests, schema, Rust tests, eslint
make check-pack    # metadata, schema, and extension zip sanity
make test-shell    # headless GNOME Shell smoke test
SIFT_E2E=1 make test-shell   # daemon and file-search end-to-end test
```

`make test-shell` needs a working GNOME Shell 51 installation. On Wayland, log
out and back in after installing a new build so the shell rescans extensions.

## Layout

| Path | Contents |
| --- | --- |
| `extension/` | GJS shell extension, preferences, schema, and unit tests |
| `extension/src/` | Search overlay, app grid, workspace view, and glass renderer |
| `daemon/` | Rust file index and D-Bus service (`siftd`) |
| `tools/test/` | Headless shell harness and packaging checks |
| `tools/perf/` | Shell and daemon benchmarks |
| `packaging/` | User installer and D-Bus service template |

## Style

- JavaScript uses 4-space indentation and is checked by ESLint.
- Rust is checked by `cargo fmt` and `cargo clippy -D warnings`.
- Prefer the existing helpers and patterns over new abstractions.
- Keep user-facing text short and plain.
- Add a test for new non-trivial logic. Shell behavior belongs in
  `tools/test/headless.js`; pure logic belongs in `extension/tests/unit/`.
- Do not add a runtime dependency without discussing it first.

## Commits and pull requests

- Write a short imperative subject, for example `fix: keep minimized windows
  on their workspace card`.
- Explain the why in the body when it is not obvious.
- Update the README or preferences help when behavior changes.
- Include a screenshot or recording for visible UI changes.
- List the checks you ran in the pull request template.

CI is owner-gated: it runs when the owner pushes to `main`, adds the `ci` label
to a pull request, or dispatches the workflow manually. A maintainer will run it
for your pull request.

## Releases

Releases use `vMAJOR.MINOR.PATCH` tags. Before tagging:

1. Update `version` in `package.json`, `version-name` in
   `extension/metadata.json`, and `CHANGELOG.md`.
2. Add `docs/release-notes/<version>.md`.
3. Run `make test check-pack` and `make test-shell`.
4. Run `make release` and verify `dist/SHA256SUMS`.
5. Run `make packages` and install at least the package for your distro to
   check the system-wide paths. `nfpm` is required.
6. Push `main`, then push the tag. The release workflow builds the portable
   daemon, `.deb`, `.rpm`, and Arch packages, runs the checks, and attaches the
   installer, daemon, extension zip, license, notices, and checksums.
