import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const sw = readFileSync(join(root, 'sw.js'), 'utf8');
const listed = JSON.parse('[' + sw.match(/const FILES = \[([\s\S]*?)\];/)[1].replace(/'/g, '"').replace(/,\s*$/, '') + ']');

function walk(dir) {
  return readdirSync(join(root, dir)).flatMap((f) => (statSync(join(root, dir, f)).isDirectory() ? walk(dir + '/' + f) : [dir + '/' + f]));
}

test('オフライン用のキャッシュに、アプリのファイルがすべて入っている', () => {
  for (const f of walk('src')) assert.ok(listed.includes(f), f + ' が sw.js の FILES にない');
  for (const f of listed) if (f !== './') assert.ok(existsSync(join(root, f)), f + ' が存在しない');
});

test('マニフェストとアイコン', () => {
  const m = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.display, 'standalone');
  for (const i of m.icons) assert.ok(existsSync(join(root, i.src)));
});

test('公開リポジトリに個人情報（Gmail の差出人・学習計画シートの ID）を入れていない', () => {
  const d = JSON.parse(readFileSync(join(root, 'config/defaults.json'), 'utf8'));
  assert.deepEqual(d.settings.gmailFrom, []);
  assert.equal(d.settings.planSheetId, '');
});
