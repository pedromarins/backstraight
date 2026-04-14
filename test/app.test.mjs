import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { resolve } from 'node:path';

const electronBin = resolve(import.meta.dirname, '..', 'node_modules', '.bin', 'electron');
const appDir = resolve(import.meta.dirname, '..');

let proc, rl, readyState;

function sendCmd(cmd) {
  proc.stdin.write(cmd + '\n');
}

function waitForLine(timeoutMs = 10000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Timeout waiting for output')), timeoutMs);
    rl.once('line', (line) => {
      clearTimeout(timer);
      resolve(JSON.parse(line));
    });
  });
}

describe('App E2E', () => {
  before(async () => {
    proc = spawn(electronBin, [appDir, '--test-mode'], {
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    rl = createInterface({ input: proc.stdout });
    readyState = await waitForLine(15000);
  });

  after(() => {
    if (proc && !proc.killed) {
      sendCmd('quit');
      setTimeout(() => { if (!proc.killed) proc.kill(); }, 3000);
    }
  });

  it('starts and becomes ready', () => {
    assert.equal(readyState.ready, true);
  });

  it('window starts hidden', () => {
    assert.equal(readyState.visible, false);
  });

  it('window is always-on-top', () => {
    assert.equal(readyState.alwaysOnTop, true);
  });

  it('window is not focusable', () => {
    assert.equal(readyState.focusable, false);
  });

  it('window size is 480x360', () => {
    assert.deepEqual(readyState.size, [480, 360]);
  });

  it('pill-show makes window visible', async () => {
    sendCmd('show');
    // Small delay for the show to take effect
    await new Promise(r => setTimeout(r, 200));
    sendCmd('state');
    const state = await waitForLine();
    assert.equal(state.visible, true);
  });

  it('pill-hide makes window hidden', async () => {
    sendCmd('hide');
    await new Promise(r => setTimeout(r, 200));
    sendCmd('state');
    const state = await waitForLine();
    assert.equal(state.visible, false);
  });

  it('dismiss pauses monitoring', async () => {
    sendCmd('dismiss:5000');
    const r = await waitForLine();
    assert.equal(r.dismissed, true);
    assert.equal(r.durationMs, 5000);
  });

  it('pill-show is blocked while dismissed', async () => {
    sendCmd('show');
    await new Promise(r => setTimeout(r, 200));
    sendCmd('state');
    const state = await waitForLine();
    assert.equal(state.visible, false); // still hidden because dismissed
  });

  it('dismiss-state shows remaining time', async () => {
    sendCmd('dismiss-state');
    const state = await waitForLine();
    assert.equal(state.dismissed, true);
    assert.ok(state.remainingMs > 0);
  });

  it('resume re-enables monitoring', async () => {
    sendCmd('resume');
    const r = await waitForLine();
    assert.equal(r.dismissed, false);
    // pill-show should work now
    sendCmd('show');
    await new Promise(r => setTimeout(r, 200));
    sendCmd('state');
    const state = await waitForLine();
    assert.equal(state.visible, true);
    sendCmd('hide'); // clean up
    await new Promise(r => setTimeout(r, 200));
  });
});
