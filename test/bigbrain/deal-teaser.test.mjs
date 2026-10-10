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
  assert.equal(formatDealTeaser(record), 'European infrastructure opportunity.\n\nLooking for:\n• Equity partner\n• Operator introduction');
});

test('missing or malformed teaser fields cannot fall back to private deal text', async () => {
  for (const record of [undefined, {}, { summary: 'Private', asks: ['Investor'] }, { teaser_summary: 'Anonymous' }, { teaser_summary: 'Anonymous', asks: 'Investor' }, { teaser_summary: '  ', asks: ['Investor'] }, { teaser_summary: 'Anonymous', asks: [' ', null] }]) {
    assert.equal(formatDealTeaser(record), '');
    let called = false;
    await assert.rejects(copyDealTeaser(record, { writeText: async () => { called = true; } }), /at least one ask/);
    assert.equal(called, false);
  }
});

test('copy waits for clipboard completion and reports failures without claiming success', async () => {
  const record = { teaser_summary: 'Anonymous opportunity.', asks: ['An introduction'] };
  let copied;
  await copyDealTeaser(record, { writeText: async (message) => { copied = message; } });
  assert.equal(copied, formatDealTeaser(record));
  await assert.rejects(copyDealTeaser(record, {}), /Clipboard access is unavailable/);
  await assert.rejects(copyDealTeaser(record, { writeText: async () => { throw new Error('Denied'); } }), /Could not copy/);
});
