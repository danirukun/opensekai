use aes_gcm::aead::{Aead, KeyInit};
use aes_gcm::{Aes256Gcm, Nonce};

pub const PLAIN_MARK: &[u8] = b"SEKAI";

pub fn seal(key: &[u8; 32], sender: u32, seq: u32, send_us: u64) -> Vec<u8> {
    let mut plain = Vec::with_capacity(64);
    plain.extend_from_slice(PLAIN_MARK);
    plain.extend_from_slice(&seq.to_le_bytes());
    plain.extend_from_slice(&send_us.to_le_bytes());
    plain.resize(64, 0);
    let cipher = Aes256Gcm::new(key.into());
    let nonce = nonce(sender, seq);
    cipher
        .encrypt(Nonce::from_slice(&nonce), plain.as_slice())
        .expect("seal")
}

pub fn open(key: &[u8; 32], sender: u32, seq: u32, bytes: &[u8]) -> Option<(u32, u64)> {
    let cipher = Aes256Gcm::new(key.into());
    let nonce = nonce(sender, seq);
    let plain = cipher.decrypt(Nonce::from_slice(&nonce), bytes).ok()?;
    if plain.len() < 17 || &plain[..5] != PLAIN_MARK {
        return None;
    }
    let seq = u32::from_le_bytes(plain[5..9].try_into().ok()?);
    let send_us = u64::from_le_bytes(plain[9..17].try_into().ok()?);
    Some((seq, send_us))
}

fn nonce(sender: u32, seq: u32) -> [u8; 12] {
    let mut nonce = [0u8; 12];
    nonce[..4].copy_from_slice(&sender.to_le_bytes());
    nonce[4..8].copy_from_slice(&seq.to_le_bytes());
    nonce
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_hides_the_mark() {
        let key = [7u8; 32];
        let sealed = seal(&key, 2, 9, 50);
        assert_ne!(&sealed[..PLAIN_MARK.len()], PLAIN_MARK);
        assert_eq!(sealed.len(), 64 + 16);
        assert_eq!(open(&key, 2, 9, &sealed), Some((9, 50)));
    }
}
