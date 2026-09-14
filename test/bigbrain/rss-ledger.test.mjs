import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openSubstackLedger } from '../../src/bigbrain/substack-ledger.js';
import { canonicalRssUrl, openRssLedger } from '../../src/bigbrain/rss-ledger.js';

const date='2026-09-01T00:00:00Z';
const now=()=>new Date('2026-09-14T12:00:00Z');
const evidence={readBack:true,verifiedAt:now().toISOString(),brainId:'personal',paths:['sources/article.md'],evidence:'Direct saved source read-back matched the article.'};
function fixture(t) {
  const dir=mkdtempSync(path.join(tmpdir(),'rss-ledger-'));
  const ledgerPath=path.join(dir,'ledger.sqlite');
  t.after(()=>rmSync(dir,{recursive:true,force:true}));
  return {dir,ledgerPath};
}
const feed=(ledger,id,url='https://publisher.test/feed')=>ledger.feedUpsert({feedId:id,feedUrl:url,title:id});
const discover=(ledger,id,url,publishedAt=date,channel='rss')=>ledger.discover({feedId:id,url,publishedAt,title:'An article',channel});
function complete(ledger,url,outcome='source_only') {
  const {leaseToken}=ledger.claim({url,owner:'rss'});
  return ledger.complete({url,leaseToken,outcome,verification:evidence,reason:'Reviewed source'});
}

test('read-only absent RSS ledger does not create storage; URL identity preserves generic content parameters',t=>{
  const {dir}=fixture(t), ledgerPath=path.join(dir,'missing','ledger.sqlite');
  assert.equal(openRssLedger({ledgerPath,readOnly:true}),null);
  assert.equal(existsSync(path.dirname(ledgerPath)),false);
  assert.equal(canonicalRssUrl('http://www.Example.com/?id=2#body'),'http://www.example.com/?id=2');
  assert.throws(()=>canonicalRssUrl('file:///etc/passwd'));
});

test('generic per-feed bounds distinguish queries and feeds at the same origin, including syndicated hosts',t=>{
  const {ledgerPath}=fixture(t), ledger=openRssLedger({ledgerPath,now});
  t.after(()=>ledger.close());
  feed(ledger,'one','http://syndicator.test/feed'); feed(ledger,'two','http://syndicator.test/other'); feed(ledger,'empty');
  const a='http://www.publisher.test/?id=1', b='http://www.publisher.test/?id=2';
  discover(ledger,'one',a); discover(ledger,'one',b,'2026-09-02T00:00:00Z');
  discover(ledger,'two',a); complete(ledger,a);
  assert.equal(ledger.status({feedId:'one'}).total,2);
  assert.equal(ledger.status({feedId:'one'}).feeds[0].outstanding_count,1);
  assert.equal(ledger.status({feedId:'one'}).feeds[0].filed_high_watermark,'2026-09-01T00:00:00.000Z');
  assert.equal(ledger.status({feedId:'two'}).feeds[0].filed_low_watermark,'2026-09-01T00:00:00.000Z');
  assert.equal(ledger.status({feedId:'empty'}).feeds[0].filed_low_watermark,null);
  assert.equal(ledger.status({feedId:'empty'}).feeds[0].outstanding_count,0);
  assert.equal(discover(ledger,'one',a+'#email',date,'email').post.outcome,'source_only');
  assert.equal(ledger.claim({url:a,owner:'email'}).claimed,false);
  assert.throws(()=>feed(ledger,'one','https://different.test/feed'),/explicit reconciliation/);
  assert.throws(()=>discover(ledger,'one',a,'2026-09-03T00:00:00Z'),/Conflicting/);
  assert.equal(ledger.status({feedId:'one',outstandingOnly:true}).posts[0].url,b);
  const substack=openSubstackLedger({ledgerPath,readOnly:true});
  assert.equal(substack.status().publications.length,0);
  assert.equal(substack.status().posts.length,0);
  substack.close();
});

test('v1 migration preserves Substack history, aliases, completion, scans and active leases',t=>{
  const {ledgerPath}=fixture(t);
  const original=openSubstackLedger({ledgerPath,now});
  const publicationUrl='https://publisher.substack.com/', url=publicationUrl+'p/retained', pending=publicationUrl+'p/leased';
  original.publicationUpsert({publicationUrl,feedUrl:publicationUrl+'feed',title:'Substack',rssRegistrationId:'substack-one',aliases:['https://www.custom.test/']});
  original.discover({publicationUrl,url,publishedAt:date,title:'Retained',channel:'email'});
  complete(original,url);
  original.discover({publicationUrl,url:pending,publishedAt:date,title:'Leased',channel:'email'});
  const active=original.claim({url:pending,owner:'email'});
  original.scanCheckpoint({publicationUrl,channel:'browser',through:date});
  original.close();
  const v1=new DatabaseSync(ledgerPath);
  v1.exec('DROP TABLE rss_feed_posts; DROP TABLE rss_feeds; PRAGMA user_version=1;'); v1.close();
  const readOnly=openRssLedger({ledgerPath,readOnly:true,now});
  assert.equal(readOnly.status({feedId:'substack-one'}).feeds[0].filed_low_watermark,'2026-09-01T00:00:00.000Z');
  assert.equal(readOnly.status({feedId:'absent'}).total,0); readOnly.close();
  const ledger=openRssLedger({ledgerPath,now}); t.after(()=>ledger.close());
  assert.equal(ledger.status().feeds.length,1);
  ledger.feedUpsert({feedId:'substack-one',feedUrl:'https://www.publisher.substack.com/feed',title:'Renamed',provider:'substack'});
  assert.equal(ledger.post('http://www.custom.test/p/retained?utm_source=email').outcome,'source_only');
  assert.equal(ledger.post(pending).lease_token,active.leaseToken);
  ledger.complete({url:pending,leaseToken:active.leaseToken,outcome:'source_and_update',verification:evidence});
  const substack=openSubstackLedger({ledgerPath,now});
  const newUrl=publicationUrl+'p/new';
  substack.discover({publicationUrl,url:newUrl,publishedAt:'2026-09-03T00:00:00Z',title:'New',channel:'email'});
  assert.equal(ledger.status({feedId:'substack-one'}).feeds[0].outstanding_count,1);
  assert.equal(substack.status().scans.length,1); substack.close();
});

test('RSS can register new Substack articles and both APIs share claims and terminal evidence',t=>{
  const {ledgerPath}=fixture(t), ledger=openRssLedger({ledgerPath,now}); t.after(()=>ledger.close());
  ledger.feedUpsert({feedId:'substack-new',feedUrl:'https://www.custom.test/feed',title:'Custom',provider:'substack'});
  discover(ledger,'substack-new','https://www.custom.test/p/new?utm_source=rss');
  const substack=openSubstackLedger({ledgerPath,now});
  const {leaseToken}=ledger.claim({url:'https://custom.test/p/new',owner:'rss'});
  assert.equal(substack.claim({url:'https://custom.test/p/new?utm_source=email',owner:'email'}).claimed,false);
  substack.complete({url:'https://custom.test/p/new',leaseToken,outcome:'verified_noop',verification:evidence});
  assert.equal(ledger.status({feedId:'substack-new'}).feeds[0].filed_high_watermark,'2026-09-01T00:00:00.000Z');
  substack.close();
});

test('pending, ignored and needs-review RSS articles never advance verified bounds',t=>{
  const {ledgerPath}=fixture(t), ledger=openRssLedger({ledgerPath,now});t.after(()=>ledger.close()); feed(ledger,'one');
  for (const [i,outcome] of [[1,'source_only'],[2,'ignored'],[3,'needs_review']]) {
    const url=`https://publisher.test/article?id=${i}`;
    discover(ledger,'one',url,`2026-09-0${i}T00:00:00Z`);complete(ledger,url,outcome);
  }
  const status=ledger.status({feedId:'one'}).feeds[0];
  assert.equal(status.filed_low_watermark,status.filed_high_watermark);
  assert.equal(status.filed_high_watermark,'2026-09-01T00:00:00.000Z');
  assert.equal(status.outstanding_count,1);
});
