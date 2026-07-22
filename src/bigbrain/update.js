import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const VALID_CHANNELS = new Set(['stable', 'beta']);
const DEFAULT_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export async function checkForUpdate({
  repoRoot = process.env.BIGBRAIN_REPO || DEFAULT_REPO_ROOT,
  channel = process.env.BIGBRAIN_UPDATE_CHANNEL || 'stable',
  run = runCommand,
  now = () => new Date().toISOString(),
} = {}) {
  const normalizedChannel = normalizeChannel(channel);
  const base = {
    schema_version: 1,
    ok: false,
    action: 'check',
    channel: normalizedChannel,
    status: 'failed',
    current_version: null,
    available_version: null,
    current_ref: null,
    available_ref: null,
    checked_at: now(),
    reason: null,
  };

  try {
    const resolvedRepo = path.resolve(repoRoot);
    const packageJson = await readPackageJson(resolvedRepo);
    base.current_version = packageJson.version;

    const isWorkTree = await gitResult(run, resolvedRepo, ['rev-parse', '--is-inside-work-tree']);
    if (!isWorkTree.ok || isWorkTree.stdout.trim() !== 'true') {
      return { ...base, status: 'unsupported', reason: 'source_checkout_required' };
    }

    const upstream = await gitResult(run, resolvedRepo, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
    if (!upstream.ok || !upstream.stdout.trim().includes('/')) {
      return { ...base, status: 'blocked', reason: 'tracked_upstream_required' };
    }
    const upstreamRef = upstream.stdout.trim();
    const remote = upstreamRef.split('/')[0];
    await run('git', ['fetch', '--prune', '--tags', remote], { cwd: resolvedRepo });

    const head = await run('git', ['rev-parse', 'HEAD'], { cwd: resolvedRepo });
    base.current_ref = head.stdout.trim();
    const tagsResult = await run('git', ['tag', '--list', 'v*'], { cwd: resolvedRepo });
    const candidates = tagsResult.stdout
      .split(/\r?\n/)
      .map((tag) => ({ tag: tag.trim(), semver: parseSemver(tag.trim()) }))
      .filter((candidate) => candidate.semver && (normalizedChannel === 'beta' || candidate.semver.prerelease.length === 0))
      .sort((left, right) => compareSemver(right.semver, left.semver));

    let selected = null;
    for (const candidate of candidates) {
      const merged = await gitResult(run, resolvedRepo, ['merge-base', '--is-ancestor', candidate.tag, upstreamRef]);
      if (merged.ok) {
        selected = candidate;
        break;
      }
    }
    if (!selected) {
      return { ...base, ok: true, status: 'up_to_date', reason: 'no_release_on_channel' };
    }

    base.available_version = formatSemver(selected.semver);
    base.available_ref = selected.tag;
    const currentSemver = parseSemver(packageJson.version);
    if (!currentSemver) throw new Error(`Current package version is not valid SemVer: ${packageJson.version}`);

    const comparison = compareSemver(selected.semver, currentSemver);
    if (comparison <= 0) return { ...base, ok: true, status: 'up_to_date' };
    return { ...base, ok: true, status: 'update_available' };
  } catch (error) {
    return { ...base, reason: 'update_check_failed', error: errorMessage(error) };
  }
}

export async function applyUpdate({
  repoRoot = process.env.BIGBRAIN_REPO || DEFAULT_REPO_ROOT,
  channel = process.env.BIGBRAIN_UPDATE_CHANNEL || 'stable',
  allowMajor = false,
  run = runCommand,
  postUpdate = true,
  now = () => new Date().toISOString(),
} = {}) {
  const check = await checkForUpdate({ repoRoot, channel, run, now });
  const report = { ...check, action: 'apply' };
  if (check.status !== 'update_available') return report;

  const current = parseSemver(check.current_version);
  const available = parseSemver(check.available_version);
  if (!allowMajor && available.major > current.major) {
    return { ...report, ok: false, status: 'blocked', reason: 'major_update_requires_approval' };
  }

  const resolvedRepo = path.resolve(repoRoot);
  try {
    const dirty = await run('git', ['status', '--porcelain'], { cwd: resolvedRepo });
    if (dirty.stdout.trim()) {
      return { ...report, ok: false, status: 'blocked', reason: 'dirty_worktree' };
    }
    const branch = await gitResult(run, resolvedRepo, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
    if (!branch.ok) return { ...report, ok: false, status: 'blocked', reason: 'branch_checkout_required' };

    const fastForward = await gitResult(run, resolvedRepo, ['merge-base', '--is-ancestor', 'HEAD', check.available_ref]);
    if (!fastForward.ok) {
      return { ...report, ok: false, status: 'blocked', reason: 'release_history_diverged' };
    }

    const previousRef = check.current_ref;
    await run('git', ['merge', '--ff-only', check.available_ref], { cwd: resolvedRepo });
    const changed = await run('git', ['diff', '--name-only', `${previousRef}..${check.available_ref}`], { cwd: resolvedRepo });
    const changedFiles = changed.stdout.split(/\r?\n/).map((value) => value.trim()).filter(Boolean);

    if (postUpdate) {
      if (changedFiles.some((file) => file === 'package.json' || file === 'package-lock.json')) {
        await run('npm', ['install'], { cwd: resolvedRepo });
      }
      await run('npm', ['link'], { cwd: resolvedRepo });
      await run(process.execPath, [path.join(resolvedRepo, 'bin/bigbrain.js'), '--help'], { cwd: resolvedRepo });
    }

    return {
      ...report,
      ok: true,
      status: 'updated',
      previous_ref: previousRef,
      current_ref: check.available_ref,
      reason: null,
      changed_files: changedFiles,
      applied_at: now(),
    };
  } catch (error) {
    return { ...report, ok: false, status: 'failed', reason: 'update_apply_failed', error: errorMessage(error) };
  }
}

export function updateExitCode(report) {
  if (report?.status === 'blocked' || report?.status === 'unsupported') return 2;
  if (report?.status === 'failed' || report?.ok === false) return 1;
  return 0;
}

export function renderUpdateText(report) {
  switch (report.status) {
    case 'up_to_date':
      return report.available_version
        ? `BigBrain ${report.current_version} is up to date on the ${report.channel} channel.`
        : `No BigBrain releases are available on the ${report.channel} channel.`;
    case 'update_available':
      return `BigBrain ${report.available_version} is available; this installation is ${report.current_version}.`;
    case 'updated':
      return `BigBrain was updated from ${report.current_version} to ${report.available_version}.`;
    case 'blocked':
      return `BigBrain update paused: ${humanReason(report.reason)}.`;
    case 'unsupported':
      return 'This BigBrain installation is not a source checkout and cannot use the source updater.';
    default:
      return `BigBrain update failed${report.error ? `: ${report.error}` : '.'}`;
  }
}

function normalizeChannel(channel) {
  const normalized = String(channel || '').trim().toLowerCase();
  if (!VALID_CHANNELS.has(normalized)) throw new Error('Update channel must be stable or beta.');
  return normalized;
}

async function readPackageJson(repoRoot) {
  return JSON.parse(await fs.readFile(path.join(repoRoot, 'package.json'), 'utf8'));
}

async function runCommand(command, args, options = {}) {
  return execFileAsync(command, args, {
    ...options,
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  });
}

async function gitResult(run, cwd, args) {
  try {
    const result = await run('git', args, { cwd });
    return { ok: true, stdout: result.stdout || '', stderr: result.stderr || '' };
  } catch (error) {
    return { ok: false, stdout: error?.stdout || '', stderr: error?.stderr || '' };
  }
}

function parseSemver(value) {
  const match = String(value || '').trim().match(/^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/);
  if (!match) return null;
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    prerelease: match[4] ? match[4].split('.') : [],
  };
}

function formatSemver(value) {
  const core = `${value.major}.${value.minor}.${value.patch}`;
  return value.prerelease.length ? `${core}-${value.prerelease.join('.')}` : core;
}

function compareSemver(left, right) {
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] > right[key] ? 1 : -1;
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0;
  if (left.prerelease.length === 0) return 1;
  if (right.prerelease.length === 0) return -1;
  const length = Math.max(left.prerelease.length, right.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const a = left.prerelease[index];
    const b = right.prerelease[index];
    if (a === undefined) return -1;
    if (b === undefined) return 1;
    if (a === b) continue;
    const aNumber = /^\d+$/.test(a) ? Number(a) : null;
    const bNumber = /^\d+$/.test(b) ? Number(b) : null;
    if (aNumber !== null && bNumber !== null) return aNumber > bNumber ? 1 : -1;
    if (aNumber !== null) return -1;
    if (bNumber !== null) return 1;
    return a > b ? 1 : -1;
  }
  return 0;
}

function humanReason(reason) {
  return ({
    dirty_worktree: 'the source checkout has uncommitted work',
    branch_checkout_required: 'the source checkout is not on a branch',
    release_history_diverged: 'local commits do not fast-forward to the release',
    tracked_upstream_required: 'the current branch has no tracked upstream',
    major_update_requires_approval: 'major releases require --allow-major',
  })[reason] || String(reason || 'manual attention is required').replaceAll('_', ' ');
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
