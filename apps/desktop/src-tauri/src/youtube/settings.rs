//! The user settings file `<app local data>/settings/integrations.json` (B25 R2). It holds only
//! the YouTube link; a show, a scene, a frame, or a Blueprint file never holds it.
use super::link::parse_stream_link;
use opensekai_contracts::{AppError, ErrorCode, MAX_YOUTUBE_LINK};
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct YouTubeSettings {
    link: Option<String>,
}
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct IntegrationsFile {
    youtube: YouTubeSettings,
}

/// `<app local data>/settings/integrations.json`.
pub fn settings_path(app_local_data: &Path) -> PathBuf {
    app_local_data.join("settings").join("integrations.json")
}

/// The stored link. A missing file means no link. A file that does not parse or validate is
/// logged and also means no link; the host does not overwrite it until the next save.
pub fn load(path: &Path) -> Option<String> {
    let bytes = match std::fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return None,
        Err(error) => {
            eprintln!("Integration settings unreadable: {error}");
            return None;
        }
    };
    let link = serde_json::from_slice::<IntegrationsFile>(&bytes)
        .ok()
        .and_then(|file| match file.youtube.link {
            None => Some(None),
            Some(link)
                if link.encode_utf16().count() <= MAX_YOUTUBE_LINK
                    && parse_stream_link(&link).is_ok() =>
            {
                Some(Some(link))
            }
            Some(_) => None,
        });
    if link.is_none() {
        eprintln!("Integration settings invalid; using no YouTube link");
    }
    link.flatten()
}

/// Writes the link with a temporary file and a rename.
pub fn save(path: &Path, link: Option<&str>) -> Result<(), AppError> {
    use std::io::Write;
    let unavailable = |message: &str| AppError {
        code: ErrorCode::Unavailable,
        message: message.into(),
        ids: vec![],
    };
    let parent = path
        .parent()
        .ok_or_else(|| unavailable("Invalid settings location"))?;
    std::fs::create_dir_all(parent).map_err(|_| unavailable("Cannot create settings folder"))?;
    let file = IntegrationsFile {
        youtube: YouTubeSettings {
            link: link.map(Into::into),
        },
    };
    let bytes =
        serde_json::to_vec_pretty(&file).map_err(|_| unavailable("Cannot encode settings"))?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)
        .map_err(|_| unavailable("Cannot write settings"))?;
    temp.write_all(&bytes)
        .and_then(|_| temp.as_file().sync_all())
        .map_err(|_| unavailable("Cannot write settings"))?;
    temp.persist(path)
        .map_err(|_| unavailable("Cannot replace settings"))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn saves_and_loads_the_link() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_path(dir.path());
        assert_eq!(load(&path), None);
        save(&path, Some("https://youtu.be/dQw4w9WgXcQ")).unwrap();
        assert_eq!(load(&path).as_deref(), Some("https://youtu.be/dQw4w9WgXcQ"));
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&std::fs::read(&path).unwrap()).unwrap(),
            serde_json::json!({"youtube": {"link": "https://youtu.be/dQw4w9WgXcQ"}})
        );
        save(&path, None).unwrap();
        assert_eq!(load(&path), None);
    }

    #[test]
    fn a_bad_file_means_no_link_and_stays_on_disk() {
        let dir = tempfile::tempdir().unwrap();
        let path = settings_path(dir.path());
        std::fs::create_dir_all(path.parent().unwrap()).unwrap();
        for bad in [
            "not json",
            r#"{"youtube":{"link":"https://example.com/x"}}"#,
            r#"{"youtube":{"link":null},"extra":1}"#,
        ] {
            std::fs::write(&path, bad).unwrap();
            assert_eq!(load(&path), None, "{bad}");
            assert_eq!(std::fs::read_to_string(&path).unwrap(), bad);
        }
    }
}
