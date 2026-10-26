import { it, expect } from 'vitest';
import { decodePacket, encodeBundle, encodeMessage, faceBlend, faceFrame, oscString, summarize, VOWELS } from '../src/vmc-feed';

it('pads OSC strings with at least one null to a multiple of 4', () => {
  expect([...oscString('abc')]).toEqual([97, 98, 99, 0]);
  expect([...oscString('abcd')]).toEqual([97, 98, 99, 100, 0, 0, 0, 0]);
  expect(oscString('').length).toBe(4);
});

it('encodes a VMC blend message as big-endian OSC', () => {
  const buf = encodeMessage({ address: '/VMC/Ext/Blend/Val', types: 'sf', args: ['A', 0.5] });
  expect(buf.subarray(0, 20).toString('latin1')).toBe('/VMC/Ext/Blend/Val\0\0');
  expect(buf.subarray(20, 24).toString('latin1')).toBe(',sf\0');
  expect(buf.subarray(24, 28).toString('latin1')).toBe('A\0\0\0');
  expect(buf.readFloatBE(28)).toBe(0.5);
  expect(buf.length).toBe(32);
});

it('rejects a message whose types and args disagree', () => {
  expect(() => encodeMessage({ address: '/x', types: 'f', args: [] })).toThrow(/1 types for 0 args/);
});

it('builds an immediate bundle with length-prefixed elements that decodes back', () => {
  const messages = faceFrame(0.3);
  const buf = encodeBundle(messages);
  expect(buf.subarray(0, 8).toString('latin1')).toBe('#bundle\0');
  expect(buf.readBigUInt64BE(8)).toBe(1n);
  expect(buf.readInt32BE(16)).toBe(encodeMessage(messages[0]!).length);
  const decoded = decodePacket(buf);
  expect(decoded.map(m => m.address)).toEqual(messages.map(m => m.address));
  expect(decoded[0]!.args).toEqual([1]);
  expect(decoded[1]!.args[0]).toBeCloseTo(0.3, 6);
  expect(decoded.at(-1)).toEqual({ address: '/VMC/Ext/Blend/Apply', types: '', args: [] });
});

it('closes the eyes once per 2 s and opens them for the second half', () => {
  expect(faceBlend(0).Blink).toBe(0);
  expect(faceBlend(0.5).Blink).toBeCloseTo(1, 6);
  expect(faceBlend(1.5).Blink).toBe(0);
  expect(faceBlend(2.5).Blink).toBeCloseTo(1, 6);
});

it('opens one vowel at a time in A I U E O order', () => {
  const peaks = [0.4, 1.2, 2.0, 2.8, 3.6, 4.4].map(t => faceBlend(t));
  peaks.forEach((blend, i) => {
    const open = VOWELS.filter(v => blend[v]! > 0);
    expect(open).toEqual([VOWELS[i % VOWELS.length]]);
    expect(blend[open[0]!]).toBeCloseTo(1, 6);
  });
});

it('summarizes received packets by address and last blend value', () => {
  const summary = summarize([faceFrame(0.5), faceFrame(0.5)]);
  expect(summary.packets).toBe(2);
  expect(summary.addresses['/VMC/Ext/Blend/Val']).toBe(12);
  expect(summary.addresses['/VMC/Ext/Blend/Apply']).toBe(2);
  expect(summary.blend.Blink).toBe(1);
});
