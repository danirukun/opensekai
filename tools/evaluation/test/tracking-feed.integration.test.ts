// Process and UDP boundary: the CLI sends real datagrams on loopback, and a socket in the test receives them.
import { it, expect } from 'vitest';
import { spawn } from 'node:child_process';
import dgram from 'node:dgram';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { decodePacket } from '../src/vmc-feed';

const CLI = fileURLToPath(new URL('../src/tracking-feed.ts', import.meta.url));

async function capture(args: string[]): Promise<{ code: number; packets: Buffer[] }> {
 const socket = dgram.createSocket('udp4');
 const packets: Buffer[] = [];
 socket.on('message', buf => packets.push(buf));
 socket.bind(0, '127.0.0.1');
 await once(socket, 'listening');
 const child = spawn(process.execPath, ['--import', 'tsx', CLI, ...args, '--port', String(socket.address().port), '--seconds', '1'], { stdio: 'ignore' });
 const [code] = await once(child, 'exit');
 socket.close();
 return { code: code as number, packets };
}

it('feeds VMC bundles with the face and the head to a UDP port and stops after --seconds', async () => {
 const { code, packets } = await capture(['--kind', 'vmc', '--neutral-seconds', '0']);
 expect(code).toBe(0);
 expect(packets.length).toBeGreaterThan(20);
 const messages = decodePacket(packets.at(-1)!);
 expect(messages.find(m => m.address === '/VMC/Ext/Bone/Pos')?.args[0]).toBe('Head');
 expect(messages.find(m => m.address === '/VMC/Ext/Blend/Val' && m.args[0] === 'eyeBlinkLeft')?.args[1]).toBe(1);
 expect(messages.at(-1)?.address).toBe('/VMC/Ext/Blend/Apply');
}, 20_000);

it('feeds iFacialMocap text in the neutral phase', async () => {
 const { code, packets } = await capture(['--kind', 'ifacialmocap']);
 expect(code).toBe(0);
 expect(packets.length).toBeGreaterThan(20);
 const parts = packets[0]!.toString('utf8').split('|');
 expect(parts).toContain('eyeBlink_L-0');
 expect(parts.some(p => p.startsWith('head#'))).toBe(true);
}, 20_000);

it('exits with an error for a bad kind', async () => {
 const child = spawn(process.execPath, ['--import', 'tsx', CLI, '--kind', 'openseeface'], { stdio: 'ignore' });
 const [code] = await once(child, 'exit');
 expect(code).toBe(2);
}, 20_000);
