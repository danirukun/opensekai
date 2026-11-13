// Real system boundary: AppleCVA is loaded at run time, and `Create` makes and releases a real
// FaceKit tracker (TRK-24 B33). No camera opens. On another platform the test is reported as ignored.
#[test]
#[cfg_attr(not(target_os = "macos"), ignore = "FaceKit needs macOS")]
fn loads_applecva_and_creates_a_tracker() {
    #[cfg(target_os = "macos")]
    {
        use opensekai_desktop_lib::tracking::facekit::{mapping::FACEKIT_NAMES, probe, probe_at};
        let found = probe().expect("FaceKit start-up check");
        assert!(found.api_version > 0);
        assert_eq!(found.names, FACEKIT_NAMES);
        println!("FaceKit API version {}", found.api_version);
        assert_eq!(
            probe_at("/System/Library/PrivateFrameworks/Missing.framework/Missing")
                .err()
                .as_deref(),
            Some("FaceKit library not found")
        );
    }
}
