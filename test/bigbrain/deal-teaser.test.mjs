import test from 'node:test';
import assert from 'node:assert/strict';
import { copyDealTeaser, formatDealTeaser } from '../../src/dashboard-client/overlays/deal-teaser.js';

test('copied teaser includes only explicitly supplied anonymous fields', () => {
  const record = {
    title: 'Confidential project and company name',
    summary: 'Internal location, source and commercial details',
    page_slug: 'deals/confidential',
    teaser_summary: '  European infrastructure opportunity.  ',
    asks: [' Equity partner ', '', null, 42, 'Operator introduction'],
  };
  assert.equal(formatDealTeaser(record, 0), 'European infrastructure opportunity.\n\nLooking for:\n• Equity partner');
  assert.equal(formatDealTeaser(record, 1), 'European infrastructure opportunity.\n\nLooking for:\n• Operator introduction');
  for (const index of [undefined, -1, 2, 0.5, '0']) assert.equal(formatDealTeaser(record, index), '');
});

test('missing or malformed teaser fields cannot fall back to private deal text', async () => {
  for (const record of [undefined, {}, { summary: 'Private', asks: ['Investor'] }, { teaser_summary: 'Anonymous' }, { teaser_summary: 'Anonymous', asks: 'Investor' }, { teaser_summary: '  ', asks: ['Investor'] }, { teaser_summary: 'Anonymous', asks: [' ', null] }]) {
    assert.equal(formatDealTeaser(record, 0), '');
    let called = false;
    await assert.rejects(copyDealTeaser(record, 0, { writeText: async () => { called = true; } }), /valid ask/);
    assert.equal(called, false);
  }
});

test('copy waits for clipboard completion and reports failures without claiming success', async () => {
  const record = { teaser_summary: 'Anonymous opportunity.', asks: ['An introduction'] };
  let copied;
  await copyDealTeaser(record, 0, { writeText: async (message) => { copied = message; } });
  assert.equal(copied, formatDealTeaser(record, 0));
  await assert.rejects(copyDealTeaser(record, 0, {}), /Automatic copying is unavailable/);
  await assert.rejects(copyDealTeaser(record, 0, { writeText: async () => { throw new Error('Denied'); } }), /Automatic copying is unavailable/);
});


test('embedded browser copy runs during the click and restores focus', async () => {
  const record = { teaser_summary: 'Anonymous.', asks: ['Investor', 'Operator'] };
  let removed = false;
  let focused = false;
  let selected = false;
  let apiCalled = false;
  const textarea = { style: {}, setAttribute() {}, focus() {}, select() { selected = true; }, remove() { removed = true; } };
  const document = { activeElement: { focus() { focused = true; } }, body: { appendChild() {} },
    createElement: () => textarea, execCommand(command) { assert.equal(command, 'copy'); assert.equal(selected, true); return true; } };
  await copyDealTeaser(record, 1, { writeText: async () => { apiCalled = true; throw Error('Denied'); } }, document);
  assert.equal(textarea.value, formatDealTeaser(record, 1));
  assert.equal(apiCalled, false);
  assert.equal(removed, true);
  assert.equal(focused, true);
  document.execCommand = () => false;
  let copied;
  await copyDealTeaser(record, 0, { writeText: async (text) => { copied = text; } }, document);
  assert.equal(copied, formatDealTeaser(record, 0));
});
