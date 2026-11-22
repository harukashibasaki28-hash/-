import vm from 'node:vm';
import { buildGas } from '../../tools/build-gas.mjs';

export function fakeSheet(name, values) {
  const data = values ? values.map((r) => r.slice()) : [];
  const sh = {
    name, data,
    getName: () => name,
    getLastRow: () => data.length,
    setFrozenRows() {}, setTabColor() {}, setColumnWidth() {}, clear() { data.length = 0; },
    getProtections: () => [], protect: () => ({ setDescription() { return { setWarningOnly() {} }; } }),
    getDataRange: () => sh.getRange(1, 1, data.length, Math.max(...data.map((r) => r.length), 1)),
    getRange(r, c, nr, nc) {
      if (typeof r === 'string') return { setNumberFormat() { return this; }, setFontWeight() { return this; }, setFontSize() { return this; }, setValues() {} };
      nr = nr || 1; nc = nc || 1;
      const rng = {
        getValues: () => { const out = []; for (let i = 0; i < nr; i++) { const row = data[r - 1 + i] || []; const o = []; for (let j = 0; j < nc; j++) o.push(row[c - 1 + j] == null ? '' : row[c - 1 + j]); out.push(o); } return out; },
        setValues(vals) { for (let i = 0; i < vals.length; i++) { data[r - 1 + i] = data[r - 1 + i] || []; for (let j = 0; j < vals[i].length; j++) data[r - 1 + i][c - 1 + j] = vals[i][j]; } return rng; },
        setValue(v) { data[r - 1] = data[r - 1] || []; data[r - 1][c - 1] = v; return rng; },
        setNumberFormat() { return rng; }, setFontWeight() { return rng; },
      };
      rng.getDisplayValues = () => rng.getValues().map((row) => row.map(String));
      return rng;
    },
  };
  return sh;
}

export function fakeBook(sheets) {
  const list = sheets || [];
  return {
    sheets: list,
    getSheetByName: (n) => list.find((s) => s.name === n) || null,
    insertSheet(n) { const s = fakeSheet(n); list.push(s); return s; },
    getSheets: () => list, deleteSheet() {},
  };
}

export function makeEnv(planBook) {
  const props = {};
  const db = fakeBook([]);
  const env = {
    console,
    SpreadsheetApp: { getActive: () => db, openById: () => planBook, ProtectionType: { SHEET: 'SHEET' } },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => (k in props ? props[k] : null), setProperty: (k, v) => { props[k] = v; } }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    CacheService: { getScriptCache: () => { const c = {}; return { get: (k) => c[k] || null, put: (k, v) => { c[k] = v; } }; } },
    ContentService: { MimeType: { JSON: 'json', TEXT: 'text' }, createTextOutput: (s) => ({ s, setMimeType() { return this; } }) },
    CalendarApp: { getDefaultCalendar: () => ({ getEventsForDay: () => [] }) },
    Utilities: { formatDate: () => '00:00', getUuid: () => 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' },
    ScriptApp: { getProjectTriggers: () => [], deleteTrigger() {}, newTrigger: () => ({ timeBased: () => ({ at: () => ({ create() {} }) }) }) },
  };
  const ctx = vm.createContext(env);
  vm.runInContext(buildGas(), ctx);
  props.API_KEY = 'k'.repeat(64);
  ctx.__db = db;
  return { ctx, props, db };
}

