//! Signature and header checks for image assets (B28 R4). This module never decodes pixels.
use opensekai_contracts::{invalid, AppError, AssetFormat, AssetImage, MAX_IMAGE_FRAMES};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ImageHeader {
    pub format: AssetFormat,
    /// The display size: after the EXIF orientation for a JPEG.
    pub width: u32,
    pub height: u32,
    pub frames: u32,
}

const PNG_SIGNATURE: &[u8] = b"\x89PNG\r\n\x1a\n";
const JPEG_SCAN_LIMIT: usize = 1024 * 1024;

fn fail(kind: &str, reason: &str) -> AppError {
    invalid(format!("{kind} image: {reason}"))
}
fn slice<'a>(bytes: &'a [u8], start: usize, len: usize, kind: &str) -> Result<&'a [u8], AppError> {
    start
        .checked_add(len)
        .and_then(|end| bytes.get(start..end))
        .ok_or_else(|| fail(kind, "truncated"))
}
fn u16_be(bytes: &[u8], at: usize, kind: &str) -> Result<u16, AppError> {
    let s = slice(bytes, at, 2, kind)?;
    Ok(u16::from_be_bytes([s[0], s[1]]))
}
fn u16_le(bytes: &[u8], at: usize, kind: &str) -> Result<u16, AppError> {
    let s = slice(bytes, at, 2, kind)?;
    Ok(u16::from_le_bytes([s[0], s[1]]))
}
fn u24_le(bytes: &[u8], at: usize, kind: &str) -> Result<u32, AppError> {
    let s = slice(bytes, at, 3, kind)?;
    Ok(u32::from_le_bytes([s[0], s[1], s[2], 0]))
}
fn u32_be(bytes: &[u8], at: usize, kind: &str) -> Result<u32, AppError> {
    let s = slice(bytes, at, 4, kind)?;
    Ok(u32::from_be_bytes([s[0], s[1], s[2], s[3]]))
}
fn u32_le(bytes: &[u8], at: usize, kind: &str) -> Result<u32, AppError> {
    let s = slice(bytes, at, 4, kind)?;
    Ok(u32::from_le_bytes([s[0], s[1], s[2], s[3]]))
}

/// Finds the type from the signature, then reads the size from the header. Every read is bounds-checked.
pub fn parse_image(bytes: &[u8]) -> Result<ImageHeader, AppError> {
    let header = if bytes.starts_with(PNG_SIGNATURE) {
        png(bytes)?
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        jpeg(bytes)?
    } else if bytes.starts_with(b"RIFF") && bytes.get(8..12) == Some(b"WEBP") {
        webp(bytes)?
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        gif(bytes)?
    } else {
        return Err(invalid("Image: unknown type (PNG, JPEG, WebP, or GIF)"));
    };
    let kind = name(&header.format);
    if header.width == 0 || header.height == 0 {
        return Err(fail(kind, "size is 0"));
    }
    if !AssetImage::size_ok(header.width, header.height) {
        return Err(fail(kind, "size is too large"));
    }
    Ok(header)
}
fn name(format: &AssetFormat) -> &'static str {
    match format {
        AssetFormat::Png => "PNG",
        AssetFormat::Jpeg => "JPEG",
        AssetFormat::Webp => "WebP",
        AssetFormat::Gif => "GIF",
        AssetFormat::Glb | AssetFormat::Vrm => "Model",
    }
}

fn png(bytes: &[u8]) -> Result<ImageHeader, AppError> {
    const K: &str = "PNG";
    if bytes.len() < 33 {
        return Err(fail(K, "truncated"));
    }
    if u32_be(bytes, 8, K)? != 13 || &bytes[12..16] != b"IHDR" {
        return Err(fail(K, "first chunk is not IHDR"));
    }
    Ok(ImageHeader {
        format: AssetFormat::Png,
        width: u32_be(bytes, 16, K)?,
        height: u32_be(bytes, 20, K)?,
        frames: 1,
    })
}

fn jpeg(bytes: &[u8]) -> Result<ImageHeader, AppError> {
    const K: &str = "JPEG";
    let scan = &bytes[..bytes.len().min(JPEG_SCAN_LIMIT)];
    let mut pos = 2;
    let mut orientation = None;
    loop {
        if pos >= scan.len() {
            return Err(fail(K, "no size before the end"));
        }
        if scan[pos] != 0xff {
            return Err(fail(K, "invalid marker"));
        }
        while scan.get(pos) == Some(&0xff) {
            pos += 1;
        }
        let marker = *scan
            .get(pos)
            .ok_or_else(|| fail(K, "no size before the end"))?;
        pos += 1;
        match marker {
            0xd0..=0xd8 | 0x01 => continue,
            0xda => return Err(fail(K, "no size before the scan")),
            0xd9 | 0x00 => return Err(fail(K, "no size before the end")),
            _ => {}
        }
        let length = usize::from(u16_be(scan, pos, K)?);
        if length < 2 {
            return Err(fail(K, "invalid segment length"));
        }
        let segment = slice(scan, pos, length, K)?;
        if matches!(marker, 0xc0..=0xcf) && !matches!(marker, 0xc4 | 0xc8 | 0xcc) {
            let height = u32::from(u16_be(segment, 3, K)?);
            let width = u32::from(u16_be(segment, 5, K)?);
            let swap = orientation.is_some_and(|o| (5..=8).contains(&o));
            let (width, height) = if swap {
                (height, width)
            } else {
                (width, height)
            };
            return Ok(ImageHeader {
                format: AssetFormat::Jpeg,
                width,
                height,
                frames: 1,
            });
        }
        if marker == 0xe1 && segment.get(2..8) == Some(b"Exif\0\0") && orientation.is_none() {
            orientation = exif_orientation(&segment[8..]);
        }
        pos += length;
    }
}

/// The TIFF Orientation tag (0x0112) of IFD0, when present and valid (1 to 8). Any bad value reads as absent.
fn exif_orientation(tiff: &[u8]) -> Option<u16> {
    let little = match tiff.get(0..2)? {
        b"II" => true,
        b"MM" => false,
        _ => return None,
    };
    let u16_at = |at: usize| -> Option<u16> {
        let s = tiff.get(at..at.checked_add(2)?)?;
        Some(if little {
            u16::from_le_bytes([s[0], s[1]])
        } else {
            u16::from_be_bytes([s[0], s[1]])
        })
    };
    let u32_at = |at: usize| -> Option<u32> {
        let s = tiff.get(at..at.checked_add(4)?)?;
        Some(if little {
            u32::from_le_bytes([s[0], s[1], s[2], s[3]])
        } else {
            u32::from_be_bytes([s[0], s[1], s[2], s[3]])
        })
    };
    if u16_at(2)? != 42 {
        return None;
    }
    let ifd = usize::try_from(u32_at(4)?).ok()?;
    let count = usize::from(u16_at(ifd)?);
    // The first Orientation entry decides, as in `readImageHeader` of the renderer.
    let entry = (0..count)
        .map(|index| ifd.checked_add(2)?.checked_add(index.checked_mul(12)?))
        .find(|entry| entry.and_then(&u16_at) == Some(0x0112))??;
    (u16_at(entry + 2)? == 3)
        .then(|| u16_at(entry + 8))
        .flatten()
        .filter(|value| (1..=8).contains(value))
}

fn webp(bytes: &[u8]) -> Result<ImageHeader, AppError> {
    const K: &str = "WebP";
    let size = u32_le(bytes, 4, K)? as usize;
    if bytes.len() < 8 || size != bytes.len() - 8 {
        return Err(fail(K, "RIFF size does not match the file"));
    }
    let fourcc = slice(bytes, 12, 4, K)?;
    let length = u32_le(bytes, 16, K)? as usize;
    let data = slice(bytes, 20, length, K)?;
    let (width, height) = match fourcc {
        b"VP8 " => {
            if data.get(3..6) != Some(&[0x9d, 0x01, 0x2a][..]) {
                return Err(fail(K, "invalid VP8 start code"));
            }
            (
                u32::from(u16_le(data, 6, K)? & 0x3fff),
                u32::from(u16_le(data, 8, K)? & 0x3fff),
            )
        }
        b"VP8L" => {
            if data.first() != Some(&0x2f) {
                return Err(fail(K, "invalid VP8L signature"));
            }
            let bits = u32_le(data, 1, K)?;
            ((bits & 0x3fff) + 1, ((bits >> 14) & 0x3fff) + 1)
        }
        b"VP8X" => (u24_le(data, 4, K)? + 1, u24_le(data, 7, K)? + 1),
        _ => return Err(fail(K, "unknown first chunk")),
    };
    Ok(ImageHeader {
        format: AssetFormat::Webp,
        width,
        height,
        frames: 1,
    })
}

fn gif(bytes: &[u8]) -> Result<ImageHeader, AppError> {
    const K: &str = "GIF";
    let width = u32::from(u16_le(bytes, 6, K)?);
    let height = u32::from(u16_le(bytes, 8, K)?);
    let packed = *slice(bytes, 10, 3, K)?.first().unwrap_or(&0);
    let table = |packed: u8| {
        if packed & 0x80 != 0 {
            3usize << ((packed & 7) + 1)
        } else {
            0
        }
    };
    let mut pos = 13 + table(packed);
    let sub_blocks = |mut pos: usize| -> Result<usize, AppError> {
        loop {
            let n = usize::from(
                *bytes
                    .get(pos)
                    .ok_or_else(|| fail(K, "ends before the trailer"))?,
            );
            pos += 1;
            if n == 0 {
                return Ok(pos);
            }
            slice(bytes, pos, n, K).map_err(|_| fail(K, "sub-block ends outside the file"))?;
            pos += n;
        }
    };
    let mut frames = 0u32;
    loop {
        match bytes.get(pos) {
            None => return Err(fail(K, "ends before the trailer")),
            Some(0x3b) => break,
            Some(0x2c) => {
                let descriptor =
                    slice(bytes, pos, 10, K).map_err(|_| fail(K, "ends before the trailer"))?;
                frames += 1;
                if frames > MAX_IMAGE_FRAMES {
                    return Err(fail(K, "too many frames"));
                }
                // The LZW minimum code size byte comes after the local color table.
                pos += 10 + table(descriptor[9]) + 1;
                pos = sub_blocks(pos)?;
            }
            Some(0x21) => pos = sub_blocks(pos + 2)?,
            Some(_) => return Err(fail(K, "unknown block")),
        }
    }
    if frames == 0 {
        return Err(fail(K, "no frame"));
    }
    Ok(ImageHeader {
        format: AssetFormat::Gif,
        width,
        height,
        frames,
    })
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use opensekai_contracts::ErrorCode;

    pub fn png_bytes(width: u32, height: u32) -> Vec<u8> {
        let mut b = PNG_SIGNATURE.to_vec();
        b.extend(13u32.to_be_bytes());
        b.extend(b"IHDR");
        b.extend(width.to_be_bytes());
        b.extend(height.to_be_bytes());
        b.extend([8, 6, 0, 0, 0]);
        b.extend([0; 4]);
        b.extend(0u32.to_be_bytes());
        b.extend(b"IEND");
        b.extend([0xae, 0x42, 0x60, 0x82]);
        b
    }
    fn exif(orientation: u16) -> Vec<u8> {
        let mut tiff = b"MM\0\x2a\0\0\0\x08".to_vec();
        tiff.extend(1u16.to_be_bytes());
        tiff.extend(0x0112u16.to_be_bytes());
        tiff.extend(3u16.to_be_bytes());
        tiff.extend(1u32.to_be_bytes());
        tiff.extend(orientation.to_be_bytes());
        tiff.extend([0, 0]);
        tiff.extend(0u32.to_be_bytes());
        let mut seg = b"Exif\0\0".to_vec();
        seg.extend(tiff);
        let mut out = vec![0xff, 0xe1];
        out.extend(((seg.len() + 2) as u16).to_be_bytes());
        out.extend(seg);
        out
    }
    pub fn jpeg_bytes(width: u16, height: u16, orientation: Option<u16>) -> Vec<u8> {
        let mut b = vec![0xff, 0xd8];
        b.extend([0xff, 0xe0, 0, 16]);
        b.extend(b"JFIF\0\x01\x01\0\0\x01\0\x01\0\0");
        if let Some(o) = orientation {
            b.extend(exif(o));
        }
        b.extend([0xff, 0xdb, 0, 3, 0]);
        b.extend([0xff, 0xff, 0xc0, 0, 11, 8]);
        b.extend(height.to_be_bytes());
        b.extend(width.to_be_bytes());
        b.extend([1, 1, 0x11, 0]);
        b.extend([0xff, 0xda, 0, 2]);
        b.extend([0xff, 0xd9]);
        b
    }
    fn riff(chunk: &[u8], data: &[u8]) -> Vec<u8> {
        let mut body = b"WEBP".to_vec();
        body.extend(chunk);
        body.extend((data.len() as u32).to_le_bytes());
        body.extend(data);
        let mut b = b"RIFF".to_vec();
        b.extend((body.len() as u32).to_le_bytes());
        b.extend(body);
        b
    }
    pub fn webp_vp8l(width: u32, height: u32) -> Vec<u8> {
        let bits = (width - 1) | ((height - 1) << 14);
        let mut data = vec![0x2f];
        data.extend(bits.to_le_bytes());
        data.extend([0, 0, 0]);
        riff(b"VP8L", &data)
    }
    fn webp_vp8(width: u16, height: u16) -> Vec<u8> {
        let mut data = vec![0, 0, 0, 0x9d, 0x01, 0x2a];
        data.extend(width.to_le_bytes());
        data.extend(height.to_le_bytes());
        riff(b"VP8 ", &data)
    }
    fn webp_vp8x(width: u32, height: u32) -> Vec<u8> {
        let mut data = vec![0x10, 0, 0, 0];
        data.extend(&(width - 1).to_le_bytes()[..3]);
        data.extend(&(height - 1).to_le_bytes()[..3]);
        riff(b"VP8X", &data)
    }
    pub fn gif_bytes(width: u16, height: u16, frames: usize) -> Vec<u8> {
        let mut b = b"GIF89a".to_vec();
        b.extend(width.to_le_bytes());
        b.extend(height.to_le_bytes());
        b.extend([0x80, 0, 0]);
        b.extend([0; 6]);
        b.extend([0x21, 0xf9, 4, 0, 0, 0, 0, 0]);
        for _ in 0..frames {
            b.push(0x2c);
            b.extend([0, 0, 0, 0]);
            b.extend(width.to_le_bytes());
            b.extend(height.to_le_bytes());
            b.push(0);
            b.extend([2, 2, 0x4c, 0x01, 0]);
        }
        b.push(0x3b);
        b
    }
    fn header(format: AssetFormat, width: u32, height: u32, frames: u32) -> ImageHeader {
        ImageHeader {
            format,
            width,
            height,
            frames,
        }
    }
    fn rejects(bytes: &[u8], text: &str) {
        let error = parse_image(bytes).unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidInput);
        assert!(
            error.message.contains(text),
            "{} does not name {text}",
            error.message
        );
    }

    #[test]
    fn reads_each_type() {
        assert_eq!(
            parse_image(&png_bytes(4, 3)).unwrap(),
            header(AssetFormat::Png, 4, 3, 1)
        );
        assert_eq!(
            parse_image(&jpeg_bytes(5, 2, None)).unwrap(),
            header(AssetFormat::Jpeg, 5, 2, 1)
        );
        assert_eq!(
            parse_image(&webp_vp8l(7, 9)).unwrap(),
            header(AssetFormat::Webp, 7, 9, 1)
        );
        assert_eq!(
            parse_image(&webp_vp8(640, 480)).unwrap(),
            header(AssetFormat::Webp, 640, 480, 1)
        );
        assert_eq!(
            parse_image(&webp_vp8x(1000, 20)).unwrap(),
            header(AssetFormat::Webp, 1000, 20, 1)
        );
        assert_eq!(
            parse_image(&gif_bytes(3, 2, 1)).unwrap(),
            header(AssetFormat::Gif, 3, 2, 1)
        );
    }
    #[test]
    fn counts_gif_frames_and_keeps_the_screen_size() {
        assert_eq!(parse_image(&gif_bytes(3, 2, 5)).unwrap().frames, 5);
        let mut b = gif_bytes(3, 2, 1);
        // A frame larger than the logical screen does not change the size.
        let at = b.iter().position(|&x| x == 0x2c).unwrap();
        b[at + 5] = 200;
        assert_eq!(parse_image(&b).unwrap(), header(AssetFormat::Gif, 3, 2, 1));
        let mut many = gif_bytes(1, 1, 4097);
        rejects(&many, "too many frames");
        many.truncate(many.len() - 1);
        rejects(&many, "too many frames");
        rejects(&gif_bytes(1, 1, 0), "no frame");
    }
    #[test]
    fn jpeg_orientation_swaps_the_sides() {
        assert_eq!(
            parse_image(&jpeg_bytes(40, 30, Some(6))).unwrap(),
            header(AssetFormat::Jpeg, 30, 40, 1)
        );
        assert_eq!(
            parse_image(&jpeg_bytes(40, 30, Some(3))).unwrap(),
            header(AssetFormat::Jpeg, 40, 30, 1)
        );
        // An invalid value reads as absent.
        assert_eq!(
            parse_image(&jpeg_bytes(40, 30, Some(9))).unwrap(),
            header(AssetFormat::Jpeg, 40, 30, 1)
        );
    }
    #[test]
    fn the_first_orientation_entry_decides() {
        // IFD0 with two Orientation entries: 9 (invalid), then 6. The renderer reads the first one too.
        let mut tiff = b"MM\0\x2a\0\0\0\x08".to_vec();
        tiff.extend(2u16.to_be_bytes());
        for value in [9u16, 6] {
            tiff.extend(0x0112u16.to_be_bytes());
            tiff.extend(3u16.to_be_bytes());
            tiff.extend(1u32.to_be_bytes());
            tiff.extend(value.to_be_bytes());
            tiff.extend([0, 0]);
        }
        tiff.extend(0u32.to_be_bytes());
        assert_eq!(exif_orientation(&tiff), None);
    }
    #[test]
    fn rejects_unknown_and_truncated_files() {
        rejects(b"", "unknown type");
        rejects(b"BM\0\0\0\0", "unknown type");
        rejects(b"glTF\x02\0\0\0", "unknown type");
        for bytes in [
            png_bytes(4, 3),
            jpeg_bytes(4, 3, Some(6)),
            webp_vp8l(4, 3),
            webp_vp8x(4, 3),
            gif_bytes(4, 3, 2),
        ] {
            // A PNG or a JPEG prefix that holds the whole header is valid; a WebP or a GIF prefix is not.
            let whole_header = bytes.starts_with(PNG_SIGNATURE) || bytes[0] == 0xff;
            for end in 0..bytes.len() - 1 {
                let result = parse_image(&bytes[..end]);
                assert!(
                    whole_header || result.is_err(),
                    "prefix {end} of {:?} passed",
                    &bytes[..4]
                );
            }
        }
        for end in 0..33 {
            assert!(parse_image(&png_bytes(4, 3)[..end]).is_err());
        }
        let jpeg = jpeg_bytes(4, 3, Some(6));
        let sof = jpeg.windows(2).position(|w| w == [0xff, 0xc0]).unwrap();
        for end in 0..sof + 9 {
            assert!(parse_image(&jpeg[..end]).is_err());
        }
        rejects(&png_bytes(4, 3)[..32], "truncated");
    }
    #[test]
    fn rejects_bad_headers() {
        let mut ihdr = png_bytes(4, 3);
        ihdr[12..16].copy_from_slice(b"IDAT");
        rejects(&ihdr, "IHDR");
        rejects(&png_bytes(0, 3), "size is 0");
        rejects(&png_bytes(8193, 1), "too large");
        rejects(&png_bytes(8192, 4097), "too large");
        assert!(parse_image(&png_bytes(8192, 4096)).is_ok());
        let no_sof = [0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xda, 0, 2];
        rejects(&no_sof, "before the scan");
        rejects(&[0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0], "before the end");
        rejects(&[0xff, 0xd8, 0xff, 0xe0, 0, 1, 0, 0], "segment length");
        rejects(&[0xff, 0xd8, 0xff, 0xe0, 0, 40, 0, 0], "truncated");
        let mut size = webp_vp8l(4, 3);
        size.push(0);
        rejects(&size, "RIFF size");
        let mut code = webp_vp8(4, 3);
        code[23] = 0;
        rejects(&code, "start code");
        rejects(&webp_vp8(0, 3), "size is 0");
        let mut trailer = gif_bytes(4, 3, 1);
        trailer.pop();
        rejects(&trailer, "before the trailer");
        let mut block = gif_bytes(4, 3, 1);
        let end = block.len() - 1;
        block[end - 4] = 9;
        rejects(&block, "outside the file");
        let mut unknown = gif_bytes(4, 3, 1);
        let end = unknown.len() - 1;
        unknown[end] = 0x99;
        rejects(&unknown, "unknown block");
    }
}
