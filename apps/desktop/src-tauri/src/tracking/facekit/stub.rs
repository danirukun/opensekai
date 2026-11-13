// The FaceKit adapter for a platform without FaceKit. Each start reports `unavailable`.
use super::adapter::*;
pub struct StubFaceAdapter;
struct StubRun;
impl FaceRun for StubRun {}
impl FaceAdapter for StubFaceAdapter {
    fn cameras(&self) -> Vec<CameraInfo> {
        vec![]
    }
    fn start(&self, _: &str, sink: FaceSink) -> Box<dyn FaceRun> {
        sink(FaceEvent::Unavailable("FaceKit needs macOS".into()));
        Box::new(StubRun)
    }
}
