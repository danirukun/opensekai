pub fn allowed_origin(origin: &str, service_origin: &str) -> bool {
    origin == service_origin || matches!(origin, "tauri://localhost" | "http://tauri.localhost")
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
