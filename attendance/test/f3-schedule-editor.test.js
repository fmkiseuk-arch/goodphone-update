// 사장님 화면 [근무표]: 그 달 휴무표를 보고 바로 고치기 (adminGrid · adminSetMark)
// 실행: node --test attendance/test/f3-schedule-editor.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./gas-mock');

const plain = (x) => JSON.parse(JSON.stringify(x));
const ADMIN = '582941';
const MGR = { name: '박점장', pin: '246813' };
const TOKEN = '123456789:' + 'A'.repeat(35);
const ROW = { 김민우: 2, 이지은: 3, 박점장: 5, 최유나: 6 }; // [직원] 탭 줄
const PHONE = { 김민우: 'aaaaaaaaaaaaaaaa', 이지은: 'bbbbbbbbbbbbbbbb' };
const NEAR = { lat: 37.5668, lng: 126.978, acc: 20 };

// setup이 적는 진행 글은 테스트 출력에서 빼요
function quiet(fn) {
  const log = console.log;
  console.log = () => {};
  try { return fn(); } finally { console.log = log; }
}

// 인사 정보를 다 넣어요(출근하려면 꼭 있어야 해요). 입사일은 따로 안 주면 2020-01-01
let hrSeq = 0;
function hrFill(g, over = {}) {
  for (const p of g.gs.staff_().filter((x) => x.active)) {
    g.gs.MEMO_ = {};
    if (!g.gs.hrFind_(p.name)) g.gs.syncHr_();
    const h = g.gs.hrFind_(p.name);
    if (!h) continue;
    hrSeq++;
    const rrn = '8001' + String(10 + (hrSeq % 18)).padStart(2, '0') + '1' + String(100000 + hrSeq).slice(-6);
    g.gs.hrWrite_(h.row, {
      rrn: g.gs.rrnMask_(rrn), enc: g.gs.rrnEncrypt_(rrn), phone: '010-1000-' + String(1000 + hrSeq), addr: '서울 성동구', bank: '국민',
      account: '123456-78-' + String(900000 + hrSeq), emergency: '010-9999-8888 가족', start: '2020-01-01', ...(over[p.name] || {}),
    });
  }
  g.gs.MEMO_ = {};
}

// 2026-11-16(월) 09:00. 왕십리(10:00-20:00, 점장 박점장), 가산(12:00-21:00)
// 김민우(왕십리): 토·일은 [직원] 요일 칸에 '휴무' / 이지은(가산): 수·일 휴무, 11/27까지 다녀요 / 최유나(가산): 11/10 입사 / 박퇴사: 재직 X
function fresh() {
  const g = createGas({ now: Date.parse('2026-11-16T09:00:00+09:00') });
  quiet(() => g.gs.setup());
  g.sheet('매장').getRange(2, 1, 2, 7).setValues([
    ['왕십리', '10:00', '20:00', '', '', '', ''],
    ['가산', '12:00', '21:00', '', '', '', ''],
  ]);
  //            이름      매장      PIN       시급   월  화  수      목  금  토      일      재직 등록폰 새폰요청
  g.sheet('직원').getRange(2, 1, 5, 14).setValues([
    ['김민우', '왕십리', '0123', 12000, '', '', '', '', '', '휴무', '휴무', '', '', ''],
    ['이지은', '가산', '5678', 10320, '', '', '휴무', '', '', '', '휴무', '', '', ''],
    ['박퇴사', '왕십리', '9999', 10320, '', '', '', '', '', '', '', 'X', '', ''],
    ['박점장', '왕십리', '246813', 12000, '', '', '', '', '', '', '', '', '', ''],
    ['최유나', '가산', '1357', 10320, '', '', '', '', '', '', '', '', '', ''],
  ]);
  g.sheet('매장').getRange(2, 8).setValue('박점장');
  g.gs.setSetting_('관리자PIN', ADMIN);
  g.gs.setSetting_('앱시작일', '2026-01-01');
  g.gs.adminSetPlace(ADMIN, '왕십리', 37.5665, 126.978);
  quiet(() => g.gs.setup()); // 새 직원 줄을 휴무표에
  hrFill(g, { 이지은: { end: '2026-11-27' }, 최유나: { start: '2026-11-10' } });
  return g;
}
const tgOn = (g, chats = {}) => {
  g.gs.setSetting_('텔레그램토큰', TOKEN);
  g.gs.setSetting_('텔레그램채팅ID', '555');
  for (const [n, id] of Object.entries(chats)) g.gs.setStaffCell_(ROW[n], '텔레그램', id);
};
const sent = (g, chat) => g.tg.calls.filter((c) => c.method === 'sendMessage' && String(c.payload.chat_id) === String(chat)).map((c) => c.payload);
const setMark = (g, date, name, v) => { g.gs.GRID_ = {}; g.gs.setMark_(date, name, () => v); g.gs.GRID_ = {}; };
const mark = (g, name, date) => { g.gs.GRID_ = {}; g.gs.MEMO_ = {}; return g.gs.dayMark_(name, date); };
// 휴무표 그 칸의 메모
const note = (g, name, date) => {
  g.gs.GRID_ = {};
  const gr = g.gs.monthGrid_(date.slice(0, 7), true);
  return (gr.sh.notes || {})[gr.rows[name].row + ',' + (gr.cols.day1 + Number(date.slice(8)))] || '';
};
// 그 달 휴무표의 날짜 칸 전부(바뀌지 않았는지 볼 때)
const days = (g, ym) => {
  g.gs.GRID_ = {};
  const gr = g.gs.monthGrid_(ym, true);
  return Object.keys(gr.rows).map((n) => n + ':' + gr.rows[n].vals.slice(gr.cols.day1, gr.cols.day1 + 31).join('|')).join('\n');
};
const rowOf = (d, store, name) => d.stores.find((s) => s.name === store).rows.find((r) => r.name === name);
const sched = (g, name, date) => { g.gs.GRID_ = {}; g.gs.MEMO_ = {}; return g.gs.fmtSched_(g.gs.schedFor_(g.gs.findStaff_(name), date)); };

test('근무표 보기: 관리자는 매장마다 휴무표 줄 순서·칸 글자 그대로 봐요(요일 휴무, 입사 전·퇴사 뒤, 쉬는 사람 수)', () => {
  const g = fresh();
  g.gs.adminTestStaff(ADMIN, '왕십리'); // 테스트 직원 줄은 근무표에 안 나와요
  setMark(g, '2026-11-18', '김민우', '휴무');
  setMark(g, '2026-11-17', '김민우', '10:07');
  setMark(g, '2026-11-13', '김민우', '결근?');
  setMark(g, '2026-11-20', '박점장', '대타');
  setMark(g, '2026-11-19', '이지은', '반차');
  setMark(g, '2026-11-24', '이지은', '휴무?');
  setMark(g, '2026-11-12', '이지은', '왕십리');
  setMark(g, '2026-11-28', '이지은', '퇴사');
  const d = plain(g.gs.adminGrid(ADMIN, '2026-11'));
  assert.equal(d.ym, '2026-11');
  assert.equal(d.today, '2026-11-16');
  assert.equal(d.days, 30);
  assert.equal(d.firstDow, 0, '11/1은 일요일');
  assert.equal(d.admin, true);
  assert.equal(d.closed, false);
  assert.equal(d.hasTab, true);
  assert.deepEqual(d.marks, ['휴무', '월차', '반차', '무급', '대체', '결근']);
  assert.equal(d.store, '왕십리', '처음엔 줄이 있는 첫 매장');
  assert.deepEqual(d.stores.map((s) => s.name), ['왕십리', '가산'], '[매장] 탭 순서. 예시직원(본점) 줄은 빠져요');
  assert.deepEqual(d.stores[0].rows.map((r) => r.name), ['김민우', '박점장'], '테스트 직원 줄은 빠져요');
  assert.deepEqual(d.stores[1].rows.map((r) => r.name), ['이지은', '최유나']);
  assert.match(d.url, /#gid=\d+$/, '관리자는 시트 탭 바로가기');
  const kim = rowOf(d, '왕십리', '김민우');
  assert.equal(kim.cells.length, 30);
  assert.equal(kim.cells[17], '휴무');
  assert.equal(kim.cells[16], '10:07');
  assert.equal(kim.cells[12], '결근?');
  assert.deepEqual(kim.reg, [1, 7, 8, 14, 15, 21, 22, 28, 29], '빈 칸 + [직원] 토·일 휴무');
  assert.equal(kim.off, 1, '휴무표 휴무 칸 수식과 같게(휴무 + 휴가 + 반차×0.5)');
  assert.deepEqual([kim.from, kim.to], [1, 30]);
  assert.equal(kim.sub, 0);
  const lee = rowOf(d, '가산', '이지은');
  assert.equal(lee.cells[11], '왕십리', '지원 간 매장 이름도 그대로');
  assert.equal(lee.cells[27], '퇴사');
  assert.deepEqual([lee.from, lee.to], [1, 27], '마지막 근무일 11/27');
  assert.equal(lee.off, 1.5, '휴무?(1) + 반차(0.5)');
  assert.ok(!lee.reg.includes(29), '퇴사 뒤 일요일은 요일 휴무로 안 세요');
  const choi = rowOf(d, '가산', '최유나');
  assert.deepEqual([choi.from, choi.to], [10, 30], '입사일 11/10');
  // 쉬는 사람: 휴무·고른 휴무?·요일 휴무는 세고, 반차·대타·지원·결근?은 안 세요
  const wang = d.stores[0], gasan = d.stores[1];
  assert.equal(wang.maxOff, 1);
  assert.equal(wang.offCount[17], 1, '11/18 김민우 휴무');
  assert.equal(wang.offCount[20], 1, '11/21(토) 김민우 요일 휴무');
  assert.equal(wang.offCount[19], 0, '11/20 대타는 쉬는 게 아니에요');
  assert.equal(wang.offCount[12], 0, '결근?은 쉬는 날로 안 세요');
  assert.equal(gasan.offCount[18], 0, '반차는 하루 쉬는 게 아니에요');
  assert.equal(gasan.offCount[23], 1, '휴무?도 세요');
  assert.equal(gasan.offCount[24], 1, '11/25(수) 이지은 요일 휴무');
  assert.equal(gasan.offCount[28], 0, '11/29(일): 이지은은 퇴사 뒤라 안 세요');
  // 공휴일: 12월 25일
  assert.deepEqual(plain(g.gs.adminGrid(ADMIN, '2026-12').holidays), { '2026-12-25': '성탄절' });
  // 달을 이상하게 주면 이번 달
  assert.equal(g.gs.adminGrid(ADMIN, 'abc').ym, '2026-11');
  assert.equal(g.gs.adminGrid(ADMIN, '2026.11').ym, '2026-11');
});

test('근무표 보기: 점장은 자기 매장만(다른 매장을 골라도), 남은 월차·대체휴무·시트 주소는 안 받아요', () => {
  const g = fresh();
  const m = plain(g.gs.adminGrid(MGR, '2026-11', '가산'));
  assert.equal(m.admin, false);
  assert.deepEqual(m.stores.map((s) => s.name), ['왕십리']);
  assert.equal(m.store, '왕십리');
  assert.deepEqual(m.stores[0].rows.map((r) => r.name), ['김민우', '박점장']);
  assert.ok(!JSON.stringify(m).includes('이지은'), '다른 매장 직원은 이름도 안 와요');
  assert.equal(m.url, '');
  assert.equal(m.stores[0].rows[0].left, null);
  assert.equal(m.stores[0].rows[0].sub, null);
  // 관리자는 고른 매장으로 열려요
  assert.equal(g.gs.adminGrid(ADMIN, '2026-11', '가산').store, '가산');
  assert.throws(() => g.gs.adminGrid({ name: '박점장', pin: '000000' }, '2026-11'), /비밀번호가 틀렸어요/);
  assert.throws(() => g.gs.adminGrid('111111', '2026-11'), /관리자 비밀번호가 틀렸어요/);
  assert.throws(() => g.gs.adminGrid('', '2026-11'), /관리자 비밀번호를 넣어주세요/);
  assert.throws(() => g.gs.adminGrid({ name: '김민우', pin: '0123' }, '2026-11'), /점장으로 등록돼 있지 않아요/);
});

test('근무표 보기: 탭이 없는 달은 hasTab=false, [매장]에 없는 매장 이름 줄은 관리자만 따로 묶어서 봐요', () => {
  const g = fresh();
  const none = plain(g.gs.adminGrid(ADMIN, '2027-03'));
  assert.equal(none.hasTab, false);
  assert.deepEqual(none.stores.map((s) => [s.name, s.rows.length]), [['왕십리', 0], ['가산', 0]]);
  assert.equal(none.url, '');
  // 박점장 줄 매장 칸을 손으로 '구본점'이라고 적었어요
  g.gs.GRID_ = {};
  const gr = g.gs.monthGrid_('2026-11', true);
  gr.sh.getRange(gr.rows['박점장'].row, gr.cols.store + 1).setValue('구본점');
  const d = plain(g.gs.adminGrid(ADMIN, '2026-11'));
  assert.deepEqual(d.stores.map((s) => s.name), ['왕십리', '가산', '구본점']);
  assert.deepEqual(rowOf(d, '구본점', '박점장').name, '박점장');
  assert.equal(d.stores[2].maxOff, 0, '[매장]에 없는 매장은 하루 제한 없음');
  const m = plain(g.gs.adminGrid(MGR, '2026-11'));
  assert.deepEqual(m.stores.map((s) => s.name), ['왕십리']);
  assert.deepEqual(m.stores[0].rows.map((r) => r.name), ['김민우'], '점장 매장 줄로 적힌 사람만');
});

test('근무표 고치기: 휴무표에 적고 칸 메모를 남기고 바뀐 표를 돌려줘요. 오늘·앞날이면 본인에게 소리 없이 알려요', () => {
  const g = fresh();
  tgOn(g, { 김민우: '9002', 이지은: '9003' });
  g.setKst('2026-11-16 15:00');
  let r = plain(g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 25, '휴무'));
  assert.equal(mark(g, '김민우', '2026-11-25'), '휴무');
  assert.equal(note(g, '김민우', '2026-11-25'), '11/16 15:00 사장님: 빈칸 → 휴무');
  assert.equal(r.store, '왕십리');
  assert.equal(rowOf(r, '왕십리', '김민우').cells[24], '휴무', '바뀐 표를 돌려줘요');
  assert.equal(r.told, true);
  assert.equal(r.done, '김민우 11/25(수) 휴무로 바꿨어요. 본인에게 텔레그램으로 알렸어요.');
  let msg = sent(g, 9002).at(-1);
  assert.equal(msg.text, '[굳폰] 근무표가 바뀌었어요\n11/25(수) 휴무로 바뀌었어요.\n앱 [근무표 · 휴무]에서 볼 수 있어요.');
  assert.equal(msg.disable_notification, true, '소리 없이');
  assert.equal(sent(g, 555).length, 0, '사장님께는 안 보내요(사장님이 바꿨어요)');
  // 또 바꾸면 메모에 한 줄 더
  g.setKst('2026-11-16 15:10');
  r = plain(g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 25, '월차'));
  assert.equal(note(g, '김민우', '2026-11-25'), '11/16 15:00 사장님: 빈칸 → 휴무\n11/16 15:10 사장님: 휴무 → 월차');
  assert.match(sent(g, 9002).at(-1).text, /11\/25\(수\) 월차로 바뀌었어요/);
  // 지우기: 그날 근무 시간을 같이 알려요
  r = plain(g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 25, ''));
  assert.equal(mark(g, '김민우', '2026-11-25'), '');
  assert.match(note(g, '김민우', '2026-11-25'), /\n11\/16 15:10 사장님: 월차 → 지움$/);
  assert.equal(r.done, '김민우 11/25(수) 칸을 지웠어요. 본인에게 텔레그램으로 알렸어요.');
  assert.match(sent(g, 9002).at(-1).text, /11\/25\(수\) '월차' 표시를 지웠어요\. 그날은 10:00-20:00 근무예요\./);
  // 오늘도 알려요
  const before = g.tg.sent.length;
  r = plain(g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 16, '반차'));
  assert.equal(r.told, true);
  assert.equal(g.tg.sent.length, before + 1);
  assert.match(sent(g, 9002).at(-1).text, /11\/16\(월\) 반차로 바뀌었어요/);
  // 지난 날은 안 알려요(기록 정리)
  setMark(g, '2026-11-13', '이지은', '결근?');
  r = plain(g.gs.adminSetMark(ADMIN, '2026-11', '이지은', 13, '무급'));
  assert.equal(mark(g, '이지은', '2026-11-13'), '무급');
  assert.equal(r.told, false);
  assert.equal(r.done, '이지은 11/13(금) 무급으로 바꿨어요.');
  assert.equal(sent(g, 9003).length, 0);
  assert.equal(note(g, '이지은', '2026-11-13'), '11/16 15:10 사장님: 결근? → 무급');
  // 결근 확정
  setMark(g, '2026-11-12', '김민우', '결근?');
  g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 12, '결근');
  assert.equal(mark(g, '김민우', '2026-11-12'), '결근');
  // 같은 말이면 아무것도 안 바뀌어요(메모·알림 없음)
  const n0 = g.tg.sent.length;
  r = plain(g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 12, '결근'));
  assert.equal(r.done, '김민우 11/12(목)은 이미 결근으로 적혀 있어요.');
  assert.equal(note(g, '김민우', '2026-11-12'), '11/16 15:10 사장님: 결근? → 결근');
  assert.equal(g.tg.sent.length, n0);
  // 직원이 고른 휴무?를 휴무로(확정): 앞날이라 알려요
  setMark(g, '2026-11-24', '이지은', '휴무?');
  g.gs.adminSetMark(ADMIN, '2026-11', '이지은', 24, '휴무');
  assert.equal(mark(g, '이지은', '2026-11-24'), '휴무');
  assert.match(sent(g, 9003).at(-1).text, /11\/24\(화\) 휴무로 바뀌었어요/);
  // 텔레그램을 안 켠 직원은 사장님께 따로 알려 달라고 해요
  r = plain(g.gs.adminSetMark(ADMIN, '2026-11', '최유나', 27, '휴무'));
  assert.equal(r.told, false);
  assert.match(r.done, /최유나 11\/27\(금\) 휴무로 바꿨어요\. 본인이 텔레그램 알림을 안 켜서 따로 알려 주세요\./);
  assert.equal(r.store, '가산', '고친 사람 매장 표로 돌려줘요');
});

test('근무표 고치기: 관리자만, 마감한 달·입사 전·퇴사 뒤·없는 줄·목록에 없는 말·없는 날은 막고 아무것도 안 바꿔요', () => {
  const g = fresh();
  tgOn(g, { 김민우: '9002' });
  g.gs.adminTestStaff(ADMIN, '왕십리');
  g.gs.makeMonth_('2026-10');
  g.setKst('2026-11-16 15:00');
  const snap = days(g, '2026-11') + '\n' + days(g, '2026-10');
  const notes = JSON.stringify(g.sheet('26.11').notes);
  assert.throws(() => g.gs.adminSetMark(MGR, '2026-11', '김민우', 25, '휴무'), /관리자\(사장님\)만/, '점장은 보기만');
  assert.throws(() => g.gs.adminSetMark('111111', '2026-11', '김민우', 25, '휴무'), /관리자 비밀번호가 틀렸어요/);
  assert.throws(() => g.gs.adminSetMark({ name: '김민우', pin: '0123' }, '2026-11', '김민우', 25, '휴무'), /점장으로 등록돼 있지 않아요/);
  g.props.set('monthClosed', JSON.stringify({ '2026-10': '2026-11-03 10:00' }));
  assert.throws(() => g.gs.adminSetMark(ADMIN, '2026-10', '김민우', 5, '휴무'), /10월은 마감한 달이라 바꿀 수 없어요/);
  assert.throws(() => g.gs.adminSetMark(ADMIN, '2026-11', '최유나', 9, '휴무'), /최유나 11\/09\(월\)은 입사 전이에요\(입사일 2026-11-10\)/);
  assert.throws(() => g.gs.adminSetMark(ADMIN, '2026-11', '이지은', 28, '휴무'), /이지은 11\/28\(토\)은 퇴사한 뒤예요\(마지막 근무일 2026-11-27\)/);
  for (const who of ['없는사람', '', '테스트', '예시직원', '박퇴사']) {
    assert.throws(() => g.gs.adminSetMark(ADMIN, '2026-11', who, 25, '휴무'), /11월 휴무표에 .* 줄이 없어요/, who);
  }
  assert.throws(() => g.gs.adminSetMark(ADMIN, '2027-03', '김민우', 2, '휴무'), /3월 휴무표에 김민우 님 줄이 없어요/, '탭이 없는 달은 만들지 않아요');
  for (const v of ['휴가', '결근?', '휴무?', '대타', '=SUM(A1)', '<b>휴무</b>']) {
    assert.throws(() => g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 25, v), /고를 수 있는 말은 휴무·월차·반차·무급·대체·결근·지우기예요/, v);
  }
  for (const day of [0, 31, 1.5, 'x', -3, null]) {
    assert.throws(() => g.gs.adminSetMark(ADMIN, '2026-11', '김민우', day, '휴무'), /날짜를 다시 골라주세요/, String(day));
  }
  for (const ym of ['2026-13', '', 'abc']) {
    assert.throws(() => g.gs.adminSetMark(ADMIN, ym, '김민우', 5, '휴무'), /달을 골라주세요/, ym);
  }
  assert.equal(days(g, '2026-11') + '\n' + days(g, '2026-10'), snap, '휴무표는 그대로');
  assert.equal(JSON.stringify(g.sheet('26.11').notes), notes, '메모도 그대로');
  assert.equal(g.tg.sent.length, 0, '알림도 없어요');
  assert.ok(!g.book.getSheetByName('27.03'), '없는 달 탭을 만들지 않아요');
  // 마감을 취소하면 고칠 수 있어요
  g.props.set('monthClosed', '{}');
  g.gs.adminSetMark(ADMIN, '2026-10', '김민우', 5, '휴무');
  assert.equal(mark(g, '김민우', '2026-10-05'), '휴무');
  // 말 앞뒤 빈칸은 떼요
  g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 26, ' 휴무 ');
  assert.equal(mark(g, '김민우', '2026-11-26'), '휴무');
});

test('근무표 고치기: 화면에서 본 뒤 그사이 칸이 바뀌었으면(seen) 덮어쓰지 않고 새 표를 돌려줘요', () => {
  const g = fresh();
  g.setKst('2026-11-21 10:00');
  setMark(g, '2026-11-26', '김민우', '휴무?'); // 사장님이 표를 연 뒤에 직원이 고름
  let r = plain(g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 26, '월차', ''));
  assert.equal(r.stale, true);
  assert.equal(mark(g, '김민우', '2026-11-26'), '휴무?', '그대로');
  assert.equal(r.done, "김민우 11/26(목) 칸이 그사이 '휴무?'(으)로 바뀌어서 그대로 뒀어요. 확인하고 다시 골라 주세요.");
  assert.equal(rowOf(r, '왕십리', '김민우').cells[25], '휴무?', '새 표에는 지금 칸');
  assert.equal(note(g, '김민우', '2026-11-26'), '');
  r = plain(g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 26, '월차', '휴무?'));
  assert.equal(r.stale, false);
  assert.equal(mark(g, '김민우', '2026-11-26'), '월차');
});

test('근무표 고치기: 쉬는 말은 요청 승인과 같게 적고, 지우기·결근은 그날 원래 근무로 돌려요([근무변경])', () => {
  const g = fresh();
  g.setKst('2026-11-16 15:00');
  g.gs.addChange_('2026-11-19', '김민우', '13:00-21:00', '오후 근무');
  assert.equal(sched(g, '김민우', '2026-11-19'), '13:00-21:00');
  g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 19, '휴무');
  assert.equal(mark(g, '김민우', '2026-11-19'), '휴무');
  assert.equal(sched(g, '김민우', '2026-11-19'), '', '[근무변경] 시간이 있어도 쉬는 날이 돼요');
  const ch = () => g.gs.rows_('근무변경').filter((x) => x[1] === '김민우').map((x) => x[2] + ' / ' + x[3]);
  assert.deepEqual(ch(), ['13:00-21:00 / 오후 근무', '휴무 / 사장님이 근무표에서 휴무로 바꿈']);
  // 지우면 그날 정해 둔 근무 시간(13:00-21:00)으로 돌아와요
  g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 19, '');
  assert.equal(sched(g, '김민우', '2026-11-19'), '13:00-21:00');
  assert.equal(ch().at(-1), '13:00-21:00 / 사장님이 근무표에서 칸을 지움');
  // 결근(확정)도 근무하는 날이라 같은 방법으로 돌아와요
  g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 19, '휴무');
  assert.equal(sched(g, '김민우', '2026-11-19'), '');
  g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 19, '결근');
  assert.equal(mark(g, '김민우', '2026-11-19'), '결근');
  assert.equal(sched(g, '김민우', '2026-11-19'), '13:00-21:00');
  assert.equal(ch().at(-1), '13:00-21:00 / 사장님이 근무표에서 결근으로 바꿈');
  // [근무변경]이 없는 날은 [근무변경]을 안 건드려요
  const n = g.gs.rows_('근무변경').length;
  g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 24, '월차');
  g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 24, '');
  assert.equal(g.gs.rows_('근무변경').length, n);
  assert.equal(sched(g, '김민우', '2026-11-24'), '10:00-20:00');
  // 요일로 쉬는 날(토)을 지워도 쉬는 날 그대로예요(근무로 바꾸지 않아요)
  g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 21, '휴무');
  g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 21, '');
  assert.equal(sched(g, '김민우', '2026-11-21'), '');
  assert.equal(g.gs.rows_('근무변경').length, n);
});

test('근무표 고치기: 대체는 [대체휴무] 장부에 사용을 적고, 다른 말로 바꾸면 되돌려요(손으로 적은 대체는 안 건드려요)', () => {
  const g = fresh();
  g.setKst('2026-11-16 15:00');
  g.gs.addSub_('2026-11-08', '김민우', '적립', 1, '쉬는 날 출근');
  let r = plain(g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 23, '대체'));
  assert.equal(mark(g, '김민우', '2026-11-23'), '대체');
  assert.match(r.done, /대체휴무 1일을 쓴 걸로 적었어요\(남은 대체휴무 0일\)/);
  assert.equal(g.gs.subBalance_('김민우').left, 0);
  assert.equal(rowOf(r, '왕십리', '김민우').sub, 0);
  r = plain(g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 23, '휴무'));
  assert.match(r.done, /쓴 대체휴무 1일을 되돌렸어요\(남은 대체휴무 1일\)/);
  g.gs.MEMO_ = {};
  assert.equal(g.gs.subBalance_('김민우').left, 1);
  // 휴무표에 손으로 적은 '대체'(장부에 사용이 없음)를 바꾸면 장부는 그대로
  setMark(g, '2026-11-25', '김민우', '대체');
  r = plain(g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 25, '휴무'));
  assert.doesNotMatch(r.done, /대체휴무/);
  g.gs.MEMO_ = {};
  assert.equal(g.gs.subBalance_('김민우').left, 1);
});

test('근무표 고치기: 그날 출퇴근 기록이 있으면 예정 시간·지각을 다시 맞추고, 칸에 남는 글자를 알려줘요', () => {
  const g = fresh();
  g.setKst('2026-11-16 10:07');
  const res = g.gs.punch({ name: '김민우', pin: '0123', type: 'in', ...NEAR, device: PHONE.김민우, label: 'iPhone 사파리', agree: true });
  assert.equal(res.late, 7);
  assert.equal(mark(g, '김민우', '2026-11-16'), '10:07');
  const log = () => { const sh = g.sheet('출퇴근기록'); return sh.rowDisplay(2); };
  g.setKst('2026-11-16 11:00');
  let r = plain(g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 16, '휴무'));
  assert.equal(mark(g, '김민우', '2026-11-16'), '휴무');
  assert.deepEqual([log()[3], log()[7]], ['', ''], '쉬는 날이 되면 예정 출근·지각이 없어져요');
  assert.equal(r.done, '김민우 11/16(월) 휴무로 바꿨어요. 본인이 텔레그램 알림을 안 켜서 따로 알려 주세요.');
  r = plain(g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 16, ''));
  assert.equal(mark(g, '김민우', '2026-11-16'), '10:07', '기록대로 지각 시간이 다시 붙어요');
  assert.deepEqual([log()[3], log()[7]], ['10:00', '7']);
  assert.match(r.done, /김민우 11\/16\(월\) 칸을 지웠어요\. 그날 출근 기록이 있어서 칸에는 '10:07'\(으\)로 적혀 있어요\./);
});

test('말 뒤에 붙는 로/으로', () => {
  const { gs } = createGas({ now: 0 });
  assert.deepEqual(['휴무', '월차', '반차', '무급', '대체', '결근', '서울', ''].map((w) => gs.markRo_(w)),
    ['휴무로', '월차로', '반차로', '무급으로', '대체로', '결근으로', '서울로', '로']);
});
