import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile, execFileSync } from 'node:child_process';
import { promisify } from 'node:util';

import { formatServiceInstallError } from './service-errors.mjs';

const execFileAsync = promisify(execFile);

/**
 * The desktop-facing adapter for a device-managed MCP runtime.
 *
 * The runner deliberately knows how to invoke the packaged CLI and launchd,
 * but it does not decide which brains the desktop is allowed to manage. That
 * policy remains in DesktopController.
 */
export class LocalMcpRunner {
  constructor({
    appPath,
    nodePath = process.execPath,
    env = process.env,
    fsImpl = fs,
    execFileImpl = execFileAsync,
    electronRuntime = Boolean(process.versions.electron),
  } = {}) {
    this.appPath = appPath;
    this.nodePath = nodePath;
    this.env = env;
    this.fs = fsImpl;
    this.execFile = execFileImpl;
    this.electronRuntime = electronRuntime;
  }

  async provision(brain, { ownerSlug, gitBackup = true } = {}) {
    if (!this.appPath) {
      throw new Error('BigBrain cannot manage local services because the desktop app path is unavailable. Restart or reinstall BigBrain, then retry.');
    }
    const installer = path.join(this.appPath, 'scripts/install-local-mcp-service.mjs');
    const args = [
      installer,
      '--repo-root', this.appPath,
      '--brain-home', brain.home,
      '--port', String(brain.port),
      '--label', brain.serviceLabel,
      '--local-person-slug', ownerSlug || '',
      '--local-owner-email', brain.owner?.email || '',
      '--local-owner-name', brain.owner?.name || '',
      '--keychain-account', brain.id,
      '--service-manager', 'desktop',
      '--service-source', 'desktop-bundle',
      gitBackup ? '--git-backup' : '--no-git-backup',
    ];
    if (brain.replacedService?.plistPath && brain.replacedService.label !== brain.serviceLabel) {
      args.push('--replace-plist', brain.replacedService.plistPath);
    }
    if (this.electronRuntime && this.nodePath === process.execPath) args.push('--electron-run-as-node');
    try {
      await this.fs.access(installer);
    } catch (error) {
      throw new Error(formatServiceInstallError(error, {
        brainName: brain.name,
        port: brain.port,
        installerPath: installer,
      }), { cause: error });
    }
    try {
      const result = await this.execFile(this.nodePath, args, {
        env: { ...this.env, ELECTRON_RUN_AS_NODE: '1' },
        maxBuffer: 128 * 1024,
      });
      return result?.stdout || null;
    } catch (error) {
      throw new Error(formatServiceInstallError(error, {
        brainName: brain.name,
        port: brain.port,
        installerPath: installer,
      }), { cause: error });
    }
  }

  async restart(brain) {
    await this.execFile('launchctl', ['kickstart', '-k', `gui/${process.getuid?.() ?? await userId()}/${brain.serviceLabel}`]);
    return brain;
  }
}

async function userId() {
  return execFileSync('id', ['-u'], { encoding: 'utf8' }).trim();
}
