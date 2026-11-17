import { it, expect } from 'vitest';
import { EXPRESSION_STEPS, canonicalArkitName } from '@opensekai/contracts';
import { FEED_NAMES, FEED_STEPS, STEP_SECONDS, ifmFrame, parseArgs, schedule, sway, vmcFrame } from '../src/tracking-feed';
import { decodePacket } from '../src/vmc-feed';

const NEUTRAL = 3;
const at = (step: number, offset = STEP_SECONDS / 2) => NEUTRAL + step * STEP_SECONDS + offset;
const active = (values: Record<string, number>) => Object.entries(values).filter(([, value]) => value > 0).map(([name]) => name).sort();

it('gives all zeros in the neutral phase and a small head sway', () => {
 for (const t of [0, 1.3, 2.99]) expect(active(schedule(t, NEUTRAL))).toEqual([]);
 const head = [0, 0.5, 1, 1.5, 2].map(sway);
 expect(head.some(h => h.ry !== 0)).toBe(true);
 expect(head.every(h => Math.abs(h.rx) <= 10 && Math.abs(h.ry) <= 10 && Math.abs(h.rz) <= 10)).toBe(true);
});

it('gives each expression target at 1.0 in sequence, 2 s for each step, then repeats', () => {
 expect(FEED_STEPS).toEqual(['blink', 'mouthWide', 'browsUp', 'smile', 'frown', 'pucker', 'lookAround']);
 FEED_STEPS.forEach((step, index) => {
  if (step === 'lookAround') return;
  const values = schedule(at(index), NEUTRAL);
  expect(active(values)).toEqual([...EXPRESSION_STEPS[step].main].sort());
  for (const name of EXPRESSION_STEPS[step].main) expect(values[name]).toBe(1);
 });
 expect(active(schedule(at(FEED_STEPS.length), NEUTRAL))).toEqual([...EXPRESSION_STEPS.blink.main].sort());
});

it('moves the eyes through up, down, in, and out with eyeLook channels on the look step', () => {
 const look = FEED_STEPS.indexOf('lookAround');
 const seen = [0.25, 0.75, 1.25, 1.75].map(offset => active(schedule(at(look, offset), NEUTRAL)));
 expect(seen).toEqual([
  ['eyeLookUpLeft', 'eyeLookUpRight'],
  ['eyeLookDownLeft', 'eyeLookDownRight'],
  ['eyeLookInLeft', 'eyeLookInRight'],
  ['eyeLookOutLeft', 'eyeLookOutRight']
 ]);
});

it('never gives cheekPuff or tongueOut', () => {
 expect(FEED_NAMES).not.toContain('cheekPuff');
 expect(FEED_NAMES).not.toContain('tongueOut');
 for (let t = 0; t < NEUTRAL + 3 * FEED_STEPS.length * STEP_SECONDS; t += 0.1) {
  const values = schedule(t, NEUTRAL);
  expect(values).not.toHaveProperty('cheekPuff');
  expect(values).not.toHaveProperty('tongueOut');
 }
});

it('writes an iFacialMocap frame with name-NN channels, a head, and two eyes, inside the receiver limits', () => {
 const values = schedule(at(0), NEUTRAL);
 const text = ifmFrame(values, { rx: 1.5, ry: -2, rz: 0 });
 const parts = text.split('|');
 expect(parts.length).toBeLessThanOrEqual(64);
 expect(Buffer.byteLength(text)).toBeLessThanOrEqual(8192);
 expect(parts).toContain('eyeBlink_L-100');
 expect(parts).toContain('eyeBlink_R-100');
 expect(parts).toContain('jawOpen-0');
 expect(parts).toContain('head#1.500,-2.000,0.000,0.000,0.000,0.000');
 expect(parts.filter(p => /^(left|right)Eye#-?\d+\.\d{3},-?\d+\.\d{3},-?\d+\.\d{3}$/.test(p))).toHaveLength(2);
 const channels = parts.filter(p => !p.includes('#'));
 expect(channels).toHaveLength(FEED_NAMES.length);
 for (const channel of channels) {
  const [name, value] = channel.split('-');
  expect(canonicalArkitName(name!)).toBeDefined();
  expect(Number(value)).toSatisfy((n: number) => Number.isInteger(n) && n >= 0 && n <= 100);
 }
});

it('rounds an iFacialMocap value to a whole percent', () => {
 expect(ifmFrame({ jawOpen: 0.456 }, { rx: 0, ry: 0, rz: 0 }).split('|')).toContain('jawOpen-46');
});

it('writes one VMC bundle with a blend value for each name, Apply, and the Head bone', () => {
 const values = schedule(at(1), NEUTRAL);
 const buf = vmcFrame(values, { rx: 0, ry: 90, rz: 0 });
 expect(buf.length).toBeLessThanOrEqual(8192);
 const messages = decodePacket(buf);
 const blends = messages.filter(m => m.address === '/VMC/Ext/Blend/Val');
 expect(blends.map(m => m.args[0])).toEqual([...FEED_NAMES]);
 expect(blends.find(m => m.args[0] === 'jawOpen')?.args[1]).toBe(1);
 expect(messages.at(-1)?.address).toBe('/VMC/Ext/Blend/Apply');
 const head = messages.find(m => m.address === '/VMC/Ext/Bone/Pos');
 expect(head?.args[0]).toBe('Head');
 expect(head?.types).toBe('sfffffff');
 const [, , , , qx, qy, qz, qw] = head!.args.map(Number);
 expect(Math.hypot(qx!, qy!, qz!, qw!)).toBeCloseTo(1, 5);
 expect(qy).toBeCloseTo(Math.SQRT1_2, 5);
});

it('parses the CLI arguments with a port default for each kind', () => {
 expect(parseArgs(['--kind', 'vmc'])).toEqual({ kind: 'vmc', host: '127.0.0.1', port: 39539, neutralSeconds: 3, seconds: Infinity });
 expect(parseArgs(['--kind', 'ifacialmocap', '--host', '192.168.1.5', '--port', '50000', '--neutral-seconds', '0', '--seconds', '20']))
  .toEqual({ kind: 'ifacialmocap', host: '192.168.1.5', port: 50000, neutralSeconds: 0, seconds: 20 });
 expect(parseArgs(['--kind', 'ifacialmocap']).port).toBe(49983);
});

it('rejects a bad kind, a port outside 1-65535, and a negative number of seconds', () => {
 expect(() => parseArgs([])).toThrow(/kind/);
 expect(() => parseArgs(['--kind', 'openseeface'])).toThrow(/kind/);
 for (const port of ['0', '65536', '1.5', 'x']) expect(() => parseArgs(['--kind', 'vmc', '--port', port])).toThrow(/port/);
 expect(() => parseArgs(['--kind', 'vmc', '--seconds', '-1'])).toThrow(/seconds/);
 expect(() => parseArgs(['--kind', 'vmc', '--neutral-seconds', '-1'])).toThrow(/seconds/);
});
