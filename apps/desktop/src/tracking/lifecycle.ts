export function createStartGate(){let generation=0;return {begin:()=>++generation,stop:()=>{generation++;},current:(value:number)=>value===generation};}
export function createLatestQueue<T extends {close():void}>(process:(value:T)=>Promise<void>,onError:(error:unknown)=>void=()=>{}){
 type Entry={value:T;closed:boolean};let active:Entry|null=null,pending:Entry|null=null,stopped=false;
 const close=(entry:Entry|null)=>{if(entry&&!entry.closed){entry.closed=true;entry.value.close();}};
 const run=(entry:Entry)=>{active=entry;void process(entry.value).catch(onError).finally(()=>{close(entry);if(active!==entry)return;active=null;if(!stopped&&pending){const next=pending;pending=null;run(next);}});};
 return {push(value:T){const entry={value,closed:false};if(stopped){close(entry);return;}if(active){close(pending);pending=entry;}else run(entry);},dropPending(){close(pending);pending=null;},stop(){stopped=true;close(pending);pending=null;close(active);},size:()=>Number(active!==null)+Number(pending!==null)};
}
