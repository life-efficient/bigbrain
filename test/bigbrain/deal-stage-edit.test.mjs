import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { initializeBrainHome, loadConfig } from '../../src/bigbrain/config.js';
import { startDashboard } from '../../src/bigbrain/dashboard.js';
import { updateDealStage } from '../../src/bigbrain/overlays/deals.js';
import { readBrainPage } from '../../src/bigbrain/page-ops.js';
import { openDatabase, replacePageIndex } from '../../src/bigbrain/db.js';

async function fixture(run) {
 const root=await fs.mkdtemp(path.join(os.tmpdir(),'deal-stage-'));
 let server,db;
 try {
  const init=await initializeBrainHome(path.join(root,'brain'),{env:{...process.env,BIGBRAIN_POINTER_PATH:path.join(root,'pointer'),BIGBRAIN_STATE_ROOT:path.join(root,'state')}});
  const config=await loadConfig({configPath:init.configPath});
  await fs.mkdir(path.join(config.brainDir,'deals'),{recursive:true});
  for(const [slug,involvement,stage] of [['sample','active','qualifying'],['public','public_unrelated','qualifying'],['unknown','active',null]]) {
   await fs.writeFile(path.join(config.brainDir,'deals',slug+'.md'),`---\ntitle: Sample\nsummary: Internal summary\ndeal_involvement: ${involvement}\n${stage?'deal_stage: '+stage+'\nstage_as_of: 2026-10-20\n':''}anonymised_title: Shareable title\nanonymised_description: Shareable description\nanonymised_asks: []\ncustom_field: Preserve me\n---\n# Sample\n\nSubstantive body with [party](../organizations/party.md).\n\n---\n\n## Timeline\n\n`);
  }
  server=await startDashboard(config,{host:'127.0.0.1',port:0});db=await openDatabase(config);
  const base=`http://127.0.0.1:${server.address().port}`;
  const post=data=>fetch(base+'/api/overlays/deals/stage',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(data)});
  await run({config,db,base,post});
 } finally {await server?.close();db?.raw?.close();await db?.close?.();await fs.rm(root,{recursive:true,force:true});}
}
const baseline={page_slug:'deals/sample',deal_stage:'negotiating',expected_deal_stage:'qualifying',expected_stage_as_of:'2026-10-20'};

test('stage changes persist, index, preserve content, and reject competing stale moves',async()=>fixture(async({config,base,post})=>{
 const before=await readBrainPage({config,pagePath:'deals/sample'});
 const responses=await Promise.all([post(baseline),post({...baseline,deal_stage:'preparing'})]);
 assert.deepEqual(responses.map(r=>r.status).sort(),[200,409]);
 const {record}=await responses.find(r=>r.status===200).json();
 const after=await readBrainPage({config,pagePath:'deals/sample'});
 assert.equal(after.body,before.body);assert.equal(after.summary,before.summary);
 assert.equal(after.frontmatter.custom_field,'Preserve me');assert.deepEqual(after.frontmatter.anonymised_asks,[]);
 assert.equal(after.frontmatter.deal_stage,record.deal_stage);assert.equal(after.frontmatter.stage_as_of,record.stage_as_of);
 assert.match(record.stage_as_of,/^\d{4}-\d{2}-\d{2}T/);assert.match(after.timeline,/Manually changed deal stage from qualifying/);assert.match(after.timeline,/direct_edit/);
 const index=await fetch(base+'/api/overlays/deals').then(r=>r.json());
 assert.deepEqual(index.records.find(r=>r.page_slug===record.page_slug),record);
 const next={...baseline,deal_stage:'closing',expected_deal_stage:record.deal_stage,expected_stage_as_of:record.stage_as_of};
 assert.equal((await post({...next,expected_stage_as_of:'2026-10-01'})).status,409);
 const same=await post({...next,deal_stage:record.deal_stage});assert.equal(same.status,200);
 assert.equal((await readBrainPage({config,pagePath:'deals/sample'})).markdown,after.markdown);
 assert.equal((await post(next)).status,200);
}));

test('stage route validates destinations, identity, dates, methods and unknown baseline',async()=>fixture(async({config,base,post})=>{
 for(const patch of [{deal_stage:'invalid'},{page_slug:'deals/../sample'},{page_slug:'people/sample'},{page_slug:'deals/.raw/sample'},{page_slug:'deals/sample.md'},{expected_deal_stage:null},{expected_stage_as_of:undefined},{expected_stage_as_of:'2026-02-30'}])assert.equal((await post({...baseline,...patch})).status,400);
 for(const slug of ['deals/public','deals/missing'])assert.equal((await post({...baseline,page_slug:slug})).status,404);
 assert.equal((await fetch(base+'/api/overlays/deals/stage')).status,405);
 assert.equal((await fetch(base+'/api/overlays/deals/stage',{method:'POST',body:'{bad'})).status,400);
 const before=await readBrainPage({config,pagePath:'deals/unknown'});
 assert.equal((await post({...baseline,page_slug:'deals/unknown',deal_stage:'unknown',expected_deal_stage:'unknown',expected_stage_as_of:null})).status,200);
 assert.equal((await readBrainPage({config,pagePath:'deals/unknown'})).markdown,before.markdown);
 assert.equal((await post({...baseline,page_slug:'deals/unknown',expected_deal_stage:'unknown',expected_stage_as_of:null})).status,200);
}));

test('read-only actors cannot change deal stages',async()=>{
 for(const scopes of [['brain:read'],['brain:create'],[]])await assert.rejects(updateDealStage({},null,baseline,{actor:{scopes}}),{statusCode:403});
});

test('saved stage remains authoritative when index maintenance fails',async()=>fixture(async({config,db})=>{
 const result=await updateDealStage(config,db,baseline,{indexPage:async()=>{throw new Error('index unavailable');}});
 assert.equal(result.record.deal_stage,'negotiating');assert.ok(result.maintenance_warning);
 assert.equal(result.record.stage_as_of,(await readBrainPage({config,pagePath:'deals/sample'})).frontmatter.stage_as_of);
 assert.equal(result.record.summary,'Internal summary');
}));


test('page lock orders saved stages and delayed index updates together',async()=>fixture(async({config,db})=>{
 let savedFirst;
 let unblock;
 let started;
 const ready=new Promise(resolve=>{started=resolve;});
 const gate=new Promise(resolve=>{unblock=resolve;});
 const first=updateDealStage(config,db,baseline,{indexPage:async(database,page)=>{
  savedFirst=page;started();await gate;await replacePageIndex(database,page);
 }});
 await ready;
 let secondFinished=false;
 const second=updateDealStage(config,db,{...baseline,deal_stage:'closing',expected_deal_stage:'negotiating',expected_stage_as_of:savedFirst.frontmatter.stage_as_of}).then(result=>{secondFinished=true;return result;});
 await new Promise(resolve=>setTimeout(resolve,25));
 assert.equal(secondFinished,false);
 unblock();await first;await second;
 const row=db.raw.prepare('SELECT frontmatter_json FROM pages WHERE slug = ?').get('deals/sample');
 assert.equal(JSON.parse(row.frontmatter_json).deal_stage,'closing');
 assert.equal((await readBrainPage({config,pagePath:'deals/sample'})).frontmatter.deal_stage,'closing');
}));
