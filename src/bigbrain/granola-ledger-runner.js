import { openRoutingLedger, ROUTING_LEDGER_SCHEMA_VERSION } from './routing-ledger.js';

const OPERATIONS = new Set([
  'preflight',
  'inspect',
  'record',
  'claim',
  'renew',
  'verify',
  'fail',
  'retry',
  'advance',
]);

export async function runGranolaLedgerCommand(args, { env = process.env } = {}) {
  const operation = args[0];
  if (!OPERATIONS.has(operation)) {
    throw new Error('Granola ledger operation must be one of: preflight, inspect, record, claim, renew, verify, fail, retry, advance.');
  }

  const ledger = await openRoutingLedger({ env });
  try {
    if (operation === 'preflight') {
      const source = optionalValue(args, '--source') || 'granola';
      ledger.transaction(() => null);
      return {
        ok: true,
        operation,
        schema_version: Number(ledger.db.prepare('PRAGMA user_version').get().user_version),
        expected_schema_version: ROUTING_LEDGER_SCHEMA_VERSION,
        writable: true,
        integrity: ledger.db.prepare('PRAGMA integrity_check').get().integrity_check,
        foreign_key_violations: ledger.db.prepare('PRAGMA foreign_key_check').all().length,
        route_count: Number(ledger.db.prepare('SELECT COUNT(*) AS count FROM routes').get().count),
        event_count: Number(ledger.db.prepare('SELECT COUNT(*) AS count FROM route_events').get().count),
        cursor: ledger.getCursor({ source }),
      };
    }

    const source = requireValue(args, '--source');
    const sourceItemId = requireValue(args, '--item');
    const identity = { source, sourceItemId };

    if (operation === 'inspect') {
      return { ok: true, operation, route: ledger.get(identity) };
    }
    if (operation === 'record') {
      const discovered = ledger.discover({
        ...identity,
        metadataHash: optionalValue(args, '--metadata-hash'),
        policyRevision: requireValue(args, '--policy-revision'),
      });
      const canRecordDecision = !discovered.already_exists || discovered.decision_state === 'discovered';
      const route = canRecordDecision
        ? ledger.recordDecision({
          ...identity,
          decision: requireValue(args, '--decision'),
          selectedBrainId: optionalValue(args, '--brain'),
          metadataHash: optionalValue(args, '--metadata-hash'),
          policyRevision: requireValue(args, '--policy-revision'),
          reasonCodes: values(args, '--reason'),
          confidenceBand: optionalValue(args, '--confidence') || 'unknown',
        })
        : discovered;
      return { ok: true, operation, already_exists: discovered.already_exists, route };
    }
    if (operation === 'claim') {
      const route = ledger.acquireLease({
        ...identity,
        durationMs: positiveInteger(optionalValue(args, '--duration-ms') || 30 * 60 * 1000, '--duration-ms'),
      });
      return { ok: true, operation, claimed: route !== null, route };
    }
    if (operation === 'renew') {
      return {
        ok: true,
        operation,
        route: ledger.renewLease({
          ...identity,
          leaseToken: requireValue(args, '--lease-token'),
          durationMs: positiveInteger(optionalValue(args, '--duration-ms') || 30 * 60 * 1000, '--duration-ms'),
        }),
      };
    }
    if (operation === 'verify') {
      return {
        ok: true,
        operation,
        route: ledger.markVerified({
          ...identity,
          leaseToken: requireValue(args, '--lease-token'),
          destinationVerificationRef: requireValue(args, '--verification-ref'),
        }),
      };
    }
    if (operation === 'fail') {
      return {
        ok: true,
        operation,
        route: ledger.markFailed({
          ...identity,
          leaseToken: requireValue(args, '--lease-token'),
          errorCode: requireValue(args, '--error-code'),
        }),
      };
    }
    if (operation === 'retry') {
      return {
        ok: true,
        operation,
        route: ledger.retry({
          ...identity,
          actorId: optionalValue(args, '--actor'),
        }),
      };
    }
    const route = ledger.get(identity);
    if (!route || route.decision_state !== 'verified') {
      throw new Error('Cursor advancement requires a verified route for the same source item.');
    }
    return {
      ok: true,
      operation,
      cursor: ledger.advanceCursor({
        ...identity,
        meetingTimestamp: requireValue(args, '--meeting-timestamp'),
      }),
    };
  } finally {
    ledger.close();
  }
}

export function granolaLedgerUsage() {
  return `Usage: bigbrain-granola-ledger <operation> [options]

Operations:
  preflight [--source granola]
  inspect --source granola --item ID
  record --source granola --item ID --decision auto|hold|deny|classify --policy-revision REV [--brain BRAIN_ID] [--metadata-hash SHA256] [--reason CODE] [--confidence BAND]
  claim --source granola --item ID [--duration-ms N]
  renew --source granola --item ID --lease-token TOKEN [--duration-ms N]
  verify --source granola --item ID --lease-token TOKEN --verification-ref REF
  fail --source granola --item ID --lease-token TOKEN --error-code CODE
  retry --source granola --item ID [--actor ACTOR_ID]
  advance --source granola --item ID --meeting-timestamp ISO`;
}

function requireValue(args, name) {
  const value = optionalValue(args, name);
  if (value === null) throw new Error(`${name} is required.`);
  return value;
}

function optionalValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function values(args, name) {
  const output = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] !== name) continue;
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
    output.push(value);
  }
  return output;
}

function positiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`${name} must be a positive integer.`);
  return number;
}
