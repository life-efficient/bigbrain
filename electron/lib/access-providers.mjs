export const AiAccessType = Object.freeze({ BYOK: 'bring_your_own_key', MANAGED: 'managed_plan' });

export class AiAccessProvider { async credential() { throw new Error('Not implemented'); } }
export class KeychainAiAccessProvider extends AiAccessProvider {
  constructor(keychain, brainId) { super(); this.keychain = keychain; this.brainId = brainId; }
  credential() { return this.keychain.get(this.brainId); }
}
export class DisabledManagedInferenceClient { async request() { throw new Error('Managed BigBrain plans are not available yet.'); } }
export class DisabledAuthProvider { async authenticate() { return { state: 'not_required' }; } }
export class DisabledEntitlementProvider { async status() { return { state: 'bring_your_own_key' }; } }
export class NoopUsageMeter { async record() { return { recorded: false }; } }
