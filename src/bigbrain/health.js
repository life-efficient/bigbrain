import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { openDatabase, clearHealthFindings, getBacklinks, getOutgoingLinks, insertHealthFinding, listHealthFindings, listPages, upsertHostedBrainGitState } from './db.js';
import { fullPathFromSlug, parseMarkdownPage } from './markdown.js';
import { safeBrainPath } from './page-ops.js';
import { isAttachmentSidecarSlug, validatePageShape } from './schema.js';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AUTOMATION_TEMPLATE_DIR = path.join(REPO_ROOT, 'automations');
const SKILL_TEMPLATE_DIR = path.join(REPO_ROOT, 'skills');

export async function runHealthCheck(config, {
  env = process.env,
  cliCommand = 'bigbrain',
  cliCwd = os.tmpdir(),
  automationTemplateDir = AUTOMATION_TEMPLATE_DIR,
  automationActiveDir = defaultAutomationActiveDir(env),
  skillTemplateDir = SKILL_TEMPLATE_DIR,
  skillActiveDir = null,
} = {}) {
  const db = await openDatabase(config);
  await clearHealthFindings(db);
  const pages = await listPages(db);

  for (const page of pages) {
    const fullPath = fullPathFromSlug(config.brainDir, page.slug);
    const raw = await fs.readFile(fullPath, 'utf8').catch(() => null);
    if (!raw) {
      await insertHealthFinding(db, {
        findingType: 'missing_page_file',
        severity: 'high',
        pageSlug: page.slug,
        details: { path: fullPath },
      });
      continue;
    }

    const parsed = parseMarkdownPage(raw, page.slug);
    for (const issue of validatePageShape(parsed)) {
      const finding = typeof issue === 'string' ? { type: issue } : issue;
      await insertHealthFinding(db, {
        findingType: finding.type,
        severity: severityForFinding(finding.type),
        pageSlug: page.slug,
        details: finding.details ?? {},
      });
    }

    for (const issue of await validateAttachmentSidecarBinding(config, parsed)) {
      await insertHealthFinding(db, {
        findingType: issue.type,
        severity: severityForFinding(issue.type),
        pageSlug: page.slug,
        details: issue.details ?? {},
      });
    }

    const rawSidecar = detectPossibleMisplacedRawSidecar(parsed);
    if (rawSidecar) {
      await insertHealthFinding(db, {
        findingType: 'possible_misplaced_raw_sidecar',
        severity: 'low',
        pageSlug: page.slug,
        details: rawSidecar,
      });
    }

    for (const link of await getOutgoingLinks(db, page.slug)) {
      const targetPath = link.link_kind === 'asset'
        ? path.join(config.brainDir, link.to_slug)
        : fullPathFromSlug(config.brainDir, link.to_slug);
      const exists = await fs.stat(targetPath)
        .then((stats) => (link.link_kind === 'asset' ? stats.isFile() : true))
        .catch(() => false);
      if (!exists) {
        await insertHealthFinding(db, {
          findingType: 'unresolved_link',
          severity: 'medium',
          pageSlug: page.slug,
          details: { target_slug: link.to_slug, link_kind: link.link_kind },
        });
      }
    }
  }

  for (const rawPath of await detectNestedRawFiles(config.brainDir)) {
    await insertHealthFinding(db, {
      findingType: 'nested_raw_file_path',
      severity: 'medium',
      details: {
        path: rawPath,
        expected_shape: '<collection>/.raw/<filename>',
      },
    });
  }

  const filingRuleStatus = await detectFilingRuleStatus(config.brainDir);
  for (const missing of filingRuleStatus.missing) {
    await insertHealthFinding(db, {
      findingType: 'missing_filing_rules',
      severity: 'medium',
      details: missing,
    });
  }

  const gitStatus = await detectGitStatus(config.brainDir);
  if (gitStatus) {
    await upsertHostedBrainGitState(db, hostedBrainGitStateFromStatus(config, gitStatus));
    if (gitStatus.needs_attention || ['no_repository', 'no_upstream'].includes(gitStatus.sync_status)) {
      await insertHealthFinding(db, {
        findingType: 'git_status',
        severity: ['no_repository', 'no_upstream'].includes(gitStatus.sync_status) ? 'low' : 'medium',
        details: gitStatus,
      });
    }
  }

  const cliStatus = await detectCliAvailability({ env, command: cliCommand, cwd: cliCwd });
  if (!cliStatus.available) {
    await insertHealthFinding(db, {
      findingType: 'cli_not_available_globally',
      severity: 'high',
      details: {
        command: cliStatus.command,
        cwd: cliStatus.cwd,
        message: cliStatus.message,
      },
    });
  }

  const automationTemplateStatus = await detectAutomationTemplateStatus({
    templateDir: automationTemplateDir,
    activeDir: automationActiveDir,
  });
  for (const check of automationTemplateStatus.checks) {
    if (check.status === 'match') continue;
    await insertHealthFinding(db, {
      findingType: 'automation_template_mismatch',
      severity: check.status === 'missing_active' || check.status === 'missing_template' ? 'high' : 'medium',
      details: check,
    });
  }

  const automationConflictStatus = await detectAutomationConflictStatus({
    templateDir: automationTemplateDir,
    activeDir: automationActiveDir,
  });
  for (const conflict of automationConflictStatus.conflicts) {
    await insertHealthFinding(db, {
      findingType: 'automation_conflict',
      severity: 'high',
      details: conflict,
    });
  }

  const skillTemplateStatus = await detectSkillTemplateStatus({
    templateDir: skillTemplateDir,
    activeDir: skillActiveDir ?? await resolveActiveSkillsDir(env, skillTemplateDir),
    env,
  });
  for (const check of skillTemplateStatus.checks) {
    if (check.status === 'match') continue;
    await insertHealthFinding(db, {
      findingType: 'skill_template_mismatch',
      severity: check.status === 'missing_active' || check.status === 'missing_active_dir' ? 'high' : 'medium',
      details: check,
    });
  }

  const findings = (await listHealthFindings(db)).map((row) => ({
    finding_type: row.finding_type,
    severity: row.severity,
    page_slug: row.page_slug,
    details: JSON.parse(row.details_json),
    created_at: row.created_at,
  }));

  return {
    page_count: pages.length,
    backlink_coverage: (await Promise.all(pages.map((page) => getBacklinks(db, page.slug)))).filter((rows) => rows.length > 0).length,
    finding_count: findings.length,
    findings,
    git_status: gitStatus,
    filing_rules_status: filingRuleStatus,
    cli_status: cliStatus,
    automation_template_status: automationTemplateStatus,
    automation_conflict_status: automationConflictStatus,
    skill_template_status: skillTemplateStatus,
  };
}

function severityForFinding(findingType) {
  if (findingType === 'missing_frontmatter' || findingType === 'missing_separator') return 'medium';
  if (findingType === 'missing_meeting_heading' || findingType === 'invalid_meeting_prep_heading' || findingType === 'invalid_meeting_prep_structure') return 'medium';
  if (findingType === 'attachment_sidecar_missing_raw_file' || findingType === 'attachment_sidecar_mismatched_raw_file' || findingType === 'attachment_sidecar_missing_raw_artifact') return 'medium';
  if (findingType === 'nested_raw_file_path') return 'medium';
  if (findingType === 'missing_filing_rules') return 'medium';
  return 'low';
}

async function validateAttachmentSidecarBinding(config, parsed) {
  if (!isAttachmentSidecarSlug(parsed.slug)) return [];
  const rawFile = typeof parsed.frontmatter?.raw_file === 'string' ? parsed.frontmatter.raw_file.trim() : '';
  const expectedRawBase = expectedRawBaseForSidecar(parsed.slug);
  if (!rawFile) {
    if (!await sameBasenameRawArtifactExists(config, expectedRawBase)) return [];
    return [{
      type: 'attachment_sidecar_missing_raw_file',
      details: {
        expected_raw_file_prefix: expectedRawBase,
        reason: 'attachment sidecars should declare the same-basename raw_file when they are bound to a raw artifact',
      },
    }];
  }
  const findings = [];
  if (!rawFile.startsWith(`${expectedRawBase}.`) || rawFile.endsWith('.md')) {
    findings.push({
      type: 'attachment_sidecar_mismatched_raw_file',
      details: {
        raw_file: rawFile,
        expected_shape: `${expectedRawBase}.<non-md-extension>`,
      },
    });
  }
  const exists = await Promise.resolve()
    .then(() => safeBrainPath(config.brainDir, rawFile))
    .then((artifactPath) => fs.stat(artifactPath))
    .then((stats) => stats.isFile())
    .catch(() => false);
  if (!exists) {
    findings.push({
      type: 'attachment_sidecar_missing_raw_artifact',
      details: {
        raw_file: rawFile,
      },
    });
  }
  return findings;
}

async function sameBasenameRawArtifactExists(config, expectedRawBase) {
  const dir = path.dirname(path.join(config.brainDir, expectedRawBase));
  const basename = path.basename(expectedRawBase);
  const entries = await fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  return entries.some((entry) => {
    if (!entry.isFile()) return false;
    if (entry.name === `${basename}.md`) return false;
    return entry.name.startsWith(`${basename}.`);
  });
}

function expectedRawBaseForSidecar(slug) {
  return String(slug || '');
}

function detectPossibleMisplacedRawSidecar(parsed) {
  const rawFile = typeof parsed.frontmatter?.raw_file === 'string' ? parsed.frontmatter.raw_file.trim() : '';
  if (!rawFile || !rawFile.split('/').includes('.raw')) return null;
  if (parsed.slug.split('/').includes('.raw')) return null;
  if (!looksMetadataOnlyRawPage(parsed)) return null;

  const rawCollection = rawFile.split('/')[0] || null;
  const pageCollection = parsed.slug.split('/')[0] || null;
  const expectedSidecarPath = rawCollection && rawFile.includes('/')
    ? `${path.posix.dirname(rawFile)}/${path.posix.basename(parsed.slug)}.md`
    : null;
  return {
    raw_file: rawFile,
    current_path: `${parsed.slug}.md`,
    expected_sidecar_path: expectedSidecarPath,
    page_collection: pageCollection,
    raw_collection: rawCollection,
    reason: 'raw-file metadata page appears to be sidecar-only; canonical pages with substantive summaries, related links, or timelines are not flagged',
  };
}

function looksMetadataOnlyRawPage(parsed) {
  if (parsed.hasSeparator || /(^|\n)##\s+Timeline\b/i.test(parsed.bodyContentMarkdown)) return false;
  const markdown = parsed.bodyContentMarkdown.replace(/\r\n/g, '\n');
  const headings = [...markdown.matchAll(/^##\s+(.+)$/gm)]
    .map((match) => match[1].trim().toLowerCase());
  const substantiveHeadings = headings.filter((heading) => !['source file', 'artifact', 'raw file'].includes(heading));
  if (substantiveHeadings.some((heading) => [
    'summary',
    'current state',
    'current decision',
    'review notes',
    'related pages',
    'key facts',
    'intended use',
    'use in brain',
    'source notes',
  ].includes(heading))) return false;

  const stripped = markdown
    .replace(/^#\s+.+$/gm, '')
    .replace(/^##\s+(source file|artifact|raw file)\s*$/gim, '')
    .replace(/-\s+\[[^\]]+\]\([^)]+\)/g, '')
    .replace(/`[^`]+`/g, '')
    .replace(/\[[^\]]+\]\([^)]+\)/g, '')
    .replace(/[^\w]+/g, ' ')
    .trim();
  const wordCount = stripped ? stripped.split(/\s+/).length : 0;
  return wordCount <= 30;
}

async function detectFilingRuleStatus(brainDir) {
  const folders = await listBrainFoldersRequiringFilingRules(brainDir);
  const missing = [];
  for (const folder of folders) {
    const filingPath = folder === '.' ? 'FILING.md' : `${folder}/FILING.md`;
    const exists = await fs.stat(path.join(brainDir, filingPath))
      .then((stats) => stats.isFile())
      .catch((error) => {
        if (error?.code === 'ENOENT') return false;
        throw error;
      });
    if (!exists) {
      missing.push({
        folder,
        expected_path: filingPath,
      });
    }
  }
  return {
    checked_count: folders.length,
    missing_count: missing.length,
    missing,
  };
}

async function listBrainFoldersRequiringFilingRules(brainDir) {
  const folders = ['.'];
  await walkBrainFoldersForFilingRules(brainDir, brainDir, folders);
  folders.sort((left, right) => {
    if (left === '.') return -1;
    if (right === '.') return 1;
    return left.localeCompare(right);
  });
  return folders;
}

async function walkBrainFoldersForFilingRules(root, current, folders) {
  const dirents = await fs.readdir(current, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const dirent of dirents) {
    if (!dirent.isDirectory()) continue;
    const fullPath = path.join(current, dirent.name);
    const relative = path.relative(root, fullPath).split(path.sep).join('/');
    if (shouldSkipFolderForFilingRules(relative)) continue;
    folders.push(relative);
    await walkBrainFoldersForFilingRules(root, fullPath, folders);
  }
}

function shouldSkipFolderForFilingRules(relativePath) {
  if (!relativePath) return false;
  const segments = relativePath.split('/');
  if (segments.some((segment) => segment.startsWith('.'))) return true;
  return segments.includes('node_modules');
}

async function detectNestedRawFiles(brainDir) {
  const nested = [];
  await walkForNestedRawFiles(brainDir, brainDir, nested);
  nested.sort();
  return nested;
}

async function walkForNestedRawFiles(root, current, nested) {
  const dirents = await fs.readdir(current, { withFileTypes: true }).catch((error) => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  for (const dirent of dirents) {
    if (dirent.name === '.git' || dirent.name === '.bigbrain' || dirent.name === '.bigbrain-state' || dirent.name === 'node_modules') continue;
    const fullPath = path.join(current, dirent.name);
    const relative = path.relative(root, fullPath).split(path.sep).join('/');
    if (dirent.isDirectory()) {
      await walkForNestedRawFiles(root, fullPath, nested);
      continue;
    }
    const parts = relative.split('/');
    const rawIndex = parts.indexOf('.raw');
    if (rawIndex >= 0 && parts.length - rawIndex > 2) nested.push(relative);
  }
}

async function detectGitStatus(brainDir) {
  const checkedAt = new Date().toISOString();
  try {
    await execFileAsync('git', ['-C', brainDir, 'rev-parse', '--is-inside-work-tree']);
    const [statusResult, branchResult, headResult, upstreamResult] = await Promise.all([
      execFileAsync('git', ['-C', brainDir, 'status', '--short', '--branch']),
      execFileAsync('git', ['-C', brainDir, 'rev-parse', '--abbrev-ref', 'HEAD']),
      execFileAsync('git', ['-C', brainDir, 'rev-parse', 'HEAD']),
      execFileAsync('git', ['-C', brainDir, 'rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']).catch((error) => ({ error })),
    ]);
    const lines = statusResult.stdout.trim().split('\n')
      .filter(Boolean)
      .filter((line) => line.startsWith('## ') || !isIgnoredGitStatusLine(line));
    const localBranch = branchResult.stdout.trim();
    const localHead = headResult.stdout.trim();
    const dirty = lines.some((line) => !line.startsWith('## '));
    const upstreamRef = upstreamResult.error ? null : upstreamResult.stdout.trim();
    if (!upstreamRef) {
      return decorateGitStatus({
        checked_at: checkedAt,
        clean: !dirty,
        dirty,
        summary: lines,
        runtime_branch: localBranch,
        runtime_head: localHead,
        canonical_remote: null,
        canonical_branch: null,
        canonical_head: null,
        ahead_count: null,
        behind_count: null,
        latest_error_code: 'no_upstream',
        latest_error_summary: 'No tracked upstream branch is configured for this brain checkout.',
      });
    }
    const upstream = parseUpstreamRef(upstreamRef);
    await execFileAsync('git', ['-C', brainDir, 'fetch', '--quiet', upstream.remote])
      .catch(() => null);
    const [upstreamHeadResult, countsResult] = await Promise.all([
      execFileAsync('git', ['-C', brainDir, 'rev-parse', upstreamRef]).catch((error) => ({ error })),
      execFileAsync('git', ['-C', brainDir, 'rev-list', '--left-right', '--count', `HEAD...${upstreamRef}`]).catch((error) => ({ error })),
    ]);
    const canonicalHead = upstreamHeadResult.error ? null : upstreamHeadResult.stdout.trim();
    const [aheadText, behindText] = countsResult.error ? [null, null] : countsResult.stdout.trim().split(/\s+/);
    const latestErrorCode = upstreamHeadResult.error || countsResult.error ? 'git_compare_failed' : null;
    return {
      ...decorateGitStatus({
        checked_at: checkedAt,
        clean: !dirty,
        dirty,
        summary: lines,
        runtime_branch: localBranch,
        runtime_head: localHead,
        canonical_remote: upstream.remote,
        canonical_branch: upstream.branch,
        canonical_head: canonicalHead,
        ahead_count: aheadText === null ? null : Number(aheadText),
        behind_count: behindText === null ? null : Number(behindText),
        latest_error_code: latestErrorCode,
        latest_error_summary: latestErrorCode ? 'Unable to compare the runtime checkout with its tracked upstream.' : null,
      }),
      upstream_ref: upstreamRef,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const stderr = typeof error === 'object' && error && 'stderr' in error ? String(error.stderr) : '';
    const combined = `${message}\n${stderr}`;
    if (/not a git repository/i.test(combined)) {
      return decorateGitStatus({
        checked_at: checkedAt,
        clean: true,
        dirty: false,
        summary: [],
        runtime_branch: null,
        runtime_head: null,
        canonical_remote: null,
        canonical_branch: null,
        canonical_head: null,
        ahead_count: null,
        behind_count: null,
        latest_error_code: 'no_repository',
        latest_error_summary: 'Git backup is not configured for this brain.',
      });
    }
    return decorateGitStatus({
      checked_at: checkedAt,
      clean: false,
      dirty: null,
      summary: [],
      runtime_branch: null,
      runtime_head: null,
      canonical_remote: null,
      canonical_branch: null,
      canonical_head: null,
      ahead_count: null,
      behind_count: null,
      latest_error_code: 'git_status_failed',
      latest_error_summary: combined.trim(),
    });
  }
}

function isIgnoredGitStatusLine(line) {
  const relativePath = line.slice(3).trim().replace(/^"|"$/g, '');
  return relativePath === '.bigbrain-state'
    || relativePath.startsWith('.bigbrain-state/');
}

function parseUpstreamRef(upstreamRef) {
  const separator = upstreamRef.indexOf('/');
  if (separator < 0) return { remote: upstreamRef, branch: null };
  return {
    remote: upstreamRef.slice(0, separator),
    branch: upstreamRef.slice(separator + 1),
  };
}

function decorateGitStatus(status) {
  const ahead = status.ahead_count;
  const behind = status.behind_count;
  let syncStatus = 'unknown';
  if (status.latest_error_code === 'no_repository') syncStatus = 'no_repository';
  else if (status.latest_error_code === 'no_upstream') syncStatus = 'no_upstream';
  else if (status.latest_error_code) syncStatus = 'error';
  else if (status.dirty) syncStatus = 'dirty';
  else if (ahead > 0 && behind > 0) syncStatus = 'diverged';
  else if (ahead > 0) syncStatus = 'ahead';
  else if (behind > 0) syncStatus = 'behind';
  else if (ahead === 0 && behind === 0) syncStatus = 'in_sync';

  const needsAttention = !['in_sync', 'no_repository', 'no_upstream'].includes(syncStatus);
  return {
    ...status,
    clean: status.dirty === null ? false : !status.dirty,
    sync_status: syncStatus,
    health_status: needsAttention ? 'needs_attention' : 'ok',
    needs_attention: needsAttention,
  };
}

function hostedBrainGitStateFromStatus(config, gitStatus) {
  return {
    brainKey: config.brainDir,
    brainDir: config.brainDir,
    canonicalRemote: gitStatus.canonical_remote,
    canonicalBranch: gitStatus.canonical_branch,
    canonicalHead: gitStatus.canonical_head,
    runtimeBranch: gitStatus.runtime_branch,
    runtimeHead: gitStatus.runtime_head,
    dirty: Boolean(gitStatus.dirty),
    aheadCount: gitStatus.ahead_count,
    behindCount: gitStatus.behind_count,
    syncStatus: gitStatus.sync_status,
    healthStatus: gitStatus.health_status,
    needsAttention: gitStatus.needs_attention,
    latestErrorCode: gitStatus.latest_error_code,
    latestErrorSummary: gitStatus.latest_error_summary,
    checkedAt: gitStatus.checked_at,
    details: {
      summary: gitStatus.summary,
      upstream_ref: gitStatus.upstream_ref ?? null,
    },
  };
}

async function detectCliAvailability({ env, command, cwd }) {
  try {
    await execFileAsync(command, ['--help'], { cwd, env, timeout: 5000 });
    return {
      available: true,
      command,
      cwd,
    };
  } catch (error) {
    return {
      available: false,
      command,
      cwd,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

function defaultAutomationActiveDir(env) {
  const codexHome = env.CODEX_HOME || (env.HOME ? path.join(env.HOME, '.codex') : null);
  return codexHome ? path.join(codexHome, 'automations') : null;
}

function candidateActiveSkillsDirs(env) {
  const candidates = [
    env.BIGBRAIN_SKILLS_DIR,
    env.AGENTS_SKILLS_DIR,
    env.CODEX_SKILLS_DIR,
  ];
  if (env.HOME) {
    candidates.push(
      path.join(env.HOME, '.agents', 'skills'),
      path.join(env.HOME, '.codex', 'skills'),
    );
  }
  return [...new Set(candidates.filter(Boolean).map((candidate) => path.resolve(candidate)))];
}

async function resolveActiveSkillsDir(env, skillTemplateDir) {
  const candidates = candidateActiveSkillsDirs(env);
  const scored = [];
  const repoSkills = await listSkillTemplateDirs(skillTemplateDir);
  for (const candidate of candidates) {
    const stats = await fs.stat(candidate).catch(() => null);
    if (!stats?.isDirectory()) continue;
    let score = 1;
    for (const skill of repoSkills) {
      if (await pathExists(path.join(candidate, skill.id))) score += 4;
    }
    if (await pathExists(path.join(candidate, 'RESOLVER.md'))) score += 2;
    scored.push({ path: candidate, score });
  }
  scored.sort((left, right) => right.score - left.score || left.path.localeCompare(right.path));
  return scored[0]?.path ?? null;
}

async function detectSkillTemplateStatus({ templateDir, activeDir }) {
  const skills = await listSkillTemplateDirs(templateDir);
  const checks = [];

  for (const skill of skills) {
    const activePath = activeDir ? path.join(activeDir, skill.id) : null;
    if (!activePath) {
      checks.push({
        id: skill.id,
        status: 'missing_active_dir',
        template_path: skill.path,
        active_path: null,
      });
      continue;
    }

    const activeStats = await fs.stat(activePath).catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (!activeStats?.isDirectory()) {
      checks.push({
        id: skill.id,
        status: 'missing_active',
        template_path: skill.path,
        active_path: activePath,
      });
      continue;
    }

    const templateFiles = await listRelativeFiles(skill.path);
    const activeFiles = await listRelativeFiles(activePath);
    const expected = new Set(templateFiles);
    const actual = new Set(activeFiles);
    const missing = templateFiles.filter((file) => !actual.has(file));
    const extra = activeFiles.filter((file) => !expected.has(file));
    const changed = [];
    for (const relativeFile of templateFiles) {
      if (!actual.has(relativeFile)) continue;
      const [templateRaw, activeRaw] = await Promise.all([
        fs.readFile(path.join(skill.path, relativeFile)),
        fs.readFile(path.join(activePath, relativeFile)),
      ]);
      if (!templateRaw.equals(activeRaw)) changed.push(relativeFile);
    }

    const link = await fs.lstat(activePath)
      .then((stats) => (stats.isSymbolicLink() ? 'symlink' : 'directory'))
      .catch(() => 'unknown');
    checks.push({
      id: skill.id,
      status: missing.length || extra.length || changed.length ? 'mismatch' : 'match',
      template_path: skill.path,
      active_path: activePath,
      install_type: link,
      missing,
      extra,
      changed,
    });
  }

  return {
    template_dir: templateDir,
    active_dir: activeDir,
    checked_count: checks.length,
    mismatch_count: checks.filter((check) => check.status !== 'match').length,
    checks,
  };
}

async function listSkillTemplateDirs(templateDir) {
  let entries;
  try {
    entries = await fs.readdir(templateDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
  const skills = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillPath = path.join(templateDir, entry.name);
    if (await pathExists(path.join(skillPath, 'SKILL.md'))) {
      skills.push({ id: entry.name, path: skillPath });
    }
  }
  return skills;
}

async function listRelativeFiles(rootDir) {
  const files = [];
  async function visit(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile()) {
        files.push(path.relative(rootDir, fullPath));
      }
    }
  }
  await visit(rootDir);
  return files.sort();
}

async function pathExists(candidatePath) {
  return fs.access(candidatePath).then(() => true).catch(() => false);
}

async function detectAutomationTemplateStatus({ templateDir, activeDir }) {
  const templateFiles = await listAutomationTemplateFiles(templateDir);
  const checks = [];

  for (const template of templateFiles) {
    if (template.missing) {
      checks.push({
        id: template.id,
        status: 'missing_template',
        template_path: template.path,
        active_path: activeDir ? path.join(activeDir, template.id, 'automation.toml') : null,
      });
      continue;
    }

    const activePath = activeDir ? path.join(activeDir, template.id, 'automation.toml') : null;
    if (!activePath) {
      checks.push({
        id: template.id,
        status: 'missing_active_dir',
        template_path: template.path,
        active_path: null,
      });
      continue;
    }

    const activeRaw = await fs.readFile(activePath, 'utf8').catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (activeRaw === null) {
      checks.push({
        id: template.id,
        status: 'missing_active',
        template_path: template.path,
        active_path: activePath,
      });
      continue;
    }

    const templateComparable = comparableAutomationToml(template.raw);
    const activeComparable = comparableAutomationToml(activeRaw);
    checks.push({
      id: template.id,
      status: templateComparable === activeComparable ? 'match' : 'mismatch',
      template_path: template.path,
      active_path: activePath,
    });
  }

  return {
    template_dir: templateDir,
    active_dir: activeDir,
    checked_count: checks.length,
    mismatch_count: checks.filter((check) => check.status !== 'match').length,
    checks,
  };
}

async function detectAutomationConflictStatus({ templateDir, activeDir }) {
  const retiredPath = path.join(templateDir, 'retired.json');
  const retiredIds = await fs.readFile(retiredPath, 'utf8')
    .then((raw) => JSON.parse(raw)?.automation_ids ?? [])
    .catch((error) => {
      if (error?.code === 'ENOENT') return [];
      throw error;
    });
  const entries = activeDir
    ? await fs.readdir(activeDir, { withFileTypes: true }).catch((error) => {
      if (error?.code === 'ENOENT') return [];
      throw error;
    })
    : [];
  const installed = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const filePath = path.join(activeDir, entry.name, 'automation.toml');
    const raw = await fs.readFile(filePath, 'utf8').catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (raw === null) continue;
    installed.push({
      directory: entry.name,
      path: filePath,
      id: automationTomlString(raw, 'id') ?? entry.name,
      name: automationTomlString(raw, 'name') ?? '',
      prompt: automationTomlString(raw, 'prompt') ?? '',
      status: (automationTomlString(raw, 'status') ?? '').toUpperCase(),
    });
  }

  const activeGranolaWriters = installed.filter((automation) => (
    automation.status === 'ACTIVE'
    && /granola/i.test(`${automation.id} ${automation.name}`)
    && /(ingest|route|review|write)/i.test(`${automation.id} ${automation.name}`)
  ));
  const conflicts = [];
  if (activeGranolaWriters.length > 1) {
    conflicts.push({
      type: 'multiple_active_granola_writers',
      count: activeGranolaWriters.length,
      automations: activeGranolaWriters.map(publicAutomationRef),
    });
  }

  for (const automation of installed) {
    if (automation.status === 'ACTIVE' && retiredIds.includes(automation.id)) {
      conflicts.push({
        type: 'retired_automation_active',
        automation: publicAutomationRef(automation),
      });
    }
    if (/\.before-|\.backup-|\.bak$/i.test(automation.directory) && automation.status === 'ACTIVE') {
      conflicts.push({
        type: 'active_backup_in_live_automation_root',
        automation: publicAutomationRef(automation),
      });
    }
  }

  const byId = new Map();
  for (const automation of installed) {
    if (!byId.has(automation.id)) byId.set(automation.id, []);
    byId.get(automation.id).push(automation);
  }
  for (const [id, matches] of byId) {
    if (matches.length < 2) continue;
    conflicts.push({
      type: 'duplicate_automation_id',
      id,
      automations: matches.map(publicAutomationRef),
    });
  }

  return {
    active_dir: activeDir,
    installed_count: installed.length,
    active_granola_writer_count: activeGranolaWriters.length,
    active_granola_writers: activeGranolaWriters.map(publicAutomationRef),
    retired_automation_ids: [...retiredIds].sort(),
    conflict_count: conflicts.length,
    conflicts,
  };
}

function automationTomlString(raw, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = String(raw).match(new RegExp(`^${escaped}\\s*=\\s*"((?:\\\\.|[^"\\\\])*)"`, 'm'));
  if (!match) return null;
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return match[1];
  }
}

function publicAutomationRef(automation) {
  return {
    directory: automation.directory,
    id: automation.id,
    name: automation.name,
    status: automation.status,
  };
}

async function listAutomationTemplateFiles(templateDir) {
  let entries;
  try {
    entries = await fs.readdir(templateDir, { withFileTypes: true });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    return [];
  }

  const files = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const templatePath = path.join(templateDir, entry.name, 'automation.toml');
    const raw = await fs.readFile(templatePath, 'utf8').catch((error) => {
      if (error?.code === 'ENOENT') return null;
      throw error;
    });
    if (raw === null) {
      files.push({ id: entry.name, path: templatePath, raw: null, missing: true });
      continue;
    }
    files.push({ id: entry.name, path: templatePath, raw });
  }
  return files;
}

function comparableAutomationToml(raw) {
  if (raw === null) return null;
  return raw
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter((line) => !/^(created_at|updated_at|cwds)\s*=/.test(line))
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}
