import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ignored = new Set(['.git', 'node_modules']);
const forbiddenPathPatterns = [
  /(^|[\\/])runtime([\\/]|$)/i,
  /(^|[\\/])data[\\/](config|access|remote-profiles)\.json$/i,
  /(^|[\\/])data[\\/]fleet([\\/]|$)/i,
  /(^|[\\/])(ACCESS-URLS\.txt|migration\.enc\.json)$/i,
  /\.(zip|pem|key|p12|pfx|rdp)$/i,
];
const blockedMarkers = [
  String.fromCharCode(84, 67, 80, 67) + '-11',
  ['100', '123', '187', '59'].join('.'),
  ['192', '168', '18', '24'].join('.'),
  ['guanli', 'com'].join('.'),
  String(18000 + 610),
];
const secretPatterns = [
  /tskey-(?:api|auth)-[A-Za-z0-9_-]{16,}/,
  /gho_[A-Za-z0-9]{20,}/,
  /-----BEGIN [A-Z ]+PRIVATE KEY-----/,
  /ssh-(?:ed25519|rsa) [A-Za-z0-9+/]{40,}/,
];

function filesUnder(directory) {
  const result = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (ignored.has(entry.name)) continue;
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...filesUnder(full));
    else result.push(full);
  }
  return result;
}

test('公开发行版不包含运行时私密路径或目标机器标识', () => {
  const files = filesUnder(root);
  const forbiddenPaths = files
    .map((file) => path.relative(root, file))
    .filter((file) => forbiddenPathPatterns.some((pattern) => pattern.test(file)));
  assert.deepEqual(forbiddenPaths, []);

  const leakedMarkers = [];
  const leakedSecrets = [];
  for (const file of files) {
    const content = fs.readFileSync(file);
    if (content.includes(0)) continue;
    const text = content.toString('utf8');
    for (const marker of blockedMarkers) if (text.includes(marker)) leakedMarkers.push(path.relative(root, file) + ': ' + marker);
    for (const pattern of secretPatterns) if (pattern.test(text)) leakedSecrets.push(path.relative(root, file) + ': ' + pattern);
  }
  assert.deepEqual(leakedMarkers, []);
  assert.deepEqual(leakedSecrets, []);
});

