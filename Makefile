UUID := sift@alphabeast97.github.io
SCHEMA := schemas/org.gnome.shell.extensions.sift.gschema.xml

.PHONY: test test-gjs test-schema lint build

test-gjs:
	gjs -m extension/tests/unit/all.js

test-schema:
	@set -e; tmp=$$(mktemp -d); trap 'rm -rf "$$tmp"' EXIT; \
	glib-compile-schemas --strict --targetdir "$$tmp" extension/schemas; \
	GSETTINGS_SCHEMA_DIR="$$tmp" GSETTINGS_BACKEND=keyfile XDG_CONFIG_HOME="$$tmp" \
		gjs -m extension/tests/unit/schema.js

lint:
	npx eslint extension tools

build:
	mkdir -p dist
	gnome-extensions pack extension --schema=$(SCHEMA) -o dist --force

test: test-gjs test-schema lint
