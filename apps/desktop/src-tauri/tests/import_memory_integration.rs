use opensekai_desktop_lib::assets::{pack_scene, Limits};
use std::alloc::{GlobalAlloc, Layout, System};
use std::sync::atomic::{AtomicUsize, Ordering};
// Real file read and packer (#152): a counting allocator measures the peak heap of `pack_scene` for a GLB root.
// Keep this the only test in this binary, so no other test allocates during the measurement.

struct Counting;
static CURRENT: AtomicUsize = AtomicUsize::new(0);
static PEAK: AtomicUsize = AtomicUsize::new(0);
unsafe impl GlobalAlloc for Counting {
    unsafe fn alloc(&self, layout: Layout) -> *mut u8 {
        let pointer = unsafe { System.alloc(layout) };
        if !pointer.is_null() {
            let now = CURRENT.fetch_add(layout.size(), Ordering::SeqCst) + layout.size();
            PEAK.fetch_max(now, Ordering::SeqCst);
        }
        pointer
    }
    unsafe fn dealloc(&self, pointer: *mut u8, layout: Layout) {
        unsafe { System.dealloc(pointer, layout) };
        CURRENT.fetch_sub(layout.size(), Ordering::SeqCst);
    }
    unsafe fn realloc(&self, pointer: *mut u8, layout: Layout, size: usize) -> *mut u8 {
        // Count a move as both blocks alive, as the copy needs.
        let moved = unsafe { System.realloc(pointer, layout, size) };
        if !moved.is_null() {
            let now = CURRENT.fetch_add(size, Ordering::SeqCst) + size;
            PEAK.fetch_max(now, Ordering::SeqCst);
            CURRENT.fetch_sub(layout.size(), Ordering::SeqCst);
        }
        moved
    }
}
#[global_allocator]
static ALLOCATOR: Counting = Counting;

fn glb(bin_bytes: usize) -> Vec<u8> {
    let mut json = serde_json::to_vec(&serde_json::json!({
        "asset": {"version": "2.0"},
        "buffers": [{"byteLength": bin_bytes}],
        "bufferViews": [{"buffer": 0, "byteLength": bin_bytes / 2}, {"buffer": 0, "byteOffset": bin_bytes / 2, "byteLength": bin_bytes / 2}]
    }))
    .unwrap();
    while !json.len().is_multiple_of(4) {
        json.push(b' ');
    }
    let total = 20 + json.len() + 8 + bin_bytes;
    let mut bytes = Vec::with_capacity(total);
    bytes.extend(b"glTF");
    bytes.extend(2u32.to_le_bytes());
    bytes.extend((total as u32).to_le_bytes());
    bytes.extend((json.len() as u32).to_le_bytes());
    bytes.extend(0x4e4f534au32.to_le_bytes());
    bytes.extend(json);
    bytes.extend((bin_bytes as u32).to_le_bytes());
    bytes.extend(0x004e4942u32.to_le_bytes());
    bytes.resize(total, 7);
    bytes
}

#[test]
fn glb_root_import_peak_is_about_two_times_the_file() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("large.glb");
    let size = {
        let bytes = glb(128 << 20);
        std::fs::write(&path, &bytes).unwrap();
        bytes.len()
    };
    let before = CURRENT.load(Ordering::SeqCst);
    PEAK.store(before, Ordering::SeqCst);
    let packed = pack_scene(&path, Limits::DEFAULT).unwrap();
    let peak = PEAK.load(Ordering::SeqCst) - before;
    let ratio = peak as f64 / size as f64;
    println!("pack_scene peak heap: {peak} bytes for a {size} byte GLB root ({ratio:.3} N)");
    assert!(packed.glb.len().abs_diff(size) < 256, "the packed GLB keeps the BIN and changes only the JSON");
    assert!(ratio <= 2.05, "peak heap {ratio:.3} N is over about 2 N");
}
