// SPDX-License-Identifier: GPL-3.0-or-later
#[allow(dead_code)] // wired into D-Bus in a later task
mod cache;
#[allow(dead_code)] // wired into D-Bus in a later task
mod config;
#[allow(dead_code)] // wired into D-Bus in a later task
mod index;
#[allow(dead_code)] // wired into D-Bus in a later task
mod query;

fn main() {
    if std::env::args().any(|argument| argument == "--version") {
        println!("siftd {}", env!("CARGO_PKG_VERSION"));
    }
}
