import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { loadConfig, loadState, defaultConfigPath, defaultStatePath } from './config.js';
import { resolveWindow } from './time.js';
import { listRecentFiles } from './recent.js';

const RELEVANT_CATEGORIES = new Set([
  'meetings',
  'projects',
  'companies',
  'people',
  'deals',
  'concepts',
  'inbox',
]);

export async function runTaskRefresh({
  configPath = defaultConfigPath(),
  statePath = defaultStatePath(configPath),
  dryRun = false,
  now = new Date(),
} = {}) {
  const config = await loadConfig(configPath);
  const state = await loadState(statePath, { allowMissing: true });
  const window = resolveWindow({
    stateLastCheckedAt: state.lastCheckedAt,
    fallbackDuration: config.lookbackFallback,
    now,
  });

  const report = await listRecentFiles(config, window, { now });
  const relevantFiles = report.files.filter((file) => RELEVANT_CATEGORIES.has(file.category));
  const tasksPath = config.tasksFile;
  const tasksOriginal = await readFile(tasksPath, 'utf8');

  const parsedTasks = parseTasksDocument(tasksOriginal);
  const candidateInputs = await Promise.all(
    relevantFiles.map(async (file) => ({
      file,
      candidates: await extractCandidates(file.path, file.relative_path, tasksPath, now),
    })),
  );

  const allCandidates = candidateInputs.flatMap((entry) => entry.candidates);
  const { nextContent, updatedCount, addedCount } = reconcileTasks(parsedTasks, allCandidates, now);

  if (!dryRun && nextContent !== tasksOriginal) {
    await writeFile(tasksPath, nextContent, 'utf8');
  }

  const summary = [
    `${relevantFiles.length} relevant changed file(s)`,
    `${updatedCount} updated task(s)`,
    `${addedCount} new task(s)`,
  ].join(', ');

  if (!dryRun) {
    await persistState(statePath, {
      last_checked_at: report.window_end,
      last_run_status: 'success',
      last_run_summary: summary,
      last_seen_files: report.files.map((file) => file.relative_path),
    });
  }

  return {
    window_start: report.window_start,
    window_end: report.window_end,
    relevant_files: relevantFiles.map((file) => file.relative_path),
    updated_tasks: updatedCount,
    added_tasks: addedCount,
    changed: nextContent !== tasksOriginal,
    summary,
    content: nextContent,
    dry_run: dryRun,
  };
}

async function extractCandidates(fullPath, relativePath, tasksPath, now) {
  const raw = await readFile(fullPath, 'utf8');
  const title = extractTitle(raw, relativePath);
  const relativeLink = toPosixPath(path.relative(path.dirname(tasksPath), fullPath));
  const openThreadBullets = extractOpenThreadBullets(raw);

  return openThreadBullets.map((bullet) => {
    const cleaned = cleanTaskText(bullet);
    return {
      sourcePath: relativePath,
      sourceTitle: title,
      relativeLink,
      text: `${cleaned} [Source: [${title}](${relativeLink}), refreshed ${now.toISOString().slice(0, 10)}]`,
      tokens: buildMatchTokens(title, relativePath, cleaned),
    };
  });
}

function parseTasksDocument(markdown) {
  const lines = markdown.split('\n');
  const sections = new Map();
  const activeBullets = [];

  let currentSection = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const headingMatch = /^##\s+(.*)$/.exec(line);
    if (headingMatch) {
      currentSection = headingMatch[1].trim();
      sections.set(currentSection, { headingIndex: index });
      continue;
    }

    if (currentSection && /^- \[[ xX]\] /.test(line)) {
      activeBullets.push({
        index,
        section: currentSection,
        text: line,
        completed: line.startsWith('- [x]') || line.startsWith('- [X]'),
      });
    }
  }

  return { lines, sections, activeBullets };
}

function reconcileTasks(parsedTasks, candidates, now) {
  const lines = [...parsedTasks.lines];
  const matchedTaskIndexes = new Set();
  let updatedCount = 0;
  let addedCount = 0;

  for (const candidate of candidates) {
    const existing = findMatchingTask(parsedTasks.activeBullets, candidate, matchedTaskIndexes);
    if (existing) {
      const nextLine = `- [ ] ${candidate.text}`;
      if (lines[existing.index] !== nextLine) {
        lines[existing.index] = nextLine;
        updatedCount += 1;
      }
      matchedTaskIndexes.add(existing.index);
      continue;
    }

    if (taskAlreadyExists(lines, candidate.text)) continue;

    const insertIndex = findInsertionIndex(lines, parsedTasks.sections);
    lines.splice(insertIndex, 0, `- [ ] ${candidate.text}`);
    addedCount += 1;
  }

  return {
    nextContent: `${lines.join('\n').replace(/\n+$/, '')}\n`,
    updatedCount,
    addedCount,
  };
}

function findMatchingTask(activeBullets, candidate, matchedTaskIndexes) {
  const candidatePathHint = candidate.relativeLink;
  for (const bullet of activeBullets) {
    if (bullet.completed || matchedTaskIndexes.has(bullet.index)) continue;
    if (bullet.text.includes(candidatePathHint)) return bullet;
  }

  let bestMatch = null;
  let bestScore = 0;
  for (const bullet of activeBullets) {
    if (bullet.completed || matchedTaskIndexes.has(bullet.index)) continue;
    const score = matchScore(bullet.text, candidate.tokens);
    if (score > bestScore) {
      bestScore = score;
      bestMatch = bullet;
    }
  }

  return bestScore >= 2 ? bestMatch : null;
}

function matchScore(text, tokens) {
  const haystack = normalizeForTokens(text);
  let score = 0;
  for (const token of tokens) {
    if (token.length < 4) continue;
    if (haystack.includes(token)) score += 1;
  }
  return score;
}

function taskAlreadyExists(lines, candidateText) {
  return lines.some((line) => line.includes(candidateText));
}

function findInsertionIndex(lines, sections) {
  const p2 = sections.get('P2 — This Week');
  const p3 = sections.get('P3 — Backlog');
  if (p3) return p3.headingIndex + 1;
  if (p2) {
    let index = p2.headingIndex + 1;
    while (index < lines.length && !lines[index].startsWith('## ')) index += 1;
    return index;
  }
  return lines.length;
}

function extractTitle(markdown, relativePath) {
  const frontmatterTitle = /^title:\s*(.+)$/m.exec(markdown);
  if (frontmatterTitle) return frontmatterTitle[1].trim().replace(/^['"]|['"]$/g, '');
  const heading = /^#\s+(.+)$/m.exec(markdown);
  if (heading) return heading[1].trim();
  const basename = path.basename(relativePath, path.extname(relativePath));
  return basename.replace(/-/g, ' ');
}

function extractOpenThreadBullets(markdown) {
  const lines = markdown.split('\n');
  const bullets = [];
  let inOpenThreads = false;

  for (const line of lines) {
    if (/^##\s+Open Threads\b/i.test(line.trim())) {
      inOpenThreads = true;
      continue;
    }
    if (inOpenThreads && /^##\s+/.test(line.trim())) break;
    if (inOpenThreads && /^- /.test(line.trim())) {
      bullets.push(line.trim().replace(/^- /, ''));
    }
  }

  return bullets;
}

function cleanTaskText(text) {
  return text
    .replace(/^\[[ xX]\]\s*/, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function buildMatchTokens(title, relativePath, candidateText) {
  return Array.from(new Set([
    ...tokenize(title),
    ...tokenize(relativePath),
    ...tokenize(candidateText),
  ]));
}

function tokenize(value) {
  return normalizeForTokens(value)
    .split(' ')
    .map((token) => token.trim())
    .filter(Boolean);
}

function normalizeForTokens(value) {
  return value
    .toLowerCase()
    .replace(/[`_*()[\]{}:,.!?/\\-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

async function persistState(statePath, nextState) {
  await writeFile(statePath, `${JSON.stringify(nextState, null, 2)}\n`, 'utf8');
}

function toPosixPath(value) {
  return value.split(path.sep).join('/');
}
