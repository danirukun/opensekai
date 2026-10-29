//! YouTube chat events on the clock, the YouTube status, and the `integrationsSet` call (B25).
//! Mirrors `packages/contracts/src/youtube.ts`.
use super::*;

/// At most this many YouTube events ride one clock.
pub const MAX_YOUTUBE_CLOCK_EVENTS: usize = 8;
/// Text fields (messages, URLs) are cut to this many UTF-16 units (`MAX_BLUEPRINT_STRING_LENGTH`).
pub const MAX_YOUTUBE_TEXT: usize = 1024;
/// Names, IDs, amounts, and currencies are cut to this many UTF-16 units.
pub const MAX_YOUTUBE_NAME: usize = 256;
pub const MAX_YOUTUBE_LINK: usize = 2048;
pub const MAX_YOUTUBE_COUNT: u32 = 10_000;
const MAX_SAFE_INTEGER: u64 = 9_007_199_254_740_991;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum YouTubeStreamStatus {
    Waiting,
    Live,
    Ended,
    Error,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum YouTubeState {
    NotConnected,
    Waiting,
    Live,
    Ended,
    Error,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "camelCase",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum YouTubeEvent {
    Chat {
        id: String,
        message: String,
        username: String,
        user_channel_id: String,
        avatar_url: String,
        is_member: bool,
        is_moderator: bool,
        is_owner: bool,
        is_verified: bool,
    },
    SuperChat {
        id: String,
        message: String,
        username: String,
        user_channel_id: String,
        avatar_url: String,
        amount: String,
        amount_micros: u64,
        currency: String,
        tier_color: String,
    },
    SuperSticker {
        id: String,
        sticker_name: String,
        sticker_image_url: String,
        username: String,
        user_channel_id: String,
        amount: String,
        currency: String,
    },
    NewMember {
        id: String,
        username: String,
        user_channel_id: String,
        avatar_url: String,
        level_name: String,
    },
    MemberMilestone {
        id: String,
        username: String,
        user_channel_id: String,
        months: u32,
        message: String,
    },
    GiftMemberships {
        id: String,
        username: String,
        user_channel_id: String,
        count: u32,
    },
    Status {
        status: YouTubeStreamStatus,
    },
}

fn units(text: &str) -> usize {
    text.encode_utf16().count()
}
fn text_ok(text: &str) -> bool {
    units(text) <= MAX_YOUTUBE_TEXT
}
fn name_ok(text: &str) -> bool {
    units(text) <= MAX_YOUTUBE_NAME
}
fn id_ok(id: &str) -> bool {
    !id.is_empty() && name_ok(id)
}
fn color_ok(color: &str) -> bool {
    color.len() == 7 && color.starts_with('#') && color[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

impl YouTubeEvent {
    pub fn validate(&self) -> Result<(), AppError> {
        let ok = match self {
            YouTubeEvent::Chat {
                id,
                message,
                username,
                user_channel_id,
                avatar_url,
                ..
            } => {
                id_ok(id)
                    && text_ok(message)
                    && name_ok(username)
                    && name_ok(user_channel_id)
                    && text_ok(avatar_url)
            }
            YouTubeEvent::SuperChat {
                id,
                message,
                username,
                user_channel_id,
                avatar_url,
                amount,
                amount_micros,
                currency,
                tier_color,
            } => {
                id_ok(id)
                    && text_ok(message)
                    && name_ok(username)
                    && name_ok(user_channel_id)
                    && text_ok(avatar_url)
                    && name_ok(amount)
                    && *amount_micros <= MAX_SAFE_INTEGER
                    && name_ok(currency)
                    && (tier_color.is_empty() || color_ok(tier_color))
            }
            YouTubeEvent::SuperSticker {
                id,
                sticker_name,
                sticker_image_url,
                username,
                user_channel_id,
                amount,
                currency,
            } => {
                id_ok(id)
                    && name_ok(sticker_name)
                    && text_ok(sticker_image_url)
                    && name_ok(username)
                    && name_ok(user_channel_id)
                    && name_ok(amount)
                    && name_ok(currency)
            }
            YouTubeEvent::NewMember {
                id,
                username,
                user_channel_id,
                avatar_url,
                level_name,
            } => {
                id_ok(id)
                    && name_ok(username)
                    && name_ok(user_channel_id)
                    && text_ok(avatar_url)
                    && name_ok(level_name)
            }
            YouTubeEvent::MemberMilestone {
                id,
                username,
                user_channel_id,
                months,
                message,
            } => {
                id_ok(id)
                    && name_ok(username)
                    && name_ok(user_channel_id)
                    && *months <= MAX_YOUTUBE_COUNT
                    && text_ok(message)
            }
            YouTubeEvent::GiftMemberships {
                id,
                username,
                user_channel_id,
                count,
            } => {
                id_ok(id)
                    && name_ok(username)
                    && name_ok(user_channel_id)
                    && *count <= MAX_YOUTUBE_COUNT
            }
            YouTubeEvent::Status { .. } => true,
        };
        require(ok, "invalid YouTube event")
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct YouTubeInput {
    pub events: Vec<YouTubeEvent>,
}
impl YouTubeInput {
    pub fn validate(&self) -> Result<(), AppError> {
        require(
            (1..=MAX_YOUTUBE_CLOCK_EVENTS).contains(&self.events.len()),
            "invalid YouTube event count",
        )?;
        self.events.iter().try_for_each(YouTubeEvent::validate)
    }
}

object!(YouTubeStatus {
    link: Option<String>,
    state: YouTubeState,
    error: Option<String>,
    video_id: Option<String>,
    items: u64,
    skipped: u64,
    redemptions: u64,
    dropped: u64
});
impl Validate for YouTubeStatus {
    fn validate(&self) -> Result<(), AppError> {
        let count = |n: u64| n <= MAX_SAFE_INTEGER;
        require(
            self.link
                .as_ref()
                .is_none_or(|l| !l.is_empty() && units(l) <= MAX_YOUTUBE_LINK)
                && self.error.as_ref().is_none_or(|e| name_ok(e))
                && (self.error.is_some() == (self.state == YouTubeState::Error))
                && self.video_id.as_ref().is_none_or(|v| id_ok(v))
                && count(self.items)
                && count(self.skipped)
                && count(self.redemptions)
                && count(self.dropped),
            "invalid YouTube status",
        )
    }
}

object!(YouTubeLinkParams {
    link: Option<String>
});
object!(IntegrationsSetParams {
    youtube: YouTubeLinkParams
});
impl Validate for IntegrationsSetParams {
    fn validate(&self) -> Result<(), AppError> {
        require(
            self.youtube
                .link
                .as_ref()
                .is_none_or(|l| units(l) <= MAX_YOUTUBE_LINK),
            "invalid YouTube link",
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn chat(message: String) -> YouTubeEvent {
        YouTubeEvent::Chat {
            id: "i".repeat(MAX_YOUTUBE_NAME),
            message,
            username: "ü".repeat(MAX_YOUTUBE_NAME),
            user_channel_id: "U".repeat(MAX_YOUTUBE_NAME),
            avatar_url: "a".repeat(MAX_YOUTUBE_TEXT),
            is_member: true,
            is_moderator: true,
            is_owner: true,
            is_verified: true,
        }
    }

    #[test]
    fn events_use_the_wire_names() {
        let value = json!({"kind": "superChat", "id": "c1", "message": "", "username": "Ada", "userChannelId": "UC1", "avatarUrl": "https://example.com/a.png", "amount": "$5.00", "amountMicros": 5_000_000, "currency": "USD", "tierColor": "#1DE9B6"});
        let event: YouTubeEvent = serde_json::from_value(value.clone()).unwrap();
        assert!(event.validate().is_ok());
        assert_eq!(serde_json::to_value(&event).unwrap(), value);
        let status = json!({"kind": "status", "status": "ended"});
        assert_eq!(
            serde_json::from_value::<YouTubeEvent>(status).unwrap(),
            YouTubeEvent::Status {
                status: YouTubeStreamStatus::Ended
            }
        );
    }

    #[test]
    fn rejects_long_text_and_bad_counts() {
        assert!(chat("m".repeat(MAX_YOUTUBE_TEXT)).validate().is_ok());
        assert!(chat("m".repeat(MAX_YOUTUBE_TEXT + 1)).validate().is_err());
        // A character outside the BMP counts as two units, as in JavaScript.
        assert!(chat("😀".repeat(MAX_YOUTUBE_TEXT / 2 + 1))
            .validate()
            .is_err());
        let gift = |count| YouTubeEvent::GiftMemberships {
            id: "g".into(),
            username: "A".into(),
            user_channel_id: "U".into(),
            count,
        };
        assert!(gift(MAX_YOUTUBE_COUNT).validate().is_ok());
        assert!(gift(MAX_YOUTUBE_COUNT + 1).validate().is_err());
        let input = |n| YouTubeInput {
            events: vec![chat("m".into()); n],
        };
        assert!(input(0).validate().is_err());
        assert!(input(8).validate().is_ok());
        assert!(input(9).validate().is_err());
    }

    /// R10: eight events of maximum-length multi-byte strings, full device input, and tracking
    /// samples fit the large clock limit.
    #[test]
    fn the_largest_youtube_clock_fits_with_devices_and_tracking() {
        let event = YouTubeEvent::Chat {
            id: "i".repeat(MAX_YOUTUBE_NAME),
            message: "あ".repeat(MAX_YOUTUBE_TEXT),
            username: "あ".repeat(MAX_YOUTUBE_NAME),
            user_channel_id: "U".repeat(MAX_YOUTUBE_NAME),
            avatar_url: "a".repeat(MAX_YOUTUBE_TEXT),
            is_member: true,
            is_moderator: true,
            is_owner: true,
            is_verified: true,
        };
        let events = vec![event; MAX_YOUTUBE_CLOCK_EVENTS];
        let bytes = json!({ "events": events }).to_string().len();
        // The host budget (24 KiB) never takes all eight of these; the schema still accepts them.
        assert!(bytes > 24 * 1024, "{bytes}");
        let pointer = json!({"x": -15.1234, "y": -15.1234, "buttons": ["left", "right", "middle"]});
        let clock = json!({"kind": "clock", "sessionId": "s", "elapsedMs": 1, "input": {
            "events": vec![json!({"kind": "keystroke", "accelerator": "Control+Alt+Shift+Super+ArrowRight"}); 16],
            "held": vec!["ArrowRight"; 16],
            "devices": {"events": vec![json!({"kind": "midiNote", "channel": 16, "note": 127, "velocity": 127, "on": false}); 32], "pointer": pointer},
            "youtube": {"events": events}
        }});
        let text = clock.to_string();
        assert!(text.len() < MAX_TRACKING_CLOCK_BYTES, "{}", text.len());
        assert!(parse_wire(text.as_bytes()).is_ok());
    }

    #[test]
    fn status_error_text_only_in_error() {
        let status = |state, error: Option<&str>| YouTubeStatus {
            link: Some("https://youtu.be/aaaaaaaaaaa".into()),
            state,
            error: error.map(Into::into),
            video_id: None,
            items: 0,
            skipped: 0,
            redemptions: 0,
            dropped: 0,
        };
        assert!(status(YouTubeState::Live, None).validate().is_ok());
        assert!(status(YouTubeState::Error, Some("Network"))
            .validate()
            .is_ok());
        assert!(status(YouTubeState::Error, None).validate().is_err());
        assert!(status(YouTubeState::Live, Some("Network"))
            .validate()
            .is_err());
    }
}
