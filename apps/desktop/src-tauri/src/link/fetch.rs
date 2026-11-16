//! The Blueprint link download (B39 R7, R8). Only the host downloads. Each name resolves to
//! public addresses only, each redirect passes the URL rule of R2, and the body has a byte limit.
use super::parse::download_url_allowed;
use futures_util::future::BoxFuture;
use opensekai_contracts::{AppError, ErrorCode};
use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use serde::Serialize;
use std::{
    net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr},
    sync::Arc,
    time::Duration,
};
use url::Url;

/// The limits of R7. The app uses the defaults; the integration test changes the hidden fields.
#[derive(Clone)]
pub struct LinkFetchConfig {
    pub connect_timeout: Duration,
    pub total_timeout: Duration,
    pub max_bytes: u64,
    pub max_redirects: usize,
    /// Tests trust only these roots (DER). The app uses the platform roots.
    #[doc(hidden)]
    pub extra_roots: Vec<Vec<u8>>,
    /// Tests send these names to a local address. The app has none.
    #[doc(hidden)]
    pub resolve: Vec<(String, SocketAddr)>,
    /// Tests give the name lookup behind the public-address filter. The app uses the system lookup.
    #[doc(hidden)]
    pub lookup: Option<Lookup>,
}
impl Default for LinkFetchConfig {
    fn default() -> Self {
        Self {
            connect_timeout: Duration::from_secs(5),
            total_timeout: Duration::from_secs(10),
            max_bytes: 1_048_576,
            max_redirects: 3,
            extra_roots: vec![],
            resolve: vec![],
            lookup: None,
        }
    }
}

/// The reply of `take_blueprint_link`: the file text and the host of the final response URL.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinkDownload {
    pub text: String,
    pub host: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FetchError {
    AddressNotAllowed,
    TooManyRedirects,
    TimedOut,
    Failed,
    Status(u16),
    TooLarge,
    NotBlueprint,
}
impl From<FetchError> for AppError {
    fn from(error: FetchError) -> Self {
        let (code, message) = match error {
            FetchError::AddressNotAllowed => {
                (ErrorCode::InvalidInput, "Link address not allowed".into())
            }
            FetchError::TooManyRedirects => (ErrorCode::Unavailable, "Too many redirects".into()),
            FetchError::TimedOut => (ErrorCode::Unavailable, "Download timed out".into()),
            FetchError::Failed => (ErrorCode::Unavailable, "Download failed".into()),
            FetchError::Status(status) => (
                ErrorCode::Unavailable,
                format!("Download failed ({status})"),
            ),
            FetchError::TooLarge => (
                ErrorCode::InvalidInput,
                "Blueprint file is too large".into(),
            ),
            FetchError::NotBlueprint => (
                ErrorCode::InvalidInput,
                "Not an OpenSekai Blueprint file".into(),
            ),
        };
        AppError {
            code,
            message,
            ids: vec![],
        }
    }
}

/// True for an address that the download can connect to. It refuses each range of R7, and the
/// IPv4-mapped, IPv4-compatible, NAT64 (also local-use), and 6to4 forms of a refused IPv4 address.
pub fn is_public_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(ip) => public_ipv4(ip),
        IpAddr::V6(ip) => public_ipv6(ip),
    }
}
fn public_ipv4(ip: Ipv4Addr) -> bool {
    let [a, b, c, _] = ip.octets();
    !(a == 0
        || a == 10
        || a == 127
        || (a == 100 && (64..128).contains(&b))
        || (a == 169 && b == 254)
        || (a == 172 && (16..32).contains(&b))
        || (a == 192 && b == 168)
        || (a == 198 && (18..20).contains(&b))
        || (a, b, c) == (192, 0, 0)
        || (a, b, c) == (192, 0, 2)
        || (a, b, c) == (198, 51, 100)
        || (a, b, c) == (203, 0, 113)
        || a >= 224)
}
fn public_ipv6(ip: Ipv6Addr) -> bool {
    let s = ip.segments();
    let embedded = Ipv4Addr::from((u32::from(s[6]) << 16) | u32::from(s[7]));
    let mapped = s[..6] == [0, 0, 0, 0, 0, 0xffff];
    let nat64 = s[..6] == [0x64, 0xff9b, 0, 0, 0, 0];
    let compatible = s[..6] == [0; 6];
    // NAT64 local-use 64:ff9b:1::/48, read as its /96 form.
    let local_nat64 = s[..3] == [0x64, 0xff9b, 1];
    if mapped || nat64 || compatible || local_nat64 {
        return public_ipv4(embedded);
    }
    // 6to4 2002::/16 carries the IPv4 address in bits 16 to 47.
    if s[0] == 0x2002 {
        return public_ipv4(Ipv4Addr::from((u32::from(s[1]) << 16) | u32::from(s[2])));
    }
    !((s[0] & 0xfe00) == 0xfc00 // unique-local fc00::/7
        || (s[0] & 0xffc0) == 0xfe80 // link-local fe80::/10
        || (s[0] & 0xffc0) == 0xfec0 // site-local fec0::/10
        || s[0] >> 8 == 0xff // multicast
        || (s[0], s[1]) == (0x2001, 0x0db8) // documentation 2001:db8::/32
        || (s[0] == 0x3fff && s[1] < 0x1000)) // documentation 3fff::/20
}

/// The refusal of a name whose addresses are all refused.
#[derive(Debug)]
struct AddressRefused;
impl std::fmt::Display for AddressRefused {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("address not allowed")
    }
}
impl std::error::Error for AddressRefused {}

#[derive(Debug)]
struct TooManyRedirects;
impl std::fmt::Display for TooManyRedirects {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("too many redirects")
    }
}
impl std::error::Error for TooManyRedirects {}

pub type Lookup =
    Arc<dyn Fn(String) -> BoxFuture<'static, std::io::Result<Vec<SocketAddr>>> + Send + Sync>;

/// A resolver that keeps only public addresses (R7).
#[derive(Clone)]
pub struct PublicResolver {
    lookup: Lookup,
}
impl PublicResolver {
    pub fn new(lookup: Lookup) -> Self {
        Self { lookup }
    }
    pub fn system() -> Self {
        Self::new(Arc::new(|name| {
            Box::pin(async move { Ok(tokio::net::lookup_host((name, 0)).await?.collect()) })
        }))
    }
}
impl Resolve for PublicResolver {
    fn resolve(&self, name: Name) -> Resolving {
        let lookup = (self.lookup)(name.as_str().to_owned());
        Box::pin(async move {
            let public: Vec<SocketAddr> = lookup
                .await?
                .into_iter()
                .filter(|addr| is_public_ip(addr.ip()))
                .collect();
            if public.is_empty() {
                return Err(Box::new(AddressRefused) as _);
            }
            Ok(Box::new(public.into_iter()) as Addrs)
        })
    }
}

fn client(config: &LinkFetchConfig) -> Result<reqwest::Client, FetchError> {
    let max_redirects = config.max_redirects;
    let policy = reqwest::redirect::Policy::custom(move |attempt| {
        if attempt.previous().len() > max_redirects {
            attempt.error(TooManyRedirects)
        } else if !download_url_allowed(attempt.url()) {
            attempt.error(AddressRefused)
        } else {
            attempt.follow()
        }
    });
    let mut builder = reqwest::Client::builder()
        .https_only(true)
        // With a proxy, the proxy resolves the name, and the address rule cannot run.
        .no_proxy()
        .referer(false)
        .user_agent(concat!("OpenSekai/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(config.connect_timeout)
        .timeout(config.total_timeout)
        .dns_resolver(
            config
                .lookup
                .clone()
                .map_or_else(PublicResolver::system, PublicResolver::new),
        )
        .redirect(policy);
    if !config.extra_roots.is_empty() {
        let roots = config
            .extra_roots
            .iter()
            .map(|der| reqwest::Certificate::from_der(der))
            .collect::<Result<Vec<_>, _>>()
            .map_err(|_| FetchError::Failed)?;
        builder = builder.tls_certs_only(roots);
    }
    for (name, addr) in &config.resolve {
        builder = builder.resolve(name, *addr);
    }
    builder.build().map_err(|_| FetchError::Failed)
}

/// Maps a request error to one message of R7. A refusal of the resolver or the redirect policy
/// is in the source chain of the reqwest error.
fn classify(error: &reqwest::Error) -> FetchError {
    let mut source: Option<&(dyn std::error::Error + 'static)> = Some(error);
    while let Some(current) = source {
        if current.is::<TooManyRedirects>() {
            return FetchError::TooManyRedirects;
        }
        if current.is::<AddressRefused>() {
            return FetchError::AddressNotAllowed;
        }
        source = current.source();
    }
    if error.is_timeout() {
        FetchError::TimedOut
    } else {
        FetchError::Failed
    }
}

/// Sends one GET and reads a 200 reply of at most `max_bytes` bytes of UTF-8 text.
pub async fn fetch_blueprint(
    config: &LinkFetchConfig,
    url: &Url,
) -> Result<LinkDownload, AppError> {
    fetch(config, url).await.map_err(AppError::from)
}
async fn fetch(config: &LinkFetchConfig, url: &Url) -> Result<LinkDownload, FetchError> {
    if !download_url_allowed(url) {
        return Err(FetchError::AddressNotAllowed);
    }
    let mut response = client(config)?
        .get(url.clone())
        .header(reqwest::header::ACCEPT, "application/json")
        .send()
        .await
        .map_err(|e| classify(&e))?;
    if response.status() != reqwest::StatusCode::OK {
        return Err(FetchError::Status(response.status().as_u16()));
    }
    if response
        .content_length()
        .is_some_and(|length| length > config.max_bytes)
    {
        return Err(FetchError::TooLarge);
    }
    let mut body = Vec::new();
    while let Some(chunk) = response.chunk().await.map_err(|e| classify(&e))? {
        if (body.len() + chunk.len()) as u64 > config.max_bytes {
            return Err(FetchError::TooLarge);
        }
        body.extend_from_slice(&chunk);
    }
    let host = response
        .url()
        .host_str()
        .ok_or(FetchError::Failed)?
        .to_ascii_lowercase();
    let text = String::from_utf8(body).map_err(|_| FetchError::NotBlueprint)?;
    Ok(LinkDownload { text, host })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::str::FromStr;

    fn ip(text: &str) -> IpAddr {
        text.parse().unwrap()
    }

    #[test]
    fn refuses_each_address_range_of_r7() {
        for text in [
            "0.0.0.0",
            "0.1.2.3",
            "127.0.0.1",
            "10.1.2.3",
            "172.16.0.1",
            "172.31.255.255",
            "192.168.1.1",
            "169.254.169.254",
            "100.64.0.1",
            "100.127.255.255",
            "198.18.0.1",
            "198.19.255.255",
            "240.0.0.1",
            "255.255.255.255",
            "224.0.0.1",
            "239.255.255.250",
            "192.0.2.1",
            "198.51.100.1",
            "203.0.113.1",
            "::",
            "::1",
            "fc00::1",
            "fd12:3456::1",
            "fe80::1",
            "fec0::1",
            "ff02::1",
            "2001:db8::1",
            "3fff::1",
            "::ffff:127.0.0.1",
            "::ffff:10.0.0.1",
            "::ffff:169.254.169.254",
            "64:ff9b::7f00:1",
            "64:ff9b::a00:1",
            "::127.0.0.1",
            "192.0.0.1",
            "192.0.0.170",
            "64:ff9b:1::7f00:1",
            "64:ff9b:1::a00:1",
            "64:ff9b:1:ffff::c0a8:101",
            "2002:7f00:1::",
            "2002:a00:1:1::1",
            "2002:c0a8:101::1",
        ] {
            assert!(!is_public_ip(ip(text)), "{text}");
        }
    }

    #[test]
    fn accepts_public_addresses() {
        for text in [
            "1.1.1.1",
            "8.8.8.8",
            "172.32.0.1",
            "100.128.0.1",
            "198.20.0.1",
            "2606:4700::1111",
            "3fff:1000::1",
            "::ffff:1.1.1.1",
            "64:ff9b::101:101",
            "64:ff9b:1::101:101",
            "2002:101:101::1",
            "192.0.1.1",
        ] {
            assert!(is_public_ip(ip(text)), "{text}");
        }
    }

    fn resolver(addrs: Vec<&'static str>) -> PublicResolver {
        PublicResolver::new(Arc::new(move |_| {
            let addrs = addrs
                .iter()
                .map(|a| SocketAddr::new(a.parse().unwrap(), 0))
                .collect();
            Box::pin(async move { Ok(addrs) })
        }))
    }

    #[tokio::test]
    async fn the_resolver_refuses_a_name_with_only_private_addresses() {
        let result = resolver(vec!["127.0.0.1", "10.0.0.1", "::1"])
            .resolve(Name::from_str("example.com").unwrap())
            .await;
        let error = result.err().expect("refused");
        assert!(error.is::<AddressRefused>());
    }

    #[tokio::test]
    async fn the_resolver_keeps_only_public_addresses() {
        let addrs: Vec<IpAddr> =
            resolver(vec!["10.0.0.1", "1.1.1.1", "fd00::1", "2606:4700::1111"])
                .resolve(Name::from_str("example.com").unwrap())
                .await
                .expect("resolved")
                .map(|addr| addr.ip())
                .collect();
        assert_eq!(addrs, vec![ip("1.1.1.1"), ip("2606:4700::1111")]);
    }

    #[tokio::test]
    async fn a_private_ip_literal_is_refused_before_a_request() {
        let url = Url::parse("https://192.168.1.1/g.json").unwrap();
        let error = fetch_blueprint(&LinkFetchConfig::default(), &url)
            .await
            .unwrap_err();
        assert_eq!(error.message, "Link address not allowed");
    }

    #[test]
    fn maps_each_error_to_one_message() {
        for (error, code, message) in [
            (
                FetchError::AddressNotAllowed,
                ErrorCode::InvalidInput,
                "Link address not allowed",
            ),
            (
                FetchError::TooManyRedirects,
                ErrorCode::Unavailable,
                "Too many redirects",
            ),
            (
                FetchError::TimedOut,
                ErrorCode::Unavailable,
                "Download timed out",
            ),
            (
                FetchError::Failed,
                ErrorCode::Unavailable,
                "Download failed",
            ),
            (
                FetchError::Status(404),
                ErrorCode::Unavailable,
                "Download failed (404)",
            ),
            (
                FetchError::TooLarge,
                ErrorCode::InvalidInput,
                "Blueprint file is too large",
            ),
            (
                FetchError::NotBlueprint,
                ErrorCode::InvalidInput,
                "Not an OpenSekai Blueprint file",
            ),
        ] {
            let app: AppError = error.into();
            assert_eq!((app.code, app.message.as_str()), (code, message));
        }
    }
}
