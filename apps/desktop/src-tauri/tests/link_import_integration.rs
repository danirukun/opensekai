// Integration test (B39 R7, R8): the Blueprint link download crosses a real TCP socket and a
// real TLS handshake, with the real reqwest client of `fetch_blueprint`. The test makes a CA and
// a server certificate for `blueprints.test` at run time (nothing goes to disk) and serves a
// small HTTP/1.1 responder over rustls on 127.0.0.1. The client trusts only that CA and sends
// `blueprints.test` to the local address. The pure rules (link parser, address filter, messages)
// have unit tests in `src/link/`.
use opensekai_desktop_lib::link::fetch::{fetch_blueprint, LinkFetchConfig};
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use tokio_rustls::rustls;
use url::Url;

const HOST: &str = "blueprints.test";
const COUNTER: &str = include_str!("../../../../fixtures/blueprints/counter.json");

struct Server {
    addr: SocketAddr,
    ca: Vec<u8>,
    heads: Arc<Mutex<Vec<String>>>,
}
impl Server {
    fn url(&self, path: &str) -> Url {
        Url::parse(&format!("https://{HOST}:{}{path}", self.addr.port())).unwrap()
    }
    fn config(&self) -> LinkFetchConfig {
        LinkFetchConfig {
            extra_roots: vec![self.ca.clone()],
            resolve: vec![(HOST.into(), self.addr)],
            ..Default::default()
        }
    }
}

fn certificates() -> (Vec<u8>, Vec<u8>, Vec<u8>) {
    use rcgen::{BasicConstraints, CertificateParams, DnType, IsCa, Issuer, KeyPair};
    let ca_key = KeyPair::generate().unwrap();
    let mut ca_params = CertificateParams::new(Vec::<String>::new()).unwrap();
    ca_params.is_ca = IsCa::Ca(BasicConstraints::Unconstrained);
    ca_params
        .distinguished_name
        .push(DnType::CommonName, "OpenSekai test CA");
    let ca = ca_params.self_signed(&ca_key).unwrap();
    let issuer = Issuer::new(ca_params, ca_key);
    let leaf_key = KeyPair::generate().unwrap();
    let leaf = CertificateParams::new(vec![HOST.to_string()])
        .unwrap()
        .signed_by(&leaf_key, &issuer)
        .unwrap();
    (
        ca.der().to_vec(),
        leaf.der().to_vec(),
        leaf_key.serialize_der(),
    )
}

/// One reply for each request path. `port` is the server port, for redirect targets.
async fn respond<S: tokio::io::AsyncWrite + Unpin>(stream: &mut S, path: &str, port: u16) {
    let redirect = |location: String| {
        format!("HTTP/1.1 302 Found\r\nLocation: {location}\r\nContent-Length: 0\r\n\r\n")
    };
    let head = match path {
        "/counter.json" => format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\n\r\n{COUNTER}",
            COUNTER.len()
        ),
        p if p.starts_with("/hops/") => match p["/hops/".len()..].parse::<u32>().unwrap() {
            0 => redirect("/counter.json".into()),
            n => redirect(format!("/hops/{}", n - 1)),
        },
        "/to-http" => redirect(format!("http://{HOST}:{port}/counter.json")),
        "/to-ip" => redirect(format!("https://127.0.0.1:{port}/counter.json")),
        "/big-length" => {
            // Only the head: a client that reads the body waits for the timeout.
            let _ = stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2000000\r\n\r\n")
                .await;
            let _ = stream.flush().await;
            tokio::time::sleep(Duration::from_secs(5)).await;
            return;
        }
        "/big-chunked" => {
            let _ = stream
                .write_all(b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n")
                .await;
            let chunk = vec![b' '; 64 * 1024];
            for _ in 0..32 {
                let head = format!("{:x}\r\n", chunk.len());
                if stream.write_all(head.as_bytes()).await.is_err()
                    || stream.write_all(&chunk).await.is_err()
                    || stream.write_all(b"\r\n").await.is_err()
                {
                    return;
                }
            }
            let _ = stream.write_all(b"0\r\n\r\n").await;
            return;
        }
        "/not-utf8" => {
            let _ = stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 4\r\n\r\n{\xff\xfe}")
                .await;
            return;
        }
        "/stall" => {
            let _ = stream
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n")
                .await;
            let _ = stream.flush().await;
            tokio::time::sleep(Duration::from_secs(5)).await;
            return;
        }
        _ => "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\n\r\n".to_string(),
    };
    let _ = stream.write_all(head.as_bytes()).await;
    let _ = stream.flush().await;
}

/// Reads one request head. Returns `None` at the end of the stream.
async fn read_head<S: tokio::io::AsyncRead + Unpin>(stream: &mut S) -> Option<String> {
    let mut head = Vec::new();
    let mut byte = [0u8; 1];
    while !head.ends_with(b"\r\n\r\n") {
        if stream.read(&mut byte).await.ok()? == 0 {
            return None;
        }
        head.push(byte[0]);
    }
    String::from_utf8(head).ok()
}

async fn start() -> Server {
    let (ca, leaf, key) = certificates();
    let config = rustls::ServerConfig::builder_with_provider(Arc::new(
        rustls::crypto::aws_lc_rs::default_provider(),
    ))
    .with_safe_default_protocol_versions()
    .unwrap()
    .with_no_client_auth()
    .with_single_cert(
        vec![leaf.into()],
        rustls::pki_types::PrivatePkcs8KeyDer::from(key).into(),
    )
    .unwrap();
    let acceptor = tokio_rustls::TlsAcceptor::from(Arc::new(config));
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let heads = Arc::new(Mutex::new(Vec::new()));
    let seen = heads.clone();
    tokio::spawn(async move {
        while let Ok((socket, _)) = listener.accept().await {
            let acceptor = acceptor.clone();
            let seen = seen.clone();
            tokio::spawn(async move {
                let Ok(mut stream) = acceptor.accept(socket).await else {
                    return;
                };
                while let Some(head) = read_head(&mut stream).await {
                    let path = head.split(' ').nth(1).unwrap_or("/").to_string();
                    seen.lock().unwrap().push(head);
                    respond(&mut stream, &path, addr.port()).await;
                }
            });
        }
    });
    Server { addr, ca, heads }
}

async fn message(config: &LinkFetchConfig, url: &Url) -> String {
    fetch_blueprint(config, url).await.unwrap_err().message
}

#[tokio::test]
async fn downloads_a_blueprint_file_over_https() {
    let server = start().await;
    let download = fetch_blueprint(&server.config(), &server.url("/counter.json"))
        .await
        .unwrap();
    assert_eq!(download.text, COUNTER);
    assert_eq!(download.host, HOST);
    let heads = server.heads.lock().unwrap().join("").to_ascii_lowercase();
    assert!(
        heads.starts_with("get /counter.json http/1.1\r\n"),
        "{heads}"
    );
    assert!(heads.contains(&format!(
        "user-agent: opensekai/{}\r\n",
        env!("CARGO_PKG_VERSION")
    )));
    assert!(heads.contains("accept: application/json\r\n"));
    assert!(!heads.contains("cookie:"));
}

#[tokio::test]
async fn follows_three_redirects_and_refuses_four() {
    let server = start().await;
    let download = fetch_blueprint(&server.config(), &server.url("/hops/2"))
        .await
        .unwrap();
    assert_eq!(download.text, COUNTER);
    assert_eq!(download.host, HOST);
    let heads = server.heads.lock().unwrap().join("").to_ascii_lowercase();
    assert!(!heads.contains("referer:"), "{heads}");
    assert_eq!(
        message(&server.config(), &server.url("/hops/3")).await,
        "Too many redirects"
    );
}

#[tokio::test]
async fn refuses_a_redirect_to_http_or_to_a_local_address() {
    let server = start().await;
    for path in ["/to-http", "/to-ip"] {
        assert_eq!(
            message(&server.config(), &server.url(path)).await,
            "Link address not allowed",
            "{path}"
        );
    }
}

#[tokio::test]
async fn refuses_a_status_other_than_200() {
    let server = start().await;
    assert_eq!(
        message(&server.config(), &server.url("/missing")).await,
        "Download failed (404)"
    );
}

#[tokio::test]
async fn refuses_a_large_body_by_length_and_by_count() {
    let server = start().await;
    // The body of `/big-length` never comes: a read would end with a timeout, not this message.
    let config = LinkFetchConfig {
        total_timeout: Duration::from_secs(2),
        ..server.config()
    };
    assert_eq!(
        message(&config, &server.url("/big-length")).await,
        "Blueprint file is too large"
    );
    assert_eq!(
        message(&server.config(), &server.url("/big-chunked")).await,
        "Blueprint file is too large"
    );
}

#[tokio::test]
async fn refuses_a_body_that_is_not_utf8() {
    let server = start().await;
    assert_eq!(
        message(&server.config(), &server.url("/not-utf8")).await,
        "Not an OpenSekai Blueprint file"
    );
}

#[tokio::test]
async fn stops_a_slow_download_at_the_total_timeout() {
    let server = start().await;
    let config = LinkFetchConfig {
        total_timeout: Duration::from_millis(300),
        ..server.config()
    };
    let started = std::time::Instant::now();
    assert_eq!(
        message(&config, &server.url("/stall")).await,
        "Download timed out"
    );
    assert!(started.elapsed() < Duration::from_secs(3));
}

#[tokio::test]
async fn verifies_the_server_certificate() {
    let server = start().await;
    let config = LinkFetchConfig {
        extra_roots: vec![],
        ..server.config()
    };
    assert_eq!(
        message(&config, &server.url("/counter.json")).await,
        "Download failed"
    );
}

#[tokio::test]
async fn refuses_a_server_without_tls() {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        while let Ok((mut socket, _)) = listener.accept().await {
            // The client sends a TLS hello, not a request head; the server answers in plain text.
            let _ = socket.read(&mut [0u8; 1024]).await;
            let _ = socket
                .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}")
                .await;
        }
    });
    let config = LinkFetchConfig {
        resolve: vec![(HOST.into(), addr)],
        ..Default::default()
    };
    let url = Url::parse(&format!("https://{HOST}:{}/counter.json", addr.port())).unwrap();
    assert_eq!(message(&config, &url).await, "Download failed");
}
