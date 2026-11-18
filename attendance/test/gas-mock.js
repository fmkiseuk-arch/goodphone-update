// Code.gs를 Node에서 돌리기 위한 구글 Apps Script 흉내(메모리 안의 가짜 시트).
// 시트처럼: 서식이 '@'(텍스트)가 아닌 칸에 '10:03' 같은 글자를 넣으면 시간으로 바뀌고,
// 화면에는 '오전 10:03:00'처럼 보입니다. 텍스트 서식을 빼먹은 버그를 잡으려고 일부러 이렇게 만들었어요.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let sheetIds = 0;

class Range {
  constructor(sh, r, c, nr = 1, nc = 1) {
    if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error(`bad range ${r},${c},${nr},${nc}`);
    if (r + nr - 1 > sh.maxRows) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    Object.assign(this, { sh, r, c, nr, nc });
  }
  each(fn) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) fn(this.r + i, this.c + j, i, j); }
  setValues(vals) {
    if (vals.length !== this.nr || vals.some((row) => row.length !== this.nc)) throw new Error('dimension mismatch');
    this.each((r, c, i, j) => this.sh.set(r, c, vals[i][j]));
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  getValues() { const out = []; for (let i = 0; i < this.nr; i++) { const row = []; for (let j = 0; j < this.nc; j++) row.push(this.sh.get(this.r + i, this.c + j)); out.push(row); } return out; }
  getDisplayValues() {
    return this.getValues().map((row, i) => row.map((v, j) => this.sh.display(v, this.sh.fmt(this.r + i, this.c + j))));
  }
  setNumberFormat(f) { this.each((r, c) => this.sh.setFmt(r, c, f)); return this; }
  setNumberFormats(fs2) { this.each((r, c, i, j) => this.sh.setFmt(r, c, fs2[i][j])); return this; }
  getRow() { return this.r; }
  getColumn() { return this.c; }
  getNumRows() { return this.nr; }
  getNumColumns() { return this.nc; }
  getSheet() { return this.sh; }
  setFontWeight() { return this; }
  setBackground() { return this; }
}

class Sheet {
  constructor(name) { this.name = name; this.cells = new Map(); this.fmts = new Map(); this.maxRows = 1000; this.id = ++sheetIds; }
  key(r, c) { return r + ',' + c; }
  get(r, c) { const v = this.cells.get(this.key(r, c)); return v === undefined ? '' : v; }
  fmt(r, c) { return this.fmts.get(this.key(r, c)) || ''; }
  setFmt(r, c, f) { this.fmts.set(this.key(r, c), f); }
  set(r, c, v) {
    const f = this.fmt(r, c);
    if (typeof v === 'string' && f !== '@') {
      if (/^\d{1,2}:\d{2}$/.test(v)) { const [h, m] = v.split(':').map(Number); v = { time: h * 60 + m }; }
      else if (/^\d{4}-\d{2}-\d{2}$/.test(v)) v = { date: v };
      else if (/^-?[\d,]+(\.\d+)?$/.test(v) && v !== '') v = Number(v.replace(/,/g, ''));
    }
    if (v === '' || v == null) this.cells.delete(this.key(r, c)); else this.cells.set(this.key(r, c), v);
  }
  display(v, f) {
    if (v === '' || v == null) return '';
    if (typeof v === 'object' && 'time' in v) {
      const h = Math.floor(v.time / 60), m = v.time % 60;
      return `${h < 12 ? '오전' : '오후'} ${h % 12 || 12}:${String(m).padStart(2, '0')}:00`;
    }
    if (typeof v === 'object' && 'date' in v) { const [y, mo, d] = v.date.split('-').map(Number); return `${y}. ${mo}. ${d}`; }
    if (typeof v === 'number') return f === '#,##0' ? Math.round(v).toLocaleString('en-US') : String(v);
    return String(v);
  }
  getName() { return this.name; }
  getSheetId() { return this.id; }
  getLastRow() { let n = 0; for (const k of this.cells.keys()) n = Math.max(n, Number(k.split(',')[0])); return n; }
  getLastColumn() { let n = 0; for (const k of this.cells.keys()) n = Math.max(n, Number(k.split(',')[1])); return n; }
  getMaxRows() { return this.maxRows; }
  insertRowsAfter(_after, n) { this.maxRows += n; }
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr, nc); }
  appendRow(vals) { const r = this.getLastRow() + 1; if (r > this.maxRows) this.maxRows = r; this.getRange(r, 1, 1, vals.length).setValues([vals]); return this; }
  clear() { this.cells.clear(); this.fmts.clear(); return this; }
  setFrozenRows() {}
  setColumnWidth() {}
  // 테스트용: 사람이 보는 그대로 한 줄 읽기
  rowDisplay(r) { const n = this.getLastColumn(); return this.getRange(r, 1, 1, n).getDisplayValues()[0]; }
}

function createGas({ now }) {
  const sheets = [];
  const book = {
    getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    insertSheet: (n) => { const s = new Sheet(n); sheets.push(s); return s; },
    getSheets: () => sheets.slice(),
    getUrl: () => 'https://docs.google.com/spreadsheets/d/TEST',
    setSpreadsheetTimeZone: () => {},
    setActiveSheet: () => {},
    toast: () => {},
  };
  const cache = new Map();
  const props = new Map();
  const mails = [];
  const triggers = [];
  let clock = now;

  class FakeDate extends Date {
    constructor(...a) { if (a.length) super(...a); else super(clock); }
    static now() { return clock; }
  }

  const ctx = {
    console,
    Date: FakeDate,
    SpreadsheetApp: {
      getActiveSpreadsheet: () => book,
      getActive: () => book,
      getUi: () => { throw new Error('Cannot call SpreadsheetApp.getUi() from this context.'); },
      flush: () => {},
    },
    CacheService: { getScriptCache: () => ({ get: (k) => (cache.has(k) ? cache.get(k) : null), put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperties: () => Object.fromEntries(props),
        setProperty: (k, v) => props.set(k, v),
        deleteProperty: (k) => props.delete(k),
      }),
    },
    MailApp: { sendEmail: (to, subject, body) => mails.push({ to, subject, body }) },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
      newTrigger: (fn) => {
        const b = { timeBased: () => b, everyMinutes: () => b, create: () => { const t = { getHandlerFunction: () => fn }; triggers.push(t); return t; } };
        return b;
      },
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }),
    },
    HtmlService: {
      createHtmlOutputFromFile: (f) => { const o = { file: f, setTitle: () => o, addMetaTag: () => o }; return o; },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'Code.gs'), 'utf8'), ctx, { filename: 'Code.gs' });

  return {
    gs: ctx,
    book,
    sheet: (n) => book.getSheetByName(n),
    mails,
    triggers,
    cache,
    /** 'YYYY-MM-DD HH:mm' (한국 시간) 으로 시계를 맞춰요. */
    setKst(s) { clock = Date.parse(s.replace(' ', 'T') + ':00+09:00'); },
  };
}

module.exports = { createGas, Sheet };
