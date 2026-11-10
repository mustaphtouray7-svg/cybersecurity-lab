import test from 'node:test';
import assert from 'node:assert/strict';
import { assessPassphrase, getCompletionPercent } from '../public/lab.js';
import { createAppServer } from '../server.js';

test('empty password input stays in the waiting state', () => {
  assert.deepEqual(assessPassphrase(''), {
    score: 0,
    label: 'WAITING',
    longEnough: false,
    hasVariety: false,
    uniqueEnough: false,
  });
});

test('common passwords are rated weak even when long', () => {
  assert.equal(assessPassphrase('password123').label, 'WEAK');
  assert.equal(assessPassphrase('aaaaaaaaaaaaaaaa').score, 1);
});

test('a long mixed passphrase receives a strong rating', () => {
  const result = assessPassphrase('Blue Meadow 47! Lantern');
  assert.equal(result.label, 'STRONG');
  assert.equal(result.longEnough, true);
  assert.equal(result.hasVariety, true);
  assert.equal(result.uniqueEnough, true);
});

test('completion percentage is based on three modules', () => {
  assert.equal(getCompletionPercent([]), 0);
  assert.equal(getCompletionPercent(['phishing']), 33);
  assert.equal(getCompletionPercent(['phishing', 'passwords', 'incident']), 100);
});

test('server delivers the app with security headers and rejects unsupported methods', async () => {
  const server = createAppServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const origin = `http://127.0.0.1:${address.port}`;

  try {
    const page = await fetch(origin);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-type'), /text\/html/);
    assert.equal(page.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(page.headers.get('x-frame-options'), 'DENY');
    assert.match(page.headers.get('content-security-policy'), /default-src 'self'/);
    assert.match(await page.text(), /Build your/);

    const rejected = await fetch(origin, { method: 'POST' });
    assert.equal(rejected.status, 405);
    assert.equal(rejected.headers.get('allow'), 'GET, HEAD');
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});