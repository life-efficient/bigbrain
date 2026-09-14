import { openSubstackLedger, SubstackLedger, canonicalSubstackUrl, SUBSTACK_LEDGER_SCHEMA_VERSION } from './substack-ledger.js';

const required = (value, field) => {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} must be a non-empty string.`);
  return value.trim();
};

// Generic article identities can depend on the query, scheme, or www hostname.
// Substack aliases are applied only for explicitly registered Substack publishers.
export function canonicalRssUrl(value) {
  const url = new URL(required(value, 'url'));
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Only HTTP(S) URLs without credentials are supported.');
  url.hash = '';
  return url.href;
}

export function openRssLedger(options = {}) {
  const shared = openSubstackLedger(options);
  return shared ? new RssLedger(shared.db, shared.now, shared.readOnly) : null;
}

class RssLedger extends SubstackLedger {
  postUrl(value) {
    const exact = canonicalRssUrl(value);
    // An already stored generic identity must never be collapsed by a later alias.
    if (this.db.prepare('SELECT 1 FROM posts WHERE url=?').get(exact)) return exact;
    const alias = this.db.prepare('SELECT 1 FROM aliases WHERE url=?').get(canonicalSubstackUrl(value, { publication: true }));
    return alias ? super.postUrl(value) : exact;
  }
  feedUpsert(input) {
    return this.transaction(() => {
      const feedId = required(input.feedId, 'feedId');
      let feedUrl = canonicalRssUrl(input.feedUrl);
      const title = required(input.title, 'title');
      const existing = this.db.prepare('SELECT * FROM rss_feeds WHERE feed_id=?').get(feedId);
      const provider = required(input.provider ?? existing?.provider ?? 'rss', 'provider');
      if (provider === 'substack') feedUrl = canonicalSubstackUrl(feedUrl);
      if (existing && existing.feed_url !== feedUrl) throw new Error('Feed URL changed for an existing feed ID; explicit reconciliation is required.');
      if (existing && existing.provider !== provider) throw new Error('Feed provider changed for an existing feed ID; explicit reconciliation is required.');
      this.db.prepare('INSERT INTO rss_feeds VALUES(?,?,?,?,?,?) ON CONFLICT(feed_id) DO UPDATE SET title=excluded.title,updated_at=MAX(rss_feeds.updated_at,excluded.updated_at)').run(feedId,feedUrl,title,provider,this.time(),this.time());
      if (provider === 'substack') {
        const publications = this.db.prepare('SELECT * FROM publications WHERE rss_registration_id=? OR feed_url=?').all(feedId,canonicalSubstackUrl(feedUrl));
        for (const publication of publications) this.db.prepare('INSERT OR IGNORE INTO rss_feed_posts SELECT ?,url FROM posts WHERE publication_url=?').run(feedId,publication.url);
      }
      this.event('feed-upsert', feedUrl, { feedId, provider });
      return { feed: this.status({ feedId, limit: 1 }).feeds[0] };
    });
  }
  discover(input) {
    return this.transaction(() => {
      const feedId = required(input.feedId, 'feedId');
      const feed = this.db.prepare('SELECT * FROM rss_feeds WHERE feed_id=?').get(feedId);
      if (!feed) throw new Error('Register the feed before discovering its articles.');
      let publication = `urn:bigbrain:rss:${encodeURIComponent(feedId)}`;
      if (feed.provider === 'substack') {
        publication = this.publicationUrl(input.url);
        const existing = this.db.prepare('SELECT * FROM publications WHERE url=?').get(publication);
        if (!existing) {
          this.db.prepare('INSERT INTO publications VALUES(?,?,?,?,?,?)').run(publication,feed.title,canonicalSubstackUrl(feed.feed_url),feedId,this.time(),this.time());
          this.db.prepare('INSERT OR IGNORE INTO aliases VALUES(?,?,?)').run(canonicalSubstackUrl(input.url,{publication:true}),publication,input.url);
        }
      } else {
        this.db.prepare('INSERT OR IGNORE INTO publications VALUES(?,?,?,?,?,?)').run(publication,feed.title,feed.feed_url,null,this.time(),this.time());
      }
      const url = this.postUrl(input.url);
      const value = required(input.publishedAt, 'publishedAt');
      if (!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) || !Number.isFinite(Date.parse(value))) throw new Error('publishedAt must be an ISO timestamp with timezone.');
      const publishedAt = new Date(value).toISOString();
      const title = required(input.title, 'title');
      const channel = required(input.channel, 'channel');
      const existing = this.db.prepare('SELECT * FROM posts WHERE url=?').get(url);
      if (existing && existing.published_at !== publishedAt) throw new Error('Conflicting publication timestamp for existing article; preserve original evidence.');
      this.db.prepare('INSERT OR IGNORE INTO posts(url,publication_url,published_at,title,created_at,updated_at) VALUES(?,?,?,?,?,?)').run(url,publication,publishedAt,title,this.time(),this.time());
      this.db.prepare('INSERT OR IGNORE INTO rss_feed_posts VALUES(?,?)').run(feedId,url);
      this.db.prepare('INSERT INTO sightings VALUES(?,?,?,?) ON CONFLICT(url,channel,original_url) DO UPDATE SET seen_at=MAX(sightings.seen_at,excluded.seen_at)').run(url,channel,input.url,this.time());
      this.event('discover',url,{ feedId,channel,alreadyExists:!!existing });
      return { alreadyExists:!!existing, post:this.post(url) };
    });
  }
  status(input = {}) {
    // Older stores remain inspectable without upgrading them during a read.
    if (Number(this.db.prepare('PRAGMA user_version').get().user_version) < 2) {
      const publication = input.feedId ? this.db.prepare('SELECT url FROM publications WHERE rss_registration_id=?').get(input.feedId)?.url : null;
      const result = super.status({ ...input, ...(publication ? {publicationUrl:publication} : {}) });
      const feeds = result.publications.filter(p => p.rss_registration_id && (!input.feedId || p.rss_registration_id === input.feedId)).map(p => ({feed_id:p.rss_registration_id,feed_url:p.feed_url,title:p.title,provider:'substack',filed_low_watermark:p.filed_low_watermark,filed_high_watermark:p.filed_high_watermark,outstanding_count:p.outstanding_count}));
      return {...result, feeds, ...(input.feedId && !publication ? {posts:[],total:0,nextOffset:null} : {})};
    }
    const limit=input.limit??500, offset=input.offset??0;
    if (!Number.isInteger(limit)||limit<1||limit>5000||!Number.isInteger(offset)||offset<0) throw new Error('limit must be 1..5000 and offset must be nonnegative.');
    const where=[],args=[];
    if (input.feedId) { where.push('EXISTS(SELECT 1 FROM rss_feed_posts fp WHERE fp.url=p.url AND fp.feed_id=?)'); args.push(required(input.feedId,'feedId')); }
    if (input.url) { where.push('p.url=?'); args.push(this.postUrl(input.url)); }
    if (input.outstandingOnly) where.push("p.outcome IN ('pending','processing','needs_review')");
    const filter=where.length?` WHERE ${where.join(' AND ')}`:'';
    const total=Number(this.db.prepare(`SELECT COUNT(*) AS n FROM posts p${filter}`).get(...args).n);
    const posts=this.db.prepare(`SELECT p.* FROM posts p${filter} ORDER BY published_at DESC,url LIMIT ? OFFSET ?`).all(...args,limit,offset).map(p=>({...p,verification:p.verification?JSON.parse(p.verification):null}));
    const feeds=this.db.prepare(`SELECT f.*,MIN(CASE WHEN p.outcome IN ('source_only','source_and_update','verified_noop') THEN p.published_at END) AS filed_low_watermark,MAX(CASE WHEN p.outcome IN ('source_only','source_and_update','verified_noop') THEN p.published_at END) AS filed_high_watermark,COUNT(CASE WHEN p.outcome IN ('pending','processing','needs_review') THEN 1 END) AS outstanding_count FROM rss_feeds f LEFT JOIN rss_feed_posts fp ON fp.feed_id=f.feed_id LEFT JOIN posts p ON p.url=fp.url ${input.feedId?'WHERE f.feed_id=?':''} GROUP BY f.feed_id ORDER BY f.feed_id`).all(...(input.feedId?[input.feedId]:[]));
    return { exists:true,schemaVersion:SUBSTACK_LEDGER_SCHEMA_VERSION,feeds,posts,total,nextOffset:offset+posts.length<total?offset+posts.length:null };
  }
}
