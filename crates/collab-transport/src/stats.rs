use std::collections::HashSet;
use std::time::Duration;

use serde::Serialize;

const FREEZE_THRESHOLD_MS: f64 = 100.0;

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct ImpairmentConfig {
    pub loss_pct: f64,
    pub jitter_ms: f64,
    pub seed: u64,
}

pub struct ImpairmentFilter {
    config: ImpairmentConfig,
    state: u64,
}

impl ImpairmentFilter {
    pub fn new(config: ImpairmentConfig) -> Self {
        Self {
            config,
            state: config.seed,
        }
    }

    /// `None` drops the packet; `Some(delay)` delivers it after `delay`.
    pub fn apply(&mut self) -> Option<Duration> {
        let loss_roll = self.next_unit();
        let delay_roll = self.next_unit();
        if loss_roll * 100.0 < self.config.loss_pct {
            return None;
        }
        let delay_ms = (self.config.jitter_ms * delay_roll).max(0.0);
        Some(Duration::from_secs_f64(delay_ms / 1000.0))
    }

    fn next_unit(&mut self) -> f64 {
        self.state = self.state.wrapping_add(0x9E37_79B9_7F4A_7C15);
        let mut z = self.state;
        z = (z ^ (z >> 30)).wrapping_mul(0xBF58_476D_1CE4_E5B9);
        z = (z ^ (z >> 27)).wrapping_mul(0x94D0_49BB_1331_11EB);
        z ^= z >> 31;
        (z >> 11) as f64 / (1u64 << 53) as f64
    }
}

#[derive(Debug, Clone, Copy)]
struct Sample {
    seq: u32,
    sender_ts_us: i64,
    recv_ts_us: i64,
}

#[derive(Default)]
pub struct StreamMetrics {
    samples: Vec<Sample>,
    seen: HashSet<u32>,
}

/// Fields that cannot be computed from the recorded samples are `NAN` (unknown), never zero.
#[derive(Debug, Clone, Serialize)]
pub struct StreamSummary {
    pub received: u64,
    pub expected: u64,
    pub loss_pct: f64,
    pub rfc3550_jitter_ms: f64,
    pub latency_p50_ms: f64,
    pub latency_p95_ms: f64,
    pub latency_p99_ms: f64,
    pub max_raw_gap_ms: f64,
    pub max_buffered_freeze_ms: f64,
    pub freezes_over_100ms: u64,
}

impl StreamMetrics {
    pub fn new() -> Self {
        Self::default()
    }

    /// Records one frame. A repeated `seq` is ignored.
    pub fn record(&mut self, seq: u32, sender_ts_us: u64, recv_ts_us: u64) {
        if self.seen.insert(seq) {
            self.samples.push(Sample {
                seq,
                sender_ts_us: sender_ts_us as i64,
                recv_ts_us: recv_ts_us as i64,
            });
        }
    }

    /// `jitter_buf_ms` is the fixed playout delay of the simulated jitter buffer.
    /// `freezes_over_100ms` counts gaps above 100 ms between displayed frames of that buffer.
    pub fn summary(&self, jitter_buf_ms: u64) -> StreamSummary {
        let received = self.samples.len() as u64;
        let expected = match (self.seen.iter().min(), self.seen.iter().max()) {
            (Some(min), Some(max)) => u64::from(max - min) + 1,
            _ => 0,
        };
        let loss_pct = if expected == 0 {
            f64::NAN
        } else {
            (expected - received) as f64 / expected as f64 * 100.0
        };
        let mut latencies: Vec<f64> = self
            .samples
            .iter()
            .map(|s| us_to_ms(s.recv_ts_us - s.sender_ts_us))
            .collect();
        latencies.sort_by(f64::total_cmp);
        let raw_gaps = self
            .samples
            .windows(2)
            .map(|pair| us_to_ms(pair[1].recv_ts_us - pair[0].recv_ts_us));
        let buffered_gaps = self.buffered_gaps(jitter_buf_ms);
        StreamSummary {
            received,
            expected,
            loss_pct,
            rfc3550_jitter_ms: self.rfc3550_jitter_ms(),
            latency_p50_ms: percentile(&latencies, 50.0),
            latency_p95_ms: percentile(&latencies, 95.0),
            latency_p99_ms: percentile(&latencies, 99.0),
            max_raw_gap_ms: max_or_nan(raw_gaps),
            max_buffered_freeze_ms: max_or_nan(buffered_gaps.iter().copied()),
            freezes_over_100ms: buffered_gaps
                .iter()
                .filter(|gap| **gap > FREEZE_THRESHOLD_MS)
                .count() as u64,
        }
    }

    fn rfc3550_jitter_ms(&self) -> f64 {
        if self.samples.len() < 2 {
            return f64::NAN;
        }
        self.samples.windows(2).fold(0.0, |jitter, pair| {
            let transit_delta = (pair[1].recv_ts_us - pair[0].recv_ts_us)
                - (pair[1].sender_ts_us - pair[0].sender_ts_us);
            jitter + (us_to_ms(transit_delta).abs() - jitter) / 16.0
        })
    }

    /// Plays frames in arrival order at `sender_ts + anchor + buffer`, or on arrival when late.
    /// A frame whose `seq` is not above the last played one is discarded.
    fn buffered_gaps(&self, jitter_buf_ms: u64) -> Vec<f64> {
        let Some(first) = self.samples.first() else {
            return Vec::new();
        };
        let offset_us = first.recv_ts_us - first.sender_ts_us + jitter_buf_ms as i64 * 1000;
        let mut last_seq = None;
        let mut last_play_us: Option<i64> = None;
        let mut gaps = Vec::new();
        for sample in &self.samples {
            if last_seq.is_some_and(|seq| sample.seq <= seq) {
                continue;
            }
            last_seq = Some(sample.seq);
            let ready_us = (sample.sender_ts_us + offset_us).max(sample.recv_ts_us);
            let play_us = last_play_us.map_or(ready_us, |prev| ready_us.max(prev));
            if let Some(prev) = last_play_us {
                gaps.push(us_to_ms(play_us - prev));
            }
            last_play_us = Some(play_us);
        }
        gaps
    }
}

fn us_to_ms(us: i64) -> f64 {
    us as f64 / 1000.0
}

fn percentile(sorted: &[f64], pct: f64) -> f64 {
    if sorted.is_empty() {
        return f64::NAN;
    }
    let rank = (pct / 100.0 * sorted.len() as f64).ceil() as usize;
    sorted[rank.clamp(1, sorted.len()) - 1]
}

fn max_or_nan(values: impl Iterator<Item = f64>) -> f64 {
    values.reduce(f64::max).unwrap_or(f64::NAN)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FRAME_US: u64 = 16_667;

    fn feed(
        metrics: &mut StreamMetrics,
        frames: impl IntoIterator<Item = (u32, u64)>,
        latency_us: u64,
    ) {
        for (seq, arrival_offset_us) in frames {
            let sent = seq as u64 * FRAME_US;
            metrics.record(seq, sent, sent + latency_us + arrival_offset_us);
        }
    }

    #[test]
    fn steady_60hz_stream_has_no_loss_or_freezes() {
        let mut metrics = StreamMetrics::new();
        feed(&mut metrics, (0..600).map(|seq| (seq, 0)), 20_000);
        let summary = metrics.summary(0);
        assert_eq!(summary.received, 600);
        assert_eq!(summary.expected, 600);
        assert_eq!(summary.loss_pct, 0.0);
        assert!((summary.latency_p95_ms - 20.0).abs() < 0.01);
        assert!((summary.max_raw_gap_ms - 16.667).abs() < 0.01);
        assert_eq!(summary.freezes_over_100ms, 0);
        assert!(summary.rfc3550_jitter_ms < 0.01);
    }

    #[test]
    fn dropped_sequence_numbers_count_as_loss() {
        let mut metrics = StreamMetrics::new();
        feed(&mut metrics, [0, 1, 3, 4].map(|seq| (seq, 0)), 20_000);
        let summary = metrics.summary(0);
        assert_eq!(summary.received, 4);
        assert_eq!(summary.expected, 5);
        assert!((summary.loss_pct - 20.0).abs() < 1e-9);
    }

    #[test]
    fn duplicate_sequence_numbers_are_ignored() {
        let mut metrics = StreamMetrics::new();
        feed(&mut metrics, [0, 1, 1, 2].map(|seq| (seq, 0)), 20_000);
        assert_eq!(metrics.summary(0).received, 3);
    }

    #[test]
    fn late_arrival_after_150ms_gap_is_a_freeze() {
        let mut metrics = StreamMetrics::new();
        feed(&mut metrics, (0..10).map(|seq| (seq, 0)), 20_000);
        feed(&mut metrics, (10..20).map(|seq| (seq, 150_000)), 20_000);
        let summary = metrics.summary(0);
        assert!(summary.max_raw_gap_ms >= 150.0);
        assert!(summary.freezes_over_100ms >= 1);
        assert!(summary.max_buffered_freeze_ms >= 100.0);
    }

    #[test]
    fn out_of_order_arrival_is_counted_once_and_not_lost() {
        let mut metrics = StreamMetrics::new();
        metrics.record(0, 0, 20_000);
        metrics.record(2, 2 * FRAME_US, 2 * FRAME_US + 20_000);
        metrics.record(1, FRAME_US, 2 * FRAME_US + 25_000);
        let summary = metrics.summary(0);
        assert_eq!(summary.received, 3);
        assert_eq!(summary.expected, 3);
        assert_eq!(summary.loss_pct, 0.0);
    }

    #[test]
    fn jitter_buffer_absorbs_30ms_arrival_jitter() {
        let mut metrics = StreamMetrics::new();
        let jitter = |seq: u32| if seq.is_multiple_of(2) { 0 } else { 30_000 };
        feed(&mut metrics, (0..600).map(|seq| (seq, jitter(seq))), 20_000);
        let summary = metrics.summary(40);
        assert!(
            summary.max_raw_gap_ms > 40.0,
            "raw gap {}",
            summary.max_raw_gap_ms
        );
        assert!(
            summary.max_buffered_freeze_ms <= 50.0,
            "buffered {}",
            summary.max_buffered_freeze_ms
        );
        assert_eq!(summary.freezes_over_100ms, 0);
    }

    #[test]
    fn jitter_buffer_does_not_hide_a_150ms_hole() {
        let mut metrics = StreamMetrics::new();
        feed(&mut metrics, (0..10).map(|seq| (seq, 0)), 20_000);
        feed(&mut metrics, (10..20).map(|seq| (seq, 150_000)), 20_000);
        let summary = metrics.summary(40);
        assert!(summary.max_buffered_freeze_ms > 100.0);
        assert!(summary.max_buffered_freeze_ms < summary.max_raw_gap_ms);
        assert!(summary.freezes_over_100ms >= 1);
    }

    #[test]
    fn rfc3550_jitter_converges_to_alternating_delay() {
        let mut metrics = StreamMetrics::new();
        feed(
            &mut metrics,
            (0..2000).map(|seq| (seq, if seq % 2 == 0 { 0 } else { 8_000 })),
            20_000,
        );
        let jitter = metrics.summary(0).rfc3550_jitter_ms;
        assert!((jitter - 8.0).abs() < 0.2, "jitter {jitter}");
    }

    #[test]
    fn empty_metrics_report_unknown() {
        let summary = StreamMetrics::new().summary(0);
        assert_eq!(summary.received, 0);
        assert!(summary.latency_p95_ms.is_nan());
        assert!(summary.max_raw_gap_ms.is_nan());
        assert!(summary.loss_pct.is_nan());
    }

    #[test]
    fn impairment_filter_is_deterministic_for_a_seed() {
        let config = ImpairmentConfig {
            loss_pct: 10.0,
            jitter_ms: 30.0,
            seed: 42,
        };
        let run = || {
            let mut filter = ImpairmentFilter::new(config);
            (0..1000).map(|_| filter.apply()).collect::<Vec<_>>()
        };
        assert_eq!(run(), run());
    }

    #[test]
    fn impairment_filter_drops_about_ten_percent_and_bounds_delay() {
        let config = ImpairmentConfig {
            loss_pct: 10.0,
            jitter_ms: 30.0,
            seed: 7,
        };
        let mut filter = ImpairmentFilter::new(config);
        let outcomes: Vec<_> = (0..20_000).map(|_| filter.apply()).collect();
        let dropped = outcomes.iter().filter(|o| o.is_none()).count() as f64;
        let drop_pct = dropped / outcomes.len() as f64 * 100.0;
        assert!((drop_pct - 10.0).abs() < 1.0, "drop {drop_pct}");
        let delays: Vec<_> = outcomes.into_iter().flatten().collect();
        assert!(delays.iter().all(|d| *d <= Duration::from_millis(30)));
        assert!(delays.iter().any(|d| *d > Duration::from_millis(25)));
        assert!(delays.iter().any(|d| *d < Duration::from_millis(5)));
    }

    #[test]
    fn impairment_filter_with_zero_config_passes_everything_immediately() {
        let mut filter = ImpairmentFilter::new(ImpairmentConfig {
            loss_pct: 0.0,
            jitter_ms: 0.0,
            seed: 1,
        });
        assert!((0..100).all(|_| filter.apply() == Some(Duration::ZERO)));
    }
}
