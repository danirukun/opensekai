import {createSocket} from 'node:dgram';
import {writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
// Hand-built OpenSeeFace face records (B20). No camera data.
// Usage: tsx scripts/openseeface-packet.ts write        rewrites fixtures/protocol/openseeface-one-face.bin
//        tsx scripts/openseeface-packet.ts send [host] [port] [seconds]   sends the fixture at 30 Hz
// The layout is in spdd/analysis/2026-10-21-openseeface-receive.md.
export const RECORD_BYTES=1785;
// The tracker quaternion of a face that looks straight at the camera (identity in the normalized head frame).
export const NEUTRAL:[number,number,number,number]=[-Math.SQRT1_2,Math.SQRT1_2,0,0];
export interface FaceRecord {id:number;success:boolean;eyeOpen:[number,number];quaternion:[number,number,number,number];features:number[]}
export function faceRecord(face:FaceRecord):Buffer {
 const b=Buffer.alloc(RECORD_BYTES);
 b.writeInt32LE(face.id,8);b.writeFloatLE(640,12);b.writeFloatLE(480,16);
 b.writeFloatLE(face.eyeOpen[0],20);b.writeFloatLE(face.eyeOpen[1],24);b.writeUInt8(face.success?1:0,28);
 face.quaternion.forEach((v,i)=>b.writeFloatLE(v,33+i*4));
 face.features.slice(0,14).forEach((v,i)=>b.writeFloatLE(v,1729+i*4));
 return b;
}
// One face, looking straight ahead, eyes open, MouthOpen 0.5.
export const oneFace=()=>faceRecord({id:0,success:true,eyeOpen:[1,1],quaternion:NEUTRAL,features:Array.from({length:14},(_,i)=>i===12?.5:0)});
const fixture=fileURLToPath(new URL('../fixtures/protocol/openseeface-one-face.bin',import.meta.url));
async function main([command,host='127.0.0.1',port='11573',seconds='10']:string[]) {
 if(command==='write'){await writeFile(fixture,oneFace());return;}
 if(command!=='send')throw new Error('Usage: openseeface-packet.ts write|send [host] [port] [seconds]');
 const socket=createSocket(host.includes(':')?'udp6':'udp4'),packet=oneFace(),end=Date.now()+Number(seconds)*1000;
 while(Date.now()<end){await new Promise<void>((resolve,reject)=>socket.send(packet,Number(port),host,error=>error?reject(error):resolve()));await new Promise(resolve=>setTimeout(resolve,33));}
 socket.close();
}
if(process.argv[1]===fileURLToPath(import.meta.url))await main(process.argv.slice(2));
