import fs from 'node:fs/promises';
import path from 'node:path';

import { openDatabase } from './db.js';

export async function createMcpAuthStore(config, authConfig) {
  if (config.storageBackend === 'postgres') {
    const db = await openDatabase(config);
    return new PostgresMcpAuthStore(db);
  }
  return new FileMcpAuthStore(authConfig.tokenStorePath);
}

export class FileMcpAuthStore {
  constructor(tokenStorePath) {
    this.tokenStorePath = tokenStorePath;
  }

  async read() {
    if (!this.tokenStorePath) return emptyStore();
    try {
      const parsed = JSON.parse(await fs.readFile(this.tokenStorePath, 'utf8'));
      return normalizeStore(parsed);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
      return emptyStore();
    }
  }

  async write(store) {
    if (!this.tokenStorePath) return;
    await fs.mkdir(path.dirname(this.tokenStorePath), { recursive: true });
    await fs.writeFile(this.tokenStorePath, `${JSON.stringify(normalizeStore(store), null, 2)}\n`, { mode: 0o600 });
  }
}

export class PostgresMcpAuthStore {
  constructor(db) {
    this.db = db;
  }

  async read() {
    await this.pruneExpired();
    const [tokens, states, clients, codes] = await Promise.all([
      this.db.query('SELECT token_json FROM mcp_oauth_tokens ORDER BY created_at'),
      this.db.query('SELECT state_json FROM mcp_oauth_states ORDER BY created_at'),
      this.db.query('SELECT client_json FROM mcp_oauth_clients ORDER BY created_at'),
      this.db.query('SELECT code_json FROM mcp_oauth_codes ORDER BY created_at'),
    ]);
    return {
      tokens: tokens.rows.map((row) => normalizeJson(row.token_json)),
      states: states.rows.map((row) => normalizeJson(row.state_json)),
      clients: clients.rows.map((row) => normalizeJson(row.client_json)),
      codes: codes.rows.map((row) => normalizeJson(row.code_json)),
    };
  }

  async write(store) {
    const normalized = normalizeStore(store);
    await this.db.query('BEGIN');
    try {
      await this.db.query('DELETE FROM mcp_oauth_tokens');
      await this.db.query('DELETE FROM mcp_oauth_states');
      await this.db.query('DELETE FROM mcp_oauth_clients');
      await this.db.query('DELETE FROM mcp_oauth_codes');
      for (const client of normalized.clients) {
        await this.db.query(`
          INSERT INTO mcp_oauth_clients (client_id, client_json, created_at)
          VALUES ($1,$2,$3)
        `, [client.client_id, JSON.stringify(client), client.created_at || new Date().toISOString()]);
      }
      for (const state of normalized.states) {
        await this.db.query(`
          INSERT INTO mcp_oauth_states (state_hash, state_json, expires_at, created_at)
          VALUES ($1,$2,$3,$4)
        `, [state.state_hash, JSON.stringify(state), state.expires_at, state.created_at || new Date().toISOString()]);
      }
      for (const code of normalized.codes) {
        await this.db.query(`
          INSERT INTO mcp_oauth_codes (code_hash, code_json, expires_at, created_at)
          VALUES ($1,$2,$3,$4)
        `, [code.code_hash, JSON.stringify(code), code.expires_at, code.created_at || new Date().toISOString()]);
      }
      for (const token of normalized.tokens) {
        await this.db.query(`
          INSERT INTO mcp_oauth_tokens (token_hash, token_json, email, created_at, last_used_at, revoked_at)
          VALUES ($1,$2,$3,$4,$5,$6)
        `, [
          token.token_hash,
          JSON.stringify(token),
          token.email || '',
          token.created_at || new Date().toISOString(),
          token.last_used_at || null,
          token.revoked_at || null,
        ]);
      }
      await this.db.query('COMMIT');
    } catch (error) {
      await this.db.query('ROLLBACK');
      throw error;
    }
  }

  async pruneExpired() {
    await this.db.query('DELETE FROM mcp_oauth_states WHERE expires_at <= now()');
    await this.db.query('DELETE FROM mcp_oauth_codes WHERE expires_at <= now()');
  }
}

function emptyStore() {
  return { tokens: [], states: [], clients: [], codes: [] };
}

function normalizeStore(store) {
  return {
    tokens: Array.isArray(store?.tokens) ? store.tokens : [],
    states: Array.isArray(store?.states) ? store.states : [],
    clients: Array.isArray(store?.clients) ? store.clients : [],
    codes: Array.isArray(store?.codes) ? store.codes : [],
  };
}

function normalizeJson(value) {
  if (value && typeof value === 'object' && !(value instanceof Date)) return value;
  return JSON.parse(String(value || '{}'));
}
