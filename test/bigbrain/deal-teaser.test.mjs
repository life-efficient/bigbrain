import test from 'node:test';
import assert from 'node:assert/strict';
import { copyAllDealAsks, copyDealTeaser, formatAllDealAsks, formatDealTeaser } from '../../src/dashboard-client/overlays/deal-teaser.js';

test('copied teaser includes only explicitly supplied anonymous fields', () => {
  const record = {
    title: 'Confidential project and company name',
    summary: 'Internal location, source and commercial details',
    page_slug: 'deals/confidential',
    anonymised_title: ' Infrastructure opportunity ',
    anonymised_description: '  European infrastructure opportunity.  ',
    anonymised_asks: [' Equity partner ', '', null, 42, 'Operator introduction'],
  };
  assert.equal(formatDealTeaser(record, 0), 'Infrastructure opportunity\n\nEuropean infrastructure opportunity.\n\nStage: Stage not established\n\nEquity partner');
  assert.equal(formatDealTeaser(record, 1), 'Infrastructure opportunity\n\nEuropean infrastructure opportunity.\n\nStage: Stage not established\n\nOperator introduction');
  for (const index of [undefined, -1, 2, 0.5, '0']) assert.equal(formatDealTeaser(record, index), '');
});

test('missing or malformed teaser fields cannot fall back to private deal text', async () => {
  for (const record of [undefined, {}, { title: 'Private title', anonymised_description: 'Public description', anonymised_asks: ['Ask'] }, { anonymised_title: 'Public title', summary: 'Private summary', anonymised_asks: ['Ask'] }, { anonymised_title: 'Public title', anonymised_description: 'Public description', asks: ['Legacy ask'] }, { summary: 'Private', anonymised_asks: ['Investor'] }, { anonymised_description: 'Anonymous' }, { anonymised_description: 'Anonymous', anonymised_asks: 'Investor' }, { anonymised_description: '  ', anonymised_asks: ['Investor'] }, { anonymised_description: 'Anonymous', anonymised_asks: [' ', null] }]) {
    assert.equal(formatDealTeaser(record, 0), '');
    let called = false;
    await assert.rejects(copyDealTeaser(record, 0, { writeText: async () => { called = true; } }), /valid ask/);
    assert.equal(called, false);
  }
});

test('copy waits for clipboard completion and reports failures without claiming success', async () => {
  const record = { anonymised_title: 'Opportunity', anonymised_description: 'Anonymous opportunity.', anonymised_asks: ['An introduction'] };
  let copied;
  await copyDealTeaser(record, 0, { writeText: async (message) => { copied = message; } });
  assert.equal(copied, formatDealTeaser(record, 0));
  await assert.rejects(copyDealTeaser(record, 0, {}), /Automatic copying is unavailable/);
  await assert.rejects(copyDealTeaser(record, 0, { writeText: async () => { throw new Error('Denied'); } }), /Automatic copying is unavailable/);
});


test('embedded browser fallback copies the selected ask and restores focus', async () => {
  const record = { anonymised_title: 'Opportunity', anonymised_description: 'Anonymous.', anonymised_asks: ['Investor', 'Operator'] };
  let removed = false;
  let focused = false;
  let selected = false;
  let apiCalled = false;
  const textarea = { style: {}, setAttribute() {}, focus() {}, select() { selected = true; }, remove() { removed = true; } };
  const document = { activeElement: { focus() { focused = true; } }, body: { appendChild() {} },
    createElement: () => textarea, execCommand(command) { assert.equal(command, 'copy'); assert.equal(selected, true); return true; } };
  await copyDealTeaser(record, 1, { writeText: async () => { apiCalled = true; throw Error('Denied'); } }, document);
  assert.equal(textarea.value, formatDealTeaser(record, 1));
  assert.equal(apiCalled, true);
  assert.equal(removed, true);
  assert.equal(focused, true);
  document.execCommand = () => false;
  let copied;
  await copyDealTeaser(record, 0, { writeText: async (text) => { copied = text; } }, document);
  assert.equal(copied, formatDealTeaser(record, 0));
});


test('all-asks message shares the anonymous teaser and lists only sanitized asks', async () => {
  const record = { anonymised_title: 'Opportunity', title: 'Private title', summary: 'Private detail', anonymised_description: ' Anonymous opportunity. ',
    anonymised_asks: [' An operator is needed. ', null, '', 'An investment partner is sought.'] };
  const expected = 'Opportunity\n\nAnonymous opportunity.\n\nStage: Stage not established\n\nWhat is needed:\n• An operator is needed.\n• An investment partner is sought.';
  assert.equal(formatAllDealAsks(record), expected);
  assert.equal(formatDealTeaser(record, 0), 'Opportunity\n\nAnonymous opportunity.\n\nStage: Stage not established\n\nAn operator is needed.');
  let copied;
  await copyAllDealAsks(record, { writeText: async (message) => { copied = message; } });
  assert.equal(copied, expected);
  let selected;
  const textarea = { style: {}, setAttribute() {}, focus() {}, select() { selected = this.value; }, remove() {} };
  const document = { body: { appendChild() {} }, createElement: () => textarea, execCommand: () => true };
  await copyAllDealAsks(record, { writeText: async () => { throw Error('Denied'); } }, document);
  assert.equal(selected, expected);
  await assert.rejects(copyAllDealAsks(record, { writeText: async () => { throw Error('Denied'); } }, {}), /Automatic copying is unavailable/);
  for (const missing of [{ summary: 'Private', anonymised_asks: ['Ask'] }, { anonymised_description: 'Anonymous', anonymised_asks: [] }]) {
    assert.equal(formatAllDealAsks(missing), '');
    await assert.rejects(copyAllDealAsks(missing, {}), /at least one ask/);
  }
});


test('copy includes only allowlisted stage and shareable progress and blocks private records', () => {
 const record = { anonymised_title: 'Compute', anonymised_description: 'Capacity placement.', anonymised_asks: ['Operators are sought.'], deal_stage: 'qualifying', anonymised_stage_comment: 'The owner is confirming the power allocation.', stage_comment: 'PRIVATE_ROUTE' };
 assert.match(formatDealTeaser(record, 0), /Stage: Qualifying\nThe owner is confirming the power allocation/);
 assert.doesNotMatch(formatAllDealAsks(record), /PRIVATE_ROUTE/);
 assert.equal(formatAllDealAsks({ ...record, shareable: false }), '');
 assert.doesNotMatch(formatDealTeaser({ ...record, deal_stage: 'PRIVATE_STAGE' }, 0), /PRIVATE_STAGE/);
});
