import { expect, it } from 'vitest';
import { Client } from '@modelcontextprotocol/client';
import { StdioClientTransport } from '@modelcontextprotocol/client/stdio';
it('initializes and calls a real stdio process, then closes it',async()=>{
 const transport=new StdioClientTransport({command:process.execPath,args:['--import','tsx','apps/mcp/test/stdio-fixture.ts'],stderr:'pipe'});
 let stderr=''; transport.stderr?.on('data',chunk=>{stderr+=String(chunk);});
 const client=new Client({name:'opensekai-test',version:'0.1.0'});
 try {
  await client.connect(transport);
  expect((await client.listTools()).tools.map(t=>t.name)).toEqual(['app_status','scene_inspect','scene_patch','camera_select','blueprint_run','capture_frame','benchmark_start','benchmark_status','benchmark_cancel','evidence_read']);
  expect((await client.callTool({name:'blueprint_run',arguments:{graph:{schemaVersion:1,id:'draft',name:'Draft',nodes:[{id:'start',version:1,type:'event.manual',settings:{},position:{x:0,y:0}}],connections:[]},triggerNodeId:'start'}})).isError).toBe(true);
  expect((await client.callTool({name:'app_status',arguments:{}})).isError).toBe(false);
  expect((await client.callTool({name:'scene_inspect',arguments:{sceneId:'scene_smoke'}})).isError).toBe(false);
  expect((await client.callTool({name:'scene_patch',arguments:{sceneId:'scene_smoke',expectedRevision:0,operations:[{kind:'setVisibility',entityId:'marker',visible:false}]}})).isError).toBe(false);
  expect((await client.callTool({name:'scene_patch',arguments:{sceneId:'scene_smoke',expectedRevision:0,operations:[{kind:'setVisibility',entityId:'marker',visible:false}]}})).isError).toBe(true);
  const bad=await client.callTool({name:'app_status',arguments:{extra:true}}); expect(bad.isError).toBe(true);
  expect((await client.listResources()).resources.map(r=>r.uri)).toContain('opensekai://scene/scene_smoke');
  expect((await client.readResource({uri:'opensekai://status'})).contents).toHaveLength(1);
  expect((await client.callTool({name:'evidence_read',arguments:{evidenceId:'opaque'}})).isError).toBe(false);
  expect((await client.readResource({uri:'opensekai://evidence/opaque/capture.png'})).contents[0]).toMatchObject({blob:'AQID',mimeType:'image/png'});
  await expect(client.readResource({uri:'opensekai://evidence/opaque/capture.png'})).rejects.toThrow();
  expect((await client.listResources()).resources.map(r=>r.uri)).not.toContain('opensekai://evidence/opaque/capture.png');
  await expect(client.readResource({uri:'file:///tmp/arbitrary'})).rejects.toThrow();
 } finally {await client.close();}
 expect(stderr).toBe('fixture ready\n');
 expect(transport.pid).toBeNull();
},10000);
it('times out unauthenticated app startup without protocol stdout or credentials',async()=>{
 const {WebSocketServer}=await import('ws');
 const {mkdtemp,writeFile,rm}=await import('node:fs/promises');
 const {tmpdir}=await import('node:os');
 const {join}=await import('node:path');
 const {spawn}=await import('node:child_process');
 const ws=new WebSocketServer({host:'127.0.0.1',port:0});
 await new Promise<void>(resolve=>ws.once('listening',resolve));
 const address=ws.address(); if(typeof address==='string'||!address) throw new Error('Missing port');
 const dir=await mkdtemp(join(tmpdir(),'opensekai-mcp-'));
 const file=join(dir,'connection.json');
 await writeFile(file,JSON.stringify({schemaVersion:1,sessionId:'fixture',httpOrigin:`http://127.0.0.1:${address.port}`,wsUrl:`ws://127.0.0.1:${address.port}/ws`,role:'operator',token:'private-fixture-token',capabilities:['read'],outputId:null}),{mode:0o600});
 const child=spawn(process.execPath,['--import','tsx','apps/mcp/src/cli.ts'],{env:{...process.env,OPENSEKAI_CONNECTION_FILE:file},stdio:['pipe','pipe','pipe']});
 let stdout='',stderr=''; child.stdout.on('data',x=>{stdout+=x;});child.stderr.on('data',x=>{stderr+=x;});
 try {
  const code=await new Promise<number|null>(resolve=>child.once('exit',resolve));
  expect(code).toBe(1);expect(stdout).toBe('');expect(stderr).toBe('OpenSekai MCP startup failed\n');
 }finally{
  child.kill();for(const socket of ws.clients)socket.terminate();await new Promise<void>(resolve=>ws.close(()=>resolve()));await rm(dir,{recursive:true});
 }
},10000);
