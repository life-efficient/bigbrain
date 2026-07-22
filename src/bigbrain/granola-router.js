export const DEFAULT_GRANOLA_ROUTE_THRESHOLD = 0.85;
export const DEFAULT_GRANOLA_ROUTE_MARGIN = 0.1;

const TRANSCRIPT_FIELDS = new Set([
  'content',
  'notes',
  'summary',
  'transcript',
  'transcript_content',
  'transcript_text',
]);

const SOURCE_RULE_FIELDS = Object.freeze({
  granola_folder: 'folder_names',
  organizer_domain: 'organizer_domain',
  account_context: 'account_context',
});

/**
 * Decide where one Granola meeting may be written.
 *
 * This function deliberately accepts only already-loaded metadata, profiles,
 * runtime state, and classifier scores. It performs no I/O and never inspects
 * meeting summaries or transcripts.
 */
export function routeGranolaMeeting({
  meeting,
  brains,
  scores = {},
  defaultThreshold = DEFAULT_GRANOLA_ROUTE_THRESHOLD,
  minimumMargin = DEFAULT_GRANOLA_ROUTE_MARGIN,
} = {}) {
  const metadata = normalizeMeetingMetadata(meeting);
  const candidates = normalizeBrains(brains, scores).map((candidate) => evaluateSourceRules(candidate, metadata));
  const options = { defaultThreshold, minimumMargin };
  validateDecisionOptions(options);

  if (metadata.mixed) {
    return held('meeting_mixed', candidates);
  }
  if (candidates.length === 0) {
    return held('no_candidate_brains', candidates);
  }

  const hardIncludes = candidates.filter((candidate) => candidate.hardIncluded && !candidate.hardExcluded);
  if (hardIncludes.length > 1) {
    return held('multiple_hard_includes', candidates, {
      candidate_brain_ids: hardIncludes.map((candidate) => candidate.brainId),
    });
  }
  if (hardIncludes.length === 1) {
    return decideCandidate(hardIncludes[0], candidates, {
      routeReason: 'hard_source_include',
      holdPrefix: 'hard_include',
    });
  }

  const ranked = candidates
    .filter((candidate) => !candidate.hardExcluded)
    .sort(compareCandidates);
  if (ranked.length === 0) {
    return held('all_candidates_excluded', candidates);
  }

  const first = ranked[0];
  if (first.confidence === null) {
    return held('classification_missing', candidates);
  }
  const threshold = first.minimumConfidence ?? defaultThreshold;
  if (first.confidence < threshold) {
    return held('low_confidence', candidates, {
      candidate_brain_id: first.brainId,
      confidence: first.confidence,
      required_confidence: threshold,
    });
  }

  const second = ranked.find((candidate) => candidate.confidence !== null && candidate.brainId !== first.brainId);
  if (second && first.confidence - second.confidence < minimumMargin) {
    return held('unclear_margin', candidates, {
      candidate_brain_ids: [first.brainId, second.brainId],
      confidence_margin: first.confidence - second.confidence,
      required_margin: minimumMargin,
    });
  }

  return decideCandidate(first, candidates, {
    routeReason: 'classification_confident',
    holdPrefix: 'selected_destination',
  });
}

function decideCandidate(candidate, candidates, { routeReason, holdPrefix }) {
  const gate = destinationGate(candidate);
  if (gate) {
    return held(`${holdPrefix}_${gate}`, candidates, {
      candidate_brain_id: candidate.brainId,
    });
  }
  if (candidate.reviewMatched) {
    return held(`${holdPrefix}_source_review_required`, candidates, {
      candidate_brain_id: candidate.brainId,
    });
  }
  return {
    decision: 'route',
    reason_codes: [routeReason],
    selected_brain_id: candidate.brainId,
    confidence: candidate.confidence,
    candidates: publicCandidates(candidates),
  };
}

function destinationGate(candidate) {
  if (!candidate.profileValid) return 'profile_invalid';
  if (!candidate.profileApproved) return 'profile_unapproved';
  if (candidate.ingestionMode === 'deny') return 'denied';
  if (candidate.ingestionMode !== 'auto' || candidate.approvalRequired) return 'review_required';
  if (!candidate.verified) return 'unverified';
  if (!candidate.authenticated) return 'unauthenticated';
  if (!candidate.writable) return 'unwritable';
  return null;
}

function evaluateSourceRules(candidate, metadata) {
  const matches = candidate.sourceRules.filter((rule) => sourceRuleMatches(rule, metadata));
  return {
    ...candidate,
    hardExcluded: matches.some((rule) => rule.effect === 'exclude'),
    hardIncluded: matches.some((rule) => rule.effect === 'include'),
    reviewMatched: matches.some((rule) => rule.effect === 'review'),
    matchedRules: matches,
  };
}

function sourceRuleMatches(rule, metadata) {
  const field = SOURCE_RULE_FIELDS[rule.type];
  if (!field) return false;
  const actual = metadata[field];
  if (Array.isArray(actual)) return actual.some((value) => exactRuleValue(rule.type, value) === exactRuleValue(rule.type, rule.value));
  return actual !== null && exactRuleValue(rule.type, actual) === exactRuleValue(rule.type, rule.value);
}

function exactRuleValue(type, value) {
  const string = String(value).trim();
  return type === 'organizer_domain' ? string.toLowerCase() : string;
}

function normalizeMeetingMetadata(meeting) {
  requireObject(meeting, 'meeting');
  for (const key of Object.keys(meeting)) {
    if (TRANSCRIPT_FIELDS.has(key.toLowerCase())) {
      throw new Error(`meeting.${key} is content and must not be supplied to the deterministic router.`);
    }
  }
  return {
    granola_id: optionalString(meeting.granola_id),
    title: optionalString(meeting.title),
    date: optionalString(meeting.date),
    folder_names: stringArray(meeting.folder_names ?? [], 'meeting.folder_names'),
    organizer_domain: optionalString(meeting.organizer_domain),
    attendee_domains: stringArray(meeting.attendee_domains ?? [], 'meeting.attendee_domains'),
    account_context: optionalString(meeting.account_context),
    existing_granola_provenance: Boolean(meeting.existing_granola_provenance),
    mixed: meeting.mixed === true || meeting.is_mixed === true,
  };
}

function normalizeBrains(brains, scores) {
  if (!Array.isArray(brains)) throw new Error('brains must be an array.');
  const seen = new Set();
  return brains.map((brain, index) => {
    const name = `brains[${index}]`;
    requireObject(brain, name);
    const profile = requireObject(brain.profile, `${name}.profile`);
    const routing = requireObject(profile.routing, `${name}.profile.routing`);
    const provenance = requireObject(profile.provenance, `${name}.profile.provenance`);
    const brainId = requiredString(brain.brain_id ?? profile.identity?.brain_id, `${name}.brain_id`);
    if (seen.has(brainId)) throw new Error(`brains contains duplicate brain_id: ${brainId}.`);
    seen.add(brainId);
    const confidence = normalizeConfidence(brain.confidence ?? scores[brainId], `${name}.confidence`);
    return {
      brainId,
      confidence,
      profileValid: brain.profile_valid === true,
      profileApproved: provenance.review_status === 'approved',
      ingestionMode: routing.ingestion_mode,
      approvalRequired: routing.approval_required === true,
      minimumConfidence: normalizeConfidence(routing.minimum_confidence, `${name}.profile.routing.minimum_confidence`),
      sourceRules: normalizeSourceRules(routing.source_rules ?? [], `${name}.profile.routing.source_rules`),
      verified: brain.verified === true,
      authenticated: brain.authenticated === true,
      writable: brain.writable === true,
    };
  });
}

function normalizeSourceRules(rules, name) {
  if (!Array.isArray(rules)) throw new Error(`${name} must be an array.`);
  return rules.map((rule, index) => {
    requireObject(rule, `${name}[${index}]`);
    if (!Object.hasOwn(SOURCE_RULE_FIELDS, rule.type)) throw new Error(`${name}[${index}].type is unsupported.`);
    if (!['include', 'exclude', 'review'].includes(rule.effect)) throw new Error(`${name}[${index}].effect is unsupported.`);
    return {
      type: rule.type,
      effect: rule.effect,
      value: requiredString(rule.value, `${name}[${index}].value`),
    };
  });
}

function compareCandidates(left, right) {
  const leftConfidence = left.confidence ?? -1;
  const rightConfidence = right.confidence ?? -1;
  return rightConfidence - leftConfidence || left.brainId.localeCompare(right.brainId);
}

function held(reason, candidates, details = {}) {
  return {
    decision: 'hold',
    reason_codes: [reason],
    selected_brain_id: null,
    ...details,
    candidates: publicCandidates(candidates),
  };
}

function publicCandidates(candidates) {
  return candidates.map((candidate) => ({
    brain_id: candidate.brainId,
    confidence: candidate.confidence,
    hard_excluded: candidate.hardExcluded,
    hard_included: candidate.hardIncluded,
    review_rule_matched: candidate.reviewMatched,
    gate: destinationGate(candidate),
  }));
}

function validateDecisionOptions({ defaultThreshold, minimumMargin }) {
  if (!Number.isFinite(defaultThreshold) || defaultThreshold < 0 || defaultThreshold > 1) {
    throw new Error('defaultThreshold must be a number from 0 to 1.');
  }
  if (!Number.isFinite(minimumMargin) || minimumMargin < 0 || minimumMargin > 1) {
    throw new Error('minimumMargin must be a number from 0 to 1.');
  }
}

function normalizeConfidence(value, name) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0 || number > 1) throw new Error(`${name} must be null or a number from 0 to 1.`);
  return number;
}

function requireObject(value, name) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${name} must be an object.`);
  return value;
}

function requiredString(value, name) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${name} must be a non-empty string.`);
  return value.trim();
}

function optionalString(value) {
  return value === null || value === undefined || value === '' ? null : String(value).trim();
}

function stringArray(value, name) {
  if (!Array.isArray(value)) throw new Error(`${name} must be an array.`);
  return value.map((item, index) => requiredString(item, `${name}[${index}]`));
}
