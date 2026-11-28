use aes_gcm::aead::{Aead, AeadCore, Payload};
use aes_gcm::{Aes256Gcm, KeyInit, Nonce};
use thiserror::Error;

pub const POSE_VERSION: u8 = 1;
pub const POSE_BODY_LEN: usize = 324;
pub const POSE_PLAINTEXT_LEN: usize = 340;
pub const NONCE_LEN: usize = 12;
pub const TAG_LEN: usize = 16;
pub const POSE_WIRE_LEN: usize = NONCE_LEN + POSE_PLAINTEXT_LEN + TAG_LEN;
pub const RELAY_ENVELOPE_LEN: usize = 1 + POSE_WIRE_LEN;
pub const MAX_SLOT: u8 = 3;
const AAD_PREFIX: &[u8] = b"sekai-pose/1";

#[derive(Debug, Error, PartialEq, Eq)]
pub enum CodecError {
    #[error("expected {expected} bytes, got {actual}")]
    BadLength { expected: usize, actual: usize },
    #[error("slot {0} is outside 0..=3")]
    BadSlot(u8),
    #[error("unsupported pose version {0}")]
    BadVersion(u8),
    #[error("decrypted slot {actual} differs from expected slot {expected}")]
    SlotMismatch { expected: u8, actual: u8 },
    #[error("pose frame encryption failed")]
    EncryptFailed,
    #[error("pose frame decryption failed")]
    DecryptFailed,
    #[error("invalid LiveKit identity {0:?}")]
    BadLivekitIdentity(String),
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PoseFrame {
    pub version: u8,
    pub slot: u8,
    pub flags: u8,
    pub seq: u32,
    pub sender_ts_us: u64,
    pub body: [u8; POSE_BODY_LEN],
}

impl PoseFrame {
    pub fn new(slot: u8, seq: u32, sender_ts_us: u64) -> Self {
        Self {
            version: POSE_VERSION,
            slot,
            flags: 0,
            seq,
            sender_ts_us,
            body: [0; POSE_BODY_LEN],
        }
    }

    pub fn to_plaintext(&self) -> [u8; POSE_PLAINTEXT_LEN] {
        let mut out = [0u8; POSE_PLAINTEXT_LEN];
        out[0] = self.version;
        out[1] = self.slot;
        out[2] = self.flags;
        out[4..8].copy_from_slice(&self.seq.to_be_bytes());
        out[8..16].copy_from_slice(&self.sender_ts_us.to_be_bytes());
        out[16..].copy_from_slice(&self.body);
        out
    }

    pub fn from_plaintext(bytes: &[u8]) -> Result<Self, CodecError> {
        let bytes: &[u8; POSE_PLAINTEXT_LEN] =
            bytes.try_into().map_err(|_| CodecError::BadLength {
                expected: POSE_PLAINTEXT_LEN,
                actual: bytes.len(),
            })?;
        let mut body = [0u8; POSE_BODY_LEN];
        body.copy_from_slice(&bytes[16..]);
        Ok(Self {
            version: bytes[0],
            slot: bytes[1],
            flags: bytes[2],
            seq: u32::from_be_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]),
            sender_ts_us: u64::from_be_bytes(bytes[8..16].try_into().expect("8 bytes")),
            body,
        })
    }
}

pub struct RoomCipher {
    cipher: Aes256Gcm,
    salt: [u8; 4],
}

impl RoomCipher {
    pub fn new(key: [u8; 32], salt: [u8; 4]) -> Self {
        Self {
            cipher: Aes256Gcm::new((&key).into()),
            salt,
        }
    }

    pub fn encrypt(&self, frame: &PoseFrame) -> Result<[u8; POSE_WIRE_LEN], CodecError> {
        if frame.slot > MAX_SLOT {
            return Err(CodecError::BadSlot(frame.slot));
        }
        let nonce_bytes = self.nonce(frame.slot, frame.seq);
        let sealed = self
            .cipher
            .encrypt(
                to_nonce(&nonce_bytes),
                Payload {
                    msg: &frame.to_plaintext(),
                    aad: &aad(frame.slot),
                },
            )
            .map_err(|_| CodecError::EncryptFailed)?;
        let mut wire = [0u8; POSE_WIRE_LEN];
        wire[..NONCE_LEN].copy_from_slice(&nonce_bytes);
        wire[NONCE_LEN..].copy_from_slice(&sealed);
        Ok(wire)
    }

    pub fn decrypt(&self, expected_slot: u8, wire: &[u8]) -> Result<PoseFrame, CodecError> {
        if wire.len() != POSE_WIRE_LEN {
            return Err(CodecError::BadLength {
                expected: POSE_WIRE_LEN,
                actual: wire.len(),
            });
        }
        if expected_slot > MAX_SLOT {
            return Err(CodecError::BadSlot(expected_slot));
        }
        let (nonce_bytes, sealed) = wire.split_at(NONCE_LEN);
        let nonce_bytes: [u8; NONCE_LEN] = nonce_bytes.try_into().expect("nonce length");
        let plaintext = self
            .cipher
            .decrypt(
                to_nonce(&nonce_bytes),
                Payload {
                    msg: sealed,
                    aad: &aad(expected_slot),
                },
            )
            .map_err(|_| CodecError::DecryptFailed)?;
        let frame = PoseFrame::from_plaintext(&plaintext)?;
        if frame.version != POSE_VERSION {
            return Err(CodecError::BadVersion(frame.version));
        }
        if frame.slot != expected_slot {
            return Err(CodecError::SlotMismatch {
                expected: expected_slot,
                actual: frame.slot,
            });
        }
        Ok(frame)
    }

    fn nonce(&self, slot: u8, seq: u32) -> [u8; NONCE_LEN] {
        let mut nonce = [0u8; NONCE_LEN];
        nonce[0] = slot;
        nonce[4..8].copy_from_slice(&seq.to_be_bytes());
        nonce[8..].copy_from_slice(&self.salt);
        nonce
    }
}

fn to_nonce(bytes: &[u8; NONCE_LEN]) -> &Nonce<<Aes256Gcm as AeadCore>::NonceSize> {
    bytes.into()
}

fn aad(slot: u8) -> [u8; AAD_PREFIX.len() + 1] {
    let mut out = [0u8; AAD_PREFIX.len() + 1];
    out[..AAD_PREFIX.len()].copy_from_slice(AAD_PREFIX);
    out[AAD_PREFIX.len()] = slot;
    out
}

pub fn parse_relay_envelope(bytes: &[u8]) -> Result<(u8, &[u8; POSE_WIRE_LEN]), CodecError> {
    if bytes.len() != RELAY_ENVELOPE_LEN {
        return Err(CodecError::BadLength {
            expected: RELAY_ENVELOPE_LEN,
            actual: bytes.len(),
        });
    }
    let slot = bytes[0];
    if slot > MAX_SLOT {
        return Err(CodecError::BadSlot(slot));
    }
    let wire = bytes[1..].try_into().expect("envelope length checked");
    Ok((slot, wire))
}

pub fn parse_livekit_slot(identity: &str) -> Result<u8, CodecError> {
    identity
        .strip_prefix("slot-")
        .filter(|digits| digits.len() == 1)
        .and_then(|digits| digits.parse::<u8>().ok())
        .filter(|slot| *slot <= MAX_SLOT)
        .ok_or_else(|| CodecError::BadLivekitIdentity(identity.to_owned()))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn cipher() -> RoomCipher {
        RoomCipher::new([7u8; 32], [1, 2, 3, 4])
    }

    fn frame(slot: u8, seq: u32) -> PoseFrame {
        let mut frame = PoseFrame::new(slot, seq, 1_700_000_000_123_456);
        frame.flags = 0b101;
        for (i, byte) in frame.body.iter_mut().enumerate() {
            *byte = (i % 251) as u8;
        }
        frame
    }

    #[test]
    fn plaintext_layout_is_340_bytes() {
        let plaintext = frame(2, 0x0102_0304).to_plaintext();
        assert_eq!(plaintext.len(), POSE_PLAINTEXT_LEN);
        assert_eq!(&plaintext[..4], &[1, 2, 0b101, 0]);
        assert_eq!(&plaintext[4..8], &[1, 2, 3, 4]);
        assert_eq!(&plaintext[8..16], &1_700_000_000_123_456u64.to_be_bytes());
        assert_eq!(
            PoseFrame::from_plaintext(&plaintext).unwrap(),
            frame(2, 0x0102_0304)
        );
    }

    #[test]
    fn encrypt_decrypt_round_trip_is_368_bytes() {
        let original = frame(1, 42);
        let wire = cipher().encrypt(&original).unwrap();
        assert_eq!(wire.len(), POSE_WIRE_LEN);
        assert_eq!(wire.len(), 368);
        assert_eq!(&wire[..NONCE_LEN], &[1, 0, 0, 0, 0, 0, 0, 42, 1, 2, 3, 4]);
        assert_eq!(cipher().decrypt(1, &wire).unwrap(), original);
    }

    #[test]
    fn tampering_with_any_byte_fails_decryption() {
        let wire = cipher().encrypt(&frame(3, 9)).unwrap();
        for index in NONCE_LEN..POSE_WIRE_LEN {
            let mut tampered = wire;
            tampered[index] ^= 0x01;
            assert_eq!(
                cipher().decrypt(3, &tampered),
                Err(CodecError::DecryptFailed),
                "byte {index}"
            );
        }
    }

    #[test]
    fn tampering_with_nonce_fails_decryption() {
        let mut wire = cipher().encrypt(&frame(3, 9)).unwrap();
        wire[7] ^= 0x01;
        assert_eq!(cipher().decrypt(3, &wire), Err(CodecError::DecryptFailed));
    }

    #[test]
    fn mismatched_expected_slot_fails_aad_check() {
        let wire = cipher().encrypt(&frame(1, 5)).unwrap();
        assert_eq!(cipher().decrypt(2, &wire), Err(CodecError::DecryptFailed));
    }

    #[test]
    fn wrong_key_fails_decryption() {
        let wire = cipher().encrypt(&frame(1, 5)).unwrap();
        let other = RoomCipher::new([8u8; 32], [1, 2, 3, 4]);
        assert_eq!(other.decrypt(1, &wire), Err(CodecError::DecryptFailed));
    }

    #[test]
    fn decrypt_rejects_wrong_length() {
        assert_eq!(
            cipher().decrypt(1, &[0u8; 367]),
            Err(CodecError::BadLength {
                expected: 368,
                actual: 367
            })
        );
    }

    #[test]
    fn encrypt_rejects_slot_above_three() {
        assert_eq!(cipher().encrypt(&frame(4, 0)), Err(CodecError::BadSlot(4)));
    }

    #[test]
    fn relay_envelope_accepts_slots_zero_to_three() {
        for slot in 0..=3u8 {
            let mut bytes = [0xAAu8; RELAY_ENVELOPE_LEN];
            bytes[0] = slot;
            let (parsed, wire) = parse_relay_envelope(&bytes).unwrap();
            assert_eq!(parsed, slot);
            assert_eq!(wire.len(), POSE_WIRE_LEN);
        }
    }

    #[test]
    fn relay_envelope_rejects_bad_slot_and_length() {
        let mut bytes = [0u8; RELAY_ENVELOPE_LEN];
        bytes[0] = 4;
        assert_eq!(parse_relay_envelope(&bytes), Err(CodecError::BadSlot(4)));
        assert_eq!(
            parse_relay_envelope(&bytes[..368]),
            Err(CodecError::BadLength {
                expected: 369,
                actual: 368
            })
        );
    }

    #[test]
    fn livekit_identity_maps_to_slot() {
        assert_eq!(parse_livekit_slot("slot-2"), Ok(2));
        assert_eq!(parse_livekit_slot("slot-0"), Ok(0));
        for bad in [
            "slot-4", "guest", "slot-", "slot-02", "slot--1", "slot-+1", "Slot-1",
        ] {
            assert!(parse_livekit_slot(bad).is_err(), "{bad}");
        }
    }
}
