use std::{
    fs::File,
    io::{self, Read, Write},
    path::Path,
};

#[derive(Debug, PartialEq, Eq)]
pub enum ReadError {
    Open,
    Read,
    TooLarge,
}

/// Reads at most `max` bytes, so a large file never goes fully into memory.
pub fn read_bounded(path: &Path, max: u64) -> Result<Vec<u8>, ReadError> {
    let file = File::open(path).map_err(|_| ReadError::Open)?;
    let mut bytes = Vec::new();
    file.take(max + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| ReadError::Read)?;
    if bytes.len() as u64 > max {
        return Err(ReadError::TooLarge);
    }
    Ok(bytes)
}

/// Replaces `path` with `bytes` through a synced temp file in the same folder, so a crash leaves the old file or the new one.
pub fn write_atomic(path: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = path
        .parent()
        .filter(|parent| !parent.as_os_str().is_empty())
        .ok_or_else(|| io::Error::from(io::ErrorKind::InvalidInput))?;
    let mut temp = tempfile::NamedTempFile::new_in(parent)?;
    temp.write_all(bytes)?;
    temp.as_file().sync_all()?;
    // The temp file is owner-only; a saved document is a normal file that others can read.
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        temp.as_file()
            .set_permissions(std::fs::Permissions::from_mode(0o644))?;
    }
    temp.persist(path).map_err(|error| error.error)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_up_to_the_limit_and_refuses_more() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("a.json");
        std::fs::write(&path, b"12345").unwrap();
        assert_eq!(read_bounded(&path, 5).unwrap(), b"12345");
        assert_eq!(read_bounded(&path, 4).unwrap_err(), ReadError::TooLarge);
        assert_eq!(
            read_bounded(&dir.path().join("missing.json"), 5).unwrap_err(),
            ReadError::Open
        );
    }

    #[test]
    fn replaces_a_file_and_needs_a_parent_folder() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("b.json");
        write_atomic(&path, b"one").unwrap();
        write_atomic(&path, b"two").unwrap();
        assert_eq!(std::fs::read(&path).unwrap(), b"two");
        assert!(write_atomic(Path::new("/"), b"x").is_err());
    }

    #[cfg(unix)]
    #[test]
    fn written_files_are_readable_by_others() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("c.json");
        std::fs::write(&path, b"old").unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        write_atomic(&path, b"new").unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o644);
    }
}
