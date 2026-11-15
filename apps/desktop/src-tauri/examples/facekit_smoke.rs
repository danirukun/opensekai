// A manual smoke run of the FaceKit adapter of this platform (TRK-24 B33). It opens the camera, so
// start the built binary from Terminal.app (the responsible process for the camera permission):
//   direnv exec . cargo build -p opensekai-desktop --example facekit_smoke
//   "$CARGO_TARGET_DIR/debug/examples/facekit_smoke" [--seconds <n>] [--device <id>] [--stop-after-ms <n>]
// It prints counts and timings only, never face values.
use opensekai_desktop_lib::tracking::facekit::{adapter::FaceEvent, platform_adapter};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

#[derive(Default)]
struct Counts {
    faces: AtomicU64,
    no_face: AtomicU64,
    last_inference_ms: Mutex<Option<f64>>,
    dropped: AtomicBool,
    after_drop: AtomicU64,
    faces_after_drop: AtomicU64,
}

fn arg(args: &[String], name: &str) -> Option<String> {
    args.iter()
        .position(|a| a == name)
        .and_then(|i| args.get(i + 1).cloned())
}

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let seconds: u64 = arg(&args, "--seconds")
        .and_then(|v| v.parse().ok())
        .unwrap_or(10);
    let device = arg(&args, "--device").unwrap_or_default();
    let stop_after = arg(&args, "--stop-after-ms")
        .and_then(|v| v.parse().ok())
        .map(Duration::from_millis);
    let adapter = platform_adapter();
    for camera in adapter.cameras() {
        println!("camera {:?} {:?}", camera.device_id, camera.label);
    }
    let counts = Arc::new(Counts::default());
    let started = Instant::now();
    let sink_counts = counts.clone();
    let sink = Arc::new(move |event: FaceEvent| {
        let face = matches!(event, FaceEvent::Face { .. });
        if sink_counts.dropped.load(Ordering::SeqCst) {
            sink_counts.after_drop.fetch_add(1, Ordering::SeqCst);
            if face {
                sink_counts.faces_after_drop.fetch_add(1, Ordering::SeqCst);
            }
        }
        match event {
            FaceEvent::Face { inference_ms, .. } => {
                sink_counts.faces.fetch_add(1, Ordering::SeqCst);
                if let Ok(mut last) = sink_counts.last_inference_ms.lock() {
                    *last = Some(inference_ms);
                }
            }
            FaceEvent::NoFace => {
                sink_counts.no_face.fetch_add(1, Ordering::SeqCst);
            }
            terminal => println!(
                "{:>6} ms terminal {terminal:?}",
                started.elapsed().as_millis()
            ),
        }
    });
    let run = adapter.start(&device, sink);
    let end = stop_after.unwrap_or(Duration::from_secs(seconds));
    while started.elapsed() < end {
        std::thread::sleep((end - started.elapsed().min(end)).min(Duration::from_secs(1)));
        let last = counts.last_inference_ms.lock().ok().and_then(|l| *l);
        println!(
            "{:>6} ms faces {} no_face {} inference_ms {}",
            started.elapsed().as_millis(),
            counts.faces.load(Ordering::SeqCst),
            counts.no_face.load(Ordering::SeqCst),
            last.map_or("unknown".into(), |ms| format!("{ms:.1}")),
        );
    }
    let dropping = Instant::now();
    drop(run);
    counts.dropped.store(true, Ordering::SeqCst);
    println!(
        "{:>6} ms dropped the run in {} ms",
        started.elapsed().as_millis(),
        dropping.elapsed().as_millis()
    );
    std::thread::sleep(Duration::from_secs(2));
    println!(
        "events after drop {} (faces {})",
        counts.after_drop.load(Ordering::SeqCst),
        counts.faces_after_drop.load(Ordering::SeqCst)
    );
}
