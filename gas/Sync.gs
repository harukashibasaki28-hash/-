// ===== 同期 =====
// アプリ → { since, changes:[{kind,id,data,updatedAt,deleted}], prepare:'YYYY-MM-DD', planUpdates:[...] }
// GAS → { ok, rev, records:[...since 以降の変更...] }
// 1 件ごとに updatedAt が新しい方を採用（後勝ち）。

var ALL_KINDS = ['day', 'task', 'hou', 'tpl', 'subj', 'cfg', 'inbox', 'plan'];

function handleSync(body) {
  var lock = LockService.getScriptLock();
  lock.waitLock(25000);
  try {
    var stores = openStores_(ALL_KINDS);
    var changes = body.changes || [];
    var accepted = 0;
    for (var i = 0; i < changes.length; i++) {
      var c = changes[i];
      if (!c || !SHEETS[c.kind] || !c.id) continue;
      var cur = getRec_(stores, c.kind, String(c.id));
      if (cur && cur.updatedAt && c.updatedAt && String(c.updatedAt) < String(cur.updatedAt)) continue; // サーバーの方が新しい
      var st = stores[c.kind];
      if (!cur) { cur = { kind: c.kind, id: String(c.id) }; st.index[cur.id] = st.rows.length; st.rows.push(cur); }
      cur.data = c.data || {}; cur.deleted = !!c.deleted; cur.updatedAt = c.updatedAt || toIso(new Date());
      cur.device = body.device || ''; cur.rev = nextRev_();
      (stores._dirty[c.kind] = stores._dirty[c.kind] || []).push(cur);
      accepted++;
    }
    flushStores_(stores);

    if (body.prepare) {
      try { prepareDay_(stores, body.prepare, 'actual'); flushStores_(stores); }
      catch (e) { console.error('prepare: ' + (e && e.stack || e)); }
    }
    if (body.planUpdates && body.planUpdates.length) {
      try { applyPlanUpdates_(stores, body.planUpdates); } catch (e) { console.error('planUpdates: ' + e); }
    }

    var since = Number(body.since || 0);
    var out = [];
    for (var k = 0; k < ALL_KINDS.length; k++) {
      var rows = stores[ALL_KINDS[k]].rows;
      for (var r = 0; r < rows.length; r++) {
        var x = rows[r];
        if (x.rev > since) out.push({ kind: x.kind, id: x.id, data: x.data, updatedAt: x.updatedAt, deleted: x.deleted, rev: x.rev });
      }
    }
    return { ok: true, accepted: accepted, rev: currentRev_(), records: out, now: toIso(new Date()) };
  } finally {
    lock.releaseLock();
  }
}
