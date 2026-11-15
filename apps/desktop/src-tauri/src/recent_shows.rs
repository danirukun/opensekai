//! The recent show list `<app local data>/settings/recent-shows.json`. Only the host keeps the
//! paths; the window gets file and folder names and opens an entry by its index.
use crate::local_file::{read_bounded, write_atomic};
use opensekai_contracts::{AppError, ErrorCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::{
    path::{Path, PathBuf},
    sync::Mutex,
};

const MAX_RECENT: usize = 5;
const MAX_FILE_BYTES: u64 = 64 * 1024;

#[derive(Serialize, Deserialize)]
#[serde(deny_unknown_fields)]
struct RecentFile {
    shows: Vec<PathBuf>,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentShow {
    pub name: String,
    pub folder: String,
}

pub struct RecentShows {
    file: PathBuf,
    shows: Mutex<Vec<PathBuf>>,
}

/// `<app local data>/settings/recent-shows.json`.
pub fn settings_path(app_local_data: &Path) -> PathBuf {
    app_local_data.join("settings").join("recent-shows.json")
}

fn label(path: Option<&std::ffi::OsStr>) -> String {
    path.map(|part| part.to_string_lossy().into_owned())
        .unwrap_or_default()
}

impl RecentShows {
    /// A missing, unreadable, or invalid file gives an empty list. The file stays as it is
    /// until the next change.
    pub fn load(file: PathBuf) -> Self {
        let shows = read_bounded(&file, MAX_FILE_BYTES)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<RecentFile>(&bytes).ok())
            .map(|recent| {
                recent
                    .shows
                    .into_iter()
                    .filter(|path| path.is_absolute())
                    .take(MAX_RECENT)
                    .collect()
            })
            .unwrap_or_default();
        Self {
            file,
            shows: Mutex::new(shows),
        }
    }

    fn update(&self, change: impl FnOnce(&mut Vec<PathBuf>)) {
        let Ok(mut shows) = self.shows.lock() else {
            return;
        };
        change(&mut shows);
        let recent = RecentFile {
            shows: shows.clone(),
        };
        let written = self
            .file
            .parent()
            .map_or(Ok(()), std::fs::create_dir_all)
            .and_then(|()| serde_json::to_vec(&recent).map_err(std::io::Error::other))
            .and_then(|bytes| write_atomic(&self.file, &bytes));
        if written.is_err() {
            eprintln!("Recent show list could not be saved");
        }
    }

    pub fn touch(&self, path: PathBuf) {
        self.update(|shows| {
            shows.retain(|show| *show != path);
            shows.insert(0, path);
            shows.truncate(MAX_RECENT);
        });
    }

    pub fn remove(&self, path: &Path) {
        self.update(|shows| shows.retain(|show| show != path));
    }

    pub fn path_at(&self, index: usize) -> Option<PathBuf> {
        self.shows.lock().ok()?.get(index).cloned()
    }

    pub fn entries(&self) -> Vec<RecentShow> {
        self.shows
            .lock()
            .map(|shows| {
                shows
                    .iter()
                    .map(|path| RecentShow {
                        name: label(path.file_stem()),
                        folder: label(path.parent().and_then(Path::file_name)),
                    })
                    .collect()
            })
            .unwrap_or_default()
    }
}

/// Reads the show at `index`. A file that is missing or not a valid show leaves the list.
pub fn open_entry(list: &RecentShows, index: usize) -> Result<(PathBuf, Value), AppError> {
    let path = list.path_at(index).ok_or_else(|| AppError {
        code: ErrorCode::InvalidInput,
        message: "Unknown recent show".into(),
        ids: vec![],
    })?;
    match crate::show::read_show(&path) {
        Ok(document) => {
            list.touch(path.clone());
            Ok((path, document))
        }
        Err(error) => {
            list.remove(&path);
            Err(error)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use opensekai_contracts::ErrorCode;

    fn names(list: &RecentShows) -> Vec<String> {
        list.entries().into_iter().map(|entry| entry.name).collect()
    }

    #[test]
    fn touch_keeps_newest_first_and_at_most_five() {
        let dir = tempfile::tempdir().unwrap();
        let list = RecentShows::load(settings_path(dir.path()));
        for name in ["a", "b", "c", "d", "e", "f"] {
            list.touch(dir.path().join(format!("{name}.osekai")));
        }
        assert_eq!(names(&list), ["f", "e", "d", "c", "b"]);
    }

    #[test]
    fn touch_moves_existing_to_top() {
        let dir = tempfile::tempdir().unwrap();
        let list = RecentShows::load(settings_path(dir.path()));
        for name in ["a", "b", "a"] {
            list.touch(dir.path().join(format!("{name}.osekai")));
        }
        assert_eq!(names(&list), ["a", "b"]);
    }

    #[test]
    fn entries_show_file_stem_and_folder() {
        let dir = tempfile::tempdir().unwrap();
        let list = RecentShows::load(settings_path(dir.path()));
        list.touch(PathBuf::from("/x/Shows/Friday stream.osekai"));
        let entry = &list.entries()[0];
        assert_eq!(entry.name, "Friday stream");
        assert_eq!(entry.folder, "Shows");
    }

    #[test]
    fn persists_and_reloads() {
        let dir = tempfile::tempdir().unwrap();
        let file = settings_path(dir.path());
        let list = RecentShows::load(file.clone());
        list.touch(dir.path().join("a.osekai"));
        list.touch(dir.path().join("b.osekai"));
        assert_eq!(names(&RecentShows::load(file)), ["b", "a"]);
    }

    #[test]
    fn corrupt_file_loads_empty() {
        let dir = tempfile::tempdir().unwrap();
        let file = settings_path(dir.path());
        std::fs::create_dir_all(file.parent().unwrap()).unwrap();
        std::fs::write(&file, b"{").unwrap();
        assert!(RecentShows::load(file.clone()).entries().is_empty());
        assert_eq!(std::fs::read(&file).unwrap(), b"{");
    }

    #[test]
    fn remove_drops_entry_and_persists() {
        let dir = tempfile::tempdir().unwrap();
        let file = settings_path(dir.path());
        let list = RecentShows::load(file.clone());
        let a = dir.path().join("a.osekai");
        list.touch(a.clone());
        list.touch(dir.path().join("b.osekai"));
        list.remove(&a);
        assert_eq!(names(&list), ["b"]);
        assert_eq!(names(&RecentShows::load(file)), ["b"]);
    }

    #[test]
    fn open_missing_entry_removes_it() {
        let dir = tempfile::tempdir().unwrap();
        let list = RecentShows::load(settings_path(dir.path()));
        list.touch(dir.path().join("gone.osekai"));
        assert!(open_entry(&list, 0).is_err());
        assert!(list.entries().is_empty());
    }

    #[test]
    fn open_unknown_index_is_invalid() {
        let dir = tempfile::tempdir().unwrap();
        let list = RecentShows::load(settings_path(dir.path()));
        assert_eq!(
            open_entry(&list, 9).unwrap_err().code,
            ErrorCode::InvalidInput
        );
    }
}
