import test from 'node:test';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import assert from 'node:assert/strict';
import { dealMetadataSchema, dealMetadataFields } from '../../src/bigbrain/deal-schema.js';
import { dealsMcpToolDefinitions } from '../../src/bigbrain/overlays/deals-mcp.js';
import { defaultPageSchemaRegistry } from '../../src/bigbrain/page-schema-registry.js';
import { filingRulesForBrain } from '../../src/bigbrain/filing-rules.js';
import { schemaDescription } from '../../src/bigbrain/schema.js';

const fields = ['anonymised_title', 'anonymised_description', 'anonymised_asks'];

test('anonymisation guidance removes names while preserving substantive differentiators and material qualifiers', () => {
  const descriptions = dealMetadataFields();
  assert.match(descriptions.anonymised_title.description, /names removed/);
  assert.match(descriptions.anonymised_description.description, /technology.*geography.*capacity.*traction.*commercial figures/);
  assert.match(descriptions.anonymised_description.description, /family pedigree and government relationships when authorised/);
  assert.match(descriptions.anonymised_description.description, /potentially recognisable/);
  assert.match(descriptions.anonymised_description.description, /specific material uncertainty/);
  assert.match(descriptions.anonymised_asks.description, /Excludes documents/);
  assert.match(descriptions.anonymised_asks.description, /empty array/);
  assert.equal(dealMetadataSchema.safeParse({ anonymised_title: '40 MW Nordic compute campus', anonymised_description: 'A family-backed platform developing 40 MW of compute capacity, seeking capital and offtake partners.', anonymised_asks: ['Seeking offtake partners for 10 MW of capacity.'] }).success, true);
});

test('ordinary schema, registry and both MCP aliases retain the canonical Zod field descriptions', () => {
  const canonical = dealMetadataFields();
  const registry = defaultPageSchemaRegistry();
  const deal = Object.values(registry.schemas).find(schema => schema.path_prefix === 'deals');
  const definitions = dealsMcpToolDefinitions({});
  for (const name of ['overlays/deals/update_asks', 'overlays_deals_update_asks', 'overlays/deals/update_details', 'overlays_deals_update_details']) {
    const tool = definitions.find(tool => tool.name === name);
    const properties = name.endsWith('update_details') ? tool.inputSchema.properties.values.oneOf[0].properties : tool.inputSchema.properties;
    for (const field of fields) {
      assert.equal(properties[field].description, canonical[field].description, `${name}.${field}`);
      assert.equal(deal.fields[field].description, canonical[field].description);
      assert.equal(schemaDescription().deal_page_shape.frontmatter[field], canonical[field].description);
    }
  }
});


test('MCP filing guidance uses the same canonical descriptions without restrictive overrides', async () => {
  const brainDir = await fs.mkdtemp(path.join(os.tmpdir(), 'anonymisation-filing-'));
  try {
    const rules = await filingRulesForBrain({ config: { brainDir, schemaDirs: ['deals'] } });
    for (const field of fields) assert.equal(rules.deal_schema.frontmatter[field], dealMetadataFields()[field].description);
    assert.doesNotMatch(rules.deal_schema.guidance.join(' '), /combinations of identifying details/);
  } finally { await fs.rm(brainDir, { recursive: true, force: true }); }
});
