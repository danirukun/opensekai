fn main() {
    println!("cargo:rerun-if-changed=build.rs");
    let livekit = std::env::var_os("CARGO_FEATURE_LIVEKIT").is_some();
    let macos = std::env::var("CARGO_CFG_TARGET_OS").is_ok_and(|os| os == "macos");
    // libwebrtc's Objective-C categories are dropped from the static archive without -ObjC,
    // and the first peer connection then aborts on an unrecognized selector.
    if livekit && macos {
        println!("cargo:rustc-link-arg-tests=-ObjC");
        println!("cargo:rustc-link-arg-bin=transport-bench=-ObjC");
    }
}
