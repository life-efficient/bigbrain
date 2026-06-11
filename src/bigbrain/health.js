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
const AUTOMATION_TEMPLATE_DIR = path.join(REPO_ROOT, 'templates', 'automations');

export async function runHealthCheck(config, {
  env = process.env,
  cliCommand = 'bigbrain',
  cliCwd = os.tmpdir(),
  automationTemplateDir = AUTOMATION_TEMPLATE_DIR,
  automationActiveDir = defaultAutomationActiveDir(env),
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
    .filter((line) => !/^(created_at|updated_at)\s*=/.test(line))
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}
