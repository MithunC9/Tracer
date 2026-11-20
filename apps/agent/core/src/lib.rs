//! Tracer agent core. Platform-independent; no Tauri/WebKit dependency.
//!
//! Data path (in this order, nothing skips a step):
//! capture source -> [`exclude`] -> [`redact`] -> AppKey -> [`pipeline`] (ActivityEvent)
//! -> [`buffer`] (AES-256-GCM at rest) -> [`uploader`] (idempotent batches) -> API.

pub mod agent;
pub mod api;
pub mod apps;
pub mod buffer;
pub mod capture;
pub mod exclude;
pub mod model;
pub mod pairing;
pub mod pipeline;
pub mod redact;
pub mod secrets;
pub mod uploader;

pub use agent::{Agent, AgentStatus, Mode, TodayView};
pub use model::{ActivityEvent, AgentConfig, Exclusions, Platform, RawSample};
