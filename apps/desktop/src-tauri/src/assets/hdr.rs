//! Radiance HDR (.hdr / .pic) header parser. ENV-02: magic-byte check and size read.
use opensekai_contracts::{invalid, AppError};

/// The result of parsing a Radiance HDR header.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HdrHeader {
    pub width: u32,
    pub height: u32,
}

/// Two accepted magic prefixes for Radiance HDR files.
const MAGIC_RADIANCE: &[u8] = b"#?RADIANCE\n";
const MAGIC_RGBE: &[u8] = b"#?RGBE\n";

pub const MAX_HDR_BYTES: u64 = 128 * 1024 * 1024;

fn fail(reason: &str) -> AppError {
    invalid(format!("HDR image: {reason}"))
}

/// Parses a Radiance HDR file header. Returns width and height. Does not decode pixel data.
pub fn parse_hdr(bytes: &[u8]) -> Result<HdrHeader, AppError> {
    if !bytes.starts_with(MAGIC_RADIANCE) && !bytes.starts_with(MAGIC_RGBE) {
        return Err(fail("unknown type (expected #?RADIANCE or #?RGBE)"));
    }

    // Find the empty line that separates the header from the resolution line.
    let text = std::str::from_utf8(bytes.get(..bytes.len().min(8192)).unwrap_or(b""))
        .map_err(|_| fail("header is not valid UTF-8"))?;

    // The resolution line follows the first blank line in the header.
    let mut found_blank = false;
    for line in text.lines() {
        if found_blank {
            return parse_resolution(line);
        }
        if line.is_empty() {
            found_blank = true;
        }
    }
    Err(fail("no resolution line"))
}

/// Parses `-Y <height> +X <width>` (the most common orientation).
fn parse_resolution(line: &str) -> Result<HdrHeader, AppError> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() != 4 {
        return Err(fail("invalid resolution line"));
    }
    // Accept -Y H +X W (the standard top-down, left-right layout).
    if parts[0] == "-Y" && parts[2] == "+X" {
        let height: u32 = parts[1].parse().map_err(|_| fail("invalid height"))?;
        let width: u32 = parts[3].parse().map_err(|_| fail("invalid width"))?;
        if width == 0 || height == 0 {
            return Err(fail("size is 0"));
        }
        return Ok(HdrHeader { width, height });
    }
    // Accept +X W -Y H (rotated).
    if parts[0] == "+X" && parts[2] == "-Y" {
        let width: u32 = parts[1].parse().map_err(|_| fail("invalid width"))?;
        let height: u32 = parts[3].parse().map_err(|_| fail("invalid height"))?;
        if width == 0 || height == 0 {
            return Err(fail("size is 0"));
        }
        return Ok(HdrHeader { width, height });
    }
    Err(fail("unsupported orientation (expected -Y +X or +X -Y)"))
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use opensekai_contracts::ErrorCode;

    pub fn hdr_bytes(width: u32, height: u32) -> Vec<u8> {
        format!(
            "#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n\n-Y {height} +X {width}\n"
        )
        .into_bytes()
    }

    fn rejects(bytes: &[u8], text: &str) {
        let error = parse_hdr(bytes).unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidInput);
        assert!(
            error.message.contains(text),
            "{} does not contain {text}",
            error.message
        );
    }

    #[test]
    fn reads_standard_header() {
        assert_eq!(
            parse_hdr(&hdr_bytes(1024, 512)).unwrap(),
            HdrHeader {
                width: 1024,
                height: 512
            }
        );
    }

    #[test]
    fn reads_rgbe_magic() {
        let bytes = b"#?RGBE\nFORMAT=32-bit_rle_rgbe\n\n-Y 256 +X 512\n";
        assert_eq!(
            parse_hdr(bytes).unwrap(),
            HdrHeader {
                width: 512,
                height: 256
            }
        );
    }

    #[test]
    fn reads_rotated_orientation() {
        let bytes = b"#?RADIANCE\n\n+X 800 -Y 400\n";
        assert_eq!(
            parse_hdr(bytes).unwrap(),
            HdrHeader {
                width: 800,
                height: 400
            }
        );
    }

    #[test]
    fn rejects_unknown_magic() {
        rejects(b"NOT_HDR\n\n-Y 10 +X 10\n", "unknown type");
    }

    #[test]
    fn rejects_zero_size() {
        rejects(&hdr_bytes(0, 10), "size is 0");
        rejects(&hdr_bytes(10, 0), "size is 0");
    }

    #[test]
    fn rejects_no_resolution() {
        rejects(b"#?RADIANCE\nFORMAT=32-bit_rle_rgbe\n", "no resolution");
    }

    #[test]
    fn rejects_unsupported_orientation() {
        rejects(
            b"#?RADIANCE\n\n+Y 10 +X 10\n",
            "unsupported orientation",
        );
    }
}
