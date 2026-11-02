import {test} from 'node:test';
import assert from 'node:assert/strict';
import {calculate} from '../js/engine.js';
import {parseRate} from '../js/parse.js';
import {validateRatesFile,diffRates} from '../js/rates.js';
import {snapshotHash,verifySnapshot} from '../js/audit.js';
import {validateBackup} from '../js/imports.js';
import {getDownloadStats} from '../js/stats.js';
import {parsePrincipalLines} from '../js/bulk.js';
const base={calcDate:'2010-01-02',principals:[{id:'a',amount:'1000',start:'2009-12-30'}],officialRates:[{датум_од:'2010-01-01',датум_до:'2010-12-31',стопа:'8',статус:'потврђено',основ:'тест'}]};
test('Combined manual 6% to 2009, official 8% after',()=>{
 const r=calculate({...base,settings:{rateMode:'combined',customRates:[{датум_од:'2009-01-01',датум_до:'2009-12-31',стопа:'6',основ:'тест'}]}});
 assert.ok(r.ok);assert.equal(r.rows.length,2);assert.equal(r.rows[0].rateKind,'manual');assert.equal(r.rows[1].rateKind,'official');assert.equal(r.rows[0].days,1);assert.equal(r.rows[1].days,2);assert.equal(r.working,true);assert.equal(r.totals.interestAccrued.toRatString(),'44/73');
});
test('Manual override trims both sides of official segment',()=>{
 const r=calculate({...base,calcDate:'2010-01-05',principals:[{id:'a',amount:'100',start:'2010-01-01'}],settings:{rateMode:'combined',customRates:[{датум_од:'2010-01-03',датум_до:'2010-01-04',стопа:'0',основ:'тест'}]}});
 assert.ok(r.ok);assert.deepEqual(r.rows.map(x=>[x.days,x.rateStr]),[[1,'8'],[2,'0'],[1,'8']]);
});
test('Overlapping manual overrides blocked',()=>{
 const m={датум_од:'2009-01-01',датум_до:'2009-12-31',стопа:'6',основ:'тест'};
 assert.equal(calculate({...base,settings:{rateMode:'combined',customRates:[m,m]}}).ok,false);
});
test('Principal only does not pay common costs',()=>{
 const r=calculate({...base,principals:[{id:'a',amount:'100',start:'2010-01-01'}],costs:[{date:'2010-01-01',amount:'20'}],payments:[{date:'2010-01-02',amount:'30'}],settings:{allocation:'principalOnly',allocationBasis:'тест',unassignedRule:'oldestFirst'}});
 assert.ok(r.ok);assert.equal(r.totals.remainingCosts.toFixed(2),'20.00');assert.equal(r.totals.paidPrincipal.toFixed(2),'30.00');
});
test('Future payments blocked, not silently ignored',()=>assert.equal(calculate({...base,payments:[{date:'2010-02-01',amount:'20'}]}).ok,false));
test('Oldest due date takes precedence over start date',()=>{
 const r=calculate({...base,calcDate:'2010-02-01',principals:[{id:'a',amount:'100',start:'2010-01-01',due:'2010-01-01'},{id:'b',amount:'100',start:'2010-01-02',due:'2009-12-31'}],payments:[{date:'2010-02-01',amount:'50'}],settings:{unassignedRule:'oldestFirst'}});
 assert.ok(r.ok);assert.equal(r.rows.find(x=>x.type==='payment').oid,'b');
});
test('Rate parser allows three decimals but not thousands separators',()=>{assert.equal(parseRate('1.234').value,'1.234');assert.equal(parseRate('1,234').value,'1.234');assert.equal(parseRate('1.234,56').ok,false);assert.equal(parseRate('1.234.567').ok,false);});
test('Malformed rates do not crash; malicious links blocked',()=>{assert.equal(validateRatesFile({schema_version:1,version:'x',rates:{}}).ok,false);assert.equal(validateRatesFile({schema_version:1,version:'x',rates:[null]}).ok,false);assert.equal(validateRatesFile({schema_version:1,version:'x',rates:[{датум_од:'2024-01-01',датум_до:'2024-12-31',стопа:'8',статус:'непотврђено',основ:'test',извор_одлуке:'javascript:alert(1)'}]}).ok,false);});
test('Changing legal basis and source hash is visible in rate diff',()=>{const a={rates:[{датум_од:'2010-01-01',основ:'a',sha256_извора:'a'}]},b={rates:[{датум_од:'2010-01-01',основ:'b',sha256_извора:'b'}]};assert.deepEqual(diffRates(a,b).changed[0].fields,['основ','sha256_извора']);});
test('Snapshot checksum is order-independent and detects edits',async()=>{const s={b:2,a:1};s.checksum=await snapshotHash(s);assert.equal(await verifySnapshot(s),'valid');assert.equal(await snapshotHash({a:1,b:2}),s.checksum);s.a=2;assert.equal(await verifySnapshot(s),'invalid');});
test('Invalid backup rejected before storage operations',async()=>assert.ok((await validateBackup({format:'zatezna-kamata-cg',schema_version:1,cases:[{id:'<script>'}]})).length));
test('Bulk import accepts decimal styles, rejects ambiguous or invalid dates',()=>{assert.equal(parsePrincipalLines('1.234,56\t29.02.2024\tA\n1,234.56\t01.03.2024\tB').rows.length,2);assert.ok(parsePrincipalLines('1.234\t29.02.2023').errors.length);});
test('Downloads include only Studio APK assets, repeated downloads counted',async()=>{
 const f=async u=>({ok:true,json:async()=>u.includes('/assets?')?[{id:2,name:'kamata-studio-v2.apk',download_count:8},{id:3,name:'other.apk',download_count:12},{id:4,name:'kamata-studio-source.zip',download_count:15}]:[{id:1,tag_name:'v2'}]});
 const s=await getDownloadStats({owner:'dbubanja',repository:'dbubanja.github.io',assetPrefix:'kamata-studio-'},f);assert.equal(s.total,8);assert.equal(s.assets.length,1);
});
test('Counter network error is not displayed as zero',async()=>assert.rejects(()=>getDownloadStats({owner:'dbubanja',repository:'dbubanja.github.io',assetPrefix:'kamata-studio-'},async()=>({ok:false,status:403})),/ограничио/));
import {installEventURL, getReportedInstallations} from '../js/install-counter.js';
test('Install event sends only fixed allowed fields, never case or device data',()=>{const u=new URL(installEventURL());assert.equal(u.origin,'https://zateznakamata.goatcounter.com');assert.deepEqual([...u.searchParams.keys()].sort(),['e','p','r','rnd','t']);assert.equal(u.searchParams.get('p'),'studio-pwa-installed');assert.equal(u.searchParams.get('r'),'');});
test('Unavailable installation count is not zero',async()=>assert.rejects(()=>getReportedInstallations(async()=>({ok:false})),/није доступан/));
