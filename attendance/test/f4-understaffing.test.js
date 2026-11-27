// 매장이 비는 날 미리 알리기([매장] 최소인원): 인원 세기, 밤 마감 정리(내일), 승인 카드, 직원 대타 목록, 못 구한 대타 알림
// 실행: node --test attendance/test/f4-understaffing.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./gas-mock');

// 스크립트 안에서 만든 배열·객체를 평범한 값으로 바꿔서 비교해요
const plain = (x) => JSON.parse(JSON.stringify(x));
const ADMIN = '582941';
const MGR = { name: '박점장', pin: '246813' };
const TOKEN = '123456789:' + 'A'.repeat(35);
const ROW = { 김민우: 2, 박점장: 3, 정하나: 4, 이지은: 5, 최유나: 6, 한사무: 7 };
const PIN = { 김민우: '0123', 박점장: '246813', 정하나: '4826', 이지은: '5678', 최유나: '1357', 한사무: '7351' };

// 인사 정보를 다 넣은 상태로(입사일 2020-01-01). code.test.js 의 hrFill 과 같아요
let hrSeq = 0;
function hrFill(g, names) {
  const list = names || g.gs.staff_().filter((p) => p.active).map((p) => p.name);
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

// 2026-11-24(화) 15:00. 11/25 수 · 11/26 목 · 11/27 금 · 11/28 토
// 왕십리(10:00-20:00, 점장 박점장, 최소인원 2): 김민우(토·일 휴무), 박점장, 정하나
// 가산(12:00-21:00, 최소인원 비움): 이지은(수·일 휴무), 최유나
// 사무실(시간 없음, 최소인원 비움): 한사무(월~금 09:00-18:00, 토·일 휴무) · 박퇴사: 퇴사
function world({ min = { 왕십리: '2' }, now = '2026-11-24T15:00:00+09:00' } = {}) {
  const g = createGas({ now: Date.parse(now) });
  g.gs.setup();
  const st = g.sheet('매장');
  st.getRange(2, 1, 3, 7).setValues([
    ['왕십리', '10:00', '20:00', '', '', '', ''],
    ['가산', '12:00', '21:00', '', '', '', ''],
    ['사무실', '', '', '', '', '', ''],
  ]);
  const head = st.rowDisplay(1);
  st.getRange(2, head.indexOf('점장') + 1).setValue('박점장');
  ['왕십리', '가산', '사무실'].forEach((n, i) => st.getRange(2 + i, head.indexOf('최소인원') + 1).setValue(min[n] == null ? '' : min[n]));
  const W = (t) => [t, t, t, t, t];
  //  이름 매장 PIN 시급 월 화 수 목 금 토 일 재직 등록폰 새폰요청
  g.sheet('직원').getRange(2, 1, 7, 14).setValues([
    ['김민우', '왕십리', PIN.김민우, 12000, '', '', '', '', '', '휴무', '휴무', '', '', ''],
    ['박점장', '왕십리', PIN.박점장, 12000, '', '', '', '', '', '', '', '', '', ''],
    ['정하나', '왕십리', PIN.정하나, 10320, '', '', '', '', '', '', '', '', '', ''],
    ['이지은', '가산', PIN.이지은, 10320, '', '', '휴무', '', '', '', '휴무', '', '', ''],
    ['최유나', '가산', PIN.최유나, 10320, '', '', '', '', '', '', '', '', '', ''],
    ['한사무', '사무실', PIN.한사무, 10320, ...W('09:00-18:00'), '휴무', '휴무', '', '', ''],
    ['박퇴사', '왕십리', '9999', 10320, '', '', '', '', '', '', '', 'X', '', ''],
  ]);
  g.gs.setSetting_('관리자PIN', ADMIN);
  g.gs.setSetting_('앱시작일', '2026-01-01');
  g.gs.setSetting_('위치확인', '안함');
  g.gs.setup(); // 새 직원 줄을 휴무표에
  hrFill(g);
  return g;
}
const reset = (g) => { g.gs.MEMO_ = {}; g.gs.GRID_ = {}; };
// 휴무표 그날 칸
const put = (g, name, date, v) => { reset(g); g.gs.setMark_(date, name, () => v); reset(g); };
const mark = (g, name, date) => { reset(g); return g.gs.dayMark_(name, date); };
// 그날 그 매장 인원
const on = (g, store, date, opts) => { reset(g); return plain(g.gs.staffOn_(store, date, opts)); };
const req = (g, name, kind, extra = {}) => g.gs.makeRequest({ name, pin: PIN[name], kind, ...extra });
const changeRows = (g) => {
  const sh = g.sheet('근무변경');
  const out = [];
  for (let r = 2; r <= sh.getLastRow(); r++) out.push(sh.rowDisplay(r).slice(0, 4));
  return out;
};
// 텔레그램: 사장님 채팅 555, 직원 채팅은 chats = {이름: 번호}
const tgOn = (g, chats = {}) => {
  g.gs.setSetting_('텔레그램토큰', TOKEN);
  g.gs.setSetting_('텔레그램채팅ID', '555');
  g.gs.setSetting_('텔레그램봇', 'goodphone_test_bot');
  for (const [n, id] of Object.entries(chats)) g.gs.setStaffCell_(ROW[n], '텔레그램', id);
};
const sentTo = (g, chat) => g.tg.sent.filter((m) => String(m.chat_id) === String(chat)).map((m) => m.text);
const nobody = (g, chat) => sentTo(g, chat).filter((x) => /대타를 아직/.test(x));

test('[매장] 최소인원 칸: setup이 만들고 예전 탭은 오른쪽 끝에 붙여요. 비우면 null, "2명"·0도 읽어요', () => {
  const g = createGas({ now: Date.parse('2026-11-24T09:00:00+09:00') });
  const st = g.book.insertSheet('매장');
  st.getRange(1, 1, 2, 10).setValues([
    ['매장', '출근', '퇴근', '위도', '경도', '반경(m)', '메모', '점장', '최대휴무', '월휴무'],
    ['본점', '11:00', '', '', '', '', '', '', '1', ''],
  ]);
  g.gs.setup();
  assert.equal(st.rowDisplay(1)[10], '최소인원', '다른 늘어난 칸처럼 오른쪽 끝에');
  assert.match(st.notes['1,11'], /비우면 아무도 없을 때만 알려요. 0이면 알리지 않아요/);
  g.gs.MEMO_ = {};
  assert.equal(g.gs.stores_()[0].minStaff, null, '비우면 null(아무도 없을 때만 알림)');
  st.getRange(2, 11).setValue('2명');
  g.gs.MEMO_ = {};
  assert.equal(g.gs.stores_()[0].minStaff, 2);
  st.getRange(2, 11).setValue('0');
  g.gs.MEMO_ = {};
  assert.equal(g.gs.stores_()[0].minStaff, 0, '0 = 알리지 않음');
  g.gs.setup();
  assert.equal(st.rowDisplay(1).filter((h) => h === '최소인원').length, 1, '다시 실행해도 한 칸');
  assert.equal(st.rowDisplay(2)[10], '0', '적어 둔 값은 그대로');

  // 새로 만든 시트: 처음부터 칸이 있고, 사장님 화면 [설정] 매장 목록에도 보여요
  const w = world();
  assert.deepEqual(plain(w.gs.adminToday(ADMIN).info.stores.map((s) => [s.name, s.minStaff])), [['왕십리', 2], ['가산', null], ['사무실', null]]);
});

test('인원 세기: 일하는 사람 + 지원 오는 사람 − 지원 가는 사람. 쉬는 말·반차·외근·휴직·입사 전·퇴사·테스트 직원은 빼요', () => {
  const g = world();
  let c = on(g, '왕십리', '2026-11-25');
  assert.equal(c.count, 3);
  assert.deepEqual(c.work, ['김민우', '박점장', '정하나'], '퇴사한 박퇴사는 안 세요');
  assert.equal(c.need, 2);
  assert.equal(c.below, false);
  c = on(g, '가산', '2026-11-25');
  assert.equal(c.count, 1);
  assert.deepEqual(c.off, [{ name: '이지은', why: '휴무', plain: true }], '[직원] 수요일 칸이 휴무(정기 휴무)');
  assert.equal(c.need, 1, '최소인원을 비우면 1명(아무도 없을 때만 모자람)');
  assert.equal(c.min, null);

  put(g, '김민우', '2026-11-25', '월차');
  put(g, '정하나', '2026-11-25', '가산'); // 가산으로 지원
  c = on(g, '왕십리', '2026-11-25');
  assert.equal(c.count, 1);
  assert.equal(c.below, true);
  assert.deepEqual(c.off, [{ name: '김민우', why: '월차', plain: false }, { name: '정하나', why: '가산 지원', plain: false }]);
  c = on(g, '가산', '2026-11-25');
  assert.deepEqual(c.work, ['정하나', '최유나'], '지원 온 사람도 세요');

  put(g, '박점장', '2026-11-25', '반차');
  c = on(g, '왕십리', '2026-11-25');
  assert.equal(c.count, 0, '반차도 쉬는 말이라 안 세요');
  assert.equal(c.closed, false, '휴무표로 쉬는 사람이 있으면 쉬는 날(문 닫는 날)로 안 봐요');

  put(g, '최유나', '2026-11-25', '외근');
  assert.deepEqual(on(g, '가산', '2026-11-25').work, ['정하나'], '외근·교육 날은 매장 밖');
  put(g, '최유나', '2026-11-25', '대체');
  assert.deepEqual(on(g, '가산', '2026-11-25').off.find((x) => x.name === '최유나'), { name: '최유나', why: '대체휴무', plain: false });
  put(g, '최유나', '2026-11-25', '대타 왕십리');
  assert.deepEqual(on(g, '왕십리', '2026-11-25').work, ['최유나'], "'대타 왕십리'는 왕십리에서 일해요");

  // 휴직
  g.gs.hrPlanSave_((o) => { o.away['한사무'] = { from: '2026-11-25', to: '2026-11-30' }; });
  c = on(g, '사무실', '2026-11-25');
  assert.equal(c.count, 0);
  assert.deepEqual(c.off, [{ name: '한사무', why: '휴직', plain: false }]);

  // 입사 전, 테스트 직원
  reset(g);
  g.gs.hrWrite_(g.gs.hrFind_('정하나').row, { start: '2026-11-27' });
  g.gs.adminTestStaff(ADMIN, '왕십리');
  c = on(g, '왕십리', '2026-11-26');
  assert.deepEqual(c.work, ['김민우', '박점장'], '입사 전(정하나)·테스트 직원은 안 세요');
  assert.equal(c.off.length, 0, '그날 다니지 않는 사람은 쉬는 사람 목록에도 없어요');

  // except: 승인하면 몇 명이 남는지
  c = on(g, '왕십리', '2026-11-26', { except: '박점장', why: '휴무' });
  assert.equal(c.count, 1);
  assert.deepEqual(c.off, [{ name: '박점장', why: '휴무' }]);
});

test('쉬는 날로 보이는 매장: 모두 정기 휴무(사무실 주말)이거나 공휴일에 아무도 없으면 closed', () => {
  const g = world();
  assert.equal(on(g, '사무실', '2026-11-28').closed, true, '토요일: 한사무는 요일 칸이 휴무');
  put(g, '한사무', '2026-11-27', '휴무');
  const c = on(g, '사무실', '2026-11-27');
  assert.equal(c.count, 0);
  assert.equal(c.closed, false, '평일에 휴무표로 쉬면 매장이 비는 날');
  put(g, '이지은', '2026-12-25', '휴무');
  put(g, '최유나', '2026-12-25', '휴무');
  assert.equal(on(g, '가산', '2026-12-25').closed, true, '성탄절에 아무도 없으면 문 닫는 날로 봐요');
  put(g, '이지은', '2026-12-24', '휴무');
  put(g, '최유나', '2026-12-24', '휴무');
  assert.equal(on(g, '가산', '2026-12-24').closed, false);
});

test('밤 마감 정리: 내일 최소인원보다 적은 매장을 쉬는 사람과 함께 알려요(비우면 아무도 없을 때만, 0이면 안 알려요)', () => {
  const g = world({ min: { 왕십리: '2', 사무실: '0' } });
  tgOn(g);
  put(g, '김민우', '2026-11-25', '휴무');
  put(g, '정하나', '2026-11-25', '월차');
  put(g, '최유나', '2026-11-25', '병가'); // 가산: 이지은(수 정기 휴무)·최유나 → 아무도 없어요
  put(g, '한사무', '2026-11-25', '휴무'); // 사무실은 최소인원 0 → 안 알려요
  g.setKst('2026-11-24 23:35');
  g.gs.checkMissing();
  const sum = sentTo(g, 555).find((x) => /하루 마감 정리/.test(x));
  assert.ok(sum);
  assert.match(sum, /11\/25\(수\) 사람이 모자란 매장 2곳 → 휴무를 다시 보거나 지원·대타를 정해 주세요\n내일 왕십리 1명 근무\(최소 2명\) · 김민우 휴무, 정하나 월차\n내일 가산 0명 근무 · 이지은 휴무, 최유나 병가/);
  assert.doesNotMatch(sum, /내일 사무실/, '최소인원 0은 안 알려요');
});

test('밤 마감 정리: 인원이 되면 아무 말 없고, 쉬는 날(사무실 주말·공휴일)은 빼요. 미리 보기·새벽 정리도 같아요', () => {
  const g = world();
  // 11/27(금)에 보는 11/28(토): 왕십리 박점장·정하나 2명, 사무실은 주말이라 쉬는 날
  g.setKst('2026-11-27 22:00');
  let r = g.gs.adminClosePreview(ADMIN, 'today', false);
  assert.doesNotMatch(r.text, /사람이 모자란 매장/);
  // 내일 최소인원보다 적으면 미리 보기에도 나와요(아무것도 안 바꿔요)
  put(g, '정하나', '2026-11-28', '휴무');
  r = g.gs.adminClosePreview(ADMIN, 'today', false);
  assert.match(r.text, /내일 왕십리 1명 근무\(최소 2명\) · 김민우 휴무, 정하나 휴무/);
  assert.equal(mark(g, '정하나', '2026-11-28'), '휴무');
  // 공휴일(성탄절)에 가산이 아무도 없으면 문 닫는 날로 보고 빼요
  put(g, '이지은', '2026-12-25', '휴무');
  put(g, '최유나', '2026-12-25', '휴무');
  g.setKst('2026-12-24 22:00');
  assert.doesNotMatch(g.gs.adminClosePreview(ADMIN, 'today', false).text, /가산 0명/);
  // 밤에 못 돌아서 새벽에 어제 것을 정리하면 '내일'은 오늘이라서 '오늘'로 말해요
  tgOn(g);
  put(g, '정하나', '2026-11-26', '월차');
  put(g, '김민우', '2026-11-26', '휴무');
  g.setKst('2026-11-26 02:00');
  g.gs.checkMissing();
  const sum = sentTo(g, 555).find((x) => /하루 마감 정리/.test(x));
  assert.match(sum, /11\/26\(목\) 사람이 모자란 매장 1곳[^\n]*\n오늘 왕십리 1명 근무\(최소 2명\) · 김민우 휴무, 정하나 월차/);
});

test('승인 카드: 승인하면 그날 그 매장 인원(최소인원보다 적으면 below), 점장은 자기 매장만, 지난 날·정정은 없어요', () => {
  const g = world();
  put(g, '김민우', '2026-11-26', '휴무'); // 11/26(목) 왕십리: 박점장·정하나
  req(g, '정하나', 'off', { date: '2026-11-26', reason: '병원', offType: '월차' });
  let t = g.gs.adminToday(ADMIN).requests[0];
  assert.deepEqual(plain(t.thin), {
    store: '왕십리', count: 1, need: 2, min: 2, below: true, line: '왕십리 1명 근무(최소 2명)', more: 0,
    text: '승인하면 그날 왕십리 1명 근무(최소 2명)',
  });
  assert.equal(g.gs.adminToday(MGR).requests[0].thin.text, '승인하면 그날 왕십리 1명 근무(최소 2명)', '점장 화면에도(자기 매장)');
  // 같은 날 다른 쉬는 요청이 기다리면 알려줘요
  req(g, '박점장', 'off', { date: '2026-11-26', reason: '개인', offType: '휴무' });
  t = g.gs.adminToday(ADMIN).requests;
  assert.equal(t[0].thin.text, '승인하면 그날 왕십리 1명 근무(최소 2명) · 같은 날 쉬겠다는 요청 1건 더 있어요');
  assert.equal(t[1].thin.count, 1);
  // 반차는 쉬는 걸로 셌다고 알려요
  req(g, '김민우', 'off', { date: '2026-11-27', reason: '오후 병원', offType: '반차' });
  const half = g.gs.adminToday(ADMIN).requests.find((x) => x.kind === '반차');
  assert.equal(half.thin.text, '승인하면 그날 왕십리 2명 근무(최소 2명) · 반차는 빼고 셌어요');
  assert.equal(half.thin.below, false);
  // 가산(최소인원 비움): 아무도 없을 때만 빨갛게
  req(g, '최유나', 'off', { date: '2026-11-25', reason: '집안일', offType: '휴가' });
  const gs = g.gs.adminToday(ADMIN).requests.find((x) => x.name === '최유나');
  assert.equal(gs.thin.text, '승인하면 그날 가산 0명 근무');
  assert.equal(gs.thin.below, true);
  assert.equal(g.gs.adminToday(MGR).requests.some((x) => x.name === '최유나'), false, '점장은 다른 매장 요청을 못 봐요');
  // 지난 날짜(결근을 무급으로)·정정 요청에는 없어요
  put(g, '이지은', '2026-11-23', '결근?');
  req(g, '이지은', 'off', { date: '2026-11-23', reason: '아팠어요', offType: '무급' });
  req(g, '이지은', 'fix', { date: '2026-11-24', type: 'in', time: '12:00', reason: '깜빡' });
  const lee = g.gs.adminToday(ADMIN).requests.filter((x) => x.name === '이지은');
  assert.equal(lee.length, 2);
  assert.ok(lee.every((x) => x.thin == null));
});

test('승인 카드: 휴무 바꾸기·여러 날 휴가도 날마다 세요', () => {
  const g = world();
  put(g, '김민우', '2026-11-26', '휴무');
  put(g, '정하나', '2026-11-28', '휴무'); // 원래 쉬는 날(토)
  req(g, '정하나', 'move', { dateFrom: '2026-11-28', date: '2026-11-26', reason: '가족 모임' });
  let mv = g.gs.adminToday(ADMIN).requests.find((x) => x.kind === '바꾸기');
  assert.equal(mv.thin.text, '승인하면 그날 왕십리 1명 근무(최소 2명)');
  assert.equal(mv.thin.below, true);
  g.gs.cancelRequest('정하나', PIN.정하나, mv.id);
  // 11/26~11/27 휴가(근무하는 날마다 한 줄): 11/26은 1명(모자람), 11/27은 2명
  req(g, '정하나', 'off', { date: '2026-11-26', dateTo: '2026-11-27', reason: '여행', offType: '휴가' });
  const days = g.gs.adminToday(ADMIN).requests.filter((x) => x.kind === '휴가');
  assert.deepEqual(plain(days.map((x) => [x.date, x.thin.line, x.thin.below])), [
    ['2026-11-26', '왕십리 1명 근무(최소 2명)', true],
    ['2026-11-27', '왕십리 2명 근무(최소 2명)', false],
  ]);
});

test('직원 화면 대타 목록: 요청한 사람의 매장이 보이고, 다른 매장 사람이 그날 자기 매장 근무가 있으면 clash', () => {
  const g = world();
  req(g, '이지은', 'swap', { date: '2026-11-26' }); // 가산 12:00-21:00
  const seen = g.gs.getRequests('정하나', PIN.정하나).swaps[0];
  assert.equal(seen.store, '가산');
  assert.deepEqual(plain(seen.clash), { store: '왕십리', hours: '10:00-20:00' });
  assert.equal(seen.reason, '', '동료에게는 사유를 안 보여줘요(그대로)');
  assert.equal(g.gs.getRequests('최유나', PIN.최유나).swaps[0].clash, undefined, '같은 매장은 예전처럼 시간을 합쳐서 안 물어봐요');
  put(g, '김민우', '2026-11-26', '휴무');
  assert.equal(g.gs.getRequests('김민우', PIN.김민우).swaps[0].clash, undefined, '그날 쉬는 사람은 빠질 근무가 없어요');
  put(g, '박점장', '2026-11-26', '가산');
  assert.equal(g.gs.getRequests('박점장', PIN.박점장).swaps[0].clash, undefined, '그날 이미 가산에 지원 가는 사람');
  // 첫 화면(getHome)도 같은 목록을 줘요
  assert.equal(g.gs.getHome('정하나', PIN.정하나).requests.swaps[0].clash.store, '왕십리');
});

test('다른 매장 대타 승인: 자기 매장 근무는 빠지고 요청한 시간만, 휴무표에 "대타 가산", 두 매장 인원·지원 근무도 맞게', () => {
  const g = world({ min: { 왕십리: '2', 가산: '2' } });
  tgOn(g, { 정하나: '9004' });
  const a = req(g, '이지은', 'swap', { date: '2026-11-26' });
  const id = a.mine[0].id;
  g.gs.takeSwap('정하나', PIN.정하나, id);
  assert.match(sentTo(g, 555).at(-1), /정하나 님은 그날 원래 왕십리 10:00-20:00 근무예요\. 승인하면 왕십리 근무는 빠지고 가산에서 일해요\./);
  put(g, '김민우', '2026-11-26', '휴무');
  const card = g.gs.adminToday(ADMIN).requests[0];
  assert.match(card.note, /왕십리 근무는 빠지고 가산에서 일해요/);
  assert.equal(card.thin.text, '승인하면 그날 왕십리 1명 근무(최소 2명)', '대타가 빠지는 왕십리 인원');
  assert.equal(card.thin.below, true);
  g.gs.adminRequest(ADMIN, id, true);
  assert.equal(mark(g, '이지은', '2026-11-26'), '휴무');
  assert.equal(mark(g, '정하나', '2026-11-26'), '대타 가산');
  assert.deepEqual(plain(changeRows(g)), [
    ['2026-11-26', '정하나', '12:00-21:00', '이지은 님 대신 대타 (가산 근무, 원래 왕십리 10:00-20:00 근무는 빠짐)'],
  ]);
  assert.match(sentTo(g, 9004).at(-1), /대타가 승인됐어요/);
  g.setKst('2026-11-26 09:00');
  assert.equal(g.gs.getToday('정하나').sIn, '12:00', '가산 시간만(합치지 않아요)');
  assert.deepEqual(on(g, '가산', '2026-11-26').work, ['정하나', '최유나']);
  assert.deepEqual(on(g, '왕십리', '2026-11-26').work, ['박점장']);
  const sup = g.gs.adminSupport(ADMIN, '2026-11');
  assert.deepEqual(plain(sup.people.map((p) => [p.name, p.total, p.by[0].to])), [['정하나', 1, '가산']], '지원 근무 집계에도 들어가요');
});

test('같은 매장 대타는 예전처럼 두 시간을 합치고 휴무표에 "대타"(카드에 인원 줄 없음)', () => {
  const g = world();
  g.gs.addChange_('2026-11-26', '김민우', '13:00-21:00', '늦게 출근');
  const a = req(g, '정하나', 'swap', { date: '2026-11-26', to: 'admin' }); // 왕십리 10:00-20:00
  g.gs.takeSwap('김민우', PIN.김민우, a.mine[0].id);
  const card = g.gs.adminToday(ADMIN).requests[0];
  assert.match(card.note, /두 시간을 합쳐요/);
  assert.equal(card.thin, null, '같은 매장 대타는 인원이 그대로예요');
  g.gs.adminRequest(ADMIN, a.mine[0].id, true);
  assert.equal(mark(g, '김민우', '2026-11-26'), '대타');
  assert.deepEqual(plain(changeRows(g).at(-1)), ['2026-11-26', '김민우', '10:00-21:00', '정하나 님 대신 대타 (원래 13:00-21:00 근무와 합침)']);
});

test('못 구한 대타: 전날 18시부터 한 번, 요청한 사람·그 매장 점장·사장님께', () => {
  const g = world();
  tgOn(g, { 정하나: '9004', 박점장: '9005', 김민우: '9002' });
  g.setKst('2026-11-24 10:00');
  req(g, '정하나', 'swap', { date: '2026-11-26' }); // 11/26(목) 왕십리 10:00-20:00
  assert.match(sentTo(g, 9002).at(-1), /동료가 대타를 구해요/);
  g.setKst('2026-11-25 17:50');
  g.gs.checkMissing();
  assert.equal(nobody(g, 555).length, 0, '18시 전에는 안 보내요');
  g.setKst('2026-11-25 18:00');
  g.gs.checkMissing();
  assert.equal(nobody(g, 555).length, 1);
  assert.match(nobody(g, 555)[0], /대타를 아직 못 구했어요[\s\S]*내일\(11\/26\) 정하나 대타를 아직 아무도 안 받았어요\n {2}왕십리 10:00-20:00 근무예요\./);
  assert.match(nobody(g, 9004)[0], /대타를 아직 못 구했어요\n내일\(11\/26\) 10:00-20:00 대타를 아직 아무도 안 받았어요\.\n못 구하면 그날은 원래대로 출근해야 해요/);
  assert.match(nobody(g, 9005)[0], /\[왕십리\] 대타를 아직 못 구했어요\n내일\(11\/26\) 정하나 대타를 아직 아무도 안 받았어요\n왕십리 10:00-20:00 근무예요\. 대신 일할 사람을 같이 찾아 주세요/);
  assert.equal(nobody(g, 9002).length, 0, '다른 동료에게는 안 보내요(구할 때 이미 알렸어요)');
  for (const at of ['2026-11-25 18:10', '2026-11-25 21:00', '2026-11-26 08:00']) {
    g.setKst(at);
    g.gs.checkMissing();
  }
  assert.equal(nobody(g, 555).length, 1, '한 번만');
  assert.equal(nobody(g, 9004).length, 1);
});

test('못 구한 대타: 받은 사람이 있으면 안 보내고, 밤에는 아침까지, 방금 올린 건 1시간 뒤, 근무가 시작됐으면 안 보내요', () => {
  const g = world();
  tgOn(g, { 정하나: '9004', 박점장: '9005' });
  // 누가 받았어요
  g.setKst('2026-11-24 10:00');
  const a = req(g, '이지은', 'swap', { date: '2026-11-26' });
  g.gs.takeSwap('최유나', PIN.최유나, a.mine[0].id);
  // 전날 22:30에 올림 → 23시 넘어서는 기다렸다가 아침 7시에 '오늘'로
  g.setKst('2026-11-25 22:30');
  req(g, '정하나', 'swap', { date: '2026-11-26' });
  for (const at of ['2026-11-25 22:40', '2026-11-25 23:40', '2026-11-26 03:00']) {
    g.setKst(at);
    g.gs.checkMissing();
  }
  assert.equal(nobody(g, 555).length, 0, '받은 대타는 안 알리고, 밤에는 안 보내요');
  g.setKst('2026-11-26 07:00');
  g.gs.checkMissing();
  assert.equal(nobody(g, 555).length, 1);
  assert.match(nobody(g, 555)[0], /오늘\(11\/26\) 정하나 대타를 아직 아무도 안 받았어요/);
  assert.doesNotMatch(nobody(g, 555)[0], /이지은/);
  // 방금 올린 요청은 1시간 뒤에
  g.setKst('2026-11-26 18:30');
  req(g, '박점장', 'swap', { date: '2026-11-27' });
  g.setKst('2026-11-26 18:40');
  g.gs.checkMissing();
  assert.equal(nobody(g, 555).length, 1, '올린 지 10분: 동료들이 볼 시간을 줘요');
  g.setKst('2026-11-26 19:30');
  g.gs.checkMissing();
  assert.equal(nobody(g, 555).length, 2);
  assert.match(nobody(g, 555)[1], /내일\(11\/27\) 박점장 대타를/);
  const own = nobody(g, 9005).filter((x) => /11\/27/.test(x));
  assert.equal(own.length, 1, '점장 본인 요청: 본인 알림만(점장으로 또 안 가요)');
  assert.match(own[0], /^\[굳폰\] 대타를 아직 못 구했어요\n내일\(11\/27\) 10:00-20:00 대타를/);
  // 그날 근무가 이미 시작됐으면 안 보내요(못 구하고 안 나오면 밤 마감이 결근?으로 적어요)
  g.setKst('2026-11-27 08:00');
  req(g, '김민우', 'swap', { date: '2026-11-27' }); // 금 10:00-20:00
  g.setKst('2026-11-27 10:10');
  g.gs.checkMissing();
  assert.equal(nobody(g, 555).filter((x) => /김민우/.test(x)).length, 0);
});
