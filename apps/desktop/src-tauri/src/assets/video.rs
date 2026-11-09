//! Container checks for video assets (B29 R4). This module reads boxes and elements only. It never decodes a frame.
use opensekai_contracts::{
    invalid, AppError, AssetFormat, AssetVideo, VideoAudioCodec, VideoCodec, MAX_VIDEO_DURATION_MS,
    MAX_VIDEO_SIDE,
};
use std::ops::Range;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct VideoHeader {
    pub format: AssetFormat,
    /// The display size: after the track matrix for an MP4 and the display fields for a WebM.
    pub width: u32,
    pub height: u32,
    pub duration_ms: u64,
    pub video_codec: VideoCodec,
    pub audio_codec: Option<VideoAudioCodec>,
    pub alpha: bool,
}
impl VideoHeader {
    pub fn video(&self) -> AssetVideo {
        AssetVideo {
            width: self.width,
            height: self.height,
            duration_ms: self.duration_ms,
            video_codec: self.video_codec.clone(),
            audio_codec: self.audio_codec.clone(),
            alpha: self.alpha,
        }
    }
}

const NO_DURATION: &str = "Video has no duration";
const VIDEO_CODEC: &str = "Video codec not supported";
const AUDIO_CODEC: &str = "Audio codec not supported";
const NO_VIDEO_TRACK: &str = "Video has no video track";
const HEADER_NOT_FOUND: &str = "Video header not found";

fn fail(kind: &str, reason: &str) -> AppError {
    invalid(format!("{kind}: {reason}"))
}
fn side_ok(side: u32) -> bool {
    (1..=MAX_VIDEO_SIDE).contains(&side)
}

/// Finds the type from the signature, then reads the container structure. Every read is bounds-checked.
pub fn parse_video(bytes: &[u8]) -> Result<VideoHeader, AppError> {
    let (header, kind) = if bytes.get(4..8) == Some(b"ftyp") {
        (mp4::parse(bytes)?, mp4::K)
    } else if bytes.starts_with(&webm::EBML.to_be_bytes()) {
        (webm::parse(bytes)?, webm::K)
    } else {
        return Err(invalid("Video: unknown type (MP4 or WebM)"));
    };
    if !side_ok(header.width) || !side_ok(header.height) {
        return Err(fail(kind, "display size is outside 1 to 4096"));
    }
    if !(1..=MAX_VIDEO_DURATION_MS).contains(&header.duration_ms) {
        return Err(fail(kind, "duration is outside 1 ms to 4 hours"));
    }
    // The R1 codec table: for example, AV1 with an alpha channel is not a valid record.
    if !header.video().ok_for(&header.format) {
        return Err(fail(kind, VIDEO_CODEC));
    }
    Ok(header)
}

mod mp4 {
    use super::*;
    pub const K: &str = "MP4";

    #[derive(Debug, Clone)]
    struct Bx {
        kind: [u8; 4],
        body: Range<usize>,
    }
    fn err(reason: &str) -> AppError {
        fail(K, reason)
    }
    /// `len` bytes at `at` from the start of a box body, inside the body.
    fn field<'a>(
        bytes: &'a [u8],
        body: &Range<usize>,
        at: usize,
        len: usize,
    ) -> Result<&'a [u8], AppError> {
        let start = body.start.checked_add(at).ok_or_else(|| err("truncated"))?;
        let end = start.checked_add(len).ok_or_else(|| err("truncated"))?;
        if end > body.end {
            return Err(err("truncated"));
        }
        bytes.get(start..end).ok_or_else(|| err("truncated"))
    }
    fn u16_at(bytes: &[u8], body: &Range<usize>, at: usize) -> Result<u16, AppError> {
        let s = field(bytes, body, at, 2)?;
        Ok(u16::from_be_bytes([s[0], s[1]]))
    }
    fn u32_at(bytes: &[u8], body: &Range<usize>, at: usize) -> Result<u32, AppError> {
        let s = field(bytes, body, at, 4)?;
        Ok(u32::from_be_bytes([s[0], s[1], s[2], s[3]]))
    }
    fn u64_at(bytes: &[u8], body: &Range<usize>, at: usize) -> Result<u64, AppError> {
        let s = field(bytes, body, at, 8)?;
        let mut b = [0u8; 8];
        b.copy_from_slice(s);
        Ok(u64::from_be_bytes(b))
    }
    /// The boxes in `range`. A size below the header size or past the parent end is a failure.
    fn children(bytes: &[u8], range: Range<usize>) -> Result<Vec<Bx>, AppError> {
        let end = range.end.min(bytes.len());
        let mut out = Vec::new();
        let mut pos = range.start;
        while pos < end {
            let room = end - pos;
            if room < 8 {
                return Err(err("truncated box header"));
            }
            let head = &bytes[pos..pos + 8];
            let small = u32::from_be_bytes([head[0], head[1], head[2], head[3]]);
            let kind = [head[4], head[5], head[6], head[7]];
            let (header, size) = match small {
                1 => {
                    let large = bytes
                        .get(pos + 8..pos + 16)
                        .filter(|_| room >= 16)
                        .ok_or_else(|| err("truncated box header"))?;
                    let mut b = [0u8; 8];
                    b.copy_from_slice(large);
                    (16u64, u64::from_be_bytes(b))
                }
                0 => (8, room as u64),
                n => (8, u64::from(n)),
            };
            if size < header || size > room as u64 {
                return Err(err("box size is invalid"));
            }
            let next = pos + size as usize;
            out.push(Bx {
                kind,
                body: pos + header as usize..next,
            });
            pos = next;
        }
        Ok(out)
    }
    fn find<'a>(list: &'a [Bx], kind: &[u8; 4]) -> Option<&'a Bx> {
        list.iter().find(|b| &b.kind == kind)
    }
    fn inside(bytes: &[u8], list: &[Bx], kind: &[u8; 4]) -> Result<Vec<Bx>, AppError> {
        find(list, kind).map_or(Ok(vec![]), |b| children(bytes, b.body.clone()))
    }

    pub fn parse(bytes: &[u8]) -> Result<VideoHeader, AppError> {
        let top = children(bytes, 0..bytes.len())?;
        let ftyp = top
            .first()
            .filter(|b| &b.kind == b"ftyp")
            .ok_or_else(|| err("first box is not ftyp"))?;
        if field(bytes, &ftyp.body, 0, 4)? == b"qt  " {
            return Err(err("QuickTime file is not supported"));
        }
        let moov = match top
            .iter()
            .filter(|b| &b.kind == b"moov")
            .collect::<Vec<_>>()[..]
        {
            [moov] => moov,
            [] => return Err(err("no moov box")),
            _ => return Err(err("more than one moov box")),
        };
        // A file without media data is not complete. This also rejects a faststart file cut after its moov.
        if find(&top, b"mdat").is_none() {
            return Err(err("no mdat box"));
        }
        let moov = children(bytes, moov.body.clone())?;
        let duration_ms = duration(bytes, find(&moov, b"mvhd").ok_or_else(|| err(NO_DURATION))?)?;
        let mut video = None;
        let mut audio = None;
        for trak in moov.iter().filter(|b| &b.kind == b"trak") {
            let trak = children(bytes, trak.body.clone())?;
            let mdia = inside(bytes, &trak, b"mdia")?;
            let minf = inside(bytes, &mdia, b"minf")?;
            check_references(bytes, &inside(bytes, &minf, b"dinf")?)?;
            let handler = match find(&mdia, b"hdlr") {
                Some(hdlr) => Some(field(bytes, &hdlr.body, 8, 4)?),
                None => None,
            };
            let stbl = || inside(bytes, &minf, b"stbl");
            match handler {
                Some(b"vide") if video.is_none() => {
                    video = Some(video_track(bytes, &trak, &stbl()?)?);
                }
                Some(b"soun") if audio.is_none() => {
                    audio = Some(audio_codec(bytes, &stbl()?)?);
                }
                _ => {}
            }
        }
        let (video_codec, width, height) = video.ok_or_else(|| err(NO_VIDEO_TRACK))?;
        Ok(VideoHeader {
            format: AssetFormat::Mp4,
            width,
            height,
            duration_ms,
            video_codec,
            audio_codec: audio,
            alpha: false,
        })
    }

    fn duration(bytes: &[u8], mvhd: &Bx) -> Result<u64, AppError> {
        let body = &mvhd.body;
        let (scale, length, all_ones) = match field(bytes, body, 0, 1)?[0] {
            0 => (
                u32_at(bytes, body, 12)?,
                u64::from(u32_at(bytes, body, 16)?),
                u64::from(u32::MAX),
            ),
            1 => (u32_at(bytes, body, 20)?, u64_at(bytes, body, 24)?, u64::MAX),
            _ => return Err(err("unknown mvhd version")),
        };
        if scale == 0 || length == 0 || length == all_ones {
            return Err(err(NO_DURATION));
        }
        let scale = u128::from(scale);
        let ms = (u128::from(length) * 1000 + scale / 2) / scale;
        Ok(u64::try_from(ms).unwrap_or(u64::MAX))
    }

    /// Each `dref` entry must have the self-contained flag: no external data reference.
    fn check_references(bytes: &[u8], dinf: &[Bx]) -> Result<(), AppError> {
        let Some(dref) = find(dinf, b"dref") else {
            return Ok(());
        };
        let count = u32_at(bytes, &dref.body, 4)? as usize;
        let start = dref
            .body
            .start
            .checked_add(8)
            .filter(|s| *s <= dref.body.end);
        let start = start.ok_or_else(|| err("truncated"))?;
        let entries = children(bytes, start..dref.body.end)?;
        if entries.len() < count {
            return Err(err("data reference is truncated"));
        }
        for entry in entries.iter().take(count) {
            if field(bytes, &entry.body, 0, 4)?[3] & 1 == 0 {
                return Err(err("external data reference is not supported"));
            }
        }
        Ok(())
    }

    fn first_entry(bytes: &[u8], stbl: &[Bx]) -> Result<Bx, AppError> {
        let stsd = find(stbl, b"stsd").ok_or_else(|| err("no sample description"))?;
        if u32_at(bytes, &stsd.body, 4)? == 0 {
            return Err(err("no sample description"));
        }
        let start = stsd.body.start + 8;
        children(bytes, start..stsd.body.end)?
            .into_iter()
            .next()
            .ok_or_else(|| err("no sample description"))
    }

    fn video_track(
        bytes: &[u8],
        trak: &[Bx],
        stbl: &[Bx],
    ) -> Result<(VideoCodec, u32, u32), AppError> {
        let entry = first_entry(bytes, stbl)?;
        let codec = match &entry.kind {
            b"avc1" | b"avc3" => VideoCodec::H264,
            b"hvc1" | b"hev1" => VideoCodec::Hevc,
            b"av01" => VideoCodec::Av1,
            _ => return Err(err(VIDEO_CODEC)),
        };
        let coded = (
            u32::from(u16_at(bytes, &entry.body, 24)?),
            u32::from(u16_at(bytes, &entry.body, 26)?),
        );
        if !side_ok(coded.0) || !side_ok(coded.1) {
            return Err(err("coded size is outside 1 to 4096"));
        }
        let tkhd = find(trak, b"tkhd").ok_or_else(|| err("no track header"))?;
        let (matrix_at, size_at) = match field(bytes, &tkhd.body, 0, 1)?[0] {
            0 => (40, 76),
            1 => (52, 88),
            _ => return Err(err("unknown tkhd version")),
        };
        let m = (0..9)
            .map(|i| u32_at(bytes, &tkhd.body, matrix_at + i * 4).map(|v| v as i32))
            .collect::<Result<Vec<_>, _>>()?;
        // a, b, c, d in 16.16; u, v, and w in 2.30. The translation x, y does not change the size.
        if m[2] != 0 || m[5] != 0 || m[8] != 0x4000_0000 {
            return Err(err("track matrix is not a turn"));
        }
        let swap = match (m[0], m[1], m[3], m[4]) {
            // 1.0 is 0x10000 in 16.16.
            (65536, 0, 0, 65536) | (-65536, 0, 0, -65536) => false,
            (0, 65536, -65536, 0) | (0, -65536, 65536, 0) => true,
            _ => return Err(err("track matrix is not a turn")),
        };
        let size = (
            u32_at(bytes, &tkhd.body, size_at)? >> 16,
            u32_at(bytes, &tkhd.body, size_at + 4)? >> 16,
        );
        let (width, height) = if size.0 == 0 || size.1 == 0 {
            coded
        } else {
            size
        };
        let (width, height) = if swap {
            (height, width)
        } else {
            (width, height)
        };
        Ok((codec, width, height))
    }

    fn audio_codec(bytes: &[u8], stbl: &[Bx]) -> Result<VideoAudioCodec, AppError> {
        let entry = first_entry(bytes, stbl)?;
        match &entry.kind {
            b"Opus" => Ok(VideoAudioCodec::Opus),
            b"mp4a" => {
                // The sound sample entry is 28 bytes. QuickTime sound versions 1 and 2 add 16 and 36 bytes.
                let extra = match u16_at(bytes, &entry.body, 8)? {
                    0 => 0,
                    1 => 16,
                    2 => 36,
                    _ => return Err(err(AUDIO_CODEC)),
                };
                let start = entry.body.start + 28 + extra;
                if start > entry.body.end {
                    return Err(err("truncated"));
                }
                let boxes = children(bytes, start..entry.body.end)?;
                let esds = find(&boxes, b"esds").ok_or_else(|| err(AUDIO_CODEC))?;
                match object_type(bytes, &esds.body).ok_or_else(|| err(AUDIO_CODEC))? {
                    0x40 => Ok(VideoAudioCodec::Aac),
                    0x69 | 0x6b => Ok(VideoAudioCodec::Mp3),
                    _ => Err(err(AUDIO_CODEC)),
                }
            }
            _ => Err(err(AUDIO_CODEC)),
        }
    }

    /// The object type of the DecoderConfigDescriptor (tag 0x04) in the ES_Descriptor (tag 0x03) of an `esds` box.
    fn object_type(bytes: &[u8], body: &Range<usize>) -> Option<u8> {
        let data = bytes.get(body.start.checked_add(4)?..body.end)?;
        let (tag, es) = descriptor(data)?;
        if tag != 0x03 {
            return None;
        }
        let flags = *es.get(2)?;
        let mut pos = 3;
        if flags & 0x80 != 0 {
            pos += 2;
        }
        if flags & 0x40 != 0 {
            pos += 1 + usize::from(*es.get(pos)?);
        }
        if flags & 0x20 != 0 {
            pos += 2;
        }
        let mut rest = es.get(pos..)?;
        while !rest.is_empty() {
            let (tag, body) = descriptor(rest)?;
            if tag == 0x04 {
                return body.first().copied();
            }
            let used = body.as_ptr() as usize - rest.as_ptr() as usize + body.len();
            rest = rest.get(used..)?;
        }
        None
    }
    /// One descriptor: its tag and its body. The length has up to 4 bytes of 7 bits.
    fn descriptor(data: &[u8]) -> Option<(u8, &[u8])> {
        let tag = *data.first()?;
        let mut length = 0usize;
        let mut pos = 1;
        loop {
            let b = *data.get(pos)?;
            pos += 1;
            length = (length << 7) | usize::from(b & 0x7f);
            if b & 0x80 == 0 {
                break;
            }
            if pos > 4 {
                return None;
            }
        }
        Some((tag, data.get(pos..pos.checked_add(length)?)?))
    }
}

mod webm {
    use super::*;
    pub const K: &str = "WebM";
    pub const EBML: u32 = 0x1A45_DFA3;
    const DOC_TYPE: u32 = 0x4282;
    const SEGMENT: u32 = 0x1853_8067;
    const CLUSTER: u32 = 0x1F43_B675;
    const INFO: u32 = 0x1549_A966;
    const TIMECODE_SCALE: u32 = 0x2A_D7B1;
    const DURATION: u32 = 0x4489;
    const TRACKS: u32 = 0x1654_AE6B;
    const TRACK_ENTRY: u32 = 0xAE;
    const TRACK_TYPE: u32 = 0x83;
    const CODEC_ID: u32 = 0x86;
    const CONTENT_ENCODINGS: u32 = 0x6D80;
    const VIDEO: u32 = 0xE0;
    const PIXEL_WIDTH: u32 = 0xB0;
    const PIXEL_HEIGHT: u32 = 0xBA;
    const DISPLAY_WIDTH: u32 = 0x54B0;
    const DISPLAY_HEIGHT: u32 = 0x54BA;
    const DISPLAY_UNIT: u32 = 0x54B2;
    const ALPHA_MODE: u32 = 0x53C0;
    /// The Segment walk reads at most the first 16 MiB of the file.
    const SCAN_LIMIT: usize = 16 * 1024 * 1024;

    #[derive(Debug, Clone)]
    struct El {
        id: u32,
        body: Range<usize>,
    }
    fn err(reason: &str) -> AppError {
        fail(K, reason)
    }
    /// A variable-length integer: its length from the leading zero bits of the first byte.
    fn vint(
        bytes: &[u8],
        pos: usize,
        end: usize,
        max: usize,
    ) -> Result<(u64, usize, bool), AppError> {
        let first = *bytes
            .get(pos)
            .filter(|_| pos < end)
            .ok_or_else(|| err("truncated element"))?;
        let len = first.leading_zeros() as usize + 1;
        if len > max {
            return Err(err("invalid element header"));
        }
        let tail = bytes
            .get(pos + 1..pos + len)
            .filter(|_| pos + len <= end)
            .ok_or_else(|| err("truncated element"))?;
        let value = tail.iter().fold(u64::from(first) & (0xff >> len), |v, b| {
            (v << 8) | u64::from(*b)
        });
        let all_ones = value == (1u64 << (7 * len)) - 1;
        Ok((value, len, all_ones))
    }
    /// One element that starts at `pos` and ends inside `end`. Only Segment and Cluster can have an unknown size.
    fn element(bytes: &[u8], pos: usize, end: usize) -> Result<El, AppError> {
        let (_, id_len, _) = vint(bytes, pos, end, 4)?;
        let id = bytes[pos..pos + id_len]
            .iter()
            .fold(0u32, |v, b| (v << 8) | u32::from(*b));
        let (size, size_len, unknown) = vint(bytes, pos + id_len, end, 8)?;
        let start = pos + id_len + size_len;
        let stop = if unknown {
            if id != SEGMENT && id != CLUSTER {
                return Err(err("unknown element size is not allowed"));
            }
            end
        } else {
            usize::try_from(size)
                .ok()
                .and_then(|size| start.checked_add(size))
                .filter(|stop| *stop <= end)
                .ok_or_else(|| err("element size is invalid"))?
        };
        Ok(El {
            id,
            body: start..stop,
        })
    }
    fn children(bytes: &[u8], range: &Range<usize>) -> Result<Vec<El>, AppError> {
        let mut out = Vec::new();
        let mut pos = range.start;
        while pos < range.end {
            let el = element(bytes, pos, range.end)?;
            pos = el.body.end;
            out.push(el);
        }
        Ok(out)
    }
    fn find(list: &[El], id: u32) -> Option<&El> {
        list.iter().find(|e| e.id == id)
    }
    fn uint(bytes: &[u8], el: &El) -> Result<u64, AppError> {
        if el.body.len() > 8 {
            return Err(err("invalid integer"));
        }
        Ok(bytes[el.body.clone()]
            .iter()
            .fold(0u64, |v, b| (v << 8) | u64::from(*b)))
    }
    fn uint_of(bytes: &[u8], list: &[El], id: u32) -> Result<Option<u64>, AppError> {
        find(list, id).map(|el| uint(bytes, el)).transpose()
    }
    fn text<'a>(bytes: &'a [u8], el: &El) -> &'a [u8] {
        let raw = &bytes[el.body.clone()];
        let end = raw.iter().rposition(|b| *b != 0).map_or(0, |i| i + 1);
        &raw[..end]
    }
    fn side(value: Option<u64>) -> Option<u32> {
        value.map(|v| u32::try_from(v).unwrap_or(u32::MAX))
    }

    pub fn parse(bytes: &[u8]) -> Result<VideoHeader, AppError> {
        let header = element(bytes, 0, bytes.len())?;
        let doc = children(bytes, &header.body)?;
        if find(&doc, DOC_TYPE).map(|el| text(bytes, el)) != Some(b"webm") {
            return Err(err("DocType is not webm"));
        }
        let mut pos = header.body.end;
        let segment = loop {
            if pos >= bytes.len() {
                return Err(err(HEADER_NOT_FOUND));
            }
            let el = element(bytes, pos, bytes.len())?;
            if el.id == SEGMENT {
                break el;
            }
            pos = el.body.end;
        };
        let mut info = None;
        let mut tracks = None;
        let mut pos = segment.body.start;
        while info.is_none() || tracks.is_none() {
            if pos >= segment.body.end || pos >= SCAN_LIMIT {
                return Err(err(HEADER_NOT_FOUND));
            }
            let el = element(bytes, pos, segment.body.end)?;
            let wanted = (el.id == INFO && info.is_none()) || (el.id == TRACKS && tracks.is_none());
            if el.id == CLUSTER || (wanted && el.body.end > SCAN_LIMIT) {
                return Err(err(HEADER_NOT_FOUND));
            }
            if el.id == INFO && info.is_none() {
                info = Some(duration(bytes, &children(bytes, &el.body)?)?);
            } else if el.id == TRACKS && tracks.is_none() {
                tracks = Some(read_tracks(bytes, &children(bytes, &el.body)?)?);
            }
            pos = el.body.end;
        }
        let duration_ms = info.unwrap_or_default();
        let (video_codec, width, height, alpha, audio_codec) =
            tracks.ok_or_else(|| err(HEADER_NOT_FOUND))?;
        Ok(VideoHeader {
            format: AssetFormat::Webm,
            width,
            height,
            duration_ms,
            video_codec,
            audio_codec,
            alpha,
        })
    }

    fn duration(bytes: &[u8], info: &[El]) -> Result<u64, AppError> {
        let scale = uint_of(bytes, info, TIMECODE_SCALE)?.unwrap_or(1_000_000);
        let el = find(info, DURATION).ok_or_else(|| err(NO_DURATION))?;
        let raw = &bytes[el.body.clone()];
        let value = match raw.len() {
            4 => f64::from(f32::from_be_bytes([raw[0], raw[1], raw[2], raw[3]])),
            8 => {
                let mut b = [0u8; 8];
                b.copy_from_slice(raw);
                f64::from_be_bytes(b)
            }
            _ => return Err(err(NO_DURATION)),
        };
        let ms = value * scale as f64 / 1_000_000.0;
        if !ms.is_finite() || ms <= 0.0 {
            return Err(err(NO_DURATION));
        }
        // A float cast saturates; parse_video checks the range.
        Ok(ms.round() as u64)
    }

    type Tracks = (VideoCodec, u32, u32, bool, Option<VideoAudioCodec>);
    fn read_tracks(bytes: &[u8], tracks: &[El]) -> Result<Tracks, AppError> {
        let mut video = None;
        let mut audio = None;
        for entry in tracks.iter().filter(|e| e.id == TRACK_ENTRY) {
            let fields = children(bytes, &entry.body)?;
            let kind = uint_of(bytes, &fields, TRACK_TYPE)?;
            let first = match kind {
                Some(1) => video.is_none(),
                Some(2) => audio.is_none(),
                _ => false,
            };
            if !first {
                continue;
            }
            if find(&fields, CONTENT_ENCODINGS).is_some() {
                return Err(err("track content encoding is not supported"));
            }
            let codec = find(&fields, CODEC_ID)
                .map(|el| text(bytes, el))
                .unwrap_or_default();
            if kind == Some(1) {
                video = Some(video_track(bytes, &fields, codec)?);
            } else {
                audio = Some(match codec {
                    b"A_OPUS" => VideoAudioCodec::Opus,
                    b"A_VORBIS" => VideoAudioCodec::Vorbis,
                    _ => return Err(err(AUDIO_CODEC)),
                });
            }
        }
        let (codec, width, height, alpha) = video.ok_or_else(|| err(NO_VIDEO_TRACK))?;
        Ok((codec, width, height, alpha, audio))
    }

    fn video_track(
        bytes: &[u8],
        fields: &[El],
        codec: &[u8],
    ) -> Result<(VideoCodec, u32, u32, bool), AppError> {
        let codec = match codec {
            b"V_VP8" => VideoCodec::Vp8,
            b"V_VP9" => VideoCodec::Vp9,
            b"V_AV1" => VideoCodec::Av1,
            _ => return Err(err(VIDEO_CODEC)),
        };
        let video = match find(fields, VIDEO) {
            Some(el) => children(bytes, &el.body)?,
            None => vec![],
        };
        let coded = (
            side(uint_of(bytes, &video, PIXEL_WIDTH)?).unwrap_or(0),
            side(uint_of(bytes, &video, PIXEL_HEIGHT)?).unwrap_or(0),
        );
        if !side_ok(coded.0) || !side_ok(coded.1) {
            return Err(err("coded size is outside 1 to 4096"));
        }
        let display = (
            side(uint_of(bytes, &video, DISPLAY_WIDTH)?),
            side(uint_of(bytes, &video, DISPLAY_HEIGHT)?),
        );
        let unit = uint_of(bytes, &video, DISPLAY_UNIT)?.unwrap_or(0);
        let (width, height) = match display {
            (Some(width), Some(height)) if unit == 0 => (width, height),
            _ => coded,
        };
        let alpha = uint_of(bytes, &video, ALPHA_MODE)? == Some(1);
        Ok((codec, width, height, alpha))
    }
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use opensekai_contracts::ErrorCode;
    use serde_json::Value;

    pub const FILES: [&str; 9] = [
        "h264-aac.mp4",
        "h264-late-moov.mp4",
        "h264-turned.mp4",
        "hevc.mp4",
        "av1.mp4",
        "vp8.webm",
        "vp9-opus.webm",
        "vp9-alpha.webm",
        "av1.webm",
    ];
    pub fn fixture_path(name: &str) -> std::path::PathBuf {
        std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
            .join("../../../fixtures/video")
            .join(name)
    }
    pub fn fixture(name: &str) -> Vec<u8> {
        std::fs::read(fixture_path(name)).unwrap()
    }
    fn expected() -> Value {
        serde_json::from_slice(&fixture("expected.json")).unwrap()
    }
    fn rejects(bytes: &[u8], text: &str) {
        let error = parse_video(bytes).unwrap_err();
        assert_eq!(error.code, ErrorCode::InvalidInput);
        assert!(
            error.message.contains(text),
            "{} does not name {text}",
            error.message
        );
    }
    /// The position of a 4-character box type after the first `anchor`.
    fn after(bytes: &[u8], anchor: &[u8], tag: &[u8]) -> usize {
        let from = bytes
            .windows(anchor.len())
            .position(|w| w == anchor)
            .unwrap();
        from + bytes[from..]
            .windows(tag.len())
            .position(|w| w == tag)
            .unwrap()
    }
    fn mutate(name: &str, change: impl FnOnce(&mut Vec<u8>)) -> Vec<u8> {
        let mut bytes = fixture(name);
        change(&mut bytes);
        bytes
    }

    #[test]
    fn reads_each_test_file_as_expected_json() {
        let expected = expected();
        for name in FILES {
            let header = parse_video(&fixture(name)).unwrap_or_else(|e| panic!("{name}: {e:?}"));
            let want = &expected[name];
            assert_eq!(
                serde_json::to_value(&header.format).unwrap(),
                want["format"],
                "{name}"
            );
            assert_eq!(
                u64::from(header.width),
                want["width"].as_u64().unwrap(),
                "{name}"
            );
            assert_eq!(
                u64::from(header.height),
                want["height"].as_u64().unwrap(),
                "{name}"
            );
            let duration = want["durationMs"].as_u64().unwrap();
            assert!(
                header.duration_ms.abs_diff(duration) <= 17,
                "{name}: {}",
                header.duration_ms
            );
            assert_eq!(
                serde_json::to_value(&header.video_codec).unwrap(),
                want["videoCodec"],
                "{name}"
            );
            assert_eq!(
                serde_json::to_value(&header.audio_codec).unwrap(),
                want["audioCodec"],
                "{name}"
            );
            assert_eq!(Value::Bool(header.alpha), want["alpha"], "{name}");
            assert!(header.video().ok_for(&header.format), "{name}");
        }
        // The turned file has a 90-degree matrix over a 64 x 36 track.
        let turned = parse_video(&fixture("h264-turned.mp4")).unwrap();
        assert_eq!((turned.width, turned.height), (36, 64));
    }
    #[test]
    fn each_prefix_of_each_file_fails_without_a_panic() {
        for name in FILES {
            let bytes = fixture(name);
            for end in 0..bytes.len() {
                assert!(
                    parse_video(&bytes[..end]).is_err(),
                    "{name} prefix {end} passed"
                );
            }
        }
    }
    #[test]
    fn rejects_unknown_types() {
        rejects(b"", "unknown type");
        rejects(b"\x89PNG\r\n\x1a\n", "unknown type");
        rejects(b"glTF\x02\0\0\0", "unknown type");
        rejects(b"RIFF\0\0\0\0AVI ", "unknown type");
    }

    // MP4 rules.
    #[test]
    fn rejects_a_quicktime_brand_and_a_missing_or_second_moov() {
        rejects(
            &mutate("h264-aac.mp4", |b| b[8..12].copy_from_slice(b"qt  ")),
            "QuickTime",
        );
        let no_moov = mutate("h264-aac.mp4", |b| {
            let at = after(b, b"moov", b"moov");
            b[at..at + 4].copy_from_slice(b"skip");
        });
        rejects(&no_moov, "no moov");
        let mut two = fixture("h264-late-moov.mp4");
        let at = after(&two, b"moov", b"moov") - 4;
        let moov = two[at..].to_vec();
        two.extend(moov);
        rejects(&two, "more than one moov");
    }
    #[test]
    fn rejects_a_zero_and_an_all_ones_duration() {
        for (value, scale) in [
            ([0u8; 4], None),
            ([0xff; 4], None),
            ([0, 0, 7, 0xd0], Some([0u8; 4])),
        ] {
            let bytes = mutate("h264-aac.mp4", |b| {
                let body = after(b, b"mvhd", b"mvhd") + 4;
                b[body + 16..body + 20].copy_from_slice(&value);
                if let Some(scale) = scale {
                    b[body + 12..body + 16].copy_from_slice(&scale);
                }
            });
            rejects(&bytes, NO_DURATION);
        }
    }
    #[test]
    fn rejects_an_external_data_reference() {
        let bytes = mutate("h264-aac.mp4", |b| {
            let entry = after(b, b"dref", b"url ");
            b[entry + 7] = 0;
        });
        rejects(&bytes, "external data reference");
    }
    #[test]
    fn rejects_other_video_and_audio_sample_entries() {
        for entry in [b"mp4v", b"vp09", b"encv"] {
            let bytes = mutate("h264-aac.mp4", |b| {
                let at = after(b, b"stsd", b"avc1");
                b[at..at + 4].copy_from_slice(entry);
            });
            rejects(&bytes, VIDEO_CODEC);
        }
        let ac3 = mutate("h264-aac.mp4", |b| {
            let at = after(b, b"stsd", b"mp4a");
            b[at..at + 4].copy_from_slice(b"ac-3");
        });
        rejects(&ac3, AUDIO_CODEC);
        // An MPEG-4 Visual object type in the esds of the audio entry.
        let object = mutate("h264-aac.mp4", |b| {
            let esds = after(b, b"mp4a", b"esds");
            let config = esds + b[esds..].iter().position(|x| *x == 0x04).unwrap();
            let at = config + 1 + b[config + 1..].iter().position(|x| *x & 0x80 == 0).unwrap() + 1;
            assert_eq!(b[at], 0x40);
            b[at] = 0x20;
        });
        rejects(&object, AUDIO_CODEC);
    }
    #[test]
    fn rejects_a_mirrored_matrix_and_a_large_coded_size() {
        let mirrored = mutate("h264-aac.mp4", |b| {
            let body = after(b, b"tkhd", b"tkhd") + 4;
            b[body + 40..body + 44].copy_from_slice(&(-0x1_0000i32).to_be_bytes());
        });
        rejects(&mirrored, "matrix");
        let scaled = mutate("h264-aac.mp4", |b| {
            let body = after(b, b"tkhd", b"tkhd") + 4;
            b[body + 40..body + 44].copy_from_slice(&0x2_0000i32.to_be_bytes());
        });
        rejects(&scaled, "matrix");
        // The tkhd size stays 64 x 36.
        let large = mutate("h264-aac.mp4", |b| {
            let entry = after(b, b"stsd", b"avc1");
            b[entry + 4 + 24..entry + 4 + 26].copy_from_slice(&5000u16.to_be_bytes());
        });
        rejects(&large, "coded size");
    }
    #[test]
    fn rejects_a_file_without_a_video_track() {
        let bytes = mutate("h264-late-moov.mp4", |b| {
            let at = after(b, b"hdlr", b"vide");
            b[at..at + 4].copy_from_slice(b"text");
        });
        rejects(&bytes, NO_VIDEO_TRACK);
    }
    #[test]
    fn uses_the_coded_size_when_the_track_size_is_zero_and_reads_a_large_size() {
        let zero = mutate("h264-turned.mp4", |b| {
            let body = after(b, b"tkhd", b"tkhd") + 4;
            b[body + 76..body + 84].fill(0);
        });
        let header = parse_video(&zero).unwrap();
        assert_eq!((header.width, header.height), (36, 64));
        // The same file with a 16-byte header on its mdat box.
        let bytes = fixture("h264-late-moov.mp4");
        let at = after(&bytes, b"mdat", b"mdat") - 4;
        let size = u32::from_be_bytes(bytes[at..at + 4].try_into().unwrap());
        let mut large = bytes[..at].to_vec();
        large.extend(1u32.to_be_bytes());
        large.extend(b"mdat");
        large.extend((u64::from(size) + 8).to_be_bytes());
        large.extend(&bytes[at + 8..]);
        // The chunk offsets now point 8 bytes early; the parser does not read them.
        assert_eq!(parse_video(&large).unwrap().video_codec, VideoCodec::H264);
        let mut short = large.clone();
        short[at + 15] = 7;
        rejects(&short, "box size");
    }

    // WebM rules, on small hand-built files.
    fn el(id: u32, body: &[u8]) -> Vec<u8> {
        let mut out: Vec<u8> = id
            .to_be_bytes()
            .into_iter()
            .skip_while(|b| *b == 0)
            .collect();
        out.push(0x01);
        out.extend(&(body.len() as u64).to_be_bytes()[1..]);
        out.extend(body);
        out
    }
    fn uint(id: u32, value: u64) -> Vec<u8> {
        el(id, &value.to_be_bytes())
    }
    fn header(doc: &str) -> Vec<u8> {
        el(0x1A45_DFA3, &el(0x4282, doc.as_bytes()))
    }
    fn info(duration: Option<f64>) -> Vec<u8> {
        let mut body = uint(0x2A_D7B1, 1_000_000);
        if let Some(d) = duration {
            body.extend(el(0x4489, &d.to_be_bytes()));
        }
        el(0x1549_A966, &body)
    }
    fn track(kind: u64, codec: &str, extra: &[u8]) -> Vec<u8> {
        let mut body = uint(0x83, kind);
        body.extend(el(0x86, codec.as_bytes()));
        body.extend(extra);
        el(0xAE, &body)
    }
    fn picture(width: u64, height: u64, extra: &[u8]) -> Vec<u8> {
        let mut body = uint(0xB0, width);
        body.extend(uint(0xBA, height));
        body.extend(extra);
        el(0xE0, &body)
    }
    fn tracks(entries: &[Vec<u8>]) -> Vec<u8> {
        el(0x1654_AE6B, &entries.concat())
    }
    fn webm(doc: &str, children: &[Vec<u8>]) -> Vec<u8> {
        let mut out = header(doc);
        out.extend(el(0x1853_8067, &children.concat()));
        out
    }
    fn cluster() -> Vec<u8> {
        el(0x1F43_B675, &uint(0xE7, 0))
    }
    fn vp9() -> Vec<u8> {
        track(1, "V_VP9", &picture(64, 36, &[]))
    }

    #[test]
    fn reads_a_small_webm() {
        let bytes = webm("webm", &[info(Some(1500.0)), tracks(&[vp9()]), cluster()]);
        let header = parse_video(&bytes).unwrap();
        assert_eq!(
            header,
            VideoHeader {
                format: AssetFormat::Webm,
                width: 64,
                height: 36,
                duration_ms: 1500,
                video_codec: VideoCodec::Vp9,
                audio_codec: None,
                alpha: false,
            }
        );
        // Display fields with DisplayUnit 0 give the display size; another unit keeps the coded size.
        let mut display = uint(0x54B0, 32);
        display.extend(uint(0x54BA, 32));
        let square = track(1, "V_VP8", &picture(64, 36, &display));
        let header = parse_video(&webm("webm", &[info(Some(1500.0)), tracks(&[square])])).unwrap();
        assert_eq!((header.width, header.height), (32, 32));
        display.extend(uint(0x54B2, 3));
        let ratio = track(1, "V_VP8", &picture(64, 36, &display));
        let header = parse_video(&webm("webm", &[info(Some(1500.0)), tracks(&[ratio])])).unwrap();
        assert_eq!((header.width, header.height), (64, 36));
        // The Vorbis audio track and the alpha flag.
        let alpha = track(1, "V_VP8", &picture(64, 36, &uint(0x53C0, 1)));
        let vorbis = track(2, "A_VORBIS", &[]);
        let header =
            parse_video(&webm("webm", &[tracks(&[vorbis, alpha]), info(Some(10.0))])).unwrap();
        assert_eq!(header.audio_codec, Some(VideoAudioCodec::Vorbis));
        assert!(header.alpha);
    }
    #[test]
    fn rejects_another_doc_type() {
        rejects(
            &webm("matroska", &[info(Some(1500.0)), tracks(&[vp9()])]),
            "DocType",
        );
        let mut renamed = fixture("vp9-opus.webm");
        let at = after(&renamed, b"\x42\x82", b"webm");
        renamed[at..at + 4].copy_from_slice(b"mkv\0");
        rejects(&renamed, "DocType");
    }
    #[test]
    fn rejects_a_cluster_before_the_tracks() {
        rejects(
            &webm("webm", &[info(Some(1500.0)), cluster(), tracks(&[vp9()])]),
            HEADER_NOT_FOUND,
        );
        rejects(&webm("webm", &[info(Some(1500.0))]), HEADER_NOT_FOUND);
        // An unknown-size Cluster before the Tracks.
        let mut bytes = header("webm");
        let mut segment = info(Some(1500.0));
        segment.extend([0x1F, 0x43, 0xB6, 0x75, 0xFF, 0xE7, 0x81, 0x00]);
        bytes.extend([0x18, 0x53, 0x80, 0x67, 0xFF]);
        bytes.extend(segment);
        rejects(&bytes, HEADER_NOT_FOUND);
    }
    #[test]
    fn rejects_a_missing_or_bad_duration() {
        rejects(&webm("webm", &[info(None), tracks(&[vp9()])]), NO_DURATION);
        for value in [0.0, -1.0, f64::NAN, f64::INFINITY] {
            rejects(
                &webm("webm", &[info(Some(value)), tracks(&[vp9()])]),
                NO_DURATION,
            );
        }
        rejects(
            &webm("webm", &[info(Some(14_400_001.0)), tracks(&[vp9()])]),
            "duration is outside",
        );
    }
    #[test]
    fn rejects_content_encodings_and_other_codecs() {
        let encoded = track(
            1,
            "V_VP9",
            &[picture(64, 36, &[]), el(0x6D80, &[])].concat(),
        );
        rejects(
            &webm("webm", &[info(Some(1.0)), tracks(&[encoded])]),
            "content encoding",
        );
        let encoded_audio = track(2, "A_OPUS", &el(0x6D80, &[]));
        rejects(
            &webm("webm", &[info(Some(1.0)), tracks(&[vp9(), encoded_audio])]),
            "content encoding",
        );
        let ac3 = track(2, "A_AC3", &[]);
        rejects(
            &webm("webm", &[info(Some(1.0)), tracks(&[vp9(), ac3])]),
            AUDIO_CODEC,
        );
        let avc = track(1, "V_MPEG4/ISO/AVC", &picture(64, 36, &[]));
        rejects(
            &webm("webm", &[info(Some(1.0)), tracks(&[avc])]),
            VIDEO_CODEC,
        );
        let av1_alpha = track(1, "V_AV1", &picture(64, 36, &uint(0x53C0, 1)));
        rejects(
            &webm("webm", &[info(Some(1.0)), tracks(&[av1_alpha])]),
            VIDEO_CODEC,
        );
    }
    #[test]
    fn rejects_no_video_track_and_bad_sizes() {
        let opus = track(2, "A_OPUS", &[]);
        rejects(
            &webm("webm", &[info(Some(1.0)), tracks(&[opus])]),
            NO_VIDEO_TRACK,
        );
        let large = track(1, "V_VP9", &picture(5000, 36, &[]));
        rejects(
            &webm("webm", &[info(Some(1.0)), tracks(&[large])]),
            "coded size",
        );
        let mut display = uint(0x54B0, 5000);
        display.extend(uint(0x54BA, 36));
        let wide = track(1, "V_VP9", &picture(64, 36, &display));
        rejects(
            &webm("webm", &[info(Some(1.0)), tracks(&[wide])]),
            "display size",
        );
        // An unknown size is allowed only for Segment and Cluster.
        let mut unknown = header("webm");
        unknown.extend([0x18, 0x53, 0x80, 0x67, 0xFF, 0x15, 0x49, 0xA9, 0x66, 0xFF]);
        rejects(&unknown, "unknown element size");
    }
}
