#[derive(Clone, Debug, PartialEq)]
pub struct Sample {
    pub send_us: u64,
    pub recv_us: u64,
}

#[derive(Clone, Debug, PartialEq)]
pub struct Summary {
    pub loss_pct: Option<f64>,
    pub jitter_ms: Option<f64>,
    pub p95_ms: Option<f64>,
}

pub fn summarize(sent: u64, samples: &[Sample]) -> Summary {
    if samples.is_empty() || sent == 0 {
        return Summary {
            loss_pct: None,
            jitter_ms: None,
            p95_ms: None,
        };
    }
    let got = samples.len() as u64;
    let lost = sent.saturating_sub(got);
    let loss_pct = (lost as f64) * 100.0 / (sent as f64);
    Summary {
        loss_pct: Some(loss_pct),
        jitter_ms: Some(jitter_ms(samples)),
        p95_ms: Some(p95_ms(samples)),
    }
}

fn jitter_ms(samples: &[Sample]) -> f64 {
    let mut jitter = 0.0;
    for pair in samples.windows(2) {
        let send_delta = pair[1].send_us as f64 - pair[0].send_us as f64;
        let recv_delta = pair[1].recv_us as f64 - pair[0].recv_us as f64;
        let d = recv_delta - send_delta;
        jitter += (d.abs() - jitter) / 16.0;
    }
    jitter / 1000.0
}

fn p95_ms(samples: &[Sample]) -> f64 {
    let mut delays: Vec<f64> = samples
        .iter()
        .map(|sample| (sample.recv_us as f64 - sample.send_us as f64) / 1000.0)
        .collect();
    delays.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
    let index = ((delays.len() as f64) * 0.95).ceil() as usize - 1;
    delays[index.min(delays.len() - 1)]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_samples_are_null_not_zero() {
        let summary = summarize(0, &[]);
        assert_eq!(summary.loss_pct, None);
        assert_eq!(summary.jitter_ms, None);
        assert_eq!(summary.p95_ms, None);
    }

    #[test]
    fn p95_uses_the_upper_tail() {
        let samples: Vec<Sample> = (0..100)
            .map(|i| Sample {
                send_us: 0,
                recv_us: i * 1000,
            })
            .collect();
        let summary = summarize(100, &samples);
        assert_eq!(summary.loss_pct, Some(0.0));
        assert!(summary.p95_ms.unwrap() >= 94.0);
    }
}
