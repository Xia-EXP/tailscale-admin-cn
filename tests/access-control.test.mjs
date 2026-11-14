import test from 'node:test';
import assert from 'node:assert/strict';
import { passwordRecord } from '../access-control.mjs';

test('后台密码摘要只接受 12 至 256 个字符', () => {
  assert.throws(() => passwordRecord('too-short'), /12 至 256/);
  const record = passwordRecord('a-strong-local-password');
  assert.equal(record.username, 'admin');
  assert.match(record.salt, /^[a-f0-9]{48}$/);
  assert.match(record.hash, /^[a-f0-9]{128}$/);
  assert.notEqual(record.hash, 'a-strong-local-password');
});
