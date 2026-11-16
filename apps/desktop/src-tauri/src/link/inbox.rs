//! The link inbox (B39 R4, R5): the host keeps at most one link until the Editor window takes it.
use super::parse::{parse_app_link, AppLink, LinkError};
use std::sync::{Mutex, MutexGuard};
use url::Url;

#[derive(Debug, Clone, PartialEq, Eq)]
enum State {
    Idle,
    Pending(Result<AppLink, LinkError>),
    Downloading { ticket: u64, cancelled: bool },
    Shown,
}

#[derive(Debug)]
struct Inner {
    state: State,
    next_ticket: u64,
}

#[derive(Debug)]
pub struct LinkInbox {
    inner: Mutex<Inner>,
}
impl Default for LinkInbox {
    fn default() -> Self {
        Self {
            inner: Mutex::new(Inner {
                state: State::Idle,
                next_ticket: 1,
            }),
        }
    }
}

/// What `take` gives the window.
#[derive(Debug, PartialEq, Eq)]
pub enum Take {
    Nothing,
    Failed(LinkError),
    Download { ticket: u64, url: Url },
}

impl LinkInbox {
    fn lock(&self) -> MutexGuard<'_, Inner> {
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
    }
    /// Parses a link from the OS and keeps it. Returns false when the inbox dropped it.
    pub fn offer_raw(&self, raw: &str) -> bool {
        self.offer(parse_app_link(raw))
    }
    /// A new link replaces a pending link. While a link downloads or shows, the inbox drops it.
    pub fn offer(&self, link: Result<AppLink, LinkError>) -> bool {
        let mut inner = self.lock();
        match inner.state {
            State::Idle | State::Pending(_) => {
                inner.state = State::Pending(link);
                true
            }
            State::Downloading { .. } | State::Shown => false,
        }
    }
    pub fn take(&self) -> Take {
        let mut inner = self.lock();
        let State::Pending(link) = inner.state.clone() else {
            return Take::Nothing;
        };
        match link {
            Err(error) => {
                inner.state = State::Shown;
                Take::Failed(error)
            }
            Ok(AppLink::BlueprintImport { url }) => {
                let ticket = inner.next_ticket;
                inner.next_ticket += 1;
                inner.state = State::Downloading {
                    ticket,
                    cancelled: false,
                };
                Take::Download { ticket, url }
            }
        }
    }
    /// The end of a download. Returns the result for the window, or `None` when the window
    /// cancelled or the inbox was reset after the download started.
    pub fn complete<T>(&self, ticket: u64, result: T) -> Option<T> {
        let mut inner = self.lock();
        match inner.state {
            State::Downloading {
                ticket: current,
                cancelled,
            } if current == ticket => {
                if cancelled {
                    inner.state = State::Idle;
                    None
                } else {
                    inner.state = State::Shown;
                    Some(result)
                }
            }
            _ => None,
        }
    }
    /// The window closed its dialog.
    pub fn finish(&self) {
        let mut inner = self.lock();
        match inner.state {
            State::Shown => inner.state = State::Idle,
            State::Downloading { ticket, .. } => {
                inner.state = State::Downloading {
                    ticket,
                    cancelled: true,
                }
            }
            _ => {}
        }
    }
    /// A webview reload: the old window had the download or the dialog, so they end. A link
    /// that no window took yet stays, so a link from the launch survives the first bootstrap.
    pub fn reset(&self) {
        let mut inner = self.lock();
        if !matches!(inner.state, State::Pending(_)) {
            inner.state = State::Idle;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn link(name: &str) -> Result<AppLink, LinkError> {
        Ok(AppLink::BlueprintImport {
            url: Url::parse(&format!("https://example.com/{name}.json")).unwrap(),
        })
    }
    fn state(inbox: &LinkInbox) -> State {
        inbox.lock().state.clone()
    }
    fn downloading(inbox: &LinkInbox) -> u64 {
        match inbox.take() {
            Take::Download { ticket, .. } => ticket,
            other => panic!("{other:?}"),
        }
    }

    #[test]
    fn an_offer_in_idle_is_pending_and_a_second_offer_replaces_it() {
        let inbox = LinkInbox::default();
        assert!(inbox.offer(link("a")));
        assert_eq!(state(&inbox), State::Pending(link("a")));
        assert!(inbox.offer(link("b")));
        assert_eq!(state(&inbox), State::Pending(link("b")));
    }

    #[test]
    fn an_offer_while_downloading_or_shown_is_dropped() {
        let inbox = LinkInbox::default();
        inbox.offer(link("a"));
        let ticket = downloading(&inbox);
        assert!(!inbox.offer(link("b")));
        assert!(matches!(state(&inbox), State::Downloading { .. }));
        assert_eq!(inbox.complete(ticket, 1), Some(1));
        assert!(!inbox.offer(link("c")));
        assert_eq!(state(&inbox), State::Shown);
    }

    #[test]
    fn take_in_idle_gives_nothing() {
        let inbox = LinkInbox::default();
        assert_eq!(inbox.take(), Take::Nothing);
        assert_eq!(state(&inbox), State::Idle);
    }

    #[test]
    fn take_of_a_parse_error_gives_the_error_and_shows_it() {
        let inbox = LinkInbox::default();
        assert!(inbox.offer_raw("opensekai://blueprint/import?url=http%3A%2F%2Fexample.com%2F"));
        assert_eq!(inbox.take(), Take::Failed(LinkError::NotHttps));
        assert_eq!(state(&inbox), State::Shown);
        assert_eq!(inbox.take(), Take::Nothing);
    }

    #[test]
    fn take_of_a_link_starts_a_download_and_complete_shows_the_result() {
        let inbox = LinkInbox::default();
        inbox.offer(link("a"));
        let Take::Download { ticket, url } = inbox.take() else {
            panic!("no download")
        };
        assert_eq!(url.as_str(), "https://example.com/a.json");
        assert_eq!(
            state(&inbox),
            State::Downloading {
                ticket,
                cancelled: false
            }
        );
        assert_eq!(inbox.complete(ticket, "text"), Some("text"));
        assert_eq!(state(&inbox), State::Shown);
    }

    #[test]
    fn finish_while_downloading_cancels_and_complete_gives_nothing() {
        let inbox = LinkInbox::default();
        inbox.offer(link("a"));
        let ticket = downloading(&inbox);
        inbox.finish();
        assert_eq!(
            state(&inbox),
            State::Downloading {
                ticket,
                cancelled: true
            }
        );
        assert_eq!(inbox.complete(ticket, "text"), None);
        assert_eq!(state(&inbox), State::Idle);
    }

    #[test]
    fn finish_when_shown_gives_idle() {
        let inbox = LinkInbox::default();
        inbox.offer(Err(LinkError::NotSupported));
        inbox.take();
        inbox.finish();
        assert_eq!(state(&inbox), State::Idle);
        inbox.finish();
        assert_eq!(state(&inbox), State::Idle);
    }

    #[test]
    fn reset_gives_idle_and_an_old_download_changes_nothing() {
        let inbox = LinkInbox::default();
        inbox.offer(link("a"));
        let old = downloading(&inbox);
        inbox.reset();
        assert_eq!(state(&inbox), State::Idle);
        assert_eq!(inbox.complete(old, "old"), None);
        assert_eq!(state(&inbox), State::Idle);
        inbox.offer(link("b"));
        let new = downloading(&inbox);
        assert_ne!(old, new);
        assert_eq!(inbox.complete(old, "old"), None);
        assert!(matches!(state(&inbox), State::Downloading { .. }));
        assert_eq!(inbox.complete(new, "new"), Some("new"));
        inbox.reset();
        assert_eq!(state(&inbox), State::Idle);
    }

    #[test]
    fn reset_keeps_a_link_that_no_window_took() {
        let inbox = LinkInbox::default();
        inbox.offer(link("a"));
        inbox.reset();
        assert_eq!(state(&inbox), State::Pending(link("a")));
    }
}
