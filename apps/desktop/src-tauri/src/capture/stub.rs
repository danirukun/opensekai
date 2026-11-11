// The adapter for platforms without a capture implementation (B31 R12): Linux and Windows.
use super::adapter::*;
pub struct StubAdapter;
impl CaptureAdapter for StubAdapter {
    fn inventory(&self) -> Result<Inventory, CaptureError> {
        Err(CaptureError::Unsupported)
    }
    fn start(&self, _: PlatformTarget, _: StreamConfig) -> Result<StreamHandle, CaptureError> {
        Err(CaptureError::Unsupported)
    }
}
