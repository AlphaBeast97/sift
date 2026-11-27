UUID := sift@alphabeast97.github.io
SCHEMA := schemas/org.gnome.shell.extensions.sift.gschema.xml
PREFIX ?= $(HOME)/.local

.PHONY: test test-gjs test-rust test-schema test-shell check-pack ci-image test-shell-container lint build daemon extension perf resources

test-gjs:
	gjs -m extension/tests/unit/all.js

test-rust:
	@tmp=$$(mktemp -d); trap 'rm -rf "$$tmp"' EXIT; \
	XDG_DATA_HOME="$$tmp" dbus-run-session -- cargo test --manifest-path daemon/Cargo.toml

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
	gnome-extensions pack extension --schema=$(SCHEMA) --extra-source=src --extra-source=icons -o dist --force

test-shell: build
	tools/test/run-shell-test.sh

# Regenerates the numbers in the README Performance section.
perf: extension
	cargo test --release --manifest-path daemon/Cargo.toml benchmark_query_latency -- --ignored --nocapture
	SIFT_SCRIPT="$(CURDIR)/tools/perf/shell.js" tools/test/run-shell-test.sh

# Writes the release resource report used to diff one release against the next.
resources: extension
	rm -f dist/resource-report.json
	SIFT_RESOURCE_REPORT="$(CURDIR)/dist/resource-report.json" \
	SIFT_SCRIPT="$(CURDIR)/tools/perf/resources.js" tools/test/run-shell-test.sh
	@test -s dist/resource-report.json

ci-image:
	docker build -t sift-gnome51:local tools/ci/gnome51

test-shell-container:
	docker run --rm \
		--user "$$(id -u):$$(id -g)" \
		-v /etc/passwd:/etc/passwd:ro \
		-v /etc/group:/etc/group:ro \
		-e HOME=/tmp \
		-e XDG_RUNTIME_DIR=/tmp/sift-runtime \
		-v "$(CURDIR):/src" -w /src \
		sift-gnome51:local \
		sh -c 'mkdir -p /tmp/sift-runtime && chmod 700 /tmp/sift-runtime && make test-shell'

check-pack: extension
	python3 tools/test/check_pack.py

test: test-gjs test-schema test-rust lint

.PHONY: release install prefs uninstall

release: build
	install -m 0755 daemon/target/release/siftd dist/siftd
	cd dist && sha256sum siftd $(UUID).shell-extension.zip > SHA256SUMS

install: release
	packaging/install.sh --prefix "$(PREFIX)"

prefs:
	gnome-extensions prefs $(UUID)

uninstall:
	packaging/install.sh --uninstall --prefix "$(PREFIX)" $(if $(filter 1,$(PURGE)),--purge)
