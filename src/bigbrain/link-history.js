import { execFile } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';

import { extractLinks } from './markdown.js';

const execFileAsync = promisify(execFile);
const RECORD_SEPARATOR = '\x1e';
const FIELD_SEPARATOR = '\x1f';

export const DEFAULT_LINK_HISTORY_LIMIT = 100;
export const MAX_LINK_HISTORY_LIMIT = 500;
export const DEFAULT_LINK_HISTORY_COMMIT_LIMIT = 250;
export const MAX_LINK_HISTORY_COMMIT_LIMIT = 500;
export const MAX_LINK_HISTORY_OUTPUT_BYTES = 8 * 1024 * 1024;

/**
 * Return the link changes found in bounded Git history for one Markdown page.
 * Git output is deliberately limited by both commit count and maxBuffer.
 */
export async function getLinkHistory({
  repoRoot,
  brainDir,
  pagePath,
  limit = DEFAULT_LINK_HISTORY_LIMIT,
  commitLimit = DEFAULT_LINK_HISTORY_COMMIT_LIMIT,
  execFileImpl = execFileAsync,
} = {}) {
  const root = repoRoot || brainDir;
  if (!root) throw new Error('A Git repository root is required.');

  const normalizedPagePath = normalizeHistoryPagePath(pagePath);
  const normalizedLimit = normalizeLimit(limit, DEFAULT_LINK_HISTORY_LIMIT, MAX_LINK_HISTORY_LIMIT);
  const normalizedCommitLimit = normalizeLimit(
    commitLimit,
    DEFAULT_LINK_HISTORY_COMMIT_LIMIT,
    MAX_LINK_HISTORY_COMMIT_LIMIT,
  );

  let stdout;
  try {
    ({ stdout } = await execFileImpl('git', [
      'log',
      '--no-color',
      '--no-ext-diff',
      '--no-textconv',
      '--no-renames',
      '--reverse',
      `--max-count=${normalizedCommitLimit}`,
      `--format=${RECORD_SEPARATOR}%H${FIELD_SEPARATOR}%aI${FIELD_SEPARATOR}%s`,
      '--patch',
      '--unified=0',
      '--',
      normalizedPagePath,
    ], {
      cwd: root,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      maxBuffer: MAX_LINK_HISTORY_OUTPUT_BYTES,
    }));
  } catch (error) {
    throw new Error(`Unable to read Git link history for ${normalizedPagePath}: ${error.message}`, { cause: error });
  }

  return parseLinkHistory(stdout, {
    pagePath: normalizedPagePath,
    limit: normalizedLimit,
  });
}

export function parseLinkHistory(gitOutput, { pagePath, limit = DEFAULT_LINK_HISTORY_LIMIT } = {}) {
  const normalizedPagePath = normalizeHistoryPagePath(pagePath);
  const normalizedLimit = normalizeLimit(limit, DEFAULT_LINK_HISTORY_LIMIT, MAX_LINK_HISTORY_LIMIT);
  const fromPage = normalizedPagePath.slice(0, -path.posix.extname(normalizedPagePath).length);
  const events = [];
  const seen = new Set();

  for (const record of String(gitOutput || '').split(RECORD_SEPARATOR)) {
    const metadata = parseCommitMetadata(record);
    if (!metadata) continue;

    for (const change of changedLines(record.slice(metadata.bodyOffset))) {
      for (const link of extractLinks(change.text, fromPage)) {
        if (!['markdown', 'wikilink'].includes(link.kind)) continue;
        const type = change.sign === '+' ? 'link-introduced' : 'link-removed';
        const key = `${metadata.sha}\0${type}\0${link.toSlug}`;
        if (seen.has(key)) continue;
        seen.add(key);
        events.push({
          type,
          commit_sha: metadata.sha,
          timestamp: metadata.timestamp,
          subject: metadata.subject,
          from_page: fromPage,
          to_page: link.toSlug,
        });
        if (events.length >= normalizedLimit) return events;
      }
    }
  }

  return events;
}

export const buildLinkHistory = getLinkHistory;
export const readLinkHistory = getLinkHistory;
export const parseGitLinkHistory = parseLinkHistory;

export async function getRelatedLinkHistory({
  repoRoot,
  brainDir,
  pagePath,
  limit = DEFAULT_LINK_HISTORY_LIMIT,
  commitLimit = DEFAULT_LINK_HISTORY_COMMIT_LIMIT,
  execFileImpl = execFileAsync,
} = {}) {
  const root = repoRoot || brainDir;
  if (!root) throw new Error('A Git repository root is required.');
  const targetPage = normalizeHistoryPagePath(pagePath).replace(/\.md$/i, '');
  const normalizedLimit = normalizeLimit(limit, DEFAULT_LINK_HISTORY_LIMIT, MAX_LINK_HISTORY_LIMIT);
  const normalizedCommitLimit = normalizeLimit(commitLimit, DEFAULT_LINK_HISTORY_COMMIT_LIMIT, MAX_LINK_HISTORY_COMMIT_LIMIT);
  let stdout;
  try {
    ({ stdout } = await execFileImpl('git', [
      'log', '--no-color', '--no-ext-diff', '--no-textconv', '--no-renames', '--reverse',
      `--max-count=${normalizedCommitLimit}`,
      `--format=${RECORD_SEPARATOR}%H${FIELD_SEPARATOR}%aI${FIELD_SEPARATOR}%s`,
      '--patch', '--unified=0', '--', ':(glob)**/*.md',
    ], {
      cwd: root,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      maxBuffer: MAX_LINK_HISTORY_OUTPUT_BYTES,
    }));
  } catch (error) {
    throw new Error(`Unable to read related Git link history for ${targetPage}: ${error.message}`, { cause: error });
  }
  return parseRelatedLinkHistory(stdout, { pageSlug: targetPage, limit: normalizedLimit });
}

export function parseRelatedLinkHistory(gitOutput, { pageSlug, limit = DEFAULT_LINK_HISTORY_LIMIT } = {}) {
  const targetPage = normalizeHistoryPagePath(pageSlug).replace(/\.md$/i, '');
  const normalizedLimit = normalizeLimit(limit, DEFAULT_LINK_HISTORY_LIMIT, MAX_LINK_HISTORY_LIMIT);
  const events = [];
  const seen = new Set();
  for (const record of String(gitOutput || '').split(RECORD_SEPARATOR)) {
    const metadata = parseCommitMetadata(record);
    if (!metadata) continue;
    const body = record.slice(metadata.bodyOffset);
    const sections = body.split(/(?=^diff --git )/m).filter((section) => section.startsWith('diff --git '));
    for (const section of sections) {
      const fileMatch = section.match(/^diff --git a\/(.+?) b\/(.+?)$/m);
      if (!fileMatch || fileMatch[2] === '/dev/null') continue;
      const fromPage = normalizeHistoryPagePath(fileMatch[2]).replace(/\.md$/i, '');
      for (const change of changedLines(section)) {
        for (const link of extractLinks(change.text, fromPage)) {
          if (!['markdown', 'wikilink'].includes(link.kind)) continue;
          if (fromPage !== targetPage && link.toSlug !== targetPage) continue;
          const type = change.sign === '+' ? 'link-introduced' : 'link-removed';
          const key = `${metadata.sha}\0${type}\0${fromPage}\0${link.toSlug}`;
          if (seen.has(key)) continue;
          seen.add(key);
          events.push({
            type,
            commit_sha: metadata.sha,
            timestamp: metadata.timestamp,
            subject: metadata.subject,
            from_page: fromPage,
            to_page: link.toSlug,
          });
          if (events.length >= normalizedLimit) return events;
        }
      }
    }
  }
  return events;
}

export function normalizeHistoryPagePath(input) {
  const rawInput = String(input || '').trim();
  if (rawInput.includes('\\')) throw new Error(`Invalid Markdown page path: ${input}`);
  const raw = rawInput.replace(/^\/+/, '');
  if (!raw || raw.includes('\0')) throw new Error('A Markdown page path is required.');
  if (/\.[^/]+$/i.test(raw) && !/\.md$/i.test(raw)) {
    throw new Error(`Invalid Markdown page path: ${input}`);
  }
  if (raw.split('/').some((part) => part === '.' || part === '..')) {
    throw new Error(`Invalid Markdown page path: ${input}`);
  }
  const normalized = path.posix.normalize(raw);
  if (
    normalized === '.'
    || normalized.startsWith('../')
    || path.posix.isAbsolute(normalized)
    || normalized.split('/').some((part) => part === '..')
  ) {
    throw new Error(`Invalid Markdown page path: ${input}`);
  }
  return normalized.endsWith('.md') ? normalized : `${normalized}.md`;
}

function parseCommitMetadata(record) {
  const firstSeparator = record.indexOf(FIELD_SEPARATOR);
  if (firstSeparator <= 0) return null;
  const secondSeparator = record.indexOf(FIELD_SEPARATOR, firstSeparator + 1);
  if (secondSeparator <= firstSeparator) return null;
  const newline = record.indexOf('\n', secondSeparator + 1);
  if (newline < 0) return null;
  const sha = record.slice(0, firstSeparator).trim();
  const timestamp = record.slice(firstSeparator + 1, secondSeparator).trim();
  const subject = record.slice(secondSeparator + 1, newline).trimEnd();
  if (!sha || !timestamp) return null;
  return { sha, timestamp, subject, bodyOffset: newline + 1 };
}

function changedLines(diff) {
  const changes = [];
  let inHunk = false;
  for (const line of String(diff || '').split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true;
      continue;
    }
    if (!inHunk || line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+') || line.startsWith('-')) {
      changes.push({ sign: line[0], text: line.slice(1) });
    }
  }
  return changes;
}

function normalizeLimit(value, fallback, maximum) {
  const number = Number(value ?? fallback);
  if (!Number.isFinite(number) || number <= 0) return fallback;
  return Math.min(Math.floor(number), maximum);
}
