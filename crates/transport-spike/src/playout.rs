pub fn deliver_unordered(seq: u32) -> u32 {
    seq
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_gap_does_not_hold_the_next_pose() {
        assert_eq!(deliver_unordered(1), 1);
        assert_eq!(deliver_unordered(3), 3);
    }
}
