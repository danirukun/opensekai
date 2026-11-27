#!/usr/bin/env node
// VMC sender for the snow shed check: a head shake on one axis, at 60 Hz.
// Usage: node docs/evaluation/snow/shake-feed.mjs [port=39601] [axis=yaw|pitch|roll] [degrees=30] [hz=2] [seconds=3] [holdSeconds=0.5]
// It sends a still head for holdSeconds, the shake for seconds, and a still head for holdSeconds again.
// Use a VMC source with positions 'rotationsOnly' and smoothing off: the feed sends no position that the avatar can use.
import dgram from 'node:dgram';
import { fileURLToPath } from 'node:url';

const pad = buffer => Buffer.concat([buffer, Buffer.alloc(4 - (buffer.length % 4))]);
const text = value => pad(Buffer.from(value, 'utf8'));
const message = (address, types, args) => {
    const values = args.map((value, index) => {
        if (types[index] === 's') return text(value);
        const buffer = Buffer.alloc(4);
        types[index] === 'i' ? buffer.writeInt32BE(value) : buffer.writeFloatBE(value);
        return buffer;
    });
    return Buffer.concat([text(address), text(',' + types), ...values]);
};
const bundle = messages => Buffer.concat([text('#bundle'), Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]), ...messages.flatMap(item => {
    const size = Buffer.alloc(4); size.writeInt32BE(item.length); return [size, item];
})]);
// Unity order: Z, then X, then Y. Degrees.
const quat = (rx, ry, rz) => {
    const h = degrees => degrees * Math.PI / 360;
    const [sx, cx, sy, cy, sz, cz] = [Math.sin(h(rx)), Math.cos(h(rx)), Math.sin(h(ry)), Math.cos(h(ry)), Math.sin(h(rz)), Math.cos(h(rz))];
    return [cy * sx * cz + sy * cx * sz, sy * cx * cz - cy * sx * sz, cy * cx * sz - sy * sx * cz, cy * cx * cz + sy * sx * sz];
};
/** The head angle in degrees at t seconds. */
export const angle = (t, degrees, hz, seconds, hold) => t >= hold && t < hold + seconds ? degrees * Math.sin(2 * Math.PI * hz * (t - hold)) : 0;
export const frame = (axis, value) => bundle([
    message('/VMC/Ext/OK', 'i', [1]),
    message('/VMC/Ext/Bone/Pos', 'sfffffff', ['Head', 0, 0, 0, ...(axis === 'pitch' ? quat(value, 0, 0) : axis === 'roll' ? quat(0, 0, value) : quat(0, value, 0))]),
    message('/VMC/Ext/Blend/Apply', '', []),
]);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const [port = '39601', axis = 'yaw', degrees = '30', hz = '2', seconds = '3', hold = '0.5'] = process.argv.slice(2);
    const socket = dgram.createSocket('udp4'), start = performance.now(), total = 2 * Number(hold) + Number(seconds);
    console.log(`shake ${axis} ±${degrees}° at ${hz} Hz for ${seconds} s (peak ${(Number(degrees) * Math.PI / 180 * 2 * Math.PI * Number(hz)).toFixed(2)} rad/s) to 127.0.0.1:${port}`);
    const timer = setInterval(() => {
        const t = (performance.now() - start) / 1000;
        if (t >= total) { clearInterval(timer); socket.close(); return; }
        socket.send(frame(axis, angle(t, Number(degrees), Number(hz), Number(seconds), Number(hold))), Number(port), '127.0.0.1');
    }, 1000 / 60);
}
