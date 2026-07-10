export const AI_ACCESS_KINDS = Object.freeze({
  BRING_YOUR_OWN_KEY: 'bring_your_own_key',
  MANAGED_PLAN: 'managed_plan',
});

export const ENTITLEMENT_STATES = Object.freeze({
  AVAILABLE: 'available',
  APPROACHING_LIMIT: 'approaching_limit',
  EXHAUSTED: 'exhausted',
  PAYMENT_REQUIRED: 'payment_required',
  TEMPORARILY_UNAVAILABLE: 'temporarily_unavailable',
});

export class AiAccessProvider {
  async status() {
    throw new Error('AiAccessProvider.status() is not implemented.');
  }

  async inference(_request) {
    throw new Error('AiAccessProvider.inference() is not implemented.');
  }
}

export class AuthProvider {
  async currentAccount() {
    throw new Error('AuthProvider.currentAccount() is not implemented.');
  }

  async sendMagicLink(_email) {
    throw new Error('AuthProvider.sendMagicLink() is not implemented.');
  }
}

export class EntitlementProvider {
  async getEntitlement(_accountId) {
    throw new Error('EntitlementProvider.getEntitlement() is not implemented.');
  }
}

export class UsageMeter {
  async record(_event) {
    throw new Error('UsageMeter.record() is not implemented.');
  }
}

export class ManagedInferenceClient {
  async inference(_request) {
    throw new Error('ManagedInferenceClient.inference() is not implemented.');
  }
}

export class DisabledAuthProvider extends AuthProvider {
  async currentAccount() {
    return null;
  }

  async sendMagicLink() {
    throw featureDisabled('Email verification');
  }
}

export class DisabledEntitlementProvider extends EntitlementProvider {
  async getEntitlement() {
    return Object.freeze({
      state: ENTITLEMENT_STATES.TEMPORARILY_UNAVAILABLE,
      plan: null,
      reason: 'managed_plans_disabled',
    });
  }
}

export class DisabledUsageMeter extends UsageMeter {
  async record() {
    throw featureDisabled('Managed usage metering');
  }
}

export class DisabledManagedInferenceClient extends ManagedInferenceClient {
  async inference() {
    throw featureDisabled('Managed inference');
  }
}

export class BringYourOwnKeyAiAccessProvider extends AiAccessProvider {
  constructor({ apiKeyProvider, inferenceClient }) {
    super();
    if (typeof apiKeyProvider !== 'function') throw new TypeError('apiKeyProvider must be a function.');
    if (!inferenceClient || typeof inferenceClient.inference !== 'function') {
      throw new TypeError('inferenceClient.inference must be a function.');
    }
    this.apiKeyProvider = apiKeyProvider;
    this.inferenceClient = inferenceClient;
  }

  async status() {
    const apiKey = await this.apiKeyProvider();
    return Object.freeze({
      kind: AI_ACCESS_KINDS.BRING_YOUR_OWN_KEY,
      state: apiKey ? ENTITLEMENT_STATES.AVAILABLE : ENTITLEMENT_STATES.EXHAUSTED,
      reason: apiKey ? null : 'api_key_missing',
    });
  }

  async inference(request) {
    const apiKey = await this.apiKeyProvider();
    if (!apiKey) throw new Error('An API key is required for bring-your-own-key AI access.');
    return this.inferenceClient.inference(request, { apiKey });
  }
}

export class ManagedPlanAiAccessProvider extends AiAccessProvider {
  constructor({ enabled = false, accountIdProvider, entitlementProvider, usageMeter, inferenceClient }) {
    super();
    this.enabled = enabled;
    this.accountIdProvider = accountIdProvider;
    this.entitlementProvider = entitlementProvider;
    this.usageMeter = usageMeter;
    this.inferenceClient = inferenceClient;
  }

  async status() {
    if (!this.enabled) return disabledManagedStatus();
    const accountId = await this.accountIdProvider();
    if (!accountId) return Object.freeze({ kind: AI_ACCESS_KINDS.MANAGED_PLAN, state: ENTITLEMENT_STATES.PAYMENT_REQUIRED, reason: 'account_required' });
    return Object.freeze({ kind: AI_ACCESS_KINDS.MANAGED_PLAN, ...(await this.entitlementProvider.getEntitlement(accountId)) });
  }

  async inference(request) {
    const status = await this.status();
    if (status.state !== ENTITLEMENT_STATES.AVAILABLE && status.state !== ENTITLEMENT_STATES.APPROACHING_LIMIT) {
      throw new Error(`Managed inference is unavailable: ${status.reason || status.state}.`);
    }
    const accountId = await this.accountIdProvider();
    const response = await this.inferenceClient.inference({ ...request, accountId });
    await this.usageMeter.record({ accountId, usage: response?.usage || null, occurredAt: new Date().toISOString() });
    return response;
  }
}

function disabledManagedStatus() {
  return Object.freeze({
    kind: AI_ACCESS_KINDS.MANAGED_PLAN,
    state: ENTITLEMENT_STATES.TEMPORARILY_UNAVAILABLE,
    reason: 'managed_plans_disabled',
  });
}

function featureDisabled(feature) {
  const error = new Error(`${feature} is not enabled in this release.`);
  error.code = 'FEATURE_DISABLED';
  return error;
}
