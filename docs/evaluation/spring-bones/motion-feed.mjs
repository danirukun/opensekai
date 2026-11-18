#!/usr/bin/env node
// VMC sender for the spring bone checks: hips, spine, and head rotations that swing the hair, at 60 Hz.
// Usage: node docs/evaluation/spring-bones/motion-feed.mjs <port>[,<port>...] [seconds=600] [scale=1] [mode=wave|step]
// mode step: a still pose for 2 s, then the spine and the head turn at once and stay, so later change is secondary motion.
// Use a VMC source with positions 'rotationsOnly': the feed sends no positions that the avatar can use.
import dgram from 'node:dgram';

const [ports = '39541', seconds = '600', scale = '1', mode = 'wave'] = process.argv.slice(2);
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
const bone = (name, rx, ry, rz) => message('/VMC/Ext/Bone/Pos', 'sfffffff', [name, 0, 0, 0, ...quat(rx, ry, rz)]);
const k = Number(scale), wave = (t, period) => Math.sin(2 * Math.PI * t / period);
const step = t => bundle([
    message('/VMC/Ext/OK', 'i', [1]),
    bone('Hips', 0, 0, 0),
    bone('Spine', 0, 0, t < 2 ? 0 : 10 * k),
    bone('Head', 0, t < 2 ? 0 : 30 * k, 0),
]);
const frame = t => mode === 'step' ? step(t) : bundle([
    message('/VMC/Ext/OK', 'i', [1]),
    bone('Hips', 0, 15 * k * wave(t, 3.1), 5 * k * wave(t, 1.7)),
    bone('Spine', 6 * k * wave(t, 2.3), 0, 8 * k * wave(t, 1.3)),
    bone('Head', 10 * k * wave(t, 1.9), 25 * k * wave(t, 2.6), 6 * k * wave(t, 1.1)),
]);

const socket = dgram.createSocket('udp4'), targets = ports.split(',').map(Number), start = performance.now();
const timer = setInterval(() => {
    const t = (performance.now() - start) / 1000;
    if (t > Number(seconds)) { clearInterval(timer); socket.close(); return; }
    const packet = frame(t);
    for (const port of targets) socket.send(packet, port, '127.0.0.1');
}, 1000 / 60);
