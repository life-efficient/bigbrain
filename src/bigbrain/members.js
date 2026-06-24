export async function listMembers(db, { status = null } = {}) {
  const rows = db.backend === 'postgres'
    ? (status
        ? (await db.query('SELECT * FROM members WHERE status = $1 ORDER BY person_slug', [status])).rows
        : (await db.query('SELECT * FROM members ORDER BY person_slug')).rows)
    : (status
        ? db.raw.prepare('SELECT * FROM members WHERE status = ? ORDER BY person_slug').all(status)
        : db.raw.prepare('SELECT * FROM members ORDER BY person_slug').all());
  return rows.map(normalizeMember);
}

export async function listActiveMembers(db) {
  return listMembers(db, { status: 'active' });
}

export async function findActiveMemberByEmail(db, email) {
  const normalizedEmail = normalizeEmail(email);
  if (!normalizedEmail) return null;
  const row = db.backend === 'postgres'
    ? (await db.query('SELECT * FROM members WHERE lower(email) = $1 AND status = $2 LIMIT 1', [normalizedEmail, 'active'])).rows[0]
    : db.raw.prepare('SELECT * FROM members WHERE lower(email) = ? AND status = ? LIMIT 1').get(normalizedEmail, 'active');
  return row ? normalizeMember(row) : null;
}

export async function findActiveMemberByPersonSlug(db, personSlug) {
  const normalizedSlug = normalizePersonSlug(personSlug);
  if (!normalizedSlug) return null;
  const row = db.backend === 'postgres'
    ? (await db.query('SELECT * FROM members WHERE person_slug = $1 AND status = $2 LIMIT 1', [normalizedSlug, 'active'])).rows[0]
    : db.raw.prepare('SELECT * FROM members WHERE person_slug = ? AND status = ? LIMIT 1').get(normalizedSlug, 'active');
  return row ? normalizeMember(row) : null;
}

export async function findMemberByPersonSlug(db, personSlug) {
  const normalizedSlug = normalizePersonSlug(personSlug);
  if (!normalizedSlug) return null;
  const row = db.backend === 'postgres'
    ? (await db.query('SELECT * FROM members WHERE person_slug = $1 LIMIT 1', [normalizedSlug])).rows[0]
    : db.raw.prepare('SELECT * FROM members WHERE person_slug = ? LIMIT 1').get(normalizedSlug);
  return row ? normalizeMember(row) : null;
}

export async function resolveActorMember(db, actor, { authMode = null, localPersonSlug = null } = {}) {
  if (actor?.email) return findActiveMemberByEmail(db, actor.email);
  if (authMode !== 'none') return null;
  const configuredSlug = normalizePersonSlug(localPersonSlug);
  if (configuredSlug) {
    const member = await findActiveMemberByPersonSlug(db, configuredSlug);
    if (!member) throw new Error(`Configured local member is not an active member: ${configuredSlug}`);
    return member;
  }
  const members = await listActiveMembers(db);
  const owners = members.filter((member) => member.role === 'owner');
  if (owners.length === 1) return owners[0];
  if (owners.length > 1) {
    throw new Error('Local auth mode has multiple active owners. Set BIGBRAIN_MCP_LOCAL_PERSON_SLUG to choose the local owner.');
  }
  if (members.length === 1) return members[0];
  if (members.length > 1) {
    throw new Error('Local auth mode has multiple active members and no active owner. Set BIGBRAIN_MCP_LOCAL_PERSON_SLUG to choose the local owner.');
  }
  return null;
}

export async function upsertMember(db, member) {
  const normalized = normalizeMemberInput(member);
  const now = new Date().toISOString();
  if (db.backend === 'postgres') {
    const row = (await db.query(`
      INSERT INTO members (
        email, name, person_slug, status, role, oauth_provider, oauth_subject, created_at, updated_at
      ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
      ON CONFLICT(email) DO UPDATE SET
        name = EXCLUDED.name,
        person_slug = EXCLUDED.person_slug,
        status = EXCLUDED.status,
        role = EXCLUDED.role,
        oauth_provider = EXCLUDED.oauth_provider,
        oauth_subject = EXCLUDED.oauth_subject,
        updated_at = EXCLUDED.updated_at
      RETURNING *
    `, [
      normalized.email,
      normalized.name,
      normalized.person_slug,
      normalized.status,
      normalized.role,
      normalized.oauth_provider,
      normalized.oauth_subject,
      now,
      now,
    ])).rows[0];
    return normalizeMember(row);
  }

  db.raw.prepare(`
    INSERT INTO members (
      email, name, person_slug, status, role, oauth_provider, oauth_subject, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(email) DO UPDATE SET
      name = excluded.name,
      person_slug = excluded.person_slug,
      status = excluded.status,
      role = excluded.role,
      oauth_provider = excluded.oauth_provider,
      oauth_subject = excluded.oauth_subject,
      updated_at = excluded.updated_at
  `).run(
    normalized.email,
    normalized.name,
    normalized.person_slug,
    normalized.status,
    normalized.role,
    normalized.oauth_provider,
    normalized.oauth_subject,
    now,
    now,
  );
  return findActiveOrAnyMemberByEmail(db, normalized.email);
}

export async function ensureLocalOwnerMember(db, {
  personSlug,
  email = null,
  name = null,
} = {}) {
  const normalizedSlug = normalizePersonSlug(personSlug);
  if (!normalizedSlug) throw new Error('Local owner person slug is required.');
  const existing = await findMemberByPersonSlug(db, normalizedSlug);
  const memberEmail = existing?.email || normalizeEmail(email) || defaultLocalEmail(normalizedSlug);
  const memberName = String(name || existing?.name || nameFromPersonSlug(normalizedSlug)).trim();
  return upsertMember(db, {
    email: memberEmail,
    name: memberName,
    person_slug: normalizedSlug,
    status: 'active',
    role: 'owner',
  });
}

export function memberMapByPersonSlug(members) {
  return new Map((members || []).map((member) => [member.person_slug, member]));
}

async function findActiveOrAnyMemberByEmail(db, email) {
  const normalizedEmail = normalizeEmail(email);
  const row = db.backend === 'postgres'
    ? (await db.query('SELECT * FROM members WHERE lower(email) = $1 LIMIT 1', [normalizedEmail])).rows[0]
    : db.raw.prepare('SELECT * FROM members WHERE lower(email) = ? LIMIT 1').get(normalizedEmail);
  return row ? normalizeMember(row) : null;
}

function normalizeMemberInput(member) {
  const email = normalizeEmail(member?.email);
  if (!email) throw new Error('Member email is required.');
  const personSlug = normalizePersonSlug(member?.person_slug || member?.personSlug);
  if (!personSlug) throw new Error('Member person_slug is required.');
  return {
    email,
    name: String(member?.name || email).trim(),
    person_slug: personSlug,
    status: normalizeEnum(member?.status, ['active', 'inactive', 'invited'], 'active'),
    role: normalizeEnum(member?.role, ['owner', 'member', 'viewer'], 'member'),
    oauth_provider: member?.oauth_provider || member?.oauthProvider || null,
    oauth_subject: member?.oauth_subject || member?.oauthSubject || null,
  };
}

function normalizeMember(row) {
  return {
    id: row.id,
    email: normalizeEmail(row.email),
    name: String(row.name || row.email || '').trim(),
    person_slug: normalizePersonSlug(row.person_slug),
    status: row.status || 'active',
    role: row.role || 'member',
    oauth_provider: row.oauth_provider || null,
    oauth_subject: row.oauth_subject || null,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizePersonSlug(slug) {
  const normalized = String(slug || '').trim().replace(/\.md$/i, '');
  if (!normalized) return '';
  return normalized.startsWith('people/') ? normalized : '';
}

function normalizeEnum(value, allowed, fallback) {
  const normalized = String(value || fallback).trim().toLowerCase();
  return allowed.includes(normalized) ? normalized : fallback;
}

function defaultLocalEmail(personSlug) {
  const localPart = personSlug.replace(/^people\//, '').replace(/[^a-z0-9._+-]+/gi, '-').toLowerCase();
  return `${localPart || 'owner'}@local.bigbrain`;
}

function nameFromPersonSlug(personSlug) {
  return personSlug
    .replace(/^people\//, '')
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => `${part.slice(0, 1).toUpperCase()}${part.slice(1)}`)
    .join(' ') || 'Local Owner';
}
