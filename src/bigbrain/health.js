import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { openDatabase, clearHealthFindings, getBacklinks, getOutgoingLinks, insertHealthFinding, listHealthFindings, listPages } from './db.js';
import { fullPathFromSlug, parseMarkdownPage } from './markdown.js';
import { validatePageShape } from './schema.js';

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
  clearHealthFindings(db);
  const pages = listPages(db);

  for (const page of pages) {
    const fullPath = fullPathFromSlug(config.brainDir, page.slug);
    const raw = await fs.readFile(fullPath, 'utf8').catch(() => null);
    if (!raw) {
      insertHealthFinding(db, {
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
      insertHealthFinding(db, {
        findingType: finding.type,
        severity: severityForFinding(finding.type),
        pageSlug: page.slug,
        details: finding.details ?? {},
      });
    }

    for (const link of getOutgoingLinks(db, page.slug)) {
      const targetPath = link.link_kind === 'asset'
        ? path.join(config.brainDir, link.to_slug)
        : fullPathFromSlug(config.brainDir, link.to_slug);
      const exists = await fs.stat(targetPath)
        .then((stats) => (link.link_kind === 'asset' ? stats.isFile() : true))
        .catch(() => false);
      if (!exists) {
        insertHealthFinding(db, {
          findingType: 'unresolved_link',
          severity: 'medium',
          pageSlug: page.slug,
          details: { target_slug: link.to_slug, link_kind: link.link_kind },
        });
      }
    }
  }

  const gitStatus = await detectGitStatus(config.brainDir);
  if (gitStatus) {
    insertHealthFinding(db, {
      findingType: 'git_status',
      severity: gitStatus.clean ? 'low' : 'medium',
      details: gitStatus,
    });
  }

  const cliStatus = await detectCliAvailability({ env, command: cliCommand, cwd: cliCwd });
  if (!cliStatus.available) {
    insertHealthFinding(db, {
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
    insertHealthFinding(db, {
      findingType: 'automation_template_mismatch',
      severity: check.status === 'missing_active' || check.status === 'missing_template' ? 'high' : 'medium',
      details: check,
    });
  }

  const skillTemplateStatus = await detectSkillTemplateStatus({
    templateDir: skillTemplateDir,
    activeDir: skillActiveDir ?? await resolveActiveSkillsDir(env, skillTemplateDir),
    env,
  });
  for (const check of skillTemplateStatus.checks) {
    if (check.status === 'match') continue;
    insertHealthFinding(db, {
      findingType: 'skill_template_mismatch',
      severity: check.status === 'missing_active' || check.status === 'missing_active_dir' ? 'high' : 'medium',
      details: check,
    });
  }

  const findings = listHealthFindings(db).map((row) => ({
    finding_type: row.finding_type,
    severity: row.severity,
    page_slug: row.page_slug,
    details: JSON.parse(row.details_json),
    created_at: row.created_at,
  }));

  return {
    page_count: pages.length,
    backlink_coverage: pages.filter((page) => getBacklinks(db, page.slug).length > 0).length,
    finding_count: findings.length,
    findings,
    git_status: gitStatus,
    cli_status: cliStatus,
    automation_template_status: automationTemplateStatus,
    skill_template_status: skillTemplateStatus,
  };
}

function severityForFinding(findingType) {
  if (findingType === 'missing_frontmatter' || findingType === 'missing_separator') return 'medium';
  if (findingType === 'missing_meeting_heading' || findingType === 'invalid_meeting_prep_heading' || findingType === 'invalid_meeting_prep_structure') return 'medium';
  return 'low';
}

async function detectGitStatus(brainDir) {
  try {
    const { stdout } = await execFileAsync('git', ['-C', brainDir, 'status', '--short', '--branch']);
    const lines = stdout.trim().split('\n').filter(Boolean);
    return {
      clean: lines.length <= 1,
      summary: lines,
    };
  } catch {
    return null;
  }
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
