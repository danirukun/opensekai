#![forbid(unsafe_code)]
mod captures;
mod runs;
pub use captures::CaptureStore;
use opensekai_contracts::{AppError, ErrorCode};
pub use runs::RunManager;
fn error(code: ErrorCode, message: &str) -> AppError {
    AppError {
        code,
        message: message.into(),
        ids: vec![],
    }
}
