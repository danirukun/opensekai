use crate::local_file::{read_bounded, write_atomic, ReadError};
use opensekai_contracts::{AppError, ErrorCode};
use std::path::Path;

pub const MAX_BLUEPRINT_FILE_BYTES: u64 = 1_048_576;
// File systems limit a name to 255 bytes; the stem leaves room for ".json".
const MAX_STEM_BYTES: usize = 255 - ".json".len();

fn error(code: ErrorCode, message: &str) -> AppError {
    AppError {
        code,
        message: message.into(),
        ids: vec![],
    }
}

pub fn blueprint_file_name(name: &str) -> String {
    let safe: String = name
        .trim()
        .chars()
        .map(|c| {
            if c.is_control() || matches!(c, '/' | '\\' | ':' | '*' | '?' | '"' | '<' | '>' | '|') {
                '_'
            } else {
                c
            }
        })
        .collect();
    let safe = if safe.is_empty() {
        "Blueprint".to_owned()
    } else {
        safe
    };
    let mut safe = if let Some(rest) = safe.strip_prefix('.') {
        format!("_{rest}")
    } else {
        safe
    };
    while safe.len() > MAX_STEM_BYTES {
        safe.pop();
    }
    format!("{safe}.json")
}

pub fn read_blueprint_file(path: &Path) -> Result<String, AppError> {
    let bytes = read_bounded(path, MAX_BLUEPRINT_FILE_BYTES).map_err(|failure| match failure {
        ReadError::Open => error(ErrorCode::Unavailable, "Blueprint file could not be opened"),
        ReadError::Read => error(ErrorCode::Unavailable, "Blueprint file could not be read"),
        ReadError::TooLarge => error(ErrorCode::InvalidInput, "Blueprint file is too large"),
    })?;
    String::from_utf8(bytes)
        .map_err(|_| error(ErrorCode::InvalidInput, "Not an OpenSekai Blueprint file"))
}

pub fn write_blueprint_file(path: &Path, text: &str) -> Result<(), AppError> {
    if text.len() as u64 > MAX_BLUEPRINT_FILE_BYTES {
        return Err(error(
            ErrorCode::InvalidInput,
            "Blueprint file is too large",
        ));
    }
    write_atomic(path, text.as_bytes())
        .map_err(|_| error(ErrorCode::Unavailable, "Blueprint file could not be saved"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_name_replaces_characters_that_paths_do_not_allow() {
        assert_eq!(blueprint_file_name("WASD"), "WASD.json");
        assert_eq!(
            blueprint_file_name("a/b\\c:d*e?f\"g<h>i|j"),
            "a_b_c_d_e_f_g_h_i_j.json"
        );
        assert_eq!(blueprint_file_name("tab\there"), "tab_here.json");
        assert_eq!(blueprint_file_name("   "), "Blueprint.json");
        assert_eq!(blueprint_file_name(".hidden"), "_hidden.json");
    }

    #[test]
    fn file_name_fits_the_file_system_limit() {
        let long = "日".repeat(128);
        let name = blueprint_file_name(&long);
        assert!(name.len() <= 255, "{} bytes", name.len());
        assert!(name.ends_with(".json"));
        assert!(name.starts_with("日日日"));
        assert_eq!(
            blueprint_file_name(&"a".repeat(128)),
            format!("{}.json", "a".repeat(128))
        );
    }

    #[test]
    fn reads_text_and_refuses_large_or_binary_files() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.json");
        std::fs::write(&path, "{\"format\":\"opensekai.blueprint\"}").unwrap();
        assert_eq!(
            read_blueprint_file(&path).unwrap(),
            "{\"format\":\"opensekai.blueprint\"}"
        );
        std::fs::write(&path, vec![b' '; (MAX_BLUEPRINT_FILE_BYTES + 1) as usize]).unwrap();
        assert_eq!(
            read_blueprint_file(&path).unwrap_err().message,
            "Blueprint file is too large"
        );
        std::fs::write(&path, [0xff, 0xfe, 0x00]).unwrap();
        assert_eq!(
            read_blueprint_file(&path).unwrap_err().message,
            "Not an OpenSekai Blueprint file"
        );
    }

    #[test]
    fn writes_text_and_refuses_large_text() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("b.json");
        write_blueprint_file(&path, "{}\n").unwrap();
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{}\n");
        let large = " ".repeat((MAX_BLUEPRINT_FILE_BYTES + 1) as usize);
        assert_eq!(
            write_blueprint_file(&path, &large).unwrap_err().message,
            "Blueprint file is too large"
        );
        assert_eq!(std::fs::read_to_string(&path).unwrap(), "{}\n");
    }
}
