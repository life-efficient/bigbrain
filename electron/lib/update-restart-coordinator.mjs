import fs from 'node:fs/promises';
import path from 'node:path';

import { compareServiceVersions } from './managed-service-reconciler.mjs';

const RECEIPT_SCHEMA_VERSION = 1;

export class UpdateRestartCoordinator {
  constructor({ receiptPath, appVersion, reconcile, now = () => new Date().toISOString(), fsImpl = fs }) {
    if (!receiptPath) throw new Error('An update receipt path is required.');
    if (!appVersion) throw new Error('The running app version is required.');
    if (typeof reconcile !== 'function') throw new Error('A managed-service reconciler is required.');
    this.receiptPath = path.resolve(receiptPath);
    this.appVersion = appVersion;
    this.reconcile = reconcile;
    this.now = now;
    this.fs = fsImpl;
  }

  async recordDownloadedTarget(targetVersion) {
    if (compareServiceVersions(targetVersion, targetVersion) !== 0) {
      throw new Error(`Downloaded update version is not valid SemVer: ${targetVersion || 'missing'}`);
    }
    const receipt = {
      schema_version: RECEIPT_SCHEMA_VERSION,
      target_version: targetVersion,
      downloaded_at: this.now(),
    };
    await this.fs.mkdir(path.dirname(this.receiptPath), { recursive: true });
    const temporary = `${this.receiptPath}.${process.pid}.tmp`;
    await this.fs.writeFile(temporary, `${JSON.stringify(receipt, null, 2)}\n`, { mode: 0o600 });
    await this.fs.rename(temporary, this.receiptPath);
    return receipt;
  }

  async verifyAfterRelaunch() {
    const receipt = await this.readReceipt();
    if (!receipt) {
      return {
        phase: 'none',
        action: 'none',
        appVersion: this.appVersion,
        targetVersion: null,
      };
    }
    if (!validReceipt(receipt)) {
      return {
        phase: 'app_verification_failed',
        action: 'review_invalid_update_receipt',
        appVersion: this.appVersion,
        targetVersion: typeof receipt?.target_version === 'string' ? receipt.target_version : null,
        message: 'The downloaded update receipt is invalid and was kept for inspection.',
      };
    }

    const appOrder = compareServiceVersions(this.appVersion, receipt.target_version);
    if (appOrder === null || appOrder < 0) {
      return {
        phase: 'app_verification_failed',
        action: 'retry_desktop_update',
        appVersion: this.appVersion,
        targetVersion: receipt.target_version,
        message: `BigBrain ${receipt.target_version} was downloaded, but ${this.appVersion} is still running.`,
      };
    }

    let reconciliation;
    try {
      reconciliation = await this.reconcile();
    } catch (error) {
      return {
        phase: 'service_attention',
        action: 'retry_service_reconciliation',
        appVersion: this.appVersion,
        targetVersion: receipt.target_version,
        message: safeFailureMessage(error),
      };
    }
    if (!['none', 'current', 'updated'].includes(reconciliation?.phase)) {
      return {
        phase: 'service_attention',
        action: 'review_local_services',
        appVersion: this.appVersion,
        targetVersion: receipt.target_version,
        reconciliation,
      };
    }

    await this.fs.rm(this.receiptPath, { force: true });
    return {
      phase: 'complete',
      action: 'none',
      appVersion: this.appVersion,
      targetVersion: receipt.target_version,
      completedAt: this.now(),
      reconciliation,
    };
  }

  async readReceipt() {
    try {
      return JSON.parse(await this.fs.readFile(this.receiptPath, 'utf8'));
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      if (error instanceof SyntaxError) return { invalid_json: true };
      throw error;
    }
  }
}

function validReceipt(receipt) {
  return receipt?.schema_version === RECEIPT_SCHEMA_VERSION
    && typeof receipt.target_version === 'string'
    && compareServiceVersions(receipt.target_version, receipt.target_version) === 0
    && typeof receipt.downloaded_at === 'string'
    && Number.isFinite(Date.parse(receipt.downloaded_at));
}

function safeFailureMessage(error) {
  const message = error instanceof Error ? error.message : String(error || 'unknown error');
  return message.replace(/sk-[A-Za-z0-9_-]{8,}/g, '[REDACTED]');
}
