import test from 'node:test';
import assert from 'node:assert/strict';
import { envSubscribers, loadSubscribers } from '../src/subscribers.js';

test('envSubscribers parses comma list', () => {
  assert.deepEqual(envSubscribers('123, 456,abc,'), [123, 456]);
  assert.deepEqual(envSubscribers(undefined), []);
});

test('loadSubscribers merges env with missing file', () => {
  process.env.SUBSCRIBERS = '789';
  assert.deepEqual(loadSubscribers('/tmp/does-not-exist.json'), [789]);
  delete process.env.SUBSCRIBERS;
});
