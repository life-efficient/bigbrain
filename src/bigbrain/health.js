import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

import { openDatabase, clearHealthFindings, getBacklinks, getOutgoingLinks, insertHealthFinding, listHealthFindings, listPages, upsertHostedBrainGitState } from './db.js';
import { fullPathFromSlug, parseMarkdownPage, replaceTimelineSection } from './markdown.js';
import { safeBrainPath } from './page-ops.js';
import { isAttachmentSidecarSlug, validatePageShape } from './schema.js';
import { normalizeSourceType, parseMutationMetadata, SOURCE_TYPE_DEFINITIONS } from './source-taxonomy.js';
import { EventInboxStore, EventRegistryStore, defaultEventInboxPath, defaultEventRegistryPath } from './inbound-events.js';
import { runtimeMetadata } from './runtime-metadata.js';
import { appendTimelineEntries, renderTimelineBlock } from './timeline.js';

const execFileAsync = promisify(execFile);
const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const AUTOMATION_TEMPLATE_DIR = path.join(REPO_ROOT, 'automations');
const SKILL_TEMPLATE_DIR = path.join(REPO_ROOT, 'skills');

export async function runHealthCheck(config, {
  env = process.env,
  cliCommand = 'bigbrain',
  cliCwd = os.tmpdir(),
  repairUnknownSource = false,
  automationTemplateDir = AUTOMATION_TEMPLATE_DIR,
  automationActiveDir = defaultAutomationActiveDir(env),
  skillTemplateDir = SKILL_TEMPLATE_DIR,
  skillActiveDir = null,
} = {}) {
  const db = await openDatabase(config);
  await clearHealthFindings(db);
  const pages = await listPages(db, { includeTimeline: true });
  const pageAttributions = new Map();
  const provenanceStatus = createProvenanceStatus(pages.length);

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

    let parsed = parseMarkdownPage(raw, page.slug);
    let attribution = sourceAttributionForPage(parsed, null, { skipAttachment: true });
    if (!attribution.ok && repairUnknownSource && !attribution.skipped) {
      const repaired = repairUnknownSourceAttribution(raw, page.slug, parsed);
      if (repaired !== raw) {
        await fs.writeFile(fullPath, repaired, 'utf8');
        provenanceStatus.repaired_unknown_count += 1;
        parsed = parseMarkdownPage(repaired, page.slug);
        attribution = sourceAttributionForPage(parsed, null, { skipAttachment: true });
      }
    }
    pageAttributions.set(page.slug, { parsed, provenance: null, attribution });
    if (attribution.skipped) {
      provenanceStatus.pages_skipped += 1;
    } else if (!attribution.ok) {
      provenanceStatus.pages_missing_source_attribution += 1;
      await insertSourceAttributionFinding(db, {
        scope: 'page',
        pageSlug: page.slug,
        path: fullPath,
        attribution,
      });
    } else {
      provenanceStatus.pages_with_source_attribution += 1;
    }
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

  let gitProvenance = await detectGitBackedSourceAttribution(config.brainDir, pageAttributions, gitStatus);
  if (repairUnknownSource && gitProvenance.missing.length) {
    const remaining = [];
    for (const change of gitProvenance.missing) {
      if (!change.source_path.endsWith('.md')) {
        remaining.push(change);
        continue;
      }
      const fullPath = path.join(config.brainDir, change.source_path);
      const raw = await fs.readFile(fullPath, 'utf8').catch(() => null);
      if (raw === null) {
        remaining.push(change);
        continue;
      }
      const repaired = repairUnknownSourceAttribution(raw, change.page_slug);
      if (repaired === raw) {
        remaining.push(change);
        continue;
      }
      await fs.writeFile(fullPath, repaired, 'utf8');
      provenanceStatus.repaired_unknown_count += 1;
      const reparsed = parseMarkdownPage(repaired, change.page_slug);
      pageAttributions.set(change.page_slug, { parsed: reparsed, provenance: null, attribution: sourceAttributionForPage(reparsed, null, { skipAttachment: true }) });
    }
    gitProvenance = { checked_count: gitProvenance.checked_count, missing_count: remaining.length, missing: remaining };
  }
  provenanceStatus.git_backed_change_count = gitProvenance.checked_count;
  provenanceStatus.git_backed_changes_missing_source_attribution = gitProvenance.missing_count;
  for (const change of gitProvenance.missing) {
    await insertSourceAttributionFinding(db, {
      scope: 'git_change',
      pageSlug: change.page_slug,
      path: change.path,
      attribution: change.attribution,
      details: {
        change_status: change.change_status,
        source_path: change.source_path,
      },
    });
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

  const eventStatus = await readEventRuntimeHealth(config);
  if (eventStatus?.attention?.length) {
    for (const event of eventStatus.attention) {
      await insertHealthFinding(db, {
        findingType: event.state === 'quarantined' ? 'inbound_event_quarantined' : 'inbound_event_failed',
        severity: event.state === 'quarantined' ? 'medium' : 'high',
        details: event,
      });
    }
  }

  const findings = (await listHealthFindings(db)).map((row) => ({
    finding_type: row.finding_type,
    severity: row.severity,
    page_slug: row.page_slug,
    details: JSON.parse(row.details_json),
    created_at: row.created_at,
  }));

  return {
    runtime: runtimeMetadata(env),
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
    event_status: eventStatus,
    provenance_status: provenanceStatus,
  };
}

async function readEventRuntimeHealth(config) {
  const registryPath = config?.eventRegistryPath || defaultEventRegistryPath();
  const inboxPath = config?.eventInboxPath || defaultEventInboxPath();
  const [registryExists, inboxExists] = await Promise.all([
    fs.stat(registryPath).then(() => true).catch(() => false),
    fs.stat(inboxPath).then(() => true).catch(() => false),
  ]);
  if (!registryExists && !inboxExists) return null;
  const registry = await new EventRegistryStore({ filePath: registryPath }).get();
  const inbox = await new EventInboxStore({ filePath: inboxPath }).get();
  const deliveries = Object.values(inbox.deliveries);
  const counts = deliveries.reduce((value, event) => { value[event.state] = (value[event.state] || 0) + 1; return value; }, {});
  const attention = deliveries
    .filter((event) => ['failed', 'quarantined'].includes(event.state))
    .sort((left, right) => String(left.finished_at || left.received_at).localeCompare(String(right.finished_at || right.received_at)))
    .map((event) => ({
      state: event.state,
      delivery_id: event.delivery_id,
      event_id: event.event_id,
      listener_id: event.listener_id,
      type: event.type,
      received_at: event.received_at,
      finished_at: event.finished_at,
      attempts: event.attempts,
      last_error: event.last_error || null,
      remediation: {
        inspect: `bigbrain events inbox --state ${event.state} --limit 50`,
        retry: `bigbrain events retry ${event.delivery_id}`,
        discard: `bigbrain events discard ${event.delivery_id} --reason "resolved or intentionally dismissed"`,
      },
    }));
  return { registry_revision: registry.revision, runtime: registry.runtime, listener_count: registry.listeners.filter((listener) => !listener.removed).length, counts, attention, registry_path: registryPath, inbox_path: inboxPath };
}

function severityForFinding(findingType) {
  if (findingType === 'missing_frontmatter' || findingType === 'missing_separator' || findingType === 'invalid_timeline' || findingType === 'duplicate_timeline') return 'medium';
  if (findingType === 'missing_meeting_heading' || findingType === 'invalid_meeting_prep_heading' || findingType === 'invalid_meeting_prep_structure') return 'medium';
  if (findingType === 'attachment_sidecar_missing_raw_file' || findingType === 'attachment_sidecar_mismatched_raw_file' || findingType === 'attachment_sidecar_missing_raw_artifact') return 'medium';
  if (findingType === 'nested_raw_file_path') return 'medium';
  if (findingType === 'missing_filing_rules') return 'medium';
  if (findingType === 'missing_source_attribution') return 'medium';
  return 'low';
}

function createProvenanceStatus(pageCount) {
  return {
    page_count: pageCount,
    pages_with_source_attribution: 0,
    pages_missing_source_attribution: 0,
    pages_skipped: 0,
    git_backed_change_count: 0,
    git_backed_changes_missing_source_attribution: 0,
    repaired_unknown_count: 0,
  };
}

async function insertSourceAttributionFinding(db, { scope, pageSlug = null, path: filePath, attribution, details = {} }) {
  await insertHealthFinding(db, {
    findingType: 'missing_source_attribution',
    severity: severityForFinding('missing_source_attribution'),
    pageSlug: pageSlug || null,
    details: {
      scope,
      path: filePath,
      reason: attribution.reason,
      expected_fields: attribution.expected_fields,
      allowed_source_types: Object.keys(SOURCE_TYPE_DEFINITIONS),
      ...attribution.details,
      ...details,
    },
  });
}

function sourceAttributionForPage(parsed, provenance = null, { skipAttachment = false } = {}) {
  if (skipAttachment && isAttachmentSidecarSlug(parsed.slug)) return { ok: true, skipped: true };

  const timelineCandidate = mutationMetadataCandidateFromTimeline(parsed.timeline_entries);
  if (timelineCandidate) return validateMutationMetadata(timelineCandidate);
  const legacyCandidate = mutationMetadataCandidate(parsed.frontmatter || {});
  if (legacyCandidate) {
    const validation = validateMutationMetadata(legacyCandidate);
    if (!validation.ok) return validation;
    return {
      ok: false,
      reason: 'page_metadata',
      expected_fields: ['event_id', 'source_type', 'source_label', 'source_message', 'commit_message'],
      details: {
        ...validation.details,
        source_type: validation.value.provenance.source_type,
        normalized_source_type: validation.normalized_source_type,
        message: 'Source attribution is attached to page metadata; move it to the timeline entry for the update it describes.',
      },
    };
  }
  return {
    ok: false,
    reason: 'missing',
    expected_fields: ['event_id', 'source_type', 'source_label', 'source_message', 'commit_message'],
    details: { source_type: null, normalized_source_type: 'unknown', provenance_row_present: false },
  };
}

function mutationMetadataCandidateFromTimeline(entries) {
  const entry = (Array.isArray(entries) ? entries : []).find((item) => item?.provenance?.event_id);
  if (!entry?.provenance) return null;
  const { commit_message: commitMessage, significance, ...provenance } = entry.provenance;
  return {
    commit_message: commitMessage,
    provenance: {
      ...provenance,
      ...(significance !== undefined ? { significance } : {}),
      ...(entry.significance && significance === undefined ? { significance: entry.significance } : {}),
    },
  };
}

function validateMutationMetadata(candidate) {
  const normalizedCandidate = withSourceMessage(candidate);
  const normalizedSourceType = normalizeSourceType(normalizedCandidate.provenance?.source_type);
  try {
    const normalized = parseMutationMetadata(normalizedCandidate);
    return {
      ok: true,
      value: normalized,
      normalized_source_type: normalizedSourceType,
    };
  } catch (error) {
    return {
      ok: false,
      reason: 'invalid',
      expected_fields: ['event_id', 'source_type', 'source_label', 'source_message', 'commit_message'],
      details: {
        source_type: normalizedCandidate.provenance?.source_type ?? null,
        normalized_source_type: normalizedSourceType,
        validation_error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

function mutationMetadataCandidate(frontmatter) {
  const nested = parseJsonObject(frontmatter.mutation_metadata) || parseJsonObject(frontmatter.provenance);
  if (nested) return nested;

  const hasFlatMetadata = ['event_id', 'source_type', 'source_label', 'commit_message']
    .some((key) => frontmatter[key] !== undefined && frontmatter[key] !== null && String(frontmatter[key]).trim());
  if (!hasFlatMetadata) return null;

  return {
    commit_message: frontmatter.commit_message,
    provenance: {
      event_id: frontmatter.event_id,
      source_type: frontmatter.source_type,
      source_label: frontmatter.source_label,
      source_message: frontmatter.source_message,
      ...optionalProvenanceFields(frontmatter),
    },
  };
}

function repairUnknownSourceAttribution(raw, slug, parsed = parseMarkdownPage(String(raw || ''), slug)) {
  const now = new Date().toISOString();
  const legacy = mutationMetadataCandidate(parsed.frontmatter || {});
  const legacyProvenance = legacy?.provenance || {};
  const sourceType = normalizeSourceType(legacyProvenance.source_type);
  const sourceLabel = cleanAttributionText(legacyProvenance.source_label, 240) || 'Unknown source';
  const sourceMessage = cleanAttributionText(legacyProvenance.source_message, 4000) || sourceLabel;
  const eventId = cleanAttributionText(legacyProvenance.event_id, 500) || `health:unknown:${slug}`;
  const commitMessage = cleanSingleLine(legacy?.commit_message, 200) || 'Move page source attribution into timeline';
  const occurredAt = validTimelineDate(legacyProvenance.occurred_at) || now;
  const entry = {
    entry_id: eventId,
    occurred_at: occurredAt,
    recorded_at: now,
    text: legacy
      ? 'Moved legacy page source attribution into the timeline.'
      : 'Recorded that the source attribution for this page was unavailable.',
    provenance: {
      event_id: eventId,
      source_type: sourceType,
      source_label: sourceLabel,
      source_message: sourceMessage,
      source_icon: cleanAttributionText(legacyProvenance.source_icon, 80) || null,
      source_url: validUrl(legacyProvenance.source_url) || null,
      outcome: 'filed',
      commit_message: commitMessage,
    },
  };
  const text = removeProvenanceFrontmatter(String(raw || ''));
  const nextTimeline = appendTimelineEntries(parsed.timeline, entry, { recordedAt: now });
  if (parsed.hasSeparator) return replaceTimelineSection(text, `## Timeline\n\n${nextTimeline}`);
  return `${text.trimEnd()}\n\n---\n\n${renderTimelineBlock([entry], { includeMetadata: true })}\n`;
}

function optionalProvenanceFields(frontmatter) {
  return Object.fromEntries([
    ['origin_id', frontmatter.origin_id],
    ['listener_id', frontmatter.listener_id],
    ['source_icon', frontmatter.source_icon],
    ['source_message', frontmatter.source_message],
    ['source_url', frontmatter.source_url],
    ['occurred_at', frontmatter.occurred_at],
    ['received_at', frontmatter.received_at],
    ['codex_execution_id', frontmatter.codex_execution_id],
    ['codex_thread_id', frontmatter.codex_thread_id],
    ['raw_ref', frontmatter.raw_ref],
    ['outcome', frontmatter.outcome],
  ].filter(([, value]) => value !== undefined));
}

function withSourceMessage(candidate) {
  if (!candidate || typeof candidate !== 'object') return candidate;
  const provenance = candidate.provenance && typeof candidate.provenance === 'object' ? candidate.provenance : {};
  return {
    ...candidate,
    provenance: {
      ...provenance,
      source_message: provenance.source_message || provenance.source_label || 'Source message unavailable',
    },
  };
}

function removeProvenanceFrontmatter(markdown) {
  const text = String(markdown || '');
  if (!text.startsWith('---\n')) return text;
  const end = text.indexOf('\n---\n', 4);
  if (end < 0) return text;
  const reserved = new Set([
    'event_id', 'origin_id', 'listener_id', 'source_type', 'source_label', 'source_message',
    'source_icon', 'source_url', 'source_endpoint', 'occurred_at', 'received_at',
    'codex_execution_id', 'codex_thread_id', 'raw_ref', 'outcome', 'commit_message',
    'mutation_metadata', 'provenance',
  ]);
  const lines = text.slice(4, end).split('\n').filter((line) => {
    const key = line.match(/^\s*([A-Za-z0-9_-]+):/)?.[1];
    return !key || !reserved.has(key);
  });
  return `---\n${lines.join('\n')}\n---\n${text.slice(end + 5)}`;
}

function cleanAttributionText(value, max) {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : '';
}

function cleanSingleLine(value, max) {
  return cleanAttributionText(value, max).replace(/[\r\n]+/g, ' ').trim();
}

function validTimelineDate(value) {
  const text = cleanAttributionText(value, 80);
  if (!text || Number.isNaN(Date.parse(text))) return null;
  return /^\d{4}-\d{2}-\d{2}$/.test(text) || !Number.isNaN(Date.parse(text)) ? text : null;
}

function validUrl(value) {
  const text = cleanAttributionText(value, 2000);
  try {
    return /^https?:\/\//i.test(text) ? new URL(text).toString() : null;
  } catch {
    return null;
  }
}

function parseJsonObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function detectGitBackedSourceAttribution(brainDir, pageAttributions, gitStatus) {
  if (!gitStatus || ['no_repository', 'git_status_failed'].includes(gitStatus.latest_error_code)) {
    return { checked_count: 0, missing_count: 0, missing: [] };
  }

  const changes = await readGitChanges(brainDir);
  const missing = [];
  for (const change of changes) {
    const sourcePath = sourcePathForGitChange(change.path);
    if (!sourcePath) continue;
    const attribution = await attributionForGitPath(brainDir, sourcePath, pageAttributions);
    if (attribution.ok) continue;
    missing.push({
      path: path.join(brainDir, change.path),
      source_path: sourcePath,
      page_slug: sourcePath.endsWith('.md') ? sourcePath.replace(/\.md$/i, '') : null,
      change_status: change.status,
      attribution,
    });
  }
  return { checked_count: changes.filter((change) => sourcePathForGitChange(change.path)).length, missing_count: missing.length, missing };
}

async function readGitChanges(brainDir) {
  const result = await execFileAsync('git', ['-C', brainDir, 'status', '--porcelain=v1', '--untracked-files=all', '-z'])
    .catch(() => null);
  if (!result) return [];
  const tokens = result.stdout.split('\0');
  const changes = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (!token) continue;
    const status = token.slice(0, 2);
    let relativePath = token.slice(3);
    if (status.includes('R') || status.includes('C')) {
      relativePath = tokens[++index] || relativePath;
    }
    changes.push({ status, path: normalizeGitPath(relativePath) });
  }
  return changes;
}

function normalizeGitPath(value) {
  const trimmed = String(value || '').trim().replace(/^"|"$/g, '');
  return trimmed.split(path.sep).join('/');
}

function sourcePathForGitChange(relativePath) {
  if (!relativePath || relativePath === '.bigbrain-state' || relativePath.startsWith('.bigbrain-state/')) return null;
  if (relativePath.endsWith('.md')) {
    if (path.posix.basename(relativePath).toLowerCase() === 'readme' || path.posix.basename(relativePath).toLowerCase() === 'filing') return null;
    return relativePath;
  }
  if (relativePath.split('/').includes('.raw')) return sidecarPathForRawFile(relativePath);
  return null;
}

function sidecarPathForRawFile(relativePath) {
  const extension = path.posix.extname(relativePath);
  return `${relativePath.slice(0, -extension.length)}.md`;
}

async function attributionForGitPath(brainDir, sourcePath, pageAttributions) {
  if (sourcePath.endsWith('.md')) {
    const slug = sourcePath.replace(/\.md$/i, '');
    const known = pageAttributions.get(slug);
    if (known) return sourceAttributionForPage(known.parsed, null, { skipAttachment: true });
  }
  const raw = await fs.readFile(path.join(brainDir, sourcePath), 'utf8').catch(() => null);
  if (!raw) {
    return {
      ok: false,
      reason: 'missing',
      expected_fields: ['event_id', 'source_type', 'source_label', 'source_message', 'commit_message'],
      details: { source_type: null, normalized_source_type: 'unknown' },
    };
  }
  return sourceAttributionForPage(parseMarkdownPage(raw, sourcePath.replace(/\.md$/i, '')), null, { skipAttachment: true });
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
    .filter((line) => !/^(created_at|updated_at|cwds|target)\s*=/.test(line))
    .map((line) => line.trimEnd())
    .join('\n')
    .trim();
}
