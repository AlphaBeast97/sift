// SPDX-License-Identifier: GPL-3.0-or-later
#[allow(dead_code)] // wired into the indexer in the next task
mod config;

fn main() {
    if std::env::args().any(|argument| argument == "--version") {
        println!("siftd {}", env!("CARGO_PKG_VERSION"));
    }
}
