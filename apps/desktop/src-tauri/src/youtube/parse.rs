//! Pure parsing of the YouTube pages and the live chat replies (B25 R5 to R9). Only this module
//! knows the shape of the InnerTube JSON, so a change of that shape needs a fix here only.
use super::link::is_video_id;
use opensekai_contracts::{YouTubeEvent, MAX_YOUTUBE_COUNT, MAX_YOUTUBE_NAME, MAX_YOUTUBE_TEXT};
use serde_json::{Map, Value};

/// One chat item of the live chat: the renderer `id`, the server `timestampUsec`, and the event.
#[derive(Debug, Clone, PartialEq)]
pub struct ChatItem {
    pub id: String,
    pub timestamp_usec: u64,
    pub event: YouTubeEvent,
}

/// The chat items of one action list, and what was not turned into an event.
#[derive(Debug, Default, Clone, PartialEq)]
pub struct Actions {
    pub items: Vec<ChatItem>,
    pub skipped: u64,
    pub redemptions: u64,
    /// An explicit end signal (`liveChatEndedRenderer`) was in the list.
    pub ended: bool,
}

/// The InnerTube values that the poll request needs.
#[derive(Debug, Clone, PartialEq)]
pub struct Innertube {
    pub api_key: String,
    pub context: Value,
}

#[derive(Debug, Clone, PartialEq)]
pub enum ChatPage {
    /// A live chat: the poll values, the first continuation, and the chat items on the page.
    Live {
        innertube: Innertube,
        continuation: String,
        backlog: Actions,
    },
    /// No live chat renderer: the stream has not started, or it has no chat.
    NoChat,
    /// A replay of a finished stream.
    Replay,
    /// The page has a chat renderer, but a needed value is missing.
    Changed,
}

/// A parsed poll reply.
#[derive(Debug, Clone, PartialEq)]
pub struct PollReply {
    pub actions: Actions,
    /// The next continuation and the server `timeoutMs`.
    pub next: Option<(String, Option<u64>)>,
}

/// The wait before the next poll: never below the server value, and at least 1 s (R7).
pub fn poll_wait(timeout_ms: Option<u64>) -> u64 {
    timeout_ms.unwrap_or(1000).max(1000)
}

/// The end of the JSON value that starts at `start` (an object or an array), string-aware.
fn json_end(text: &str, start: usize) -> Option<usize> {
    let bytes = text.as_bytes();
    let (mut depth, mut in_string, mut escaped) = (0usize, false, false);
    for (offset, &b) in bytes[start..].iter().enumerate() {
        if in_string {
            match b {
                _ if escaped => escaped = false,
                b'\\' => escaped = true,
                b'"' => in_string = false,
                _ => {}
            }
            continue;
        }
        match b {
            b'"' => in_string = true,
            b'{' | b'[' => depth += 1,
            b'}' | b']' => {
                depth = depth.checked_sub(1)?;
                if depth == 0 {
                    return Some(start + offset + 1);
                }
            }
            _ => {}
        }
    }
    None
}

/// The JSON object after each occurrence of `marker`.
fn objects_after<'a>(html: &'a str, marker: &'a str) -> impl Iterator<Item = Value> + 'a {
    html.match_indices(marker).filter_map(move |(at, _)| {
        let from = at + marker.len();
        let start = from + html[from..].find('{')?;
        // The object must start right after the marker, apart from `=`, `(`, and spaces.
        if !html[from..start]
            .chars()
            .all(|c| c.is_whitespace() || matches!(c, '=' | '(' | ']' | '"'))
        {
            return None;
        }
        serde_json::from_str(&html[start..json_end(html, start)?]).ok()
    })
}

/// The video ID of the canonical watch link of a channel `/live` page.
pub fn canonical_video_id(html: &str) -> Option<String> {
    let at = html.find("<link rel=\"canonical\" href=\"")?;
    let rest = &html[at + 28..];
    let href = &rest[..rest.find('"')?];
    let id = href.strip_prefix("https://www.youtube.com/watch?v=")?;
    is_video_id(id).then(|| id.to_string())
}

/// The `/live` page marks its video as finished: `isLiveNow` false and an end time.
pub fn page_finished(html: &str) -> bool {
    html.contains("\"isLiveNow\":false") && html.contains("\"endTimestamp\"")
}

fn innertube(html: &str) -> Option<Innertube> {
    let mut config = Map::new();
    for value in objects_after(html, "ytcfg.set(") {
        if let Value::Object(object) = value {
            config.extend(object);
        }
    }
    let api_key = config.get("INNERTUBE_API_KEY")?.as_str()?.to_string();
    let mut context = config.get("INNERTUBE_CONTEXT")?.clone();
    let client = context.get_mut("client")?.as_object_mut()?;
    if !client.contains_key("clientVersion") {
        let version = config.get("INNERTUBE_CLIENT_VERSION")?.clone();
        client.insert("clientVersion".into(), version);
    }
    client.insert("hl".into(), "en".into());
    client.insert("gl".into(), "US".into());
    Some(Innertube { api_key, context })
}

fn continuation_of(entry: &Value) -> Option<(String, Option<u64>)> {
    [
        "invalidationContinuationData",
        "timedContinuationData",
        "reloadContinuationData",
    ]
    .iter()
    .find_map(|key| {
        let data = entry.get(*key)?;
        Some((
            data.get("continuation")?.as_str()?.to_string(),
            data.get("timeoutMs").and_then(Value::as_u64),
        ))
    })
}

/// The "Live chat" (all messages) option of the view selector, never "Top chat". A two-item
/// selector without that title (a page in another language) takes the second item, which is
/// "Live chat" on the English page. Any other selector gives `None` (`Changed`). A page
/// without a selector takes its first continuation.
fn first_continuation(renderer: &Value) -> Option<String> {
    let items = renderer
        .pointer(
            "/header/liveChatHeaderRenderer/viewSelector/sortFilterSubMenuRenderer/subMenuItems",
        )
        .and_then(Value::as_array);
    if let Some(items) = items {
        fn title(item: &Value) -> &str {
            item.get("title")
                .and_then(Value::as_str)
                .unwrap_or_default()
        }
        let live = items
            .iter()
            .find(|item| title(item) == "Live chat")
            .or_else(|| (items.len() == 2 && title(&items[0]) != "Live chat").then(|| &items[1]));
        return continuation_of(live?.get("continuation")?).map(|(token, _)| token);
    }
    renderer
        .get("continuations")?
        .as_array()?
        .iter()
        .find_map(continuation_of)
        .map(|(token, _)| token)
}

/// The live chat popout page (R6).
pub fn chat_page(html: &str) -> ChatPage {
    let Some(renderer) = objects_after(html, "ytInitialData")
        .find_map(|data| data.pointer("/contents/liveChatRenderer").cloned())
    else {
        return ChatPage::NoChat;
    };
    if renderer.get("isReplay").and_then(Value::as_bool) == Some(true) {
        return ChatPage::Replay;
    }
    match (innertube(html), first_continuation(&renderer)) {
        (Some(innertube), Some(continuation)) => ChatPage::Live {
            innertube,
            continuation,
            backlog: parse_actions(renderer.get("actions").unwrap_or(&Value::Null)),
        },
        _ => ChatPage::Changed,
    }
}

/// A `get_live_chat` reply (R7). `None` when it has no live chat continuation object.
pub fn poll_reply(body: &Value) -> Option<PollReply> {
    let chat = body.pointer("/continuationContents/liveChatContinuation")?;
    let mut actions = parse_actions(chat.get("actions").unwrap_or(&Value::Null));
    actions.ended |= chat.get("liveChatEndedRenderer").is_some();
    let next = chat
        .get("continuations")
        .and_then(Value::as_array)
        .and_then(|list| list.iter().find_map(continuation_of));
    Some(PollReply { actions, next })
}

/// Cuts a string to at most `max` UTF-16 units, at a character boundary.
pub fn cut(text: &str, max: usize) -> String {
    let mut units = 0;
    text.chars()
        .take_while(|c| {
            units += c.len_utf16();
            units <= max
        })
        .collect()
}

/// The runs joined in order: text, a standard emoji as its ID, a custom emoji as its first
/// shortcut. `simpleText` is used as is.
fn text_of(value: Option<&Value>) -> String {
    let Some(value) = value else {
        return String::new();
    };
    if let Some(text) = value.get("simpleText").and_then(Value::as_str) {
        return text.into();
    }
    value
        .get("runs")
        .and_then(Value::as_array)
        .map(|runs| {
            runs.iter()
                .map(|run| {
                    if let Some(text) = run.get("text").and_then(Value::as_str) {
                        return text.to_string();
                    }
                    let Some(emoji) = run.get("emoji") else {
                        return String::new();
                    };
                    let custom = emoji.get("isCustomEmoji").and_then(Value::as_bool) == Some(true);
                    let shortcut = emoji.pointer("/shortcuts/0").and_then(Value::as_str);
                    let id = emoji.get("emojiId").and_then(Value::as_str);
                    if custom {
                        shortcut.or(id)
                    } else {
                        id.or(shortcut)
                    }
                    .unwrap_or_default()
                    .to_string()
                })
                .collect()
        })
        .unwrap_or_default()
}

/// The last (largest) thumbnail, with `https:` added to a `//` URL.
fn image_of(value: Option<&Value>) -> String {
    let url = value
        .and_then(|v| v.get("thumbnails"))
        .and_then(Value::as_array)
        .and_then(|list| list.last())
        .and_then(|t| t.get("url"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    let url = if url.starts_with("//") {
        format!("https:{url}")
    } else {
        url.to_string()
    };
    cut(&url, MAX_YOUTUBE_TEXT)
}

/// The first integer in a text, for example 6 in "Member for 6 months".
fn first_integer(text: &str) -> Option<u32> {
    let digits: String = text
        .chars()
        .skip_while(|c| !c.is_ascii_digit())
        .take_while(|c| c.is_ascii_digit() || *c == ',')
        .filter(char::is_ascii_digit)
        .collect();
    digits
        .parse::<u64>()
        .ok()
        .map(|n| n.min(MAX_YOUTUBE_COUNT as u64) as u32)
}

struct Author {
    username: String,
    channel: String,
    avatar: String,
}
fn author(renderer: &Value) -> Author {
    Author {
        username: cut(&text_of(renderer.get("authorName")), MAX_YOUTUBE_NAME),
        channel: cut(
            renderer
                .get("authorExternalChannelId")
                .and_then(Value::as_str)
                .unwrap_or_default(),
            MAX_YOUTUBE_NAME,
        ),
        avatar: image_of(renderer.get("authorPhoto")),
    }
}

/// `MODERATOR`, `OWNER`, and `VERIFIED` badges, and a member badge (`customThumbnail`).
fn badges(renderer: &Value) -> (bool, bool, bool, bool) {
    let list = renderer
        .get("authorBadges")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let badge = |b: &Value| b.get("liveChatAuthorBadgeRenderer").cloned();
    let icon = |kind: &str| {
        list.iter()
            .filter_map(badge)
            .any(|b| b.pointer("/icon/iconType").and_then(Value::as_str) == Some(kind))
    };
    let member = list
        .iter()
        .filter_map(badge)
        .any(|b| b.get("customThumbnail").is_some());
    (member, icon("MODERATOR"), icon("OWNER"), icon("VERIFIED"))
}

/// `#RRGGBB` from an ARGB number.
fn tier_color(value: Option<&Value>) -> String {
    value
        .and_then(Value::as_u64)
        .map(|argb| format!("#{:06X}", argb & 0xFF_FFFF))
        .unwrap_or_default()
}

/// The level name from "Welcome to <level>!", or the whole text.
fn level_name(text: &str) -> String {
    let level = text
        .strip_prefix("Welcome to ")
        .and_then(|rest| rest.split_once('!'))
        .map(|(level, _)| level)
        .unwrap_or(text);
    cut(level, MAX_YOUTUBE_NAME)
}

enum Mapped {
    Event(YouTubeEvent),
    Redemption,
    Skipped,
}

fn map_renderer(kind: &str, r: &Value, id: String) -> Mapped {
    let message = || cut(&text_of(r.get("message")), MAX_YOUTUBE_TEXT);
    let amount_text = || text_of(r.get("purchaseAmountText"));
    match kind {
        "liveChatTextMessageRenderer" => {
            let a = author(r);
            let (is_member, is_moderator, is_owner, is_verified) = badges(r);
            Mapped::Event(YouTubeEvent::Chat {
                id,
                message: message(),
                username: a.username,
                user_channel_id: a.channel,
                avatar_url: a.avatar,
                is_member,
                is_moderator,
                is_owner,
                is_verified,
            })
        }
        "liveChatPaidMessageRenderer" => {
            let a = author(r);
            let text = amount_text();
            let (amount_micros, currency) = parse_amount(&text);
            Mapped::Event(YouTubeEvent::SuperChat {
                id,
                message: message(),
                username: a.username,
                user_channel_id: a.channel,
                avatar_url: a.avatar,
                amount: cut(&text, MAX_YOUTUBE_NAME),
                amount_micros,
                currency: cut(&currency, MAX_YOUTUBE_NAME),
                tier_color: tier_color(r.get("bodyBackgroundColor")),
            })
        }
        "liveChatPaidStickerRenderer" => {
            let a = author(r);
            let text = amount_text();
            let (_, currency) = parse_amount(&text);
            Mapped::Event(YouTubeEvent::SuperSticker {
                id,
                sticker_name: cut(
                    r.pointer("/sticker/accessibility/accessibilityData/label")
                        .and_then(Value::as_str)
                        .unwrap_or_default(),
                    MAX_YOUTUBE_NAME,
                ),
                sticker_image_url: image_of(r.get("sticker")),
                username: a.username,
                user_channel_id: a.channel,
                amount: cut(&text, MAX_YOUTUBE_NAME),
                currency: cut(&currency, MAX_YOUTUBE_NAME),
            })
        }
        "liveChatMembershipItemRenderer" => {
            let a = author(r);
            match first_integer(&text_of(r.get("headerPrimaryText"))) {
                Some(months) => Mapped::Event(YouTubeEvent::MemberMilestone {
                    id,
                    username: a.username,
                    user_channel_id: a.channel,
                    months,
                    message: message(),
                }),
                None => Mapped::Event(YouTubeEvent::NewMember {
                    id,
                    username: a.username,
                    user_channel_id: a.channel,
                    avatar_url: a.avatar,
                    level_name: level_name(&text_of(r.get("headerSubtext"))),
                }),
            }
        }
        "liveChatSponsorshipsGiftPurchaseAnnouncementRenderer" => {
            let header = r
                .pointer("/header/liveChatSponsorshipsHeaderRenderer")
                .unwrap_or(&Value::Null);
            Mapped::Event(YouTubeEvent::GiftMemberships {
                id,
                username: cut(&text_of(header.get("authorName")), MAX_YOUTUBE_NAME),
                user_channel_id: author(r).channel,
                count: first_integer(&text_of(header.get("primaryText"))).unwrap_or(0),
            })
        }
        "liveChatSponsorshipsGiftRedemptionAnnouncementRenderer" => Mapped::Redemption,
        _ => Mapped::Skipped,
    }
}

/// Maps the `addChatItemAction` items of an action list (R8).
pub fn parse_actions(actions: &Value) -> Actions {
    let mut out = Actions::default();
    for action in actions.as_array().into_iter().flatten() {
        if action.get("liveChatEndedRenderer").is_some() {
            out.ended = true;
            continue;
        }
        let Some(item) = action
            .pointer("/addChatItemAction/item")
            .and_then(Value::as_object)
        else {
            out.skipped += 1;
            continue;
        };
        let Some((kind, renderer)) = item.iter().next() else {
            out.skipped += 1;
            continue;
        };
        if kind == "liveChatEndedRenderer" {
            out.ended = true;
            continue;
        }
        let id = renderer
            .get("id")
            .and_then(Value::as_str)
            .filter(|id| !id.is_empty());
        let Some(id) = id else {
            out.skipped += 1;
            continue;
        };
        let timestamp_usec = renderer
            .get("timestampUsec")
            .and_then(|t| t.as_str().and_then(|s| s.parse().ok()).or(t.as_u64()))
            .unwrap_or(0);
        let id = cut(id, MAX_YOUTUBE_NAME);
        match map_renderer(kind, renderer, id.clone()) {
            Mapped::Event(event) => out.items.push(ChatItem {
                id,
                timestamp_usec,
                event,
            }),
            Mapped::Redemption => out.redemptions += 1,
            Mapped::Skipped => out.skipped += 1,
        }
    }
    out
}

/// Symbols and prefixes that YouTube writes before an amount, longest first within a shared
/// prefix (`CA$` before `$`, `CN¥` before `¥`).
const SYMBOLS: &[(&str, &str)] = &[
    ("CA$", "CAD"),
    ("A$", "AUD"),
    ("NZ$", "NZD"),
    ("HK$", "HKD"),
    ("NT$", "TWD"),
    ("MX$", "MXN"),
    ("R$", "BRL"),
    ("$", "USD"),
    ("€", "EUR"),
    ("£", "GBP"),
    ("CN¥", "CNY"),
    ("¥", "JPY"),
    ("￥", "JPY"),
    ("₩", "KRW"),
    ("₹", "INR"),
    ("₱", "PHP"),
    ("₫", "VND"),
    ("₪", "ILS"),
];
/// The three-letter codes in the R9 table; any other three-letter code is used as is too.
const ZERO_DECIMAL: &[&str] = &[
    "BIF", "CLP", "DJF", "GNF", "ISK", "JPY", "KMF", "KRW", "PYG", "RWF", "UGX", "UYI", "VND",
    "VUV", "XAF", "XOF", "XPF",
];

/// The amount in millionths of the currency unit and the currency (R9). An unknown symbol
/// gives `(0, <symbol text>)`.
pub fn parse_amount(text: &str) -> (u64, String) {
    let text = text.trim();
    let split = text
        .find(|c: char| c.is_ascii_digit())
        .unwrap_or(text.len());
    let (symbol, number) = (text[..split].trim(), text[split..].trim());
    let code_like = |s: &str| s.len() == 3 && s.chars().all(|c| c.is_ascii_uppercase());
    let currency = SYMBOLS
        .iter()
        .find(|(s, _)| *s == symbol)
        .map(|(_, code)| code.to_string())
        .or_else(|| code_like(symbol).then(|| symbol.to_string()));
    let Some(currency) = currency else {
        return (0, symbol.to_string());
    };
    let number: String = number
        .chars()
        .take_while(|c| c.is_ascii_digit() || *c == ',' || *c == '.')
        .collect();
    let zero_decimal = ZERO_DECIMAL.contains(&currency.as_str());
    let decimal_at = number.rfind([',', '.']).filter(|&at| {
        let tail = number.len() - at - 1;
        !zero_decimal && (1..=2).contains(&tail)
    });
    let (whole, fraction) = match decimal_at {
        Some(at) => (&number[..at], &number[at + 1..]),
        None => (number.as_str(), ""),
    };
    let digits = |s: &str| s.chars().filter(char::is_ascii_digit).collect::<String>();
    let whole: u64 = digits(whole).parse().unwrap_or(0);
    let fraction = format!("{:0<6}", digits(fraction));
    let fraction: u64 = fraction[..6].parse().unwrap_or(0);
    let micros = whole
        .checked_mul(1_000_000)
        .and_then(|w| w.checked_add(fraction))
        .unwrap_or(0)
        .min(9_007_199_254_740_991);
    (micros, currency)
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn fixture(name: &str) -> String {
        std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR"))
                .join("../../../fixtures/youtube")
                .join(name),
        )
        .unwrap()
    }

    #[test]
    fn amounts_follow_the_symbol_and_the_minor_units() {
        for (text, micros, currency) in [
            ("$5.00", 5_000_000, "USD"),
            ("¥500", 500_000_000, "JPY"),
            ("¥1,000", 1_000_000_000, "JPY"),
            ("￥1,000", 1_000_000_000, "JPY"),
            ("CN¥50.00", 50_000_000, "CNY"),
            ("CA$10.00", 10_000_000, "CAD"),
            ("€1.234,56", 1_234_560_000, "EUR"),
            ("₩1,000", 1_000_000_000, "KRW"),
            ("$1,000", 1_000_000_000, "USD"),
            ("$1,000.5", 1_000_500_000, "USD"),
            ("CHF 5.00", 5_000_000, "CHF"),
            ("PLN 12,50", 12_500_000, "PLN"),
            ("₫20.000", 20_000_000_000, "VND"),
        ] {
            assert_eq!(parse_amount(text), (micros, currency.into()), "{text}");
        }
        assert_eq!(parse_amount("§5.00"), (0, "§".into()));
    }

    #[test]
    fn poll_wait_is_never_below_the_server_value() {
        assert_eq!(poll_wait(None), 1000);
        assert_eq!(poll_wait(Some(500)), 1000);
        assert_eq!(poll_wait(Some(5000)), 5000);
        assert_eq!(poll_wait(Some(90_000)), 90_000);
    }

    #[test]
    fn reads_the_canonical_link_and_the_finished_mark() {
        let live = fixture("channel-live.html");
        assert_eq!(canonical_video_id(&live).as_deref(), Some("liveVideo01"));
        assert!(!page_finished(&live));
        let ended = fixture("channel-ended.html");
        assert_eq!(canonical_video_id(&ended).as_deref(), Some("endVideo001"));
        assert!(page_finished(&ended));
        assert_eq!(canonical_video_id(&fixture("channel-offline.html")), None);
    }

    #[test]
    fn reads_the_chat_page_and_chooses_live_chat_over_top_chat() {
        let ChatPage::Live {
            innertube,
            continuation,
            backlog,
        } = chat_page(&fixture("live-chat.html"))
        else {
            panic!("expected a live chat page");
        };
        assert_eq!(innertube.api_key, "fixture-key");
        assert_eq!(
            innertube.context["client"]["clientVersion"],
            "2.20261027.00.00"
        );
        assert_eq!(innertube.context["client"]["hl"], "en");
        assert_eq!(innertube.context["client"]["gl"], "US");
        assert_eq!(continuation, "all-messages-token");
        assert_eq!(backlog.items.len(), 1);
        assert_eq!(backlog.items[0].id, "backlog_1");
        assert_eq!(
            chat_page(&fixture("live-chat-replay.html")),
            ChatPage::Replay
        );
        assert_eq!(chat_page("<html>no chat</html>"), ChatPage::NoChat);
    }

    #[test]
    fn maps_one_fixture_of_each_action_type() {
        let body: Value = serde_json::from_str(&fixture("get-live-chat.json")).unwrap();
        let reply = poll_reply(&body).unwrap();
        assert_eq!(reply.next, Some(("next-token".into(), Some(4321))));
        let actions = reply.actions;
        assert_eq!((actions.skipped, actions.redemptions), (2, 1));
        assert!(!actions.ended);
        let events: Vec<_> = actions.items.iter().map(|i| i.event.clone()).collect();
        assert_eq!(
            events,
            vec![
                YouTubeEvent::Chat {
                    id: "chat_1".into(),
                    message: "hello 😀:wave-blob:".into(),
                    username: "Viewer One".into(),
                    user_channel_id: "UC0000000000000000000001".into(),
                    avatar_url: "https://yt3.example.com/viewer-one-64.png".into(),
                    is_member: true,
                    is_moderator: true,
                    is_owner: false,
                    is_verified: true,
                },
                YouTubeEvent::SuperChat {
                    id: "superchat_1".into(),
                    message: "thanks".into(),
                    username: "Viewer Two".into(),
                    user_channel_id: "UC0000000000000000000002".into(),
                    avatar_url: "https://yt3.example.com/viewer-two.png".into(),
                    amount: "¥1,000".into(),
                    amount_micros: 1_000_000_000,
                    currency: "JPY".into(),
                    tier_color: "#1DE9B6".into(),
                },
                YouTubeEvent::SuperSticker {
                    id: "sticker_1".into(),
                    sticker_name: "Waving hand".into(),
                    sticker_image_url: "https://lh3.example.com/sticker-176.png".into(),
                    username: "Viewer Three".into(),
                    user_channel_id: "UC0000000000000000000003".into(),
                    amount: "CA$2.00".into(),
                    currency: "CAD".into(),
                },
                YouTubeEvent::NewMember {
                    id: "member_1".into(),
                    username: "Viewer Four".into(),
                    user_channel_id: "UC0000000000000000000004".into(),
                    avatar_url: "https://yt3.example.com/viewer-four.png".into(),
                    level_name: "Fan Club".into(),
                },
                YouTubeEvent::MemberMilestone {
                    id: "milestone_1".into(),
                    username: "Viewer Five".into(),
                    user_channel_id: "UC0000000000000000000005".into(),
                    months: 6,
                    message: "half a year".into(),
                },
                YouTubeEvent::GiftMemberships {
                    id: "gift_1".into(),
                    username: "Viewer Six".into(),
                    user_channel_id: "UC0000000000000000000006".into(),
                    count: 5,
                },
            ]
        );
        assert_eq!(actions.items[0].timestamp_usec, 1_761_552_000_000_000);
    }

    #[test]
    fn cuts_long_strings_and_skips_items_without_an_id() {
        let long = "あ".repeat(2000);
        let actions = parse_actions(&json!([
            {"addChatItemAction": {"item": {"liveChatTextMessageRenderer": {"id": "x", "timestampUsec": "1", "message": {"runs": [{"text": long}]}, "authorName": {"simpleText": "n".repeat(300)}}}}},
            {"addChatItemAction": {"item": {"liveChatTextMessageRenderer": {"timestampUsec": "2", "message": {"runs": [{"text": "no id"}]}}}}},
            {"addChatItemAction": {"item": {"liveChatEndedRenderer": {}}}}
        ]));
        assert_eq!(actions.items.len(), 1);
        assert_eq!(actions.skipped, 1);
        assert!(actions.ended);
        let YouTubeEvent::Chat {
            message, username, ..
        } = &actions.items[0].event
        else {
            panic!()
        };
        assert_eq!(message.chars().count(), 1024);
        assert_eq!(username.len(), 256);
        assert_eq!(cut("😀😀", 3), "😀");
    }

    #[test]
    fn a_selector_without_live_chat_is_a_changed_page() {
        let renderer = |items: serde_json::Value| json!({"header": {"liveChatHeaderRenderer": {"viewSelector": {"sortFilterSubMenuRenderer": {"subMenuItems": items}}}}, "continuations": [{"reloadContinuationData": {"continuation": "top"}}]});
        let item = |title: &str, token: &str| json!({"title": title, "continuation": {"reloadContinuationData": {"continuation": token}}});
        assert_eq!(
            first_continuation(&renderer(json!([
                item("A", "a"),
                item("B", "b"),
                item("C", "c")
            ]))),
            None
        );
        assert_eq!(
            first_continuation(&renderer(json!([item("A", "a"), item("B", "b")]))).as_deref(),
            Some("b")
        );
        assert_eq!(
            first_continuation(
                &json!({"continuations": [{"reloadContinuationData": {"continuation": "only"}}]})
            )
            .as_deref(),
            Some("only")
        );
    }

    #[test]
    fn a_reply_without_a_continuation_has_no_next() {
        let reply =
            poll_reply(&json!({"continuationContents": {"liveChatContinuation": {"actions": []}}}))
                .unwrap();
        assert_eq!(reply.next, None);
        assert!(!reply.actions.ended);
        assert!(poll_reply(&json!({"responseContext": {}})).is_none());
    }
}
