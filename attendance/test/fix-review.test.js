// 8개 기능을 합친 뒤 검토에서 찾은 문제(서로 부딪히는 곳) 고침 확인
// 실행: node --test test/fix-review.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./gas-mock');

const plain = (x) => JSON.parse(JSON.stringify(x));
const ADMIN = '582941';
const TOKEN = '123456789:' + 'A'.repeat(35);
const STORE = { lat: 37.5665, lng: 126.978 };
const NEAR = { lat: 37.5668, lng: 126.978, acc: 20 };
const PHONE = {
  김민우: 'aaaaaaaaaaaaaaaa', 이지은: 'bbbbbbbbbbbbbbbb', 박점장: 'eeeeeeeeeeeeeeee', 최유나: 'ffffffffffffffff', 정하나: 'gggggggggggggggg', 테스트: 'hhhhhhhhhhhhhhhh',
};
const PINS = { 김민우: '0123', 이지은: '5678', 박점장: '246813', 최유나: '135790', 정하나: '864200', 테스트: '4826' };
const ROW = { 김민우: 2, 이지은: 3, 박점장: 4, 최유나: 5, 정하나: 6 };
// 텔레그램 채팅 번호: 사장님 555, 직원은 아래
const CHAT = { 사장님: '555', 김민우: '9002', 이지은: '9003', 박점장: '9005', 최유나: '9006', 정하나: '9007' };

// 인사 정보를 다 넣은 상태로(출근 전에 인사 정보가 꼭 있어야 해서)
let hrSeq = 0;
function hrFill(g) {
  const list = g.gs.staff_().filter((p) => p.active).map((p) => p.name);
  for (const n of list) {
    g.gs.MEMO_ = {};
    if (!g.gs.hrFind_(n)) g.gs.syncHr_();
    const h = g.gs.hrFind_(n);
    if (!h) continue;
    hrSeq++;
    const rrn = '8001' + String(10 + (hrSeq % 18)).padStart(2, '0') + '1' + String(100000 + hrSeq).slice(-6);
    g.gs.hrWrite_(h.row, {
      rrn: g.gs.rrnMask_(rrn), enc: g.gs.rrnEncrypt_(rrn), phone: '010-1000-' + String(1000 + hrSeq), addr: '서울 성동구', bank: '국민',
      account: '123456-78-' + String(900000 + hrSeq), emergency: '010-9999-8888 가족', start: '2020-01-01',
    });
  }
  g.gs.MEMO_ = {};
}

// 2026-11-16 은 월요일
// 매장: 왕십리(10:00-20:00, 점장 박점장) · 가산(12:00-21:00, 점장 최유나)
// 김민우(왕십리, 토·일 휴무) · 이지은(가산, 수·일 휴무) · 박점장(왕십리) · 최유나(가산) · 정하나(왕십리) · 박퇴사(퇴사)
function shop() {
  const g = createGas({ now: Date.parse('2026-11-16T08:00:00+09:00') });
  g.gs.setup();
  g.sheet('매장').getRange(2, 1, 2, 8).setValues([
    ['왕십리', '10:00', '20:00', '', '', '', '', '박점장'],
    ['가산', '12:00', '21:00', '', '', '', '', '최유나'],
  ]);
  //            이름      매장      PIN       시급   월  화  수      목  금  토      일      재직 등록폰 새폰요청
  g.sheet('직원').getRange(2, 1, 6, 14).setValues([
    ['김민우', '왕십리', '0123', 12000, '', '', '', '', '', '휴무', '휴무', '', '', ''],
    ['이지은', '가산', '5678', 10320, '', '', '휴무', '', '', '', '휴무', '', '', ''],
    ['박점장', '왕십리', '246813', 12000, '', '', '', '', '', '', '', '', '', ''],
    ['최유나', '가산', '135790', 10320, '', '', '', '', '', '', '', '', '', ''],
    ['정하나', '왕십리', '864200', 10320, '', '', '', '', '', '', '', '', '', ''],
    ['박퇴사', '왕십리', '9999', 10320, '', '', '', '', '', '', '', 'X', '', ''],
  ]);
  g.gs.setSetting_('관리자PIN', ADMIN);
  g.gs.setSetting_('앱시작일', '2026-01-01');
  g.gs.setSetting_('알림이메일', 'owner@example.com');
  g.gs.adminSetPlace(ADMIN, '왕십리', STORE.lat, STORE.lng);
  g.gs.setup(); // 새 직원 줄을 휴무표에
  hrFill(g);
  // 김민우·정하나는 폰이 이미 등록돼 있어요(전에 출근을 찍은 폰)
  for (const n of ['김민우', '정하나']) g.gs.setStaffCell_(ROW[n], '등록폰', g.gs.devCell_(PHONE[n], 'iPhone 사파리', '11/13 등록'));
  g.gs.MEMO_ = {};
  return g;
}
// 텔레그램을 연결하고(사장님 555), names 직원은 앱에서 알림을 켠 상태로
const tgOn = (g, names = []) => {
  g.gs.setSetting_('텔레그램토큰', TOKEN);
  g.gs.setSetting_('텔레그램채팅ID', CHAT.사장님);
  g.gs.setSetting_('텔레그램봇', 'goodphone_test_bot');
  for (const n of names) g.gs.setStaffCell_(ROW[n], '텔레그램', CHAT[n]);
};
const sentTo = (g, who) => g.tg.sent.filter((m) => String(m.chat_id) === String(CHAT[who] || who));
const texts = (g, who) => sentTo(g, who).map((m) => m.text);
const missingFor = (g, who) => texts(g, who).filter((t) => /아직 출근 안 찍은 직원|아직 출근을 안 찍었어요/.test(t));
const late = (g, name, min, why = '', device = PHONE[name], pin = PINS[name]) => g.gs.lateNotice(name, pin, min, why, device);
const off = (g, name, kind, why = '', device = PHONE[name], pin = PINS[name]) => g.gs.offToday(name, pin, kind, why, device);
const punch = (g, name, type = 'in') =>
  g.gs.punch({ name, pin: PINS[name], type, lat: NEAR.lat, lng: NEAR.lng, acc: NEAR.acc, device: PHONE[name], label: 'iPhone 사파리', agree: true });
const req = (g, name, kind, extra = {}) => g.gs.makeRequest({ name, pin: PINS[name], kind, ...extra });
const mark = (g, name, date) => { g.gs.GRID_ = {}; g.gs.MEMO_ = {}; return g.gs.dayMark_(name, date); };
const reqRows = (g) => {
  const sh = g.sheet('요청');
  const out = [];
  for (let r = 2; r <= sh.getLastRow(); r++) out.push(sh.rowDisplay(r));
  return out;
};
const logRow = (g, name, date) => {
  const sh = g.sheet('출퇴근기록');
  for (let r = 2; r <= sh.getLastRow(); r++) { const v = sh.rowDisplay(r); if (v[0] === date && v[2] === name) return v; }
  return null;
};
const prop = (g, k) => g.gs.PropertiesService.getScriptProperties().getProperty(k);

const idOf = (g, kind, date) => { const r = reqRows(g).filter((x) => x[3] === kind && x[4] === date).at(-1); return r && r[0]; };
const stateOf = (g, kind, date) => { const r = reqRows(g).filter((x) => x[3] === kind && x[4] === date).at(-1); return r && r[7]; };
const card = (g, id) => plain(g.gs.adminToday(ADMIN)).requests.find((x) => x.id === id);
const usedOn = (g, name, date) => { g.gs.MEMO_ = {}; return g.gs.subRows_().filter((x) => x.name === name && x.date === date && /사용/.test(x.kind)).reduce((a, x) => a + x.days, 0); };

/* ───── 요청·결재 ───── */

test('퇴사 신청을 마지막 근무일 뒤에 승인해도, 그날까지의 요청은 지우지 않고 사장님이 처리하게 둬요', () => {
  const g = shop();
  g.setKst('2026-11-16 09:00');
  req(g, '김민우', 'quit', { date: '2026-11-18', reason: '이사', to: 'admin' });
  req(g, '김민우', 'off', { offType: '휴무', date: '2026-11-17', reason: '병원' });
  req(g, '김민우', 'off', { offType: '휴무', date: '2026-11-20', reason: '병원' }); // 마지막 근무일 뒤
  req(g, '정하나', 'swap', { date: '2026-11-17' });
  g.gs.takeSwap('김민우', PINS.김민우, idOf(g, '대타', '2026-11-17')); // 김민우가 11/17 정하나 대타를 맡았어요(그날 일했어요)
  g.setKst('2026-11-19 10:00');
  const out = plain(g.gs.adminRequest(ADMIN, idOf(g, '퇴사', '2026-11-18'), true));
  assert.match(out.doneNote, /퇴사 처리했어요\(마지막 근무일 11\/18\(수\)\)/, '승인하면 한 일이 사장님 화면에 보여요');
  assert.match(out.doneNote, /마지막 근무일까지의 요청 2건은 그대로 뒀어요/);
  assert.match(out.doneNote, /기다리던 요청 1건을 취소했어요/);
  assert.doesNotMatch(out.doneNote, /다시 구하는 중/);
  assert.equal(stateOf(g, '퇴사', '2026-11-18'), '승인');
  assert.equal(stateOf(g, '휴무', '2026-11-17'), '대기', '쉰 날의 요청은 그대로');
  assert.equal(stateOf(g, '휴무', '2026-11-20'), '취소', '마지막 근무일 뒤 요청은 취소');
  assert.equal(stateOf(g, '대타', '2026-11-17'), '수락', '이미 일한 대타는 다시 구하지 않아요');
  g.gs.adminRequest(ADMIN, idOf(g, '휴무', '2026-11-17'), true);
  assert.equal(mark(g, '김민우', '2026-11-17'), '휴무');
  g.gs.adminRequest(ADMIN, idOf(g, '대타', '2026-11-17'), true);
  assert.equal(mark(g, '정하나', '2026-11-17'), '휴무');
});

test('퇴사 예정이면 마지막 근무일 뒤 날짜로는 요청·대타를 못 하고, 이미 맡은 대타는 미리 알려요', () => {
  const g = shop();
  g.setKst('2026-11-16 09:00');
  req(g, '정하나', 'swap', { date: '2026-11-20' });
  const swapId = idOf(g, '대타', '2026-11-20');
  g.gs.takeSwap('김민우', PINS.김민우, swapId); // 퇴사 예정 전에 맡았어요
  const c = plain(g.gs.adminRetire(ADMIN, '김민우', '2026-11-18', '자진 퇴사'));
  assert.match(JSON.stringify(c), /그 뒤에 맡기로 한 대타가 있어요\(11\/20\(금\) 정하나 님 대신\)/);
  assert.throws(() => req(g, '김민우', 'off', { offType: '휴무', date: '2026-11-19', reason: '병원' }), /마지막 근무일\(2026-11-18\) 뒤 날짜예요/);
  req(g, '김민우', 'off', { offType: '휴가', date: '2026-11-17', dateTo: '2026-11-20', reason: '여행' });
  assert.deepEqual(reqRows(g).filter((x) => x[3] === '휴가').map((x) => x[4]), ['2026-11-17', '2026-11-18'], '여러 날 묶음은 마지막 근무일까지만');
  assert.ok(req(g, '김민우', 'fix', { date: '2026-11-13', type: 'out', time: '20:05', reason: '깜빡' }), '정정은 돼요');
  // 마지막 근무일 뒤 동료 대타는 안 보이고, 받을 수도 없어요
  req(g, '박점장', 'swap', { date: '2026-11-19' });
  const id2 = idOf(g, '대타', '2026-11-19');
  assert.ok(!plain(g.gs.reqsFor_('김민우')).swaps.some((x) => x.id === id2));
  assert.ok(plain(g.gs.reqsFor_('정하나')).swaps.some((x) => x.id === id2), '다른 동료에게는 보여요');
  assert.throws(() => g.gs.takeSwap('김민우', PINS.김민우, id2), /마지막 근무일\(2026-11-18\) 뒤 날짜라서 대타를 할 수 없어요/);
  // 이미 맡은 대타: 카드에 알리고, 승인은 안 돼요
  assert.match(card(g, swapId).note, /김민우 님은 11\/18\(수\)까지 근무해요\(퇴사 예정\)/);
  assert.throws(() => g.gs.adminRequest(ADMIN, swapId, true), /11\/18\(수\)까지 근무해서\(퇴사 예정\) 11\/20\(금\) 대타를 할 수 없어요/);
  assert.equal(stateOf(g, '대타', '2026-11-20'), '수락');
});

test('대타를 맡은 동료가 그날 병가를 받았으면 대타는 승인하지 않아요(병가가 지워지지 않게)', () => {
  const g = shop();
  g.setKst('2026-11-16 09:00');
  req(g, '김민우', 'swap', { date: '2026-11-18' });
  const swapId = idOf(g, '대타', '2026-11-18');
  g.gs.takeSwap('정하나', PINS.정하나, swapId);
  g.setKst('2026-11-18 08:00');
  off(g, '정하나', '병가', '몸살');
  g.gs.adminRequest(ADMIN, idOf(g, '병가', '2026-11-18'), true);
  assert.equal(mark(g, '정하나', '2026-11-18'), '병가');
  assert.match(card(g, swapId).note, /정하나 님은 그날 휴무표에 "병가"\(으\)로 쉬는 날이라 승인할 수 없어요/);
  assert.throws(() => g.gs.adminRequest(ADMIN, swapId, true), /정하나 님은 그날 휴무표에 "병가"/);
  assert.equal(mark(g, '정하나', '2026-11-18'), '병가', '병가 그대로');
  assert.equal(mark(g, '김민우', '2026-11-18'), '', '요청한 사람도 그대로');
  g.gs.adminRequest(ADMIN, swapId, false);
  assert.equal(stateOf(g, '대타', '2026-11-18'), '거절');
});

test('아침에 [오늘 못 나가요]를 보내고 출근했으면 그 병가·대타는 승인하지 않아요(일한 날·지각이 지워지지 않게)', () => {
  const g = shop();
  g.setKst('2026-11-16 08:00');
  off(g, '김민우', '병가', '');
  const sick = idOf(g, '병가', '2026-11-16');
  req(g, '김민우', 'swap', { date: '2026-11-16' }); // 오늘은 병가와 대타를 같이 보낼 수 있어요
  const swapId = idOf(g, '대타', '2026-11-16');
  g.gs.takeSwap('정하나', PINS.정하나, swapId);
  g.setKst('2026-11-16 10:05');
  punch(g, '김민우');
  g.setKst('2026-11-16 12:00');
  assert.match(card(g, sick).note, /그날 10:05에 출근했어요/);
  assert.match(card(g, swapId).note, /그날 10:05에 출근했어요/);
  assert.throws(() => g.gs.adminRequest(ADMIN, sick, true), /11\/16\(월\) 10:05에 이미 출근했어요/);
  assert.throws(() => g.gs.adminRequest(ADMIN, swapId, true), /김민우 님이 11\/16\(월\) 10:05에 이미 출근했어요/);
  assert.equal(stateOf(g, '병가', '2026-11-16'), '대기');
  assert.equal(g.gs.punchedIn_('2026-11-16', '김민우'), '10:05', '출근 기록 그대로');
  assert.notEqual(mark(g, '김민우', '2026-11-16'), '병가');
  // 반차는 출근한 날에도 승인돼요
  req(g, '정하나', 'off', { offType: '반차', date: '2026-11-17', reason: '병원' });
  g.setKst('2026-11-17 10:00');
  punch(g, '정하나');
  g.gs.adminRequest(ADMIN, idOf(g, '반차', '2026-11-17'), true);
  assert.equal(mark(g, '정하나', '2026-11-17'), '반차');
});

test('[근무표]에서 먼저 대체로 바꾼 날의 대체휴무 요청을 승인해도 두 번 빼지 않아요', () => {
  const g = shop();
  g.setKst('2026-11-16 09:00');
  g.gs.addSub_('2026-11-14', '김민우', '적립', 2, '휴무날 출근');
  req(g, '김민우', 'off', { offType: '대체', date: '2026-11-18', reason: '개인 사정' });
  req(g, '김민우', 'off', { offType: '휴무', date: '2026-11-19', reason: '개인 사정' });
  g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 18, '대체');
  g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 19, '대체');
  assert.equal(usedOn(g, '김민우', '2026-11-18'), 1);
  g.gs.adminRequest(ADMIN, idOf(g, '대체', '2026-11-18'), true);
  assert.equal(usedOn(g, '김민우', '2026-11-18'), 1, '한 번만 빼요');
  g.gs.adminRequest(ADMIN, idOf(g, '휴무', '2026-11-19'), true); // 대체였던 칸을 휴무로 승인하면 대체 사용을 되돌려요
  assert.equal(mark(g, '김민우', '2026-11-19'), '휴무');
  assert.equal(usedOn(g, '김민우', '2026-11-19'), 0);
  g.gs.MEMO_ = {};
  assert.equal(g.gs.subBalance_('김민우').left, 1);
  // 손으로 대체라고 적어 둔 칸(장부 없음)은 승인하면 1을 빼요
  req(g, '김민우', 'off', { offType: '대체', date: '2026-11-20', reason: '개인 사정' });
  g.gs.setMark_('2026-11-20', '김민우', () => '대체');
  g.gs.adminRequest(ADMIN, idOf(g, '대체', '2026-11-20'), true);
  assert.equal(usedOn(g, '김민우', '2026-11-20'), 1);
});

test('[오늘 못 나가요] 병가와 아무도 안 받은 대타를 같이 보냈다가 병가가 거절되면 결근?이 적혀요', () => {
  const g = shop();
  g.setKst('2026-11-16 08:30');
  off(g, '김민우', '병가', '');
  req(g, '김민우', 'swap', { date: '2026-11-16' });
  g.setKst('2026-11-16 23:35');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민우', '2026-11-16'), '', '밤 마감은 병가 결과를 기다려요');
  g.setKst('2026-11-17 09:00');
  g.gs.adminRequest(ADMIN, idOf(g, '병가', '2026-11-16'), false);
  assert.equal(mark(g, '김민우', '2026-11-16'), '결근?', '아무도 안 받은 대타는 기다리지 않아요');
});

test('관리자에게 바로 보낸 퇴사 신청: 점장 [월별]에도 안 보이고, 카드에 틀린 휴무표 안내가 안 나와요', () => {
  const g = shop();
  g.setKst('2026-11-16 09:00');
  req(g, '김민우', 'quit', { date: '2026-11-16', reason: '이직', to: 'admin' });
  g.setKst('2026-11-16 23:35');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민우', '2026-11-16'), '결근?', '퇴사 신청만 해 두고 안 나온 날');
  g.setKst('2026-11-17 09:00');
  const mi = plain(g.gs.adminIssues({ name: '박점장', pin: PINS.박점장 }, ''));
  const row = mi.absent.find((x) => x.name === '김민우' && x.date === '2026-11-16');
  assert.ok(row, '결근?은 점장도 봐요');
  assert.equal(row.asked, '', '관리자에게 바로 보낸 퇴사 신청은 점장에게 안 알려요');
  const ai = plain(g.gs.adminIssues(ADMIN, ''));
  assert.match(ai.absent.find((x) => x.name === '김민우' && x.date === '2026-11-16').asked, /퇴사/);
  const c = card(g, idOf(g, '퇴사', '2026-11-16'));
  assert.equal(c.mark, '', '퇴사 신청은 휴무표 칸을 바꾸지 않아요');
  assert.equal(c.past, true, '"이미 지난 날짜예요"가 보여요');
});

test('동료가 내 이름으로 비밀번호를 5번 틀려도, 등록된 내 폰으로는 요청·[오늘 못 나가요]를 보낼 수 있어요', () => {
  const g = shop();
  g.setKst('2026-11-16 08:30');
  for (let i = 0; i < 5; i++) {
    assert.throws(() => g.gs.makeRequest({ name: '김민우', pin: '1111', kind: 'off', offType: '휴무', date: '2026-11-20', reason: 'x' }), /비밀번호가 틀렸어요/);
  }
  assert.throws(() => g.gs.makeRequest({ name: '김민우', pin: PINS.김민우, kind: 'off', offType: '휴무', date: '2026-11-20', reason: 'x' }), /잠깐|10분/, '폰을 안 밝히면 이름 잠금');
  off(g, '김민우', '병가', '몸살');
  assert.equal(stateOf(g, '병가', '2026-11-16'), '대기');
  req(g, '김민우', 'off', { offType: '휴무', date: '2026-11-20', reason: '병원', device: PHONE.김민우 });
  assert.equal(stateOf(g, '휴무', '2026-11-20'), '대기');
  assert.throws(() => g.gs.makeRequest({ name: '김민우', pin: PINS.김민우, kind: 'off', offType: '휴무', date: '2026-11-19', reason: 'x', device: PHONE.정하나 }), /잠깐|10분/, '남의 폰은 이름 잠금 그대로');
});

test('[오늘 못 나가요] 병가가 먼저 승인돼도 오늘 대타를 구할 수 있어요', () => {
  const g = shop();
  g.setKst('2026-11-16 08:00');
  off(g, '김민우', '병가', '');
  g.gs.adminRequest(ADMIN, idOf(g, '병가', '2026-11-16'), true);
  assert.equal(mark(g, '김민우', '2026-11-16'), '병가');
  req(g, '김민우', 'swap', { date: '2026-11-16' });
  const row = reqRows(g).find((x) => x[3] === '대타' && x[4] === '2026-11-16');
  assert.equal(row[5], '10:00-20:00', '병가 요청에 적어 둔 근무 시간');
  g.gs.takeSwap('정하나', PINS.정하나, row[0]);
  g.gs.adminRequest(ADMIN, row[0], true);
  assert.equal(mark(g, '김민우', '2026-11-16'), '병가', '병가 칸 그대로');
  assert.equal(mark(g, '정하나', '2026-11-16'), '대타');
  assert.throws(() => req(g, '김민우', 'swap', { date: '2026-11-21' }), /원래 근무가 없는 날/, '원래 쉬는 날은 그대로 막혀요');
});

/* ───── 알림·출근 ───── */

const ownerMissing = (g) => texts(g, '사장님').filter((t) => /아직 출근 안 찍은 직원/.test(t));
const suspectRows = (g) => { const sh = g.sheet('의심기록'); const out = []; for (let r = 2; r <= sh.getLastRow(); r++) out.push(sh.rowDisplay(r)); return out; };
const hrHole = (g, name) => { g.gs.MEMO_ = {}; g.gs.hrWrite_(g.gs.hrFind_(name).row, { addr: '' }); g.gs.MEMO_ = {}; };
const hrPatch = (g, name) => { g.gs.MEMO_ = {}; g.gs.hrWrite_(g.gs.hrFind_(name).row, { addr: '서울 성동구' }); g.gs.MEMO_ = {}; };

test('점장 미출근 알림이 처음에 못 가면 점장에게만 다시 보내요(사장님·본인에게는 또 안 가요)', () => {
  const g = shop();
  tgOn(g, ['박점장', '김민우']);
  g.setKst('2026-11-16 09:58');
  punch(g, '박점장');
  punch(g, '정하나');
  g.tg.blocked.push(CHAT.박점장);
  g.setKst('2026-11-16 10:10');
  g.gs.checkMissing();
  assert.equal(ownerMissing(g).length, 1);
  assert.equal(missingFor(g, '김민우').length, 1);
  assert.equal(missingFor(g, '박점장').length, 0, '점장에게는 못 갔어요');
  g.tg.blocked.length = 0;
  g.setKst('2026-11-16 10:20');
  g.gs.checkMissing();
  assert.equal(missingFor(g, '박점장').length, 1, '점장에게만 다시');
  assert.equal(ownerMissing(g).length, 1, '사장님께는 한 번');
  assert.equal(missingFor(g, '김민우').length, 1, '본인에게도 한 번');
  g.setKst('2026-11-16 10:30');
  g.gs.checkMissing();
  assert.equal(missingFor(g, '박점장').length, 1, '간 뒤에는 끝');
});

test('다른 매장 대타 날: 미출근·[늦어요] 알림은 그날 일하러 가는 매장 점장에게, 매장 이름도 그 매장으로', () => {
  const g = shop();
  tgOn(g, ['박점장', '최유나', '이지은']);
  g.setKst('2026-11-16 09:00');
  req(g, '정하나', 'swap', { date: '2026-11-17' });
  const id = idOf(g, '대타', '2026-11-17');
  g.gs.takeSwap('이지은', PINS.이지은, id); // 가산 직원이 왕십리 대타
  g.gs.adminRequest(ADMIN, id, true);
  assert.equal(mark(g, '이지은', '2026-11-17'), '대타 왕십리');
  g.setKst('2026-11-17 09:30');
  late(g, '이지은', 10, '지하철', 'bbbbbbbbbbbbbbbb');
  assert.match(texts(g, '박점장').at(-1), /\[왕십리\] 이지은 약 10분 늦어요 \(지하철\)/);
  assert.ok(!texts(g, '최유나').some((t) => /이지은/.test(t)), '가산 점장에게는 안 가요');
  g.setKst('2026-11-17 09:58');
  punch(g, '박점장');
  punch(g, '김민우');
  g.setKst('2026-11-17 10:25');
  g.gs.checkMissing();
  assert.ok(missingFor(g, '박점장').some((t) => /\[왕십리\] 이지은 \(출근 예정 10:00\)/.test(t)));
  assert.ok(!texts(g, '최유나').some((t) => /이지은/.test(t)));
  assert.ok(ownerMissing(g).some((t) => /\[왕십리\] 이지은/.test(t)));
});

test('미출근 알림이 간 뒤 [늦어요]를 누르면, 말한 시간 + 10분에 사장님·점장에게 한 번 더 알려요', () => {
  const g = shop();
  tgOn(g, ['박점장', '김민우']);
  g.setKst('2026-11-16 09:58');
  punch(g, '박점장');
  punch(g, '정하나');
  g.setKst('2026-11-16 10:10');
  g.gs.checkMissing();
  assert.equal(ownerMissing(g).length, 1);
  assert.equal(missingFor(g, '박점장').length, 1);
  g.setKst('2026-11-16 10:15');
  late(g, '김민우', 30, '버스');
  for (const at of ['10:20', '10:30']) {
    g.setKst('2026-11-16 ' + at);
    g.gs.checkMissing();
    assert.equal(ownerMissing(g).length, 1, at + ' 말한 시간까지 기다려요');
  }
  g.setKst('2026-11-16 10:40');
  g.gs.checkMissing();
  assert.equal(ownerMissing(g).length, 2, '알림 글에 적은 대로 다시 알려요');
  assert.equal(missingFor(g, '박점장').length, 2);
  g.setKst('2026-11-16 10:50');
  g.gs.checkMissing();
  assert.equal(ownerMissing(g).length, 2, '한 번만');
});

test('사장님이 [근무표]에서 오늘을 결근으로 정하면 미출근 알림도, 밤 마감 결근? 알림도 안 가요', () => {
  const g = shop();
  tgOn(g, ['박점장', '김민우']);
  g.setKst('2026-11-16 09:00');
  g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 16, '결근');
  g.setKst('2026-11-16 09:58');
  punch(g, '박점장');
  punch(g, '정하나');
  g.setKst('2026-11-16 10:10');
  g.gs.checkMissing();
  assert.equal(ownerMissing(g).length, 0);
  assert.equal(missingFor(g, '김민우').length, 0);
  assert.equal(missingFor(g, '박점장').length, 0);
  g.setKst('2026-11-16 23:35');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민우', '2026-11-16'), '결근', '결근? 으로 바꾸지 않아요');
  assert.ok(!texts(g, '김민우').some((t) => /결근\?'으로 적혔어요/.test(t)));
  assert.match(texts(g, '사장님').find((t) => /하루 마감 정리/.test(t)), /결근 \(사장님이 정함\)[\s\S]*김민우/);
});

test('매장에서 눌렀는데 인사 정보 때문에 막힌 사람: 출근 전 알림은 빼고, 미출근 알림에 처음 누른 시각을 알려요', () => {
  const g = shop();
  tgOn(g, ['박점장', '김민우']);
  hrHole(g, '김민우');
  g.setKst('2026-11-16 09:41');
  assert.throws(() => punch(g, '김민우'), /인사 정보를 먼저/);
  g.setKst('2026-11-16 09:45');
  g.gs.checkMissing();
  assert.ok(!texts(g, '김민우').some((t) => /곧 출근이에요/.test(t)), '이미 매장에서 눌렀어요');
  g.setKst('2026-11-16 09:58');
  punch(g, '박점장');
  punch(g, '정하나');
  g.setKst('2026-11-16 10:10');
  g.gs.checkMissing();
  assert.match(missingFor(g, '김민우')[0], /아까 09:41에 누른 출근이 인사 정보 미입력에 막혔어요\. 10:41까지 인사 정보를 다 넣으면 09:41로 출근이 찍혀요\./);
  assert.match(ownerMissing(g)[0], /김민우 \(출근 예정 10:00 · 09:41 매장에서 눌렀는데 인사 정보 미입력에 막힘\)/);
  assert.match(missingFor(g, '박점장')[0], /09:41 매장에서 눌렀는데 인사 정보 미입력에 막힘/);
});

test('사장님이 인사 정보를 대신 채운 뒤 1시간 안에 그 폰으로 다시 누르면 처음 누른 시각으로 찍혀요', () => {
  const g = shop();
  hrHole(g, '김민우');
  g.setKst('2026-11-16 09:55');
  assert.throws(() => punch(g, '김민우'), /09:55\)은 기억해 둘게요/);
  g.setKst('2026-11-16 10:20');
  hrPatch(g, '김민우'); // 사장님이 인사 카드에서 주소를 채움
  g.setKst('2026-11-16 10:25');
  const r = plain(punch(g, '김민우'));
  assert.equal(logRow(g, '김민우', '2026-11-16')[5], '09:55', '처음 누른 시각');
  assert.equal(r.late, 0);
  assert.equal(r.time, '09:55', '화면에도 처음 누른 시각');
  assert.equal(r.first, 1);
  assert.match(logRow(g, '김민우', '2026-11-16')[13], /처음 누른 시각으로 적음\(인사 정보 미입력 · 막힌 게 풀린 뒤 10:25에 다시 누름\)/);
  assert.ok(suspectRows(g).some((x) => x[2] === '처음 누른 시각으로 적음' && /다시 눌러서 출근 09:55로 적음/.test(x[3])));
  assert.equal(prop(g, 'try:2026-11-16:김민우'), null, '쓴 기록은 지워요');
  // 1시간이 지나서 누르면 지금 시각
  hrHole(g, '정하나');
  g.setKst('2026-11-17 09:50');
  assert.throws(() => punch(g, '정하나'), /인사 정보를 먼저/);
  hrPatch(g, '정하나');
  g.setKst('2026-11-17 10:55');
  punch(g, '정하나');
  assert.equal(logRow(g, '정하나', '2026-11-17')[5], '10:55');
});

test('[오늘 못 나가요]: 점장에게 결재 알림이 못 갔으면 사장님께 한 통만 가요', () => {
  const g = shop();
  tgOn(g, ['박점장', '김민우']);
  g.tg.blocked.push(CHAT.박점장);
  g.setKst('2026-11-16 08:00');
  off(g, '김민우', '병가', '몸살');
  const owner = texts(g, '사장님');
  assert.equal(owner.length, 1, '결재 알림(점장 확인 전) 한 통');
  assert.match(owner[0], /점장 확인 전/);
  assert.match(owner[0], /박점장 점장에게 텔레그램 알림이 안 가서 사장님께도 보내요/);
});

test('밤에는 자동 작업 실패 알림이 소리 없이 가고, 주민번호 열쇠 알림은 아침 7시 뒤에 가요', () => {
  const g = shop();
  tgOn(g, []);
  g.drive.fail = 'Drive 권한이 없어요';
  g.setKst('2026-11-16 03:10'); // 월요일 새벽 백업
  g.gs.checkMissing();
  const fail = sentTo(g, '사장님').filter((m) => /자동 작업을 못 했어요/.test(m.text));
  assert.equal(fail.length, 1);
  assert.match(fail[0].text, /\[주간 백업\]/);
  assert.equal(fail[0].disable_notification, true, '새벽이라 소리 없이');
  g.gs.PropertiesService.getScriptProperties().deleteProperty('hrKey'); // 주민번호 열쇠가 없어졌어요
  g.setKst('2026-11-17 00:10');
  g.gs.checkMissing();
  assert.ok(!texts(g, '사장님').some((t) => /주민번호 열쇠가 없어요/.test(t)), '자정에는 안 울려요');
  g.setKst('2026-11-17 07:10');
  g.gs.checkMissing();
  assert.equal(texts(g, '사장님').filter((t) => /주민번호 열쇠가 없어요/.test(t)).length, 1, '아침에 한 번');
});

test('앱 시작 전에는 대타·[늦어요] 알림에 "결근?으로 적혀요"·"미출근 알림이 가요"를 안 적어요', () => {
  const g = shop();
  g.gs.setSetting_('앱시작일', '');
  tgOn(g, ['박점장', '김민우']);
  g.setKst('2026-11-16 09:00');
  req(g, '김민우', 'swap', { date: '2026-11-17' });
  g.setKst('2026-11-16 09:30');
  late(g, '김민우', 20, '');
  assert.doesNotMatch(texts(g, '박점장').at(-1), /미출근 알림/);
  g.setKst('2026-11-16 18:10');
  g.gs.checkMissing();
  const m = texts(g, '김민우').find((t) => /대타를 아직 못 구했어요/.test(t));
  assert.ok(m);
  assert.doesNotMatch(m, /결근\?/);
  assert.match(m, /못 구하면 그날은 원래대로 출근해야 해요\./);
});

/* ───── 시트·인사·백업 ───── */

test('매주 백업은 사장님 것인 [출퇴근 백업] 폴더에만 넣어요(남이 같은 이름으로 공유한 폴더는 안 써요)', () => {
  const g = shop();
  const other = g.gs.DriveApp.createFolder('출퇴근 백업');
  g.drive.folders.find((x) => x.id === other.getId()).owner = 'someone@example.com'; // 다른 사람이 만들어 공유한 폴더
  g.setKst('2026-11-16 03:10');
  g.gs.checkMissing();
  const copy = g.drive.files.find((f) => /^출퇴근 백업 2026-11-16/.test(f.name));
  assert.ok(copy, '백업은 만들어요');
  assert.notEqual(copy.parent, other.getId(), '남의 폴더에는 안 넣어요');
  const mine = g.drive.folders.find((x) => x.id === copy.parent);
  assert.ok(mine && !mine.owner, '사장님 폴더를 새로 만들어요');
});

test('setup은 [인사] 탭에서 사장님이 붙인 칸의 서식을 바꾸지 않아요(앱 칸만 글자 서식)', () => {
  const g = shop();
  const sh = g.sheet('인사');
  const head = sh.rowDisplay(1);
  const v = head.indexOf('퇴사 사유') + 1; // 예전 [인사] 탭: 이 자리에 사장님이 '보건증 만료' 칸을 붙여 뒀어요
  sh.getRange(1, v).setValue('보건증 만료');
  sh.getRange(2, v, 5, 1).setNumberFormat('yyyy-mm-dd');
  g.gs.MEMO_ = {};
  g.gs.setup();
  assert.equal(sh.fmt(2, v), 'yyyy-mm-dd', '사장님 칸 서식 그대로');
  const nh = sh.rowDisplay(1);
  const r = nh.indexOf('퇴사 사유') + 1;
  assert.ok(r > v, '퇴사 사유 칸은 오른쪽에 새로 붙어요');
  assert.equal(sh.fmt(2, r), '@');
  assert.equal(sh.fmt(2, nh.indexOf('휴대폰') + 1), '@', '앱 칸은 글자 서식');
});

test('[근무표]에서 승인된 대타 칸·휴직 칸은 지우기만 할 수 없어요(쉬는 말은 고를 수 있어요)', () => {
  const g = shop();
  g.setKst('2026-11-16 09:00');
  req(g, '정하나', 'swap', { date: '2026-11-18' });
  const id = idOf(g, '대타', '2026-11-18');
  g.gs.takeSwap('김민우', PINS.김민우, id);
  g.gs.adminRequest(ADMIN, id, true);
  assert.equal(mark(g, '김민우', '2026-11-18'), '대타');
  assert.throws(() => g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 18, ''), /승인된 대타 날이에요\(10:00-20:00 근무\)/);
  assert.equal(mark(g, '김민우', '2026-11-18'), '대타');
  g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 18, '휴무');
  assert.equal(mark(g, '김민우', '2026-11-18'), '휴무', '쉬는 말은 돼요');
  g.gs.adminAway(ADMIN, '이지은', '2026-11-23', '2026-11-27', '병가');
  g.gs.MEMO_ = {};
  assert.equal(mark(g, '이지은', '2026-11-24'), '휴직');
  assert.throws(() => g.gs.adminSetMark(ADMIN, '2026-11', '이지은', 24, ''), /휴직 기간이라 칸을 지워도/);
});

test('근로자 명부: 입사일을 고친 뒤 다시 만들어도 적어 둔 계약 기간이 남아요', () => {
  const g = shop();
  g.setKst('2026-11-16 09:00');
  g.gs.adminRoster(ADMIN);
  const sh = g.sheet('근로자 명부');
  const find = (n) => { for (let r = 3; r <= sh.getLastRow(); r++) if (sh.rowDisplay(r)[0] === n) return r; return 0; };
  const cT = sh.rowDisplay(2).indexOf('계약 기간') + 1;
  sh.getRange(find('김민우'), cT).setValue('2026-03-02 ~ 2027-03-01');
  g.gs.MEMO_ = {};
  g.gs.hrWrite_(g.gs.hrFind_('김민우').row, { start: '2020-01-02' }); // 입사일 고침
  g.gs.MEMO_ = {};
  const out = plain(g.gs.adminRoster(ADMIN));
  assert.equal(sh.rowDisplay(find('김민우'))[cT - 1], '2026-03-02 ~ 2027-03-01');
  assert.equal(sh.rowDisplay(find('김민우'))[6], '2020-01-02');
  assert.ok(!out.warn.some((w) => /계약 기간을 옮기지 못한/.test(w)));
});

test('지점 이동을 예약해 두면, 그날부터 매장 인원은 새 지점으로 세요', () => {
  const g = shop();
  g.setKst('2026-11-16 09:00');
  g.gs.adminMove(ADMIN, '김민우', '가산', '2026-11-25');
  g.gs.MEMO_ = {};
  const before = plain(g.gs.staffOn_('가산', '2026-11-24'));
  const after = plain(g.gs.staffOn_('가산', '2026-11-26'));
  assert.ok(!before.work.includes('김민우'), '이동 전날은 왕십리');
  assert.ok(after.work.includes('김민우'), '이동한 뒤에는 가산에서 세요');
  assert.ok(!plain(g.gs.staffOn_('왕십리', '2026-11-26')).work.includes('김민우'));
  assert.ok(!plain(g.gs.staffOn_('왕십리', '2026-11-26')).off.some((x) => x.name === '김민우'), '왕십리 쉬는 사람에도 안 들어가요');
});

/* ───── 마지막 검사 ───── */

test('지점 이동을 예약한 사람: 그날 다른 매장 대타에 "그날 내 근무"가 보여요(새 지점 기준)', () => {
  const g = shop();
  g.setKst('2026-11-16 09:00');
  g.gs.adminMove(ADMIN, '이지은', '왕십리', '2026-11-19'); // 가산 → 왕십리(11/19부터)
  req(g, '최유나', 'swap', { date: '2026-11-20' }); // 가산 대타
  const v = plain(g.gs.reqsFor_('이지은')).swaps.find((x) => x.id === idOf(g, '대타', '2026-11-20'));
  assert.ok(v && v.clash, '그날은 왕십리 근무가 있어요');
  assert.equal(v.clash.store, '왕십리');
});

test('예약한 지점 이동: [매장]에 없는 지점이거나 오늘 날짜면 지금 지점으로 세요', () => {
  const g = shop();
  g.setKst('2026-11-16 09:00');
  g.gs.adminMove(ADMIN, '김민우', '가산', '2026-11-18');
  g.sheet('매장').getRange(3, 1).setValue('가산디지털'); // 가산 이름을 바꿈(옮길 수 없어요)
  g.gs.MEMO_ = {};
  assert.equal(plain(g.gs.workAt_(g.gs.findStaff_('김민우'), '2026-11-19')).at, '왕십리');
  const g2 = shop();
  g2.setKst('2026-11-16 09:00');
  g2.gs.adminMove(ADMIN, '김민우', '가산', '2026-11-17');
  g2.setKst('2026-11-17 09:00'); // 새벽에 옮기기 전(10분 검사가 아직 안 돎)
  g2.gs.MEMO_ = {};
  assert.equal(plain(g2.gs.workAt_(g2.gs.findStaff_('김민우'), '2026-11-17')).at, '왕십리', '오늘은 지금 지점');
  assert.equal(plain(g2.gs.workAt_(g2.gs.findStaff_('김민우'), '2026-11-18')).at, '가산');
});

test('근로자 명부: 다시 입사한 사람에게는 예전 계약 기간을 옮기지 않고 알려요', () => {
  const g = shop();
  g.setKst('2026-11-16 09:00');
  g.gs.adminRetire(ADMIN, '정하나', '2026-11-10', '계약 만료');
  g.gs.adminRoster(ADMIN);
  const sh = g.sheet('근로자 명부');
  const find = (n) => { for (let r = 3; r <= sh.getLastRow(); r++) if (sh.rowDisplay(r)[0] === n) return r; return 0; };
  const cT = sh.rowDisplay(2).indexOf('계약 기간') + 1;
  sh.getRange(find('정하나'), cT).setValue('2020-01-01 ~ 2026-11-10');
  g.gs.MEMO_ = {};
  g.gs.hrWrite_(g.gs.hrFind_('정하나').row, { state: '근무', end: '', start: '2026-11-20' }); // 다시 입사
  g.gs.MEMO_ = {};
  const out = plain(g.gs.adminRoster(ADMIN));
  assert.equal(sh.rowDisplay(find('정하나'))[cT - 1], '', '예전 계약 기간은 안 옮겨요');
  assert.ok(out.warn.some((w) => /계약 기간을 옮기지 못한 사람.*정하나/.test(w)));
});

test('사장님이 인사 정보를 이미 채웠으면 미출근 알림이 "다시 누르면 그 시각으로"라고 알려요', () => {
  const g = shop();
  tgOn(g, ['김민우']);
  hrHole(g, '김민우');
  g.setKst('2026-11-16 09:41');
  assert.throws(() => punch(g, '김민우'), /인사 정보를 먼저/);
  g.setKst('2026-11-16 09:50');
  hrPatch(g, '김민우');
  g.setKst('2026-11-16 10:10');
  g.gs.checkMissing();
  assert.match(missingFor(g, '김민우')[0], /이제 인사 정보가 다 채워졌어요\. 10:41까지 그 폰으로 출근을 다시 누르면 09:41로 찍혀요\./);
});

test('오늘 대타 근무 시간 빌려 오기는 [오늘 못 나가요]만: 미리 받은 휴무 날에는 대타를 못 올려요', () => {
  const g = shop();
  g.setKst('2026-11-16 09:00');
  req(g, '김민우', 'off', { offType: '휴무', date: '2026-11-18', reason: '개인 사정' });
  g.gs.adminRequest(ADMIN, idOf(g, '휴무', '2026-11-18'), true);
  g.setKst('2026-11-18 08:00');
  assert.throws(() => req(g, '김민우', 'swap', { date: '2026-11-18' }), /원래 근무가 없는 날/);
});

test('퇴사 예정: 출근하는 날이 마지막 근무일 뒤인 휴무 바꾸기는 승인하지 않아요', () => {
  const g = shop();
  g.setKst('2026-11-16 09:00');
  req(g, '김민우', 'move', { date: '2026-11-18', dateFrom: '2026-11-21', reason: '개인 사정' }); // 수 쉬고 토 출근
  const id = idOf(g, '바꾸기', '2026-11-18');
  g.gs.adminRetire(ADMIN, '김민우', '2026-11-20', '자진 퇴사');
  assert.match(card(g, id).note, /11\/20\(금\)까지 근무해요\(퇴사 예정\)/);
  assert.throws(() => g.gs.adminRequest(ADMIN, id, true), /11\/20\(금\)까지 근무해요\(퇴사 예정\)/);
  assert.equal(mark(g, '김민우', '2026-11-18'), '');
});

test('예전 버전이 기억해 둔 남의 [출퇴근 백업] 폴더는 버리고 사장님 폴더에 백업해요', () => {
  const g = shop();
  const other = g.gs.DriveApp.createFolder('출퇴근 백업');
  g.drive.folders.find((x) => x.id === other.getId()).owner = 'someone@example.com';
  g.gs.PropertiesService.getScriptProperties().setProperty('backup:folder', other.getId());
  g.setKst('2026-11-16 03:10');
  g.gs.checkMissing();
  const copy = g.drive.files.find((f) => /^출퇴근 백업 2026-11-16/.test(f.name));
  assert.ok(copy);
  assert.notEqual(copy.parent, other.getId());
  assert.notEqual(prop(g, 'backup:folder'), other.getId(), '새 폴더를 기억해요');
});

test('동료가 내 이름으로 비밀번호를 5번 틀려도, 내 폰으로는 요청 취소·대타 받기를 할 수 있어요', () => {
  const g = shop();
  g.setKst('2026-11-16 08:30');
  req(g, '김민우', 'off', { offType: '휴무', date: '2026-11-20', reason: '병원', device: PHONE.김민우 });
  req(g, '정하나', 'swap', { date: '2026-11-19' });
  for (let i = 0; i < 5; i++) assert.throws(() => g.gs.takeSwap('김민우', '1111', idOf(g, '대타', '2026-11-19')), /비밀번호가 틀렸어요/);
  assert.throws(() => g.gs.cancelRequest('김민우', PINS.김민우, idOf(g, '휴무', '2026-11-20')), /잠깐|10분/, '폰을 안 밝히면 이름 잠금');
  g.gs.cancelRequest('김민우', PINS.김민우, idOf(g, '휴무', '2026-11-20'), PHONE.김민우);
  assert.equal(stateOf(g, '휴무', '2026-11-20'), '취소');
  g.gs.takeSwap('김민우', PINS.김민우, idOf(g, '대타', '2026-11-19'), PHONE.김민우);
  assert.equal(stateOf(g, '대타', '2026-11-19'), '수락');
});

test('[오늘 못 나가요]가 아무에게도 안 갔으면(텔레그램·메일 연결 전) 화면에서 전화하라고 알려요', () => {
  const g = shop();
  g.gs.setSetting_('알림이메일', '');
  g.setKst('2026-11-16 08:00');
  assert.equal(plain(off(g, '김민우', '병가', '')).nobody, true);
  const g2 = shop(); // 메일이 연결돼 있으면 사장님께 가요
  g2.setKst('2026-11-16 08:00');
  assert.equal(plain(off(g2, '김민우', '병가', '')).nobody, false);
});

/* ───── 사장님 요청: 퇴근은 안 찍어도 알림 없음, 휴무표 탭 이름은 26.11처럼 짧게 ───── */

test('[설정] 퇴근확인 기본 안함: 퇴근을 안 찍어도 알림·안내·밤 정리 목록·[월별] 확인할 것에 안 나와요', () => {
  const g = shop();
  tgOn(g, ['김민우']);
  assert.equal(g.gs.settings_().outCheck, '안함');
  g.setKst('2026-11-16 09:58');
  punch(g, '김민우');
  for (const at of ['20:15', '20:40']) { g.setKst('2026-11-16 ' + at); g.gs.checkMissing(); }
  assert.ok(!texts(g, '김민우').some((t) => /퇴근을 (아직 )?안 찍었어요/.test(t)), '본인 알림 없음');
  g.setKst('2026-11-16 23:35');
  g.gs.checkMissing();
  assert.ok(!texts(g, '김민우').some((t) => /퇴근을 (아직 )?안 찍었어요/.test(t)), '밤 알림도 없음');
  assert.doesNotMatch(texts(g, '사장님').find((t) => /하루 마감 정리/.test(t)) || '', /퇴근 안 찍음/);
  g.setKst('2026-11-17 09:00');
  assert.equal(plain(g.gs.getHome('김민우', PINS.김민우)).missingOut, null, '직원 화면 "퇴근 누락" 안내 없음');
  assert.deepEqual(plain(g.gs.adminIssues(ADMIN, '')).noOut, [], '[월별] 확인할 것에도 없음');
  // 켜면 예전처럼
  g.gs.setSetting_('퇴근확인', '함');
  g.gs.MEMO_ = {};
  assert.ok(plain(g.gs.getHome('김민우', PINS.김민우)).missingOut);
  assert.equal(plain(g.gs.adminIssues(ADMIN, '')).noOut.length, 1);
});

test('휴무표 탭 이름은 26.11처럼 짧게 만들고, 예전 이름(휴무표 2026-11) 탭은 setup·10분 검사가 바꿔요', () => {
  const g = shop();
  assert.ok(g.sheet('26.11'), '새 이름');
  assert.equal(g.sheet('휴무표 2026-11'), null);
  assert.equal(g.gs.monthName_('2027-01'), '27.01');
  assert.equal(g.gs.tabYm_('26.11'), '2026-11');
  assert.equal(g.gs.tabYm_('휴무표 2026-11'), '2026-11');
  assert.equal(g.gs.tabYm_('26.13'), '');
  assert.equal(g.gs.tabYm_('설정'), '');
  // 예전 버전이 만든 탭: 이름이 바뀌기 전에도 그대로 읽고 써요
  g.sheet('26.11').setName('휴무표 2026-11');
  g.gs.GRID_ = {}; g.gs.MEMO_ = {}; g.gs.RENAMED_ = false;
  g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 20, '휴무');
  g.gs.GRID_ = {}; g.gs.MEMO_ = {};
  assert.equal(g.gs.dayMark_('김민우', '2026-11-20'), '휴무', '예전 이름 탭에 적혀요');
  assert.ok(g.sheet('휴무표 2026-11'), '아직 안 바꿨어요');
  g.setKst('2026-11-16 10:00');
  g.gs.checkMissing(); // 10분 검사가 바꿔요
  assert.ok(g.sheet('26.11'));
  assert.equal(g.sheet('휴무표 2026-11'), null);
  g.gs.GRID_ = {}; g.gs.MEMO_ = {};
  assert.equal(g.gs.dayMark_('김민우', '2026-11-20'), '휴무', '기록은 그대로');
  // setup도 바꿔요
  g.sheet('26.11').setName('휴무표 2026-11');
  g.gs.RENAMED_ = false;
  g.gs.setup();
  assert.ok(g.sheet('26.11'));
  assert.equal(g.book.getSheets().filter((x) => /^휴무표 /.test(x.getName())).length, 0, '예전 이름 탭이 하나도 안 남아요');
});

test('텔레그램이 "잠깐 기다려(Too Many Requests)"라고 하면: 알림 연결은 5초 안이면 한 번 기다렸다 다시, 막힌 동안은 아무도 안 불러서 버튼이 안 느려져요', () => {
  const g = shop();
  tgOn(g, ['김민우']);
  g.setKst('2026-11-24 10:00');
  const s = g.gs.staffTgStart('정하나', PINS.정하나);
  const code = s.url.split('start=')[1];
  g.tg.updates.push({ update_id: 10, message: { chat: { id: 9007, type: 'private' }, text: '/start ' + code } });
  g.tg.rate = 1; // 첫 번째 부르기만 429(4초)
  assert.equal(g.gs.staffTgCheck('정하나', PINS.정하나).tg, 'on', '한 번 기다렸다가 다시 해서 연결돼요');
  assert.ok(g.tg.slept >= 4000 && g.tg.slept < 6000, '텔레그램이 말한 4초만 기다려요');
  // 계속 막혀 있으면 기다린 뒤 한 번만 더 해 보고, 남은 시간과 함께 알아듣게 알려요
  const s2 = g.gs.staffTgStart('박점장', PINS.박점장);
  g.tg.updates.push({ update_id: 11, message: { chat: { id: 9005, type: 'private' }, text: '/start ' + s2.url.split('start=')[1] } });
  g.tg.rate = 10;
  assert.throws(() => g.gs.staffTgCheck('박점장', PINS.박점장), /텔레그램 서버가 이 봇을 잠깐 막았어요\(4초 뒤에 풀려요\)\. 그 뒤에 ②를 다시 눌러 주세요/);
  // 막힌 동안은 텔레그램을 안 불러요: 승인 알림 같은 건 바로 넘어가요(기다리지 않아요)
  const calls = g.tg.calls.length, slept = g.tg.slept;
  const r = plain(g.gs.makeRequest({ name: '김민우', pin: PINS.김민우, kind: 'off', offType: '휴무', date: '2026-11-27', reason: '병원' }));
  g.gs.adminRequest(ADMIN, r.mine[0].id, true, true);
  assert.equal(g.tg.calls.length, calls, '막힌 동안 텔레그램을 안 불러요');
  assert.equal(g.tg.slept, slept, '기다리지 않아요');
  // 시간이 지나면 다시 돼요(연결 코드는 그대로)
  g.tg.rate = 0;
  g.setKst('2026-11-24 10:01');
  assert.equal(g.gs.staffTgCheck('박점장', PINS.박점장).tg, 'on');
});

/* ───── 휴무 고르기: 다 고르고 한 번에 저장(월차도) ───── */

test('휴무 고르기: 여러 날(휴무·월차)을 한 번에 저장하고, 안 되는 날만 빼고 나머지는 저장해요', () => {
  const g = shop();
  g.sheet('매장').getRange(2, 9, 1, 2).setValues([['1', '2']]); // 왕십리 하루 최대 1명, 한 달 휴무 2일
  g.setKst('2026-11-21 10:00');
  g.gs.MEMO_ = {};
  g.gs.makeMonth_('2026-12');
  g.gs.GRID_ = {}; g.gs.MEMO_ = {};
  g.gs.setMark_('2026-12-15', '정하나', () => '휴무'); // 15일은 정하나가 이미 쉬어요
  g.gs.setMark_('2026-12-22', '김민우', () => '휴무'); // 사장님이 확정해 둔 날
  const r = plain(g.gs.wishSave('김민우', PINS.김민우, [
    { date: '2026-12-08', v: '휴무' },
    { date: '2026-12-09', v: '월차' },
    { date: '2026-12-15', v: '휴무' }, // 하루 최대 1명
    { date: '2026-12-16', v: '휴무' }, // 한 달 휴무 2일(22일 확정 + 8일)
    { date: '2026-12-22', v: '' }, // 확정된 날은 못 빼요
    { date: '2026-12-12', v: '휴무' }, // 토요일: 김민우는 원래 쉬는 날
  ], PHONE.김민우));
  assert.deepEqual(r.saved.map((x) => x.date + ' ' + x.v).sort(), ['2026-12-08 휴무', '2026-12-09 월차']);
  const err = Object.fromEntries(r.errors.map((x) => [x.date, x.msg]));
  assert.match(err['2026-12-15'], /이미 정하나 님이 쉬어요/);
  assert.match(err['2026-12-16'], /한 달에 휴무는 2일까지/);
  assert.match(err['2026-12-22'], /이미 "휴무"\(이\)라고 적혀 있어요/);
  assert.match(err['2026-12-12'], /원래 쉬는 날/);
  g.gs.GRID_ = {}; g.gs.MEMO_ = {};
  assert.equal(g.gs.dayMark_('김민우', '2026-12-08'), '휴무?');
  assert.equal(g.gs.dayMark_('김민우', '2026-12-09'), '월차?');
  assert.equal(r.sched.sum.wishes, 1);
  assert.equal(r.sched.sum.mwishes, 1);
  // 바꾸기·빼기도 한 번에
  const r2 = plain(g.gs.wishSave('김민우', PINS.김민우, [{ date: '2026-12-08', v: '월차' }, { date: '2026-12-09', v: '' }], PHONE.김민우));
  assert.equal(r2.errors.length, 0);
  g.gs.GRID_ = {}; g.gs.MEMO_ = {};
  assert.equal(g.gs.dayMark_('김민우', '2026-12-08'), '월차?');
  assert.equal(g.gs.dayMark_('김민우', '2026-12-09'), '');
  // 동료에게는 고른 월차도 '휴무?'로 보여요(쉬는 종류는 가려요)
  const mate = plain(g.gs.getSchedule('정하나', PINS.정하나, '2026-12')).others.find((o) => o.name === '김민우');
  assert.equal(mate.days[7], '휴무?');
  // 사장님이 확정하면 휴무·월차
  const w = plain(g.gs.adminWishes(ADMIN));
  const row = w.stores.find((s) => s.name === '왕십리').rows.find((x) => x.name === '김민우');
  assert.deepEqual(row.mwish, [8]);
  assert.equal(plain(g.gs.adminConfirmWishes(ADMIN, '왕십리')).confirmed, 1);
  g.gs.GRID_ = {}; g.gs.MEMO_ = {};
  assert.equal(g.gs.dayMark_('김민우', '2026-12-08'), '월차');
});

test('휴무 고르기: 월차는 다음 달에 쓸 수 있는 개수까지만, 기간이 아니면 저장이 안 돼요', () => {
  const g = shop();
  g.setKst('2026-11-21 10:00');
  g.gs.MEMO_ = {};
  g.gs.makeMonth_('2026-12');
  g.gs.GRID_ = {}; g.gs.MEMO_ = {};
  const grid = g.gs.monthGrid_('2026-12', true);
  g.sheet('26.12').getRange(grid.rows['김민우'].row, grid.cols.left + 1).setValue('1'); // 12월 잔여 1개
  g.gs.GRID_ = {}; g.gs.MEMO_ = {};
  const r = plain(g.gs.wishSave('김민우', PINS.김민우, [{ date: '2026-12-08', v: '월차' }, { date: '2026-12-09', v: '월차' }], PHONE.김민우));
  assert.equal(r.saved.length, 1);
  assert.match(r.errors[0].msg, /다음 달에 쓸 수 있는 월차가 1개/);
  g.setKst('2026-11-27 10:00');
  assert.throws(() => g.gs.wishSave('김민우', PINS.김민우, [{ date: '2026-12-10', v: '휴무' }], PHONE.김민우), /고를 기간이 지났어요/);
});

/* ───── 쉬는 날 종류를 여러 가지로(휴무·월차·기타 + 이유) ───── */

const noteOf = (g, ym, name, day) => {
  g.gs.GRID_ = {}; g.gs.MEMO_ = {};
  const grid = g.gs.monthGrid_(ym, true);
  return String(g.sheet(g.gs.monthName_(ym)).getRange(grid.rows[name].row, grid.cols.day1 + day).getNotes()[0][0] || '');
};

test('휴무 고르기: 기타(병가·경조·예비군·기타 등)를 이유와 같이 고르고, 사장님이 이유를 보고 확정해요', () => {
  const g = shop();
  g.sheet('매장').getRange(2, 9, 1, 2).setValues([['1', '2']]); // 왕십리 하루 최대 1명, 한 달 휴무 2일
  g.setKst('2026-11-21 10:00');
  g.gs.MEMO_ = {};
  g.gs.makeMonth_('2026-12');
  g.gs.GRID_ = {}; g.gs.MEMO_ = {};
  g.gs.setMark_('2026-12-15', '정하나', () => '휴무'); // 15일은 정하나가 이미 쉬어요(하루 최대 1명)
  const r = plain(g.gs.wishSave('김민우', PINS.김민우, [
    { date: '2026-12-08', v: '병가', why: '치과 수술' },
    { date: '2026-12-09', v: '기타', why: '' }, // 기타는 이유를 꼭
    { date: '2026-12-10', v: '기타', why: '이사' },
    { date: '2026-12-11', v: '예비군' }, // 예비군은 이유 없어도 돼요
    { date: '2026-12-15', v: '경조', why: '동생 결혼식' }, // 사정이 있는 날은 하루 최대 인원이 차도 골라요(사장님이 보고 정해요)
    { date: '2026-12-16', v: '아무말', why: 'x' }, // 모르는 종류는 빼기로 봐요(빈칸이라 바뀐 것 없음)
  ], PHONE.김민우));
  assert.deepEqual(r.saved.map((x) => x.date + ' ' + x.v).sort(), ['2026-12-08 병가', '2026-12-10 기타', '2026-12-11 예비군', '2026-12-15 경조']);
  assert.equal(r.errors.length, 1);
  assert.match(r.errors[0].msg, /이유를 적어/);
  assert.equal(mark(g, '김민우', '2026-12-08'), '병가?');
  assert.equal(mark(g, '김민우', '2026-12-10'), '기타?');
  assert.equal(mark(g, '김민우', '2026-12-11'), '예비군?');
  assert.equal(mark(g, '김민우', '2026-12-15'), '경조?');
  assert.match(noteOf(g, '2026-12', '김민우', 8), /사유: 치과 수술/);
  assert.equal(noteOf(g, '2026-12', '김민우', 11), '');
  // 내 근무표에는 이유가 보이고, 동료에게는 '휴무?'로만(이유·종류는 가려요)
  g.gs.MEMO_ = {}; g.gs.GRID_ = {};
  const me = plain(g.gs.getSchedule('김민우', PINS.김민우, '2026-12'));
  assert.equal(me.me[7], '병가?');
  assert.equal(me.why[7], '치과 수술');
  assert.equal(me.why[9], '이사');
  assert.equal(me.sum.off, 0, '병가·기타는 휴무 일수에 안 세요');
  assert.equal(me.sum.ewishes, 4);
  const mate = plain(g.gs.getSchedule('정하나', PINS.정하나, '2026-12')).others.find((o) => o.name === '김민우');
  assert.equal(mate.days[7], '휴무?');
  assert.equal(mate.days[9], '휴무?');
  assert.equal(JSON.stringify(mate).includes('치과'), false);
  // 이유만 바꾸기 · 빼기
  const r2 = plain(g.gs.wishSave('김민우', PINS.김민우, [{ date: '2026-12-08', v: '병가', why: '치과 검진' }, { date: '2026-12-10', v: '' }], PHONE.김민우));
  assert.equal(r2.errors.length, 0);
  assert.equal(r2.saved.length, 2);
  assert.equal(noteOf(g, '2026-12', '김민우', 8).match(/사유:/g).length, 1);
  assert.match(noteOf(g, '2026-12', '김민우', 8), /사유: 치과 검진/);
  assert.equal(mark(g, '김민우', '2026-12-10'), '');
  assert.doesNotMatch(noteOf(g, '2026-12', '김민우', 10), /사유:/);
  // 휴무?·월차? 대신 고른 날에 기타를 고르면 종류가 바뀌어요
  g.gs.wishSave('김민우', PINS.김민우, [{ date: '2026-12-17', v: '휴무' }], PHONE.김민우);
  const r3 = plain(g.gs.wishSave('김민우', PINS.김민우, [{ date: '2026-12-17', v: '무급', why: '개인 사정' }], PHONE.김민우));
  assert.equal(r3.errors.length, 0);
  assert.equal(mark(g, '김민우', '2026-12-17'), '무급?');
  // 사장님: 종류와 이유가 보이고, 확정하면 '?'가 빠져요(이유 메모는 남아요)
  g.gs.MEMO_ = {}; g.gs.GRID_ = {};
  const w = plain(g.gs.adminWishes(ADMIN));
  const st = w.stores.find((s) => s.name === '왕십리');
  const row = st.rows.find((x) => x.name === '김민우');
  assert.deepEqual(row.ewish, [
    { d: 8, kind: '병가', why: '치과 검진' }, { d: 11, kind: '예비군', why: '' }, { d: 15, kind: '경조', why: '동생 결혼식' }, { d: 17, kind: '무급', why: '개인 사정' },
  ]);
  assert.equal(st.wishes, 4);
  assert.equal(plain(g.gs.adminConfirmWishes(ADMIN, '왕십리')).confirmed, 4);
  assert.equal(mark(g, '김민우', '2026-12-08'), '병가');
  assert.equal(mark(g, '김민우', '2026-12-17'), '무급');
  assert.match(noteOf(g, '2026-12', '김민우', 8), /사유: 치과 검진/);
});

test('휴무 신청·오늘 못 나가요: 기타는 사유를 꼭 적고, 승인되면 휴무표 칸에 기타와 사유 메모가 남아요', () => {
  const g = shop();
  assert.throws(() => req(g, '김민우', 'off', { offType: '기타', date: '2026-11-20', reason: '', device: PHONE.김민우 }), /사유를 꼭/);
  req(g, '김민우', 'off', { offType: '기타', date: '2026-11-20', reason: '가족 일', to: 'admin', device: PHONE.김민우 });
  const id = idOf(g, '기타', '2026-11-20');
  assert.ok(id);
  g.gs.adminRequest(ADMIN, id, true);
  assert.equal(mark(g, '김민우', '2026-11-20'), '기타');
  assert.match(noteOf(g, '2026-11', '김민우', 20), /사유: 가족 일/);
  // 그날은 쉬는 날이라 밤 마감이 결근?을 안 적어요
  assert.equal(g.gs.schedFor_(g.gs.person_('김민우'), '2026-11-20'), null);
  // 병가는 사유를 안 적어도 되고, 승인되면 적은 사유가 메모로
  req(g, '김민우', 'off', { offType: '병가', date: '2026-11-19', reason: '감기', to: 'admin', device: PHONE.김민우 });
  g.gs.adminRequest(ADMIN, idOf(g, '병가', '2026-11-19'), true);
  assert.match(noteOf(g, '2026-11', '김민우', 19), /사유: 감기/);
  // 오늘 못 나가요: 기타는 이유를 꼭
  assert.throws(() => off(g, '정하나', '기타', ''), /사유를 꼭/);
  const r = plain(off(g, '정하나', '기타', '아이가 아파요'));
  assert.equal(r.kind, '기타');
  assert.equal(stateOf(g, '기타', '2026-11-16'), '대기');
});

test('사장님 근무표: 병가·경조·예비군·휴가·기타도 고를 수 있고, 사유를 적으면 칸 메모에 남고 표에 보여요', () => {
  const g = shop();
  let r = plain(g.gs.adminGrid(ADMIN, '2026-11'));
  for (const k of ['휴가', '병가', '경조', '예비군', '기타']) assert.ok(r.marks.includes(k), k);
  r = plain(g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 25, '병가', '', '독감'));
  assert.equal(mark(g, '김민우', '2026-11-25'), '병가');
  assert.match(noteOf(g, '2026-11', '김민우', 25), /사유: 독감/);
  assert.match(noteOf(g, '2026-11', '김민우', 25), /사장님: 빈칸 → 병가/);
  const row = r.stores.find((s) => s.name === '왕십리').rows.find((x) => x.name === '김민우');
  assert.equal(row.why['25'], '독감');
  // 다른 말로 바꾸면 사유는 지워요(기록 줄은 남아요)
  r = plain(g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 25, '휴무', '병가', ''));
  assert.doesNotMatch(noteOf(g, '2026-11', '김민우', 25), /사유:/);
  assert.match(noteOf(g, '2026-11', '김민우', 25), /병가 → 휴무/);
  // 기타도 사유와 같이
  const r2 = plain(g.gs.adminSetMark(ADMIN, '2026-11', '김민우', 26, '기타', '', '이사'));
  assert.equal(r2.stores.find((s) => s.name === '왕십리').rows.find((x) => x.name === '김민우').why['26'], '이사');
});

/* ───── 조퇴·외출 요청 ───── */

test('조퇴 요청: 나갈 시각·사유를 보내고, 승인되면 그날 예정 퇴근이 바뀌어 조퇴로 안 잡히고 기록 메모에 남아요', () => {
  const g = shop();
  const early = (extra) => req(g, '김민우', 'early', { date: '2026-11-16', to: 'admin', device: PHONE.김민우, ...extra });
  assert.throws(() => early({ earlyType: '조퇴', time: '', reason: '병원' }), /나갈 시각/);
  assert.throws(() => early({ earlyType: '조퇴', time: '09:00', reason: '병원' }), /근무 시간\(10:00-20:00\) 안/);
  assert.throws(() => early({ earlyType: '조퇴', time: '20:30', reason: '병원' }), /근무 시간\(10:00-20:00\) 안/);
  assert.throws(() => early({ earlyType: '조퇴', time: '16:00', reason: '' }), /사유/);
  early({ earlyType: '조퇴', time: '16:00', reason: '병원' });
  assert.throws(() => early({ earlyType: '조퇴', time: '15:00', reason: '병원' }), /이미 조퇴 요청/);
  const id = idOf(g, '조퇴', '2026-11-16');
  assert.ok(id);
  const c = card(g, id);
  assert.match(c.what, /16:00에 퇴근 \(원래 10:00-20:00\)/);
  g.gs.adminRequest(ADMIN, id, true);
  g.gs.MEMO_ = {};
  const s = g.gs.schedFor_(g.gs.person_('김민우'), '2026-11-16');
  assert.equal(g.gs.fmtSched_(s), '10:00-16:00');
  // 출근·퇴근을 찍으면 예정 퇴근이 16:00이고, 메모에 조퇴 승인이 남아요
  g.setKst('2026-11-16 09:55');
  punch(g, '김민우', 'in');
  g.setKst('2026-11-16 16:02');
  punch(g, '김민우', 'out');
  const row = logRow(g, '김민우', '2026-11-16');
  assert.equal(row[4], '16:00', '예정 퇴근');
  assert.equal(Number(row[8] || 0), 0, '조퇴(분) 없음');
  assert.match(row[13], /조퇴 승인 16:00\(병원\)/);
});

test('외출 요청: 나갔다 올 시각을 보내고, 승인되면 기록 메모에 남아요(예정 시간은 그대로). 이미 출근했으면 바로 적혀요', () => {
  const g = shop();
  const out = (extra) => req(g, '정하나', 'early', { date: '2026-11-16', to: 'admin', device: PHONE.정하나, earlyType: '외출', reason: '은행', ...extra });
  assert.throws(() => out({ time: '14:00', time2: '13:30' }), /돌아올 시각/);
  assert.throws(() => out({ time: '14:00', time2: '' }), /돌아올 시각/);
  g.setKst('2026-11-16 10:00');
  punch(g, '정하나', 'in');
  out({ time: '14:00', time2: '15:30' });
  const id = idOf(g, '외출', '2026-11-16');
  assert.match(card(g, id).what, /14:00~15:30 외출 \(원래 10:00-20:00\)/);
  g.gs.adminRequest(ADMIN, id, true);
  const row = logRow(g, '정하나', '2026-11-16');
  assert.match(row[13], /외출 승인 14:00~15:30\(은행\)/);
  assert.equal(row[4], '20:00', '예정 퇴근은 그대로');
  // 지난 날도 14일 안이면 보낼 수 있어요(나간 뒤에 알리는 경우), 60일 넘는 앞날은 안 돼요
  assert.throws(() => out({ date: '2027-02-01', time: '14:00', time2: '15:00' }), /60일/);
});

/* ───── 증빙 사진 ───── */

const JPG = 'data:image/jpeg;base64,' + Buffer.from('fake jpeg bytes').toString('base64');

test('증빙 사진: 내 요청에 사진을 올리면 드라이브 [출퇴근 증빙] 폴더에 저장되고, 사장님 카드에 보기 링크(점장은 있음만)', () => {
  const g = shop();
  req(g, '김민우', 'off', { offType: '병가', date: '2026-11-18', dateTo: '2026-11-19', reason: '독감', device: PHONE.김민우 }); // 점장(박점장) 먼저
  const ids = reqRows(g).filter((x) => x[3] === '병가').map((x) => x[0]);
  assert.equal(ids.length, 2);
  assert.throws(() => g.gs.reqProof('정하나', PINS.정하나, ids, JPG, PHONE.정하나), /내 요청/);
  assert.throws(() => g.gs.reqProof('김민우', PINS.김민우, ids, 'data:text/plain;base64,aGk=', PHONE.김민우), /사진/);
  assert.throws(() => g.gs.reqProof('김민우', PINS.김민우, ids, 'data:image/jpeg;base64,' + 'A'.repeat(7 * 1024 * 1024), PHONE.김민우), /너무 커요/);
  const r = plain(g.gs.reqProof('김민우', PINS.김민우, ids, JPG, PHONE.김민우));
  assert.ok(r.mine.filter((x) => x.kind === '병가').every((x) => x.proof === true));
  const folder = g.drive.folders.find((f) => f.name === '출퇴근 증빙');
  assert.ok(folder, '폴더를 만들어요');
  const names = g.drive.namesIn(folder);
  assert.equal(names.length, 1, '여러 날 묶음은 사진 한 장');
  assert.match(names[0], /^2026-11-18 김민우 병가 R/);
  const url = reqRows(g).find((x) => x[0] === ids[0])[12];
  assert.match(url, /^https:\/\/drive\.google\.com\/file\/d\/file\d+\/view/);
  assert.equal(reqRows(g).find((x) => x[0] === ids[1])[12], url);
  // 사장님 카드에는 보기 링크, 점장 카드에는 '있음'만(건강 서류는 사장님만)
  assert.equal(card(g, ids[0]).proof, url);
  const mgr = plain(g.gs.adminToday({ name: '박점장', pin: PINS.박점장 })).requests.find((x) => x.id === ids[0]);
  assert.equal(mgr.proof, '있음');
  // 다시 올리면 새 사진으로 바꾸고 예전 사진은 휴지통으로
  g.gs.reqProof('김민우', PINS.김민우, ids, JPG, PHONE.김민우);
  assert.equal(g.drive.namesIn(folder).length, 1);
  assert.equal(g.drive.files.filter((f) => f.parent === folder.getId() && f.trashed).length, 1);
  // 요청을 취소하면 사진도 휴지통으로
  g.gs.cancelRequest('김민우', PINS.김민우, ids[0], PHONE.김민우);
  g.gs.cancelRequest('김민우', PINS.김민우, ids[1], PHONE.김민우);
  assert.equal(g.drive.namesIn(folder).length, 0);
  // 끝난(거절·취소) 요청에는 못 올려요
  assert.throws(() => g.gs.reqProof('김민우', PINS.김민우, [ids[0]], JPG, PHONE.김민우), /취소된 요청/);
});

test('증빙 사진: 승인된 요청에도 나중에 올릴 수 있고, 승인 뒤 30일이 지나면 못 올려요', () => {
  const g = shop();
  req(g, '정하나', 'off', { offType: '예비군', date: '2026-11-18', reason: '예비군 훈련', to: 'admin', device: PHONE.정하나 });
  const id = idOf(g, '예비군', '2026-11-18');
  g.gs.adminRequest(ADMIN, id, true);
  plain(g.gs.reqProof('정하나', PINS.정하나, [id], JPG, PHONE.정하나));
  assert.match(reqRows(g).find((x) => x[0] === id)[12], /drive\.google\.com/);
  g.setKst('2026-12-20 10:00');
  assert.throws(() => g.gs.reqProof('정하나', PINS.정하나, [id], JPG, PHONE.정하나), /30일/);
});

/* ───── 수습 끝·계약 끝 알림 ───── */

const hrSave = (g, name, extra) => {
  const cur = plain(g.gs.adminHrGet(ADMIN, name));
  delete cur.docs; delete cur.offb;
  return plain(g.gs.adminHrSave(ADMIN, name, { ...cur, ...extra }));
};

test('수습 끝·계약 끝: 인사 카드에 적고, 30일·7일 전과 전날 밤 마감 정리에 알리고, [오늘]에 30일 안의 것이 보여요', () => {
  const g = shop();
  assert.throws(() => hrSave(g, '김민우', { probEnd: '2026-13-40' }), /수습 끝/);
  let c = hrSave(g, '김민우', { probEnd: '2026-12-16', contractEnd: '' });
  assert.equal(c.probEnd, '2026-12-16');
  assert.equal(c.contractEnd, '');
  assert.equal(c.addr, '서울 성동구', '다른 칸은 그대로');
  // 정하나: 계약 끝(입사 2020-01-01이라 2년이 넘는 계약직 안내)
  c = hrSave(g, '정하나', { contractEnd: '2026-12-23' });
  assert.match(c.contractNote, /2년/);
  // [오늘]: 30일 안에 끝나는 것(사장님만)
  const t = plain(g.gs.adminToday(ADMIN));
  assert.deepEqual(t.hrDue.map((x) => x.name + ' ' + x.kind + ' ' + x.end + ' ' + x.left), ['김민우 수습 2026-12-16 30']);
  assert.deepEqual(plain(g.gs.adminToday({ name: '박점장', pin: PINS.박점장 })).hrDue, []);
  // 밤 마감 정리: 30일 전·7일 전·전날에만
  const close = (d) => plain(g.gs.dailyClose_(g.gs.settings_(), d, { dry: true })).text;
  assert.match(close('2026-11-16'), /수습·계약·현금 1건[\s\S]*\[왕십리\] 김민우 수습 끝 12\/16\(수\) · 30일 남음/);
  assert.doesNotMatch(close('2026-11-17'), /수습·계약/);
  assert.match(close('2026-11-23'), /\[왕십리\] 정하나 계약 끝 12\/23\(수\) · 30일 남음/);
  assert.match(close('2026-12-09'), /김민우 수습 끝 12\/16\(수\) · 7일 남음/);
  assert.match(close('2026-12-15'), /김민우 수습 끝 12\/16\(수\) · 내일이에요/);
  // 퇴사 예정이면(마지막 근무일이 끝보다 먼저) 안 알려요
  g.gs.adminRetire(ADMIN, '김민우', '2026-12-01', '자진 퇴사');
  assert.doesNotMatch(close('2026-12-09'), /김민우 수습/);
});

test('수습 끝: 입사 등록을 승인하면 [설정] 수습개월(기본 3)로 채우고, 0이면 안 채워요. 근로자 명부 계약 기간에도 나와요', () => {
  const g = shop();
  const join = (name, dev, start) => {
    g.gs.joinSubmit({
      name, rrn: '991231-1234567', phone: '01012345678', addr: '서울 성동구', bank: '국민', account: '123456-78-901234', holder: '',
      emergency: '010-9999-8888 어머니', store: '가산', start, pin: '4826', device: dev, label: 'Galaxy 크롬', agree: true, agreeLoc: true,
    });
    g.gs.adminJoin(ADMIN, name, true);
    g.gs.MEMO_ = {};
    return plain(g.gs.adminHrGet(ADMIN, name));
  };
  assert.equal(join('한신입', 'f1f1f1f1f1f1f1f1', '2026-11-30').probEnd, '2027-02-28', '3개월(2/30이 없으면 그 달 끝까지)');
  g.gs.setSetting_('수습개월', '0');
  g.gs.MEMO_ = {};
  assert.equal(join('두신입', 'f2f2f2f2f2f2f2f2', '2026-11-16').probEnd, '');
  hrSave(g, '두신입', { contractEnd: '2027-11-15' });
  g.gs.adminRoster(ADMIN);
  const sh = g.sheet('근로자 명부');
  const head = sh.rowDisplay(2); // 1줄은 제목, 2줄이 머리글
  let row = null;
  for (let r = 3; r <= sh.getLastRow(); r++) if (sh.rowDisplay(r)[0] === '두신입') row = sh.rowDisplay(r);
  assert.equal(row[head.indexOf('계약 기간')], '2026-11-16 ~ 2027-11-15');
});

/* ───── 경조 휴가 규정 ───── */

test('경조 휴가 규정: [설정] 경조휴가에 적은 경조사를 골라야 하고, 근무하는 날 기준 그 일수까지만 보낼 수 있어요', () => {
  const g = shop();
  const list = plain(g.gs.getStaffList()).leaveRules;
  assert.deepEqual(list.find((x) => x.name === '배우자 출산'), { name: '배우자 출산', days: 20 });
  assert.deepEqual(list.find((x) => x.name === '본인 결혼'), { name: '본인 결혼', days: 5 });
  const send = (extra) => req(g, '김민우', 'off', { offType: '경조', to: 'admin', device: PHONE.김민우, ...extra });
  assert.throws(() => send({ date: '2026-11-23', reason: '결혼' }), /어떤 경조사인지 골라주세요/);
  assert.throws(() => send({ date: '2026-11-23', event: '없는 경조사', reason: '' }), /어떤 경조사인지 골라주세요/);
  // 김민우는 토·일 휴무: 11/23(월)~12/1(화)은 근무일 7일 → 본인 결혼 5일을 넘어요
  assert.throws(() => send({ date: '2026-11-23', dateTo: '2026-12-01', event: '본인 결혼' }), /본인 결혼은 근무하는 날 기준 5일까지예요\. \(신청하려는 근무일 7일\)/);
  // 11/23(월)~11/29(일) = 근무일 5일: 돼요. 사유를 안 적어도 경조사 이름이 사유로 남아요
  send({ date: '2026-11-23', dateTo: '2026-11-29', event: '본인 결혼' });
  const rows = reqRows(g).filter((x) => x[3] === '경조');
  assert.equal(rows.length, 5);
  assert.equal(rows[0][6], '본인 결혼');
  // 사장님 카드에 규정이 보여요
  assert.match(card(g, rows[0][0]).note || '', /규정: 본인 결혼 5일/);
  // 규정을 비우면 고르지 않아도 돼요(일수 제한 없음)
  g.gs.setSetting_('경조휴가', '');
  g.gs.MEMO_ = {};
  assert.deepEqual(plain(g.gs.getStaffList()).leaveRules, []);
  req(g, '정하나', 'off', { offType: '경조', date: '2026-11-24', reason: '친척 결혼', to: 'admin', device: PHONE.정하나 });
  assert.ok(idOf(g, '경조', '2026-11-24'));
});

/* ───── 출근 전 알림: 앱 시작 전에도, 못 보냈으면 다시 ───── */

test('출근 전 알림: 앱시작일이 비어 있어도(시작 전) 텔레그램을 켠 직원에게는 가요. 미출근 알림·결근?은 여전히 안 해요', () => {
  const g = shop();
  tgOn(g, ['김민우']);
  g.gs.setSetting_('앱시작일', '');
  g.setKst('2026-11-16 09:41'); // 김민우 10:00 출근, 출근전알림 20분
  g.gs.MEMO_ = {};
  g.gs.checkMissing();
  assert.ok(texts(g, '김민우').some((t) => /곧 출근이에요/.test(t)), '시작 전에도 출근 전 알림');
  // 한 번만
  g.setKst('2026-11-16 09:51');
  g.gs.MEMO_ = {};
  g.gs.checkMissing();
  assert.equal(texts(g, '김민우').filter((t) => /곧 출근이에요/.test(t)).length, 1);
  // 출근 시간이 지나도 시작 전이라 미출근 알림은 안 가요(본인·사장님 모두)
  g.setKst('2026-11-16 10:21');
  g.gs.MEMO_ = {};
  g.gs.checkMissing();
  assert.ok(!texts(g, '김민우').some((t) => /아직 출근을 안 찍었어요/.test(t)));
  assert.ok(!texts(g, '사장님').some((t) => /아직 출근 안 찍은 직원/.test(t)));
});

test('출근 전 알림: 텔레그램이 막혀서 못 보냈으면 다음 10분 실행에 다시 보내요(출근 시간 전까지)', () => {
  const g = shop();
  tgOn(g, ['김민우']);
  g.setKst('2026-11-16 09:41');
  g.tg.rate = 1; // 이번 한 번은 텔레그램이 '잠깐 기다려'
  g.gs.MEMO_ = {};
  g.gs.checkMissing();
  assert.ok(!texts(g, '김민우').some((t) => /곧 출근이에요/.test(t)), '이번에는 못 갔어요');
  g.setKst('2026-11-16 09:51');
  g.gs.MEMO_ = {};
  g.gs.checkMissing();
  assert.ok(texts(g, '김민우').some((t) => /곧 출근이에요/.test(t)), '다음 실행에 다시 보내요');
});

test('출근 전 알림: 약 20분 전(15~25분 전)에 가요. 10분마다 돌아서 출근 25분 전 확인에서도 보내요(일찍 와서 찍는 사람도 받게)', () => {
  const g = shop();
  tgOn(g, ['김민우']);
  g.setKst('2026-11-16 09:34'); // 26분 전: 아직
  g.gs.MEMO_ = {};
  g.gs.checkMissing();
  assert.ok(!texts(g, '김민우').some((t) => /곧 출근이에요/.test(t)));
  g.setKst('2026-11-16 09:36'); // 24분 전: 보내요(예전에는 20분 전부터라 9:46 확인까지 기다렸어요)
  g.gs.MEMO_ = {};
  g.gs.checkMissing();
  assert.ok(texts(g, '김민우').some((t) => /곧 출근이에요/.test(t)));
  // 직원 화면: 오늘 출근 전 알림을 언제 보냈는지
  g.gs.MEMO_ = {};
  assert.deepEqual(plain(g.gs.getHome('김민우', PINS.김민우)).pre, { sent: '09:36' });
});

test('출근 전 알림 안내(직원 화면): 언제 오는지 / 근무 없음 / 알림 전에 출근을 찍음. [시험 알림 받기]는 바로 보내요', () => {
  const g = shop();
  tgOn(g, ['김민우', '정하나']);
  g.setKst('2026-11-16 08:00');
  g.gs.MEMO_ = {};
  assert.deepEqual(plain(g.gs.getHome('김민우', PINS.김민우)).pre, { from: '09:35', start: '10:00' });
  // 알림 전에 출근을 찍었으면
  g.setKst('2026-11-16 09:20');
  punch(g, '정하나', 'in');
  g.gs.MEMO_ = {};
  assert.deepEqual(plain(g.gs.getHome('정하나', PINS.정하나)).pre, { early: true });
  // 쉬는 날(김민우 토요일)
  g.setKst('2026-11-21 08:00');
  g.gs.MEMO_ = {};
  assert.deepEqual(plain(g.gs.getHome('김민우', PINS.김민우)).pre, { none: true });
  // 텔레그램을 안 켠 직원은 안내 없음
  assert.equal(plain(g.gs.getHome('최유나', PINS.최유나)).pre, null);
  // 시험 알림: 바로 보내요(시간·근무와 상관없이)
  const n = texts(g, '김민우').length;
  assert.equal(plain(g.gs.staffTgTest('김민우', PINS.김민우, PHONE.김민우)).ok, true);
  assert.equal(texts(g, '김민우').length, n + 1);
  assert.match(texts(g, '김민우').at(-1), /시험 알림/);
  assert.throws(() => g.gs.staffTgTest('최유나', PINS.최유나), /먼저 \[텔레그램 알림 켜기\]/);
  g.tg.rate = 1;
  assert.throws(() => g.gs.staffTgTest('김민우', PINS.김민우, PHONE.김민우), /텔레그램 서버가 이 봇을 잠깐 막았어요/);
});

/* ───── 처음 등록: 기존 직원/신규 입사 구분, 계좌가 없으면 현금 + 기한 ───── */

const joinF = (over = {}) => ({
  name: '한신입', rrn: '991231-1234567', phone: '01012345678', addr: '서울 성동구', bank: '국민', account: '123456-78-901234', holder: '',
  emergency: '010-9999-8888 어머니', store: '가산', start: '2026-11-16', pin: '4826', device: 'f1f1f1f1f1f1f1f1', label: 'Galaxy 크롬', agree: true, agreeLoc: true,
  ...over,
});

test('입사 등록: 계좌가 없으면 현금 + 언제까지(꼭), 기존 직원은 따로 표시되고 수습 끝을 안 채워요. 현금이어도 출근은 찍혀요', () => {
  const g = shop();
  const cash = { bank: '', account: '', cash: true };
  assert.throws(() => g.gs.joinSubmit(joinF({ ...cash, cashUntil: '' })), /현금으로 받을 기한/);
  assert.throws(() => g.gs.joinSubmit(joinF({ ...cash, cashUntil: '2026-11-01' })), /오늘이나 앞날/);
  assert.throws(() => g.gs.joinSubmit(joinF({ ...cash, cashUntil: '2028-01-01' })), /1년 안/);
  g.gs.joinSubmit(joinF({ ...cash, cashUntil: '2026-12-10', kind: 'old', start: '2024-03-02' }));
  const j = plain(g.gs.adminToday(ADMIN)).joins.find((x) => x.name === '한신입');
  assert.equal(j.old, true, '기존 직원 표시');
  assert.equal(j.cash, '2026-12-10');
  g.gs.adminJoin(ADMIN, '한신입', true);
  g.gs.MEMO_ = {};
  const h = g.gs.hrFind_('한신입');
  assert.equal(h.bank, '현금');
  assert.equal(h.account, '');
  assert.equal(h.cashUntil, '2026-12-10');
  assert.equal(h.probEnd, '', '기존 직원은 수습 끝을 안 채워요');
  assert.equal(g.gs.hrStatus_(g.gs.findStaff_('한신입')).state, 'ok', '현금이면 계좌 없이도 출근이 찍혀요');
  const c = plain(g.gs.adminHrGet(ADMIN, '한신입'));
  assert.equal(c.cash, true);
  assert.equal(c.cashUntil, '2026-12-10');
  // 사장님 [오늘]: 30일 안에 끝나는 현금 기한
  assert.ok(plain(g.gs.adminToday(ADMIN)).hrDue.some((x) => x.name === '한신입' && x.kind === '현금' && x.label === '현금 지급 기한' && x.left === 24));
  // 밤 마감 정리: 7일 전
  assert.match(plain(g.gs.dailyClose_(g.gs.settings_(), '2026-12-03', { dry: true })).text, /\[가산\] 한신입 현금 지급 기한 12\/10\(목\) · 7일 남음/);
  // 신규 입사(기본)는 수습 끝을 채워요
  g.gs.joinSubmit(joinF({ name: '두신입', device: 'f2f2f2f2f2f2f2f2', rrn: '000101-3234567' }));
  assert.equal(plain(g.gs.adminToday(ADMIN)).joins.find((x) => x.name === '두신입').old, false);
  g.gs.adminJoin(ADMIN, '두신입', true);
  g.gs.MEMO_ = {};
  assert.equal(g.gs.hrFind_('두신입').probEnd, '2027-02-15');
});

test('계좌 없음(현금): 내 인사 정보·사장님 인사 카드에서도 고르고 기한을 적어요. 계좌로 바꾸면 기한은 지워요', () => {
  const g = shop();
  const f = {
    rrn: '', phone: '010-2222-3333', addr: '서울 성동구 왕십리로 1', bank: '', account: '', emergency: '010-9999-8888 어머니',
    agree: true, device: PHONE.김민우, label: 'iPhone 사파리',
  };
  assert.throws(() => g.gs.hrSave('김민우', PINS.김민우, { ...f, cash: true }), /현금으로 받을 기한/);
  g.gs.hrSave('김민우', PINS.김민우, { ...f, cash: true, cashUntil: '2026-12-31' });
  g.gs.MEMO_ = {};
  let h = g.gs.hrFind_('김민우');
  assert.deepEqual([h.bank, h.account, h.cashUntil], ['현금', '', '2026-12-31']);
  const me = plain(g.gs.hrGet('김민우', PINS.김민우, PHONE.김민우, 'iPhone 사파리'));
  assert.equal(me.cash, true);
  assert.equal(me.cashUntil, '2026-12-31');
  assert.equal(me.bank, '', '은행 칸에 "현금"을 보여주지 않아요');
  // 사장님께 계좌 바뀜 알림(현금으로)
  assert.ok(g.mails.concat(g.tg.sent).some((m) => /현금\(12\/31까지\)/.test(m.body || m.text || '')));
  // 사장님 인사 카드: 계좌로 바꾸면 기한은 지워요
  const cur = plain(g.gs.adminHrGet(ADMIN, '김민우'));
  delete cur.docs; delete cur.offb;
  let c = plain(g.gs.adminHrSave(ADMIN, '김민우', { ...cur, cash: false, bank: '신한', account: '110-123-456789' }));
  assert.deepEqual([c.cash, c.cashUntil, c.bank], [false, '', '신한']);
  c = plain(g.gs.adminHrSave(ADMIN, '김민우', { ...c, docs: undefined, offb: undefined, cash: true, cashUntil: '2027-01-15' }));
  assert.deepEqual([c.cash, c.cashUntil, c.account], [true, '2027-01-15', '']);
  // 시트에서 은행 칸에 '현금'만 적어도(기한 없이) 출근은 막지 않아요
  g.gs.hrWrite_(g.gs.hrFind_('정하나').row, { bank: '현금', account: '' });
  g.gs.MEMO_ = {};
  assert.equal(g.gs.hrStatus_(g.gs.findStaff_('정하나')).state, 'ok');
});
