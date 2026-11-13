UUID := sift@alphabeast97.github.io
SCHEMA := schemas/org.gnome.shell.extensions.sift.gschema.xml

.PHONY: test test-gjs test-rust test-schema test-shell lint build daemon extension

test-gjs:
	gjs -m extension/tests/unit/all.js

test-rust:
	dbus-run-session -- cargo test --manifest-path daemon/Cargo.toml

test-schema:
	@set -e; tmp=$$(mktemp -d); trap 'rm -rf "$$tmp"' EXIT; \
	glib-compile-schemas --strict --targetdir "$$tmp" extension/schemas; \
	GSETTINGS_SCHEMA_DIR="$$tmp" GSETTINGS_BACKEND=keyfile XDG_CONFIG_HOME="$$tmp" \
		gjs -m extension/tests/unit/schema.js

lint:
	npx eslint extension tools

build: daemon extension

daemon:
	cargo build --release --manifest-path daemon/Cargo.toml

extension:
	mkdir -p dist
	gnome-extensions pack extension --schema=$(SCHEMA) --extra-source=src -o dist --force

test-shell: build
	tools/test/run-shell-test.sh

test: test-gjs test-schema test-rust lint
