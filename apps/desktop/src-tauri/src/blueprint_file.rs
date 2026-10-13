use opensekai_contracts::{AppError, ErrorCode};
use std::{
    fs::File,
    io::{Read, Write},
    path::Path,
};

pub const MAX_BLUEPRINT_FILE_BYTES: u64 = 1_048_576;

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
    let safe = if let Some(rest) = safe.strip_prefix('.') {
        format!("_{rest}")
    } else {
        safe
    };
    format!("{safe}.json")
}

pub fn read_blueprint_file(path: &Path) -> Result<String, AppError> {
    let file = File::open(path)
        .map_err(|_| error(ErrorCode::Unavailable, "Blueprint file could not be opened"))?;
    let mut bytes = Vec::new();
    file.take(MAX_BLUEPRINT_FILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| error(ErrorCode::Unavailable, "Blueprint file could not be read"))?;
    if bytes.len() as u64 > MAX_BLUEPRINT_FILE_BYTES {
        return Err(error(
            ErrorCode::InvalidInput,
            "Blueprint file is too large",
        ));
    }
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
    let parent = path
        .parent()
        .ok_or_else(|| error(ErrorCode::InvalidInput, "Invalid Blueprint file path"))?;
    let save_error = || error(ErrorCode::Unavailable, "Blueprint file could not be saved");
    let mut temp = tempfile::NamedTempFile::new_in(parent).map_err(|_| save_error())?;
    temp.write_all(text.as_bytes()).map_err(|_| save_error())?;
    temp.persist(path).map_err(|_| save_error())?;
    Ok(())
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
