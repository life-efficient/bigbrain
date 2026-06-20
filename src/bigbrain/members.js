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

export async function resolveActorMember(db, actor) {
  if (!actor?.email) return null;
  return findActiveMemberByEmail(db, actor.email);
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
