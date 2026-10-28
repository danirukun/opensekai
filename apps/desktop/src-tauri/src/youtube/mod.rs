//! The YouTube chat integration (B25): link parsing, page and reply parsing, the user settings
//! file, and the client task. Only the host makes these requests; the session gets typed events.
pub mod client;
pub mod link;
pub mod parse;
pub mod settings;
pub use client::{YouTubeConfig, YouTubeHub};
