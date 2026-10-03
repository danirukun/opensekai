pub fn allowed_origin(origin: &str, service_origin: &str) -> bool {
    origin == service_origin
        || matches!(
            origin,
            "tauri://localhost" | "http://tauri.localhost" | "http://127.0.0.1:1420"
        )
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn service_auth_origin_is_exact() {
        assert!(allowed_origin(
            "http://127.0.0.1:41000",
            "http://127.0.0.1:41000"
        ));
        for bad in [
            "null",
            "https://example.test",
            "http://localhost:41000",
            "http://127.0.0.1:41000/",
        ] {
            assert!(!allowed_origin(bad, "http://127.0.0.1:41000"));
        }
    }
}

#[cfg(test)]
mod desktop_origin_tests {
    use super::allowed_origin;
    #[test]
    fn service_desktop_origins_are_explicit_and_exact() {
        let service = "http://127.0.0.1:41000";
        assert!(allowed_origin("http://127.0.0.1:1420", service));
        assert!(allowed_origin("tauri://localhost", service));
        for origin in [
            "http://127.0.0.1:1420/",
            "http://localhost:1420",
            "http://127.0.0.1:1421",
        ] {
            assert!(!allowed_origin(origin, service));
        }
    }
}
