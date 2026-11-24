// 빠르기: [출퇴근기록]을 통째로 읽지 않아요(날짜 칸만 읽고 필요한 줄만), 같은 실행에서 다시 읽지 않아요
// 실행: node --test test/perf.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./gas-mock');

const plain = (x) => JSON.parse(JSON.stringify(x));
const ADMIN = '582941';

function world(days = 120) {
  const g = createGas({ now: Date.parse('2026-11-24T10:30:00+09:00') });
  g.gs.setup();
  g.sheet('매장').getRange(2, 1, 2, 3).setValues([['왕십리', '10:00', '20:00'], ['가산', '12:00', '21:00']]);
  const staff = [];
  for (let i = 0; i < 20; i++) staff.push(['직원' + i, i % 2 ? '가산' : '왕십리', String(100000 + i), 10320, '', '', '', '', '', '', '', '', '', '']);
  g.sheet('직원').getRange(2, 1, staff.length, 14).setValues(staff);
  g.gs.setSetting_('관리자PIN', ADMIN);
  g.gs.setSetting_('앱시작일', '2026-01-01');
  g.gs.setup();
  const rows = [];
  for (let k = days; k >= 0; k--) {
    const d = g.gs.addDays_('2026-11-24', -k);
    for (let i = 0; i < 20; i++) rows.push([d, '월', '직원' + i, '10:00', '20:00', '09:55', k ? '20:05' : '', '', '', '545', '', '', '', '', '', '']);
  }
  rows.push(['2026-10-03', '토', '직원5', '10:00', '20:00', '10:00', '20:00', '', '', '600', '', '', '', '정정으로 나중에 붙은 줄', '', '']); // 날짜 순서가 섞인 줄
  rows.push(['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', '']); // 빈 줄
  const lg = g.sheet('출퇴근기록');
  lg.maxRows = rows.length + 20;
  lg.getRange(2, 1, rows.length, 16).setValues(rows);
  g.gs.MEMO_ = {}; g.gs.GRID_ = {};
  return { g, rows };
}

// 예전처럼 탭 전체를 읽어서 고른 결과(비교용)
function fullScan(g, prefix) {
  const sh = g.sheet('출퇴근기록');
  const n = sh.getLastRow();
  const out = [];
  for (let r = 2; r <= n; r++) {
    const v = sh.rowDisplay(r);
    const d = g.gs.parseDate_(v[0]);
    if (d && d.indexOf(prefix) === 0 && String(v[2]).trim()) out.push(d + '|' + String(v[2]).trim() + '|' + g.gs.fmtTime_(g.gs.parseTime_(v[5])));
  }
  return out.sort();
}
const pick = (g, prefix) => { g.gs.MEMO_ = {}; return plain(g.gs.logRows_(prefix)).map((r) => r.date + '|' + r.name + '|' + r.tIn).sort(); };

test('기록 고르기: 날짜 칸만 읽고 고른 결과가 탭 전체를 읽은 것과 똑같아요(순서가 섞인 줄·빈 줄 포함)', () => {
  const { g } = world();
  for (const prefix of ['2026-11', '2026-10', '2026-10-03', '2026-11-24', '2026-11-23', '2026-08-01', '2026', '2025-12']) {
    assert.deepEqual(pick(g, prefix), fullScan(g, prefix), prefix);
  }
  assert.ok(pick(g, '2026-10-03').some((x) => /직원5/.test(x)), '뒤에 붙은 지난 날짜 줄도 찾아요');
});

test('사장님 [오늘]은 [출퇴근기록]을 통째로 읽지 않아요(마지막 500줄만), [월별]은 날짜 칸 + 그달 줄만', () => {
  const { g, rows } = world(200); // 4,000줄 넘게
  const proto = Object.getPrototypeOf(g.sheet('출퇴근기록').getRange(1, 1));
  let cells = 0;
  const orig = proto.getDisplayValues;
  proto.getDisplayValues = function (...a) { const r = orig.apply(this, a); if (this.sh.name === '출퇴근기록') cells += r.length * (r[0] ? r[0].length : 0); return r; };
  try {
    const all = rows.length * 16;
    cells = 0;
    plain(g.gs.adminToday({ pin: ADMIN, dev: 'a1b2c3d4e5f60718' }));
    assert.ok(cells <= 500 * 16, '[오늘] 읽은 칸 ' + cells + ' (탭 전체 ' + all + ')');
    cells = 0;
    plain(g.gs.adminMonth({ pin: ADMIN, dev: 'a1b2c3d4e5f60718' }, '2026-11'));
    assert.ok(cells < all / 4, '[월별] 읽은 칸 ' + cells + ' (탭 전체 ' + all + ')');
    cells = 0;
    plain(g.gs.getHome('직원3', '100003'));
    assert.ok(cells <= 500 * 16, '직원 첫 화면 읽은 칸 ' + cells);
  } finally {
    proto.getDisplayValues = orig;
  }
});

test('같은 실행 안에서 기록을 쓰면 읽어 둔 것을 잊어요(출근 찍은 뒤 바로 다시 읽어도 새 기록)', () => {
  const { g } = world(3);
  g.gs.setSetting_('위치확인', '안함');
  g.gs.setSetting_('폰확인', '안함');
  g.gs.setSetting_('인사정보필수', '안함');
  g.setKst('2026-11-25 09:58');
  g.gs.MEMO_ = {};
  assert.equal(g.gs.logRows_('2026-11-25').length, 0);
  g.gs.punch({ name: '직원0', pin: '100000', type: 'in', device: 'd0d0d0d0d0d0d0d0', label: 'iPhone', agree: true });
  // 같은 실행처럼(MEMO_를 안 비우고) 다시 읽어요
  assert.equal(plain(g.gs.logRows_('2026-11-25')).length, 1);
  assert.ok(g.gs.findLog_(g.sheet('출퇴근기록'), '2026-11-25', '직원0'));
});

test('승인 버튼은 빠르게: 한 일만 돌려주고 [오늘] 전체는 화면이 뒤에서 다시 받아요', () => {
  const { g } = world(3);
  const r = plain(g.gs.makeRequest({ name: '직원2', pin: '100002', kind: 'off', offType: '휴무', date: '2026-11-27', reason: '병원' }));
  const id = r.mine[0].id;
  const out = plain(g.gs.adminRequest(ADMIN, id, true, true));
  assert.deepEqual(Object.keys(out).sort(), ['doneNote', 'id', 'state']);
  assert.equal(out.state, '승인');
  g.gs.GRID_ = {}; g.gs.MEMO_ = {};
  assert.equal(g.gs.dayMark_('직원2', '2026-11-27'), '휴무');
  assert.ok(plain(g.gs.adminToday(ADMIN)).ms >= 0, '[오늘]은 서버에서 걸린 시간도 알려줘요');
});
