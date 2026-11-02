import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
const root=new URL('..',import.meta.url);
function harness(){
 const handlers={},cached=new Map(),deleted=[];let skipped=false,claimed=false;
 const scope='https://example.test/studio/';
 const toURL=x=>new URL(typeof x==='string'?x:x.url,scope).href;
 const cache={addAll:async requests=>{for(const req of requests){const u=new URL(req.url);const name=u.pathname.replace('/studio/','')||'index.html';assert.ok(fs.existsSync(new URL(name,root)),`Missing offline asset ${name}`);cached.set(u.href,{cached:true,url:u.href});}},match:async req=>{const u=new URL(toURL(req));u.search='';return cached.get(u.href);}};
 const context={URL,Request:class{constructor(url){this.url=toURL(url)}},Response:{error:()=>({error:true})},fetch:async()=>{throw new Error('offline')},location:{origin:'https://example.test'},caches:{open:async()=>cache,keys:async()=>['zk-old','kamata-studio-old','kamata-studio-2.0.2'],delete:async key=>{deleted.push(key);}},self:{registration:{scope},clients:{claim:async()=>{claimed=true},matchAll:async()=>[]},skipWaiting:()=>{skipped=true},addEventListener:(type,f)=>handlers[type]=f}};
 vm.runInNewContext(fs.readFileSync(new URL('sw.js',root),'utf8'),context);
 return {handlers,cached,deleted,get skipped(){return skipped},get claimed(){return claimed}};
}
test('All offline assets exist; cached app and Excel load without network',async()=>{
 const h=harness();let p;h.handlers.install({waitUntil:x=>p=x});await p;
 assert.equal(h.skipped,false);
 for(const name of ['index.html','js/engine.js','lib/exceljs.min.js','rates.json','css/studio.css']){
  h.handlers.fetch({request:{method:'GET',url:'https://example.test/studio/'+name},respondWith:x=>p=x});assert.equal((await p).cached,true);
 }
});
test('Service worker does not intercept sibling application or rate checks',()=>{
 const h=harness();for(const url of ['https://example.test/index.html','https://example.test/studio/rates.json?check=1','https://api.github.com/repos/a/b/releases']){
  let called=false;h.handlers.fetch({request:{method:'GET',url},respondWith:()=>called=true});assert.equal(called,false);
 }
});
test('Activation deletes only Studio old caches, update needs explicit message',async()=>{
 const h=harness();let p;h.handlers.activate({waitUntil:x=>p=x});await p;assert.deepEqual(h.deleted,['kamata-studio-old']);assert.equal(h.claimed,true);assert.equal(h.skipped,false);h.handlers.message({data:'skipWaiting'});assert.equal(h.skipped,true);
});
