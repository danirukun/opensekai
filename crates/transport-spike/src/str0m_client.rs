use std::net::{SocketAddr, UdpSocket};
use std::time::{Duration, Instant};

use str0m::channel::{ChannelConfig, ChannelId, Reliability};
use str0m::net::{Protocol, Receive};
use str0m::{Candidate, Event, Input, Output, Rtc};

pub fn pose_channel_config() -> ChannelConfig {
    ChannelConfig {
        label: "pose".to_string(),
        ordered: false,
        reliability: Reliability::MaxRetransmits { retransmits: 0 },
        ..Default::default()
    }
}

pub struct Offer {
    pub sdp: String,
    pub candidate: String,
    pub pending: SdpPendingHold,
    pub rtc: Rtc,
    pub socket: UdpSocket,
    pub channel_id: ChannelId,
}

pub struct SdpPendingHold {
    inner: str0m::change::SdpPendingOffer,
}

pub struct Session {
    rtc: Rtc,
    socket: UdpSocket,
    channel_id: ChannelId,
    open: bool,
    inbound: Vec<(Vec<u8>, u64)>,
    pub udp_in: u64,
    pub ice: String,
}

impl Session {
    pub fn offer() -> Result<Offer, String> {
        let socket = UdpSocket::bind("127.0.0.1:0").map_err(|err| err.to_string())?;
        socket
            .set_read_timeout(Some(Duration::from_millis(2)))
            .map_err(|err| err.to_string())?;
        let local = socket.local_addr().map_err(|err| err.to_string())?;
        let mut rtc = Rtc::new(Instant::now());
        let candidate = Candidate::host(local, "udp").map_err(|err| format!("{err:?}"))?;
        rtc.add_local_candidate(candidate.clone());
        drain(&mut rtc, &socket)?;
        let mut change = rtc.sdp_api();
        let channel_id = change.add_channel_with_config(pose_channel_config());
        let (offer, pending) = change
            .apply()
            .ok_or_else(|| "offer did not negotiate".to_string())?;
        drain(&mut rtc, &socket)?;
        Ok(Offer {
            // ex_webrtc 0.18 starts SCTP only when it sent the SDP offer.
            // str0m starts SCTP only when it is the DTLS client. Offer
            // setup:active so str0m is the DTLS client and sends the SCTP INIT.
            sdp: offer.to_sdp_string().replace("a=setup:actpass", "a=setup:active"),
            candidate: candidate.to_string(),
            pending: SdpPendingHold { inner: pending },
            rtc,
            socket,
            channel_id,
        })
    }

    pub fn accept(offer: Offer, answer_sdp: &str, remote_candidates: &[String]) -> Result<Self, String> {
        let Offer {
            pending,
            mut rtc,
            socket,
            channel_id,
            ..
        } = offer;
        let answer = str0m::change::SdpAnswer::from_sdp_string(answer_sdp)
            .map_err(|err| format!("answer parse {err:?}"))?;
        rtc.sdp_api()
            .accept_answer(pending.inner, answer)
            .map_err(|err| format!("accept answer {err:?}"))?;
        drain(&mut rtc, &socket)?;
        for line in remote_candidates {
            if line.is_empty() {
                continue;
            }
            let candidate = Candidate::from_sdp_string(line).map_err(|err| format!("candidate {err:?}"))?;
            rtc.add_remote_candidate(candidate);
            drain(&mut rtc, &socket)?;
        }
        Ok(Self {
            rtc,
            socket,
            channel_id,
            open: false,
            inbound: Vec::new(),
            udp_in: 0,
            ice: "new".to_string(),
        })
    }

    pub fn pump(&mut self, until: Instant) -> Result<(), String> {
        let mut buf = vec![0u8; 2000];
        while Instant::now() < until {
            self.poll_out()?;
            self.socket
                .set_read_timeout(Some(Duration::from_millis(2)))
                .map_err(|err| err.to_string())?;
            let input = match self.socket.recv_from(&mut buf) {
                Ok((n, source)) => {
                    self.udp_in += 1;
                    Input::Receive(
                    Instant::now(),
                    Receive {
                        proto: Protocol::Udp,
                        source,
                        destination: self.socket.local_addr().map_err(|err| err.to_string())?,
                        contents: buf[..n].try_into().map_err(|err| format!("{err:?}"))?,
                    },
                )
                }
                Err(err) if err.kind() == std::io::ErrorKind::WouldBlock || err.kind() == std::io::ErrorKind::TimedOut => {
                    Input::Timeout(Instant::now())
                }
                Err(err) => return Err(err.to_string()),
            };
            self.rtc
                .handle_input(input)
                .map_err(|err| format!("input {err:?}"))?;
            self.poll_out()?;
        }
        Ok(())
    }

    pub fn wait_open(&mut self, budget: Duration) -> Result<bool, String> {
        if self.rtc.channel(self.channel_id).is_some() {
            self.open = true;
            return Ok(true);
        }
        let deadline = Instant::now() + budget;
        while Instant::now() < deadline {
            self.pump(Instant::now() + Duration::from_millis(20))?;
            if self.open || self.rtc.channel(self.channel_id).is_some() {
                self.open = true;
                return Ok(true);
            }
        }
        Ok(self.open)
    }

    pub fn send(&mut self, bytes: &[u8]) -> Result<bool, String> {
        let accepted = {
            let mut channel = self
                .rtc
                .channel(self.channel_id)
                .ok_or_else(|| "pose channel missing".to_string())?;
            channel
                .write(true, bytes)
                .map_err(|err| format!("write {err:?}"))?
        };
        self.poll_out()?;
        Ok(accepted)
    }

    pub fn inbound(&self) -> &[(Vec<u8>, u64)] {
        &self.inbound
    }

    fn poll_out(&mut self) -> Result<(), String> {
        for _ in 0..128 {
            match self.rtc.poll_output() {
                Ok(Output::Timeout(_)) => return Ok(()),
                Ok(Output::Transmit(transmit)) => {
                    let _ = self.socket.send_to(&transmit.contents, transmit.destination);
                }
                Ok(Output::Event(event)) => self.on_event(event),
                Err(err) => return Err(format!("poll {err:?}")),
            }
        }
        Ok(())
    }

    fn on_event(&mut self, event: Event) {
        match event {
            Event::ChannelOpen(id, _) if id == self.channel_id => self.open = true,
            Event::IceConnectionStateChange(state) => self.ice = format!("{state:?}"),
            Event::Connected => self.ice = "connected".to_string(),
            Event::ChannelData(data) if data.id == self.channel_id => {
                self.inbound.push((data.data, recv_us()));
            }
            _ => {}
        }
    }
}

fn recv_us() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_micros() as u64)
        .unwrap_or(0)
}

fn drain(rtc: &mut Rtc, socket: &UdpSocket) -> Result<(), String> {
    for _ in 0..128 {
        match rtc.poll_output() {
            Ok(Output::Timeout(_)) => return Ok(()),
            Ok(Output::Transmit(transmit)) => {
                let _ = socket.send_to(&transmit.contents, transmit.destination);
            }
            Ok(Output::Event(_)) => {}
            Err(err) => return Err(format!("drain {err:?}")),
        }
    }
    Ok(())
}

#[allow(dead_code)]
pub fn local_candidate_line(addr: SocketAddr) -> Result<String, String> {
    let candidate = Candidate::host(addr, "udp").map_err(|err| format!("{err:?}"))?;
    Ok(candidate.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pose_channel_does_not_retransmit_and_is_unordered() {
        let config = pose_channel_config();
        assert!(!config.ordered);
        assert!(matches!(
            config.reliability,
            Reliability::MaxRetransmits { retransmits: 0 }
        ));
    }
}
