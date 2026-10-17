//! Camera screenshots. The Scene window renders the PNG; the host checks it, makes the file
//! name, and writes it under `<app local data>/screenshots/`. No caller gives a path.
use chrono::{DateTime, Utc};
use opensekai_contracts::{AppError, ErrorCode, MAX_SCREENSHOT_PNG_BYTES};
use sha2::{Digest, Sha256};
use std::{
    fs::OpenOptions,
    io::{ErrorKind, Write},
    path::{Path, PathBuf},
};

pub const WIDTH: u32 = 1920;
pub const HEIGHT: u32 = 1080;
const SIGNATURE: [u8; 8] = [0x89, b'P', b'N', b'G', b'\r', b'\n', 0x1a, b'\n'];

fn error(code: ErrorCode, message: &str) -> AppError {
    AppError {
        code,
        message: message.into(),
        ids: vec![],
    }
}

/// The screenshot folder below the app local data folder.
pub fn folder(app_local_data: &Path) -> PathBuf {
    app_local_data.join("screenshots")
}

/// The camera ID with only `[A-Za-z0-9_-]`, at most 64 characters, or `camera` when nothing is left.
pub fn camera_part(camera_id: &str) -> String {
    let part: String = camera_id
        .chars()
        .filter(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-'))
        .take(64)
        .collect();
    if part.is_empty() {
        "camera".into()
    } else {
        part
    }
}

/// `<UTC yyyyMMdd-HHmmss-SSS>-<camera part>`, without the extension.
pub fn file_stem(time: DateTime<Utc>, camera_id: &str) -> String {
    format!(
        "{}-{}",
        time.format("%Y%m%d-%H%M%S-%3f"),
        camera_part(camera_id)
    )
}

/// Checks the byte limit, the PNG signature, and the IHDR size (1920 × 1080).
pub fn check_png(png: &[u8]) -> Result<(), AppError> {
    if png.len() > MAX_SCREENSHOT_PNG_BYTES {
        return Err(error(
            ErrorCode::InvalidInput,
            "Screenshot PNG exceeds 8 MiB",
        ));
    }
    let header_ok = png.len() >= 24
        && png[..8] == SIGNATURE
        && png[8..12] == 13u32.to_be_bytes()
        && &png[12..16] == b"IHDR";
    if !header_ok {
        return Err(error(ErrorCode::InvalidInput, "Screenshot is not a PNG"));
    }
    let width = u32::from_be_bytes([png[16], png[17], png[18], png[19]]);
    let height = u32::from_be_bytes([png[20], png[21], png[22], png[23]]);
    if (width, height) != (WIDTH, HEIGHT) {
        return Err(error(
            ErrorCode::InvalidInput,
            "Screenshot is not 1920 x 1080",
        ));
    }
    Ok(())
}

pub fn sha256_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// Writes `png` as `<stem>.png` with create-new. When that name exists, it tries `<stem>-1.png`
/// to `<stem>-9.png`, then fails with `BUSY`. It never replaces a file. Returns the file name.
pub fn write_new(folder: &Path, stem: &str, png: &[u8]) -> Result<String, AppError> {
    let unavailable = || error(ErrorCode::Unavailable, "Cannot write screenshot");
    std::fs::create_dir_all(folder).map_err(|_| unavailable())?;
    for n in 0..=9 {
        let name = if n == 0 {
            format!("{stem}.png")
        } else {
            format!("{stem}-{n}.png")
        };
        let path = folder.join(&name);
        let mut file = match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(file) => file,
            Err(e) if e.kind() == ErrorKind::AlreadyExists => continue,
            Err(_) => return Err(unavailable()),
        };
        if file.write_all(png).and_then(|()| file.sync_all()).is_err() {
            drop(file);
            let _ = std::fs::remove_file(&path);
            return Err(unavailable());
        }
        return Ok(name);
    }
    Err(error(ErrorCode::Busy, "Screenshot name is in use"))
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;
    use opensekai_contracts::screenshot_file_name_ok;

    fn png(width: u32, height: u32) -> Vec<u8> {
        let mut out = Vec::new();
        let mut encoder = png::Encoder::new(&mut out, width, height);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().unwrap();
        writer
            .write_image_data(&vec![0; (width * height * 4) as usize])
            .unwrap();
        drop(writer);
        out
    }

    #[test]
    fn camera_part_keeps_only_safe_characters() {
        assert_eq!(camera_part("camera_main"), "camera_main");
        assert_eq!(camera_part("Cam-2"), "Cam-2");
        assert_eq!(camera_part("../a b/c.png"), "abcpng");
        assert_eq!(camera_part("カメラ"), "camera");
        assert_eq!(camera_part("/\\:."), "camera");
        assert_eq!(camera_part(&"x".repeat(200)), "x".repeat(64));
        assert_eq!(camera_part(&format!("é{}", "y".repeat(70))).len(), 64);
    }

    #[test]
    fn file_stem_is_utc_milliseconds_and_passes_the_contract_rule() {
        let time = Utc.with_ymd_and_hms(2026, 10, 17, 9, 5, 7).unwrap()
            + chrono::Duration::milliseconds(42);
        let stem = file_stem(time, "camera main/1");
        assert_eq!(stem, "20261017-090507-042-cameramain1");
        assert!(screenshot_file_name_ok(&format!("{stem}.png")));
        assert!(screenshot_file_name_ok(&format!("{stem}-9.png")));
        assert!(screenshot_file_name_ok(&format!(
            "{}.png",
            file_stem(time, &"z".repeat(300))
        )));
        assert!(screenshot_file_name_ok(&format!(
            "{}.png",
            file_stem(time, "?")
        )));
    }

    #[test]
    fn check_png_accepts_only_a_1920_by_1080_png_within_the_limit() {
        assert!(check_png(&png(WIDTH, HEIGHT)).is_ok());
        for bad in [
            png(1, 1),
            png(1080, 1920),
            b"GIF89a".to_vec(),
            vec![],
            png(WIDTH, HEIGHT)[..20].to_vec(),
        ] {
            assert_eq!(check_png(&bad).unwrap_err().code, ErrorCode::InvalidInput);
        }
        let mut wrong_chunk = png(WIDTH, HEIGHT);
        wrong_chunk[12..16].copy_from_slice(b"IDAT");
        assert_eq!(
            check_png(&wrong_chunk).unwrap_err().code,
            ErrorCode::InvalidInput
        );
        let mut oversize = png(WIDTH, HEIGHT);
        oversize.resize(MAX_SCREENSHOT_PNG_BYTES + 1, 0);
        assert_eq!(
            check_png(&oversize).unwrap_err().code,
            ErrorCode::InvalidInput
        );
        oversize.truncate(MAX_SCREENSHOT_PNG_BYTES);
        assert!(check_png(&oversize).is_ok());
    }

    #[test]
    fn write_new_never_replaces_a_file_and_stops_after_nine_suffixes() {
        let dir = tempfile::tempdir().unwrap();
        let folder = folder(dir.path());
        assert_eq!(write_new(&folder, "s", b"first").unwrap(), "s.png");
        assert_eq!(write_new(&folder, "s", b"second").unwrap(), "s-1.png");
        for n in 2..=9 {
            assert_eq!(write_new(&folder, "s", b"x").unwrap(), format!("s-{n}.png"));
        }
        assert_eq!(
            write_new(&folder, "s", b"late").unwrap_err().code,
            ErrorCode::Busy
        );
        assert_eq!(std::fs::read(folder.join("s.png")).unwrap(), b"first");
        assert_eq!(std::fs::read(folder.join("s-1.png")).unwrap(), b"second");
        assert_eq!(std::fs::read_dir(&folder).unwrap().count(), 10);
    }

    #[test]
    fn sha256_hex_is_lowercase_hex() {
        assert_eq!(
            sha256_hex(b"abc"),
            "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
        );
    }
}
