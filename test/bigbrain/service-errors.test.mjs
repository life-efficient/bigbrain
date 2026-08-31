import test from 'node:test';
import assert from 'node:assert/strict';

import { formatServiceInstallError } from '../../electron/lib/service-errors.mjs';

test('service installer errors explain a missing desktop bundle component', () => {
  const message = formatServiceInstallError(new Error("Command failed: BigBrain\nError: Cannot find module '/Applications/BigBrain.app/Contents/Resources/app/scripts/install-local-mcp-service.mjs'"), {
    brainName: 'Personal Brain',
    port: 55560,
  });
  assert.equal(message, 'BigBrain could not manage "Personal Brain" because this desktop build is missing its local service installer. Update or reinstall BigBrain, then try again.');
  assert.doesNotMatch(message, /Cannot find module|node:internal|Command failed/);
});

test('service installer errors explain a port conflict without exposing command output', () => {
  const message = formatServiceInstallError(new Error('Local port 55560 is still occupied after BigBrain stopped the registered service.'), {
    brainName: 'AI Infrastructure Atlas',
    port: 55560,
  });
  assert.equal(message, 'BigBrain could not update "AI Infrastructure Atlas" on local port 55560 because another local service is still using that port. The existing service configuration was left in place. Close the conflicting service, then retry.');
});

test('service installer errors identify missing packaged dashboard assets', () => {
  const message = formatServiceInstallError(new Error('Build failed with 6 errors: Could not resolve "three/examples/jsm/controls/OrbitControls.js"'));
  assert.match(message, /missing dashboard runtime assets/);
  assert.match(message, /Update or reinstall BigBrain/);
});

