import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

const granolaPath = new URL('../../skills/bigbrain-granola-ingest/SKILL.md', import.meta.url);
const meetingPath = new URL('../../skills/bigbrain-meeting-ingest/SKILL.md', import.meta.url);
const casesPath = new URL('../../skills/bigbrain-granola-ingest/tests/cases.md', import.meta.url);

function section(content, startHeading, endHeading) {
  const start = content.indexOf(startHeading);
  assert.notEqual(start, -1, `Missing section: ${startHeading}`);
  const end = endHeading ? content.indexOf(endHeading, start + startHeading.length) : content.length;
  return content.slice(start, end === -1 ? content.length : end);
}

function position(content, pattern, label) {
  const match = pattern.exec(content);
  assert.ok(match, `Missing composition contract: ${label}`);
  return match.index;
}

test('Granola claims and deduplicates a route before delegating one meeting', async () => {
  const granola = await fs.readFile(granolaPath, 'utf8');
  const workflow = section(granola, '## Workflow', '## Anti-Patterns');

  const dedupe = position(
    workflow,
    /Check existing coverage and repair needs|deduplicat(?:e|ion)|existing Granola coverage/iu,
    'Granola ID dedupe or existing-coverage gate',
  );
  const claim = position(
    workflow,
    /claimed:\s*true|successful(?:ly)? claimed route|route (?:is |has been )?claimed|claim the (?:approved )?route/iu,
    'successful route claim gate',
  );
  const delegation = position(
    workflow,
    /(?:invoke|delegate[^\n]{0,80}(?:to|through)) `\$bigbrain-meeting-ingest`/iu,
    'Meeting Ingest delegation',
  );

  assert.ok(dedupe < delegation, 'Granola must deduplicate before Meeting Ingest delegation');
  assert.ok(claim < delegation, 'Granola must hold the claimed route before Meeting Ingest delegation');
});

test('Granola resumes after delegation and alone completes the ledger lifecycle', async () => {
  const granola = await fs.readFile(granolaPath, 'utf8');
  const workflow = section(granola, '## Workflow', '## Anti-Patterns');

  assert.match(
    workflow,
    /delegated result[\s\S]{0,180}(?:is not|does not (?:mean|constitute)|must not be treated as)[\s\S]{0,100}(?:completion|complete|success)/iu,
    'A delegated Meeting Ingest result must not itself complete the Granola item',
  );

  const delegation = position(
    workflow,
    /(?:invoke|delegate[^\n]{0,80}(?:to|through)) `\$bigbrain-meeting-ingest`/iu,
    'Meeting Ingest delegation',
  );
  const afterDelegation = workflow.slice(delegation);
  const resume = position(
    afterDelegation,
    /resume (?:Granola )?(?:coordination|processing|workflow)|after (?:the )?delegated result/iu,
    'Granola resume boundary',
  );
  const completion = afterDelegation.slice(resume);

  const sync = position(
    completion,
    /run (?:the )?(?:destination(?: Brain)? )?sync|run `bigbrain sync --json`|use the destination brain's live sync tool/iu,
    'destination sync',
  );
  const readBack = position(
    completion,
    /perform (?:the )?final (?:same-Brain )?read-back|final read-back of|read back every final/iu,
    'final destination read-back',
  );
  const verify = position(
    completion,
    /bigbrain-granola-ledger verify|(?:use|call|run) `verify`/iu,
    'ledger verify',
  );
  const advance = position(
    completion,
    /bigbrain-granola-ledger advance|(?:use|call|run) `advance`|advance the (?:matching )?cursor/iu,
    'cursor advance',
  );

  assert.ok(sync < readBack, 'Granola must sync the destination before its final read-back');
  assert.ok(readBack < verify, 'Granola must finish destination read-back before ledger verification');
  assert.ok(verify < advance, 'Granola must verify the route before advancing the cursor');

  assert.match(
    completion,
    /(?:partial|failed)[\s\S]{0,360}(?:do not|must not|prevent(?:s|ed)?)[\s\S]{0,220}(?:ledger )?verif(?:y|ication)[\s\S]{0,220}(?:cursor )?advance/iu,
    'Partial or failed delegated results must prevent both ledger verification and cursor advancement',
  );
});

test('Granola alone owns the batch user-facing report', async () => {
  const granola = await fs.readFile(granolaPath, 'utf8');
  const output = section(granola, '## Output');

  assert.match(
    output,
    /(?:only|sole)[^\n.]{0,100}(?:Granola|coordinator)[^\n.]{0,140}(?:batch user-facing|user-facing batch)[^\n.]*(?:output|report)|(?:Granola|coordinator)[^\n.]{0,100}(?:only|sole)[^\n.]{0,140}(?:batch user-facing|user-facing batch)/iu,
    'Granola must explicitly retain sole ownership of batch user-facing output',
  );
});

test('Meeting Ingest separates standalone output from delegated worker output', async () => {
  const meeting = await fs.readFile(meetingPath, 'utf8');
  const output = section(meeting, '## Output');

  const standalone = position(output, /### Standalone (?:mode|output)/iu, 'Meeting Ingest standalone output');
  const delegated = position(output, /### Delegated (?:mode|output)/iu, 'Meeting Ingest delegated output');
  assert.notEqual(standalone, delegated, 'Standalone and delegated output contracts must be distinct');

  const delegatedOutput = output.slice(delegated);
  assert.match(
    delegatedOutput,
    /(?:return|produce|provide)[^\n.]{0,120}(?:internal|structured)[\s\S]{0,180}(?:result|status)/iu,
    'Delegated Meeting Ingest must return an internal result to its caller',
  );
  assert.match(
    meeting,
    /delegated mode[^\n.]{0,180}(?:do not|must not|does not)[^\n.]{0,120}(?:run|perform|own)?[^\n.]{0,80}(?:independent(?:ly)? )?sync|(?:independent )?sync[^\n.]{0,100}(?:belongs to|is owned by)[^\n.]{0,80}(?:caller|Granola)/iu,
    'Delegated Meeting Ingest must not independently sync',
  );
  assert.match(
    meeting,
    /delegated mode[^\n.]{0,180}(?:do not|must not|does not)[^\n.]{0,140}(?:user-facing|batch)[^\n.]{0,80}(?:report|output)|(?:user-facing|batch)[^\n.]{0,100}(?:belongs to|is owned by)[^\n.]{0,80}(?:caller|Granola)/iu,
    'Delegated Meeting Ingest must not independently user-report',
  );
});

test('forward cases cover post-delegation distraction and failure propagation', async () => {
  const cases = await fs.readFile(casesPath, 'utf8');

  assert.match(cases, /## Complete delegated result is not overall completion/);
  assert.match(cases, /runs destination sync/);
  assert.match(cases, /final same-Brain read-back/);
  assert.match(cases, /verifies the ledger route only after/);
  assert.match(cases, /advances the cursor only after/);
  assert.match(cases, /continues any remaining batch candidates/);
  assert.match(cases, /Ending the run or reporting success immediately after the delegated result/);

  assert.match(cases, /## Partial delegated result fails closed/);
  assert.match(cases, /route remains unverified and the cursor remains unchanged/);
  assert.match(cases, /Running ledger verification or cursor advancement for the partial route/);

  assert.match(cases, /## Several meetings retain the outer batch loop/);
  assert.match(cases, /then processes the second and third routes/);
  assert.match(cases, /Returning after the first meeting/);
});
