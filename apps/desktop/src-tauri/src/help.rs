//! Handbook pages that the Help buttons open (B40a). The window sends only a topic name. The URL
//! comes from this fixed table, never from the window.
use opensekai_contracts::{AppError, ErrorCode};
use serde::Deserialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum HelpTopic {
    GettingStarted,
    Scene,
    Character,
    MotionCapture,
    VmcSender,
    Environment,
    Prop,
    Light,
    Haze,
    Screen,
    FpsCounter,
    Camera,
    Output,
    Blueprints,
    Resources,
    Settings,
}

impl HelpTopic {
    /// Every topic, in the order of `fixtures/protocol/help-topics.json`. The test `position`
    /// match keeps this list complete. Only the tests read it.
    #[cfg(test)]
    pub const ALL: [HelpTopic; 16] = [
        HelpTopic::GettingStarted,
        HelpTopic::Scene,
        HelpTopic::Character,
        HelpTopic::MotionCapture,
        HelpTopic::VmcSender,
        HelpTopic::Environment,
        HelpTopic::Prop,
        HelpTopic::Light,
        HelpTopic::Haze,
        HelpTopic::Screen,
        HelpTopic::FpsCounter,
        HelpTopic::Camera,
        HelpTopic::Output,
        HelpTopic::Blueprints,
        HelpTopic::Resources,
        HelpTopic::Settings,
    ];
}

/// Reads the topic name from the window. A name outside the enum gives `INVALID_INPUT`, so the
/// window gets the same error shape as every other command.
pub fn parse_topic(name: &str) -> Result<HelpTopic, AppError> {
    serde_json::from_value(serde_json::Value::String(name.into())).map_err(|_| AppError {
        code: ErrorCode::InvalidInput,
        message: "Unknown help topic".into(),
        ids: vec![],
    })
}

pub fn help_url(topic: HelpTopic) -> &'static str {
    macro_rules! page {
        ($path:literal) => {
            concat!(
                "https://github.com/danirukun/opensekai/blob/main/docs/handbook/",
                $path
            )
        };
    }
    match topic {
        HelpTopic::GettingStarted => page!("getting-started.md"),
        HelpTopic::Scene => page!("scene.md"),
        HelpTopic::Character => page!("characters.md"),
        HelpTopic::MotionCapture => page!("motion-capture.md"),
        HelpTopic::VmcSender => page!("motion-capture.md#vmc-sender"),
        HelpTopic::Environment => page!("stage.md"),
        HelpTopic::Prop => page!("stage.md"),
        HelpTopic::Light => page!("stage.md#lights"),
        HelpTopic::Haze => page!("stage.md"),
        HelpTopic::Screen => page!("stage.md"),
        HelpTopic::FpsCounter => page!("stage.md#fps-counter"),
        HelpTopic::Camera => page!("cameras-and-output.md"),
        HelpTopic::Output => page!("cameras-and-output.md#output"),
        HelpTopic::Blueprints => page!("blueprints.md"),
        HelpTopic::Resources => page!("settings.md#resources"),
        HelpTopic::Settings => page!("settings.md"),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    const PREFIX: &str = "https://github.com/danirukun/opensekai/blob/main/docs/handbook/";

    fn fixture() -> Vec<String> {
        serde_json::from_str(include_str!(
            "../../../../fixtures/protocol/help-topics.json"
        ))
        .unwrap()
    }

    /// The exhaustive match makes a new variant fail to compile here until it has a position.
    /// The test below then requires the variant at that position in `HelpTopic::ALL`.
    fn position(topic: HelpTopic) -> usize {
        match topic {
            HelpTopic::GettingStarted => 0,
            HelpTopic::Scene => 1,
            HelpTopic::Character => 2,
            HelpTopic::MotionCapture => 3,
            HelpTopic::VmcSender => 4,
            HelpTopic::Environment => 5,
            HelpTopic::Prop => 6,
            HelpTopic::Light => 7,
            HelpTopic::Haze => 8,
            HelpTopic::Screen => 9,
            HelpTopic::FpsCounter => 10,
            HelpTopic::Camera => 11,
            HelpTopic::Output => 12,
            HelpTopic::Blueprints => 13,
            HelpTopic::Resources => 14,
            HelpTopic::Settings => 15,
        }
    }

    fn topics() -> Vec<HelpTopic> {
        fixture()
            .iter()
            .map(|name| parse_topic(name).unwrap())
            .collect()
    }

    #[test]
    fn all_topics_are_complete_and_equal_the_fixture() {
        for (index, topic) in HelpTopic::ALL.into_iter().enumerate() {
            assert_eq!(position(topic), index, "{topic:?}");
        }
        assert_eq!(topics(), HelpTopic::ALL.to_vec());
    }

    /// GitHub makes a heading anchor in lower case, with a hyphen for each space, and drops
    /// punctuation other than hyphens and underscores.
    fn slug(heading: &str) -> String {
        heading
            .trim()
            .to_lowercase()
            .chars()
            .filter_map(|c| match c {
                ' ' => Some('-'),
                c if c.is_alphanumeric() || c == '-' || c == '_' => Some(c),
                _ => None,
            })
            .collect()
    }

    #[test]
    fn every_fixture_topic_parses_and_an_unknown_name_is_invalid() {
        assert_eq!(topics().len(), fixture().len());
        for name in ["", "Scene", "../scene", "https://example.com", "help"] {
            let error = parse_topic(name).unwrap_err();
            assert_eq!(error.code, ErrorCode::InvalidInput);
            assert_eq!(error.message, "Unknown help topic");
        }
    }

    #[test]
    fn every_url_is_in_the_repository_handbook() {
        for topic in topics() {
            let url = help_url(topic);
            assert!(url.starts_with(PREFIX), "{url}");
            let page = url[PREFIX.len()..].split('#').next().unwrap();
            assert!(page.ends_with(".md") && !page.contains('/'), "{url}");
        }
    }

    #[test]
    fn every_page_exists_and_has_the_anchor_heading() {
        let handbook = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../docs/handbook");
        for topic in topics() {
            let url = help_url(topic);
            let (page, anchor) = match url[PREFIX.len()..].split_once('#') {
                Some((page, anchor)) => (page, Some(anchor)),
                None => (&url[PREFIX.len()..], None),
            };
            let text = std::fs::read_to_string(handbook.join(page))
                .unwrap_or_else(|_| panic!("missing page {page}"));
            if let Some(anchor) = anchor {
                assert!(
                    text.lines()
                        .filter_map(|line| line.strip_prefix('#'))
                        .map(|line| line.trim_start_matches('#'))
                        .any(|heading| slug(heading) == anchor),
                    "{page} has no heading for #{anchor}"
                );
            }
        }
    }

    #[test]
    fn slug_follows_github() {
        assert_eq!(slug(" VMC sender"), "vmc-sender");
        assert_eq!(slug(" FPS counter"), "fps-counter");
        assert_eq!(slug(" Lights"), "lights");
    }
}
