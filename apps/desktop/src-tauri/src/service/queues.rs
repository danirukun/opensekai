use std::collections::VecDeque;
pub const STATE_CAPACITY: usize = 2;
pub const CONTROL_CAPACITY: usize = 64;
pub const PENDING_CAPACITY: usize = 32;
pub struct StateQueue<T>(VecDeque<T>);
impl<T> Default for StateQueue<T> {
    fn default() -> Self {
        Self(VecDeque::new())
    }
}
impl<T> StateQueue<T> {
    pub fn len(&self) -> usize {
        self.0.len()
    }
    pub fn push(&mut self, value: T) {
        if self.0.len() == STATE_CAPACITY {
            self.0.pop_front();
        }
        self.0.push_back(value);
    }
    pub fn clear(&mut self) {
        self.0.clear();
    }
    pub fn pop(&mut self) -> Option<T> {
        self.0.pop_front()
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn service_queue_keeps_two_latest_frames() {
        let mut q = StateQueue::default();
        for n in 0..100 {
            q.push(n);
        }
        assert_eq!(q.pop(), Some(98));
        assert_eq!(q.pop(), Some(99));
        assert_eq!(q.pop(), None);
    }
}
