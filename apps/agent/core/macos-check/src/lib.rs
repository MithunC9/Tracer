//! Cross-target type check for the macOS capture source, runnable on Linux:
//!
//!   rustup target add aarch64-apple-darwin
//!   cargo clippy --manifest-path apps/agent/core/macos-check/Cargo.toml --target aarch64-apple-darwin -- -D warnings
//!
//! The full tracer-core crate cannot be checked this way because rusqlite (bundled SQLite)
//! and ring compile C code that needs the macOS SDK. This crate pulls in only the pure-Rust
//! modules the macOS source depends on, by path. Type-checking is not testing: the source
//! still needs to be run on a Mac (README "Known limitations").
#![allow(dead_code)]

#[path = "../../src/model.rs"]
pub mod model;
#[path = "../../src/apps.rs"]
pub mod apps;
#[path = "../../src/exclude.rs"]
pub mod exclude;
#[path = "../../src/capture/mod.rs"]
pub mod capture;
#[path = "../../src/secrets.rs"]
pub mod secrets;
