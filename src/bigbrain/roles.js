export const DEFAULT_ROLES = [
  {
    key: 'owner',
    name: 'Owner',
    description: 'Brain owner with full superuser privileges.',
    builtin: true,
    permissions: {
      superuser: true,
      read: true,
      page_edit: true,
      members_manage: true,
      roles_manage: true,
      about_update: true,
      publish: true,
      raw_destructive: true,
      git_backup: true,
      maintenance: true,
      audit: true,
    },
    page_edit_paths: [''],
  },
  {
    key: 'admin',
    name: 'Admin',
    description: 'Brain administrator who can manage non-owner members and custom roles.',
    builtin: true,
    permissions: {
      read: true,
      page_edit: true,
      members_manage: true,
      roles_manage: true,
      publish: true,
      raw_destructive: true,
      git_backup: true,
      maintenance: true,
      audit: true,
    },
    page_edit_paths: [''],
  },
  {
    key: 'editor',
    name: 'Editor',
    description: 'Brain editor who can create and update pages.',
    builtin: true,
    permissions: {
      read: true,
      page_edit: true,
    },
    page_edit_paths: [''],
  },
  {
    key: 'read-only',
    name: 'Read-only',
    description: 'Brain reader without write privileges.',
    builtin: true,
    permissions: {
      read: true,
    },
    page_edit_paths: [],
  },
];

const LEGACY_ROLE_ALIASES = new Map([
  ['member', 'editor'],
  ['viewer', 'read-only'],
  ['readonly', 'read-only'],
  ['read_only', 'read-only'],
]);

export function normalizeRoleKey(role) {
  const normalized = String(role || 'editor').trim().toLowerCase();
  return LEGACY_ROLE_ALIASES.get(normalized) || normalized;
}

export function roleRowToObject(row, paths = []) {
  if (!row) return null;
  return {
    key: normalizeRoleKey(row.role_key || row.key),
    name: row.name,
    description: row.description || '',
    builtin: Boolean(row.builtin),
    permissions: parseJson(row.permissions_json, {}),
    page_edit_paths: paths,
    created_at: row.created_at instanceof Date ? row.created_at.toISOString() : row.created_at,
    updated_at: row.updated_at instanceof Date ? row.updated_at.toISOString() : row.updated_at,
  };
}

export async function ensureDefaultRoles(db) {
  for (const role of DEFAULT_ROLES) {
    await upsertRoleDefinition(db, role, { allowBuiltin: true });
  }
}

export function ensureDefaultRolesSync(raw) {
  const now = new Date().toISOString();
  for (const role of DEFAULT_ROLES) {
    const normalized = normalizeRoleInput(role);
    raw.prepare(`
      INSERT INTO roles (role_key, name, description, builtin, permissions_json, created_at, updated_at)
      VALUES (?, ?, ?, 1, ?, ?, ?)
      ON CONFLICT(role_key) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        builtin = excluded.builtin,
        permissions_json = excluded.permissions_json,
        updated_at = excluded.updated_at
    `).run(normalized.key, normalized.name, normalized.description, JSON.stringify(normalized.permissions), now, now);
    raw.prepare('DELETE FROM role_path_permissions WHERE role_key = ?').run(normalized.key);
    const insert = raw.prepare('INSERT INTO role_path_permissions (role_key, path_prefix, can_edit, created_at, updated_at) VALUES (?, ?, 1, ?, ?)');
    for (const prefix of normalized.page_edit_paths) insert.run(normalized.key, prefix, now, now);
  }
}

export async function listRoles(db) {
  const rows = db.backend === 'postgres'
    ? (await db.query('SELECT * FROM roles ORDER BY builtin DESC, role_key')).rows
    : db.raw.prepare('SELECT * FROM roles ORDER BY builtin DESC, role_key').all();
  const paths = await rolePathMap(db);
  return rows.map((row) => roleRowToObject(row, paths.get(normalizeRoleKey(row.role_key)) || []));
}

export async function getRole(db, roleKey) {
  const key = normalizeRoleKey(roleKey);
  const row = db.backend === 'postgres'
    ? (await db.query('SELECT * FROM roles WHERE role_key = $1 LIMIT 1', [key])).rows[0]
    : db.raw.prepare('SELECT * FROM roles WHERE role_key = ? LIMIT 1').get(key);
  if (!row) return null;
  return roleRowToObject(row, await rolePaths(db, key));
}

export async function upsertCustomRole(db, role) {
  const normalized = normalizeRoleInput(role);
  if (DEFAULT_ROLES.some((builtin) => builtin.key === normalized.key)) {
    throw new Error(`Built-in role cannot be changed through custom role management: ${normalized.key}`);
  }
  return upsertRoleDefinition(db, { ...normalized, builtin: false }, { allowBuiltin: false });
}

export async function roleAllows(db, roleKey, permission) {
  const role = await getRole(db, roleKey);
  if (!role) return false;
  return Boolean(role.permissions?.superuser || role.permissions?.[permission]);
}

export async function roleCanEditPath(db, roleKey, pagePath) {
  const role = await getRole(db, roleKey);
  if (!role) return false;
  if (role.permissions?.superuser) return true;
  if (!role.permissions?.page_edit) return false;
  const normalizedPath = normalizePagePath(pagePath);
  if (role.page_edit_paths.includes('')) return true;
  return role.page_edit_paths.some((prefix) => normalizedPath === prefix || normalizedPath.startsWith(`${prefix}/`));
}

export function isOwnerRole(roleKey) {
  return normalizeRoleKey(roleKey) === 'owner';
}

async function upsertRoleDefinition(db, role, { allowBuiltin }) {
  const normalized = normalizeRoleInput(role);
  const now = new Date().toISOString();
  const builtin = allowBuiltin ? normalized.builtin : false;
  if (db.backend === 'postgres') {
    await db.query(`
      INSERT INTO roles (role_key, name, description, builtin, permissions_json, created_at, updated_at)
      VALUES ($1,$2,$3,$4,$5,$6,$7)
      ON CONFLICT(role_key) DO UPDATE SET
        name = EXCLUDED.name,
        description = EXCLUDED.description,
        builtin = EXCLUDED.builtin,
        permissions_json = EXCLUDED.permissions_json,
        updated_at = EXCLUDED.updated_at
    `, [normalized.key, normalized.name, normalized.description, builtin, JSON.stringify(normalized.permissions), now, now]);
    await db.query('DELETE FROM role_path_permissions WHERE role_key = $1', [normalized.key]);
    for (const prefix of normalized.page_edit_paths) {
      await db.query('INSERT INTO role_path_permissions (role_key, path_prefix, can_edit, created_at, updated_at) VALUES ($1,$2,true,$3,$4)', [normalized.key, prefix, now, now]);
    }
  } else {
    db.raw.prepare(`
      INSERT INTO roles (role_key, name, description, builtin, permissions_json, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(role_key) DO UPDATE SET
        name = excluded.name,
        description = excluded.description,
        builtin = excluded.builtin,
        permissions_json = excluded.permissions_json,
        updated_at = excluded.updated_at
    `).run(normalized.key, normalized.name, normalized.description, builtin ? 1 : 0, JSON.stringify(normalized.permissions), now, now);
    db.raw.prepare('DELETE FROM role_path_permissions WHERE role_key = ?').run(normalized.key);
    const insert = db.raw.prepare('INSERT INTO role_path_permissions (role_key, path_prefix, can_edit, created_at, updated_at) VALUES (?, ?, 1, ?, ?)');
    for (const prefix of normalized.page_edit_paths) insert.run(normalized.key, prefix, now, now);
  }
  return getRole(db, normalized.key);
}

function normalizeRoleInput(role) {
  const key = normalizeRoleKey(role?.key || role?.role_key || role?.role);
  if (!/^[a-z0-9][a-z0-9_-]*(?:-[a-z0-9][a-z0-9_-]*)*$/.test(key)) throw new Error('Role key must be a lowercase slug.');
  return {
    key,
    name: String(role?.name || key).trim(),
    description: String(role?.description || '').trim(),
    builtin: Boolean(role?.builtin),
    permissions: normalizePermissions(role?.permissions),
    page_edit_paths: normalizePathPrefixes(role?.page_edit_paths || role?.pageEditPaths || []),
  };
}

function normalizePermissions(permissions = {}) {
  const allowed = new Set(['read', 'page_edit', 'members_manage', 'roles_manage', 'about_update', 'publish', 'raw_destructive', 'git_backup', 'maintenance', 'audit', 'superuser']);
  const normalized = {};
  for (const [key, value] of Object.entries(permissions || {})) {
    if (allowed.has(key) && value === true) normalized[key] = true;
  }
  if (normalized.superuser) {
    for (const key of allowed) normalized[key] = true;
  }
  return normalized;
}

function normalizePathPrefixes(paths) {
  return [...new Set((paths || []).map(normalizePagePath))];
}

function normalizePagePath(pagePath) {
  return String(pagePath || '').trim().replace(/\.md$/i, '').replace(/^\/+/, '').replace(/\/+$/, '');
}

async function rolePaths(db, roleKey) {
  const rows = db.backend === 'postgres'
    ? (await db.query('SELECT path_prefix FROM role_path_permissions WHERE role_key = $1 AND can_edit = true ORDER BY path_prefix', [normalizeRoleKey(roleKey)])).rows
    : db.raw.prepare('SELECT path_prefix FROM role_path_permissions WHERE role_key = ? AND can_edit = 1 ORDER BY path_prefix').all(normalizeRoleKey(roleKey));
  return rows.map((row) => normalizePagePath(row.path_prefix));
}

async function rolePathMap(db) {
  const rows = db.backend === 'postgres'
    ? (await db.query('SELECT role_key, path_prefix FROM role_path_permissions WHERE can_edit = true ORDER BY role_key, path_prefix')).rows
    : db.raw.prepare('SELECT role_key, path_prefix FROM role_path_permissions WHERE can_edit = 1 ORDER BY role_key, path_prefix').all();
  const paths = new Map();
  for (const row of rows) {
    const key = normalizeRoleKey(row.role_key);
    if (!paths.has(key)) paths.set(key, []);
    paths.get(key).push(normalizePagePath(row.path_prefix));
  }
  return paths;
}

function parseJson(value, fallback) {
  if (!value) return fallback;
  if (typeof value === 'object') return value;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}
