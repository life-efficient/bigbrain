import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { openDatabase, clearHealthFindings, getBacklinks, getOutgoingLinks, insertHealthFinding, listHealthFindings, listPages } from './db.js';
import { fullPathFromSlug, parseMarkdownPage } from './markdown.js';
import { validatePageShape } from './schema.js';

const execFileAsync = promisify(execFile);

export async function runHealthCheck(config) {
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
      insertHealthFinding(db, {
        findingType: issue,
        severity: issue === 'missing_frontmatter' || issue === 'missing_separator' ? 'medium' : 'low',
        pageSlug: page.slug,
      });
    }

    for (const link of getOutgoingLinks(db, page.slug)) {
      const targetPath = fullPathFromSlug(config.brainDir, link.to_slug);
      const exists = await fs.stat(targetPath).then(() => true).catch(() => false);
      if (!exists) {
        insertHealthFinding(db, {
          findingType: 'unresolved_link',
          severity: 'medium',
          pageSlug: page.slug,
          details: { target_slug: link.to_slug },
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
  };
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
