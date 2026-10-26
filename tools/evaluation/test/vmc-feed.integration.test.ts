// Process and UDP boundary: the CLI sends real datagrams on loopback, and a socket in the test receives them.
import { it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { decodePacket, type OscMessage } from '../src/vmc-feed';

const CLI = fileURLToPath(new URL('../src/vmc-feed.ts', import.meta.url));

it('feeds VMC face bundles to a UDP port and stops after --seconds', async () => {
  const socket = dgram.createSocket('udp4');
  const packets: OscMessage[][] = [];
  socket.on('message', buf => packets.push(decodePacket(buf)));
  socket.bind(0, '127.0.0.1');
  await once(socket, 'listening');
  const child = spawn(process.execPath, ['--import', 'tsx', CLI, '--port', String(socket.address().port), '--rate', '30', '--seconds', '1'], { stdio: 'ignore' });
  const [code] = await once(child, 'exit');
  socket.close();
  expect(code).toBe(0);
  expect(packets.length).toBeGreaterThan(10);
  const names = packets[0]!.filter(m => m.address === '/VMC/Ext/Blend/Val').map(m => m.args[0]);
  expect(names).toEqual(['Blink', 'A', 'I', 'U', 'E', 'O']);
  expect(packets.every(p => p.at(-1)?.address === '/VMC/Ext/Blend/Apply')).toBe(true);
}, 20_000);
