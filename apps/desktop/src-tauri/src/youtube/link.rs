//! Stream link parsing (B25 R4). The host builds every channel URL from the checked parts only.

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StreamTarget {
    /// An 11-character video ID.
    Video(String),
    /// A checked channel path such as `/@handle`, `/channel/UC…`, or `/c/name`.
    Channel(String),
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkError {
    NotYouTube,
    NoVideoId,
    NotChannelOrVideo,
}
impl LinkError {
    pub fn reason(self) -> &'static str {
        match self {
            LinkError::NotYouTube => "Not a YouTube link",
            LinkError::NoVideoId => "No video ID",
            LinkError::NotChannelOrVideo => "Not a channel or video link",
        }
    }
}

fn id_char(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '-'
}
fn name_char(c: char) -> bool {
    id_char(c) || c == '.'
}
pub fn is_video_id(id: &str) -> bool {
    id.len() == 11 && id.chars().all(id_char)
}
fn name_ok(name: &str, min: usize, max: usize) -> bool {
    (min..=max).contains(&name.len()) && name.chars().all(name_char) && !name.contains("..")
}

/// The path without a query or a fragment, and the query.
fn split_query(rest: &str) -> (&str, &str) {
    let rest = rest.split('#').next().unwrap_or_default();
    match rest.split_once('?') {
        Some((path, query)) => (path, query),
        None => (rest, ""),
    }
}

fn video(id: &str) -> Result<StreamTarget, LinkError> {
    if is_video_id(id) {
        Ok(StreamTarget::Video(id.into()))
    } else {
        Err(LinkError::NoVideoId)
    }
}

/// A channel path with an optional `/live`, `/featured`, or `/` suffix. No query, fragment,
/// or other character is allowed.
fn channel(path: &str) -> Result<StreamTarget, LinkError> {
    let base = ["/live", "/featured", "/"]
        .iter()
        .find_map(|suffix| path.strip_suffix(suffix))
        .unwrap_or(path);
    let ok = if let Some(handle) = base.strip_prefix("/@") {
        name_ok(handle, 3, 30)
    } else if let Some(id) = base.strip_prefix("/channel/UC") {
        id.len() == 22 && id.chars().all(id_char)
    } else if let Some(name) = base.strip_prefix("/c/") {
        name_ok(name, 1, 100)
    } else {
        false
    };
    if ok {
        Ok(StreamTarget::Channel(base.into()))
    } else {
        Err(LinkError::NotChannelOrVideo)
    }
}

pub fn parse_stream_link(text: &str) -> Result<StreamTarget, LinkError> {
    let text = text.trim();
    let lower = text.to_ascii_lowercase();
    let rest = if lower.starts_with("https://") {
        &text[8..]
    } else if lower.starts_with("http://") {
        &text[7..]
    } else if text.contains("://") {
        return Err(LinkError::NotYouTube);
    } else {
        text
    };
    let split = rest.find(['/', '?', '#']).unwrap_or(rest.len());
    let (host, tail) = rest.split_at(split);
    let host = host.to_ascii_lowercase();
    if host == "youtu.be" {
        let (path, _) = split_query(tail);
        return video(path.strip_prefix('/').unwrap_or_default());
    }
    if !matches!(
        host.as_str(),
        "youtube.com" | "www.youtube.com" | "m.youtube.com"
    ) {
        return Err(LinkError::NotYouTube);
    }
    if tail.starts_with("/@") || tail.starts_with("/channel/") || tail.starts_with("/c/") {
        return channel(tail);
    }
    let (path, query) = split_query(tail);
    if path == "/watch" {
        let id = query
            .split('&')
            .find_map(|pair| pair.strip_prefix("v="))
            .unwrap_or_default();
        return video(id);
    }
    if let Some(id) = path.strip_prefix("/live/") {
        return video(id.strip_suffix('/').unwrap_or(id));
    }
    Err(LinkError::NotChannelOrVideo)
}

/// The `/live` page of a checked channel path.
pub fn channel_live_url(base: &str, path: &str) -> String {
    format!("{base}{path}/live")
}

#[cfg(test)]
mod tests {
    use super::*;
    const ID: &str = "dQw4w9WgXcQ";

    #[test]
    fn accepts_each_video_form() {
        for link in [
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://www.youtube.com/watch?feature=share&v=dQw4w9WgXcQ&t=10",
            "  http://youtube.com/watch?v=dQw4w9WgXcQ#chat  ",
            "m.youtube.com/watch?v=dQw4w9WgXcQ",
            "https://youtu.be/dQw4w9WgXcQ",
            "https://YOUTU.BE/dQw4w9WgXcQ?si=abc",
            "https://www.youtube.com/live/dQw4w9WgXcQ",
            "https://www.youtube.com/live/dQw4w9WgXcQ?si=abc",
        ] {
            assert_eq!(
                parse_stream_link(link),
                Ok(StreamTarget::Video(ID.into())),
                "{link}"
            );
        }
    }

    #[test]
    fn accepts_each_channel_form() {
        let channel = |p: &str| Ok(StreamTarget::Channel(p.into()));
        assert_eq!(
            parse_stream_link("https://www.youtube.com/@Some.Channel_1"),
            channel("/@Some.Channel_1")
        );
        assert_eq!(
            parse_stream_link("www.youtube.com/@abc/live"),
            channel("/@abc")
        );
        assert_eq!(
            parse_stream_link("https://youtube.com/@abc/featured"),
            channel("/@abc")
        );
        assert_eq!(
            parse_stream_link("https://www.youtube.com/@abc/"),
            channel("/@abc")
        );
        assert_eq!(
            parse_stream_link("https://www.youtube.com/channel/UCabcdefghijklmnopqrstuv"),
            channel("/channel/UCabcdefghijklmnopqrstuv")
        );
        assert_eq!(
            parse_stream_link("https://www.youtube.com/c/name"),
            channel("/c/name")
        );
        assert_eq!(
            channel_live_url("https://www.youtube.com", "/@abc"),
            "https://www.youtube.com/@abc/live"
        );
    }

    #[test]
    fn rejects_other_links_with_a_reason() {
        for (link, error) in [
            (
                "https://example.com/watch?v=dQw4w9WgXcQ",
                LinkError::NotYouTube,
            ),
            ("ftp://youtube.com/@abc", LinkError::NotYouTube),
            (
                "https://www.youtube.com.evil.com/@abc",
                LinkError::NotYouTube,
            ),
            ("https://www.youtube.com:8080/@abc", LinkError::NotYouTube),
            (
                "https://www.youtube.com/watch?v=short",
                LinkError::NoVideoId,
            ),
            ("https://www.youtube.com/watch", LinkError::NoVideoId),
            ("https://youtu.be/", LinkError::NoVideoId),
            ("https://youtu.be/dQw4w9WgXc!", LinkError::NoVideoId),
            ("https://www.youtube.com/live/abc", LinkError::NoVideoId),
            ("https://www.youtube.com/", LinkError::NotChannelOrVideo),
            ("https://www.youtube.com/feed", LinkError::NotChannelOrVideo),
            (
                "https://www.youtube.com/@a/../b",
                LinkError::NotChannelOrVideo,
            ),
            (
                "https://www.youtube.com/@name?x",
                LinkError::NotChannelOrVideo,
            ),
            (
                "https://www.youtube.com/@na%2Fme",
                LinkError::NotChannelOrVideo,
            ),
            (
                "https://www.youtube.com/@na#me",
                LinkError::NotChannelOrVideo,
            ),
            ("https://www.youtube.com/@ab", LinkError::NotChannelOrVideo),
            (
                "https://www.youtube.com/@a..bc",
                LinkError::NotChannelOrVideo,
            ),
            ("https://www.youtube.com/c/", LinkError::NotChannelOrVideo),
            (
                "https://www.youtube.com/c/a/b",
                LinkError::NotChannelOrVideo,
            ),
            (
                "https://www.youtube.com/channel/UCshort",
                LinkError::NotChannelOrVideo,
            ),
            (
                "https://www.youtube.com/channel/XXabcdefghijklmnopqrstuv",
                LinkError::NotChannelOrVideo,
            ),
            ("not a link", LinkError::NotYouTube),
        ] {
            assert_eq!(parse_stream_link(link), Err(error), "{link}");
        }
        assert_eq!(LinkError::NoVideoId.reason(), "No video ID");
    }
}
