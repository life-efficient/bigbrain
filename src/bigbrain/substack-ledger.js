import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, chmodSync, existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

const RETAINED = ['source_only', 'source_and_update', 'verified_noop'];
const OUTCOMES = [...RETAINED, 'ignored', 'needs_review'];
const OPERATIONS = ['status', 'publication-upsert', 'discover', 'claim', 'renew', 'complete', 'release', 'retry', 'scan-checkpoint'];
export const SUBSTACK_LEDGER_SCHEMA_VERSION = 1;
const required = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
};
const timestamp = (value, field) => {
  required(value, field);
  if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error(`${field} must be an ISO timestamp with timezone.`);
  return new Date(value).toISOString();
};

export function canonicalSubstackUrl(value, { publication = false } = {}) {
  const url = new URL(required(value, 'url'));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only HTTP(S) URLs without credentials are supported.');
  url.protocol = 'https:';
  url.hostname = url.hostname.toLowerCase().replace(/^www\./, '');
  url.hash = '';
  // A Substack article identity is its path, independent of delivery tracking.
  url.search = '';
  url.pathname = publication ? '/' : url.pathname.replace(/\/+$/, '') || '/';
  return url.href;
}

export function defaultSubstackLedgerPath(env = process.env) {
  return path.resolve(env.BIGBRAIN_SUBSTACK_LEDGER_PATH || path.join(env.BIGBRAIN_MACHINE_HOME || path.join(env.HOME || homedir(), '.config', 'bigbrain'), 'substack-ledger.sqlite'));
}

export function openSubstackLedger({ ledgerPath = defaultSubstackLedgerPath(), readOnly = false, now = () => new Date() } = {}) {
  ledgerPath = path.resolve(ledgerPath);
  if (readOnly && !existsSync(ledgerPath)) return null;
  if (!readOnly) mkdirSync(path.dirname(ledgerPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(ledgerPath, { readOnly });
  try {
    db.exec('PRAGMA busy_timeout = 10000; PRAGMA foreign_keys = ON;');
    const version = Number(db.prepare('PRAGMA user_version').get().user_version);
    if (version > SUBSTACK_LEDGER_SCHEMA_VERSION || (readOnly && version !== SUBSTACK_LEDGER_SCHEMA_VERSION)) throw new Error(`Unsupported Substack ledger schema version ${version}.`);
    if (!readOnly) {
      db.exec('PRAGMA journal_mode = WAL; BEGIN IMMEDIATE;');
      try {
        db.exec(`
          CREATE TABLE IF NOT EXISTS publications (url TEXT PRIMARY KEY, title TEXT NOT NULL, feed_url TEXT NOT NULL, rss_registration_id TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS aliases (url TEXT PRIMARY KEY, publication_url TEXT NOT NULL REFERENCES publications(url), original_url TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS posts (url TEXT PRIMARY KEY, publication_url TEXT NOT NULL REFERENCES publications(url), published_at TEXT NOT NULL, title TEXT NOT NULL, outcome TEXT NOT NULL DEFAULT 'pending', reason TEXT, verification TEXT, lease_token TEXT, lease_owner TEXT, lease_expires_at TEXT, last_lease_token TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
          CREATE TABLE IF NOT EXISTS sightings (url TEXT NOT NULL REFERENCES posts(url), channel TEXT NOT NULL, original_url TEXT NOT NULL, seen_at TEXT NOT NULL, PRIMARY KEY(url, channel, original_url));
          CREATE TABLE IF NOT EXISTS scans (publication_url TEXT NOT NULL REFERENCES publications(url), channel TEXT NOT NULL, through_at TEXT NOT NULL, oldest_seen_at TEXT, newest_seen_at TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(publication_url, channel));
          CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY, operation TEXT NOT NULL, url TEXT NOT NULL, details TEXT NOT NULL, created_at TEXT NOT NULL);
          CREATE INDEX IF NOT EXISTS posts_publication ON posts(publication_url, published_at);
          PRAGMA user_version = 1;
        `);
        db.exec('COMMIT;');
      } catch (error) { db.exec('ROLLBACK;'); throw error; }
      chmodSync(ledgerPath, 0o600);
    }
    return new SubstackLedger(db, now, readOnly);
  } catch (error) { db.close(); throw error; }
}

class SubstackLedger {
  constructor(db, now, readOnly) { this.db = db; this.now = now; this.readOnly = readOnly; }
  close() { this.db.close(); }
  time() { return this.now().toISOString(); }
  transaction(fn) {
    if (this.readOnly) throw new Error('Ledger opened read-only.');
    this.db.exec('BEGIN IMMEDIATE;');
    try { const result = fn(); this.db.exec('COMMIT;'); return result; }
    catch (error) { this.db.exec('ROLLBACK;'); throw error; }
  }
  event(operation, url, details) {
    this.db.prepare('INSERT INTO events(operation,url,details,created_at) VALUES(?,?,?,?)').run(operation, url, JSON.stringify(details), this.time());
  }
  publicationUrl(value) {
    const normalized = canonicalSubstackUrl(value, { publication: true });
    const alias = this.db.prepare('SELECT publication_url FROM aliases WHERE url=?').get(normalized);
    return alias?.publication_url || normalized;
  }
  postUrl(value) {
    const url = new URL(canonicalSubstackUrl(value));
    const publication = new URL(this.publicationUrl(value));
    url.host = publication.host;
    return url.href;
  }
  post(value) {
    const row = this.db.prepare('SELECT * FROM posts WHERE url=?').get(this.postUrl(value));
    if (!row) throw new Error('Discover the article before operating on it.');
    return { ...row, verification: row.verification ? JSON.parse(row.verification) : null };
  }
  publicationUpsert(input) {
    return this.transaction(() => {
      const url = this.publicationUrl(input.publicationUrl);
      const feed = canonicalSubstackUrl(required(input.feedUrl, 'feedUrl'));
      const title = required(input.title, 'title');
      const aliases = [input.publicationUrl, ...(input.aliases || [])];
      if (!Array.isArray(input.aliases || [])) throw new Error('aliases must be an array.');
      for (const original of aliases) {
        const alias = canonicalSubstackUrl(original, { publication: true });
        const previous = this.db.prepare('SELECT publication_url FROM aliases WHERE url=?').get(alias);
        if (previous && previous.publication_url !== url) throw new Error('Alias already belongs to another publication; explicit data reconciliation is required.');
      }
      this.db.prepare(`INSERT INTO publications VALUES(?,?,?,?,?,?) ON CONFLICT(url) DO UPDATE SET title=excluded.title,feed_url=excluded.feed_url,rss_registration_id=COALESCE(excluded.rss_registration_id,publications.rss_registration_id),updated_at=MAX(publications.updated_at,excluded.updated_at)`).run(url,title,feed,input.rssRegistrationId || null,this.time(),this.time());
      for (const original of aliases) this.db.prepare('INSERT OR IGNORE INTO aliases VALUES(?,?,?)').run(canonicalSubstackUrl(original,{publication:true}),url,original);
      this.event('publication-upsert',url,{ feedUrl:feed,aliases });
      return { publication: this.db.prepare('SELECT * FROM publications WHERE url=?').get(url) };
    });
  }
  discover(input) {
    return this.transaction(() => {
      const publication = this.publicationUrl(input.publicationUrl);
      if (this.publicationUrl(input.url) !== publication) throw new Error('Article host must match the publication or an explicitly registered alias.');
      const url = this.postUrl(input.url);
      if (new URL(url).pathname === '/') throw new Error('Article URL must have a path.');
      const publishedAt = timestamp(input.publishedAt,'publishedAt');
      const existing = this.db.prepare('SELECT * FROM posts WHERE url=?').get(url);
      if (existing && existing.published_at !== publishedAt) throw new Error('Conflicting publication timestamp for existing article; preserve original evidence.');
      this.db.prepare('INSERT OR IGNORE INTO posts(url,publication_url,published_at,title,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(url,publication,publishedAt,required(input.title,'title'),this.time(),this.time());
      this.db.prepare('INSERT INTO sightings VALUES(?,?,?,?) ON CONFLICT(url,channel,original_url) DO UPDATE SET seen_at=MAX(sightings.seen_at,excluded.seen_at)').run(url,required(input.channel,'channel'),input.url,this.time());
      this.event('discover',url,{channel:input.channel,alreadyExists:!!existing});
      return { alreadyExists:!!existing, post:this.post(url) };
    });
  }
  duration(input) {
    const seconds = input.leaseSeconds ?? 1800;
    if (!Number.isInteger(seconds) || seconds < 1 || seconds > 86400) throw new Error('leaseSeconds must be an integer from 1 to 86400.');
    return new Date(this.now().getTime()+seconds*1000).toISOString();
  }
  assertLease(post,input) {
    if (post.outcome !== 'processing' || post.lease_token !== required(input.leaseToken,'leaseToken') || post.lease_expires_at <= this.time()) throw new Error('A matching unexpired processing lease is required.');
  }
  claim(input) {
    return this.transaction(() => {
      const post = this.post(input.url);
      const owner = required(input.owner,'owner');
      if (post.outcome !== 'pending' && !(post.outcome === 'processing' && post.lease_expires_at <= this.time())) return { claimed:false, post };
      const token = randomUUID();
      this.db.prepare("UPDATE posts SET outcome='processing',lease_token=?,lease_owner=?,lease_expires_at=?,updated_at=MAX(updated_at,?) WHERE url=?").run(token,owner,this.duration(input),this.time(),post.url);
      this.event('claim',post.url,{owner,reclaimed:post.outcome==='processing'});
      return { claimed:true, leaseToken:token, post:this.post(post.url) };
    });
  }
  renew(input) {
    return this.transaction(() => {
      const post = this.post(input.url); this.assertLease(post,input);
      this.db.prepare('UPDATE posts SET lease_expires_at=MAX(lease_expires_at,?),updated_at=MAX(updated_at,?) WHERE url=?').run(this.duration(input),this.time(),post.url);
      return { post:this.post(post.url) };
    });
  }
  complete(input) {
    return this.transaction(() => {
      const post = this.post(input.url);
      if (!OUTCOMES.includes(input.outcome)) throw new Error(`outcome must be one of ${OUTCOMES.join(', ')}.`);
      if (post.last_lease_token === input.leaseToken && post.outcome === input.outcome) return { alreadyCompleted:true, post };
      this.assertLease(post,input);
      let verification = null;
      if (RETAINED.includes(input.outcome) || input.outcome === 'ignored') {
        const evidence = input.verification;
        if (!evidence || evidence.readBack !== true || !Array.isArray(evidence.paths) || (RETAINED.includes(input.outcome) && !evidence.paths.length)) throw new Error('Terminal completion requires scoped read-back evidence; retained outcomes require non-empty Brain paths.');
        verification = {readBack:true,verifiedAt:timestamp(evidence.verifiedAt,'verification.verifiedAt'),brainId:required(evidence.brainId,'verification.brainId'),paths:evidence.paths.map(p=>required(p,'verification.paths')),evidence:required(evidence.evidence,'verification.evidence')};
        if (verification.verifiedAt > this.time()) throw new Error('Verification cannot be dated in the future.');
      }
      if (!RETAINED.includes(input.outcome)) required(input.reason,'reason');
      this.db.prepare('UPDATE posts SET outcome=?,reason=?,verification=?,last_lease_token=lease_token,lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=MAX(updated_at,?) WHERE url=?').run(input.outcome,input.reason||null,verification?JSON.stringify(verification):null,this.time(),post.url);
      this.event('complete',post.url,{outcome:input.outcome,reason:input.reason||null,verification});
      return { alreadyCompleted:false,post:this.post(post.url) };
    });
  }
  release(input) {
    return this.transaction(() => {
      const post=this.post(input.url); this.assertLease(post,input);
      required(input.reason,'reason');
      this.db.prepare("UPDATE posts SET outcome='needs_review',reason=?,lease_token=NULL,lease_owner=NULL,lease_expires_at=NULL,updated_at=MAX(updated_at,?) WHERE url=?").run(input.reason,this.time(),post.url);
      this.event('release',post.url,{reason:input.reason});
      return {post:this.post(post.url)};
    });
  }
  retry(input) {
    return this.transaction(() => {
      const post=this.post(input.url); required(input.reason,'reason');
      if (!['needs_review','ignored','pending'].includes(post.outcome)) throw new Error('Retry is allowed only for pending, ignored, or needs_review outcomes.');
      this.db.prepare("UPDATE posts SET outcome='pending',reason=?,last_lease_token=NULL,updated_at=MAX(updated_at,?) WHERE url=?").run(input.reason,this.time(),post.url);
      this.event('retry',post.url,{reason:input.reason});
      return {post:this.post(post.url)};
    });
  }
  scanCheckpoint(input) {
    return this.transaction(() => {
      const publication=this.publicationUrl(input.publicationUrl), channel=required(input.channel,'channel'), through=timestamp(input.through,'through');
      const oldest=input.oldestSeenAt?timestamp(input.oldestSeenAt,'oldestSeenAt'):null, newest=input.newestSeenAt?timestamp(input.newestSeenAt,'newestSeenAt'):null;
      if (oldest && newest && oldest>newest) throw new Error('oldestSeenAt must not be after newestSeenAt.');
      const previous=this.db.prepare('SELECT * FROM scans WHERE publication_url=? AND channel=?').get(publication,channel);
      if (previous && through<previous.through_at) return {advanced:false,scan:previous};
      this.db.prepare('INSERT INTO scans VALUES(?,?,?,?,?,?) ON CONFLICT(publication_url,channel) DO UPDATE SET through_at=excluded.through_at,oldest_seen_at=excluded.oldest_seen_at,newest_seen_at=excluded.newest_seen_at,updated_at=MAX(scans.updated_at,excluded.updated_at)').run(publication,channel,through,oldest,newest,this.time());
      this.event('scan-checkpoint',publication,{channel,through,oldestSeenAt:oldest,newestSeenAt:newest});
      return {advanced:!previous||through>previous.through_at,scan:this.db.prepare('SELECT * FROM scans WHERE publication_url=? AND channel=?').get(publication,channel)};
    });
  }
  status(input={}) {
    const publication=input.publicationUrl?this.publicationUrl(input.publicationUrl):null;
    const limit=input.limit??500,offset=input.offset??0;
    if (!Number.isInteger(limit)||limit<1||limit>5000||!Number.isInteger(offset)||offset<0) throw new Error('limit must be 1..5000 and offset must be nonnegative.');
    const where=[],args=[];
    if (publication) {where.push('publication_url=?');args.push(publication);}
    if (input.url) {where.push('url=?');args.push(this.postUrl(input.url));}
    if (input.outstandingOnly) where.push("outcome IN ('pending','processing','needs_review')");
    const filter=where.length?` WHERE ${where.join(' AND ')}`:'';
    const count=Number(this.db.prepare(`SELECT COUNT(*) AS n FROM posts${filter}`).get(...args).n);
    const posts=this.db.prepare(`SELECT * FROM posts${filter} ORDER BY published_at DESC,url LIMIT ? OFFSET ?`).all(...args,limit,offset).map(p=>({...p,verification:p.verification?JSON.parse(p.verification):null}));
    const publications=this.db.prepare(`SELECT p.*,(SELECT MIN(published_at) FROM posts WHERE publication_url=p.url AND outcome IN ('source_only','source_and_update','verified_noop')) AS filed_low_watermark,(SELECT MAX(published_at) FROM posts WHERE publication_url=p.url AND outcome IN ('source_only','source_and_update','verified_noop')) AS filed_high_watermark,(SELECT COUNT(*) FROM posts WHERE publication_url=p.url AND outcome IN ('pending','processing','needs_review')) AS outstanding_count FROM publications p ${publication?'WHERE p.url=?':''} ORDER BY p.url`).all(...(publication?[publication]:[]));
    return {exists:true,schemaVersion:SUBSTACK_LEDGER_SCHEMA_VERSION,publications,aliases:this.db.prepare(`SELECT * FROM aliases ${publication?'WHERE publication_url=?':''}`).all(...(publication?[publication]:[])),scans:this.db.prepare(`SELECT * FROM scans ${publication?'WHERE publication_url=?':''}`).all(...(publication?[publication]:[])),posts,total:count,nextOffset:offset+posts.length<count?offset+posts.length:null};
  }
}

export async function runSubstackLedgerCommand(args,{env=process.env}={}) {
  const operation=args[0];
  if (!OPERATIONS.includes(operation)) throw new Error(substackLedgerUsage());
  const options={};
  for (let i=1;i<args.length;i+=2) {
    if (!['--input-file','--db'].includes(args[i])||!args[i+1]||args[i+1].startsWith('--')||options[args[i]]) throw new Error('Use unique --input-file FILE and optional --db PATH arguments.');
    options[args[i]]=args[i+1];
  }
  if (operation!=='status'&&!options['--input-file']) throw new Error('--input-file is required for mutations.');
  const input=options['--input-file']?JSON.parse(readFileSync(options['--input-file'],'utf8')):{};
  if (!input||typeof input!=='object'||Array.isArray(input)) throw new Error('Input must be a JSON object.');
  const ledger=openSubstackLedger({ledgerPath:options['--db']||defaultSubstackLedgerPath(env),readOnly:operation==='status'});
  if (!ledger) return {ok:true,operation,exists:false,publications:[],aliases:[],scans:[],posts:[],total:0,nextOffset:null};
  try {
    const method={'publication-upsert':'publicationUpsert','scan-checkpoint':'scanCheckpoint'}[operation]||operation;
    return {ok:true,operation,...ledger[method](input)};
  } finally {ledger.close();}
}

export function substackLedgerUsage() {
  return `Usage: bigbrain-substack-ledger <${OPERATIONS.join('|')}> [--input-file FILE] [--db PATH]\nAll mutations require a JSON input file. status is read-only and accepts optional publicationUrl, url, outstandingOnly, limit (default 500), offset.\npublication-upsert: {publicationUrl,feedUrl,title,aliases?:[],rssRegistrationId?}\ndiscover: {publicationUrl,url,publishedAt,title,channel}\nclaim: {url,owner,leaseSeconds?}; renew: {url,leaseToken,leaseSeconds?}\ncomplete: {url,leaseToken,outcome,reason?,verification?:{readBack:true,verifiedAt,brainId,paths:[],evidence}}\nrelease: {url,leaseToken,reason}; retry: {url,reason}\nscan-checkpoint: {publicationUrl,channel,through,oldestSeenAt?,newestSeenAt?}\nRetained outcomes source_only, source_and_update, verified_noop require direct read-back evidence and non-empty paths. ignored requires scoped canonical/relevance verification (paths may be empty) and reason. needs_review requires reason only. Neither ignored nor needs_review advances filed watermarks. Scan checkpoints are discovery boundaries, not completeness claims. Import old records through discover/claim/complete after live read-back verification; prose history alone is insufficient.`;
}
