// 「報連相」画面：期限が近いものが一番上
import { esc } from './util.js';
import { formatMd, diffDays } from '../core/dates.js';
import * as A from '../actions.js';

export function sortHou(list) {
  return list.slice().sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    const da = a.due || '9999-99-99', db = b.due || '9999-99-99';
    return da < db ? -1 : da > db ? 1 : 0;
  });
}

export function render(app) {
  const dk = app.today();
  const all = sortHou(Object.values(app.store.view.hourensou));
  const open = all.filter((h) => !h.done), done = all.filter((h) => h.done);
  const row = (h) => {
    const left = h.due ? diffDays(dk, h.due) : null;
    const cls = h.done ? 'done' : left != null && left < 0 ? 'over' : left != null && left <= 2 ? 'soon' : '';
    return '<li class="hou ' + cls + '"><input type="checkbox" aria-label="完了" data-act="houToggle" data-id="' + esc(h.id) + '"' + (h.done ? ' checked' : '') + '>' +
      '<div class="task-main" data-act="houEdit" data-id="' + esc(h.id) + '"><div><span class="chip kind-' + esc(h.kind) + '">' + esc(h.kind) + '</span> ' + esc(h.to) + '：' + esc(h.what) + '</div>' +
      '<div class="task-meta">' + (h.due ? '期限 ' + formatMd(h.due) + (left < 0 ? '（' + -left + '日過ぎ）' : left === 0 ? '（今日）' : '（あと' + left + '日）') : '期限なし') + '</div></div></li>';
  };
  return '<section class="card"><h2>報連相</h2><ul class="tasks">' + (open.map(row).join('') || '<li class="muted">ありません</li>') + '</ul>' +
    '<button class="primary wide" data-act="houEdit">＋ 追加</button></section>' +
    (done.length ? '<section class="card"><details><summary>完了（' + done.length + '）</summary><ul class="tasks">' + done.map(row).join('') + '</ul></details></section>' : '');
}

function houForm(app, h) {
  const isNew = !h;
  h = h || { to: '', what: '', kind: '報告', due: '' };
  app.modal('<h2>報連相' + (isNew ? 'を追加' : 'を編集') + '</h2><form>' +
    '<label>種類<select name="kind">' + ['報告', '連絡', '相談'].map((k) => '<option' + (h.kind === k ? ' selected' : '') + '>' + k + '</option>').join('') + '</select></label>' +
    '<label>相手<input name="to" required value="' + esc(h.to) + '"></label>' +
    '<label>内容<textarea name="what" rows="3" required>' + esc(h.what) + '</textarea></label>' +
    '<label>期限<input type="date" name="due" value="' + esc(h.due || '') + '"></label>' +
    '<button class="primary wide">保存</button>' + (isNew ? '' : '<button type="button" class="danger wide" data-modal-act="del">削除</button>') + '</form>',
  async (f) => { await A.saveHou(app.store, Object.assign({}, h, { kind: f.kind, to: f.to.trim(), what: f.what.trim(), due: f.due || null })); },
  { del: async () => { if (await app.confirm('削除しますか？', '削除', 'やめる')) { await A.deleteHou(app.store, h.id); app.closeModal(); } } });
}

export const acts = {
  houEdit(app, el) { houForm(app, el.dataset.id ? app.store.view.hourensou[el.dataset.id] : null); },
  async houToggle(app, el) { const h = app.store.view.hourensou[el.dataset.id]; await A.saveHou(app.store, Object.assign({}, h, { done: el.checked })); },
};
