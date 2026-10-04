export function reconnectDelay(attempt: number): number { return [
    100,
    250,
    500,
    1000
][Math.min(3, Math.max(0, Math.floor(attempt)))]!; }
