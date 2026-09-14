import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { openSubstackLedger, runSubstackLedgerCommand } from '../../src/bigbrain/substack-ledger.js';

const publicationUrl='https://example.substack.com/';
const postUrl='https://example.substack.com/p/post';
const publishedAt='2026-09-01T00:00:00Z';
function fixture(t) {
  const dir=mkdtempSync(path.join(tmpdir(),'substack-ledger-'));
  const ledgerPath=path.join(dir,'ledger.sqlite');
  let clock=new Date('2026-09-14T12:00:00Z');
  const ledger=openSubstackLedger({ledgerPath,now:()=>clock});
  t.after(()=>{ledger.close();rmSync(dir,{recursive:true,force:true});});
  ledger.publicationUpsert({publicationUrl,feedUrl:publicationUrl+'feed',title:'Example',aliases:['https://custom.example/']});
  return {ledger,ledgerPath,dir,advance:(ms)=>clock=new Date(clock.getTime()+ms)};
}
function discover(ledger,url=postUrl,date=publishedAt,channel='rss') {return ledger.discover({publicationUrl,url,publishedAt:date,title:'Post',channel});}
function evidence(paths=['sources/articles/example']) {return {readBack:true,verifiedAt:'2026-09-14T12:00:00Z',brainId:'personal',paths,evidence:'Direct Brain read-back matched canonical article URL and content.'};}

test('read-only status on absent ledger creates no filesystem state',async(t)=>{
  const dir=mkdtempSync(path.join(tmpdir(),'substack-read-'));
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const ledgerPath=path.join(dir,'absent','ledger.sqlite');
  const result=await runSubstackLedgerCommand(['status','--db',ledgerPath]);
  assert.equal(result.exists,false);assert.equal(existsSync(path.dirname(ledgerPath)),false);
});

test('cross-channel canonical aliases deduplicate without resetting terminal outcomes',t=>{
  const {ledger}=fixture(t);
  discover(ledger);
  const {leaseToken}=ledger.claim({url:postUrl,owner:'rss'});
  ledger.complete({url:postUrl,leaseToken,outcome:'source_only',verification:evidence()});
  const duplicate=discover(ledger,'http://www.custom.example/p/post/?utm_source=email#section',publishedAt,'email');
  assert.equal(duplicate.alreadyExists,true);assert.equal(duplicate.post.outcome,'source_only');
  assert.equal(ledger.status().total,1);
  assert.equal(ledger.claim({url:postUrl,owner:'email'}).claimed,false);
  assert.equal(ledger.status().aliases.length,2);
  assert.throws(()=>ledger.publicationUpsert({publicationUrl:'https://another.example/',feedUrl:'https://another.example/feed',title:'Other',aliases:[publicationUrl]}),/already belongs/);
  assert.equal(ledger.status().publications.length,1);
});

test('filed extrema stay independent of scan progress, ignored posts, and unresolved holes',t=>{
  const {ledger}=fixture(t);
  for (const [slug,date,outcome] of [['old','2026-08-01','source_only'],['hole','2026-09-02','needs_review'],['new','2026-09-03','source_and_update'],['ignored','2026-09-10','ignored']]) {
    const url=publicationUrl+'p/'+slug;discover(ledger,url,date+'T00:00:00Z');
    const {leaseToken}=ledger.claim({url,owner:'test'});
    ledger.complete({url,leaseToken,outcome,reason:'Reviewed source',verification:evidence(outcome==='ignored'?[]:undefined)});
  }
  ledger.scanCheckpoint({publicationUrl,channel:'browser',through:'2026-09-14T00:00:00Z'});
  const state=ledger.status();
  assert.equal(state.publications[0].filed_low_watermark,'2026-08-01T00:00:00.000Z');
  assert.equal(state.publications[0].filed_high_watermark,'2026-09-03T00:00:00.000Z');
  assert.equal(state.publications[0].outstanding_count,1);
  assert.equal(ledger.status({outstandingOnly:true}).posts[0].outcome,'needs_review');
  assert.equal(ledger.scanCheckpoint({publicationUrl,channel:'browser',through:'2026-09-01T00:00:00Z'}).advanced,false);
  assert.equal(ledger.status().scans[0].through_at,'2026-09-14T00:00:00.000Z');
});

test('terminal completions reject failed, absent, future, and unscoped read-back evidence',t=>{
  const {ledger}=fixture(t);discover(ledger);
  const {leaseToken}=ledger.claim({url:postUrl,owner:'test'});
  for (const verification of [null,{...evidence(),readBack:false},{...evidence(),paths:[]},{...evidence(),brainId:''},{...evidence(),verifiedAt:'2026-09-15T00:00:00Z'}]) {
    assert.throws(()=>ledger.complete({url:postUrl,leaseToken,outcome:'source_only',verification}));
  }
  assert.throws(()=>ledger.complete({url:postUrl,leaseToken,outcome:'ignored',reason:'No relevant content'}),/evidence/);
  assert.equal(ledger.status().publications[0].filed_high_watermark,null);
  assert.equal(ledger.post(postUrl).outcome,'processing');
  ledger.complete({url:postUrl,leaseToken,outcome:'source_only',verification:evidence()});
  assert.equal(ledger.complete({url:postUrl,leaseToken,outcome:'source_only',verification:evidence()}).alreadyCompleted,true);
  assert.throws(()=>ledger.complete({url:postUrl,leaseToken,outcome:'ignored',reason:'different',verification:evidence([])}),/lease/);
});

test('expired leases cannot complete; renewal, reclaim, release and explicit retry are guarded',t=>{
  const {ledger,advance}=fixture(t);discover(ledger);
  const first=ledger.claim({url:postUrl,owner:'rss',leaseSeconds:2});
  advance(1000);ledger.renew({url:postUrl,leaseToken:first.leaseToken,leaseSeconds:3});
  advance(2000);assert.equal(ledger.claim({url:postUrl,owner:'email'}).claimed,false);
  advance(2000);
  assert.throws(()=>ledger.complete({url:postUrl,leaseToken:first.leaseToken,outcome:'source_only',verification:evidence()}),/lease/);
  const second=ledger.claim({url:postUrl,owner:'browser'});assert.equal(second.claimed,true);
  assert.notEqual(first.leaseToken,second.leaseToken);
  assert.throws(()=>ledger.release({url:postUrl,leaseToken:first.leaseToken,reason:'bad'}),/lease/);
  ledger.release({url:postUrl,leaseToken:second.leaseToken,reason:'Content incomplete'});
  assert.equal(ledger.claim({url:postUrl,owner:'rss'}).claimed,false);
  ledger.retry({url:postUrl,reason:'Full content now available'});
  assert.equal(ledger.claim({url:postUrl,owner:'browser'}).claimed,true);
});

test('duplicate discovery cannot move publication timestamp or regress update time',t=>{
  const {ledger,advance}=fixture(t);discover(ledger);
  assert.throws(()=>discover(ledger,postUrl,'2026-09-10T00:00:00Z'),/Conflicting/);
  const {leaseToken}=ledger.claim({url:postUrl,owner:'rss'});
  advance(-1000);
  ledger.complete({url:postUrl,leaseToken,outcome:'needs_review',reason:'Needs complete text'});
  assert.equal(ledger.post(postUrl).updated_at,'2026-09-14T12:00:00.000Z');
  assert.equal(ledger.post(postUrl).published_at,'2026-09-01T00:00:00.000Z');
});

test('status paginates outstanding work without dropping older holes',t=>{
  const {ledger}=fixture(t);
  for(let i=0;i<3;i++)discover(ledger,publicationUrl+'p/'+i,`2026-09-0${i+1}T00:00:00Z`);
  const first=ledger.status({outstandingOnly:true,limit:2});
  assert.equal(first.nextOffset,2);assert.equal(first.total,3);
  const second=ledger.status({outstandingOnly:true,limit:2,offset:first.nextOffset});
  assert.equal(second.posts.length,1);assert.equal(second.nextOffset,null);
});

test('independent CLI processes race for a single atomic claim',async(t)=>{
  const {ledger,ledgerPath,dir}=fixture(t);discover(ledger);
  const cli=new URL('../../bin/bigbrain-substack-ledger.js',import.meta.url).pathname;
  const run=(owner)=>new Promise((resolve,reject)=>{
    const input=path.join(dir,owner+'.json');writeFileSync(input,JSON.stringify({url:postUrl,owner}));
    const child=spawn(process.execPath,[cli,'claim','--db',ledgerPath,'--input-file',input]);
    let output='',error='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>error+=c);
    child.on('error',reject);child.on('close',code=>code===0?resolve(JSON.parse(output)):reject(new Error(error)));
  });
  const results=await Promise.all([run('rss'),run('email'),run('browser')]);
  assert.equal(results.filter(r=>r.claimed).length,1);
  assert.equal(statSync(ledgerPath).mode&0o777,0o600);
});
