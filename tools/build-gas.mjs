// GAS に貼り付ける 1 ファイル（dist/gas/Code.gs）を作る
// src/core の共通ロジック（アプリと同じ計算）＋ gas/*.gs をつなげる。
// 使い方: npm run build:gas
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const SHARED = ['dates.js', 'tasks.js', 'study.js', 'srs.js', 'planSheet.js', 'dayBuild.js', 'dateExtract.js'];
const GAS = ['Main.gs', 'Db.gs', 'Sync.gs', 'NextDay.gs', 'Calendar.gs', 'Gmail.gs', 'Night.gs', 'Setup.gs'];

export function stripModule(src) {
  return src
    .replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^export\s+(?=(async\s+)?function|const|let|var|class)/gm, '');
}

export function buildGas() {
  const parts = [
    '// ============================================================',
    '// 手帳アプリ用 Google Apps Script（自動生成ファイル。直接編集しないでください）',
    '// 元のファイル: src/core/*.js（アプリと共通の計算）と gas/*.gs',
    '// 作り方: npm run build:gas',
    '// ============================================================',
    '',
  ];
  for (const f of SHARED) parts.push('// ----- src/core/' + f + ' -----', stripModule(readFileSync(join(root, 'src/core', f), 'utf8')), '');
  for (const f of GAS) parts.push('// ----- gas/' + f + ' -----', readFileSync(join(root, 'gas', f), 'utf8'), '');
  return parts.join('\n');
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  mkdirSync(join(root, 'dist/gas'), { recursive: true });
  writeFileSync(join(root, 'dist/gas/Code.gs'), buildGas());
  copyFileSync(join(root, 'gas/appsscript.json'), join(root, 'dist/gas/appsscript.json'));
  console.log('dist/gas/Code.gs を作りました');
}
