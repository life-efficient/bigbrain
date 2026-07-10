import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const SERVICE = 'ai.diffusing.bigbrain.openai';

export class MacKeychain {
  async set(brainId, secret) {
    if (process.platform !== 'darwin') throw new Error('Secure API-key storage currently requires macOS.');
    if (!secret?.trim()) throw new Error('An API key is required.');
    await execFileAsync('/usr/bin/security', ['add-generic-password', '-U', '-s', SERVICE, '-a', brainId, '-w', secret.trim()]);
  }

  async get(brainId) {
    const { stdout } = await execFileAsync('/usr/bin/security', ['find-generic-password', '-s', SERVICE, '-a', brainId, '-w']);
    return stdout.trim();
  }

  async delete(brainId) {
    await execFileAsync('/usr/bin/security', ['delete-generic-password', '-s', SERVICE, '-a', brainId]).catch((error) => {
      if (error?.code !== 44) throw error;
    });
  }
}

export function redactSecrets(value) {
  return String(value).replace(/sk-[A-Za-z0-9_-]{8,}/g, '[REDACTED]');
}
