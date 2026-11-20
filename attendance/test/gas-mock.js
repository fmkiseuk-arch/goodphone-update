// Code.gs를 Node에서 돌리기 위한 구글 Apps Script 흉내(메모리 안의 가짜 시트).
// 시트처럼: 서식이 '@'(텍스트)가 아닌 칸에 '10:03' 같은 글자를 넣으면 시간으로 바뀌고,
// 화면에는 '오전 10:03:00'처럼 보입니다. 텍스트 서식을 빼먹은 버그를 잡으려고 일부러 이렇게 만들었어요.
const fs = require('fs');
const path = require('path');
const vm = require('vm');

let sheetIds = 0;
// 시트 작업 수를 세는 도구(perf 확인용)가 '여러 칸 한 번에'(RangeList) 호출을 1번으로 셀 수 있게
const hooks = { listCall: null };
// 'B3:D3' → [줄, 칸, 줄 수, 칸 수]
function parseA1(a1) {
  const m = /^([A-Z]+)(\d+)(?::([A-Z]+)(\d+))?$/.exec(a1);
  if (!m) throw new Error('bad A1 ' + a1);
  const col = (x) => x.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0);
  const r1 = Number(m[2]), c1 = col(m[1]);
  const r2 = m[3] ? Number(m[4]) : r1, c2 = m[3] ? col(m[3]) : c1;
  return [r1, c1, r2 - r1 + 1, c2 - c1 + 1];
}

class Range {
  constructor(sh, r, c, nr = 1, nc = 1) {
    if (r < 1 || c < 1 || nr < 1 || nc < 1) throw new Error(`bad range ${r},${c},${nr},${nc}`);
    if (r + nr - 1 > sh.maxRows || c + nc - 1 > sh.maxCols) throw new Error('The coordinates of the range are outside the dimensions of the sheet.');
    Object.assign(this, { sh, r, c, nr, nc });
  }
  each(fn) { for (let i = 0; i < this.nr; i++) for (let j = 0; j < this.nc; j++) fn(this.r + i, this.c + j, i, j); }
  setValues(vals) {
    if (vals.length !== this.nr || vals.some((row) => row.length !== this.nc)) throw new Error('dimension mismatch');
    this.each((r, c, i, j) => this.sh.set(r, c, vals[i][j]));
    return this;
  }
  setValue(v) { return this.setValues([[v]]); }
  setFormula(f) { this.each((r, c) => this.sh.set(r, c, f)); return this; }
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
  getDisplayValue() { return this.getDisplayValues()[0][0]; }
  getValue() { return this.getValues()[0][0]; }
  setFontWeight() { return this; }
  setFontWeights(ws) {
    this.sh.weights = this.sh.weights || {};
    this.each((r, c, i, j) => { this.sh.weights[r + ',' + c] = ws[i][j]; });
    return this;
  }
  // 배경: 칠한 범위를 순서대로 기록해요(테스트에서 주말 음영 확인용)
  setBackground(color) { this.sh.bgs = this.sh.bgs || []; this.sh.bgs.push({ r: this.r, c: this.c, nr: this.nr, nc: this.nc, color }); return this; }
  // 선: 아래쪽 선을 줄마다 기록해요. 모두 false 면 지워요
  setBorder(top, left, bottom, right, vertical, horizontal, color, style) {
    this.sh.borders = this.sh.borders || {};
    if ([top, left, bottom, right, vertical, horizontal].every((x) => x === false)) {
      for (let i = 0; i < this.nr; i++) delete this.sh.borders[this.r + i];
    } else if (bottom === true) {
      this.sh.borders[this.r + this.nr - 1] = style || 'SOLID';
    }
    return this;
  }
  createFilter() { this.sh.filter = { range: [this.r, this.c, this.nr, this.nc], remove: () => { this.sh.filter = null; } }; return this.sh.filter; }
  setFontColor() { return this; }
  setHorizontalAlignment() { return this; }
  setNote(n) { this.sh.notes = this.sh.notes || {}; this.sh.notes[this.r + ',' + this.c] = n; return this; }
  setNotes(ns) {
    if (ns.length !== this.nr || ns.some((row) => row.length !== this.nc)) throw new Error('dimension mismatch');
    this.sh.notes = this.sh.notes || {};
    this.each((r, c, i, j) => { if (ns[i][j]) this.sh.notes[r + ',' + c] = ns[i][j]; else delete this.sh.notes[r + ',' + c]; });
    return this;
  }
  setFontColors(cs) {
    if (cs.length !== this.nr || cs.some((row) => row.length !== this.nc)) throw new Error('dimension mismatch');
    this.sh.colors = this.sh.colors || {};
    this.each((r, c, i, j) => { this.sh.colors[r + ',' + c] = cs[i][j]; });
    return this;
  }
  setDataValidation(v) { this.sh.validations = this.sh.validations || {}; this.sh.validations[this.r + ',' + this.c] = v; return this; }
  getDataValidation() { return (this.sh.validations || {})[this.r + ',' + this.c] || null; }
  insertCheckboxes() { this.each((r, c) => this.sh.set(r, c, false)); return this; }
  setFontSize() { return this; }
  setBackgrounds(bs) {
    this.sh.bgCells = this.sh.bgCells || {};
    this.each((r, c, i, j) => { this.sh.bgCells[r + ',' + c] = bs[i][j]; });
    return this;
  }
  clear() {
    this.each((r, c) => {
      const k = r + ',' + c;
      this.sh.cells.delete(k);
      this.sh.fmts.delete(k);
      if (this.sh.notes) delete this.sh.notes[k];
    });
    return this;
  }
}

// 세기 도구가 Range 메서드를 감싸기 전에 원래 것을 기억해 둬요(RangeList 가 직접 써요)
const RANGE_IMPL = {};
for (const k of Object.getOwnPropertyNames(Range.prototype)) RANGE_IMPL[k] = Range.prototype[k];

class Sheet {
  constructor(name) { this.name = name; this.cells = new Map(); this.fmts = new Map(); this.maxRows = 1000; this.maxCols = 26; this.id = ++sheetIds; }
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
  getMaxColumns() { return this.maxCols; }
  insertColumnsAfter(_after, n) { this.maxCols += n; }
  // c번째 칸 앞에 n칸을 끼워 넣어요(그 칸부터 오른쪽으로 밀려요)
  insertColumnsBefore(c, n) {
    const shift = (m) => {
      if (!m) return m;
      const isMap = m instanceof Map;
      const out = isMap ? new Map() : {};
      for (const [k, v] of isMap ? m : Object.entries(m)) {
        const [rr, cc] = k.split(',').map(Number);
        const nk = rr + ',' + (cc >= c ? cc + n : cc);
        if (isMap) out.set(nk, v); else out[nk] = v;
      }
      return out;
    };
    this.cells = shift(this.cells);
    this.fmts = shift(this.fmts);
    this.notes = shift(this.notes);
    this.colors = shift(this.colors);
    this.maxCols += n;
    return this;
  }
  // 진짜 시트처럼 after 아래 줄이 n칸씩 내려가요
  insertRowsAfter(after, n) {
    const shift = (m) => {
      if (!m) return m;
      const isMap = m instanceof Map;
      const out = isMap ? new Map() : {};
      for (const [k, v] of isMap ? m : Object.entries(m)) {
        const [rr, cc] = k.split(',').map(Number);
        const nk = (rr > after ? rr + n : rr) + ',' + cc;
        if (isMap) out.set(nk, v); else out[nk] = v;
      }
      return out;
    };
    this.cells = shift(this.cells);
    this.fmts = shift(this.fmts);
    this.notes = shift(this.notes);
    this.colors = shift(this.colors);
    if (this.borders) {
      const b = {};
      for (const [rr, v] of Object.entries(this.borders)) b[Number(rr) > after ? Number(rr) + n : rr] = v;
      this.borders = b;
    }
    // 끼워 넣은 줄은 바로 위 줄 서식을 따라가요
    for (let c = 1; c <= this.maxCols; c++) {
      const f = this.fmts.get(after + ',' + c);
      if (f) for (let i = 1; i <= n; i++) this.fmts.set((after + i) + ',' + c, f);
    }
    this.maxRows += n;
  }
  getFilter() { return this.filter || null; }
  getRange(r, c, nr, nc) { return new Range(this, r, c, nr, nc); }
  // 여러 칸에 같은 서식을 한 번에(진짜 RangeList 처럼). 세기 도구에는 1번으로 보여요
  getRangeList(list) {
    const ranges = list.map((a) => new Range(this, ...parseA1(a)));
    const proxy = new Proxy({}, {
      get: (_, k) => (...args) => {
        if (hooks.listCall) hooks.listCall(k);
        ranges.forEach((r) => RANGE_IMPL[k].apply(r, args));
        return proxy;
      },
    });
    return proxy;
  }
  setColumnWidths(c, n, w) { this.widths = this.widths || {}; for (let i = 0; i < n; i++) this.widths[c + i] = w; return this; }
  // 진짜 시트처럼 아래 줄이 한 칸씩 올라와요(값·서식·메모·글자색 모두)
  deleteRow(r) {
    const shift = (m) => {
      if (!m) return m;
      const isMap = m instanceof Map;
      const out = isMap ? new Map() : {};
      for (const [k, v] of isMap ? m : Object.entries(m)) {
        const [rr, cc] = k.split(',').map(Number);
        if (rr === r) continue;
        const nk = (rr > r ? rr - 1 : rr) + ',' + cc;
        if (isMap) out.set(nk, v); else out[nk] = v;
      }
      return out;
    };
    this.cells = shift(this.cells);
    this.fmts = shift(this.fmts);
    this.notes = shift(this.notes);
    this.colors = shift(this.colors);
    this.maxRows--;
    return this;
  }
  appendRow(vals) { const r = this.getLastRow() + 1; if (r > this.maxRows) this.maxRows = r; this.getRange(r, 1, 1, vals.length).setValues([vals]); return this; }
  clear() {
    this.cells.clear(); this.fmts.clear(); this.borders = {}; this.bgs = [];
    this.bgCells = {}; this.validations = {}; this.colors = {}; this.weights = {}; this.notes = {};
    return this;
  }
  setFrozenRows() {}
  setFrozenColumns() {}
  setColumnWidth(c, w) { this.widths = this.widths || {}; this.widths[c] = w; return this; }
  setConditionalFormatRules(rules) { this.cfRules = rules; }
  // 테스트용: 사람이 보는 그대로 한 줄 읽기
  rowDisplay(r) { const n = this.getLastColumn(); return this.getRange(r, 1, 1, n).getDisplayValues()[0]; }
}

function createGas({ now, file = path.join(__dirname, '..', 'Code.gs') }) {
  const sheets = [];
  const book = {
    getSheetByName: (n) => sheets.find((s) => s.name === n) || null,
    insertSheet: (n, idx) => { if (sheets.some((x) => x.name === n)) throw new Error('A sheet with the name "' + n + '" already exists.'); const s = new Sheet(n); if (typeof idx === 'number') sheets.splice(idx, 0, s); else sheets.push(s); return s; },
    getSheets: () => sheets.slice(),
    getUrl: () => 'https://docs.google.com/spreadsheets/d/TEST',
    setSpreadsheetTimeZone: () => {},
    setActiveSheet: () => {},
    toast: () => {},
  };
  const cache = new Map();
  const openedIds = [];
  let lockBusy = false; // true 로 바꾸면 '줄이 너무 길어서 못 들어감'을 흉내 내요
  const props = new Map();
  const mails = [];
  const triggers = [];
  // 가짜 텔레그램: tg.updates 에 봇이 받은 메시지를 넣고, tg.sent 로 보낸 메시지를 확인해요.
  const tg = { sent: [], calls: [], updates: [], down: false, bot: 'goodphone_test_bot' };
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
      openById: (id) => { openedIds.push(id); return book; },
      getUi: () => { throw new Error('Cannot call SpreadsheetApp.getUi() from this context.'); },
      flush: () => {},
      BorderStyle: { SOLID: 'SOLID', SOLID_MEDIUM: 'SOLID_MEDIUM', SOLID_THICK: 'SOLID_THICK' },
      newDataValidation: () => {
        const rule = { calls: [] };
        const b = new Proxy({}, { get: (_, k) => (k === 'build' ? () => rule : (...a) => { rule.calls.push([k, ...a]); return b; }) });
        return b;
      },
      newConditionalFormatRule: () => {
        const rule = { calls: [] };
        const b = new Proxy({}, { get: (_, k) => (k === 'build' ? () => rule : (...a) => { rule.calls.push([k, ...a]); return b; }) });
        return b;
      },
    },
    CacheService: { getScriptCache: () => ({ get: (k) => (cache.has(k) ? cache.get(k) : null), put: (k, v) => cache.set(k, v), remove: (k) => cache.delete(k) }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, tryLock() { return !lockBusy; }, releaseLock() {} }) },
    PropertiesService: {
      getScriptProperties: () => ({
        getProperties: () => Object.fromEntries(props),
        getProperty: (k) => (props.has(k) ? props.get(k) : null),
        setProperty: (k, v) => props.set(k, v),
        deleteProperty: (k) => props.delete(k),
      }),
    },
    MailApp: { sendEmail: (to, subject, body) => mails.push({ to, subject, body }) },
    UrlFetchApp: {
      fetch: (url, opts) => {
        const m = /^https:\/\/api\.telegram\.org\/bot([^/]+)\/(\w+)$/.exec(url);
        if (!m) throw new Error('unexpected fetch ' + url);
        const [, token, method] = m;
        const payload = JSON.parse(opts.payload || '{}');
        tg.calls.push({ token, method, payload });
        let code = 200, body;
        if (tg.down) { code = 502; body = 'Bad Gateway'; }
        else if (!/^\d+:[A-Za-z0-9_-]{30,}$/.test(token) || token.endsWith('BAD')) { code = 401; body = JSON.stringify({ ok: false, description: 'Unauthorized' }); }
        else if (method === 'getMe') body = JSON.stringify({ ok: true, result: { username: tg.bot } });
        else if (method === 'getUpdates') body = JSON.stringify({ ok: true, result: tg.updates });
        else if (method === 'sendMessage') { tg.sent.push(payload); body = JSON.stringify({ ok: true, result: {} }); }
        else body = JSON.stringify({ ok: false, description: 'unknown method' });
        return { getResponseCode: () => code, getContentText: () => body };
      },
    },
    ScriptApp: {
      getProjectTriggers: () => triggers.slice(),
      deleteTrigger: (t) => triggers.splice(triggers.indexOf(t), 1),
      newTrigger: (fn) => {
        const b = { kind: 'time', timeBased: () => b, everyMinutes: () => b, forSpreadsheet: () => { b.kind = 'sheet'; return b; }, onEdit: () => { b.kind = 'edit'; return b; },
          create: () => { const t = { getHandlerFunction: () => fn, kind: b.kind }; triggers.push(t); return t; } };
        return b;
      },
      getService: () => ({ getUrl: () => 'https://script.google.com/macros/s/TEST/exec' }),
    },
    Utilities: { getUuid: () => require('crypto').randomUUID() },
    HtmlService: {
      createHtmlOutputFromFile: (f) => { const o = { file: f, setTitle: (x) => { o.title = x; return o; }, addMetaTag: () => o }; return o; },
      createHtmlOutput: (html) => { const o = { html, setTitle: (x) => { o.title = x; return o; }, addMetaTag: () => o }; return o; },
    },
  };
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: path.basename(file) });
  // 진짜 Apps Script는 화면에서 부를 때마다 새로 실행돼요(전역 변수 초기화). 휴무표 기억(GRID_)도 매번 비워요.
  let depth = 0;
  for (const k of Object.keys(ctx)) {
    if (typeof ctx[k] === 'function' && !k.endsWith('_') && /^[a-z]/.test(k)) {
      const fn = ctx[k];
      ctx[k] = function (...a) {
        // 바깥(화면·트리거)에서 부를 때만 새 실행처럼 비워요. 안에서 서로 부를 땐 그대로(진짜 Apps Script와 같게)
        if (depth === 0) { if (ctx.GRID_) ctx.GRID_ = {}; if (ctx.MEMO_) ctx.MEMO_ = {}; }
        depth++;
        try { return fn.apply(this, a); } finally { depth--; }
      };
    }
  }

  return {
    gs: ctx,
    book,
    sheet: (n) => book.getSheetByName(n),
    mails,
    triggers,
    tg,
    openedIds,
    setLockBusy(v) { lockBusy = v; },
    cache,
    /** 'YYYY-MM-DD HH:mm' (한국 시간) 으로 시계를 맞춰요. */
    setKst(s) { clock = Date.parse(s.replace(' ', 'T') + ':00+09:00'); },
  };
}

module.exports = { createGas, Sheet, hooks };
