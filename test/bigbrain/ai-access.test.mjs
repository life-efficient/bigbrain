import assert from 'node:assert/strict';
import test from 'node:test';
import {
  AI_ACCESS_KINDS,
  ENTITLEMENT_STATES,
  BringYourOwnKeyAiAccessProvider,
  DisabledAuthProvider,
  DisabledEntitlementProvider,
  DisabledManagedInferenceClient,
  ManagedPlanAiAccessProvider,
} from '../../src/bigbrain/ai-access.js';

test('bring-your-own-key provider reports a missing key without exposing a secret', async () => {
  const provider = new BringYourOwnKeyAiAccessProvider({
    apiKeyProvider: async () => null,
    inferenceClient: { inference: async () => assert.fail('must not infer') },
  });

  assert.deepEqual(await provider.status(), {
    kind: AI_ACCESS_KINDS.BRING_YOUR_OWN_KEY,
    state: ENTITLEMENT_STATES.EXHAUSTED,
    reason: 'api_key_missing',
  });
  await assert.rejects(() => provider.inference({ input: 'hello' }), /API key is required/);
});

test('bring-your-own-key provider passes the key only to its inference client', async () => {
  const calls = [];
  const provider = new BringYourOwnKeyAiAccessProvider({
    apiKeyProvider: async () => 'sk-test-secret',
    inferenceClient: { inference: async (...args) => { calls.push(args); return { output: 'ok' }; } },
  });

  assert.equal((await provider.status()).state, ENTITLEMENT_STATES.AVAILABLE);
  assert.deepEqual(await provider.inference({ input: 'hello' }), { output: 'ok' });
  assert.deepEqual(calls, [[{ input: 'hello' }, { apiKey: 'sk-test-secret' }]]);
});

test('future auth, entitlement, and inference integrations are explicitly disabled', async () => {
  assert.equal(await new DisabledAuthProvider().currentAccount(), null);
  await assert.rejects(() => new DisabledAuthProvider().sendMagicLink('person@example.com'), { code: 'FEATURE_DISABLED' });
  assert.deepEqual(await new DisabledEntitlementProvider().getEntitlement('account'), {
    state: ENTITLEMENT_STATES.TEMPORARILY_UNAVAILABLE,
    plan: null,
    reason: 'managed_plans_disabled',
  });
  await assert.rejects(() => new DisabledManagedInferenceClient().inference({}), { code: 'FEATURE_DISABLED' });
});

test('managed plan cannot invoke dependencies while its feature flag is disabled', async () => {
  let dependencyCalled = false;
  const provider = new ManagedPlanAiAccessProvider({
    enabled: false,
    accountIdProvider: async () => { dependencyCalled = true; },
    entitlementProvider: { getEntitlement: async () => { dependencyCalled = true; } },
    usageMeter: { record: async () => { dependencyCalled = true; } },
    inferenceClient: { inference: async () => { dependencyCalled = true; } },
  });

  assert.deepEqual(await provider.status(), {
    kind: AI_ACCESS_KINDS.MANAGED_PLAN,
    state: ENTITLEMENT_STATES.TEMPORARILY_UNAVAILABLE,
    reason: 'managed_plans_disabled',
  });
  await assert.rejects(() => provider.inference({ input: 'hello' }), /managed_plans_disabled/);
  assert.equal(dependencyCalled, false);
});

test('enabled managed plan enforces entitlement and records server-reported usage', async () => {
  const events = [];
  const provider = new ManagedPlanAiAccessProvider({
    enabled: true,
    accountIdProvider: async () => 'acct_1',
    entitlementProvider: { getEntitlement: async () => ({ state: ENTITLEMENT_STATES.APPROACHING_LIMIT, plan: 'free' }) },
    usageMeter: { record: async (event) => events.push(event) },
    inferenceClient: { inference: async (request) => ({ output: request.input, usage: { tokens: 3 } }) },
  });

  assert.deepEqual(await provider.inference({ input: 'hello' }), { output: 'hello', usage: { tokens: 3 } });
  assert.equal(events.length, 1);
  assert.equal(events[0].accountId, 'acct_1');
  assert.deepEqual(events[0].usage, { tokens: 3 });
  assert.match(events[0].occurredAt, /^\d{4}-\d{2}-\d{2}T/);
});
