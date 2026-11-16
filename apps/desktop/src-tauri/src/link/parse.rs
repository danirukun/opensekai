//! The link parser (B39 R2). One link form only: `opensekai://blueprint/import?url=<value>`.
use opensekai_contracts::{AppError, ErrorCode};
use url::Url;

/// The longest link that the host reads.
pub const MAX_LINK_BYTES: usize = 4096;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum AppLink {
    BlueprintImport { url: Url },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum LinkError {
    NotSupported,
    NotHttps,
    AddressNotAllowed,
}
impl LinkError {
    pub fn message(self) -> &'static str {
        match self {
            Self::NotSupported => "Link not supported",
            Self::NotHttps => "Link must use HTTPS",
            Self::AddressNotAllowed => "Link address not allowed",
        }
    }
}
impl From<LinkError> for AppError {
    fn from(error: LinkError) -> Self {
        AppError {
            code: ErrorCode::InvalidInput,
            message: error.message().into(),
            ids: vec![],
        }
    }
}

/// The web URL rule of R2 for a download URL or a redirect target. An IP literal must also be
/// a public address (R7), because it does not go through the resolver.
pub fn download_url_allowed(url: &Url) -> bool {
    let public = match url.host() {
        Some(url::Host::Ipv4(ip)) => super::fetch::is_public_ip(ip.into()),
        Some(url::Host::Ipv6(ip)) => super::fetch::is_public_ip(ip.into()),
        _ => true,
    };
    url.scheme() == "https" && public && opensekai_contracts::is_web_screen_url(url.as_str())
}

pub fn parse_app_link(raw: &str) -> Result<AppLink, LinkError> {
    use LinkError::*;
    if raw.len() > MAX_LINK_BYTES || !raw.bytes().all(|b| (0x21..=0x7e).contains(&b)) {
        return Err(NotSupported);
    }
    let link = Url::parse(raw).map_err(|_| NotSupported)?;
    if link.scheme() != "opensekai"
        || link.host_str() != Some("blueprint")
        || link.path() != "/import"
        || !link.username().is_empty()
        || link.password().is_some()
        || link.port().is_some()
        || link.fragment().is_some()
    {
        return Err(NotSupported);
    }
    // The raw query, so `+` stays `+` and the value is decoded one time only.
    let value = match link
        .query()
        .map(|q| q.split('&').collect::<Vec<_>>())
        .as_deref()
    {
        Some([pair]) => pair.strip_prefix("url=").ok_or(NotSupported)?,
        _ => return Err(NotSupported),
    };
    if value.is_empty() {
        return Err(NotSupported);
    }
    let value = percent_encoding::percent_decode_str(value)
        .decode_utf8()
        .map_err(|_| NotSupported)?;
    let url = match Url::parse(&value) {
        Ok(url) if url.scheme() == "https" => url,
        Err(_) if value.to_ascii_lowercase().starts_with("https://") => {
            return Err(AddressNotAllowed)
        }
        _ => return Err(NotHttps),
    };
    if !download_url_allowed(&url) {
        return Err(AddressNotAllowed);
    }
    Ok(AppLink::BlueprintImport { url })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn link(value: &str) -> String {
        format!("opensekai://blueprint/import?url={value}")
    }
    fn url_of(raw: &str) -> String {
        match parse_app_link(raw) {
            Ok(AppLink::BlueprintImport { url }) => url.to_string(),
            Err(error) => panic!("{raw}: {}", error.message()),
        }
    }

    #[test]
    fn accepts_the_one_link_form() {
        assert_eq!(
            url_of(&link("https%3A%2F%2Fexample.com%2Fg.json")),
            "https://example.com/g.json"
        );
        assert_eq!(
            url_of(&link("https%3A%2F%2Fexample.com%2Fg.json%3Fa%3D1%26b%3D2")),
            "https://example.com/g.json?a=1&b=2"
        );
        assert_eq!(
            url_of(&link("https%3A%2F%2Fb%C3%BCcher.example%2Fg.json")),
            "https://xn--bcher-kva.example/g.json"
        );
    }

    #[test]
    fn refuses_other_link_forms() {
        let long = link(&format!(
            "https%3A%2F%2Fexample.com%2F{}",
            "a".repeat(MAX_LINK_BYTES)
        ));
        let exact = |n: usize| {
            let head = link("https%3A%2F%2Fexample.com%2F");
            format!("{head}{}", "a".repeat(n - head.len()))
        };
        // A link of 4096 bytes passes the length rule; its download URL is longer than the web
        // URL rule allows.
        assert_eq!(
            parse_app_link(&exact(MAX_LINK_BYTES)),
            Err(LinkError::AddressNotAllowed)
        );
        for raw in [
            "https://blueprint/import?url=https%3A%2F%2Fexample.com%2Fg.json",
            "opensekai://blueprints/import?url=https%3A%2F%2Fexample.com%2Fg.json",
            "opensekai://blueprint/import/?url=https%3A%2F%2Fexample.com%2Fg.json",
            "opensekai://blueprint/export?url=https%3A%2F%2Fexample.com%2Fg.json",
            "opensekai://blueprint:8080/import?url=https%3A%2F%2Fexample.com%2Fg.json",
            "opensekai://user@blueprint/import?url=https%3A%2F%2Fexample.com%2Fg.json",
            "opensekai://blueprint/import?url=https%3A%2F%2Fexample.com%2Fg.json#x",
            "opensekai://blueprint/import",
            "opensekai://blueprint/import?",
            "opensekai://blueprint/import?file=https%3A%2F%2Fexample.com%2Fg.json",
            "opensekai://blueprint/import?url=https%3A%2F%2Fa.com%2F&url=https%3A%2F%2Fb.com%2F",
            "opensekai://blueprint/import?url=https%3A%2F%2Fexample.com%2Fg.json&data=abc",
            "opensekai://blueprint/import?url=",
            "opensekai://blueprint/import?url",
            "opensekai://blueprint/import?url=https://example.com/a b",
            "opensekai://blueprint/import?url=https://bücher.example/g.json",
            "opensekai://blueprint/import?url=%FF",
            long.as_str(),
            exact(MAX_LINK_BYTES + 1).as_str(),
        ] {
            assert_eq!(parse_app_link(raw), Err(LinkError::NotSupported), "{raw}");
        }
    }

    #[test]
    fn refuses_a_download_url_without_https() {
        for value in [
            "http%3A%2F%2Fexample.com%2Fg.json",
            "ftp%3A%2F%2Fexample.com%2Fg.json",
            "file%3A%2F%2F%2Fetc%2Fpasswd",
            "javascript%3Aalert(1)",
            // Decoded one time only: the value is `https%3A%2F%2F…`, not a URL.
            "https%253A%252F%252Fexample.com%252Fg.json",
        ] {
            assert_eq!(
                parse_app_link(&link(value)),
                Err(LinkError::NotHttps),
                "{value}"
            );
        }
    }

    #[test]
    fn refuses_a_local_or_private_download_address() {
        for value in [
            "https%3A%2F%2Flocalhost%2Fx",
            "https%3A%2F%2Fa.local%2Fx",
            "https%3A%2F%2F127.0.0.1%2Fx",
            "https%3A%2F%2F10.0.0.1%2Fx",
            "https%3A%2F%2F%5B%3A%3A1%5D%2Fx",
            "https%3A%2F%2Fuser%3Apw%40example.com%2Fx",
            "https%3A%2F%2F198.18.0.1%2Fx",
            "https%3A%2F%2F224.0.0.1%2Fx",
        ] {
            assert_eq!(
                parse_app_link(&link(value)),
                Err(LinkError::AddressNotAllowed),
                "{value}"
            );
        }
    }

    #[test]
    fn keeps_a_plus_sign() {
        assert_eq!(
            url_of(&link("https%3A%2F%2Fexample.com%2Fa+b.json")),
            "https://example.com/a+b.json"
        );
    }

    #[test]
    fn maps_each_error_to_one_message() {
        for (error, message) in [
            (LinkError::NotSupported, "Link not supported"),
            (LinkError::NotHttps, "Link must use HTTPS"),
            (LinkError::AddressNotAllowed, "Link address not allowed"),
        ] {
            let app: AppError = error.into();
            assert_eq!(app.code, ErrorCode::InvalidInput);
            assert_eq!(app.message, message);
        }
    }
}
