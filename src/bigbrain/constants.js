import os from 'node:os';
import path from 'node:path';

export const CONFIG_FILENAME = 'config.json';
export const STATE_FILENAME = 'state.json';
export const DB_FILENAME = 'bigbrain.sqlite';
export const META_DIRNAME = '.bigbrain';
export const DEFAULT_POINTER_PATH = path.join(os.homedir(), '.config', 'bigbrain', 'default-brain-home');
export const DEFAULT_DASHBOARD_PORT = 3474;
export const DEFAULT_EMBEDDING_MODEL = 'text-embedding-3-small';
export const DEFAULT_QUERY_MODEL = 'gpt-4o-mini';

export const CANONICAL_SCHEMA_DIRS = [
  'people',
  'companies',
  'deals',
  'meetings',
  'projects',
  'ideas',
  'concepts',
  'writing',
  'sources',
  'inbox',
  'archive',
  'dreams',
  'ops',
];

export const DEFAULT_FRESHNESS_INPUTS = ['markdown', 'meetings', 'conversations'];

export const PAGE_REQUIRED_TIMELINE_TYPES = new Set([
  'people',
  'companies',
  'deals',
  'meetings',
  'projects',
]);
