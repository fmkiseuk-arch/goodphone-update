// 실행: node --test attendance/test
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas, Sheet, hooks } = require('./gas-mock');
// 스크립트 안에서 만든 배열·객체를 평범한 값으로 바꿔서 비교해요
const plain = (x) => JSON.parse(JSON.stringify(x));
// 인사 정보를 다 넣은 상태로(출근 전에 인사 정보가 꼭 있어야 해서). names를 안 주면 [직원] 탭의 근무 중인 사람 모두
let hrSeq = 0;
function hrFill(g, names, over = {}) {
  const list = names || g.gs.staff_().filter((p) => p.active).map((p) => p.name);
  for (const n of list) {
    g.gs.MEMO_ = {};
    if (!g.gs.hrFind_(n)) g.gs.syncHr_();
    const h = g.gs.hrFind_(n);
    if (!h) continue;
    hrSeq++;
    const rrn = '8001' + String(10 + (hrSeq % 18)).padStart(2, '0') + '1' + String(100000 + hrSeq).slice(-6);
    g.gs.hrWrite_(h.row, {
      rrn: g.gs.rrnMask_(rrn), enc: g.gs.rrnEncrypt_(rrn), phone: h.phone || '010-1000-' + String(1000 + hrSeq), addr: h.addr || '서울 성동구', bank: h.bank || '국민',
      account: h.account || '123456-78-' + String(900000 + hrSeq), emergency: h.emergency || '010-9999-8888 가족', start: h.start || '2020-01-01', ...over,
    });
  }
  g.gs.MEMO_ = {};
}

const STORE = { lat: 37.5665, lng: 126.978 };
const NEAR = { lat: 37.5668, lng: 126.978, acc: 20 }; // 약 33m
const FAR = { lat: 37.58, lng: 126.978, acc: 20 }; // 약 1.5km

// 2026-11-16 은 월요일
// 매장: 왕십리(10:00-20:00), 가산(12:00-21:00, 위치는 왕십리에서 약 1.5km 북쪽)
// 김민우(왕십리): 주말은 [직원] 요일 칸에 '휴무' / 이지은(가산): 수·일 휴무 / 박퇴사: 재직 X
const GASAN = { lat: 37.58, lng: 126.978 };
function fresh({ grace = '0', mode = '필수', email = '', hr = true } = {}) {
  const g = createGas({ now: Date.parse('2026-11-16T09:00:00+09:00') });
  g.gs.setup();
  g.sheet('매장').getRange(2, 1, 2, 7).setValues([
    ['왕십리', '10:00', '20:00', '', '', '', ''],
    ['가산', '12:00', '21:00', '', '', '', ''],
  ]);
  //            이름      매장      PIN     시급      월  화  수      목  금  토      일      재직 등록폰 새폰요청
  g.sheet('직원').getRange(2, 1, 3, 14).setValues([
    ['김민우', '왕십리', '0123', 12000, '', '', '', '', '', '휴무', '휴무', '', '', ''],
    ['이지은', '가산', '5678', '10,320', '', '', '휴무', '', '', '', '휴무', '', '', ''],
    ['박퇴사', '왕십리', '9999', 10320, '', '', '', '', '', '', '', 'X', '', ''],
  ]);
  const set = (k, v) => g.gs.setSetting_(k, v);
  set('관리자PIN', '582941');
  set('앱시작일', '2026-01-01'); // 이미 쓰고 있는 가게(시작 전 동작은 따로 테스트해요)
  set('지각유예(분)', grace);
  set('위치확인', mode);
  set('알림이메일', email);
  g.gs.adminSetPlace('582941', '왕십리', STORE.lat, STORE.lng);
  if (hr) hrFill(g);
  return g;
}
// 직원마다 자기 폰 번호
const PHONE = { 김민우: 'aaaaaaaaaaaaaaaa', 이지은: 'bbbbbbbbbbbbbbbb', 박퇴사: 'cccccccccccccccc', 예시직원: 'dddddddddddddddd' };
const punch = (g, name, pin, type, pos = NEAR, device = PHONE[name], label = 'iPhone 사파리') =>
  g.gs.punch({ name, pin, type, lat: pos && pos.lat, lng: pos && pos.lng, acc: pos && pos.acc, device, label, agree: true });
const suspects = (g) => {
  const sh = g.sheet('의심기록');
  const out = [];
  for (let r = 2; r <= sh.getLastRow(); r++) out.push(sh.rowDisplay(r).slice(0, 4));
  return out;
};

test('시간·날짜 읽기: 시트가 보여주는 여러 모양을 다 읽어요', () => {
  const { gs } = createGas({ now: 0 });
  assert.equal(gs.parseTime_('10:05'), 605);
  assert.equal(gs.parseTime_('오후 6:30:00'), 18 * 60 + 30);
  assert.equal(gs.parseTime_('오전 12:10:00'), 10);
  assert.equal(gs.parseTime_('오후 12:10:00'), 12 * 60 + 10);
  assert.equal(gs.parseTime_('10시 30분'), 630);
  assert.equal(gs.parseTime_(''), null);
  assert.deepEqual({ ...gs.parseSchedule_('10:00-20:00') }, { start: 600, end: 1200 });
  assert.deepEqual({ ...gs.parseSchedule_('12:00 ~ 21:30') }, { start: 720, end: 1290 });
  assert.deepEqual({ ...gs.parseSchedule_('10-20') }, { start: 600, end: 1200 });
  assert.equal(gs.parseSchedule_('휴무'), null);
  assert.equal(gs.parseSchedule_(''), null);
  assert.equal(gs.parseDate_('2026. 11. 3'), '2026-11-03');
  assert.equal(gs.parseDate_('2026-11-18'), '2026-11-18');
  assert.equal(gs.dowOf_('2026-11-16'), 1);
  assert.equal(gs.prevYm_('2026-01'), '2025-12');
});

test('지각·조퇴·차감 계산: 늦은 분만큼 시급으로 빼요', () => {
  const { gs } = createGas({ now: 0 });
  // 12,000원 시급, 7분 지각 → 1,400원
  assert.deepEqual({ ...gs.calc_('10:00', '20:00', '10:07', '20:00', 12000, 0) }, { late: 7, early: 0, work: 593, deduct: 1400 });
  // 유예 5분: 5분 늦으면 지각 아님, 6분이면 6분 전부 지각
  assert.equal(gs.calc_('10:00', '20:00', '10:05', '', 12000, 5).late, 0);
  assert.equal(gs.calc_('10:00', '20:00', '10:06', '', 12000, 5).late, 6);
  // 조퇴 30분 → 6,000원, 원 단위 버림
  assert.deepEqual({ ...gs.calc_('10:00', '20:00', '09:55', '19:30', 10320, 0) }, { late: 0, early: 30, work: 575, deduct: 5160 });
  assert.equal(gs.calc_('10:00', '20:00', '10:01', '', 10321, 0).deduct, 172); // 172.01 → 172
});

test('처음 설정: 탭들과 10분 알림이 만들어지고, 다시 실행해도 그대로예요', () => {
  const g = fresh();
  for (const n of ['설정', '매장', '직원', '근무변경', '출퇴근기록', '의심기록', '요청', '휴무표 2026-11', '휴무표 2026-12']) assert.ok(g.sheet(n), n);
  assert.equal(g.triggers.length, 1);
  g.gs.setup();
  assert.equal(g.triggers.length, 1);
  assert.equal(g.sheet('직원').rowDisplay(2)[0], '김민우');
  assert.equal(g.sheet('직원').rowDisplay(2)[2], '0123', 'PIN 앞의 0이 사라지면 안 돼요');
  assert.equal(g.book.getSheets().filter((x) => x.getName() === '휴무표 2026-11').length, 1, '다시 실행해도 휴무표는 한 장');
});

test('정시 출근 → 지각 출근 → 중복 출근 막기 → 퇴근', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:58');
  let r = punch(g, '김민우', '0123', 'in');
  assert.equal(r.time, '09:58');
  assert.equal(r.late, 0);

  g.setKst('2026-11-16 12:09');
  r = punch(g, '이지은', '5678', 'in'); // 비밀번호 없는 직원
  assert.equal(r.late, 9);

  g.setKst('2026-11-16 12:30');
  assert.throws(() => punch(g, '김민우', '0123', 'in'), /이미 09:58에 출근/);

  g.setKst('2026-11-16 20:03');
  r = punch(g, '김민우', '0123', 'out');
  assert.equal(r.work, 20 * 60 + 3 - (9 * 60 + 58));
  assert.equal(r.early, 0);

  const log = g.sheet('출퇴근기록');
  assert.equal(log.getLastRow(), 3);
  const kim = log.rowDisplay(2);
  assert.deepEqual(kim.slice(0, 7), ['2026-11-16', '월', '김민우', '10:00', '20:00', '09:58', '20:03']);
  const lee = log.rowDisplay(3);
  assert.equal(lee[3], '12:00');
  assert.equal(lee[7], '9');
  assert.equal(lee[10], '1,548'); // 10,320 × 9 ÷ 60 = 1548
  assert.equal(lee[11], '', '가산은 아직 위치 등록 전이라 거리는 없어요');
  assert.match(lee[13], /매장 위치 미등록/, '대신 메모에 남아요');
  assert.ok(Number(kim[11]) > 0 && Number(kim[11]) < 60, '왕십리(등록됨)는 출근거리(m)가 남아요');
});

test('비밀번호: 틀리면 거절, 5번 틀리면 잠김', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:59');
  assert.throws(() => punch(g, '김민우', '123', 'in'), /비밀번호가 틀렸어요/);
  for (let i = 0; i < 4; i++) assert.throws(() => punch(g, '김민우', '1111', 'in'));
  assert.throws(() => punch(g, '김민우', '0123', 'in'), /잠겼어요/);
  g.cache.clear();
  assert.equal(punch(g, '김민우', '0123', 'in').time, '09:59');
});

test('퇴사자는 목록에도 없고 찍을 수도 없어요', () => {
  const g = fresh();
  const names = Array.from(g.gs.getStaffList().staff, (p) => p.name);
  assert.deepEqual(names, ['김민우', '이지은']);
  assert.throws(() => punch(g, '박퇴사', '9999', 'in'), /명단에 없는/);
});

test('위치 확인: 멀면 거절, 위치 없으면 거절, 기록만 모드면 통과', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:50');
  assert.throws(() => punch(g, '김민우', '0123', 'in', FAR), /떨어져 있어요/);
  assert.throws(() => punch(g, '김민우', '0123', 'in', null), /위치를 확인하지 못했어요/);
  // 실내 GPS 오차: 반경 100m + 오차 최대 100m까지 봐줘요
  const edge = { lat: 37.5665 + 0.0016, lng: 126.978, acc: 90 }; // 약 178m
  assert.equal(punch(g, '김민우', '0123', 'in', edge).time, '09:50');

  const g2 = fresh({ mode: '기록만' });
  g2.setKst('2026-11-16 09:50');
  assert.equal(punch(g2, '김민우', '0123', 'in', FAR).time, '09:50');
  assert.ok(Number(g2.sheet('출퇴근기록').rowDisplay(2)[11]) > 1000, '먼 거리도 기록은 남아요');
});

test('내 매장 위치가 등록 전이면 막지 않고 메모로 남겨요 (매장을 하나씩 등록하는 동안)', () => {
  const g = createGas({ now: Date.parse('2026-11-16T09:00:00+09:00') });
  g.gs.setup();
  g.setKst('2026-11-16 10:55');
  assert.equal(punch(g, '예시직원', '1234', 'in', null).time, '10:55', '위치를 못 받아도 통과');
  assert.match(g.sheet('출퇴근기록').rowDisplay(2)[13], /매장 위치 미등록/);
  // [매장] 탭에 없는 매장 이름이고, 등록된 매장도 하나도 없으면 알려줘요
  g.sheet('직원').getRange(2, 2).setValue('없는매장');
  g.setKst('2026-11-17 10:55');
  assert.throws(() => punch(g, '예시직원', '1234', 'in'), /매장 위치를 등록하지 않았어요/);
});

test('일찍 퇴근, 퇴근 다시 찍기, 출근 없이 퇴근', () => {
  const g = fresh();
  g.setKst('2026-11-16 10:00');
  punch(g, '김민우', '0123', 'in');
  g.setKst('2026-11-16 19:40');
  let r = punch(g, '김민우', '0123', 'out');
  assert.equal(r.early, 20);
  g.setKst('2026-11-16 20:10');
  r = punch(g, '김민우', '0123', 'out');
  assert.equal(r.early, 0);
  let row = g.sheet('출퇴근기록').rowDisplay(2);
  assert.equal(row[6], '20:10');
  assert.match(row[13], /퇴근 다시 찍음\(이전 19:40\)/);

  g.setKst('2026-11-16 21:00');
  r = punch(g, '이지은', '5678', 'out');
  assert.equal(r.work, null);
  row = g.sheet('출퇴근기록').rowDisplay(3);
  assert.match(row[13], /출근 기록 없음/);
});

test('근무변경 시트가 요일 근무표보다 우선해요', () => {
  const g = fresh();
  g.sheet('근무변경').appendRow(['2026-11-16', '김민우', '13:00-21:00', '대타']);
  g.setKst('2026-11-16 12:55');
  const t = g.gs.getToday('김민우');
  assert.equal(t.sIn, '13:00');
  assert.equal(punch(g, '김민우', '0123', 'in').late, 0);

  g.sheet('근무변경').appendRow(['2026-11-17', '이지은', '휴무', '']);
  g.setKst('2026-11-17 09:00');
  assert.equal(g.gs.getToday('이지은').sIn, '');
});

test('사장님 오늘 화면: 상태를 맞게 보여줘요', () => {
  const g = fresh();
  g.setKst('2026-11-16 10:03');
  punch(g, '김민우', '0123', 'in');
  g.setKst('2026-11-16 12:20');
  const r = g.gs.adminToday('582941');
  const by = Object.fromEntries(r.list.map((p) => [p.name, p]));
  assert.equal(by['김민우'].status, '근무중');
  assert.equal(by['김민우'].late, 3);
  assert.equal(by['이지은'].status, '미출근');
  assert.deepEqual(plain(r.info.stores.map((x) => [x.name, x.hasPlace, x.open, x.staff])), [['왕십리', true, '10:00', 1], ['가산', false, '12:00', 1]]);
  assert.deepEqual(plain(r.list.map((x) => x.store)), ['왕십리', '가산'], '매장 순서대로');
  assert.equal(r.info.weakPin, false);
  assert.throws(() => g.gs.adminToday('0000'), /관리자 비밀번호가 틀렸어요/);

  g.setKst('2026-11-21 11:00'); // 토요일: 김민우 휴무
  const sat = Object.fromEntries(g.gs.adminToday('582941').list.map((p) => [p.name, p]));
  assert.equal(sat['김민우'].status, '휴무');
  assert.equal(sat['이지은'].status, '출근 전');
});

test('월별 합계, 내 기록, 정산 시트', () => {
  const g = fresh();
  const day = (d, tin, tout) => {
    g.setKst(`2026-11-${d} ${tin}`); punch(g, '김민우', '0123', 'in');
    if (tout) { g.setKst(`2026-11-${d} ${tout}`); punch(g, '김민우', '0123', 'out'); }
  };
  day('16', '10:00', '20:00');
  day('17', '10:12', '20:00'); // 12분 지각 → 2,400원
  day('18', '09:50', null); // 퇴근 안 찍음
  g.setKst('2026-11-19 09:00');

  const mine = g.gs.getMyMonth('김민우', '0123', '');
  assert.equal(mine.ym, '2026-11');
  assert.equal(mine.rows.length, 3);
  assert.equal(mine.total.days, 3);
  assert.equal(mine.total.lateCount, 1);
  assert.equal(mine.total.lateMin, 12);
  assert.equal(mine.total.deduct, 2400);
  assert.equal(mine.total.noOut, 1);
  assert.equal(mine.total.work, 600 + 588);
  assert.throws(() => g.gs.getMyMonth('김민우', '', ''), /비밀번호/);

  const m = g.gs.adminMonth('582941', '2026-11');
  const kim = m.staff.find((s) => s.name === '김민우');
  assert.equal(kim.deduct, 2400);
  assert.ok(m.staff.find((s) => s.name === '이지은'), '기록이 없어도 재직자는 보여요');
  assert.ok(!m.staff.find((s) => s.name === '박퇴사'));

  const ex = g.gs.adminExport('582941', '2026-11');
  assert.equal(ex.name, '정산 2026-11');
  const sh = g.sheet('정산 2026-11');
  const kimRow = sh.rowDisplay(2);
  assert.equal(kimRow[0], '김민우');
  assert.equal(kimRow[1], '왕십리', '정산 시트에 매장 칸');
  assert.equal(kimRow[3], '19시간 48분');
  assert.equal(kimRow[7], '2,400');
  assert.equal(sh.rowDisplay(5)[0], '날짜');
  assert.equal(sh.rowDisplay(6)[5], '10:00', '정산 시트의 시간도 그대로 보여요');
  // 다시 만들어도 한 벌만
  g.gs.adminExport('582941', '2026-11');
  assert.equal(g.book.getSheets().filter((s) => s.getName() === '정산 2026-11').length, 1);
});

test('사장님이 시트에서 출근 시간을 고치면 지각·차감이 다시 계산돼요', () => {
  const g = fresh();
  g.setKst('2026-11-16 10:30');
  punch(g, '김민우', '0123', 'in');
  const log = g.sheet('출퇴근기록');
  assert.equal(log.rowDisplay(2)[7], '30');
  // 사장님이 손으로 10:05로 고침 (텍스트 칸이라 글자 그대로 들어가요)
  log.getRange(2, 6).setValue('10:05');
  g.gs.onEdit({ range: log.getRange(2, 6) });
  const row = log.rowDisplay(2);
  assert.equal(row[7], '5');
  assert.equal(row[10], '1,000');
});

test('시트 칸 서식이 시간으로 바뀌어 있어도(오전/오후 표시) 제대로 읽어요', () => {
  const g = fresh();
  g.setKst('2026-11-16 10:00');
  punch(g, '김민우', '0123', 'in');
  const log = g.sheet('출퇴근기록');
  log.setFmt(2, 6, ''); // 누가 서식을 '자동'으로 바꿈
  log.getRange(2, 6).setValue('10:20');
  assert.equal(log.rowDisplay(2)[5], '오전 10:20:00');
  g.gs.onEdit({ range: log.getRange(2, 6) });
  assert.equal(log.rowDisplay(2)[7], '20');
  g.setKst('2026-11-16 20:00');
  assert.equal(punch(g, '김민우', '0123', 'out').late, 20);
});

test('미출근 메일: 기준 시간이 지나면 한 번만 보내요', () => {
  const g = fresh({ email: 'owner@example.com' });
  g.setKst('2026-11-16 10:05');
  g.gs.checkMissing();
  assert.equal(g.mails.length, 0, '아직 10분 안 지남');
  g.setKst('2026-11-16 10:10');
  g.gs.checkMissing();
  assert.equal(g.mails.length, 1);
  assert.match(g.mails[0].body, /김민우 \(출근 예정 10:00\)/);
  assert.doesNotMatch(g.mails[0].body, /이지은/);
  g.setKst('2026-11-16 10:20');
  g.gs.checkMissing();
  assert.equal(g.mails.length, 1, '같은 날 같은 사람은 한 번만');
  g.setKst('2026-11-16 12:15');
  punch(g, '이지은', '5678', 'in');
  g.gs.checkMissing();
  assert.equal(g.mails.length, 1, '찍은 사람은 메일 안 감');

  const quiet = fresh();
  quiet.setKst('2026-11-16 10:30');
  quiet.gs.checkMissing();
  assert.equal(quiet.mails.length, 0, '알림이메일이 비어 있으면 안 보냄');
});

test('기록이 1000줄을 넘어도 계속 써져요', () => {
  const g = fresh();
  const log = g.sheet('출퇴근기록');
  const filler = Array.from({ length: 998 }, (_, i) => ['2026-10-01', '수', 'x' + i, '', '', '10:00', '20:00', '', '', 600, '', '', '', '']);
  log.getRange(2, 1, filler.length, 14).setNumberFormats(filler.map(() => g.gs.LOG_FMT)).setValues(filler);
  assert.equal(log.getLastRow(), 999);
  g.setKst('2026-11-16 10:00');
  punch(g, '김민우', '0123', 'in');
  g.setKst('2026-11-16 12:00');
  punch(g, '이지은', '5678', 'in');
  assert.equal(log.getLastRow(), 1001);
  const last = log.rowDisplay(1001);
  assert.equal(last[2], '이지은');
  assert.equal(last[0], '2026-11-16', '새로 늘어난 줄도 날짜가 글자 그대로 보여요');
  assert.equal(last[5], '12:00', '새로 늘어난 줄도 시간이 글자 그대로 보여요');
});

test('시트 메뉴용 함수는 웹 화면에서 부르면 막혀요', () => {
  const g = fresh();
  assert.throws(() => g.gs.menuExportThis(), /getUi/);
  assert.equal(g.sheet('정산 2026-11'), null);
});

test('폰 등록: 처음 찍은 폰이 등록되고, 그 폰으로만 찍혀요', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:58');
  punch(g, '김민우', '0123', 'in');
  const staff = g.sheet('직원');
  assert.match(staff.rowDisplay(2)[12], /^#aaaaaaaaaaaaaaaa iPhone 사파리 · 11\/16 등록$/);

  g.setKst('2026-11-16 20:00');
  assert.equal(punch(g, '김민우', '0123', 'out').time, '20:00', '같은 폰은 통과');
});

test('동료 폰으로 대신 찍기: 다른 직원 폰이면 거절하고 기록·메일', () => {
  const g = fresh({ email: 'owner@example.com' });
  g.setKst('2026-11-16 09:58');
  punch(g, '김민우', '0123', 'in');
  g.setKst('2026-11-16 12:01');
  // 김민우가 이지은 비밀번호를 알고 자기 폰으로 대신 찍으려 함
  assert.throws(() => punch(g, '이지은', '5678', 'in', NEAR, PHONE['김민우']), /김민우 님 폰으로 등록돼 있어요/);
  assert.equal(g.gs.getToday('이지은').tIn, '', '출근이 안 찍혀요');
  assert.deepEqual(suspects(g).at(-1).slice(1, 3), ['이지은', '다른 직원 폰']);
  assert.match(suspects(g).at(-1)[3], /김민우 님 폰으로 찍으려 함/);
  assert.equal(g.mails.length, 1);
  assert.match(g.mails[0].subject, /이지은 · 다른 직원 폰/);
  assert.equal(g.sheet('직원').rowDisplay(3)[12], '', '이지은 폰으로 등록되지도 않아요');
});

test('새 폰: 거절 → 사장님 승인 → 새 폰만 통과, 예전 폰은 거절', () => {
  const g = fresh({ email: 'owner@example.com' });
  g.setKst('2026-11-16 09:58');
  punch(g, '김민우', '0123', 'in');

  const NEW = 'eeeeeeeeeeeeeeee';
  g.setKst('2026-11-17 09:59');
  assert.throws(() => punch(g, '김민우', '0123', 'in', NEAR, NEW, 'Android 크롬'), /새 폰 승인을 요청했어요/);
  assert.throws(() => punch(g, '김민우', '0123', 'in', NEAR, NEW, 'Android 크롬'), /새 폰 승인/);
  assert.equal(g.mails.length, 1, '같은 폰으로 여러 번 눌러도 메일은 한 번');
  assert.equal(suspects(g).filter((s) => s[2] === '새 폰 승인 요청').length, 2, '시도는 매번 남아요');
  assert.match(suspects(g).at(-1)[3], /Android 크롬 \(등록된 폰: iPhone 사파리\)/);

  const today = g.gs.adminToday('582941');
  assert.equal(today.pending.length, 1);
  assert.equal(today.pending[0].name, '김민우');
  assert.match(today.pending[0].label, /Android 크롬 · 11\/17 09:59 요청/);
  assert.equal(today.suspects.length, 2);

  const after = g.gs.adminDevice('582941', '김민우', true);
  assert.equal(after.pending.length, 0);
  assert.match(after.devices.find((d) => d.name === '김민우').label, /Android 크롬 · 11\/17 승인/);
  assert.equal(g.sheet('직원').rowDisplay(2)[13], '', '요청 칸은 비워져요');

  g.setKst('2026-11-17 10:02');
  assert.equal(punch(g, '김민우', '0123', 'in', NEAR, NEW).late, 2);
  g.setKst('2026-11-17 20:00');
  assert.throws(() => punch(g, '김민우', '0123', 'out', NEAR, PHONE['김민우']), /등록된 폰이 아니에요/);
});

test('새 폰 거절, 관리자 비밀번호 틀림', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:58');
  punch(g, '김민우', '0123', 'in');
  assert.throws(() => punch(g, '김민우', '0123', 'out', NEAR, 'ffffffffffffffff'));
  assert.throws(() => g.gs.adminDevice('1111', '김민우', false), /관리자 비밀번호/);
  assert.equal(suspects(g).at(-1)[2], '관리자 비밀번호 틀림');
  g.gs.adminDevice('582941', '김민우', false);
  assert.equal(g.gs.adminToday('582941').pending.length, 0);
  assert.match(g.sheet('직원').rowDisplay(2)[12], /aaaaaaaaaaaaaaaa/, '등록폰은 그대로');
  assert.throws(() => g.gs.adminDevice('582941', '김민우', true), /승인 대기 중인 폰이 없어요/);
});

test('다른 직원 폰을 승인하려 하면 막아요', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:58');
  punch(g, '김민우', '0123', 'in');
  punch(g, '이지은', '5678', 'in', NEAR, PHONE['이지은']);
  // 이지은 줄에 김민우 폰 번호로 요청이 생긴 상황(시트를 손으로 고친 경우 등)
  g.sheet('직원').getRange(3, 14).setValue('#aaaaaaaaaaaaaaaa iPhone 사파리 · 11/16 12:00 요청');
  assert.throws(() => g.gs.adminDevice('582941', '이지은', true), /김민우 님 폰으로 등록돼 있어서/);
});

test('폰 번호가 없으면(시크릿 모드 등) 거절, 폰확인=안함이면 통과', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:58');
  assert.throws(() => punch(g, '김민우', '0123', 'in', NEAR, ''), /시크릿/);
  assert.equal(suspects(g).at(-1)[2], '폰 확인 안 됨');
  g.gs.setSetting_('폰확인', '안함');
  assert.equal(punch(g, '김민우', '0123', 'in', NEAR, '').time, '09:58');
});

test('의심기록: 비밀번호 틀림, 매장 밖, 위치 없음, 기록만 모드의 매장 밖', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:50');
  assert.throws(() => punch(g, '김민우', '9999', 'in'));
  assert.throws(() => punch(g, '김민우', '0123', 'in', FAR));
  assert.throws(() => punch(g, '김민우', '0123', 'in', null));
  const s = suspects(g);
  assert.deepEqual(s.map((x) => x[2]), ['비밀번호 틀림', '매장 밖', '위치 없음']);
  assert.equal(s[0][0], '2026-11-16 09:50');
  assert.match(s[1][3], /가장 가까운 매장\(왕십리\)에서 1\.5km \(GPS 오차 20m\)/);

  g.gs.setSetting_('위치확인', '기록만');
  g.setKst('2026-11-16 09:55');
  assert.equal(punch(g, '김민우', '0123', 'in', FAR).time, '09:55');
  assert.equal(suspects(g).at(-1)[2], '매장 밖에서 찍음');
  assert.equal(g.gs.adminToday('582941').suspects[0].kind, '매장 밖에서 찍음', '최근 것이 위에');
});

test('예전 버전 시트에 setup을 다시 돌리면 등록폰 칸과 의심기록 탭이 생겨요', () => {
  const g = createGas({ now: Date.parse('2026-11-16T09:00:00+09:00') });
  const old = g.book.insertSheet('직원');
  old.getRange(1, 1, 2, 11).setValues([
    ['이름', 'PIN', '시급', '월', '화', '수', '목', '금', '토', '일', '재직'],
    ['김민우', '1234', 12000, '10:00-20:00', '', '', '', '', '', '', ''],
  ]);
  g.gs.setup();
  assert.deepEqual(plain(old.rowDisplay(1).slice(11, 14)), ['매장', '등록폰', '새폰요청'], '없는 칸은 오른쪽 끝에 붙어요');
  assert.ok(g.sheet('의심기록'));
  assert.ok(g.sheet('매장'));
  const kim = g.gs.staff_()[0];
  assert.equal(kim.name, '김민우', '기존 직원은 그대로');
  assert.equal(kim.pin, '1234', '칸 순서가 달라도 머리글 이름으로 읽어요');
  assert.equal(kim.week[1], '10:00-20:00');
});

/* ───── 정정·휴무·대타 요청, 텔레그램 ───── */

const req = (g, name, pin, kind, extra = {}) => g.gs.makeRequest({ name, pin, kind, ...extra });
const reqRows = (g) => {
  const sh = g.sheet('요청');
  const out = [];
  for (let r = 2; r <= sh.getLastRow(); r++) out.push(sh.rowDisplay(r));
  return out;
};
// 휴무표 그날 칸
const mark = (g, name, date) => { g.gs.GRID_ = {}; return g.gs.dayMark_(name, date); };
const changeRows = (g) => {
  const sh = g.sheet('근무변경');
  const out = [];
  for (let r = 2; r <= sh.getLastRow(); r++) out.push(sh.rowDisplay(r).slice(0, 4));
  return out;
};

test('정정 요청: 퇴근을 깜빡함 → 사장님 승인 → 기록에 반영', () => {
  const g = fresh({ email: 'owner@example.com' });
  g.setKst('2026-11-16 10:03');
  punch(g, '김민우', '0123', 'in');
  g.setKst('2026-11-17 09:40');
  const r = req(g, '김민우', '0123', 'fix', { date: '2026-11-16', type: 'out', time: '20:05', reason: '마감하다 깜빡함' });
  assert.equal(r.mine.length, 1);
  assert.equal(r.mine[0].state, '대기');
  assert.equal(r.mine[0].what, '퇴근 20:05');
  assert.equal(g.mails.length, 1);
  assert.match(g.mails[0].subject, /\[왕십리\] 김민우 · 기록 정정 요청/);
  assert.match(g.mails[0].body, /사유: 마감하다 깜빡함/);

  const t = g.gs.adminToday('582941');
  assert.equal(t.requests.length, 1);
  assert.equal(t.requests[0].before, '', '퇴근 기록이 원래 없었어요');
  g.gs.adminRequest('582941', t.requests[0].id, true);

  const row = g.sheet('출퇴근기록').rowDisplay(2);
  assert.equal(row[6], '20:05');
  assert.equal(row[9], String(20 * 60 + 5 - (10 * 60 + 3)), '근무시간이 다시 계산돼요');
  assert.match(row[13], /정정 승인: 퇴근 20:05 마감하다 깜빡함/);
  assert.equal(reqRows(g)[0][7], '승인');
  assert.equal(g.gs.adminToday('582941').requests.length, 0);
});

test('정정 요청: 출근 시간 고치기(이전 시간 남김), 기록이 없던 날도 새로 만들어요', () => {
  const g = fresh();
  g.setKst('2026-11-16 10:30');
  punch(g, '김민우', '0123', 'in');
  g.setKst('2026-11-18 12:00');
  req(g, '김민우', '0123', 'fix', { date: '2026-11-16', type: 'in', time: '09:58', reason: '폰이 꺼져서 늦게 찍음' });
  req(g, '김민우', '0123', 'fix', { date: '2026-11-17', type: 'in', time: '10:00', reason: '출근 깜빡' });
  const ids = g.gs.adminToday('582941').requests.map((x) => x.id);
  assert.equal(g.gs.adminToday('582941').requests[0].before, '10:30');
  ids.forEach((id) => g.gs.adminRequest('582941', id, true));
  const log = g.sheet('출퇴근기록');
  const d16 = log.rowDisplay(2);
  assert.equal(d16[5], '09:58');
  assert.equal(d16[7], '', '지각이 없어졌어요');
  assert.match(d16[13], /이전 10:30/);
  const d17 = log.rowDisplay(3);
  assert.deepEqual(d17.slice(0, 6), ['2026-11-17', '화', '김민우', '10:00', '20:00', '10:00']);
});

test('정정 요청 검사: 미래, 14일 넘음, 사유 없음, 같은 요청 중복, 비밀번호', () => {
  const g = fresh();
  g.setKst('2026-11-18 12:00');
  assert.throws(() => req(g, '김민우', '0123', 'fix', { date: '2026-11-18', type: 'out', time: '20:00', reason: 'x' }), /아직 지나지 않은 시간/);
  assert.throws(() => req(g, '김민우', '0123', 'fix', { date: '2026-11-19', type: 'out', time: '10:00', reason: 'x' }), /14일 전까지/);
  assert.throws(() => req(g, '김민우', '0123', 'fix', { date: '2026-11-01', type: 'out', time: '10:00', reason: 'x' }), /14일 전까지/);
  assert.throws(() => req(g, '김민우', '0123', 'fix', { date: '2026-11-17', type: 'out', time: '20:00', reason: ' ' }), /사유/);
  assert.throws(() => req(g, '김민우', '0123', 'fix', { date: '2026-11-17', type: 'out', time: '8시', reason: 'x' }), /시간을 넣어/);
  assert.throws(() => req(g, '김민우', '1111', 'fix', { date: '2026-11-17', type: 'out', time: '20:00', reason: 'x' }), /비밀번호/);
  req(g, '김민우', '0123', 'fix', { date: '2026-11-17', type: 'out', time: '20:00', reason: 'x' });
  assert.throws(() => req(g, '김민우', '0123', 'fix', { date: '2026-11-17', type: 'out', time: '20:10', reason: 'x' }), /이미 있어요/);
  req(g, '김민우', '0123', 'fix', { date: '2026-11-17', type: 'in', time: '10:00', reason: 'x' }); // 출근은 따로 돼요
  assert.equal(reqRows(g).length, 2);
});

test('휴무 요청: 승인하면 휴무표 그날 칸에 휴무가 들어가요, 거절·취소', () => {
  const g = fresh();
  g.setKst('2026-11-16 15:00');
  assert.throws(() => req(g, '김민우', '0123', 'off', { date: '2026-11-21', reason: '병원' }), /원래 근무가 없는 날/); // 토요일
  assert.throws(() => req(g, '김민우', '0123', 'off', { date: '2026-11-15', reason: '병원' }), /지난 날짜는 휴무표에 '결근'으로 적힌 날만/);
  assert.throws(() => req(g, '김민우', '0123', 'off', { date: '2026-11-20', reason: '' }), /사유/);
  req(g, '김민우', '0123', 'off', { date: '2026-11-20', reason: '병원' });
  assert.throws(() => req(g, '김민우', '0123', 'swap', { date: '2026-11-20' }), /이미 휴무 요청/);

  const id = g.gs.adminToday('582941').requests[0].id;
  g.gs.adminRequest('582941', id, true);
  assert.equal(mark(g, '김민우', '2026-11-20'), '휴무');
  assert.equal(changeRows(g).length, 0, '근무변경은 안 건드려요');
  g.setKst('2026-11-20 09:00');
  assert.equal(g.gs.getToday('김민우').sIn, '', '그날은 휴무');
  assert.throws(() => g.gs.adminRequest('582941', id, false), /이미 승인된/);

  g.setKst('2026-11-16 15:00');
  const r2 = req(g, '김민우', '0123', 'off', { date: '2026-11-19', reason: '가족 행사' });
  g.gs.adminRequest('582941', r2.mine[0].id, false);
  const r3 = req(g, '김민우', '0123', 'off', { date: '2026-11-18', reason: '개인 사정' });
  const after = g.gs.cancelRequest('김민우', '0123', r3.mine[0].id);
  assert.deepEqual(plain(after.mine.map((x) => x.state)), ['취소', '거절', '승인']);
  assert.equal(mark(g, '김민우', '2026-11-19'), '', '거절은 휴무표를 안 바꿔요');
  assert.equal(mark(g, '김민우', '2026-11-18'), '', '취소도 휴무표를 안 바꿔요');
});

test('월차·반차 신청: 승인하면 휴무표에 그대로 적혀요', () => {
  const g = fresh({ email: 'owner@example.com' });
  g.setKst('2026-11-16 15:00');
  const a = req(g, '김민우', '0123', 'off', { offType: '월차', date: '2026-11-19', reason: '병원' });
  assert.equal(a.mine[0].kind, '월차');
  assert.match(g.mails.at(-1).subject, /김민우 · 월차 요청/);
  assert.match(g.mails.at(-1).body, /10:00-20:00 근무 → 월차/);
  const b = req(g, '김민우', '0123', 'off', { offType: '반차', date: '2026-11-20', reason: '오후 병원' });
  assert.throws(() => req(g, '김민우', '0123', 'off', { offType: '휴무', date: '2026-11-20', reason: 'x' }), /이미 반차 요청/);
  g.gs.adminRequest('582941', a.mine[0].id, true);
  g.gs.adminRequest('582941', b.mine[0].id, true);
  assert.equal(mark(g, '김민우', '2026-11-19'), '월차');
  assert.equal(mark(g, '김민우', '2026-11-20'), '반차');
  g.setKst('2026-11-20 13:30');
  const t = g.gs.getToday('김민우');
  assert.equal(t.sIn, '', '반차 날은 지각을 안 봐요');
  assert.equal(punch(g, '김민우', '0123', 'in').late, 0);
});

test('대타: 구함 → 동료 수락 → 사장님 승인 → 두 사람 근무표가 바뀌어요', () => {
  const g = fresh({ email: 'owner@example.com' });
  g.setKst('2026-11-16 15:00');
  // 11/20(금) 김민우 10:00-20:00 → 이지은이 대신 (이지은도 금요일 12:00-21:00 근무 → 합쳐서 10:00-21:00)
  const a = req(g, '김민우', '0123', 'swap', { date: '2026-11-20', reason: '집안일' });
  assert.equal(a.mine[0].what, '10:00-20:00');
  assert.match(g.mails.at(-1).subject, /김민우 · 대타 구하는 중/);

  assert.throws(() => g.gs.adminRequest('582941', a.mine[0].id, true), /아직 대타를 해줄 동료가 없어요/);

  const seen = g.gs.getRequests('이지은', '5678');
  assert.equal(seen.swaps.length, 1);
  assert.equal(seen.swaps[0].reason, '', '동료에게는 사유를 안 보여줘요');
  assert.equal(g.gs.getRequests('김민우', '0123').swaps.length, 0, '내 요청은 대타 목록에 안 떠요');
  assert.throws(() => g.gs.takeSwap('김민우', '0123', a.mine[0].id), /본인 요청/);

  const b = g.gs.takeSwap('이지은', '5678', a.mine[0].id);
  assert.equal(b.mine[0].taker, '이지은');
  assert.equal(b.swaps.length, 0);
  assert.match(g.mails.at(-1).subject, /대타 수락/);
  assert.match(g.mails.at(-1).body, /이지은 님은 그날 원래 12:00-21:00 근무라서/);
  assert.throws(() => g.gs.takeSwap('박퇴사', '9999', a.mine[0].id), /명단에 없는/);

  const t = g.gs.adminToday('582941').requests[0];
  assert.equal(t.state, '수락');
  assert.match(t.note, /두 시간을 합쳐요/);
  g.gs.adminRequest('582941', t.id, true);
  assert.equal(mark(g, '김민우', '2026-11-20'), '휴무', '요청한 사람은 휴무표에 휴무');
  assert.equal(mark(g, '이지은', '2026-11-20'), '대타', '대타는 휴무표에 대타');
  assert.deepEqual(plain(changeRows(g)), [
    ['2026-11-20', '이지은', '10:00-21:00', '김민우 님 대신 대타 (원래 12:00-21:00 근무와 합침)'],
  ], '대타 시간은 근무변경에');
  g.setKst('2026-11-20 09:00');
  assert.equal(g.gs.getToday('이지은').sIn, '10:00');
  assert.equal(g.gs.getToday('김민우').sIn, '');
});

test('대타: 수락한 사람이 취소하면 다시 구하는 중, 요청자가 취소하면 끝', () => {
  const g = fresh();
  g.setKst('2026-11-16 15:00');
  const a = req(g, '이지은', '5678', 'swap', { date: '2026-11-17' }); // 화요일 12:00-21:00
  const id = a.mine[0].id;
  g.gs.takeSwap('김민우', '0123', id);
  g.gs.cancelRequest('김민우', '0123', id);
  assert.equal(g.gs.getRequests('김민우', '0123').swaps.length, 1, '다시 대타 목록에 떠요');
  g.gs.cancelRequest('이지은', '5678', id);
  assert.equal(g.gs.getRequests('김민우', '0123').swaps.length, 0);
  assert.throws(() => g.gs.takeSwap('김민우', '0123', id), /끝난 요청/);
});

test('오늘 대타가 승인되면 이미 찍은 출근 기록의 예정 시간도 바뀌어요', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:00');
  const a = req(g, '이지은', '5678', 'swap', { date: '2026-11-16' }); // 월 12:00-21:00
  g.gs.takeSwap('김민우', '0123', a.mine[0].id);
  g.setKst('2026-11-16 10:00');
  punch(g, '김민우', '0123', 'in');
  g.gs.adminRequest('582941', a.mine[0].id, true);
  const row = g.sheet('출퇴근기록').rowDisplay(2);
  assert.deepEqual(row.slice(2, 6), ['김민우', '10:00', '21:00', '10:00']);
  g.setKst('2026-11-16 20:00');
  assert.equal(punch(g, '김민우', '0123', 'out').early, 60, '바뀐 퇴근 예정(21:00) 기준으로 조퇴 계산');
});

test('텔레그램: 토큰 저장 → 연결 확인 → 알림이 텔레그램으로, 끊기면 메일로', () => {
  const g = fresh({ email: 'owner@example.com' });
  assert.throws(() => g.gs.adminTelegram('582941', 'abc'), /토큰 모양/);
  assert.throws(() => g.gs.adminTelegram('582941', '123456789:' + 'x'.repeat(32) + 'BAD'), /텔레그램 오류: Unauthorized/);
  const TOKEN = '123456789:' + 'A'.repeat(35);
  const r = g.gs.adminTelegram('582941', TOKEN);
  assert.equal(r.bot, 'goodphone_test_bot');
  assert.equal(r.info.tg, '토큰만');

  assert.match(r.code, /^\d{6}$/, '사장님 채팅방을 찾을 연결 코드');
  assert.throws(() => g.gs.adminTelegramLink('582941'), /봇에게 온 연결 코드가 없어요/);
  g.tg.updates.push({ update_id: 0, message: { chat: { id: 999, type: 'private' }, text: 'hi' } });
  g.tg.updates.push({ update_id: 1, message: { chat: { id: 555111, type: 'private' }, text: '/start own' + r.code } });
  g.tg.updates.push({ update_id: 2, message: { chat: { id: 998, type: 'private' }, text: '안녕하세요' } });
  const info = g.gs.adminTelegramLink('582941');
  assert.equal(info.tg, '연결됨');
  assert.equal(g.tg.sent.at(-1).chat_id, 555111);
  assert.match(g.tg.sent.at(-1).text, /알림이 연결됐어요/);

  // 미출근 알림이 메일 대신 텔레그램으로
  g.setKst('2026-11-16 10:15');
  g.gs.checkMissing();
  assert.equal(g.mails.length, 0);
  assert.match(g.tg.sent.at(-1).text, /아직 출근 안 찍은 직원 1명/);
  assert.match(g.tg.sent.at(-1).text, /사장님 화면: https:\/\/script\.google\.com\/macros\/s\/TEST\/exec\?page=admin/);
  assert.equal(g.tg.sent.at(-1).chat_id, '555111');

  // 텔레그램이 안 되면 메일로
  g.tg.down = true;
  g.setKst('2026-11-16 12:20');
  g.gs.checkMissing();
  assert.equal(g.mails.length, 1);
  assert.match(g.mails[0].subject, /아직 출근 안 찍은 직원/);

  g.gs.adminTelegramOff('582941');
  assert.equal(g.gs.adminToday('582941').info.tg, '');
});

test('텔레그램만 연결하고 메일이 없어도 미출근 알림이 가요', () => {
  const g = fresh();
  g.gs.setSetting_('텔레그램토큰', '123456789:' + 'A'.repeat(35));
  g.gs.setSetting_('텔레그램채팅ID', '777');
  g.setKst('2026-11-16 10:15');
  g.gs.checkMissing();
  assert.equal(g.tg.sent.length, 1);
});

test('시트와 따로 만든 스크립트(SHEET_ID): 그 시트를 열고, 시트 고침 감지를 직접 연결해요', () => {
  const g = createGas({ now: Date.parse('2026-11-16T09:00:00+09:00') });
  g.gs.SHEET_ID = 'SHEET123';
  g.gs.setup();
  assert.ok(g.openedIds.includes('SHEET123'));
  assert.deepEqual(g.triggers.map((t) => [t.getHandlerFunction(), t.kind]), [['checkMissing', 'time'], ['sheetEdited', 'edit']]);
  g.gs.setup();
  assert.equal(g.triggers.length, 2, '다시 실행해도 두 개만');

  // sheetEdited 로도 다시 계산돼요
  g.gs.setSetting_('위치확인', '안함');
  g.gs.setSetting_('폰확인', '안함');
  g.setKst('2026-11-16 10:30');
  g.gs.punch({ name: '예시직원', pin: '1234', type: 'in', agree: true });
  const log = g.sheet('출퇴근기록');
  assert.equal(log.rowDisplay(2)[3], '11:00', '매장 기본 출근 11:00');
  log.getRange(2, 6).setValue('11:05');
  g.gs.sheetEdited({ range: log.getRange(2, 6) });
  assert.equal(log.rowDisplay(2)[7], '5');
  assert.equal(mark(g, '예시직원', '2026-11-16'), '11:05', '고친 시간이 휴무표에도 적혀요');
});

test('같은 순간에 보낸 요청도 번호가 겹치지 않아요', () => {
  const g = fresh();
  g.setKst('2026-11-16 15:00');
  for (const d of ['17', '18', '19', '20']) req(g, '김민우', '0123', 'off', { date: `2026-11-${d}`, reason: '개인' });
  const ids = reqRows(g).map((r) => r[0]);
  assert.equal(new Set(ids).size, 4, ids.join(','));
});

test('한 파일 버전(dist/Code.gs): 최신이고, 화면과 기능이 그대로 돌아가요', () => {
  const fs = require('fs');
  const path = require('path');
  const { bundle } = require('../build');
  const dist = path.join(__dirname, '..', 'dist', 'Code.gs');
  assert.equal(fs.readFileSync(dist, 'utf8'), bundle(), 'dist/Code.gs 가 예전 거예요. node attendance/build.js 를 실행하세요.');

  const g = createGas({ now: Date.parse('2026-11-16T09:00:00+09:00'), file: dist });
  const staff = g.gs.doGet({ parameter: {} });
  const admin = g.gs.doGet({ parameter: { page: 'admin' } });
  assert.equal(staff.title, '출퇴근');
  assert.equal(admin.title, '출퇴근 관리');
  assert.equal(staff.html, fs.readFileSync(path.join(__dirname, '..', 'Index.html'), 'utf8'));
  assert.equal(admin.html, fs.readFileSync(path.join(__dirname, '..', 'Admin.html'), 'utf8'));

  g.gs.setup();
  g.gs.setSetting_('관리자PIN', '582941');
  g.gs.adminSetPlace('582941', '본점', 37.5665, 126.978);
  g.setKst('2026-11-16 11:02');
  assert.equal(g.gs.punch({ name: '예시직원', pin: '1234', type: 'in', ...NEAR, device: 'dddddddddddddddd', label: 'x', agree: true }).late, 2);
});

test('원본(Code.gs)은 HTML 파일을 그대로 써요', () => {
  const g = createGas({ now: 0 });
  assert.equal(g.gs.doGet({ parameter: { page: 'admin' } }).file, 'Admin');
  assert.equal(g.gs.doGet({}).file, 'Index');
});

/* ───── 매장 여러 곳 · 휴무표 · 첫 비밀번호 ───── */

const monthRowOf = (g, ym, name) => {
  const sh = g.sheet('휴무표 ' + ym);
  for (let r = 3; r <= sh.getLastRow(); r++) if (sh.rowDisplay(r)[2] === name) return { r, v: sh.rowDisplay(r) };
  return null;
};

test('휴무표: 지각하면 그날 칸에 출근 시간이 자동으로 적히고, 정시면 안 적혀요', () => {
  const g = fresh();
  g.setKst('2026-11-16 10:07');
  punch(g, '김민우', '0123', 'in');
  g.setKst('2026-11-17 09:59');
  punch(g, '김민우', '0123', 'in');
  assert.equal(mark(g, '김민우', '2026-11-16'), '10:07');
  assert.equal(mark(g, '김민우', '2026-11-17'), '');
  const row = monthRowOf(g, '2026-11', '김민우');
  assert.ok(row, '휴무표에 김민우 줄이 자동으로 생겨요');
  assert.equal(row.v[1], '왕십리');
  assert.equal(row.v[10 + 15], '10:07', '16일 칸(K열부터 1일, J열은 만근)');
  assert.ok(!monthRowOf(g, '2026-11', '박퇴사'), '퇴사자는 휴무표에 안 들어가요');
});

test('휴무표: 수식(휴무에 반차 0.5, 월차 이월·잔여, 지각)이 들어가고 아웃 칸은 없어요', () => {
  const g = fresh();
  g.setKst('2026-11-16 10:07');
  punch(g, '김민우', '0123', 'in');
  const { r } = monthRowOf(g, '2026-11', '김민우');
  const f = g.sheet('휴무표 2026-11').getRange(r, 4, 1, 8).getValues()[0];
  assert.equal(f[0], `=COUNTIF(K${r}:AO${r},"*휴무*")+COUNTIF(K${r}:AO${r},"*휴가*")+0.5*COUNTIF(K${r}:AO${r},"*반차*")`);
  assert.equal(f[1], `=COUNTIF(K${r}:AO${r},"*월차*")`);
  // 앞 달(10월) 탭이 없어도 수식으로 적어요(없는 동안은 0으로 계산되고, 10월 탭이 생기면 앱이 다시 이어요)
  assert.equal(f[2], `=IFERROR(VLOOKUP($C${r},'휴무표 2026-10'!$C:$H,6,FALSE),0)`);
  assert.equal(f[3], `=IF(LEFT(IFERROR(INDEX('휴무표 2026-10'!$A:$AZ,MATCH($C${r},'휴무표 2026-10'!$C:$C,0),MATCH("만근",'휴무표 2026-10'!$1:$1,0)),""),2)="만근",1,0)`);
  assert.equal(f[4], `=F${r}+G${r}-E${r}`);
  assert.equal(f[5], `=SUMPRODUCT(--ISNUMBER(SEARCH(":",K${r}:AO${r})))`);
  // J열 만근: 결근·무단·달 끝(실제 구글 시트에서 계산 확인한 수식). 입사한 달도 결근이 없으면 만근이라 입사일은 안 봐요
  assert.ok(f[6].startsWith(`=IF(SUMPRODUCT(--REGEXMATCH(K${r}:AO${r}&"","결근|무단")),"아님: "&`));
  assert.ok(!f[6].includes('입사'), '입사일 조건 없음');
  assert.ok(f[6].includes(`FILTER(TEXT($K$1:$AO$1,"m/d")&" "&K${r}:AO${r},`));
  assert.ok(f[6].includes('IF(TODAY()<=DATE(2026,11,30),"만근 예정","만근")'));
  assert.equal(f[7], '', 'K열부터 날짜(아웃 칸 없음)');
  // 12월 탭은 11월 탭을 이어 받아요. 20일부터 10분마다 도는 작업이 다음 달 탭에 직원 줄을 채워요
  assert.ok(g.sheet('휴무표 2026-12'), '처음 설정 때 다음 달 탭도 만들어 둬요');
  assert.ok(!monthRowOf(g, '2026-12', '김민우'), '설정 뒤에 넣은 직원은 아직 없음');
  g.setKst('2026-11-20 09:00');
  g.gs.checkMissing();
  const dec = monthRowOf(g, '2026-12', '김민우');
  assert.ok(dec);
  const d = g.sheet('휴무표 2026-12').getRange(dec.r, 6, 1, 2).getValues()[0];
  assert.equal(d[0], `=IFERROR(VLOOKUP($C${dec.r},'휴무표 2026-11'!$C:$H,6,FALSE),0)`);
  assert.equal(d[1], `=IF(LEFT(IFERROR(INDEX('휴무표 2026-11'!$A:$AZ,MATCH($C${dec.r},'휴무표 2026-11'!$C:$C,0),MATCH("만근",'휴무표 2026-11'!$1:$1,0)),""),2)="만근",1,0)`, '부여: 11월 만근이면 1');
  // 머리글: 11/1 은 일요일
  const h = g.sheet('휴무표 2026-11');
  assert.equal(h.rowDisplay(1)[8], '지각');
  assert.equal(h.rowDisplay(1)[9], '만근');
  assert.equal(h.rowDisplay(1)[10], '11/1');
  assert.equal(h.rowDisplay(2)[10], '일');
  assert.equal(h.rowDisplay(1)[10 + 29], '11/30');
  assert.equal(h.rowDisplay(1)[10 + 30], '', '11월은 30일까지');
  assert.equal(h.rowDisplay(1)[41], '메모');
  assert.ok(!h.rowDisplay(1).includes('아웃'));
  assert.match(h.notes['1,10'], /결근\(결근\?·무단\)이 없으면 만근/, '만근 머리글 메모에 규칙');
  assert.match(h.notes['1,7'], /전달이 만근이면 1/);
  assert.match(h.notes['1,6'], /1월은 0/);
  assert.match(h.cfRules[0].calls.find((c) => c[0] === 'whenFormulaSatisfied')[1], /SEARCH\(":",K3\)/, '지각 빨간 글씨 규칙도 K열 기준');
  const texts = Array.from(h.cfRules, (x) => (x.calls.find((c) => c[0] === 'whenTextContains') || [])[1]);
  assert.deepEqual(texts.slice(0, 9), [undefined, '결근', '대타', '반차', '월차', '대체', '휴무?', '휴', undefined], '지각 빨강·결근?·대타·반차·월차·대체·고른 휴무·휴무 색칠·오늘 머리글');
  assert.match(h.cfRules[8].calls.find((c) => c[0] === 'whenFormulaSatisfied')[1], /TEXT\(K\$1,"M\/D"\)=TEXT\(TODAY\(\),"M\/D"\)/);
  const starts = h.cfRules.map((x) => (x.calls.find((c) => c[0] === 'whenTextStartsWith') || [])[1]).filter(Boolean);
  assert.deepEqual(plain(starts), ['아님', '만근'], '만근 아님은 빨강, 만근은 초록 글씨');
  assert.ok(h.cfRules.some((x) => x.calls.some((c) => c[0] === 'whenNumberLessThan' && c[1] === 0)), '잔여가 0보다 작으면 빨강');
});

test('휴무표: 해가 바뀌면 월차 이월은 0이고, 12월 만근으로 생긴 1개만 1월 부여로 들어가요', () => {
  const g = fresh();
  g.setKst('2026-12-21 09:00');
  g.gs.checkMissing(); // 20일이 지나면 다음 달 탭을 미리 만들어요
  assert.ok(g.sheet('휴무표 2027-01'));
  const jan = monthRowOf(g, '2027-01', '김민우');
  const v = g.sheet('휴무표 2027-01').getRange(jan.r, 6, 1, 2).getValues()[0];
  assert.equal(v[0], 0, '1월 이월 0(해를 넘겨 이월 안 돼요)');
  assert.match(String(v[1]), /INDEX\('휴무표 2026-12'!\$A:\$AZ,.*MATCH\("만근",'휴무표 2026-12'!\$1:\$1,0\)/, '부여: 12월 만근이면 1');
  const dec = monthRowOf(g, '2026-12', '김민우');
  assert.match(String(g.sheet('휴무표 2026-12').getRange(dec.r, 6).getValue()), /'휴무표 2026-11'!\$C:\$H/, '12월은 11월 잔여를 이어 받아요');
});

test('예전 휴무표(아웃 칸이 있는 탭)도 머리글로 칸을 찾아서 그대로 읽고 써요', () => {
  const g = fresh();
  // 아웃 칸(J)이 있는 예전 모양의 11월 탭을 직접 만들어요: J 아웃, K부터 1일, AP 메모
  const sh = g.sheet('휴무표 2026-11'); // setup 이 만든 탭을 비우고 예전 모양으로 다시 써요
  sh.clear();
  if (sh.getMaxColumns() < 42) sh.insertColumnsAfter(sh.getMaxColumns(), 42 - sh.getMaxColumns());
  const head = ['No', '매장', '이름', '휴무', '월차', '이월', '부여', '잔여', '지각', '아웃'];
  for (let d = 1; d <= 31; d++) head.push(d <= 30 ? '11/' + d : '');
  head.push('메모');
  sh.getRange(1, 1, 1, 42).setValues([head]);
  sh.getRange(3, 1, 1, 42).setNumberFormat('@');
  const row = ['1', '왕십리', '김민우', '', '', '', '', '', '', '=IF(I3>2,1,0)+3'];
  for (let d = 1; d <= 31; d++) row.push(d === 18 ? '월차' : '');
  row.push('');
  sh.getRange(3, 1, 1, 42).setValues([row]);
  assert.equal(mark(g, '김민우', '2026-11-18'), '월차', '18일 칸을 정확히 읽어요');
  g.setKst('2026-11-17 10:05');
  punch(g, '김민우', '0123', 'in');
  assert.equal(sh.rowDisplay(3)[10 + 16], '10:05', '17일 칸(K열부터 1일)에 써요');
  assert.equal(sh.rowDisplay(3)[9], '=IF(I3>2,1,0)+3', '아웃 칸은 안 건드려요');
});

test('휴무표에 휴무·월차가 적힌 날은 쉬는 날: 지각·미출근 알림 없음, 사장님 화면에 표시', () => {
  const g = fresh({ email: 'owner@example.com' });
  g.setKst('2026-11-16 09:00');
  g.gs.adminToday('582941'); // 휴무표 줄 만들기
  g.gs.ensureMonth_('2026-11');
  const { r } = monthRowOf(g, '2026-11', '김민우');
  g.sheet('휴무표 2026-11').getRange(r, 11 + 17).setValue('월차'); // 11/18 (K열이 1일)
  g.setKst('2026-11-18 10:30');
  g.gs.checkMissing();
  assert.equal(g.mails.length, 0, '월차인 날은 미출근 알림 없음');
  const t = g.gs.adminToday('582941').list.find((x) => x.name === '김민우');
  assert.equal(t.status, '휴무');
  assert.equal(t.mark, '월차');
  assert.equal(punch(g, '김민우', '0123', 'in').late, 0, '쉬는 날 나와서 찍어도 지각 아님');
  assert.equal(mark(g, '김민우', '2026-11-18'), '월차', '휴무표의 월차는 그대로');
});

test('매장 기본 시간: 요일 칸이 비어 있으면 매장 출근 시간, 요일 칸이 있으면 그 시간(사무실)', () => {
  const g = fresh();
  g.sheet('매장').getRange(4, 1, 1, 2).setValues([['사무실', '']]);
  g.sheet('직원').getRange(5, 1, 1, 14).setValues([['오사무', '사무실', '1111', '', '09:00-18:00', '09:00-18:00', '09:00-18:00', '09:00-18:00', '09:00-18:00', '휴무', '휴무', '', '', '']]);
  g.sheet('직원').getRange(6, 1, 1, 3).setValues([['시간미정', '사무실', '2222']]);
  g.setKst('2026-11-16 09:00');
  assert.equal(g.gs.getToday('오사무').sIn, '09:00');
  const st = Object.fromEntries(g.gs.adminToday('582941').list.map((x) => [x.name, x.status]));
  assert.equal(st['시간미정'], '시간 미정', '근무시간이 안 정해진 사무실 직원은 휴무가 아니라 시간 미정');
  assert.equal(st['오사무'], '출근 전');
  assert.equal(g.gs.getToday('이지은').sIn, '12:00', '가산 기본 12:00');
  assert.equal(g.gs.getToday('이지은').sOut, '21:00');
  g.setKst('2026-11-21 09:00');
  assert.equal(g.gs.getToday('오사무').sIn, '', '토요일 휴무');
  // 퇴근 시간이 없는 매장은 조퇴를 안 봐요
  g.sheet('매장').getRange(2, 3).setValue('');
  g.setKst('2026-11-16 10:00');
  punch(g, '김민우', '0123', 'in');
  g.setKst('2026-11-16 15:00');
  const out = punch(g, '김민우', '0123', 'out');
  assert.equal(out.early, 0);
  assert.equal(out.work, 300);
});

test('다른 매장에서 찍어도 돼요(지원 근무): 가장 가까운 매장 이름이 기록에 남아요', () => {
  const g = fresh();
  g.gs.adminSetPlace('582941', '가산', GASAN.lat, GASAN.lng);
  g.setKst('2026-11-16 09:55');
  punch(g, '김민우', '0123', 'in', { ...GASAN, acc: 10 });
  const row = g.sheet('출퇴근기록').rowDisplay(2);
  assert.equal(row[14], '가산', '찍은매장');
  assert.equal(row[3], '12:00', '지원 간 날 지각 기준은 지원 간 매장(가산 12:00) 시간');
  assert.equal(mark(g, '김민우', '2026-11-16'), '가산', '휴무표 그날 칸에 지원 간 매장 이름');
  assert.throws(() => g.gs.adminSetPlace('582941', '없는매장', 1, 1), /없는 매장/);
});

test('첫 비밀번호: 인사 정보가 이미 다 있는 직원은 처음 찍을 때 정한 번호가 비밀번호가 돼요', () => {
  const g = fresh();
  g.sheet('직원').getRange(3, 3).setValue(''); // 이지은 PIN 비움
  assert.equal(g.gs.getStaffList().staff.find((x) => x.name === '이지은').pin, false);
  g.setKst('2026-11-16 11:58');
  assert.throws(() => punch(g, '이지은', '', 'in'), /처음 쓰시는군요/);
  assert.throws(() => punch(g, '이지은', '12', 'in'), /4자리/);
  g.gs.adminSetPlace('582941', '가산', GASAN.lat, GASAN.lng);
  assert.throws(() => punch(g, '이지은', '1357', 'in', { lat: 37.7, lng: 126.978, acc: 10 }), /떨어져 있어요/);
  assert.equal(g.sheet('직원').rowDisplay(3)[2], '', '찍기가 실패하면 비밀번호도 저장 안 해요');
  assert.throws(() => g.gs.getRequests('이지은', '2468'), /아직 비밀번호가 없어요/);
  assert.equal(punch(g, '이지은', '2468', 'in').time, '11:58');
  assert.equal(g.sheet('직원').rowDisplay(3)[2], '2468');
  assert.equal(g.gs.getStaffList().staff.find((x) => x.name === '이지은').pin, true);
  g.setKst('2026-11-16 21:00');
  assert.throws(() => punch(g, '이지은', '1111', 'out'), /비밀번호가 틀렸어요/);
  assert.equal(punch(g, '이지은', '2468', 'out').time, '21:00');
});

test('새로 들어온 직원은 휴무표에 자동으로 줄이 생겨요', () => {
  const g = fresh();
  g.gs.ensureMonth_('2026-11');
  assert.ok(monthRowOf(g, '2026-11', '김민우'));
  g.sheet('직원').getRange(5, 1, 1, 3).setValues([['신입', '가산', '1357']]);
  g.setKst('2026-11-16 12:10');
  assert.throws(() => punch(g, '신입', '1357', 'in', NEAR, 'eeeeeeeeeeeeeeee'), /인사 정보를 먼저 다 넣어야 출근이 찍혀요/);
  hrFill(g, ['신입']);
  punch(g, '신입', '1357', 'in', NEAR, 'eeeeeeeeeeeeeeee');
  const row = monthRowOf(g, '2026-11', '신입');
  assert.ok(row);
  assert.equal(row.v[10 + 15], '12:10');
});

test('직원 목록은 매장 순서대로, 매장 이름도 같이 줘요', () => {
  const g = fresh();
  g.sheet('직원').getRange(5, 1, 1, 3).setValues([['나중왕', '왕십리', '1357']]);
  const l = g.gs.getStaffList();
  assert.deepEqual(plain(l.stores), ['왕십리', '가산']);
  assert.deepEqual(plain(l.staff.map((x) => x.name + '@' + x.store)), ['김민우@왕십리', '나중왕@왕십리', '이지은@가산']);
});

test('매장·직원을 미리 채워 둔 시트에 setup: 데이터는 그대로, 휴무표에 재직자만 매장 순서로', () => {
  const g = createGas({ now: Date.parse('2026-11-19T22:00:00+09:00') });
  const st = g.book.insertSheet('매장');
  st.getRange(1, 1, 4, 7).setNumberFormat('@'); // 구글 시트 API로 글자 그대로 넣은 것처럼
  st.getRange(1, 1, 4, 7).setValues([
    ['매장', '출근', '퇴근', '위도', '경도', '반경(m)', '메모'],
    ['왕십리', '11:00', '', '', '', '', ''],
    ['청주', '11:00', '', '', '', '', ''],
    ['사무실(창)', '', '', '', '', '', '직원마다 달라요'],
  ]);
  const sf = g.book.insertSheet('직원');
  sf.getRange(1, 1, 5, 14).setValues([
    ['이름', '매장', 'PIN', '시급', '월', '화', '수', '목', '금', '토', '일', '재직', '등록폰', '새폰요청'],
    ['한예솔', '청주', '', '', '', '', '', '', '', '', '', '퇴사', '', ''],
    ['오사무', '사무실(창)', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['정다온', '청주', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['윤서진', '왕십리', '', '', '', '', '', '', '', '', '', '', '', ''],
  ]);
  g.gs.setup();
  assert.equal(st.rowDisplay(2)[1], '11:00', '매장 데이터 그대로');
  const names = [];
  const m = g.sheet('휴무표 2026-11');
  for (let r = 3; r <= m.getLastRow(); r++) names.push(m.rowDisplay(r)[1] + ':' + m.rowDisplay(r)[2]);
  assert.deepEqual(names, ['왕십리:윤서진', '청주:정다온', '사무실(창):오사무'], '퇴사자 빼고 매장 순서대로');
  assert.ok(g.sheet('휴무표 2026-12'));
  assert.equal(g.gs.getToday('윤서진').sIn, '11:00');
  assert.equal(g.gs.getToday('오사무').sIn, '', '사무실은 시간을 정하기 전까지 비어 있어요');
});


/* ───── v2: 11시 몰림 · 다른 매장 · 동의 · 비밀번호 · 퇴근 누락 ───── */

test('지원 근무: 다른 매장에서 출근하면 휴무표에 매장 이름이 적히고, 지각은 지원 간 매장 시간 기준이에요', () => {
  const g = v3({ email: 'owner@example.com' });
  tgOn(g);
  g.gs.adminSetPlace('582941', '가산', GASAN.lat, GASAN.lng);
  // 11/16: 김민우(왕십리 10:00)가 가산(12:00~21:00)으로 지원. 10:30 도착 → 지각 아님
  g.setKst('2026-11-16 10:30');
  const r1 = punch(g, '김민우', '0123', 'in', { ...GASAN, acc: 10 });
  assert.deepEqual([r1.late, r1.support], [0, '가산']);
  const row = g.sheet('출퇴근기록').rowDisplay(2);
  assert.deepEqual([row[3], row[4], row[14], row[15]], ['12:00', '21:00', '가산', '왕십리'], '예정 시간은 가산 기준, 찍은매장 가산, 소속 왕십리');
  assert.match(row[13], /다른 매장\(가산\)/);
  assert.equal(mark(g, '김민우', '2026-11-16'), '가산');
  assert.equal(suspects(g).length, 0, '지원 근무는 의심 기록이 아니에요');
  assert.equal(g.gs.adminToday('582941').list.find((x) => x.name === '김민우').place, '가산', '사장님 화면에 어디서 찍었는지 보여요');
  // 11/17: 가산에 12:08 도착 → 지각 8분, 칸에는 '가산 12:08'
  g.setKst('2026-11-17 12:08');
  const r2 = punch(g, '김민우', '0123', 'in', { ...GASAN, acc: 10 });
  assert.equal(r2.late, 8);
  assert.equal(mark(g, '김민우', '2026-11-17'), '가산 12:08');
  // 정정이 승인돼 지각이 아니게 되면 시간만 지워지고 매장 이름은 남아요
  req(g, '김민우', '0123', 'fix', { date: '2026-11-17', type: 'in', time: '11:55', reason: '찍는 걸 깜빡함', to: 'admin' });
  g.gs.adminRequest('582941', reqRows(g)[0][0], true);
  assert.equal(mark(g, '김민우', '2026-11-17'), '가산');
  // 그날 [근무변경]으로 시간을 정해 둔 날은 그 시간 기준(지원 표시는 그대로)
  g.sheet('근무변경').appendRow(['2026-11-18', '김민우', '11:00-20:00', '가산 지원']);
  g.setKst('2026-11-18 11:05');
  const r3 = punch(g, '김민우', '0123', 'in', { ...GASAN, acc: 10 });
  assert.equal(r3.late, 5);
  assert.equal(mark(g, '김민우', '2026-11-18'), '가산 11:05');
  // 쉬는 날(수요일 휴무인 이지은)이 왕십리로 지원: '휴무 왕십리'(쉬는 날 출근 대체휴무도 그대로)
  g.gs.setMark_('2026-11-19', '이지은', () => '휴무');
  g.setKst('2026-11-19 10:20');
  punch(g, '이지은', '5678', 'in', NEAR);
  assert.equal(mark(g, '이지은', '2026-11-19'), '휴무 왕십리');
  // 밤 요약에 지원 근무가 나와요
  g.setKst('2026-11-19 23:40');
  g.gs.checkMissing();
  assert.match(sentTo(g, 555).find((x) => /하루 마감 정리/.test(x)), /지원 근무\(다른 매장에서 출근\) 1명\n\[가산\] 이지은 → 왕십리/);
  // 집계: 누가 어디로 몇 번(며칠에)
  const sp = plain(g.gs.adminSupport('582941', '2026-11'));
  assert.equal(sp.total, 4);
  assert.deepEqual(sp.people.map((p) => [p.name, p.store, p.total, p.by.map((b) => [b.to, b.n, b.days])]), [
    ['김민우', '왕십리', 3, [['가산', 3, ['11/16', '11/17', '11/18']]]],
    ['이지은', '가산', 1, [['왕십리', 1, ['11/19']]]],
  ]);
  assert.deepEqual(sp.stores, [{ store: '가산', n: 3 }, { store: '왕십리', n: 1 }], '매장마다 지원 받은 횟수');
  assert.equal(plain(g.gs.adminSupport('582941', '2026')).total, 4, '그 해 전체');
  // 점장(왕십리): 자기 매장 직원이 나간 것과 자기 매장으로 온 것만
  assert.equal(plain(g.gs.adminSupport(MGR, '2026-11')).total, 4);
  // 1년 보기에도
  const y = plain(g.gs.adminYear('582941', '김민우', '2026'));
  assert.deepEqual([y.months[10].sup, y.total.supBy], [3, { 가산: 3 }]);
  // '지원 2026' 탭
  const out = g.gs.adminExportSupport('582941', '2026');
  assert.deepEqual([out.name, out.days, out.people], ['지원 2026', 4, 2]);
  const rows = sheetRows(g.sheet('지원 2026'));
  assert.deepEqual(rows[1].slice(0, 5), ['이름', '소속 매장', '합계', '왕십리(으)로', '가산(으)로']);
  assert.deepEqual(rows[2].slice(0, 5), ['김민우', '왕십리', '3', '', '3']);
  assert.ok(rows.some((x) => x[0] === '2026-11-19' && x[2] === '이지은' && x[4] === '왕십리'));
});

test('처음 한 번 동의해야 찍혀요. 동의한 날짜가 [직원] 동의 칸에 남아요', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:58');
  const bare = { name: '김민우', pin: '0123', type: 'in', ...NEAR, device: PHONE['김민우'], label: 'x' };
  assert.throws(() => g.gs.punch(bare), /동의가 필요해요/);
  assert.equal(g.gs.getStaffList().staff.find((x) => x.name === '김민우').agreed, false);
  g.gs.punch({ ...bare, agree: true });
  assert.equal(g.sheet('직원').rowDisplay(2)[14], '2026-11-16 09:58');
  assert.equal(g.gs.getStaffList().staff.find((x) => x.name === '김민우').agreed, true);
  g.setKst('2026-11-16 20:00');
  assert.equal(g.gs.punch({ ...bare, type: 'out' }).time, '20:00', '한 번 동의하면 다음부터는 안 물어요');
});

test('예전 [직원] 탭에 동의 칸이 없어도, 처음 동의할 때 칸을 알아서 붙여요', () => {
  const g = fresh();
  const sh = g.sheet('직원');
  sh.getRange(1, 15, 1, 2).setValues([['', '']]); // 동의·텔레그램 머리글이 없던 예전 시트처럼
  g.setKst('2026-11-16 09:58');
  punch(g, '김민우', '0123', 'in');
  assert.equal(sh.rowDisplay(1)[14], '동의');
  assert.equal(sh.rowDisplay(2)[14], '2026-11-16 09:58');
});

test('기록 시간은 누른 순간: 줄이 너무 길면 오류 대신 "다시 눌러주세요"', () => {
  const g = fresh();
  g.setKst('2026-11-16 10:59');
  g.setLockBusy(true);
  assert.throws(() => punch(g, '김민우', '0123', 'in'), /잠깐 밀렸어요. 다시 한 번 눌러주세요/);
  g.setLockBusy(false);
  assert.equal(punch(g, '김민우', '0123', 'in').time, '10:59');
});

test('쉬운 비밀번호(1234 등)나 3명 이상 같은 번호면 바꾸라고 알려줘요', () => {
  const g = fresh();
  g.sheet('직원').getRange(2, 3).setValue('1234');
  g.setKst('2026-11-16 09:58');
  assert.equal(punch(g, '김민우', '1234', 'in').weakPin, true);
  assert.equal(punch(g, '이지은', '5678', 'in').weakPin, false);
  g.sheet('직원').getRange(2, 3).setValue('5678');
  g.sheet('직원').getRange(4, 3).setValue('5678'); // 박퇴사(퇴사자도 같은 번호면 셈)
  assert.equal(g.gs.getHome('이지은', '5678').weakPin, true, '셋이 같은 번호');
});

test('직원이 직접 비밀번호 바꾸기', () => {
  const g = fresh();
  assert.throws(() => g.gs.changePin('김민우', '9999', '2468'), /비밀번호가 틀렸어요/);
  assert.throws(() => g.gs.changePin('김민우', '0123', '12'), /4~6자리/);
  assert.throws(() => g.gs.changePin('김민우', '0123', '0123'), /지금 비밀번호와 같아요/);
  assert.throws(() => g.gs.changePin('김민우', '0123', '1234'), /너무 쉬운 번호/);
  g.gs.changePin('김민우', '0123', '2468');
  assert.equal(g.sheet('직원').rowDisplay(2)[2], '2468');
  g.setKst('2026-11-16 09:58');
  assert.throws(() => punch(g, '김민우', '0123', 'in'), /비밀번호가 틀렸어요/);
  assert.equal(punch(g, '김민우', '2468', 'in').time, '09:58');
});

test('사장님이 비밀번호를 미리 정하거나 초기화하고, 폰 등록도 지울 수 있어요', () => {
  const g = fresh();
  g.sheet('직원').getRange(3, 3).setValue(''); // 이지은 PIN 비움
  let t = g.gs.adminToday('582941');
  assert.equal(t.devices.find((d) => d.name === '이지은').pin, '미정');
  t = g.gs.adminSetPin('582941', '이지은', '0581');
  assert.equal(t.devices.find((d) => d.name === '이지은').pin, '정함');
  assert.equal(g.sheet('직원').rowDisplay(3)[2], '0581', '앞의 0도 그대로');
  assert.throws(() => g.gs.adminSetPin('582941', '이지은', '12a4'), /4~6자리/);
  assert.equal(g.gs.adminSetPin('582941', '이지은', '1234').devices.find((d) => d.name === '이지은').pin, '쉬움');
  // 잠긴 직원도 사장님이 비밀번호를 다시 정하면 풀려요
  for (let i = 0; i < 5; i++) assert.throws(() => punch(g, '이지은', '0000', 'in'));
  assert.throws(() => punch(g, '이지은', '1234', 'in'), /잠겼어요/);
  g.gs.adminSetPin('582941', '이지은', '7351');
  g.setKst('2026-11-16 11:59');
  assert.equal(punch(g, '이지은', '7351', 'in').time, '11:59');
  // 폰 초기화
  assert.match(g.sheet('직원').rowDisplay(3)[12], /bbbb/);
  g.gs.adminResetDevice('582941', '이지은');
  assert.equal(g.sheet('직원').rowDisplay(3)[12], '');
  assert.throws(() => g.gs.adminSetPin('1111', '이지은', '5555'), /관리자 비밀번호/);
});

test('직원 화면 한 번에 불러오기: 오늘·요청·퇴근 누락(정정 요청 보내면 사라짐)·비밀번호 오류', () => {
  const g = fresh();
  g.setKst('2026-11-16 10:00');
  punch(g, '김민우', '0123', 'in');
  g.setKst('2026-11-17 09:50');
  let h = g.gs.getHome('김민우', '0123');
  assert.equal(h.today.sIn, '10:00');
  assert.deepEqual(plain(h.missingOut), { date: '2026-11-16', dow: '월', tIn: '10:00' });
  assert.ok(h.requests);
  req(g, '김민우', '0123', 'fix', { date: '2026-11-16', type: 'out', time: '20:00', reason: '깜빡' });
  h = g.gs.getHome('김민우', '0123');
  assert.equal(h.missingOut, null, '정정 요청을 보냈으면 안 보여요');
  assert.equal(h.requests.mine.length, 1);
  const bad = g.gs.getHome('김민우', '9999');
  assert.match(bad.pinError, /비밀번호가 틀렸어요/);
  assert.equal(bad.requests, null);
  assert.equal(g.gs.getHome('김민우', '').requests, null, '비밀번호 없으면 오늘만');
});

test('밤(23시~7시)에는 미출근 알림 검사를 안 해요', () => {
  const g = fresh({ email: 'owner@example.com' });
  g.sheet('직원').getRange(2, 5, 1, 7).setValues([['06:00-15:00', '06:00-15:00', '06:00-15:00', '06:00-15:00', '06:00-15:00', '휴무', '휴무']]);
  g.setKst('2026-11-16 06:30');
  g.gs.checkMissing();
  assert.equal(g.mails.length, 0);
  g.setKst('2026-11-16 07:10');
  g.gs.checkMissing();
  assert.equal(g.mails.length, 1);
});

test('사장님 비밀번호가 0000처럼 쉽거나 6자리보다 짧으면 사장님 화면이 안 열려요(바꾸면 열려요)', () => {
  const g = fresh();
  assert.equal(g.gs.adminToday('582941').info.weakPin, false);
  for (const weak of ['0000', '7777', '12345', '777777', '123456']) {
    g.gs.setSetting_('관리자PIN', weak);
    assert.throws(() => g.gs.adminToday(weak), /관리자 비밀번호가 너무 쉬워요/, weak);
  }
  g.gs.setSetting_('관리자PIN', '820417');
  assert.equal(g.gs.adminToday('820417').info.weakPin, false);
});

/* ───── v3: 점장 결재, 직원 텔레그램, 하루 마감, 근무표, 다음 달 휴무, 공휴일·대체휴무 ───── */

const MGR = { name: '박점장', pin: '246813' };
const TOKEN = '123456789:' + 'A'.repeat(35);
PHONE.박점장 = 'eeeeeeeeeeeeeeee';
PHONE.최유나 = 'ffffffffffffffff';
// fresh() + 왕십리 점장 박점장, 가산 직원 최유나. 점장은 [매장] 점장 칸(8번째)에 이름을 적어요
function v3(opts = {}) {
  const g = fresh(opts);
  g.sheet('직원').getRange(5, 1, 2, 14).setValues([
    ['박점장', '왕십리', '246813', 12000, '', '', '', '', '', '', '', '', '', ''],
    ['최유나', '가산', '1357', 10320, '', '', '', '', '', '', '', '', '', ''],
  ]);
  g.sheet('매장').getRange(2, 8).setValue('박점장');
  g.gs.setup(); // 새 직원 줄을 휴무표에
  if (opts.hr !== false) hrFill(g, ['박점장', '최유나']);
  return g;
}
const ROW = { 김민우: 2, 이지은: 3, 박점장: 5, 최유나: 6 };
// 텔레그램: 사장님 채팅 555, chats = {이름: 직원 채팅 번호}
const tgOn = (g, chats = {}) => {
  g.gs.setSetting_('텔레그램토큰', TOKEN);
  g.gs.setSetting_('텔레그램채팅ID', '555');
  g.gs.setSetting_('텔레그램봇', 'goodphone_test_bot');
  for (const [n, id] of Object.entries(chats)) g.gs.setStaffCell_(ROW[n], '텔레그램', id);
};
const PropertiesServiceGet = (g, k) => g.gs.PropertiesService.getScriptProperties().getProperty(k);
const PropertiesServiceSet = (g, k, v) => { g.gs.PropertiesService.getScriptProperties().setProperty(k, v); g.gs.MEMO_ = {}; };
const sentTo = (g, chat) => g.tg.sent.filter((m) => String(m.chat_id) === String(chat)).map((m) => m.text);
const setting = (g, key) => {
  const sh = g.sheet('설정');
  for (let r = 2; r <= sh.getLastRow(); r++) if (sh.rowDisplay(r)[0] === key) return sh.rowDisplay(r)[1];
  return undefined;
};

test('결재: 직원 → 점장(관리자에게 올리기) → 관리자 승인, 단계마다 알림', () => {
  const g = v3({ email: 'owner@example.com' });
  tgOn(g, { 박점장: '9005', 김민우: '9002' });
  g.setKst('2026-11-16 15:00');
  const list = g.gs.getStaffList();
  assert.deepEqual(plain(list.mgr), { 왕십리: '박점장' });
  assert.deepEqual(plain(list.managers), ['박점장']);

  req(g, '김민우', '0123', 'off', { date: '2026-11-18', reason: '병원' });
  assert.equal(reqRows(g)[0][10], '점장', '점장이 있는 매장은 점장에게 먼저');
  assert.match(sentTo(g, 9005).at(-1), /\[왕십리\] 김민우 · 휴무 요청/);
  assert.match(sentTo(g, 9005).at(-1), /관리자에게 올리기/);
  assert.equal(sentTo(g, 555).length, 0, '사장님께는 점장이 올리면 가요');

  const t = g.gs.adminToday(MGR);
  assert.equal(t.role, 'manager');
  assert.equal(t.me, '박점장');
  assert.deepEqual(Array.from(t.list, (p) => p.name), ['김민우', '박점장'], '자기 매장 직원만');
  assert.equal(t.devices.length, 0, '폰·비밀번호 관리는 관리자만');
  assert.equal(t.requests.length, 1);
  assert.equal(t.requests[0].route, '점장');
  assert.throws(() => g.gs.adminRequest(MGR, t.requests[0].id, true), /관리자\(사장님\)만/, '점장은 승인 못 해요');

  const t2 = g.gs.mgrForward(MGR, t.requests[0].id, '그날 인원 괜찮아요');
  assert.equal(t2.requests[0].route, '관리자');
  const row = reqRows(g)[0];
  assert.equal(row[10], '관리자');
  assert.equal(row[11], '올림 11/16 15:00 박점장 · 그날 인원 괜찮아요');
  assert.match(sentTo(g, 555).at(-1), /김민우 · 휴무 요청 \(점장 확인\)/);
  assert.match(sentTo(g, 555).at(-1), /점장 박점장: 그날 인원 괜찮아요/);
  assert.throws(() => g.gs.mgrForward(MGR, t.requests[0].id, ''), /이미 관리자에게 올라간/);
  assert.equal(g.gs.getRequests('김민우', '0123').mine[0].route, '관리자', '직원 화면에도 단계가 보여요');

  g.gs.adminRequest('582941', t.requests[0].id, true);
  assert.equal(mark(g, '김민우', '2026-11-18'), '휴무');
  assert.match(sentTo(g, 9002).at(-1), /휴무 요청이 승인됐어요/);
  assert.equal(g.mails.length, 0, '텔레그램이 되면 메일은 안 가요');
});

test('결재: 점장이 돌려보내면 직원에게 이유가 가고, 고쳐서 다시 보낼 수 있어요', () => {
  const g = v3();
  tgOn(g, { 김민우: '9002' });
  g.setKst('2026-11-16 15:00');
  req(g, '김민우', '0123', 'off', { date: '2026-11-18', reason: '병원', offType: '월차' });
  const id = reqRows(g)[0][0];
  assert.throws(() => g.gs.mgrReturn(MGR, id, '  '), /이유를 적어주세요/);
  g.gs.mgrReturn(MGR, id, '그날 교육이라 다른 날로');
  const mine = g.gs.getRequests('김민우', '0123').mine[0];
  assert.equal(mine.state, '돌려보냄');
  assert.equal(mine.mgr, '돌려보냄 11/16 15:00 박점장 · 그날 교육이라 다른 날로');
  assert.match(sentTo(g, 9002).at(-1), /월차 요청을 점장이 돌려보냈어요/);
  assert.match(sentTo(g, 9002).at(-1), /이유: 그날 교육이라 다른 날로/);
  assert.throws(() => g.gs.mgrReturn(MGR, id, '또'), /점장이 돌려보낸 요청/);
  assert.throws(() => g.gs.adminRequest('582941', id, true), /점장이 돌려보낸 요청/);
  req(g, '김민우', '0123', 'off', { date: '2026-11-18', reason: '병원', offType: '월차' });
  assert.equal(reqRows(g).length, 2, '같은 날 다시 보낼 수 있어요');
  assert.equal(g.gs.adminToday('582941').requests.length, 1, '돌려보낸 건 관리자 목록에서 빠져요');
});

test('결재: 관리자에게 바로, 점장 본인 요청, 점장이 알림을 안 켰으면 사장님께도', () => {
  const g = v3({ email: 'owner@example.com' });
  g.setKst('2026-11-16 15:00');
  req(g, '김민우', '0123', 'off', { date: '2026-11-18', reason: '병원', to: 'admin' });
  assert.equal(reqRows(g)[0][10], '관리자');
  assert.match(g.mails.at(-1).subject, /\[왕십리\] 김민우 · 휴무 요청$/);
  assert.match(g.mails.at(-1).body, /사장님 화면에서 승인해주세요/);
  assert.throws(() => g.gs.mgrForward(MGR, reqRows(g)[0][0], ''), /이미 관리자에게/);

  req(g, '박점장', '246813', 'off', { date: '2026-11-19', reason: '개인' });
  assert.equal(reqRows(g)[1][10], '관리자', '점장 본인 요청은 관리자에게');

  req(g, '김민우', '0123', 'off', { date: '2026-11-20', reason: '개인' });
  assert.equal(reqRows(g)[2][10], '점장');
  assert.match(g.mails.at(-1).subject, /\(점장 확인 전\)/);
  assert.match(g.mails.at(-1).body, /박점장 점장이 텔레그램 알림을 안 켜서/);

  req(g, '이지은', '5678', 'off', { date: '2026-11-17', reason: '개인' });
  assert.equal(reqRows(g)[3][10], '관리자', '점장이 없는 매장(가산)은 관리자에게');
});

test('점장 화면: 자기 매장만 보고, 관리자 기능은 막혀요', () => {
  const g = v3();
  g.setKst('2026-11-16 10:07');
  punch(g, '김민우', '0123', 'in');
  g.setKst('2026-11-16 15:00');
  req(g, '이지은', '5678', 'off', { date: '2026-11-17', reason: '개인' });
  const t = g.gs.adminToday(MGR);
  assert.equal(t.requests.length, 0, '다른 매장 요청은 안 보여요');
  assert.deepEqual(Array.from(t.info.stores, (s) => s.name), ['왕십리']);
  assert.equal(t.info.sheetUrl, '', '시트 주소도 안 줘요');
  assert.equal(t.info.role, 'manager');
  const m = g.gs.adminMonth(MGR, '2026-11');
  assert.deepEqual(Array.from(m.staff, (s) => s.name), ['김민우', '박점장']);
  assert.equal(m.staff[0].lateCount, 1);
  assert.equal(m.staff[0].deduct, 0, '점장 화면에는 차감액이 없어요');
  assert.equal(m.noMoney, true);
  assert.equal(g.gs.adminMonth('582941', '2026-11').staff[0].deduct, 1400);
  for (const f of [() => g.gs.adminSetPin(MGR, '김민우', '4321'), () => g.gs.adminResetDevice(MGR, '김민우'),
    () => g.gs.adminDevice(MGR, '김민우', true), () => g.gs.adminExport(MGR, '2026-11'),
    () => g.gs.adminTelegram(MGR, TOKEN), () => g.gs.adminConfirmWishes(MGR, '')]) {
    assert.throws(f, /관리자\(사장님\)만/);
  }
  g.gs.adminSetPlace(MGR, '왕십리', 37.5, 127.0);
  assert.equal(g.gs.stores_()[0].lat, 37.5);
  assert.throws(() => g.gs.adminSetPlace(MGR, '가산', 37.5, 127.0), /점장님 매장만/);
  assert.throws(() => g.gs.adminToday({ name: '김민우', pin: '0123' }), /점장으로 등록돼 있지 않아요/);
  assert.throws(() => g.gs.adminToday({ name: '박점장', pin: '0000' }), /비밀번호가 틀렸어요/);
  assert.equal(suspects(g).at(-1)[2], '점장 화면 비밀번호 틀림');
  assert.equal(g.gs.adminToday('582941').role, 'admin');
});

test('직원 텔레그램 알림 켜기: 링크 → [시작] → 연결 확인. 사장님 연결은 직원 메시지를 건너뛰어요', () => {
  const g = v3();
  assert.throws(() => g.gs.staffTgStart('김민우', '0123'), /아직 텔레그램 알림을 연결하지 않았어요/);
  assert.equal(g.gs.getHome('김민우', '0123').tg, '', '사장님이 봇을 연결하기 전엔 안 보여요');
  const own = g.gs.adminTelegram('582941', TOKEN);
  assert.equal(own.info.tgBot, 'goodphone_test_bot');
  assert.equal(g.gs.getHome('김민우', '0123').tg, 'off');
  assert.throws(() => g.gs.staffTgStart('김민우', '1111'), /비밀번호가 틀렸어요/);
  const s = g.gs.staffTgStart('김민우', '0123');
  assert.match(s.url, /^https:\/\/t\.me\/goodphone_test_bot\?start=g[0-9a-f]{15}$/);
  const code = s.url.split('start=')[1];
  assert.throws(() => g.gs.staffTgCheck('김민우', '0123'), /아직 연결 전이에요/);
  g.tg.updates.push({ update_id: 10, message: { chat: { id: 9002, type: 'private' }, text: '/start ' + code } });
  assert.equal(g.gs.staffTgCheck('김민우', '0123').tg, 'on');
  assert.equal(g.gs.getHome('김민우', '0123').tg, 'on');
  assert.equal(g.gs.staff_().find((p) => p.name === '김민우').tg, '9002');
  assert.match(sentTo(g, 9002).at(-1), /알림 연결 완료/);
  assert.throws(() => g.gs.staffTgCheck('김민우', '0123'), /연결 시간\(30분\)이 지났어요/, '코드는 한 번만');

  // 사장님 연결 확인: 연결 코드가 맞는 메시지만 봐요(같은 때 직원이 봇에게 말을 걸어도 잘못 연결되지 않아요)
  assert.throws(() => g.gs.adminTelegramLink('582941'), /봇에게 온 연결 코드가 없어요/);
  g.tg.updates.push({ update_id: 11, message: { chat: { id: 555, type: 'private' }, text: '/start ' + own.code } });
  g.tg.updates.push({ update_id: 12, message: { chat: { id: 9002, type: 'private' }, text: '고마워요' } });
  g.tg.updates.push({ update_id: 13, message: { chat: { id: 9007, type: 'private' }, text: '/start' } });
  g.tg.updates.push({ update_id: 14, message: { chat: { id: 9008, type: 'private' }, text: '/start g0123456789abcde' } });
  assert.equal(g.gs.adminTelegramLink('582941').tg, '연결됨');
  assert.equal(setting(g, '텔레그램채팅ID'), '555');
  assert.throws(() => g.gs.adminTelegramLink('582941'), /연결 코드 시간/, '코드는 한 번만');
  // 단톡방: 봇을 초대하고 그 방에 '/start@봇이름 코드'
  const code2 = g.gs.adminTelegramCode('582941').code;
  g.tg.updates.push({ update_id: 15, message: { chat: { id: -100777, type: 'group' }, text: '/start@goodphone_test_bot ' + code2 } });
  assert.equal(g.gs.adminTelegramLink('582941').tg, '연결됨');
  assert.equal(setting(g, '텔레그램채팅ID'), '-100777');

  assert.equal(g.gs.staffTgOff('김민우', '0123').tg, 'off');
  assert.equal(g.gs.getHome('김민우', '0123').tg, 'off');
  g.gs.adminTelegramOff('582941');
  assert.equal(setting(g, '텔레그램봇'), '');
});

test('직원 알림: 대타 구함은 같은 매장 동료에게, 수락·승인 결과는 당사자에게', () => {
  const g = v3();
  tgOn(g, { 김민우: '9002', 박점장: '9005', 이지은: '9003' });
  g.setKst('2026-11-16 15:00');
  req(g, '김민우', '0123', 'swap', { date: '2026-11-18', to: 'admin' });
  assert.match(sentTo(g, 9005).at(-1), /동료가 대타를 구해요/);
  assert.match(sentTo(g, 9005).at(-1), /11\/18\(수\) 10:00-20:00 · 김민우 님 대신/);
  assert.equal(sentTo(g, 9003).length, 0, '다른 매장(가산) 직원에게는 안 가요');
  const id = reqRows(g)[0][0];
  g.gs.takeSwap('박점장', '246813', id);
  assert.match(sentTo(g, 9002).at(-1), /대타를 구했어요/);
  assert.match(sentTo(g, 555).at(-1), /대타 수락 · 승인해주세요/);
  g.gs.adminRequest('582941', id, true);
  assert.match(sentTo(g, 9002).at(-1), /대타 요청이 승인됐어요/);
  assert.match(sentTo(g, 9005).at(-1), /대타가 승인됐어요/);
  assert.match(sentTo(g, 9005).at(-1), /근무가 확정됐어요/);
});

test('출근 알림: 텔레그램을 켠 직원에게 출근 20분 전 한 번, 안 찍으면 본인에게도', () => {
  const g = v3({ email: 'owner@example.com' });
  tgOn(g, { 김민우: '9002' });
  g.setKst('2026-11-16 09:35');
  g.gs.checkMissing();
  assert.equal(sentTo(g, 9002).length, 0, '25분 전이라 아직');
  g.setKst('2026-11-16 09:45');
  g.gs.checkMissing();
  assert.match(sentTo(g, 9002).at(-1), /곧 출근이에요/);
  assert.match(sentTo(g, 9002).at(-1), /오늘 10:00 출근 \(왕십리\)/);
  g.setKst('2026-11-16 09:55');
  g.gs.checkMissing();
  assert.equal(sentTo(g, 9002).length, 1, '한 번만');
  g.setKst('2026-11-16 10:15');
  g.gs.checkMissing();
  assert.match(sentTo(g, 9002).at(-1), /아직 출근을 안 찍었어요/);
  assert.match(sentTo(g, 555).at(-1), /아직 출근 안 찍은 직원 2명/);
  // 0으로 바꾸면 출근 전 알림은 안 가요
  g.gs.setSetting_('출근전알림(분)', '0');
  g.setKst('2026-11-17 09:45');
  g.gs.checkMissing();
  assert.equal(sentTo(g, 9002).length, 2);
});

test('하루 마감 정리: 23:30 뒤 한 번. 결근?·퇴근 안 찍음·요약, 정정 승인하면 결근?이 바뀌어요', () => {
  const g = v3({ email: 'owner@example.com' });
  tgOn(g, { 이지은: '9003' });
  g.setKst('2026-11-16 12:03');
  punch(g, '이지은', '5678', 'in');
  g.setKst('2026-11-16 09:58');
  punch(g, '박점장', '246813', 'in');
  g.setKst('2026-11-16 20:01');
  punch(g, '박점장', '246813', 'out');
  g.setKst('2026-11-16 21:00');
  req(g, '최유나', '1357', 'fix', { date: '2026-11-16', type: 'in', time: '12:00', reason: '깜빡' });
  g.setKst('2026-11-16 23:10');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민우', '2026-11-16'), '', '23:30 전에는 정리 안 해요');
  g.setKst('2026-11-16 23:35');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민우', '2026-11-16'), '결근?');
  assert.equal(mark(g, '최유나', '2026-11-16'), '', '그날 요청을 보낸 사람은 빼요');
  assert.equal(mark(g, '박점장', '2026-11-16'), '');
  const sum = g.tg.sent.find((m) => String(m.chat_id) === '555' && /하루 마감 정리/.test(m.text));
  assert.ok(sum);
  assert.equal(sum.disable_notification, true, '밤이라 소리 없이');
  assert.match(sum.text, /11\/16\(월\) · 출근 2명/);
  assert.match(sum.text, /결근\? \(기록 없음\) 1명 → 휴무표에 "결근\?"으로 적었어요\n\[왕십리\] 김민우 \(예정 10:00\)/);
  assert.match(sum.text, /퇴근 안 찍음 1명\n\[가산\] 이지은 \(출근 12:03\)/);
  assert.match(sentTo(g, 9003).at(-1), /퇴근을 안 찍었어요/);
  const n = g.tg.sent.length;
  g.setKst('2026-11-16 23:45');
  g.gs.checkMissing();
  g.setKst('2026-11-17 02:00');
  g.gs.checkMissing();
  assert.equal(g.tg.sent.length, n, '한 번만');

  g.setKst('2026-11-17 10:00');
  req(g, '김민우', '0123', 'fix', { date: '2026-11-16', type: 'in', time: '10:05', reason: '폰 배터리' });
  g.gs.adminRequest('582941', reqRows(g).at(-1)[0], true);
  assert.equal(mark(g, '김민우', '2026-11-16'), '10:05', '결근?이 지각 시간으로 바뀌어요');
});

test('하루 마감 정리: 밤에 못 돌았으면 새벽에 어제 것을 해요', () => {
  const g = v3({ email: 'owner@example.com' });
  g.setKst('2026-11-17 00:50');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민우', '2026-11-16'), '결근?');
  assert.match(g.mails.at(-1).subject, /하루 마감 정리/);
  assert.match(g.mails.at(-1).body, /11\/16\(월\)/);
});

test('대체휴무: 쉬는 날 출근하면 쌓이고(반차 날은 빼요), 신청·승인하면 휴무표에 대체로 적고 써요', () => {
  const g = v3({ email: 'owner@example.com' });
  // 11/21(토): 김민우는 [직원] 토요일 칸이 휴무
  g.setKst('2026-11-21 10:00');
  punch(g, '김민우', '0123', 'in');
  g.setKst('2026-11-21 19:00');
  punch(g, '김민우', '0123', 'out');
  g.gs.setMark_('2026-11-21', '박점장', () => '반차');
  g.setKst('2026-11-21 15:00');
  punch(g, '박점장', '246813', 'in');
  g.setKst('2026-11-21 20:00');
  punch(g, '박점장', '246813', 'out');
  g.setKst('2026-11-21 23:40');
  g.gs.checkMissing();
  const sub = g.sheet('대체휴무');
  assert.equal(sub.getLastRow(), 2, '김민우만 (박점장은 반차라 빼요)');
  assert.deepEqual(plain(sub.rowDisplay(2).slice(0, 4)), ['2026-11-21', '김민우', '적립', '1']);
  assert.match(sub.rowDisplay(2)[4], /휴무날 출근 9시간/);
  assert.match(g.mails.at(-1).body, /쉬는 날 출근 1명 → 대체휴무로 쌓았어요\n\[왕십리\] 김민우 9시간/);

  g.setKst('2026-11-22 10:00');
  assert.equal(g.gs.getSchedule('김민우', '0123', '2026-11').sum.sub, 1);
  req(g, '김민우', '0123', 'off', { offType: '대체', date: '2026-11-25', reason: '주말 근무 대신', to: 'admin' });
  assert.throws(() => req(g, '김민우', '0123', 'off', { offType: '대체', date: '2026-11-26', reason: '또' }),
    /쓸 수 있는 대체휴무가 없어요. \(남은 대체휴무 1일, 이미 신청한 1일\)/);
  g.gs.adminRequest('582941', reqRows(g).at(-1)[0], true);
  assert.equal(mark(g, '김민우', '2026-11-25'), '대체');
  assert.deepEqual(plain(sub.rowDisplay(3).slice(1, 4)), ['김민우', '사용', '1']);
  assert.equal(g.gs.getSchedule('김민우', '0123', '2026-11').sum.sub, 0);
  assert.equal(g.gs.adminToday('582941').devices.find((d) => d.name === '김민우').sub, 0);
  g.setKst('2026-11-25 10:30');
  assert.equal(g.gs.getToday('김민우').sIn, '', '대체로 쉬는 날은 근무 없음');
});

test('대체휴무 쌓기 설정: 휴무날·공휴일이면 공휴일 출근도(4시간 미만 0.5일), 안함이면 안 쌓아요', () => {
  const g = v3();
  g.gs.setSetting_('공휴일추가', '2026-11-18 회사창립일');
  g.setKst('2026-11-18 10:00');
  punch(g, '김민우', '0123', 'in');
  g.setKst('2026-11-18 13:00');
  punch(g, '김민우', '0123', 'out');
  g.setKst('2026-11-18 23:40');
  g.gs.checkMissing();
  assert.equal(g.sheet('대체휴무').getLastRow(), 1, '기본(휴무날만)은 공휴일 출근을 안 쌓아요');

  g.gs.setSetting_('공휴일추가', '2026-11-19 회사창립일');
  g.gs.setSetting_('대체휴무적립', '휴무날·공휴일');
  g.setKst('2026-11-19 10:00');
  punch(g, '김민우', '0123', 'in');
  g.setKst('2026-11-19 13:00');
  punch(g, '김민우', '0123', 'out');
  g.setKst('2026-11-19 23:40');
  g.gs.checkMissing();
  assert.deepEqual(plain(g.sheet('대체휴무').rowDisplay(2).slice(0, 4)), ['2026-11-19', '김민우', '적립', '0.5']);
  assert.match(g.sheet('대체휴무').rowDisplay(2)[4], /공휴일\(회사창립일\) 출근 3시간/);

  g.gs.setSetting_('대체휴무적립', '안함');
  g.setKst('2026-11-21 10:00');
  punch(g, '김민우', '0123', 'in');
  g.setKst('2026-11-21 23:40');
  g.gs.checkMissing();
  assert.equal(g.sheet('대체휴무').getLastRow(), 2, '안함이면 쉬는 날 출근도 안 쌓아요');
});

test('공휴일: 휴무표 머리글을 빨갛게, 요일 칸 메모로 이름. 설정으로 더하고 빼요', () => {
  const g = v3();
  const dec = g.sheet('휴무표 2026-12');
  const col = (d) => 10 + d; // K열 = 1일
  assert.equal(dec.notes['2,' + col(25)], '12/25(금) 성탄절');
  assert.equal(dec.colors['1,' + col(25)], '#dc2626');
  assert.equal(dec.colors['2,' + col(25)], '#dc2626');
  assert.equal(dec.colors['1,' + col(26)], '#2563eb', '토요일은 파랑');
  assert.equal(dec.colors['1,' + col(24)], '#000000');
  g.gs.setSetting_('공휴일추가', '2026-12-31 회사휴무, 2026. 12. 24');
  g.gs.setSetting_('공휴일제외', '2026-12-25');
  g.gs.setup();
  assert.equal(dec.notes['2,' + col(25)], undefined, '뺀 공휴일은 메모도 지워져요');
  assert.equal(dec.colors['1,' + col(25)], '#000000');
  assert.equal(dec.notes['2,' + col(31)], '12/31(목) 회사휴무');
  assert.equal(dec.notes['2,' + col(24)], '12/24(목) 휴일');
  assert.ok(dec.notes['1,' + col(1)].includes('결근?'), '1일 머리글 메모(칸에 쓰는 말)는 그대로');
  g.setKst('2026-11-20 10:00');
  assert.deepEqual(plain(g.gs.getSchedule('김민우', '0123', '2026-12').holidays), { '2026-12-24': '휴일', '2026-12-31': '회사휴무' });
  assert.equal(g.gs.adminToday('582941').holiday, '');
  g.setKst('2026-12-31 10:00');
  assert.equal(g.gs.adminToday('582941').holiday, '회사휴무');
});

test('근무표 보기: 우리 매장 쉬는 날·대타는 보이고, 남의 지각·결근?은 안 보여요', () => {
  const g = v3();
  const nov = g.sheet('휴무표 2026-11');
  const put = (n, d, v) => nov.getRange(monthRowOf(g, '2026-11', n).r, 10 + d).setValue(v);
  put('박점장', 18, '휴무');
  put('박점장', 17, '결근?');
  put('박점장', 19, '10:12');
  put('박점장', 20, '대타 10:05');
  put('김민우', 16, '10:07');
  put('김민우', 23, '월차');
  put('김민우', 24, '반차');
  put('김민우', 25, '휴무');
  nov.getRange(monthRowOf(g, '2026-11', '김민우').r, 8).setValue('2'); // 잔여(시트에서는 수식 결과)
  g.setKst('2026-11-19 10:00');
  const s = g.gs.getSchedule('김민우', '0123', '');
  assert.equal(s.ym, '2026-11');
  assert.equal(s.days, 30);
  assert.equal(s.firstDow, 0, '11/1 일요일');
  assert.equal(s.store, '왕십리');
  assert.equal(s.me[15], '지각', '내 지각은 "지각"으로');
  assert.equal(s.me[20], '쉼', '토요일은 [직원] 요일 칸 휴무');
  assert.deepEqual(Array.from(s.others, (o) => o.name), ['박점장'], '같은 매장만');
  const park = s.others[0];
  assert.equal(park.days[17], '쉼', "동료의 쉬는 날은 종류 없이 '쉼'으로");
  assert.equal(park.days[16], '', '남의 결근?은 안 보여요');
  assert.equal(park.days[18], '', '남의 지각 시간도');
  assert.equal(park.days[19], '대타');
  assert.equal(s.count[17], 1, '11/18 쉬는 사람 1명');
  assert.equal(s.count[20], 1, '11/21 토요일 김민우 정기 휴무');
  assert.equal(s.sum.off, 1.5, '휴무 1 + 반차 0.5');
  assert.equal(s.sum.monthly, 1);
  assert.equal(s.sum.monthlyLeft, 2);
  assert.equal(s.wish, null, '이번 달은 고르기 없음');
  assert.throws(() => g.gs.getSchedule('김민우', '0123', '2027-02'), /지난달·이번 달·다음 달만/);
  assert.throws(() => g.gs.getSchedule('김민우', '9999', ''), /비밀번호가 틀렸어요/);
});

test('다음 달 휴무 고르기: 기간·하루 인원·한 달 일수·금지일 규칙, 사장님이 확정', () => {
  const g = v3();
  g.setKst('2026-11-19 10:00');
  assert.throws(() => g.gs.wishDay('김민우', '0123', '2026-12-08', true), /12월 휴무는 11\/20~11\/25에만 고를 수 있어요/);
  assert.equal(g.gs.getSchedule('김민우', '0123', '2026-12').wish.open, false);
  g.setKst('2026-11-20 10:00');
  assert.throws(() => g.gs.wishDay('김민우', '0123', '2026-11-28', true), /다음 달\(12월\) 날짜만/);
  const s = g.gs.wishDay('김민우', '0123', '2026-12-08', true);
  assert.equal(mark(g, '김민우', '2026-12-08'), '휴무?');
  assert.equal(s.me[7], '휴무?');
  assert.equal(s.sum.wishes, 1);
  assert.equal(s.wish.open, true);
  assert.equal(s.wish.maxOff, 1);
  assert.equal(g.gs.wishDay('김민우', '0123', '2026-12-08', true).sum.wishes, 1, '두 번 눌러도 그대로');

  assert.throws(() => g.gs.wishDay('박점장', '246813', '2026-12-08', true), /12\/08\(화\)은 이미 김민우 님이 쉬어요. \(왕십리 하루 최대 1명\)/);
  g.gs.wishDay('이지은', '5678', '2026-12-08', true); // 다른 매장은 상관없어요
  g.sheet('매장').getRange(2, 9).setValue('2'); // 왕십리 최대휴무 2명
  g.gs.wishDay('박점장', '246813', '2026-12-08', true);

  g.sheet('매장').getRange(2, 10).setValue('2'); // 왕십리 월휴무 2일
  g.gs.wishDay('김민우', '0123', '2026-12-09', true);
  assert.throws(() => g.gs.wishDay('김민우', '0123', '2026-12-10', true), /한 달에 휴무는 2일까지/);
  g.gs.wishDay('김민우', '0123', '2026-12-09', false);
  assert.equal(mark(g, '김민우', '2026-12-09'), '');

  g.gs.setSetting_('휴무금지일', '12/24, 2026-12-31');
  assert.throws(() => g.gs.wishDay('김민우', '0123', '2026-12-24', true), /휴무를 고를 수 없는 날/);
  assert.throws(() => g.gs.wishDay('김민우', '0123', '2026-12-31', true), /휴무를 고를 수 없는 날/);
  assert.throws(() => g.gs.wishDay('김민우', '0123', '2026-12-05', true), /원래 쉬는 날/);
  g.gs.setMark_('2026-12-15', '김민우', () => '월차');
  assert.throws(() => g.gs.wishDay('김민우', '0123', '2026-12-15', true), /이미 "월차"/);
  assert.deepEqual(plain(g.gs.getSchedule('김민우', '0123', '2026-12').wish.blocked), [24, 31]);

  const w = g.gs.adminWishes('582941');
  const ws = w.stores.find((x) => x.name === '왕십리');
  assert.deepEqual(plain(ws.rows.find((r) => r.name === '김민우').wish), [8]);
  assert.equal(ws.wishes, 2);
  assert.equal(ws.over.length, 0);
  g.sheet('매장').getRange(2, 9).setValue('1');
  assert.deepEqual(plain(g.gs.adminWishes('582941').stores[0].over), [{ day: 8, dow: '화', names: ['김민우', '박점장'] }], '하루 최대를 넘는 날');
  assert.deepEqual(Array.from(g.gs.adminWishes(MGR).stores, (x) => x.name), ['왕십리'], '점장은 자기 매장만');
  const c = g.gs.adminConfirmWishes('582941', '왕십리');
  assert.equal(c.confirmed, 2);
  assert.equal(mark(g, '김민우', '2026-12-08'), '휴무');
  assert.equal(mark(g, '박점장', '2026-12-08'), '휴무');
  assert.equal(mark(g, '이지은', '2026-12-08'), '휴무?', '가산은 그대로');
  assert.equal(mark(g, '김민우', '2026-12-15'), '월차', '다른 칸은 그대로');
  assert.throws(() => g.gs.wishDay('김민우', '0123', '2026-12-08', false), /확정된 거라 앱에서 못 빼요/);

  g.setKst('2026-11-26 10:00');
  assert.throws(() => g.gs.wishDay('김민우', '0123', '2026-12-11', true), /고를 기간이 지났어요/);
  g.gs.setSetting_('휴무신청기간', '');
  g.gs.wishDay('김민우', '0123', '2026-12-11', true);
  assert.equal(mark(g, '김민우', '2026-12-11'), '휴무?', '기간을 비우면 언제든');
});

test('휴무 요청 승인 화면: 그날 같은 매장에 이미 쉬는 사람을 알려줘요', () => {
  const g = v3();
  g.setKst('2026-11-16 15:00');
  g.gs.setMark_('2026-11-18', '박점장', () => '휴무');
  req(g, '김민우', '0123', 'off', { date: '2026-11-18', reason: '병원' });
  const q = g.gs.adminToday('582941').requests[0];
  assert.equal(q.note, '그날 왕십리는 이미 박점장 님이 쉬어요 (하루 최대 1명을 넘어요)');
  assert.equal(q.store, '왕십리');
  assert.deepEqual(plain(q.managers), ['박점장']);
});

test('예전 시트에 setup: [매장] 점장·최대휴무·월휴무 칸, [요청] 보낼곳·점장확인 머리글, [대체휴무] 탭', () => {
  const g = createGas({ now: Date.parse('2026-11-16T09:00:00+09:00') });
  const st = g.book.insertSheet('매장');
  st.getRange(1, 1, 2, 7).setValues([['매장', '출근', '퇴근', '위도', '경도', '반경(m)', '메모'], ['본점', '11:00', '', '', '', '', '']]);
  const rq = g.book.insertSheet('요청');
  rq.getRange(1, 1, 2, 10).setValues([['번호', '요청일시', '이름', '종류', '날짜', '내용', '사유', '상태', '대타', '처리일시'],
    ['R1', '2026-11-15 10:00', '예시직원', '휴무', '2026-11-20', '11:00-', '개인', '대기', '', '']]);
  g.gs.setup();
  assert.deepEqual(plain(st.rowDisplay(1).slice(7, 10)), ['점장', '최대휴무', '월휴무']);
  assert.match(st.notes['1,8'], /점장 이름/);
  assert.deepEqual(plain(rq.rowDisplay(1).slice(10, 12)), ['보낼곳', '점장확인']);
  assert.ok(g.sheet('대체휴무'));
  g.gs.setSetting_('관리자PIN', '582941');
  const t = g.gs.adminToday('582941');
  assert.equal(t.requests.length, 1);
  assert.equal(t.requests[0].route, '관리자', '예전 요청(보낼곳 빈칸)은 관리자에게');
  // [매장] 칸 순서를 바꿔도 머리글로 읽어요
  st.getRange(1, 1, 2, 3).setValues([['출근', '매장', '퇴근'], ['10:30', '본점', '19:00']]);
  g.gs.MEMO_ = {};
  assert.equal(g.gs.stores_()[0].name, '본점');
  assert.equal(g.gs.stores_()[0].open, 630);
});

test('하루 마감 정리: 근무시간이 안 정해진 사람·고른 휴무(휴무?)에 출근하면 대체휴무를 안 쌓고, 공휴일엔 결근?을 안 적어요', () => {
  const g = v3({ email: 'owner@example.com' });
  // 사무실: [매장] 출근 시간 없음 + [직원] 요일 칸 비어 있음 = 시간 미정 (쉬는 날 아님)
  g.sheet('매장').getRange(4, 1, 1, 7).setValues([['사무실', '', '', '', '', '', '']]);
  g.sheet('직원').getRange(7, 1, 1, 14).setValues([['오사무', '사무실', '8080', 10320, '', '', '', '', '', '', '', '', '', '']]);
  hrFill(g, ['오사무']);
  g.gs.setup();
  g.gs.setSetting_('위치확인', '안함');
  g.gs.setMark_('2026-11-17', '박점장', () => '휴무?');
  g.setKst('2026-11-17 11:00');
  punch(g, '오사무', '8080', 'in', null, 'gggggggggggggggg');
  punch(g, '박점장', '246813', 'in');
  g.setKst('2026-11-17 19:00');
  punch(g, '오사무', '8080', 'out', null, 'gggggggggggggggg');
  punch(g, '박점장', '246813', 'out');
  g.setKst('2026-11-17 23:40');
  g.gs.checkMissing();
  assert.equal(g.sheet('대체휴무').getLastRow(), 1, '시간 미정·휴무?는 쉬는 날로 안 봐요');
  assert.doesNotMatch(g.mails.at(-1).body, /쉬는 날 출근/);

  // 공휴일: 기록이 없어도 결근?을 안 적고 요약에만
  g.gs.setSetting_('공휴일추가', '2026-11-18 회사창립일');
  g.setKst('2026-11-18 23:40');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민우', '2026-11-18'), '', '공휴일엔 매장이 쉬었을 수도 있어서 안 적어요');
  assert.match(g.mails.at(-1).body, /11\/18\(수\) 회사창립일 · 출근 0명/);
  assert.match(g.mails.at(-1).body, /공휴일에 아무도 출근 안 한 매장이라 결근\?으로 안 적음 \d명\n\[왕십리\] 김민우/);

  // 공휴일이어도 그 매장에 출근한 사람이 있으면 연 날로 봐서 평소처럼 적어요
  g.gs.setSetting_('공휴일추가', '2026-11-18 회사창립일, 2026-11-19 임시공휴일');
  g.setKst('2026-11-19 10:02');
  punch(g, '박점장', '246813', 'in');
  g.setKst('2026-11-19 23:40');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민우', '2026-11-19'), '결근?', '왕십리는 박점장이 출근해서 연 날');
  assert.equal(mark(g, '이지은', '2026-11-19'), '', '가산은 아무도 안 와서 쉰 날일 수 있어요');
});

/* ───── 테스트·휴무표 도구 ───── */

test('휴무표 만들기: 원하는 달을 바로 만들고(사이 달도 같이), 이미 있으면 빠진 직원만 넣어요', () => {
  const g = v3();
  g.setKst('2026-11-19 10:00');
  assert.ok(!g.sheet('휴무표 2027-02'));
  const r = g.gs.adminMakeMonth('582941', '2027.2');
  assert.equal(r.name, '휴무표 2027-02');
  assert.equal(r.created, true);
  assert.deepEqual(plain(r.made), ['휴무표 2027-01', '휴무표 2027-02'], '사이 달(1월)도 같이 만들어서 월차 이월이 이어져요');
  assert.equal(r.staff, 4);
  assert.equal(r.holidays, 4, '설 연휴 2/6~2/9');
  assert.match(r.url, /#gid=\d+$/);
  const row = monthRowOf(g, '2027-02', '김민우').r;
  assert.match(String(g.sheet('휴무표 2027-02').getRange(row, 6).getValues()[0][0]), /'휴무표 2027-01'/);
  assert.equal(g.sheet('휴무표 2027-02').notes['2,' + (10 + 7)], '02/07(일) 설날');
  // 열 너비(묶어서 보내도 칸마다 같은 너비) · 2월에 없는 29~31일은 머리글부터 회색
  const feb = g.sheet('휴무표 2027-02');
  assert.deepEqual([1, 2, 3, 4, 9, 10, 11, 41, 42].map((c) => feb.widths[c]), [36, 80, 70, 52, 52, 110, 46, 46, 220]);
  assert.ok(feb.bgs.some((b) => b.r === 1 && b.c === 10 + 29 && b.nc === 3 && b.color === '#e5e7eb'), '29·30·31일 칸 회색');
  assert.ok(!feb.bgs.some((b) => b.r === 1 && b.c <= 10 + 28 && b.color === '#e5e7eb'), '28일까지는 회색 아님');
  g.sheet('직원').getRange(7, 1, 1, 2).setValues([['신입', '왕십리']]);
  const r2 = g.gs.adminMakeMonth('582941', '2027-02');
  assert.equal(r2.created, false);
  assert.equal(r2.added, 1, '이미 있으면 빠진 직원만');
  assert.ok(monthRowOf(g, '2027-02', '신입'));
  assert.throws(() => g.gs.adminMakeMonth('582941', '2028-01'), /앞뒤 12달/);
  assert.throws(() => g.gs.adminMakeMonth('582941', 'abc'), /달을 골라주세요/);
  assert.throws(() => g.gs.adminMakeMonth(MGR, '2027-01'), /관리자\(사장님\)만/);
});

test('마감 정리 미리 보기: 휴무표·장부를 안 바꾸고 아무에게도 안 보내요. 원하면 사장님 알림으로 받아요', () => {
  const g = v3({ email: 'owner@example.com' });
  g.setKst('2026-11-16 12:03');
  punch(g, '이지은', '5678', 'in');
  g.setKst('2026-11-16 22:00');
  const r = g.gs.adminClosePreview('582941', 'today', false);
  assert.equal(r.date, '2026-11-16');
  assert.match(r.text, /결근\? \(기록 없음\) \d명/);
  assert.match(r.text, /퇴근 안 찍음 1명\n\[가산\] 이지은 \(출근 12:03\)/);
  assert.equal(mark(g, '김민우', '2026-11-16'), '', '미리 보기는 휴무표를 안 바꿔요');
  assert.equal(g.mails.length, 0, '아무에게도 안 보내요');
  assert.equal(r.done, false);
  assert.equal(g.gs.adminClosePreview('582941', 'today', true).via, '메일');
  assert.match(g.mails.at(-1).subject, /\[미리 보기\] 하루 마감 정리/);
  // 쉬는 날 출근도 장부에 안 적어요
  g.setKst('2026-11-21 10:00');
  punch(g, '김민우', '0123', 'in');
  g.setKst('2026-11-21 19:00');
  punch(g, '김민우', '0123', 'out');
  assert.match(g.gs.adminClosePreview('582941', 'today', false).text, /쉬는 날 출근 1명 → 대체휴무로 쌓아요/, '미리 보기는 "쌓아요"');
  assert.equal(g.sheet('대체휴무').getLastRow(), 1);
  // 진짜 정리는 그대로 23:30에
  g.setKst('2026-11-21 23:40');
  g.gs.checkMissing();
  assert.equal(g.sheet('대체휴무').getLastRow(), 2);
  g.setKst('2026-11-22 09:00');
  const y = g.gs.adminClosePreview('582941', 'yesterday', false);
  assert.equal(y.date, '2026-11-21');
  assert.equal(y.done, true, '어제 것은 이미 정리됐다고 알려줘요');
  assert.throws(() => g.gs.adminClosePreview(MGR, 'today'), /관리자\(사장님\)만/);
});

test('알림 시험: 텔레그램이 되면 텔레그램, 아니면 메일, 둘 다 없으면 안내', () => {
  const g = v3();
  assert.throws(() => g.gs.adminNotifyTest('582941'), /알림 받을 곳이 없어요/);
  g.gs.setSetting_('알림이메일', 'owner@example.com');
  assert.equal(g.gs.adminNotifyTest('582941').via, '메일');
  tgOn(g);
  assert.equal(g.gs.adminNotifyTest('582941').via, '텔레그램');
  assert.match(sentTo(g, 555).at(-1), /시험 알림/);
  g.gs.setSetting_('알림이메일', '');
  g.tg.down = true;
  assert.throws(() => g.gs.adminNotifyTest('582941'), /텔레그램으로 못 보냈어요/);
  assert.throws(() => g.gs.adminNotifyTest(MGR), /관리자\(사장님\)만/);
});

test('휴무 고르기 오늘만 열기: 기간 전에도 오늘은 고를 수 있고, 다음 날이면 다시 닫혀요', () => {
  const g = v3();
  g.setKst('2026-11-10 10:00');
  assert.throws(() => g.gs.wishDay('김민우', '0123', '2026-12-08', true), /11\/20~11\/25에만/);
  const w = g.gs.adminWishOpen('582941', true);
  assert.equal(w.open, true);
  assert.equal(w.forced, true);
  g.gs.wishDay('김민우', '0123', '2026-12-08', true);
  assert.equal(mark(g, '김민우', '2026-12-08'), '휴무?');
  assert.equal(g.gs.getHome('김민우', '0123').wish.open, true, '직원 화면에도 열려요');
  g.setKst('2026-11-11 10:00');
  assert.throws(() => g.gs.wishDay('김민우', '0123', '2026-12-09', true), /11\/20~11\/25에만/, '다음 날은 다시 닫혀요');
  g.gs.checkMissing();
  assert.equal(g.gs.PropertiesService.getScriptProperties().getProperty('wishOpen:2026-11-10'), null, '지난 날 표시는 저절로 지워져요');
  g.setKst('2026-11-11 10:30');
  g.gs.adminWishOpen('582941', true);
  g.gs.adminWishOpen('582941', false);
  assert.throws(() => g.gs.wishDay('김민우', '0123', '2026-12-09', true), /에만 고를 수 있어요/, '닫기');
  assert.throws(() => g.gs.adminWishOpen(MGR, true), /관리자\(사장님\)만/);
});

test('테스트 직원: 어디서든 폰 등록 없이 찍히고, 월별·정산에서 빠지고, [테스트 지우기]로 기록까지 지워져요', () => {
  const g = v3({ email: 'owner@example.com' });
  g.setKst('2026-11-16 09:58');
  punch(g, '김민우', '0123', 'in'); // 김민우 폰 등록
  const t = g.gs.adminTestStaff('582941', '가산');
  assert.ok(t.list.some((p) => p.name === '테스트' && p.store === '가산'));
  assert.equal(g.gs.getStaffList().staff.find((p) => p.name === '테스트').test, true);
  assert.ok(monthRowOf(g, '2026-11', '테스트'));
  assert.ok(monthRowOf(g, '2026-12', '테스트'));
  // 멀리서, 김민우 폰으로 찍어도 돼요(테스트 직원은 폰 등록·위치 확인을 안 해요)
  g.setKst('2026-11-16 12:05');
  const r = punch(g, '테스트', '2580', 'in', FAR, PHONE.김민우);
  assert.equal(r.late, 5);
  assert.equal(r.place, '테스트(위치 확인 안 함)');
  assert.equal(g.gs.staff_().find((p) => p.name === '테스트').device, '', '폰이 묶이지 않아요');
  assert.equal(g.gs.staff_().find((p) => p.name === '김민우').deviceId, PHONE.김민우, '김민우 폰도 그대로');
  req(g, '테스트', '2580', 'off', { date: '2026-11-18', reason: '시험' });
  g.gs.addSub_('2026-11-14', '테스트', '적립', 1, '시험');
  g.gs.addChange_('2026-11-20', '테스트', '13:00-21:00', '시험');
  g.gs.logSuspect_('테스트', '시험', '시험');
  assert.ok(!g.gs.adminMonth('582941', '2026-11').staff.some((s) => s.name === '테스트'), '월별·정산에서 빠져요');
  assert.ok(g.gs.adminToday('582941').list.some((p) => p.name === '테스트'), '오늘 화면에는 보여요');

  const c = g.gs.adminTestClear('582941');
  assert.equal(c.removed, 8, '기록 1 + 요청 1 + 근무변경 1 + 의심기록 1 + 대체휴무 1 + 휴무표 2 + 직원 1');
  assert.ok(!c.list.some((p) => p.name === '테스트'));
  assert.ok(!monthRowOf(g, '2026-11', '테스트'));
  assert.ok(!monthRowOf(g, '2026-12', '테스트'));
  for (const [tab, col] of [['출퇴근기록', 2], ['요청', 2], ['근무변경', 1], ['의심기록', 1], ['대체휴무', 1], ['직원', 0]]) {
    const sh = g.sheet(tab);
    for (let i = 2; i <= sh.getLastRow(); i++) assert.notEqual(sh.rowDisplay(i)[col], '테스트', tab);
  }
  const log = g.sheet('출퇴근기록');
  assert.equal(log.getLastRow(), 2, '다른 사람 기록은 그대로');
  assert.deepEqual(plain(log.rowDisplay(2).slice(2, 6)), ['김민우', '10:00', '20:00', '09:58']);
  assert.equal(g.gs.staff_().length, 5, '직원 5명(퇴사자 포함)은 그대로');
  assert.throws(() => g.gs.adminTestStaff(MGR, '왕십리'), /관리자\(사장님\)만/);
  assert.throws(() => g.gs.adminTestClear(MGR), /관리자\(사장님\)만/);
});

/* ───── 코드 검토에서 나온 것 ───── */

test('검토: 없는 날짜(12/32)는 휴무 고르기·요청에서 거절되고, 휴무표 메모 칸은 안 건드려요', () => {
  const g = v3();
  g.setKst('2026-11-20 10:00');
  const dec = g.sheet('휴무표 2026-12');
  const r = monthRowOf(g, '2026-12', '김민우').r;
  dec.getRange(r, 41).setValue('사장님 메모');
  assert.throws(() => g.gs.wishDay('김민우', '0123', '2026-12-32', true), /다음 달\(12월\) 날짜만/);
  assert.throws(() => req(g, '김민우', '0123', 'off', { date: '2026-11-31', reason: 'x' }), /날짜를 골라주세요/);
  assert.equal(dec.rowDisplay(r)[40], '사장님 메모');
  assert.equal(g.gs.parseDate_('2026-02-30'), '');
  assert.equal(g.gs.parseDate_('2026. 2. 28'), '2026-02-28');
  g.gs.setMark_('2026-12-32', '김민우', () => '휴무?');
  assert.equal(dec.rowDisplay(r)[40], '사장님 메모', '휴무표 쓰기도 날짜 칸 밖은 안 건드려요');
});

test('검토: "대체근무 12-21"처럼 근무를 적은 건 쉬는 날이 아니에요("대체"만 적힌 칸만 대체휴무)', () => {
  const g = v3();
  g.gs.addChange_('2026-11-17', '김민우', '대체근무 12:00-21:00', '');
  g.setKst('2026-11-17 12:20');
  assert.equal(punch(g, '김민우', '0123', 'in').late, 20, '근무로 봐서 지각이 계산돼요');
  g.setKst('2026-11-17 23:40');
  g.gs.checkMissing();
  assert.equal(g.sheet('대체휴무').getLastRow(), 1, '근무한 날이라 대체휴무로 안 쌓아요');
  g.gs.setMark_('2026-11-19', '박점장', () => '대체');
  g.setKst('2026-11-19 09:00');
  assert.equal(g.gs.getToday('박점장').sIn, '', '"대체"만 적힌 날은 쉬는 날');
});

test('검토: 점장이 두 명인 매장에서도 점장은 자기 요청·자기가 맡은 대타를 처리 못 해요', () => {
  const g = v3({ email: 'owner@example.com' });
  g.sheet('매장').getRange(2, 8).setValue('박점장, 김민우');
  g.gs.adminSetPin('582941', '김민우', '012345'); // 점장 화면은 6자리
  g.setKst('2026-11-16 15:00');
  req(g, '김민우', '012345', 'off', { date: '2026-11-18', reason: '병원' });
  const id = reqRows(g)[0][0];
  assert.equal(reqRows(g)[0][10], '점장', '다른 점장(박점장)이 있으니 점장에게');
  assert.throws(() => g.gs.adminToday({ name: '김민우', pin: '0123' }), /틀렸어요/);
  const kim = { name: '김민우', pin: '012345' };
  assert.throws(() => g.gs.mgrForward(kim, id, ''), /본인 요청은/);
  assert.throws(() => g.gs.mgrReturn(kim, id, '안 돼요'), /본인 요청은/);
  g.gs.mgrForward(MGR, id, '확인');
  assert.equal(reqRows(g)[0][10], '관리자');
  // 김민우 대타를 박점장이 맡으면: 박점장도 김민우도 못 올리고, 사장님께 바로 알려요
  req(g, '김민우', '012345', 'swap', { date: '2026-11-19' });
  const sid = reqRows(g)[1][0];
  g.gs.takeSwap('박점장', '246813', sid);
  assert.match(g.mails.at(-1).subject, /대타 수락 · 확인해주세요 \(점장 확인 전\)/);
  assert.throws(() => g.gs.mgrForward(MGR, sid, ''), /본인이 대타를 맡은/);
  assert.throws(() => g.gs.mgrForward(kim, sid, ''), /본인 요청은/);
  g.gs.adminRequest('582941', sid, true);
  assert.equal(reqRows(g)[1][7], '승인', '관리자는 바로 처리할 수 있어요');
});

test('검토: 대타를 맡은 사람이 수락을 취소하면, 점장이 올렸던 것도 처음으로 돌아가요', () => {
  const g = v3();
  g.setKst('2026-11-16 15:00');
  req(g, '김민우', '0123', 'swap', { date: '2026-11-18' });
  const id = reqRows(g)[0][0];
  g.gs.takeSwap('이지은', '5678', id);
  g.gs.mgrForward(MGR, id, '이지은 괜찮아요');
  assert.equal(reqRows(g)[0][10], '관리자');
  g.gs.cancelRequest('이지은', '5678', id);
  const row = reqRows(g)[0];
  assert.equal(row[7], '대기');
  assert.equal(row[10], '점장', '새 대타가 정해지면 점장이 다시 봐요');
  assert.equal(row[11], '', '예전 점장 한마디는 지워요');
  g.gs.takeSwap('최유나', '1357', id);
  assert.equal(g.gs.adminToday(MGR).requests[0].route, '점장');
});

test('검토: [요청] K·L 칸에 사장님이 쓰던 게 있으면 새 칸을 그 앞에 끼워 넣어요', () => {
  const g = createGas({ now: Date.parse('2026-11-16T09:00:00+09:00') });
  const rq = g.book.insertSheet('요청');
  rq.getRange(1, 1, 2, 11).setValues([['번호', '요청일시', '이름', '종류', '날짜', '내용', '사유', '상태', '대타', '처리일시', '메모'],
    ['R1', '2026-11-15 10:00', '예시직원', '휴무', '2026-11-20', '11:00-', '개인', '대기', '', '', '사장님 메모']]);
  g.gs.setup();
  assert.deepEqual(plain(rq.rowDisplay(1).slice(10, 13)), ['보낼곳', '점장확인', '메모']);
  assert.equal(rq.rowDisplay(2)[12], '사장님 메모', '사장님 칸은 오른쪽으로 밀려서 그대로');
  g.gs.setSetting_('관리자PIN', '582941');
  g.gs.adminRequest('582941', 'R1', false);
  assert.equal(rq.rowDisplay(2)[7], '거절');
  assert.equal(rq.rowDisplay(2)[10], '관리자');
  assert.equal(rq.rowDisplay(2)[12], '사장님 메모', '처리해도 사장님 칸은 안 건드려요');
  g.gs.setup();
  assert.deepEqual(plain(rq.rowDisplay(1).slice(10, 13)), ['보낼곳', '점장확인', '메모'], '다시 setup 해도 또 끼우지 않아요');
});

test('검토: 휴무신청기간을 "20일~25일"이나 "18일부터 22일까지"처럼 적어도 그 기간만 열려요', () => {
  const g = v3();
  g.gs.setSetting_('휴무신청기간', '20일~25일');
  g.setKst('2026-11-26 10:00');
  assert.throws(() => g.gs.wishDay('김민우', '0123', '2026-12-08', true), /고를 기간이 지났어요/);
  g.gs.setSetting_('휴무신청기간', '매달 18일부터 22일까지');
  g.setKst('2026-11-18 10:00');
  g.gs.wishDay('김민우', '0123', '2026-12-08', true);
  assert.equal(mark(g, '김민우', '2026-12-08'), '휴무?');
  g.setKst('2026-11-23 10:00');
  assert.throws(() => g.gs.wishDay('김민우', '0123', '2026-12-09', true), /11\/18~11\/22에만/);
});

test('검토: 공휴일에는 그 매장에 누가 출근해야 미출근 알림을 보내요(설·추석처럼 쉬는 날 알림 폭탄 방지)', () => {
  const g = v3({ email: 'owner@example.com' });
  tgOn(g, { 김민우: '9002' });
  g.gs.setSetting_('공휴일추가', '2026-11-16 회사창립일');
  g.setKst('2026-11-16 09:45');
  g.gs.checkMissing();
  g.setKst('2026-11-16 10:15');
  g.gs.checkMissing();
  assert.equal(sentTo(g, 9002).length, 0, '매장이 쉬는지 모르니 직원에게 안 보내요');
  assert.equal(sentTo(g, 555).length, 0, '사장님께도 안 보내요');
  g.setKst('2026-11-16 10:20');
  punch(g, '박점장', '246813', 'in');
  g.setKst('2026-11-16 10:25');
  g.gs.checkMissing();
  assert.match(sentTo(g, 9002).at(-1), /아직 출근을 안 찍었어요/, '박점장이 출근해서 연 날로 봐요');
  assert.match(sentTo(g, 555).at(-1), /아직 출근 안 찍은 직원 1명/);
});

test('검토: 마감 정리는 줄을 서서 한 번만, 다시 돌아도 직원 알림은 한 번만', () => {
  const g = v3();
  tgOn(g, { 이지은: '9003' });
  g.setKst('2026-11-16 12:03');
  punch(g, '이지은', '5678', 'in');
  g.setKst('2026-11-16 23:35');
  g.setLockBusy(true);
  g.gs.checkMissing();
  assert.equal(mark(g, '김민우', '2026-11-16'), '', '줄이 막혀 있으면 이번엔 건너뛰어요');
  assert.equal(sentTo(g, 9003).length, 0);
  g.setLockBusy(false);
  g.setKst('2026-11-16 23:45');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민우', '2026-11-16'), '결근?', '다음 번에 해요');
  assert.equal(sentTo(g, 9003).length, 1);
  // 중간에 오류가 나서 다시 도는 경우(끝 표시를 지워서 흉내): 직원 알림은 두 번 안 가요
  g.gs.PropertiesService.getScriptProperties().deleteProperty('close:2026-11-16');
  g.setKst('2026-11-16 23:55');
  g.gs.checkMissing();
  assert.equal(sentTo(g, 9003).length, 1, '퇴근 안 찍음 알림은 한 번만');
});

/* ───── 1년 보기 · 시트 서식 ───── */

test('휴무표 서식: 주말·공휴일 열 음영, 매장 사이 굵은 선, 매장 이름은 묶음 첫 줄만 진하게', () => {
  const g = v3();
  const dec = g.sheet('휴무표 2026-12');
  const bg = (day) => dec.bgCells['3,' + (10 + day)];
  assert.equal(bg(5), '#eff6ff', '12/5 토요일은 옅은 파랑');
  assert.equal(bg(6), '#fef2f2', '12/6 일요일은 옅은 빨강');
  assert.equal(bg(25), '#fef2f2', '12/25 성탄절도 옅은 빨강');
  assert.equal(bg(7), null, '평일은 음영 없음');
  // 줄: 예시직원(본점) · 김민우 · 박점장(왕십리) · 이지은 · 최유나(가산) — 매장이 바뀌는 줄 아래에 굵은 선
  const names = [];
  for (let r = 3; r <= dec.getLastRow(); r++) names.push([r, dec.rowDisplay(r)[1], dec.rowDisplay(r)[2]]);
  const ends = names.filter((x, i) => i === names.length - 1 || names[i + 1][1] !== x[1]).map((x) => x[0]);
  assert.deepEqual(Object.keys(dec.borders).map(Number).sort((a, b) => a - b), ends);
  assert.ok(Object.values(dec.borders).every((s) => s === 'SOLID_MEDIUM'));
  const firstKim = names.find((x) => x[2] === '김민우')[0];
  const park = names.find((x) => x[2] === '박점장')[0];
  assert.equal(dec.colors[firstKim + ',2'], '#111827', '매장 묶음 첫 줄은 진하게');
  assert.equal(dec.colors[park + ',2'], '#cbd5e1', '같은 매장 둘째 줄부터는 옅게');
  assert.equal(dec.getRange(firstKim, 1).getValues()[0][0], '=ROW()-2', 'No 칸은 줄을 끼워 넣어도 맞게 수식으로');
  // 예전 탭처럼 No가 숫자로 적혀 있어도, 다시 칠할 때(setup) 줄 번호 수식으로 바꿔요
  dec.getRange(3, 1, 2, 1).setValues([['7'], ['8']]);
  g.gs.setup();
  for (let r = 3; r <= dec.getLastRow(); r++) assert.equal(dec.getRange(r, 1).getValues()[0][0], '=ROW()-2', '예전 줄 번호도 수식으로');
});

test('휴무표: 새 직원은 맨 아래가 아니라 자기 매장 묶음 안에 들어가요', () => {
  const g = v3();
  const nov = g.sheet('휴무표 2026-11');
  const order = () => { const o = []; for (let r = 3; r <= nov.getLastRow(); r++) o.push(nov.rowDisplay(r)[2] + '/' + nov.rowDisplay(r)[1]); return o; };
  const before = order();
  g.sheet('직원').getRange(7, 1, 1, 3).setValues([['신입왕', '왕십리', '']]);
  g.setKst('2026-11-16 10:00');
  g.gs.checkMissing(); // 10분마다 도는 작업이 빠진 직원을 넣어요
  const after = order();
  assert.equal(after.length, before.length + 1);
  const i = after.indexOf('신입왕/왕십리');
  assert.ok(i > 0 && after[i - 1].endsWith('/왕십리'), '왕십리 묶음 끝에: ' + after.join(', '));
  assert.ok(after[i + 1].endsWith('/가산'), '바로 아래는 가산 묶음: ' + after.join(', '));
  assert.equal(after.at(-1), before.at(-1), '맨 아래 줄은 그대로');
  const r = monthRowOf(g, '2026-11', '신입왕').r;
  assert.equal(nov.fmt(r, 11), '@', '끼워 넣은 줄도 날짜 칸이 글자 서식이라 11:08 같은 지각 시간이 그대로 보여요');
  // 그 아래 직원(가산)도 그대로 읽고 써요
  g.setKst('2026-11-16 12:09');
  punch(g, '이지은', '5678', 'in');
  assert.equal(mark(g, '이지은', '2026-11-16'), '12:09');
});

test('출퇴근기록: 매장 칸이 생기고(예전 줄은 찍을 때 채움), 주말 줄·지각·퇴근 누락에 색이 칠해져요', () => {
  const g = v3();
  g.setKst('2026-11-16 10:05');
  punch(g, '김민우', '0123', 'in');
  const log = g.sheet('출퇴근기록');
  assert.equal(log.rowDisplay(1)[15], '매장');
  assert.equal(log.rowDisplay(2)[15], '왕십리');
  // 기록이 없던 날을 정정 승인으로 새로 만들어도 매장이 들어가요
  g.setKst('2026-11-17 09:00');
  req(g, '이지은', '5678', 'fix', { date: '2026-11-16', type: 'in', time: '12:00', reason: '깜빡' });
  g.gs.adminRequest('582941', reqRows(g).at(-1)[0], true);
  assert.equal(log.rowDisplay(3)[2], '이지은');
  assert.equal(log.rowDisplay(3)[15], '가산');
  const rules = Array.from(log.cfRules || [], (x) => (x.calls.find((c) => c[0] === 'whenFormulaSatisfied') || [])[1]);
  assert.ok(rules.includes('=$B2="토"') && rules.includes('=$B2="일"'), '주말 줄 색칠');
  assert.ok(rules.some((f) => /\$H2/.test(f)), '지각 칸 빨간 글씨');
  assert.ok(rules.some((f) => /\$G2=""/.test(f)), '퇴근 안 찍은 칸 노랑');
  // 예전 시트(매장 칸 없음): setup 이 머리글을 붙이고, 그 줄은 다음에 찍을 때 채워요
  log.getRange(1, 16).setValue('');
  log.getRange(2, 16).setValue('');
  g.gs.setup();
  assert.equal(log.rowDisplay(1)[15], '매장');
  g.setKst('2026-11-16 20:00');
  punch(g, '김민우', '0123', 'out');
  assert.equal(log.rowDisplay(2)[15], '왕십리');
  assert.equal(g.gs.adminExport('582941', '2026-11').name, '정산 2026-11');
  const ex = g.sheet('정산 2026-11');
  let top = 1;
  while (ex.rowDisplay(top)[0] !== '날짜') top++;
  assert.equal(ex.rowDisplay(top)[15], '매장', '정산 시트 날짜별 기록에도 매장 칸');
  assert.equal(ex.rowDisplay(top + 1)[15], '왕십리');
});

test('직원 1년 보기: 휴무표 탭 12개를 안 열어도 한 사람의 1년이 달마다 나와요', () => {
  const g = v3();
  // 11월: 출근 2번(한 번 지각), 휴무표에 휴무·반차·월차·결근?, 대체휴무 적립 1
  g.setKst('2026-11-16 10:05');
  punch(g, '김민우', '0123', 'in');
  g.setKst('2026-11-16 20:00');
  punch(g, '김민우', '0123', 'out');
  g.setKst('2026-11-17 09:58');
  punch(g, '김민우', '0123', 'in');
  g.gs.setMark_('2026-11-18', '김민우', () => '휴무');
  g.gs.setMark_('2026-11-19', '김민우', () => '반차');
  g.gs.setMark_('2026-11-20', '김민우', () => '월차');
  g.gs.setMark_('2026-11-23', '김민우', () => '결근?');
  g.gs.addSub_('2026-11-21', '김민우', '적립', 1, '시험');
  // 12월: 휴무 1
  g.gs.setMark_('2026-12-02', '김민우', () => '휴무');
  const nov = g.sheet('휴무표 2026-11');
  nov.getRange(monthRowOf(g, '2026-11', '김민우').r, 8).setValue('3'); // 잔여(시트에서는 수식 결과)
  g.setKst('2026-11-18 09:00'); // 오늘(11/17)은 아직 퇴근 누락이 아니라서, 다음 날 봐요
  const y = g.gs.adminYear('582941', '김민우', '2026');
  assert.equal(y.name, '김민우');
  assert.equal(y.store, '왕십리');
  assert.equal(y.months.length, 12);
  const n = y.months[10];
  assert.equal(n.ym, '2026-11');
  assert.equal(n.days, 2);
  assert.equal(n.lateCount, 1);
  assert.equal(n.lateMin, 5);
  assert.equal(n.off, 1.5, '휴무 1 + 반차 0.5');
  assert.equal(n.monthly, 1);
  assert.equal(n.monthlyLeft, 3);
  assert.equal(n.absent, 1);
  assert.equal(n.subGot, 1);
  assert.equal(n.noOut, 1, '11/17 퇴근 안 찍음');
  assert.equal(y.months[11].off, 1);
  assert.equal(y.total.off, 2.5);
  assert.equal(y.total.days, 2);
  assert.equal(y.total.monthlyLeft, 3);
  assert.ok(y.total.deduct > 0, '관리자는 차감액도 봐요');
  // 점장: 자기 매장만, 차감액 없이
  const m = g.gs.adminYear(MGR, '김민우', '2026');
  assert.equal(m.total.deduct, 0);
  assert.equal(m.noMoney, true);
  assert.throws(() => g.gs.adminYear(MGR, '이지은', '2026'), /점장님 매장 직원만/);
  assert.throws(() => g.gs.adminYear('582941', '없는사람', '2026'), /직원을 찾을 수 없어요/);
});

test('1년 요약 시트: 한 사람 한 달이 한 줄, 사람마다 합계 줄, 필터로 한 사람만 볼 수 있어요', () => {
  const g = v3();
  g.setKst('2026-11-16 10:05');
  punch(g, '김민우', '0123', 'in');
  g.setKst('2026-11-16 12:00');
  punch(g, '이지은', '5678', 'in');
  g.gs.setMark_('2026-12-02', '김민우', () => '휴무');
  const r = g.gs.adminExportYear('582941', '2026');
  assert.equal(r.name, '연간 2026');
  const sh = g.sheet('연간 2026');
  assert.deepEqual(plain(sh.rowDisplay(1).slice(0, 4)), ['이름', '매장', '월', '근무일']);
  const rows = [];
  for (let i = 2; i <= sh.getLastRow(); i++) rows.push(sh.rowDisplay(i).slice(0, 3).join('/'));
  assert.deepEqual(rows.filter((x) => x.startsWith('김민우')), ['김민우/왕십리/11월', '김민우/왕십리/12월', '김민우/왕십리/합계']);
  assert.ok(rows.includes('이지은/가산/합계'));
  assert.ok(sh.filter, '필터가 걸려 있어요');
  assert.ok(Object.keys(sh.borders).length >= 2, '사람마다 선으로 구분');
  assert.equal(g.gs.adminExportYear('582941', '2026').name, '연간 2026', '다시 만들어도 한 장');
  assert.equal(g.book.getSheets().filter((x) => x.getName() === '연간 2026').length, 1);
  assert.throws(() => g.gs.adminExportYear(MGR, '2026'), /관리자\(사장님\)만/);
});

test('휴무표: 읽은 뒤에 누가 줄을 끼워 넣어도(새 직원 등) 엉뚱한 줄에 쓰지 않아요', () => {
  const g = v3();
  const nov = g.sheet('휴무표 2026-11');
  g.gs.GRID_ = {};
  g.gs.monthGrid_('2026-11'); // 이 실행이 휴무표를 읽어 둔 상태
  const kimBefore = monthRowOf(g, '2026-11', '김민우').r;
  nov.insertRowsAfter(2, 1); // 그 사이 다른 실행이 맨 위에 줄을 끼워 넣음
  g.gs.setMark_('2026-11-18', '김민우', () => '휴무');
  const kim = monthRowOf(g, '2026-11', '김민우').r;
  assert.equal(kim, kimBefore + 1);
  assert.equal(nov.rowDisplay(kim)[10 + 18 - 1], '휴무', '김민우 줄에 써요');
  assert.equal(nov.rowDisplay(kim - 1)[10 + 18 - 1] || '', '', '위 줄(다른 사람)은 그대로');
});

/* ───── PC용 1년 탭 ───── */

const sheetRows = (sh) => { const out = []; for (let r = 1; r <= sh.getLastRow(); r++) out.push(sh.rowDisplay(r)); return out; };

test('직원 1년 탭(PC): 직원·연도를 고르면 달마다 합계와 1년 달력(휴무표 칸 그대로)이 채워져요', () => {
  const g = v3();
  const sh = g.sheet('직원 1년');
  assert.ok(sh, 'setup 이 만들어 둬요');
  assert.ok(sh.validations['3,2'] && sh.validations['3,4'], 'B3 직원, D3 연도는 고르는 칸');
  g.setKst('2026-11-16 10:05');
  punch(g, '김민우', '0123', 'in');
  g.setKst('2026-11-16 20:00');
  punch(g, '김민우', '0123', 'out');
  g.gs.setMark_('2026-11-18', '김민우', () => '휴무');
  g.gs.setMark_('2026-12-02', '김민우', () => '월차');
  g.setKst('2026-11-20 09:00');
  sh.getRange(3, 2).setValue('김민우');
  sh.getRange(3, 4).setValue('2026');
  g.gs.onEdit({ range: sh.getRange(3, 2) }); // 사장님이 B3에서 고른 것처럼
  const rows = sheetRows(sh);
  assert.match(rows[4][0], /달마다 합계 · 김민우 \(왕십리\) · 2026년/);
  const nov = rows.find((r) => r[0] === '11월' && r[1] !== '' && !/^\d{1,2}:/.test(r[1]));
  assert.deepEqual(plain(nov.slice(0, 4)), ['11월', '1', '9시간 55분', '1'], '근무 1일, 지각 1회');
  assert.equal(rows.find((r) => r[0] === '합계')[7], '1', '휴무 합계');
  // 1년 달력: 11월 줄에 16일 지각 시간, 18일 휴무 / 12월 줄에 2일 월차
  const head = rows.findIndex((r) => r[0] === '월' && r[1] === '1');
  assert.ok(head > 0);
  const calNov = rows[head + 11], calDec = rows[head + 12];
  assert.equal(calNov[0], '11월');
  assert.equal(calNov[16], '10:05');
  assert.equal(calNov[18], '휴무');
  assert.equal(calDec[2], '월차');
  const r11 = head + 12; // 11월 줄의 시트 줄 번호(1부터)
  assert.equal(sh.bgCells[r11 + ',' + (1 + 21)], '#eff6ff', '11/21 토요일 음영');
  assert.equal(sh.bgCells[r11 + ',' + (1 + 22)], '#fef2f2', '11/22 일요일 음영');
  assert.equal(sh.bgCells[r11 + ',' + (1 + 31)], '#e5e7eb', '11월에 없는 31일은 회색');
  const texts = Array.from(sh.cfRules, (x) => (x.calls.find((c) => c[0] === 'whenTextContains') || [])[1]);
  assert.ok(texts.includes('월차') && texts.includes('결근'), '휴무표와 같은 색칠 규칙');
  // 새로고침 체크: 그 사이 바뀐 기록을 다시 읽고, 체크는 풀려요
  g.gs.setMark_('2026-11-19', '김민우', () => '반차');
  sh.getRange(3, 6).setValue(true);
  g.gs.onEdit({ range: sh.getRange(3, 6) });
  assert.equal(sheetRows(sh)[head + 11][19], '반차');
  assert.equal(sh.rowDisplay(3)[5], 'false');
});

test('매장 1년 탭(PC): 매장을 고르면 직원별 1년 합계·달마다 매장 합계·달마다 지각과 휴무가 채워져요', () => {
  const g = v3();
  g.setKst('2026-11-16 10:05');
  punch(g, '김민우', '0123', 'in');
  g.setKst('2026-11-16 10:12');
  punch(g, '박점장', '246813', 'in');
  g.setKst('2026-11-16 12:30');
  punch(g, '이지은', '5678', 'in');
  g.gs.setMark_('2026-11-18', '김민우', () => '휴무');
  g.gs.addSub_('2026-03-02', '박퇴사', '적립', 1, '예전 기록'); // 퇴사자도 그해 기록이 있으면 보여요
  g.setKst('2026-11-20 09:00');
  const sh = g.sheet('매장 1년');
  sh.getRange(3, 2).setValue('왕십리');
  g.gs.onEdit({ range: sh.getRange(3, 2) });
  const rows = sheetRows(sh);
  assert.match(rows[4][0], /직원별 1년 합계 · 왕십리 · 2026년/);
  const kim = rows.find((r) => r[0] === '김민우');
  assert.equal(kim[3], '1', '김민우 지각 1회');
  assert.equal(kim[7], '1', '김민우 휴무 1일');
  assert.ok(rows.find((r) => r[0] === '박점장'));
  assert.ok(rows.find((r) => r[0] === '박퇴사 (퇴사)'), '그해 기록이 있는 퇴사자');
  assert.ok(!rows.some((r) => r[0] === '이지은'), '다른 매장(가산)은 안 나와요');
  const total = rows.find((r) => r[0] === '매장 합계');
  assert.equal(total[3], '2', '매장 지각 합계 2회');
  const nov = rows.find((r) => r[0] === '11월');
  assert.equal(nov[3], '2', '11월 매장 지각 2회');
  const lateTitle = rows.findIndex((r) => r[0] === '달마다 지각(회)');
  const lateKim = rows.slice(lateTitle).find((r) => r[0] === '김민우');
  assert.equal(lateKim[11], '1', '김민우 11월 지각 1회');
  assert.equal(lateKim[13], '1', '합계');
  assert.ok(rows.some((r) => r[0] === '달마다 휴무(일)'));
  // 가산으로 바꾸면 가산 직원만
  sh.getRange(3, 2).setValue('가산');
  g.gs.onEdit({ range: sh.getRange(3, 2) });
  const rows2 = sheetRows(sh);
  assert.ok(rows2.some((r) => r[0] === '이지은'));
  assert.ok(!rows2.some((r) => r[0] === '김민우'));
});

/* ───── 빠르기: 구글은 실행 한 번에 6분(시트 고침 감지는 30초)까지라, 시트 작업 수를 예산 안으로 ───── */

test('setup: 지난번에 1년 탭을 그리다 멈췄으면(연도 고르기 칸 없음) 다시 그리고, 다 그려진 탭은 건드리지 않아요', () => {
  const g = v3();
  const half = g.sheet('직원 1년');
  half.clear(); // 그리다 멈춘 탭: 글자 조금, 고르기 칸 없음
  half.getRange(1, 1).setValue('직원 1년');
  g.gs.setup();
  assert.ok(half.getRange(3, 4).getDataValidation(), '연도 고르기 칸이 다시 생겨요');
  assert.ok(half.getRange(3, 2).getDataValidation(), '직원 고르기 칸도');
  const store = g.sheet('매장 1년');
  store.getRange(3, 2).setValue('왕십리');
  g.gs.onEdit({ range: store.getRange(3, 2) });
  const filled = store.rowDisplay(5).join('|');
  g.gs.setup();
  assert.equal(store.rowDisplay(5).join('|'), filled, '다 그려진 탭은 setup이 지우지 않아요');
});

test('빠르기: 실제 크기 시트(매장 11·직원 30·한 달 기록)에서 setup과 1년 탭 고르기가 시트 작업 예산 안이에요', () => {
  const g = createGas({ now: Date.parse('2026-11-19T10:00:00+09:00') });
  g.gs.setup();
  const stores = ['왕십리', '가산', 'DMC', '다산', '창동', '검단', '세종', '아산', '청주', '사무실(창)', '사무실(영)'];
  g.sheet('매장').getRange(2, 1, 11, 2).setValues(stores.map((s) => [s, s.startsWith('사무실') ? '' : '11:00']));
  const staff = [];
  for (let i = 0; i < 30; i++) staff.push(['직원' + i, stores[Math.floor(i / 3) % 11], String(1000 + i), 10320, '', '', '', '', '', '', '', '', '', '']);
  g.sheet('직원').getRange(2, 1, 30, 14).setValues(staff);
  g.gs.MEMO_ = {};
  g.gs.GRID_ = {};
  g.gs.setup();
  const rows = [];
  for (let d = 1; d <= 19; d++) for (let i = 0; i < 30; i++) {
    rows.push(['2026-11-' + String(d).padStart(2, '0'), '월', '직원' + i, '11:00', '', '10:55', '20:05', '', '', '550', '', '', '', '', '', '']);
  }
  g.sheet('출퇴근기록').getRange(2, 1, rows.length, 16).setValues(rows);
  // 세기: 시트와 주고받는 메서드 호출 수 (여러 칸 한 번에 = 1번)
  let ops = 0;
  const skip = new Set(['constructor', 'each', 'getRow', 'getColumn', 'getNumRows', 'getNumColumns', 'getSheet', 'getName', 'getSheetId', 'getRange', 'getRangeList', 'key', 'get', 'fmt', 'setFmt', 'set', 'display', 'rowDisplay']);
  const protos = [Object.getPrototypeOf(g.sheet('매장').getRange(1, 1)), Sheet.prototype];
  const saved = [];
  for (const proto of protos) for (const k of Object.getOwnPropertyNames(proto)) {
    if (skip.has(k) || typeof proto[k] !== 'function') continue;
    const orig = proto[k];
    saved.push([proto, k, orig]);
    proto[k] = function (...a) { ops++; return orig.apply(this, a); };
  }
  hooks.listCall = () => { ops++; };
  try {
    g.gs.MEMO_ = {};
    g.gs.GRID_ = {};
    ops = 0;
    g.gs.setup();
    const setupOps = ops;
    const yr = g.sheet('직원 1년');
    yr.getRange(3, 2).setValue('직원0');
    ops = 0;
    g.gs.onEdit({ range: yr.getRange(3, 2) });
    const staffOps = ops;
    ops = 0;
    g.gs.onEdit({ range: g.sheet('매장 1년').getRange(3, 2) });
    const storeOps = ops;
    assert.ok(setupOps <= 210, 'setup 시트 작업 ' + setupOps + '번 (예산 210: [인사] 지점·상태 고르기 목록을 넣으면서 4번 늘었어요)');
    assert.ok(staffOps <= 70, '직원 1년 고르기 ' + staffOps + '번 (예산 70)');
    assert.ok(storeOps <= 70, '매장 1년 고르기 ' + storeOps + '번 (예산 70)');
    console.log('setup', setupOps, '/ 직원 1년', staffOps, '/ 매장 1년', storeOps);
  } finally {
    for (const [proto, k, orig] of saved) proto[k] = orig;
    hooks.listCall = null;
  }
});

/* ───── 인사 정보: 입사 등록·승인, 내 정보, 인사 카드, 지점 이동·퇴사, 주민번호 암호화, 연락처 ───── */

const RRN = '9501011928374'; // 1995-01-01
const NEWPHONE = '1111222233334444';
PHONE.한신입 = NEWPHONE;
const joinForm = (over = {}) => ({
  name: '한신입', rrn: '950101-1928374', phone: '01012345678', addr: '서울 성동구 왕십리로 1', bank: '국민',
  account: '123456-78-901234', holder: '', emergency: '010-9999-8888 어머니', store: '왕십리', start: '2026-11-16',
  pin: '4826', device: NEWPHONE, label: 'Galaxy 크롬', agree: true, agreeLoc: true, ...over,
});
// [인사] 한 줄을 {머리글: 값}으로
const hrRow = (g, name) => {
  const sh = g.sheet('인사');
  const head = sh.rowDisplay(1);
  for (let r = 2; r <= sh.getLastRow(); r++) {
    const v = sh.rowDisplay(r);
    if (v[0] === name) return Object.fromEntries(head.map((h, i) => [h, v[i]]));
  }
  return null;
};
// 모든 탭의 모든 칸(주민번호가 그대로 남았는지 찾을 때)
const allCells = (g) => {
  const out = [];
  for (const sh of g.book.getSheets()) for (const v of sh.cells.values()) out.push(typeof v === 'string' ? v : JSON.stringify(v));
  return out.join('\n');
};
const colOf = (sh, h) => sh.rowDisplay(1).indexOf(h) + 1;

test('주민번호 암호화: AES-256이 표준 시험값·Node 암호화와 같고, 고치거나 열쇠가 바뀌면 못 풀어요', () => {
  const crypto = require('crypto');
  const g = createGas({ now: Date.parse('2026-11-16T09:00:00+09:00') });
  const hex = (h) => Array.from(Buffer.from(h, 'hex'));
  // FIPS-197 부록 C.3
  const w = g.gs.aesKeys_(hex('000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f'));
  assert.equal(Buffer.from(g.gs.aesBlock_(w, hex('00112233445566778899aabbccddeeff'))).toString('hex'), '8ea2b7ca516745bfeafc49904b496089');
  for (let i = 0; i < 40; i++) {
    const key = crypto.randomBytes(32);
    const iv = i === 0 ? Buffer.alloc(16, 0xff) : crypto.randomBytes(16); // 첫 번째는 카운터가 한 바퀴 넘어가요
    const data = crypto.randomBytes(i === 0 ? 40 : 1 + i * 3);
    const c = crypto.createCipheriv('aes-256-ctr', key, iv);
    const want = Buffer.concat([c.update(data), c.final()]).toString('hex');
    assert.equal(Buffer.from(g.gs.aesCtr_(Array.from(key), Array.from(iv), Array.from(data))).toString('hex'), want);
  }
  g.gs.setup();
  const a = g.gs.rrnEncrypt_(RRN), b = g.gs.rrnEncrypt_(RRN);
  assert.match(a, /^enc1:[A-Za-z0-9+/=]+$/);
  assert.notEqual(a, b, '같은 번호도 매번 다른 암호');
  assert.equal(g.gs.rrnDecrypt_(a), RRN);
  const bytes = Buffer.from(a.slice(5), 'base64');
  bytes[18] ^= 1;
  assert.throws(() => g.gs.rrnDecrypt_('enc1:' + bytes.toString('base64')), /풀 수 없어요/);
  g.props.set('hrKey', crypto.randomBytes(32).toString('base64'));
  assert.throws(() => g.gs.rrnDecrypt_(a), /풀 수 없어요/);
  g.props.delete('hrKey');
  assert.throws(() => g.gs.rrnDecrypt_(a), /열쇠가 없어요/);
});

test('주민번호·휴대폰 읽기: 없는 날짜·성별 숫자는 안 받고, 가린 번호로 몇 년생인지 알아요', () => {
  const { gs } = createGas({ now: 0 });
  assert.equal(gs.rrnParse_('950101-1928374'), RRN);
  assert.equal(gs.rrnParse_('030303-4234567'), '0303034234567', '2000년대(4)');
  assert.equal(gs.rrnParse_('950230-1234567'), '', '2월 30일');
  assert.equal(gs.rrnParse_('951301-1234567'), '', '13월');
  assert.equal(gs.rrnParse_('950101-9234567'), '', '성별 숫자 9');
  assert.equal(gs.rrnParse_('950101-123456'), '', '12자리');
  assert.equal(gs.rrnMask_(RRN), '950101-1******');
  assert.equal(gs.birthLabel_('950101-1******'), '95년생');
  assert.equal(gs.birthLabel_('030303-4******'), '03년생');
  assert.equal(gs.birthLabel_(''), '');
  assert.equal(gs.phoneOf_('01012345678'), '010-1234-5678');
  assert.equal(gs.phoneOf_('010 123 4567'), '', '010은 11자리만(한 자리 빠진 오타를 잡아요)');
  assert.equal(gs.phoneOf_('011 123 4567'), '011-123-4567', '예전 011·016 번호는 10자리도 받아요');
  assert.equal(gs.phoneOf_('+82 10-1234-5678'), '010-1234-5678', '+82로 시작해도 받아요');
  assert.equal(gs.phoneOf_('02-123-4567'), '');
});

test('setup: [인사] 탭에 지금 직원을 적어 두고(테스트·예시 직원 빼고), 주민번호 열쇠는 한 번만 만들어요', () => {
  const g = v3();
  assert.deepEqual(plain(g.gs.hrRows_().map((h) => h.name)), ['김민우', '이지은', '박퇴사', '박점장', '최유나']);
  assert.equal(hrRow(g, '박퇴사')['상태'], '퇴사');
  assert.equal(hrRow(g, '박퇴사')['퇴사일'], '', '예전 퇴사일은 몰라서 비워둬요');
  assert.equal(hrRow(g, '김민우')['상태'], '근무');
  assert.equal(hrRow(g, '김민우')['첫 지점'], '왕십리');
  const hs = g.sheet('인사');
  assert.ok(hs.hidden[colOf(hs, '주민번호(암호)')] && hs.hidden[colOf(hs, '가입(임시)')], '암호·임시 칸은 숨겨요');
  assert.match(hs.notes['1,' + colOf(hs, '주민번호')], /전체 번호는 암호로/);
  const key = g.props.get('hrKey');
  assert.ok(key);
  g.gs.setup();
  assert.equal(g.props.get('hrKey'), key, '다시 setup해도 열쇠는 그대로');
  assert.equal(g.gs.hrRows_().length, 5, '줄이 안 늘어요');
});

test('입사 등록: 신입이 폰에서 보내면 [인사]에 승인 대기로, 주민번호는 가린 번호·암호로만 남고 사장님께 알림', () => {
  const g = v3();
  tgOn(g);
  g.setKst('2026-11-16 14:00');
  assert.equal(g.gs.joinSubmit(joinForm()).ok, true);
  const h = hrRow(g, '한신입');
  assert.equal(h['상태'], '승인 대기');
  assert.equal(h['주민번호'], '950101-1******');
  assert.match(h['주민번호(암호)'], /^enc1:/);
  assert.equal(h['휴대폰'], '010-1234-5678');
  assert.equal(h['예금주'], '한신입', '예금주를 비우면 본인 이름');
  assert.equal(h['입사일'], '2026-11-16');
  assert.equal(h['첫 지점'], '왕십리');
  assert.match(h['등록'], /2026-11-16 14:00 본인 입력/);
  assert.ok(!allCells(g).includes('1928374'), '주민번호 뒷자리는 시트 어디에도 그대로 안 남아요');
  assert.match(sentTo(g, 555).at(-1), /새 입사 등록\n[\s\S]*한신입 \(왕십리, 95년생\)/);
  assert.deepEqual(plain(g.gs.joinStatus('한신입', NEWPHONE)), { state: 'wait', store: '왕십리' });
  assert.deepEqual(plain(g.gs.joinStatus('한신입', 'zzzzzzzzzzzzzzzz')), { state: '' }, '다른 폰에는 안 알려줘요');
  const t = g.gs.adminToday('582941');
  assert.deepEqual(plain(t.joins.map((j) => [j.name, j.store, j.birth, j.phone])), [['한신입', '왕십리', '95년생', '010-1234-5678']]);
  assert.deepEqual(plain(g.gs.adminToday(MGR).joins), [], '점장 화면에는 안 보여요');
  // 같은 폰에서 고쳐서 다시 보내면 그 줄을 고쳐요
  g.gs.joinSubmit(joinForm({ addr: '서울 성동구 왕십리로 2' }));
  assert.equal(hrRow(g, '한신입')['주소'], '서울 성동구 왕십리로 2');
  assert.equal(g.gs.hrRows_().filter((x) => x.name === '한신입').length, 1);
});

test('입사 등록 확인: 동의·주민번호·연락처·계좌·이미 있는 이름·쉬운 비밀번호·남의 폰은 막아요', () => {
  const g = v3();
  punch(g, '김민우', '0123', 'in'); // 김민우 폰 등록
  assert.throws(() => g.gs.joinSubmit(joinForm({ agree: false })), /동의해야/);
  assert.throws(() => g.gs.joinSubmit(joinForm({ rrn: '950230-1234567' })), /주민등록번호를 확인/);
  assert.throws(() => g.gs.joinSubmit(joinForm({ phone: '0212345678' })), /휴대폰/);
  assert.throws(() => g.gs.joinSubmit(joinForm({ addr: ' ' })), /주소/);
  assert.throws(() => g.gs.joinSubmit(joinForm({ account: '12' })), /계좌번호/);
  assert.throws(() => g.gs.joinSubmit(joinForm({ store: '없는점' })), /지점/);
  assert.throws(() => g.gs.joinSubmit(joinForm({ name: '김민우' })), /이미 직원 명단/);
  assert.throws(() => g.gs.joinSubmit(joinForm({ name: '테스트' })), /쓸 수 없는 이름/);
  assert.throws(() => g.gs.joinSubmit(joinForm({ pin: '1234' })), /쉬운/);
  assert.throws(() => g.gs.joinSubmit(joinForm({ pin: '12' })), /4~6자리/);
  assert.throws(() => g.gs.joinSubmit(joinForm({ device: PHONE.김민우 })), /김민우 님 폰/);
  assert.throws(() => g.gs.joinSubmit(joinForm({ device: '' })), /폰 확인이 안 돼요/);
  g.gs.joinSubmit(joinForm());
  assert.throws(() => g.gs.joinSubmit(joinForm({ device: 'gggggggggggggggg' })), /같은 이름으로 승인을 기다리는/);
  assert.equal(g.gs.hrRows_().filter((x) => x.state === '승인 대기').length, 1);
});

test('입사 승인: [직원]·휴무표(매장 묶음)에 들어가고, 등록한 폰과 비밀번호로 바로 찍혀요', () => {
  const g = v3();
  g.setKst('2026-11-16 14:00');
  g.gs.joinSubmit(joinForm());
  assert.throws(() => g.gs.adminJoin(MGR, '한신입', true), /관리자/);
  const t = g.gs.adminJoin('582941', '한신입', true);
  assert.deepEqual(plain(t.joins), []);
  const p = g.gs.findStaff_('한신입');
  assert.deepEqual([p.store, p.pin, p.deviceId, p.active, p.agreed], ['왕십리', '4826', NEWPHONE, true, true]);
  const h = hrRow(g, '한신입');
  assert.equal(h['상태'], '근무');
  assert.equal(h['가입(임시)'], '', '임시로 둔 비밀번호·폰은 지워요');
  const me = monthRowOf(g, '2026-11', '한신입');
  assert.equal(me.v[1], '왕십리');
  assert.ok(me.r < monthRowOf(g, '2026-11', '이지은').r, '왕십리 묶음 안(가산보다 위)');
  assert.ok(monthRowOf(g, '2026-12', '한신입'), '이미 만든 다음 달 탭에도');
  assert.equal(g.gs.joinStatus('한신입', NEWPHONE).state, 'ok');
  assert.ok(g.gs.getStaffList().staff.some((s) => s.name === '한신입'));
  g.setKst('2026-11-17 09:58');
  const r = g.gs.punch({ name: '한신입', pin: '4826', type: 'in', lat: NEAR.lat, lng: NEAR.lng, acc: NEAR.acc, device: NEWPHONE, label: 'Galaxy 크롬' });
  assert.equal(r.type, 'in', '새 폰 승인 없이 바로');
});

test('입사 반려: 그 등록(주민번호 등)을 지우고, 신입 폰에는 반려 이유를 7일 동안 보여줘요', () => {
  const g = v3({ hr: false });
  g.setKst('2026-11-16 14:00');
  g.gs.joinSubmit(joinForm());
  g.gs.adminJoin('582941', '한신입', false, { reason: '지점을 가산으로 다시 골라주세요' });
  assert.equal(hrRow(g, '한신입'), null);
  assert.ok(!allCells(g).includes('enc1:'), '암호로 바꾼 주민번호도 같이 지워요');
  assert.deepEqual(plain(g.gs.joinStatus('한신입', NEWPHONE)), { state: 'no', reason: '지점을 가산으로 다시 골라주세요' });
  assert.equal(g.gs.joinStatus('한신입', 'eeeeeeeeeeeeeeee').state, '', '다른 폰에서는 안 보여요');
  assert.ok(!JSON.stringify(Object.fromEntries(g.props)).includes('950101'), '반려 기록에 주민번호는 안 남아요');
  assert.throws(() => g.gs.adminJoin('582941', '한신입', true), /승인을 기다리는 입사 등록이 없어요/);
  // 고쳐서 다시 보내면 반려 기록은 지워지고 다시 승인 대기
  g.gs.joinSubmit(joinForm({ store: '가산' }));
  assert.deepEqual(plain(g.gs.joinStatus('한신입', NEWPHONE)), { state: 'wait', store: '가산' });
  g.gs.adminJoin('582941', '한신입', false);
  assert.deepEqual(plain(g.gs.joinStatus('한신입', NEWPHONE)), { state: 'no', reason: '' });
  // 7일이 지나면 지워져요
  g.setKst('2026-11-25 10:00');
  g.gs.checkMissing();
  assert.equal(g.gs.joinStatus('한신입', NEWPHONE).state, '');
});

test('입사 코드: 정해 두면 코드를 아는 사람만 등록을 보낼 수 있어요(5번 틀리면 잠깐 막힘)', () => {
  const g = v3();
  assert.equal(g.gs.getStaffList().joinCode, false);
  assert.throws(() => g.gs.adminSetJoinCode('582941', '12'), /숫자 4~6자리/);
  assert.equal(g.gs.adminSetJoinCode('582941', '4821').info.joinCode, '4821');
  assert.equal(g.gs.getStaffList().joinCode, true);
  assert.ok(!JSON.stringify(plain(g.gs.getStaffList())).includes('4821'), '직원 화면에는 코드 자체를 안 보내요');
  assert.throws(() => g.gs.joinSubmit(joinForm()), /입사 코드를 넣어주세요/);
  assert.throws(() => g.gs.joinSubmit(joinForm({ code: '1111' })), /입사 코드가 달라요/);
  assert.equal(g.gs.joinSubmit(joinForm({ code: '4821' })).ok, true);
  g.gs.adminJoin('582941', '한신입', false);
  for (let i = 0; i < 5; i++) assert.throws(() => g.gs.joinSubmit(joinForm({ code: '0000' })), /입사 코드가 달라요/); // 맞게 넣으면 횟수가 0으로 돌아가서, 다시 5번
  assert.throws(() => g.gs.joinSubmit(joinForm({ code: '4821' })), /여러 번 틀려서 잠깐 막혔어요/);
  // 다른 폰의 신입은 막히지 않아요(잠금은 폰마다)
  assert.equal(g.gs.joinSubmit(joinForm({ code: '4821', name: '두신입', device: 'zzzzzzzzzzzzzzzz' })).ok, true);
  g.gs.adminJoin('582941', '두신입', false);
  g.gs.adminSetJoinCode('582941', '4821'); // 사장님이 다시 정하면 풀려요
  assert.equal(g.gs.joinSubmit(joinForm({ code: '4821' })).ok, true);
  g.gs.adminSetJoinCode('582941', '');
  assert.equal(g.gs.getStaffList().joinCode, false, '비우면 코드 없이');
  assert.throws(() => g.gs.adminSetJoinCode(MGR, '1234'), /관리자/);
});

test('입사 승인하면서 고치기: 지점·입사일·쉬는 요일을 정하고, 등록 보낸 시각을 오늘 출근으로 적을 수 있어요', () => {
  const g = v3();
  g.setKst('2026-11-16 09:50'); // 월요일
  g.gs.joinSubmit(joinForm({ later: true, bank: '', account: '' })); // 계좌는 나중에
  const j = plain(g.gs.adminToday('582941').joins)[0];
  assert.deepEqual([j.addr, j.emergency, j.device, j.noAccount, j.firstIn], ['서울 성동구 왕십리로 1', '010-9999-8888 어머니', 'Galaxy 크롬', true, '09:50']);
  // 사장님이 11:20에 승인: 지점을 가산으로, 쉬는 요일 수·일, 오늘 출근은 등록 보낸 시각으로
  g.setKst('2026-11-16 11:20');
  g.gs.adminJoin('582941', '한신입', true, { store: '가산', off: ['수', '일'], firstIn: true });
  const p = g.gs.findStaff_('한신입');
  assert.equal(p.store, '가산');
  assert.deepEqual(plain(p.week), ['휴무', '', '', '휴무', '', '', ''], '일·수 휴무');
  assert.deepEqual([hrRow(g, '한신입')['지점'], hrRow(g, '한신입')['첫 지점']], ['가산', '가산']);
  const t = g.gs.getToday('한신입', '4826');
  assert.deepEqual([t.tIn, t.sIn], ['09:50', '12:00'], '출근 09:50(등록 보낸 시각), 가산 12:00 출근이라 지각 아님');
  assert.equal(mark(g, '한신입', '2026-11-16'), '');
  const log = g.sheet('출퇴근기록');
  assert.match(log.rowDisplay(log.getLastRow())[13], /입사 등록 보낸 시각으로 출근 기록\(사장님 승인 11:20\)/);
  assert.ok(monthRowOf(g, '2026-11', '한신입').r > monthRowOf(g, '2026-11', '이지은').r - 5, '가산 묶음에 들어가요');
  assert.equal(g.gs.getHome('한신입', '4826').hr, true, '계좌를 아직 안 넣어서 안내가 떠요');
  // 휴무 고르기: 기간(20~25일)이 아니어도 새로 온 사람은 3일 동안 고를 수 있어요
  assert.equal(g.gs.getHome('한신입', '4826').wish.open, true);
  assert.equal(g.gs.getHome('김민우', '0123').wish.open, false, '다른 직원은 그대로');
  g.gs.wishDay('한신입', '4826', '2026-12-08', true);
  assert.equal(mark(g, '한신입', '2026-12-08'), '휴무?');
  g.setKst('2026-11-19 10:00');
  assert.equal(g.gs.getHome('한신입', '4826').wish.open, false, '3일이 지나면 닫혀요');
  // 입사일을 고쳐서 승인, 계좌 없이 보내려면 '나중에'를 골라야 해요
  assert.throws(() => g.gs.joinSubmit(joinForm({ name: '두신입', rrn: '960202-2345678', device: 'ffffffffffffffff', phone: '01077776666', bank: '', account: '' })), /은행과 계좌번호/);
  g.gs.joinSubmit(joinForm({ name: '두신입', rrn: '960202-2345678', device: 'ffffffffffffffff', phone: '01077776666', start: '2026-11-19' }));
  assert.equal(plain(g.gs.adminToday('582941').joins)[0].firstIn, '10:00');
  g.gs.adminJoin('582941', '두신입', true, { start: '2026-11-23' });
  assert.equal(hrRow(g, '두신입')['입사일'], '2026-11-23');
  assert.equal(g.gs.getToday('두신입').tIn, '', 'firstIn을 안 골랐으면 출근을 안 적어요');
  assert.throws(() => g.gs.adminJoin('582941', '없는사람', true, { store: '강남' }), /승인을 기다리는/);
});

test('다시 입사: 예전에 퇴사한 같은 이름이면 [직원] 줄을 다시 살리고 [인사] 한 줄에 이어서 적어요', () => {
  const g = v3();
  g.setKst('2026-11-16 14:00');
  g.gs.joinSubmit(joinForm({ name: '박퇴사', store: '가산', rrn: '880505-2345678' }));
  g.gs.adminJoin('582941', '박퇴사', true);
  const rows = g.gs.staff_().filter((p) => p.name === '박퇴사');
  assert.equal(rows.length, 1, '[직원] 줄이 늘지 않아요');
  assert.deepEqual([rows[0].active, rows[0].store], [true, '가산']);
  const hr = g.gs.hrRows_().filter((x) => x.name === '박퇴사');
  assert.equal(hr.length, 1, '[인사]도 한 줄');
  assert.equal(hr[0].state, '근무');
  assert.equal(hr[0].moves, '왕십리 근무, 2026-11-16 다시 입사(가산)');
  assert.equal(hr[0].rrn, '880505-2******');
});

test('내 인사 정보: 이미 일하는 직원도 한 번 넣어요(비밀번호·동의), 넣으면 안내가 사라지고 고칠 땐 주민번호를 비워도 돼요', () => {
  const g = v3({ hr: false });
  g.setKst('2026-11-16 09:30');
  assert.throws(() => punch(g, '김민우', '0123', 'in'), /인사 정보를 먼저 다 넣어야 출근이 찍혀요/);
  assert.equal(g.gs.getHome('김민우', '0123').hr, true);
  const f = { rrn: '900202-1234567', phone: '010-2222-3333', addr: '서울', bank: '신한', account: '110-123-456789', emergency: '010-9999-8888 어머니', start: '2024-03-02', agree: true, device: PHONE.김민우 };
  assert.throws(() => g.gs.hrSave('김민우', '9999', f), /비밀번호/);
  assert.throws(() => g.gs.hrSave('김민우', '0123', { ...f, agree: false }), /동의/);
  assert.throws(() => g.gs.hrSave('김민우', '0123', { ...f, rrn: '' }), /주민등록번호를 넣어/);
  g.gs.hrSave('김민우', '0123', f);
  assert.equal(g.gs.getHome('김민우', '0123').hr, false);
  punch(g, '김민우', '0123', 'in'); // 다 넣었으니 출근이 찍혀요
  const h = hrRow(g, '김민우');
  assert.deepEqual([h['주민번호'], h['예금주'], h['휴대폰']], ['900202-1******', '김민우', '010-2222-3333']);
  assert.match(h['등록'], /본인 입력/);
  g.gs.hrSave('김민우', '0123', { ...f, rrn: '', phone: '010-4444-5555' });
  assert.equal(hrRow(g, '김민우')['주민번호'], '900202-1******', '비우면 그대로');
  assert.equal(g.gs.hrGet('김민우', '0123', PHONE.김민우).phone, '010-4444-5555');
  assert.equal(g.gs.hrGet('김민우', '0123', PHONE.김민우).rrn, '900202-1******', '본인에게도 가린 번호만');
  assert.equal(g.gs.adminHrRrn('582941', '김민우').rrn, '900202-1234567');
  assert.throws(() => g.gs.adminHrRrn(MGR, '김민우'), /관리자/);
});

test('인사 카드: 목록은 지점 순서(퇴사는 아래), 사장님이 입사일·연락처·비고를 고치고 주민번호는 13자리를 넣을 때만 바꿔요', () => {
  const g = v3({ hr: false });
  g.setKst('2026-11-16 15:00');
  const list = g.gs.adminHrList('582941');
  assert.deepEqual(plain(list.list.map((x) => x.name)), ['김민우', '박점장', '이지은', '최유나', '박퇴사']);
  // 점장: 자기 매장(왕십리)에서 근무 중인 직원의 이름·휴대폰만 봐요(주민번호·계좌·입사일·퇴사자는 사장님만)
  g.gs.adminHrSave('582941', '김민우', { phone: '010-7777-8888', account: '110-123-456789', bank: '신한' });
  const ml = plain(g.gs.adminHrList(MGR));
  assert.equal(ml.mgr, true);
  assert.deepEqual(ml.list, [{ name: '김민우', store: '왕십리', state: '근무', phone: '010-7777-8888', phone2: '' }, { name: '박점장', store: '왕십리', state: '근무', phone: '', phone2: '' }]);
  assert.throws(() => g.gs.adminHrGet(MGR, '김민우'), /관리자/, '인사 카드는 사장님만');
  assert.throws(() => g.gs.adminHrRrn(MGR, '김민우'), /관리자/);
  const c = g.gs.adminHrSave('582941', '이지은', { start: '2025.3.2', phone: '01055556666', addr: '서울 금천구', bank: '우리', account: '1002-123-456789', memo: '보건증 2027-01 만료' });
  assert.deepEqual([c.start, c.phone, c.memo, c.hasRrn], ['2025-03-02', '010-5555-6666', '보건증 2027-01 만료', false]);
  assert.match(c.reg, /2026-11-16 사장님 고침/);
  assert.throws(() => g.gs.adminHrSave('582941', '이지은', { phone: '1234' }), /휴대폰/);
  assert.throws(() => g.gs.adminHrSave('582941', '이지은', { rrn: '123' }), /주민등록번호/);
  const c2 = g.gs.adminHrSave('582941', '이지은', { ...c, rrn: '970707-2123456' });
  assert.deepEqual([c2.rrn, c2.birth, c2.hasRrn], ['970707-2******', '97년생', true]);
  const c3 = g.gs.adminHrSave('582941', '이지은', { ...c2 }); // 가린 번호 그대로 보내면 안 바뀌어요
  assert.equal(g.gs.adminHrRrn('582941', '이지은').rrn, '970707-2123456');
  assert.equal(c3.memo, '보건증 2027-01 만료');
});

test('지점 이동: [직원] 매장·[인사] 이동 기록이 바뀌고, 휴무표 줄이 기록째 새 지점 묶음으로 옮겨가요', () => {
  const g = v3();
  g.setKst('2026-11-16 14:00');
  g.gs.setMark_('2026-11-10', '김민우', () => '휴무');
  const c = g.gs.adminMove('582941', '김민우', '가산', '2026-11-16');
  assert.equal(c.store, '가산');
  assert.equal(c.moves, '2026-11-16 왕십리→가산');
  assert.equal(c.first, '왕십리');
  assert.equal(g.gs.findStaff_('김민우').store, '가산');
  for (const ym of ['2026-11', '2026-12']) {
    const me = monthRowOf(g, ym, '김민우');
    assert.equal(me.v[1], '가산');
    assert.ok(me.r > monthRowOf(g, ym, '이지은').r && me.r > monthRowOf(g, ym, '최유나').r, ym + ' 가산 묶음 끝으로');
    assert.ok(me.r > monthRowOf(g, ym, '박점장').r);
  }
  const me = monthRowOf(g, '2026-11', '김민우');
  assert.equal(g.gs.dayMark_('김민우', '2026-11-10'), '휴무', '그달 기록은 그대로');
  assert.match(g.sheet('휴무표 2026-11').notes[me.r + ',2'], /2026-11-16 왕십리→가산/);
  assert.match(String(g.sheet('휴무표 2026-11').cells.get(me.r + ',4')), new RegExp('K' + me.r + ':AO' + me.r), '휴무 수식이 자기 줄을 봐요');
  assert.throws(() => g.gs.adminMove('582941', '김민우', '가산'), /이미 가산/);
  assert.throws(() => g.gs.adminMove('582941', '이지은', '왕십리', '2027-06-01'), /석 달 안/);
  assert.throws(() => g.gs.adminMove(MGR, '이지은', '왕십리'), /관리자/);
});

test('퇴사 처리: 앱 명단에서 빠지고 [인사]에 상태·퇴사일이 남아요', () => {
  const g = v3();
  const c = g.gs.adminRetire('582941', '최유나', '2026-11-15');
  assert.deepEqual([c.state, c.end], ['퇴사', '2026-11-15']);
  assert.ok(!g.gs.getStaffList().staff.some((s) => s.name === '최유나'));
  assert.equal(g.gs.findStaff_('최유나').active, false);
  assert.throws(() => g.gs.adminRetire('582941', '최유나'), /이미 퇴사/);
});

test('시트에서 고쳐도 맞춰요: [직원] 매장, [인사] 지점·상태, [인사]에 적은 주민번호는 저절로 가려요', () => {
  const g = v3();
  g.setKst('2026-11-16 14:00');
  const st = g.sheet('직원'), hs = g.sheet('인사');
  st.getRange(ROW.이지은, colOf(st, '매장')).setValue('왕십리');
  g.gs.onEdit({ range: st.getRange(ROW.이지은, colOf(st, '매장')) });
  assert.equal(hrRow(g, '이지은')['이동 기록'], '2026-11-16 가산→왕십리');
  assert.equal(monthRowOf(g, '2026-11', '이지은').v[1], '가산', '휴무표 줄 옮기기는 무거워서 바로 안 하고');
  g.gs.checkMissing(); // 10분마다 도는 검사가 옮겨요
  assert.equal(monthRowOf(g, '2026-11', '이지은').v[1], '왕십리');
  assert.match(g.sheet('휴무표 2026-11').notes[monthRowOf(g, '2026-11', '이지은').r + ',2'], /가산→왕십리/, '매장 칸 메모에 이동 기록');
  const r = g.gs.hrFind_('최유나').row;
  hs.getRange(r, colOf(hs, '지점')).setValue('왕십리');
  g.gs.onEdit({ range: hs.getRange(r, colOf(hs, '지점')) });
  assert.equal(g.gs.findStaff_('최유나').store, '왕십리');
  assert.equal(hrRow(g, '최유나')['이동 기록'], '2026-11-16 가산→왕십리');
  hs.getRange(r, colOf(hs, '상태')).setValue('퇴사');
  g.gs.onEdit({ range: hs.getRange(r, colOf(hs, '상태')) });
  assert.equal(g.gs.findStaff_('최유나').active, false);
  assert.equal(hrRow(g, '최유나')['퇴사일'], '2026-11-16');
  const r2 = g.gs.hrFind_('김민우').row;
  hs.getRange(r2, colOf(hs, '주민번호')).setValue('9001011234567');
  g.gs.onEdit({ range: hs.getRange(r2, colOf(hs, '주민번호')) });
  assert.equal(hrRow(g, '김민우')['주민번호'], '900101-1******');
  assert.equal(g.gs.adminHrRrn('582941', '김민우').rrn, '900101-1234567');
  assert.ok(!allCells(g).includes('9001011234567'));
  // 새 직원을 [직원] 탭에 적으면 [인사]에도 줄이 생겨요
  st.getRange(7, 1, 1, 2).setValues([['오신규', '가산']]);
  g.gs.onEdit({ range: st.getRange(7, 1, 1, 2) });
  assert.equal(hrRow(g, '오신규')['지점'], '가산');
});

test('연락처 저장: "한신입 95년생" 연락처 파일 주소(10분), 아이폰은 바로 열고 안드로이드는 파일로 받아요', () => {
  const g = v3({ hr: false });
  g.gs.joinSubmit(joinForm());
  g.gs.adminJoin('582941', '한신입', true);
  const r = g.gs.adminContact('582941', ['한신입']);
  assert.match(r.url, /^https:\/\/script\.google\.com\/macros\/s\/TEST\/exec\?vcf=[0-9a-f-]{36}$/);
  assert.deepEqual(plain(r.names), ['한신입 95년생']);
  const token = r.url.split('vcf=')[1];
  const out = g.gs.doGet({ parameter: { vcf: token } });
  assert.equal(out.mime, 'VCARD');
  assert.equal(out.file, '', '아이폰: 바로 연락처 화면');
  assert.equal(out.text, 'BEGIN:VCARD\r\nVERSION:3.0\r\nN:;한신입 95년생;;;\r\nFN:한신입 95년생\r\nORG:왕십리\r\nTEL;TYPE=CELL:010-1234-5678\r\nEND:VCARD\r\n');
  assert.equal(g.gs.doGet({ parameter: { vcf: token, dl: '1' } }).file, 'contact.vcf', '안드로이드: 파일로');
  assert.match(g.gs.doGet({ parameter: { vcf: 'nope' } }).text, /만료/);
  // 점장: 자기 매장 직원 연락처만(생년은 안 붙여요), 다른 매장 직원은 안 돼요
  const mc = g.gs.adminContact(MGR, ['한신입']);
  assert.deepEqual(plain(mc.names), ['한신입']);
  assert.throws(() => g.gs.adminContact(MGR, ['이지은']), /휴대폰 번호가 아직 없어요/, '다른 매장(가산) 직원은 점장이 못 받아요');
  assert.throws(() => g.gs.adminContact('582941', ['김민우']), /휴대폰 번호가 아직 없어요/);
  g.gs.adminHrSave('582941', '김민우', { phone: '010-7777-8888' });
  const all = g.gs.adminContact('582941');
  assert.deepEqual(plain(all.names), ['김민우', '한신입 95년생'], '모두: 휴대폰 있는 근무 중 직원(주민번호 없으면 이름만)');
});

/* ───── 월차 자동 계산: 만근이면 다음 달 1개, 결근만 만근을 깨요(무급 승인은 괜찮음), 1월 이월 없음 ───── */

// 예전 모양(만근 칸 없음) 휴무표 탭을 직접 만들어요. out=true면 더 예전 모양(J열 '아웃', K열부터 1일)
const oldMonth = (g, ym, out, marks = {}) => {
  const sh = g.sheet('휴무표 ' + ym);
  sh.clear();
  const m = Number(ym.slice(5)), n = new Date(Date.UTC(Number(ym.slice(0, 4)), m, 0)).getUTCDate();
  const d1 = out ? 10 : 9; // 0부터
  const head = ['No', '매장', '이름', '휴무', '월차', '이월', '부여', '잔여', '지각'].concat(out ? ['아웃'] : []);
  for (let d = 1; d <= 31; d++) head.push(d <= n ? m + '/' + d : '');
  head.push('메모');
  const W = head.length;
  if (sh.getMaxColumns() < W) sh.insertColumnsAfter(sh.getMaxColumns(), W - sh.getMaxColumns());
  sh.getRange(1, 1, 1, W).setValues([head]);
  const a = g.gs.colA1_(d1 + 1), b = g.gs.colA1_(d1 + 31);
  [['김민우', '왕십리'], ['이지은', '가산']].forEach(([name, store], i) => {
    const r = 3 + i, days = `${a}${r}:${b}${r}`;
    const row = ['=ROW()-2', store, name, `=COUNTIF(${days},"*휴무*")`, `=COUNTIF(${days},"*월차*")`, 0, 1, `=F${r}+G${r}-E${r}`,
      `=SUMPRODUCT(--ISNUMBER(SEARCH(":",${days})))`].concat(out ? ['=1+1'] : []);
    for (let d = 1; d <= 31; d++) row.push((marks[name] || {})[d] || '');
    row.push('');
    sh.getRange(r, 1, 1, W).setNumberFormat('@');
    sh.getRange(r, 1, 1, W).setValues([row]);
  });
  g.props.delete('linked:' + ym); // 예전 버전이 만든 탭(이월 0·부여 1이 숫자로 적혀 있음)처럼
  g.gs.GRID_ = {};
  return sh;
};

test('월차: 예전 휴무표 탭에 만근 칸을 끼워 넣어요(기록·수식은 한 칸씩 옮겨지고, 다음 달 부여는 전달 만근으로)', () => {
  const g = v3();
  const nov = oldMonth(g, '2026-11', false, { 김민우: { 5: '결근?' }, 이지은: { 3: '무급' } });
  const dec = oldMonth(g, '2026-12', false);
  g.gs.setup();
  const h = nov.rowDisplay(1);
  assert.deepEqual([h[8], h[9], h[10]], ['지각', '만근', '11/1'], '지각 다음, 첫 날짜 앞에');
  assert.equal(mark(g, '김민우', '2026-11-05'), '결근?', '기록은 날짜 칸과 같이 옮겨가요');
  assert.equal(mark(g, '이지은', '2026-11-03'), '무급');
  assert.equal(nov.getRange(3, 4).getValue(), '=COUNTIF(K3:AO3,"*휴무*")', '날짜 칸을 보는 수식도 한 칸씩');
  assert.ok(String(nov.getRange(3, 10).getValue()).includes('REGEXMATCH(K3:AO3&"","결근|무단")'), '만근 수식');
  assert.equal(nov.getRange(3, 7).getValue(), 1, '11월 부여는 그대로(10월 탭이 없어서 만근을 몰라요)');
  assert.match(String(dec.getRange(3, 7).getValue()), /MATCH\("만근",'휴무표 2026-11'!\$1:\$1,0\)/, '12월 부여 = 11월 만근이면 1');
  assert.equal(dec.rowDisplay(2)[6], '전달 만근');
  assert.equal(dec.getRange(3, 6).getValue(), "=IFERROR(VLOOKUP($C3,'휴무표 2026-11'!$C:$H,6,FALSE),0)", '12월 이월: 앱이 넣었던 0은 11월 탭과 이어지는 수식으로');
  assert.equal(nov.getRange(3, 6).getValue(), 0, '11월 이월은 그대로(10월 탭이 없어요)');
  const pj = monthRowOf(g, '2026-11', '박점장');
  assert.ok(pj && String(pj.v[9]).startsWith('=IF(SUMPRODUCT(--REGEXMATCH('), '그 뒤에 넣은 직원 줄도 만근 수식');
  g.gs.setup();
  assert.equal(nov.rowDisplay(1).filter((x) => x === '만근').length, 1, '다시 실행해도 한 번만');
});

test('월차: 더 예전 탭(J열 아웃)이면 아웃은 그대로 두고 그 뒤(첫 날짜 앞)에 만근 칸', () => {
  const g = v3();
  const nov = oldMonth(g, '2026-11', true, { 김민우: { 18: '월차' } });
  g.gs.ensureMonth_('2026-11');
  const h = nov.rowDisplay(1);
  assert.deepEqual([h[9], h[10], h[11]], ['아웃', '만근', '11/1']);
  assert.equal(nov.getRange(3, 10).getValue(), '=1+1', '아웃 칸은 안 건드려요');
  assert.ok(String(nov.getRange(3, 11).getValue()).includes('REGEXMATCH(L3:AP3&"","결근|무단")'));
  assert.equal(mark(g, '김민우', '2026-11-18'), '월차');
  const pj = monthRowOf(g, '2026-11', '박점장');
  assert.equal(pj.v[9], '', '새 줄도 아웃 칸은 비우고');
  assert.ok(String(pj.v[10]).startsWith('=IF(SUMPRODUCT(--REGEXMATCH(L'), '만근 칸에 수식');
});

test('월차: 직원 근무표에 이 달 만근(다음 달 월차 1개) 또는 못 한 이유가 보여요', () => {
  const g = v3();
  g.setKst('2026-11-18 10:00');
  const nov = g.sheet('휴무표 2026-11');
  const r = monthRowOf(g, '2026-11', '김민우').r;
  // 시트가 계산한 값처럼 넣어 봐요
  nov.getRange(r, 7, 1, 2).setValues([[1, 0]]);
  nov.getRange(r, 10).setValue('아님: 11/5 결근?');
  let sd = g.gs.getSchedule('김민우', '0123', '2026-11');
  assert.deepEqual([sd.sum.full, sd.sum.grant, sd.sum.monthlyLeft], ['아님: 11/5 결근?', 1, 0]);
  nov.getRange(r, 10).setValue('만근 예정');
  sd = g.gs.getSchedule('김민우', '0123', '2026-11');
  assert.equal(sd.sum.full, '만근 예정');
  // 사장님 1년 보기·[직원 1년] 탭: 달마다 만근·부여
  nov.getRange(r, 10).setValue('만근');
  const y = g.gs.adminYear('582941', '김민우', '2026');
  assert.deepEqual([y.months[10].full, y.months[10].grant, y.total.fullMonths, y.total.full], ['만근', 1, 1, '만근 1달']);
  const yt = g.sheet('직원 1년');
  yt.getRange(3, 2).setValue('김민우');
  yt.getRange(3, 4).setValue('2026');
  g.gs.onEdit({ range: yt.getRange(3, 2) });
  const head = sheetRows(yt).find((x) => x[0] === '월' && x[1] === '근무일');
  const novRow = sheetRows(yt).find((x) => x[0] === '11월' && x.length > 16 && x[16] !== undefined);
  assert.equal(head[8], '월차 부여');
  assert.equal(head[16], '만근(아니면 이유)');
  assert.deepEqual([novRow[8], novRow[16]], ['1', '만근']);
});

test('무급: 결근한 날(지난 14일 안)을 무급으로 바꿔 달라고 하면, 승인 때 결근?이 무급으로 바뀌어요', () => {
  const g = v3();
  g.setKst('2026-11-18 10:00');
  g.gs.setMark_('2026-11-16', '이지은', () => '결근?');
  req(g, '이지은', '5678', 'off', { offType: '무급', date: '2026-11-16', reason: '아파서 못 나옴', to: 'admin' });
  const t = g.gs.adminToday('582941');
  const q = t.requests.find((x) => x.kind === '무급');
  assert.ok(q, '무급 요청이 사장님 화면에');
  g.gs.adminRequest('582941', q.id, true);
  assert.equal(mark(g, '이지은', '2026-11-16'), '무급', '결근? → 무급(만근이 안 깨져요)');
  assert.throws(() => req(g, '이지은', '5678', 'off', { offType: '무급', date: '2026-11-02', reason: '아파서' }), /14일 전부터/);
  assert.throws(() => req(g, '이지은', '5678', 'off', { offType: '휴무', date: '2026-11-17', reason: '쉬고 싶어요' }), /'결근'으로 적힌 날만/, '결근으로 안 적힌 지난 날은 못 골라요');
  assert.throws(() => req(g, '이지은', '5678', 'off', { offType: '반차', date: '2026-11-17', reason: '반차' }), /지난 날짜는 고를 수 없어요/);
});

test('월차 요청: 사장님 화면에 그달 남은 월차를 같이 보여줘요(없으면 경고)', () => {
  const g = v3();
  g.setKst('2026-11-18 10:00');
  const nov = g.sheet('휴무표 2026-11');
  const r = monthRowOf(g, '2026-11', '이지은').r;
  nov.getRange(r, 8).setValue(0); // 시트가 계산한 잔여처럼
  req(g, '이지은', '5678', 'off', { offType: '월차', date: '2026-11-24', reason: '병원', to: 'admin' });
  const note = () => g.gs.adminToday('582941').requests.find((x) => x.kind === '월차').note || '';
  assert.match(note(), /남은 월차가 없어요\(잔여 0\)/);
  nov.getRange(r, 8).setValue(2);
  assert.match(note(), /남은 월차 2개/);
});

test('setup: 단계마다 알려주고(누를 때까지 기다리는 창 없음), 4분이 넘으면 멈췄다가 다시 실행하면 끝난 단계는 건너뛰어요', () => {
  const g = v3();
  const toasts = [];
  g.book.toast = (m) => toasts.push(m);
  const steps = g.gs.SETUP_STEPS;
  const slow = steps[1][1];
  steps[1][1] = function (ss) { g.setKst('2026-11-16 09:05'); return slow(ss); }; // 2단계가 5분 걸린 것처럼
  g.sheet('직원 1년').clear();
  const msg = g.gs.setup();
  assert.match(msg, /2\/8단계까지 하고 멈췄어요\. setup을 한 번 더 실행하면 이어서 해요/);
  assert.equal(toasts[0], '1/8 설정 탭 맞추는 중…');
  assert.equal(toasts.at(-1), msg, '멈춘 것도 시트 알림으로');
  assert.ok(!g.sheet('직원 1년').getRange(3, 4).getDataValidation(), '멈춘 뒤 단계는 아직 안 했어요');
  steps[1][1] = slow;
  const calls = [];
  steps.forEach((st, i) => { const f = st[1]; st[1] = function (ss) { calls.push(i + 1); return f(ss); }; });
  assert.match(g.gs.setup(), /^설정 완료! \(\d+초\)/);
  assert.deepEqual(plain(calls), [3, 4, 5, 6, 7, 8], '끝난 1·2단계는 건너뛰고 이어서');
  assert.ok(g.sheet('직원 1년').getRange(3, 4).getDataValidation());
  assert.equal(g.props.get('setupRun'), undefined, '다 끝나면 이어서 할 기록을 지워요');
  calls.length = 0;
  g.gs.setup();
  assert.deepEqual(plain(calls), [1, 2, 3, 4, 5, 6, 7, 8], '다음 setup은 처음부터 다');
});

/* ───── 휴대폰 번호 여러 개 ───── */

test('추가 휴대폰: 2개까지, 번호 뒤 메모, 대표 번호와 겹치면 빼고, 이상한 번호는 알려줘요', () => {
  const { gs } = createGas({ now: 0 });
  assert.equal(gs.phones2_(['01011112222 업무용', '010-3333-4444'], '010-1234-5678'), '010-1111-2222 업무용, 010-3333-4444');
  assert.equal(gs.phones2_('010-1111-2222(업무), 010 1234 5678', '010-1234-5678'), '010-1111-2222 업무', '대표 번호와 같은 번호는 빼요');
  assert.equal(gs.phones2_(['', '  '], '010-1234-5678'), '');
  assert.equal(gs.phones2_(undefined, '010-1234-5678'), '');
  assert.equal(gs.phones2_('+82 10-9999-8888 해외', ''), '010-9999-8888 해외');
  assert.throws(() => gs.phones2_(['010-1111-222'], ''), /추가 휴대폰 번호를 확인/);
  assert.throws(() => gs.phones2_(['업무용'], ''), /추가 휴대폰 번호를 확인/);
  assert.throws(() => gs.phones2_('010-1111-2222, 010-3333-4444, 010-5555-6666', ''), /2개까지/);
  assert.deepEqual(plain(gs.phones2List_('010-1111-2222 업무용, 이상한 값, 010-3333-4444')), [{ num: '010-1111-2222', memo: '업무용' }, { num: '010-3333-4444', memo: '' }]);
});

test('추가 휴대폰: 입사 등록·내 정보·인사 카드에 저장되고, 연락처에는 번호가 모두 들어가요', () => {
  const g = v3();
  g.gs.joinSubmit(joinForm({ phone2: ['010-1111-2222 업무용'] }));
  assert.equal(hrRow(g, '한신입')['휴대폰2'], '010-1111-2222 업무용');
  assert.equal(g.gs.adminToday('582941').joins[0].phone2, '010-1111-2222 업무용');
  assert.throws(() => g.gs.joinSubmit(joinForm({ phone2: ['12345'] })), /추가 휴대폰 번호를 확인/);
  g.gs.adminJoin('582941', '한신입', true);
  assert.equal(hrRow(g, '한신입')['휴대폰2'], '010-1111-2222 업무용', '승인 뒤에도 그대로');
  const out = g.gs.doGet({ parameter: { vcf: g.gs.adminContact('582941', ['한신입']).url.split('vcf=')[1] } });
  assert.match(out.text, /TEL;TYPE=CELL:010-1234-5678\r\nTEL;TYPE=WORK:010-1111-2222\r\nEND:VCARD/);
  // 직원 본인: 추가 번호를 더하고, 칸을 비워 보내면 지워져요. 칸을 안 보내면(예전 화면) 그대로
  const mine = { rrn: '', phone: '010-1234-5678', addr: '서울', bank: '국민', account: '123456-78-901234', emergency: '010-9999-8888 어머니', agree: true, device: NEWPHONE };
  g.gs.hrSave('한신입', '4826', { ...mine, phone2: ['010-1111-2222 업무용', '010-3333-4444'] });
  assert.equal(g.gs.hrGet('한신입', '4826', NEWPHONE).phone2, '010-1111-2222 업무용, 010-3333-4444');
  g.gs.hrSave('한신입', '4826', mine);
  assert.equal(hrRow(g, '한신입')['휴대폰2'], '010-1111-2222 업무용, 010-3333-4444', '칸을 안 보내면 그대로');
  g.gs.hrSave('한신입', '4826', { ...mine, phone2: [] });
  assert.equal(hrRow(g, '한신입')['휴대폰2'], '');
  // 사장님 인사 카드: 글자로 고쳐요
  const c = g.gs.adminHrSave('582941', '한신입', { phone: '010-1234-5678', phone2: '010-7777-8888 개인' });
  assert.equal(c.phone2, '010-7777-8888 개인');
  assert.equal(g.gs.adminHrList('582941').list.find((x) => x.name === '한신입').phone2, '010-7777-8888 개인');
  // 대표 번호 없이 추가 번호만 있어도 연락처로 저장돼요
  g.gs.adminHrSave('582941', '김민우', { phone: '', phone2: '010-2020-3030' });
  assert.match(g.gs.doGet({ parameter: { vcf: g.gs.adminContact('582941', ['김민우']).url.split('vcf=')[1] } }).text, /TEL;TYPE=CELL:010-2020-3030/);
});

test('추가 휴대폰: 예전 [인사] 탭에는 setup이 휴대폰 바로 옆에 칸을 끼워 넣어요(내용·숨긴 칸은 그대로)', () => {
  const g = v3();
  g.gs.adminHrSave('582941', '김민우', { phone: '010-2222-3333', addr: '서울 성동구' });
  const hs = g.sheet('인사');
  // 예전 모양으로 되돌려요: 휴대폰2 칸을 지운 [인사] 탭
  const c2 = colOf(hs, '휴대폰2');
  const width = hs.getLastColumn();
  const last = hs.getLastRow();
  for (let r = 1; r <= last; r++) {
    const v = hs.getRange(r, 1, 1, width).getDisplayValues()[0];
    v.splice(c2 - 1, 1);
    v.push('');
    hs.getRange(r, 1, 1, width).setValues([v]);
  }
  hs.hidden = { [colOf(hs, '주민번호(암호)')]: true, [colOf(hs, '가입(임시)')]: true };
  assert.equal(colOf(hs, '휴대폰2'), 0);
  assert.equal(hrRow(g, '김민우')['주소'], '서울 성동구');
  g.gs.setup();
  assert.equal(colOf(hs, '휴대폰2'), colOf(hs, '휴대폰') + 1, '휴대폰 바로 오른쪽');
  assert.equal(colOf(hs, '주소'), colOf(hs, '휴대폰') + 2);
  const k = hrRow(g, '김민우');
  assert.deepEqual([k['휴대폰'], k['휴대폰2'], k['주소']], ['010-2222-3333', '', '서울 성동구'], '내용은 칸과 같이 옮겨가요');
  assert.ok(hs.hidden[colOf(hs, '주민번호(암호)')] && hs.hidden[colOf(hs, '가입(임시)')], '숨긴 칸은 그대로 숨겨져요');
  assert.match(hs.notes['1,' + colOf(hs, '휴대폰2')], /두 번째·세 번째 번호/);
  g.gs.setup();
  assert.equal(hs.rowDisplay(1).filter((x) => x === '휴대폰2').length, 1, '다시 실행해도 한 번만');
});

/* ───── 앱 시작일: 직원들이 찍기 시작하기 전에는 알림·결근?을 안 해요 ───── */

test('앱 시작일: 정하기 전(시작 전)에는 미출근 알림·결근?·마감 알림이 없고, 오늘 화면도 미출근으로 안 세요', () => {
  const g = v3({ email: 'owner@example.com' });
  g.gs.setSetting_('앱시작일', '');
  g.setKst('2026-11-16 11:30');
  g.gs.checkMissing();
  assert.equal(g.mails.length, 0, '미출근 알림 없음');
  const t = g.gs.adminToday('582941');
  assert.deepEqual([t.started, t.startDate], [false, '']);
  assert.ok(t.list.every((x) => x.status !== '미출근'), '오늘 화면에 미출근 없음: ' + t.list.map((x) => x.status).join(','));
  g.setKst('2026-11-16 23:40');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민우', '2026-11-16'), '', "결근?을 안 적어요");
  assert.equal(g.mails.length, 0, '하루 마감 알림도 없음');
  // 찍는 건 시작 전에도 돼요(미리 써 보기)
  g.setKst('2026-11-17 09:58');
  assert.equal(punch(g, '김민우', '0123', 'in').type, 'in');
});

test("앱 시작일: 시작 전에 잘못 적힌 '결근?'은 지우고(사장님이 적은 '결근'은 그대로), 시작일부터는 평소대로 적어요", () => {
  const g = v3({ email: 'owner@example.com' });
  g.setKst('2026-11-20 23:40');
  g.gs.checkMissing(); // 시작한 상태: 안 찍은 사람에게 결근?
  assert.equal(mark(g, '김민우', '2026-11-20'), '결근?');
  g.gs.setMark_('2026-11-12', '이지은', () => '결근'); // 사장님이 손으로 적은 것
  g.gs.setMark_('2026-11-13', '이지은', () => '결근?');
  // 사장님이 "아직 시작 전"으로 되돌리면 잘못 적힌 결근?이 지워져요
  assert.throws(() => g.gs.adminSetStart(MGR, ''), /관리자/);
  const r = g.gs.adminSetStart('582941', '');
  assert.ok(r.cleared >= 2, '지운 칸 수: ' + r.cleared);
  assert.equal(mark(g, '김민우', '2026-11-20'), '');
  assert.equal(mark(g, '이지은', '2026-11-13'), '');
  assert.equal(mark(g, '이지은', '2026-11-12'), '결근', "딱 '결근?'만 지워요");
  assert.equal(setting(g, '앱시작일'), '');
  // 시작일을 12/1로: 그 전 날은 계속 안 적고, 12/1 밤부터 적어요
  assert.throws(() => g.gs.adminSetStart('582941', '12월 첫날'), /날짜를 확인/);
  const r2 = g.gs.adminSetStart('582941', '2026.12.1');
  assert.deepEqual([r2.startDate, r2.started], ['2026-12-01', false]);
  g.mails.length = 0;
  g.setKst('2026-11-30 23:40');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민우', '2026-11-30'), '');
  assert.equal(g.mails.length, 0);
  g.setKst('2026-12-01 11:20');
  g.gs.checkMissing();
  assert.ok(g.mails.some((m) => /아직 출근 안 찍은 직원/.test(m.subject + m.body)), '시작일부터 미출근 알림');
  g.setKst('2026-12-01 23:40');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민우', '2026-12-01'), '결근?');
  assert.equal(g.gs.adminToday('582941').started, true);
});

test("앱 시작일: 시작 전이면 밤 정리·setup이 예전에 적힌 '결근?'을 치워요(이미 쌓인 것 정리)", () => {
  const g = v3();
  g.setKst('2026-11-20 23:40');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민우', '2026-11-20'), '결근?');
  g.gs.setSetting_('앱시작일', ''); // 새 버전을 붙여넣은 직후: 설정 칸이 비어 있어요
  g.gs.setup();
  assert.equal(mark(g, '김민우', '2026-11-20'), '', 'setup이 치워요');
  g.gs.setMark_('2026-11-21', '김민우', () => '결근?');
  g.setKst('2026-11-21 23:40');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민우', '2026-11-21'), '', '밤 정리도 치워요');
});

/* ───── 월차 수식 잇기: 앞 달 탭이 나중에 생겨도, 예전 탭도, 사장님이 적은 숫자는 그대로 ───── */

test('월차 수식 잇기: 다다음 달 탭이 먼저 생겨도, 사이 달 탭이 생기면 이월·부여를 다시 이어요', () => {
  const g = v3();
  g.setKst('2026-11-10 10:00');
  // 1월 5일 휴무를 미리 승인: 12월 탭은 있고(setup), 2월 탭이 1월 탭보다 먼저 생기는 경우를 흉내 내요
  g.gs.setMark_('2027-02-05', '김민우', () => '휴무');
  const feb = g.sheet('휴무표 2027-02');
  const r = monthRowOf(g, '2027-02', '김민우').r;
  const writes = () => feb.writeLog.filter((w) => w.r <= r && r < w.r + w.nr && w.c <= 6 && 6 < w.c + w.nc).length;
  assert.match(String(feb.getRange(r, 6).getValue()), /'휴무표 2027-01'!\$C:\$H/, '1월 탭이 없어도 수식으로 적어 둬요');
  assert.match(String(feb.getRange(r, 7).getValue()), /MATCH\("만근",'휴무표 2027-01'!\$1:\$1,0\)/);
  const before = writes();
  assert.ok(!g.sheet('휴무표 2027-01'));
  g.gs.setMark_('2027-01-07', '김민우', () => '휴무'); // 이제 1월 탭이 생겨요
  assert.ok(g.sheet('휴무표 2027-01'));
  assert.ok(writes() > before, '1월 탭이 생기면 2월 탭의 이월·부여 수식을 다시 적어요(구글 시트는 저절로 안 이어 줘요)');
  const jan = monthRowOf(g, '2027-01', '김민우').r;
  assert.equal(g.sheet('휴무표 2027-01').getRange(jan, 6).getValue(), 0, '1월 이월은 0');
  assert.match(String(g.sheet('휴무표 2027-01').getRange(jan, 7).getValue()), /'휴무표 2026-12'/, '1월 부여는 12월 만근');
});

test('월차 수식 잇기: 사장님이 직접 적은 이월·부여 숫자와 만근 글자는 그대로 두고, 앱이 넣은 값만 수식으로 바꿔요', () => {
  const g = v3();
  const dec = g.sheet('휴무표 2026-12');
  const kim = monthRowOf(g, '2026-12', '김민우').r, lee = monthRowOf(g, '2026-12', '이지은').r, park = monthRowOf(g, '2026-12', '박점장').r;
  dec.getRange(kim, 6, 1, 2).setValues([[3, 2]]); // 사장님이 이월 3, 부여 2로 직접
  dec.getRange(lee, 6, 1, 2).setValues([[0, 1]]); // 앱이 예전에 넣었을 값
  dec.getRange(park, 10).setValue('만근'); // 사장님이 만근 칸에 직접 적음
  g.props.delete('linked:2026-12'); // 예전 버전이 만든 탭: 숫자 0·1을 수식으로 바꾸는 건 처음 이을 때 한 번만
  const kept = g.gs.relinkMonth_('2026-12');
  assert.equal(kept, 2, '그대로 둔 칸 수');
  assert.deepEqual(plain(dec.getRange(kim, 6, 1, 2).getValues()[0]), [3, 2]);
  assert.match(String(dec.getRange(lee, 6).getValue()), /^=IFERROR\(VLOOKUP\(\$C/);
  assert.match(String(dec.getRange(lee, 7).getValue()), /^=IF\(LEFT\(IFERROR\(INDEX\('휴무표 2026-11'/);
  assert.equal(dec.getRange(park, 10).getValue(), '만근', '직접 적은 만근은 그대로');
  assert.match(String(dec.getRange(lee, 8).getValue()), /^=F\d+\+G\d+-E\d+$/, '잔여 수식은 그대로');
  // setup을 다시 돌려도 같아요
  g.gs.setup();
  assert.deepEqual(plain(dec.getRange(kim, 6, 1, 2).getValues()[0]), [3, 2]);
  // 한 번 이은 뒤에 사장님이 적은 숫자는 0·1이라도 그대로 둬요(재량으로 준 월차 1개, 일부러 0)
  dec.getRange(lee, 6, 1, 2).setValues([[0, 1]]);
  g.gs.setup();
  assert.deepEqual(plain(dec.getRange(lee, 6, 1, 2).getValues()[0]), [0, 1]);
  // 지우면(빈칸) 다시 수식으로 돌아와요
  dec.getRange(lee, 6, 1, 2).setValues([['', '']]);
  g.gs.relinkMonth_('2026-12');
  assert.match(String(dec.getRange(lee, 7).getValue()), /^=IF\(LEFT\(IFERROR\(INDEX\('휴무표 2026-11'/);
});

/* ───── 예전 휴무표 가져오기 (가짜 이름으로 만든 예전 파일) ───── */

const OLD_ID = 'OLDFILE_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const OLD_URL = 'https://docs.google.com/spreadsheets/d/' + OLD_ID + '/edit#gid=0';
const { oldBlock } = require('./old-sample');
function oldFile(g, blocks, extraTabs = {}) {
  const rows = [];
  blocks.forEach((b) => rows.push(...b));
  return g.addBook(OLD_ID, { 휴무표: rows, ...extraTabs }, '★예전 파일');
}
// 가짜 한 해: 김민우(1월부터 쭉), 이지은(가산, 3월에 첫출근), 한퇴사(1~2월 다니고 퇴사), 오이동(1월 아라 → 2월 '10일 가산')
function oldYear(g) {
  const blocks = [
    oldBlock(2026, 1, [
      { store: '왕십리', name: '김민우', days: { 3: '휴무', 5: '11:8', 9: '12월차', 20: '11월차' } },
      { store: '왕십리', name: '한퇴사', days: { 4: '휴무', 12: '휴뮤' }, memo: '계약서 받음' },
      { store: '아라', name: '오이동', days: { 6: '휴무', 15: '가산' } },
      { store: '가산', name: '', days: { 1: '휴무' } }, // 이름 없는 줄
    ]),
    oldBlock(2026, 2, [
      { store: '왕십리', name: '김민우', days: { 2: '휴무', 14: '설날', 29: '휴무' } }, // 29일은 2월에 없는 날
      { store: '왕십리', name: '한퇴사', days: { 3: '휴무', 20: '마지막근무', 21: '퇴사' } },
      { store: '10일 가산', name: '오이동', days: { 5: '휴무', 18: '무단' } },
      { store: '가산', name: '이지은' }, // 미리 만들어 둔 빈 줄(3월에 첫출근)
    ]),
    oldBlock(2026, 3, [
      { store: '왕십리', name: '김민우', days: { 7: '1월차', 9: '11:20병원' } },
      { store: '가산', name: '오이동', days: { 8: '휴무' } },
      { store: '가산', name: '이지은', days: { 3: '첫출근', 10: '휴무', 17: '예외도불가' } },
    ]),
    oldBlock(2026, 12, [{ store: '왕십리', name: '김민우' }]), // 빈 틀
  ];
  return oldFile(g, blocks, { 굳폰: [['읽으면 안 되는 탭']] });
}
function importAll(g, year = '2026') {
  const v = g.gs.adminImportPreview('582941', OLD_URL, year);
  v.months.filter((m) => !m.skip).forEach((m) => g.gs.adminImportMonth('582941', OLD_URL, year, m.m));
  return g.gs.adminImportFinish('582941', OLD_URL, year);
}
const monthCells = (g, ym, name) => {
  const sh = g.sheet('휴무표 ' + ym);
  for (let r = 3; r <= sh.getLastRow(); r++) if (sh.rowDisplay(r)[2] === name) return { r, row: sh.rowDisplay(r), raw: sh.getRange(r, 1, 1, 42).getValues()[0] };
  return null;
};

test('예전 휴무표 가져오기: 미리 보기는 시트를 안 바꾸고, 무엇이 들어갈지 세어 줘요', () => {
  const g = v3();
  g.gs.setSetting_('앱시작일', '');
  g.setKst('2026-11-20 10:00');
  const old = oldYear(g);
  const asked = [];
  const get = old.getSheetByName;
  old.getSheetByName = (n) => { asked.push(n); return get(n); };
  const tabs = g.book.getSheets().map((x) => x.getName());
  const v = plain(g.gs.adminImportPreview('582941', OLD_URL, '2026'));
  assert.deepEqual(g.book.getSheets().map((x) => x.getName()), tabs, '탭이 안 생겨요');
  assert.deepEqual(asked.filter((n) => n !== '휴무표'), [], "예전 파일은 '휴무표' 탭만 읽어요");
  assert.equal(v.title, '★예전 파일');
  assert.deepEqual(v.months.map((m) => [m.m, m.people, m.exists]), [[1, 3, false], [2, 3, false], [3, 3, false]], '2월의 빈 줄(이지은)은 첫 기록이 있는 3월부터');
  assert.deepEqual(v.skipped, [12], '빈 틀인 12월은 건너뛰어요');
  assert.equal(v.nameless, 1);
  assert.equal(v.overflow, 1, '2월 29일 칸');
  assert.equal(v.typos, 1);
  assert.equal(v.times, 1, '11:8 → 11:08 (11:20병원은 그대로)');
  assert.deepEqual(v.mapped, [{ w: '아라→검단', n: 1 }]);
  assert.deepEqual(v.unknownStores, [{ w: '검단', n: 1 }], '[매장] 탭에 없는 매장은 알려줘요');
  assert.deepEqual(v.words, [{ w: '예외도불가', n: 1 }]);
  assert.deepEqual([v.people.total, v.people.inStaff, v.people.gone, v.people.joins, v.people.quits, v.people.moves], [4, 2, 1, 1, 1, 1]);
  assert.deepEqual(v.people.notInStaff, ['오이동'], '마지막 달에 있는데 [직원]에 없는 사람');
  assert.deepEqual(v.leave.carry, [{ name: '김민우', n: 1 }], '작년 월차 2개를 올해 씀 → 1월 부여 1 + 이월 1');
  assert.equal(setting(g, '예전휴무표주소'), OLD_URL, '주소를 기억해요');
  assert.throws(() => g.gs.adminImportPreview('000000', OLD_URL, '2026'), /비밀번호/);
  assert.throws(() => g.gs.adminImportPreview('582941', 'https://example.com/x', '2026'), /주소를 확인/);
  assert.throws(() => g.gs.adminImportPreview('582941', 'https://docs.google.com/spreadsheets/d/NOSUCHFILE_ABCDEFGHIJKLMNOP/edit', '2026'), /열 수 없어요/);
});

test('예전 휴무표 가져오기: 달마다 그때 명단으로 탭이 생기고, 칸은 앱이 읽는 모양으로, 월차는 이어서 계산돼요', () => {
  const g = v3();
  g.gs.setSetting_('앱시작일', '');
  g.setKst('2026-11-20 10:00');
  oldYear(g);
  const f = plain(importAll(g));
  assert.deepEqual([f.done.tabs, f.done.hrAdded], [5, 1], '1·2·3월 새 탭 + 원래 있던 11·12월, 퇴사자 1명');
  // 탭 순서: 새 달이 앞, 가져온 달은 그 뒤로 차례대로
  assert.deepEqual(g.book.getSheets().map((x) => x.getName()).filter((n) => /^휴무표/.test(n)),
    ['휴무표 2026-12', '휴무표 2026-11', '휴무표 2026-03', '휴무표 2026-02', '휴무표 2026-01']);
  // 1월: 그때 명단 3명(이름 없는 줄은 빠짐), 매장 순서([매장] 탭에 없는 검단은 맨 아래)
  const jan = g.sheet('휴무표 2026-01');
  assert.deepEqual([3, 4, 5].map((r) => jan.rowDisplay(r).slice(1, 3)), [['왕십리', '김민우'], ['왕십리', '한퇴사'], ['검단', '오이동']]);
  assert.equal(jan.getLastRow(), 5);
  const kim1 = monthCells(g, '2026-01', '김민우');
  assert.equal(kim1.row[10 + 2], '휴무');
  assert.equal(kim1.row[10 + 4], '11:08', '11:8 → 11:08 (지각 수식이 세는 모양)');
  assert.equal(kim1.row[10 + 8], '12월차');
  assert.equal(kim1.raw[5], 1, '1월 이월: 작년 월차를 올해 2개 썼으니 1(나머지 1개는 1월 부여)');
  assert.equal(kim1.raw[6], 1, '1월 부여 1(작년 12월 만근분)');
  assert.match(kim1.raw[7], /^=F3\+G3-E3$/);
  assert.match(kim1.raw[9], /^=IF\(SUMPRODUCT/, '만근은 수식');
  const han1 = monthCells(g, '2026-01', '한퇴사');
  assert.equal(han1.row[10 + 11], '휴무', "오타 '휴뮤'는 휴무로");
  assert.equal(han1.row[41], '계약서 받음', '메모 칸');
  assert.equal(han1.raw[5], 0);
  assert.equal(monthCells(g, '2026-01', '오이동').row[10 + 14], '가산', '다른 매장 이름(지원)은 그대로');
  // 2월: 29일 칸은 버리고, '10일 가산'은 매장 가산
  const feb = g.sheet('휴무표 2026-02');
  assert.deepEqual([3, 4, 5].map((r) => feb.rowDisplay(r).slice(1, 3)), [['왕십리', '김민우'], ['왕십리', '한퇴사'], ['가산', '오이동']]);
  const kim2 = monthCells(g, '2026-02', '김민우');
  assert.equal(kim2.row[10 + 13], '설날');
  assert.equal(kim2.row[10 + 28], '', '2월 29일 칸은 비어 있어요');
  assert.match(kim2.raw[5], /VLOOKUP\(\$C3,'휴무표 2026-01'!\$C:\$H,6,FALSE\)/, '이월은 1월 잔여를 잇는 수식');
  assert.match(kim2.raw[6], /'휴무표 2026-01'/, '부여는 1월 만근을 보는 수식');
  assert.ok(!monthCells(g, '2026-02', '이지은'), '첫 기록보다 앞에 미리 만든 빈 줄은 안 옮겨요');
  // 3월: 이지은은 3월부터
  const lee3 = monthCells(g, '2026-03', '이지은');
  assert.equal(lee3.row[10 + 2], '첫출근');
  assert.equal(lee3.row[10 + 16], '예외도불가', '모르는 말도 그대로 옮겨요');
  assert.equal(monthCells(g, '2026-03', '김민우').row[10 + 8], '11:20병원');
  assert.ok(!monthCells(g, '2026-03', '한퇴사'), '퇴사자는 다닌 달까지만');
  // 이미 있던 11월 탭: 줄은 그대로, 월차 수식이 앞 달과 이어짐(10월 탭이 없어서 0이 되는 수식)
  const kim11 = monthCells(g, '2026-11', '김민우');
  assert.match(kim11.raw[5], /'휴무표 2026-10'/);
  // 다시 눌러도 달라지는 게 없어요
  const again = plain(g.gs.adminImportPreview('582941', OLD_URL, '2026'));
  assert.ok(again.months.every((m) => m.exists && !m.add && !m.change && !m.clear));
  assert.deepEqual(again.hr, { add: 0, fill: 0 });
  assert.equal(again.last.year, '2026');
  assert.deepEqual(plain(g.gs.adminToday('582941').oldImport.months), [1, 2, 3]);
});

test('예전 휴무표 가져오기: 첫출근·퇴사·지점 이동이 [인사] 탭에 정리되고, 퇴사자도 1년 보기에 나와요', () => {
  const g = v3({ hr: false });
  g.gs.setSetting_('앱시작일', '');
  g.setKst('2026-11-20 10:00');
  oldYear(g);
  importAll(g);
  const lee = hrRow(g, '이지은');
  assert.equal(lee['입사일'], '2026-03-03', "'첫출근'이 적힌 날");
  const han = hrRow(g, '한퇴사');
  assert.deepEqual([han['지점'], han['상태'], han['퇴사일']], ['왕십리', '퇴사', '2026-02-21']);
  assert.match(han['비고'], /예전 휴무표 2026년 1~2월/);
  assert.equal(han['주민번호'], '', '이름·지점·기간만 적어요');
  assert.ok(!g.gs.findStaff_('한퇴사'), '[직원] 탭에는 안 넣어요(앱 명단에 안 나와요)');
  assert.ok(!hrRow(g, '오이동'), '아직 다니는 것 같은데 [직원]에 없는 사람은 사장님이 정해요(미리 보기에 알려줌)');
  // 사장님이 오이동을 [직원]에 넣은 뒤 다시 가져오면 이동 기록이 채워져요
  g.sheet('직원').getRange(7, 1, 1, 2).setValues([['오이동', '가산']]);
  importAll(g);
  assert.equal(hrRow(g, '오이동')['이동 기록'], '2026-02-10 검단→가산', "'10일 가산' = 2월 10일에 옮김");
  // 1년 보기: 퇴사자도, 지각은 휴무표에 적힌 시간으로, 지원 근무는 어디로 몇 번
  const list = plain(g.gs.adminToday('582941').gone);
  assert.ok(list.includes('한퇴사'));
  const y = plain(g.gs.adminYear('582941', '한퇴사', '2026'));
  assert.equal(y.gone, true);
  assert.deepEqual([y.months[0].off, y.months[1].off, y.months[2].any, y.store], [2, 1, false, '왕십리']);
  assert.throws(() => g.gs.adminYear({ name: '박점장', pin: '246813' }, '한퇴사', '2026'), /찾을 수 없어요/, '점장은 퇴사자 기록을 못 봐요');
  const kim = plain(g.gs.adminYear('582941', '김민우', '2026'));
  assert.deepEqual([kim.months[0].lateCount, kim.months[2].lateCount, kim.months[0].monthly, kim.months[2].monthly], [1, 1, 2, 1]);
  const oh = plain(g.gs.adminYear('582941', '오이동', '2026'));
  assert.deepEqual([oh.months[0].store, oh.months[0].sup, oh.months[0].supBy, oh.total.sup], ['검단', 1, { 가산: 1 }, 1], '1월에 검단 소속으로 가산에 지원 1번');
  assert.deepEqual([oh.months[1].store, oh.months[1].absent], ['가산', 1], "2/18 '무단'도 결근으로 세요(만근 칸과 같은 기준)");
  // [직원 1년] 탭에서 퇴사자를 고를 수 있어요
  const yt = g.sheet('직원 1년');
  yt.getRange(3, 2).setValue('한퇴사');
  yt.getRange(3, 4).setValue('2026');
  g.gs.onEdit({ range: yt.getRange(3, 2) });
  const rows = sheetRows(yt);
  assert.match(rows[4][0], /달마다 합계 · 한퇴사 \(왕십리, 퇴사\) · 2026년/);
  assert.equal(rows.find((r) => r[0] === '1월' && r[1] !== '' && r[18] === '왕십리')[7], '2', '1월 휴무 2일');
  // [매장 1년] 탭: 그 매장에 있던 달만. 오이동은 지금 가산이지만 1월에는 검단(→ 왕십리 탭엔 안 나옴)
  const st = g.sheet('매장 1년');
  st.getRange(3, 2).setValue('왕십리');
  g.gs.onEdit({ range: st.getRange(3, 2) });
  const srows = sheetRows(st);
  assert.ok(srows.find((r) => r[0] === '한퇴사 (퇴사)'));
  assert.ok(!srows.some((r) => /^오이동/.test(r[0])));
  st.getRange(3, 2).setValue('가산');
  g.gs.onEdit({ range: st.getRange(3, 2) });
  const grows = sheetRows(st);
  const inTitle = grows.findIndex((r) => r[0] === '지원 온 날(다른 매장 직원이 이 매장으로)');
  assert.ok(inTitle > 0, '가산으로 지원 온 날');
  assert.deepEqual(grows[inTitle + 2].slice(0, 2).concat(grows[inTitle + 2][13]), ['오이동 (가산)', '1', '1'], '1월에 1번');
});

test('예전 휴무표 가져오기: 이미 있는 탭은 예전 파일에 적힌 칸만 맞추고, 앱을 시작한 뒤에는 시작일부터 안 건드려요', () => {
  const g = v3();
  g.gs.setSetting_('앱시작일', '');
  g.setKst('2026-11-20 10:00');
  // 예전 파일 11월: 김민우 3일 휴무·25일 월차(앞으로의 계획), 이지은 5일 11:7, 한퇴사(11월 탭에 없는 사람) 2일 휴무
  oldFile(g, [oldBlock(2026, 11, [
    { store: '왕십리', name: '김민우', days: { 3: '휴무', 25: '11월차' } },
    { store: '가산', name: '이지은', days: { 5: '11:7' } },
    { store: '왕십리', name: '한퇴사', days: { 2: '휴무', 12: '퇴사' } },
  ])]);
  // 새 시트 11월 탭에 이미 적힌 것: 김민우 3일 '결근?'(밤 마감), 4일 '결근?', 10일 '반차'(사장님이 새 시트에 직접 적음)
  g.gs.setMark_('2026-11-03', '김민우', () => '결근?');
  g.gs.setMark_('2026-11-04', '김민우', () => '결근?');
  g.gs.setMark_('2026-11-10', '김민우', () => '반차');
  const v = plain(g.gs.adminImportPreview('582941', OLD_URL, '2026'));
  assert.deepEqual(v.months.map((m) => [m.m, m.exists, m.add, m.clear]), [[11, true, 1, 1]]);
  assert.equal(v.live, false);
  importAll(g);
  const kim = monthCells(g, '2026-11', '김민우');
  assert.equal(kim.row[10 + 2], '휴무', "예전 파일에 적힌 칸으로('결근?' → 휴무)");
  assert.equal(kim.row[10 + 3], '', "예전 파일에 없는 '결근?'은 지워요");
  assert.equal(kim.row[10 + 9], '반차', '새 시트에만 적힌 칸은 그대로');
  assert.equal(kim.row[10 + 24], '11월차', '시작 전에는 앞으로의 계획도 옮겨요');
  assert.equal(monthCells(g, '2026-11', '이지은').row[10 + 4], '11:07');
  const han = monthCells(g, '2026-11', '한퇴사');
  assert.ok(han, '탭에 없던 사람은 줄을 더해요(퇴사한 달 기록)');
  assert.equal(han.row[1], '왕십리');
  assert.equal(han.row[10 + 11], '퇴사');
  assert.ok(han.r < monthCells(g, '2026-11', '이지은').r, '같은 매장 묶음 아래에 끼워 넣어요');
  assert.match(String(han.raw[9]), /^=IF\(SUMPRODUCT/, '끼워 넣은 줄에도 수식');
  assert.equal(hrRow(g, '한퇴사')['퇴사일'], '2026-11-12');

  // 앱을 시작한 뒤(11/10 시작): 11/10부터의 칸은 예전 파일이 달라도 그대로
  const g2 = v3();
  g2.gs.setSetting_('앱시작일', '2026-11-10');
  g2.setKst('2026-11-20 10:00');
  oldFile(g2, [oldBlock(2026, 11, [{ store: '왕십리', name: '김민우', days: { 3: '휴무', 12: '휴무', 25: '11월차' } }]),
    oldBlock(2026, 12, [{ store: '왕십리', name: '김민우', days: { 2: '휴무' } }])]);
  const v2 = plain(g2.gs.adminImportPreview('582941', OLD_URL, '2026'));
  assert.equal(v2.live, true);
  assert.deepEqual(v2.months.map((m) => [m.m, m.own, m.change, m.skip ? 'skip' : '']), [[11, 9, 1, ''], [12, 0, 0, 'skip']]);
  importAll(g2);
  const k2 = monthCells(g2, '2026-11', '김민우');
  assert.deepEqual([k2.row[10 + 2], k2.row[10 + 11], k2.row[10 + 24]], ['휴무', '', ''], '11/3만 옮기고 11/12·11/25는 앱 기록 그대로');
  assert.equal(monthCells(g2, '2026-12', '김민우').row[10 + 1], '', '시작일 뒤의 달은 안 건드려요');
});

/* ───── 퇴사자: 퇴사한 달에는 그대로, 다음 달부터 빠짐. 퇴사 예정일. 입사일 전 ───── */

test('퇴사 처리(지난 날짜): 그달 휴무표에는 남고 다음 달 탭에서 빠져요. 남은 요청·점장 칸도 정리해요', () => {
  const g = v3({ email: 'owner@example.com' });
  g.setKst('2026-11-20 10:00');
  g.gs.adminMakeMonth('582941', '2026-12');
  assert.ok(monthRowOf(g, '2026-12', '박점장'), '다음 달 탭에 미리 줄이 있어요');
  g.gs.setMark_('2026-11-10', '박점장', () => '휴무');
  g.gs.setMark_('2026-12-08', '박점장', () => '휴무?'); // 다음 달 휴무를 골라 뒀어요
  // 박점장이 보낸 요청(대기), 박점장이 대타를 해 주기로 한 요청(수락)
  req(g, '박점장', '246813', 'off', { date: '2026-11-27', reason: '개인' });
  req(g, '김민우', '0123', 'swap', { date: '2026-11-26', reason: '병원' });
  const swapId = reqRows(g).find((r) => r[2] === '김민우')[0];
  g.gs.takeSwap('박점장', '246813', swapId);
  assert.equal(reqRows(g).find((r) => r[2] === '김민우')[7], '수락');

  const c = plain(g.gs.adminRetire('582941', '박점장', '2026-11-18'));
  assert.deepEqual([c.state, c.end, c.leaving], ['퇴사', '2026-11-18', false]);
  assert.match(c.note, /퇴사 처리했어요\(마지막 근무일 11\/18\(수\)\)/);
  assert.match(c.note, /12월 휴무표에서 줄을 뺐어요/);
  assert.match(c.note, /기다리던 요청 1건을 취소했어요/);
  assert.match(c.note, /대타를 해 주기로 한 1건은 다시 구하는 중/);
  assert.match(c.note, /왕십리 점장 칸에서 뺐어요/);
  // 앱 명단에서 빠져요
  assert.ok(!g.gs.getStaffList().staff.some((s) => s.name === '박점장'));
  assert.deepEqual(plain(g.gs.getStaffList().managers), [], '점장 로그인 목록에서도');
  assert.equal(g.sheet('매장').rowDisplay(2)[7], '');
  // 11월 휴무표: 줄과 기록이 그대로, 마지막 근무일 다음 날에 '퇴사'
  assert.equal(mark(g, '박점장', '2026-11-10'), '휴무');
  assert.equal(mark(g, '박점장', '2026-11-19'), '퇴사');
  // 12월 휴무표: 줄이 빠져요(다른 사람 줄은 그대로)
  assert.ok(!monthRowOf(g, '2026-12', '박점장'));
  assert.ok(monthRowOf(g, '2026-12', '김민우'));
  // 요청
  const rows = reqRows(g);
  assert.equal(rows.find((r) => r[2] === '박점장')[7], '취소');
  assert.deepEqual(rows.find((r) => r[2] === '김민우').slice(7, 9), ['대기', ''], '대타는 다시 구하는 중');
  // 다음 달 탭을 다시 맞춰도 퇴사자는 안 들어가요
  g.gs.setup();
  assert.ok(!monthRowOf(g, '2026-12', '박점장'));
  // 사장님 화면: 이번 달 퇴사자는 [직원] 목록에 그대로(퇴사 표시), 1년 보기 목록에도
  const list = plain(g.gs.adminHrList('582941').list);
  assert.deepEqual(list.filter((p) => p.name === '박점장').map((p) => [p.state, p.end]), [['퇴사', '2026-11-18']]);
  assert.ok(plain(g.gs.adminToday('582941').gone).includes('박점장'));
  assert.equal(g.gs.adminYear('582941', '박점장', '2026').months[10].off, 1, '퇴사자 기록도 1년 보기에');
});

test('퇴사 예정(오늘·앞날): 마지막 근무일까지는 찍을 수 있고, 다음 날 자동으로 퇴사 처리돼요', () => {
  const g = v3({ email: 'owner@example.com' });
  tgOn(g);
  g.setKst('2026-11-20 10:00');
  const c = plain(g.gs.adminRetire('582941', '최유나', '2026-11-21'));
  assert.deepEqual([c.state, c.end, c.leaving], ['근무', '2026-11-21', true]);
  assert.match(c.note, /11\/21\(토\)까지 근무하고 다음 날 자동으로 퇴사 처리돼요/);
  assert.ok(g.gs.getStaffList().staff.some((s) => s.name === '최유나'), '아직 명단에 있어요');
  assert.equal(plain(g.gs.adminHrList('582941').list).find((p) => p.name === '최유나').leaving, true);
  // 마지막 근무일에 출근·퇴근
  g.setKst('2026-11-21 11:55');
  punch(g, '최유나', '1357', 'in', NEAR, 'dddddddddddddddd');
  assert.equal(g.gs.getToday('최유나', '1357').tIn, '11:55', '마지막 근무일에도 찍혀요');
  g.setKst('2026-11-21 21:01');
  punch(g, '최유나', '1357', 'out', NEAR, 'dddddddddddddddd');
  g.setKst('2026-11-21 23:40');
  g.gs.checkMissing();
  assert.equal(g.gs.findStaff_('최유나').active, true, '마지막 근무일 밤에는 아직');
  // 다음 날 첫 검사 때 퇴사 처리 + 사장님께 알림
  g.setKst('2026-11-22 07:10');
  g.gs.checkMissing();
  assert.equal(g.gs.findStaff_('최유나').active, false);
  assert.deepEqual([hrRow(g, '최유나')['상태'], hrRow(g, '최유나')['퇴사일']], ['퇴사', '2026-11-21']);
  assert.ok(sentTo(g, 555).some((t) => /퇴사 처리/.test(t) && /최유나 \(가산\)/.test(t)));
  assert.equal(mark(g, '최유나', '2026-11-22'), '퇴사');
  g.setKst('2026-11-22 23:40');
  g.gs.checkMissing();
  assert.equal(mark(g, '최유나', '2026-11-22'), '퇴사', "퇴사 뒤에는 '결근?'이 안 적혀요");
  // 퇴사 예정 취소
  const g2 = v3();
  g2.setKst('2026-11-20 10:00');
  g2.gs.adminRetire('582941', '최유나', '2026-11-30');
  const back = plain(g2.gs.adminUnretire('582941', '최유나'));
  assert.deepEqual([back.state, back.end, back.leaving], ['근무', '', false]);
  assert.match(back.note, /퇴사 예정을 취소했어요/);
  assert.throws(() => g2.gs.adminUnretire('582941', '최유나'), /퇴사 예정이 없어요/);
});

test('퇴사 취소: 다시 근무로 돌리면 앱 명단과 이번 달 휴무표에 다시 들어가요', () => {
  const g = v3();
  g.setKst('2026-11-20 10:00');
  g.gs.adminMakeMonth('582941', '2026-12');
  g.gs.adminRetire('582941', '최유나', '2026-11-10');
  assert.ok(!monthRowOf(g, '2026-12', '최유나'));
  const c = plain(g.gs.adminUnretire('582941', '최유나'));
  assert.deepEqual([c.state, c.end], ['근무', '']);
  assert.match(c.moves, /2026-11-20 퇴사 취소\(2026-11-10\)/);
  assert.ok(g.gs.getStaffList().staff.some((s) => s.name === '최유나'));
  assert.ok(monthRowOf(g, '2026-12', '최유나'), '다음 달 탭에도 다시');
  assert.throws(() => g.gs.adminUnretire(MGR, '최유나'), /관리자/);
});

test('퇴사 처리: 뒤 달 휴무표에 이미 기록이 있으면 줄을 그대로 두고 알려줘요. 마지막 근무일이 입사일보다 앞이면 막아요', () => {
  const g = v3();
  g.setKst('2026-12-03 10:00');
  g.gs.checkMissing(); // 12월 탭
  g.gs.setMark_('2026-12-01', '최유나', () => '12:20'); // 12/1에 지각 기록
  const c = plain(g.gs.adminRetire('582941', '최유나', '2026-11-28'));
  assert.match(c.note, /12월 휴무표에는 이미 기록이 있어서 줄을 그대로 뒀어요/);
  assert.ok(monthRowOf(g, '2026-12', '최유나'));
  g.gs.adminHrSave('582941', '김민우', { start: '2026-11-10', phone: '010-1111-2222' });
  assert.throws(() => g.gs.adminRetire('582941', '김민우', '2026-11-05'), /입사일\(2026-11-10\)보다 앞/);
});

test("입사일 전: 밤 마감이 '결근?'을 안 적고, 미출근 알림도 안 가고, 입사 전 달 휴무표에는 줄을 안 만들어요", () => {
  const g = v3({ email: 'owner@example.com' });
  tgOn(g, { 김민우: '9002' });
  // 김민우 입사일을 11/18로(그 전에는 아직 안 다님)
  g.gs.adminHrSave('582941', '김민우', { start: '2026-11-18', phone: '010-1111-2222' });
  g.setKst('2026-11-17 10:30'); // 화요일, 출근 예정 10:00
  g.gs.checkMissing();
  assert.ok(!sentTo(g, 9002).some((t) => /아직 출근/.test(t)), '입사 전에는 미출근 알림이 안 가요');
  assert.equal(plain(g.gs.adminToday('582941').list).find((p) => p.name === '김민우').status, '입사 전');
  g.setKst('2026-11-17 23:40');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민우', '2026-11-17'), '', "입사 전 날에는 '결근?'이 안 적혀요");
  assert.equal(mark(g, '박점장', '2026-11-17'), '결근?', '다른 사람은 그대로');
  g.setKst('2026-11-18 23:40');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민우', '2026-11-18'), '결근?', '입사일부터는 적혀요');
  // 지난달 탭을 만들어도 입사 전 달에는 줄이 안 생겨요
  g.gs.adminMakeMonth('582941', '2026-10');
  assert.ok(!monthRowOf(g, '2026-10', '김민우'));
  assert.ok(monthRowOf(g, '2026-10', '박점장'), '입사일이 비어 있는 예전 직원은 들어가요');
});

test('비밀번호: 빈칸은 틀린 횟수에 안 넣고, 잠기면 사장님이 풀 수 있다고 알려줘요. 오늘 기록에는 날짜가 같이 와요', () => {
  const g = fresh();
  for (let i = 0; i < 7; i++) assert.throws(() => g.gs.hrGet('김민우', ''), /비밀번호를 넣어주세요/);
  assert.equal(g.cache.get('fail:pin:김민우'), undefined, '빈 비밀번호로는 잠기지 않아요');
  assert.equal(g.gs.getHome('김민우', '0123').pinError, '');
  // 폰에 기억된 옛 비밀번호: 화면이 지울 수 있게 표시해 줘요
  const h = g.gs.getHome('김민우', '9999');
  assert.equal(h.pinWrong, true);
  assert.match(h.pinError, /비밀번호가 틀렸어요/);
  for (let i = 0; i < 4; i++) g.gs.getHome('김민우', '9999');
  const locked = g.gs.getHome('김민우', '0123');
  assert.match(locked.pinError, /5번 틀려서 잠겼어요.*사장님께 말하면 바로 풀어 줄 수 있어요/);
  assert.equal(locked.pinWrong, false, '잠긴 건 기억된 번호를 지울 일이 아니에요');
  g.gs.adminSetPin('582941', '김민우', '0123');
  assert.equal(g.gs.getHome('김민우', '0123').pinError, '', '사장님이 비밀번호를 다시 정하면 잠김이 풀려요');
  assert.throws(() => g.gs.adminToday(''), /관리자 비밀번호를 넣어주세요/);
  assert.equal(g.cache.get('fail:admin'), undefined);
  // 오늘 기록: 날짜가 같이 와서 화면이 '어제 기록'인지 알 수 있어요
  assert.equal(g.gs.getToday('김민우').date, '2026-11-16');
  g.setKst('2026-11-16 09:58');
  const r = punch(g, '김민우', '0123', 'in');
  assert.equal(r.today.date, '2026-11-16');
  g.setKst('2026-11-17 09:00');
  assert.deepEqual([g.gs.getToday('김민우').date, g.gs.getToday('김민우').tIn], ['2026-11-17', ''], '다음 날에는 새 날 기록');
});

/* ───── [인사] 탭을 PC에서 손으로 고칠 때 ───── */

test('[인사] 여러 줄을 한꺼번에 바꿔도 [인사]에 적은 대로 맞춰요(지점·상태). 없는 지점 이름은 되돌려요', () => {
  const g = v3();
  g.setKst('2026-11-16 14:00');
  const hs = g.sheet('인사');
  const cS = colOf(hs, '지점'), cT = colOf(hs, '상태');
  const rk = g.gs.hrFind_('김민우').row, rp = g.gs.hrFind_('박점장').row;
  assert.ok(rp > rk);
  // 김민우와 박점장 줄에 '가산'을 한꺼번에 채우기(범위는 김민우~박점장. 사이 줄은 안 바꿈)
  [rk, rp].forEach((r) => hs.getRange(r, cS).setValue('가산'));
  g.gs.onEdit({ range: hs.getRange(rk, cS, rp - rk + 1, 1) });
  assert.deepEqual([g.gs.findStaff_('김민우').store, g.gs.findStaff_('박점장').store], ['가산', '가산'], '[직원] 매장이 따라와요');
  assert.equal(hrRow(g, '김민우')['이동 기록'], '2026-11-16 왕십리→가산', '방향이 맞아요');
  assert.equal(hrRow(g, '박점장')['이동 기록'], '2026-11-16 왕십리→가산');
  assert.equal(hrRow(g, '이지은')['이동 기록'], '', '안 바뀐 줄은 그대로');
  g.gs.checkMissing(); // 휴무표 줄은 10분 검사가 옮겨요(여러 줄을 붙여넣어도 30초 안에 끝나게)
  assert.equal(monthRowOf(g, '2026-11', '김민우').v[1], '가산', '휴무표 줄도 옮겨요');
  assert.equal(g.sheet('매장').rowDisplay(2)[7], '', '옮겨 간 점장은 예전 매장 점장 칸에서 빠져요');
  // 없는 지점 이름은 되돌려요
  hs.getRange(rk, cS).setValue('강남');
  g.gs.onEdit({ range: hs.getRange(rk, cS) });
  assert.equal(hrRow(g, '김민우')['지점'], '가산');
  assert.equal(g.gs.findStaff_('김민우').store, '가산');
  // 상태 두 줄을 '퇴사'로
  [rk, rp].forEach((r) => hs.getRange(r, cT).setValue('퇴사'));
  g.gs.onEdit({ range: hs.getRange(rk, cT, rp - rk + 1, 1) });
  assert.deepEqual([g.gs.findStaff_('김민우').active, g.gs.findStaff_('박점장').active, g.gs.findStaff_('이지은').active], [false, false, true]);
  assert.deepEqual([hrRow(g, '김민우')['상태'], hrRow(g, '김민우')['퇴사일']], ['퇴사', '2026-11-16']);
  // 다시 '근무'로 바꾸면 퇴사일이 지워지고 이동 기록에 남아요
  hs.getRange(rk, cT).setValue('근무');
  g.gs.onEdit({ range: hs.getRange(rk, cT) });
  assert.equal(g.gs.findStaff_('김민우').active, true);
  assert.deepEqual([hrRow(g, '김민우')['상태'], hrRow(g, '김민우')['퇴사일']], ['근무', '']);
  assert.match(hrRow(g, '김민우')['이동 기록'], /2026-11-16 다시 근무\(퇴사 2026-11-16\)$/);
});

test('[인사] 한 번에 10명까지만 바꾸고, 넘는 줄은 거꾸로 된 기록 없이 되돌려요', () => {
  const g = v3();
  g.setKst('2026-11-16 14:00');
  const st = g.sheet('직원');
  const extra = Array.from({ length: 12 }, (_, i) => ['직원' + String.fromCharCode(65 + i), '왕십리']);
  st.getRange(7, 1, 12, 2).setValues(extra);
  g.gs.setup();
  const hs = g.sheet('인사');
  const cS = colOf(hs, '지점');
  const r0 = g.gs.hrFind_('직원A').row;
  for (let i = 0; i < 12; i++) hs.getRange(r0 + i, cS).setValue('가산');
  g.gs.onEdit({ range: hs.getRange(r0, cS, 12, 1) });
  const moved = extra.filter(([n]) => g.gs.findStaff_(n).store === '가산').length;
  assert.equal(moved, 10);
  assert.deepEqual([hrRow(g, '직원K')['지점'], hrRow(g, '직원K')['이동 기록']], ['왕십리', ''], '넘는 줄은 되돌리고 기록을 안 남겨요');
  assert.equal(hrRow(g, '직원A')['이동 기록'], '2026-11-16 왕십리→가산');
});

test('[인사] 날짜·주민번호·휴대폰을 붙여넣으면 앱이 읽는 모양으로 고쳐요(엑셀에서 앞 0이 빠진 번호도). 못 알아본 주민번호는 표시해요', () => {
  const g = v3();
  g.setKst('2026-11-16 14:00');
  const hs = g.sheet('인사');
  const rk = g.gs.hrFind_('김민우').row, rl = g.gs.hrFind_('이지은').row;
  hs.getRange(rk, colOf(hs, '입사일')).setValue('2026.3.2');
  hs.getRange(rk, colOf(hs, '주민번호')).setValue('102034123456'); // 010203-4123456 에서 앞 0이 빠짐
  hs.getRange(rk, colOf(hs, '휴대폰')).setValue('1011112222');
  hs.getRange(rl, colOf(hs, '입사일')).setValue('2025년 12월 1일');
  hs.getRange(rl, colOf(hs, '주민번호')).setValue('950101-192837'); // 한 자리 빠짐
  hs.getRange(rl, colOf(hs, '휴대폰')).setValue('01033334444');
  g.gs.onEdit({ range: hs.getRange(rk, 1, 2, hs.getLastColumn()) });
  const kim = hrRow(g, '김민우'), lee = hrRow(g, '이지은');
  assert.deepEqual([kim['입사일'], kim['주민번호'], kim['휴대폰']], ['2026-03-02', '010203-4******', '010-1111-2222']);
  assert.equal(g.gs.adminHrRrn('582941', '김민우').rrn, '010203-4123456');
  assert.ok(!allCells(g).includes('102034123456'), '13자리로 맞춘 뒤에는 그대로 안 남아요');
  assert.deepEqual([lee['입사일'], lee['휴대폰']], ['2025-12-01', '010-3333-4444']);
  assert.equal(lee['주민번호'], '950101-192837', '못 알아본 번호는 그대로 두고');
  const cR = colOf(hs, '주민번호');
  assert.match(hs.notes[rl + ',' + cR], /13자리가 아니에요/, '메모로 알려줘요');
  // 고치면 표시가 지워져요
  hs.getRange(rl, cR).setValue('9501011928374');
  g.gs.onEdit({ range: hs.getRange(rl, cR) });
  assert.equal(hrRow(g, '이지은')['주민번호'], '950101-1******');
  assert.ok(!hs.notes[rl + ',' + cR]);
  // 1900년대생으로 읽히는 12자리(한 자리 빠진 번호)는 0을 붙여 맞추지 않아요
  assert.deepEqual(plain(g.gs.hrTidy_({ rrn: '950101192837' })), {});
});

test('[인사] 앱이 한 줄을 고칠 때 바뀐 칸만 써요(사장님이 붙인 칸은 그대로)', () => {
  const g = v3();
  const hs = g.sheet('인사');
  const extra = hs.getLastColumn() + 1;
  hs.insertColumnsAfter(hs.getMaxColumns(), 2);
  hs.getRange(1, extra).setValue('근속(개월)');
  const rk = g.gs.hrFind_('김민우').row;
  hs.getRange(rk, extra).setNumberFormat('0').setValue(7);
  hs.writeLog = [];
  g.gs.adminHrSave('582941', '김민우', { phone: '010-1111-2222', memo: '보건증' });
  assert.ok(hs.writeLog.length > 0);
  assert.ok(hs.writeLog.every((w) => w.r === rk && w.c + w.nc - 1 < extra), '붙인 칸까지 다시 쓰지 않아요');
  assert.equal(hs.fmt(rk, extra), '0', '붙인 칸 서식 그대로');
  assert.equal(hs.getRange(rk, extra).getValue(), 7);
  assert.deepEqual([hrRow(g, '김민우')['휴대폰'], hrRow(g, '김민우')['비고']], ['010-1111-2222', '보건증']);
});

test('[직원]에 같은 이름이 두 줄: 퇴사 줄과 근무 줄이면 근무 줄만 보고, 근무 중인 두 줄이면 안 건드리고 알려줘요', () => {
  const g = v3();
  g.setKst('2026-11-16 14:00');
  const st = g.sheet('직원');
  // 이지은: 예전 줄(가산)을 X로 두고 새 줄(왕십리)을 또 적음
  st.getRange(ROW.이지은, colOf(st, '재직')).setValue('X');
  st.getRange(7, 1, 1, 3).setValues([['이지은', '왕십리', '5678']]);
  for (let i = 0; i < 3; i++) g.gs.adminHrList('582941');
  const lee = hrRow(g, '이지은');
  assert.deepEqual([lee['지점'], lee['상태']], ['왕십리', '근무']);
  assert.equal(lee['이동 기록'], '2026-11-16 가산→왕십리', '여러 번 맞춰도 기록이 한 번만');
  assert.equal(g.gs.findStaff_('이지은').store, '왕십리', '근무 중인 줄을 찾아요');
  assert.deepEqual(plain(g.gs.adminToday('582941').dups), []);
  // 김민우: 근무 중인 줄이 두 개(동명이인을 구분 없이 적음)
  st.getRange(8, 1, 1, 3).setValues([['김민우', '가산', '1111']]);
  for (let i = 0; i < 3; i++) g.gs.adminHrList('582941');
  assert.deepEqual([hrRow(g, '김민우')['지점'], hrRow(g, '김민우')['이동 기록']], ['왕십리', ''], '어느 쪽이 맞는지 몰라서 안 건드려요');
  assert.deepEqual(plain(g.gs.adminToday('582941').dups), ['김민우']);
});

test("[인사] '승인 대기'를 손으로 '근무'로 바꾸면 앱에서 승인한 것처럼 처리해요. 안 되면 되돌리고 이유를 메모로", () => {
  const g = v3();
  g.setKst('2026-11-16 14:00');
  g.gs.joinSubmit(joinForm());
  const hs = g.sheet('인사');
  const cT = colOf(hs, '상태');
  let r = g.gs.hrFind_('한신입', '승인 대기').row;
  hs.getRange(r, cT).setValue('근무');
  g.gs.onEdit({ range: hs.getRange(r, cT) });
  const p = g.gs.findStaff_('한신입');
  assert.ok(p && p.active, '[직원]에 들어가요');
  assert.equal(p.pin, '4826');
  assert.equal(hrRow(g, '한신입')['가입(임시)'], '', '임시 칸(비밀번호·폰)은 지워져요');
  assert.ok(monthRowOf(g, '2026-11', '한신입'));
  assert.deepEqual(plain(g.gs.joinStatus('한신입', NEWPHONE)), { state: 'ok' });
  // 안 되는 경우: 지점이 [매장] 탭에 없음
  g.gs.joinSubmit(joinForm({ name: '두신입', rrn: '960202-2345678', device: 'ffffffffffffffff', phone: '01077776666' }));
  r = g.gs.hrFind_('두신입', '승인 대기').row;
  hs.getRange(r, colOf(hs, '지점')).setValue('강남');
  hs.getRange(r, cT).setValue('근무');
  g.gs.onEdit({ range: hs.getRange(r, cT) });
  assert.equal(hrRow(g, '두신입')['상태'], '승인 대기');
  assert.match(hs.notes[r + ',' + cT], /승인하지 못했어요: 강남 지점이 \[매장\] 탭에 없어요/);
  assert.ok(!g.gs.findStaff_('두신입'));
});

test('예전 퇴사자와 이름만 같은 새 사람: 합치지 않고, 이름을 바꿔 승인해요. 신입 폰은 바뀐 이름을 알아봐요', () => {
  const g = v3();
  g.setKst('2026-11-16 14:00');
  // 예전 박퇴사(88년생)의 인사 기록
  const hs = g.sheet('인사');
  const rOld = g.gs.hrFind_('박퇴사').row;
  hs.getRange(rOld, colOf(hs, '주민번호')).setValue('8803031234567');
  g.gs.onEdit({ range: hs.getRange(rOld, colOf(hs, '주민번호')) });
  // 새 박퇴사(04년생)가 입사 등록
  g.gs.joinSubmit(joinForm({ name: '박퇴사', rrn: '040404-3456789', phone: '01055554444' }));
  const j = plain(g.gs.adminToday('582941').joins)[0];
  assert.deepEqual(j.prev, { store: '왕십리', end: '', birth: '88년생', other: true });
  assert.throws(() => g.gs.adminJoin('582941', '박퇴사', true), /이름만 같은 다른 사람이에요.*박퇴사B/);
  assert.equal(g.gs.findStaff_('박퇴사').active, false, '예전 줄을 살리지 않아요');
  assert.throws(() => g.gs.adminJoin('582941', '박퇴사', true, '김민우'), /이미 있는 이름/);
  g.gs.adminJoin('582941', '박퇴사', true, '박퇴사B');
  const nu = g.gs.findStaff_('박퇴사B');
  assert.ok(nu && nu.active);
  assert.equal(hrRow(g, '박퇴사B')['주민번호'], '040404-3******');
  assert.equal(hrRow(g, '박퇴사')['주민번호'], '880303-1******', '예전 사람 기록은 그대로');
  assert.equal(g.gs.findStaff_('박퇴사').active, false);
  // 신입 폰: 등록한 이름(박퇴사)으로 물어도 이 폰으로 등록된 새 이름을 알려줘요
  assert.deepEqual(plain(g.gs.joinStatus('박퇴사', NEWPHONE)), { state: 'ok', name: '박퇴사B' });
  // 같은 사람(생년월일 같음)이 다시 오면 예전처럼 한 줄에 이어 적어요
  g.setKst('2026-11-20 10:00');
  g.gs.adminRetire('582941', '박퇴사B', '2026-11-18');
  assert.equal(g.gs.findStaff_('박퇴사B').active, false);
  g.gs.joinSubmit(joinForm({ name: '박퇴사B', rrn: '040404-3456789', phone: '01055554444', start: '2026-11-20' }));
  assert.equal(plain(g.gs.adminToday('582941').joins)[0].prev.other, false);
  g.gs.adminJoin('582941', '박퇴사B', true);
  assert.match(hrRow(g, '박퇴사B')['이동 기록'], /다시 입사\(왕십리\)/);
});

test('주민번호 전체 보기: [인사] 줄이 섞여서 가린 번호와 보관된 번호가 다르면 보여주지 않아요', () => {
  const g = v3();
  g.gs.hrSave('김민우', '0123', joinForm({ rrn: '900202-1357924' }));
  g.gs.hrSave('이지은', '5678', joinForm({ rrn: '950505-2468135' }));
  assert.equal(g.gs.adminHrRrn('582941', '김민우').rrn, '900202-1357924');
  const hs = g.sheet('인사');
  const cE = colOf(hs, '주민번호(암호)');
  const rk = g.gs.hrFind_('김민우').row, rl = g.gs.hrFind_('이지은').row;
  // 보이는 칸만 정렬해서 숨긴 암호 칸이 안 따라온 상황: 두 줄의 암호가 서로 바뀜
  const a = hs.getRange(rk, cE).getValue(), b = hs.getRange(rl, cE).getValue();
  hs.getRange(rk, cE).setValue(b);
  hs.getRange(rl, cE).setValue(a);
  assert.throws(() => g.gs.adminHrRrn('582941', '김민우'), /줄이 섞인 것 같아요/);
  // 되돌리면 다시 보여요. 가린 번호 칸이 지워졌으면 다시 채워요
  hs.getRange(rk, cE).setValue(a);
  hs.getRange(rl, cE).setValue(b);
  hs.getRange(rk, colOf(hs, '주민번호')).setValue('');
  assert.equal(g.gs.adminHrRrn('582941', '김민우').rrn, '900202-1357924');
  assert.equal(hrRow(g, '김민우')['주민번호'], '900202-1******');
});

/* ───── 결근으로 적힌 날의 요청, 요청만 보내고 안 나온 날, 자정 넘긴 퇴근, 휴무표 매장 칸 ───── */

test("지난 결근: '결근?'·'무단'으로 적힌 날은 14일 안이면 월차·무급으로 바꿔 달라고 요청할 수 있어요", () => {
  const g = v3();
  g.setKst('2026-11-18 10:00');
  g.gs.setMark_('2026-11-16', '김민우', () => '결근?');
  g.gs.setMark_('2026-11-17', '김민우', () => '무단결근'); // 사장님이 직접 적음
  // 결근? → 월차
  req(g, '김민우', '0123', 'off', { offType: '월차', date: '2026-11-16', reason: '몸이 안 좋았어요', to: 'admin' });
  // 무단 → 무급 (예전에는 '원래 근무가 없는 날'이라며 막혔어요)
  req(g, '김민우', '0123', 'off', { offType: '무급', date: '2026-11-17', reason: '연락을 못 했어요', to: 'admin' });
  const t = plain(g.gs.adminToday('582941'));
  const q1 = t.requests.find((x) => x.date === '2026-11-16'), q2 = t.requests.find((x) => x.date === '2026-11-17');
  assert.deepEqual([q1.kind, q1.mark, q2.kind, q2.mark], ['월차', '결근?', '무급', '무단결근'], '승인 카드에 그날 칸이 보여요');
  g.gs.adminRequest('582941', q1.id, true);
  g.gs.adminRequest('582941', q2.id, true);
  assert.deepEqual([mark(g, '김민우', '2026-11-16'), mark(g, '김민우', '2026-11-17')], ['월차', '무급']);
  // 결근으로 안 적힌 지난 날, 14일보다 오래된 날은 안 돼요
  assert.throws(() => req(g, '김민우', '0123', 'off', { offType: '월차', date: '2026-11-13', reason: 'x' }), /'결근'으로 적힌 날만/);
  g.gs.setMark_('2026-11-02', '김민우', () => '결근?');
  assert.throws(() => req(g, '김민우', '0123', 'off', { offType: '월차', date: '2026-11-02', reason: 'x' }), /14일 전부터/);
  assert.throws(() => req(g, '김민우', '0123', 'swap', { date: '2026-11-16', reason: 'x' }), /지난 날짜는 고를 수 없어요/);
});

test("요청만 보내고 안 나온 날: 거절·취소되면 그날 칸에 '결근?'이 적혀요. 밤 요약에 처리 안 된 요청이 나와요", () => {
  const g = v3({ email: 'owner@example.com' });
  tgOn(g, { 김민우: '9002' });
  g.setKst('2026-11-16 09:30');
  req(g, '김민우', '0123', 'off', { date: '2026-11-16', reason: '갑자기 일이 생겨서', to: 'admin' });
  req(g, '이지은', '5678', 'off', { date: '2026-11-16', reason: '병원', to: 'admin' });
  g.setKst('2026-11-16 12:00');
  punch(g, '이지은', '5678', 'in'); // 이지은은 요청을 보냈지만 나왔어요
  g.setKst('2026-11-16 23:40');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민우', '2026-11-16'), '', '요청 처리를 기다리는 동안은 안 적어요');
  const sum = sentTo(g, 555).find((x) => /하루 마감 정리/.test(x));
  assert.match(sum, /날짜가 지났는데 처리 안 된 요청 2건/);
  assert.match(sum, /김민우 11\/16 휴무/);
  // 다음 날 사장님이 거절
  g.setKst('2026-11-17 09:00');
  const t = plain(g.gs.adminToday('582941'));
  g.gs.adminRequest('582941', t.requests.find((x) => x.name === '김민우').id, false);
  assert.equal(mark(g, '김민우', '2026-11-16'), '결근?');
  assert.match(sentTo(g, 9002).at(-1), /거절됐어요[\s\S]*휴무표에 '결근\?'으로 적혔어요/);
  g.gs.adminRequest('582941', t.requests.find((x) => x.name === '이지은').id, false);
  assert.equal(mark(g, '이지은', '2026-11-16'), '', '출근 기록이 있으면 안 적어요');
  // 본인이 다음 날 취소해도 같아요
  const g2 = v3();
  g2.setKst('2026-11-16 09:30');
  req(g2, '김민우', '0123', 'off', { date: '2026-11-16', reason: '일', to: 'admin' });
  g2.setKst('2026-11-17 09:00');
  g2.gs.cancelRequest('김민우', '0123', reqRows(g2)[0][0]);
  assert.equal(mark(g2, '김민우', '2026-11-16'), '결근?');
  // 앞날 요청을 취소한 건 상관없어요
  req(g2, '김민우', '0123', 'off', { date: '2026-11-19', reason: '일', to: 'admin' });
  g2.gs.cancelRequest('김민우', '0123', reqRows(g2).at(-1)[0]);
  assert.equal(mark(g2, '김민우', '2026-11-19'), '');
});

test('자정을 넘겨 퇴근하면 어제 줄에 적고, 조퇴로 보지 않아요', () => {
  const g = v3();
  g.setKst('2026-11-16 11:55');
  punch(g, '이지은', '5678', 'in'); // 가산 12:00~21:00
  g.setKst('2026-11-17 00:20');
  const r = punch(g, '이지은', '5678', 'out');
  assert.equal(r.prevDay, '2026-11-16');
  assert.deepEqual([r.early, r.work], [0, 12 * 60 + 25], '조퇴 0분, 근무 12시간 25분');
  const log = g.sheet('출퇴근기록');
  const rows = [];
  for (let i = 2; i <= log.getLastRow(); i++) if (log.rowDisplay(i)[2] === '이지은') rows.push(log.rowDisplay(i));
  assert.equal(rows.length, 1, '오늘 줄을 새로 만들지 않아요');
  assert.deepEqual([rows[0][0], rows[0][5], rows[0][6]], ['2026-11-16', '11:55', '00:20']);
  assert.ok(!Number(rows[0][8]), '조퇴 칸은 0(빈칸)');
  assert.equal(g.gs.getToday('이지은').tOut, '', '오늘(11/17) 기록은 비어 있어요');
  assert.equal(g.gs.getHome('이지은', '5678').missingOut, null, '어제 퇴근 누락 안내도 없어요');
  // 어제 출근이 없으면 예전처럼 오늘 줄에(출근 기록 없음)
  g.setKst('2026-11-17 00:30');
  const r2 = punch(g, '김민우', '0123', 'out');
  assert.equal(r2.prevDay, '');
  assert.equal(r2.today.date, '2026-11-17');
  // 정정으로 '퇴근 00:20'을 넣어도 조퇴가 아니에요
  assert.deepEqual(plain(g.gs.calc_('12:00', '21:00', '11:55', '00:20', 10000, 0)), { late: 0, early: 0, work: 745, deduct: 0 });
  assert.equal(g.gs.calc_('12:00', '21:00', '11:55', '20:00', 10000, 0).early, 60, '보통 조퇴는 그대로');
});

test('휴무표 매장 칸: setup이 예전 매장 이름을 지금 이름으로 바꾸고, [직원] 탭과 다른 줄은 지금 매장 묶음으로 옮겨요', () => {
  const g = v3();
  g.sheet('매장').getRange(4, 1, 1, 3).setValues([['사무실(왕)', '10:00', '19:00']]);
  g.sheet('직원').getRange(7, 1, 1, 2).setValues([['오사무', '사무실(왕)']]);
  g.gs.setup();
  const nov = g.sheet('휴무표 2026-11');
  // 예전 이름으로 적힌 줄(옮겨 오기 전 시트에서 가져온 것처럼)
  const oh = monthRowOf(g, '2026-11', '오사무');
  nov.getRange(oh.r, 2).setValue('사무실(영)');
  // 이지은은 [직원] 탭에서는 가산인데 휴무표에는 왕십리로 적혀 있음
  const lee = monthRowOf(g, '2026-11', '이지은');
  nov.getRange(lee.r, 2).setValue('왕십리');
  g.gs.setMark_('2026-11-10', '이지은', () => '휴무');
  g.gs.setup();
  assert.equal(monthRowOf(g, '2026-11', '오사무').v[1], '사무실(왕)');
  const lee2 = monthRowOf(g, '2026-11', '이지은');
  assert.equal(lee2.v[1], '가산');
  assert.equal(mark(g, '이지은', '2026-11-10'), '휴무', '기록째 옮겨요');
  assert.ok(lee2.r > monthRowOf(g, '2026-11', '박점장').r, '가산 묶음(왕십리 아래)으로');
  // 지난달 탭은 그때 매장 그대로 둬요
  g.gs.adminMakeMonth('582941', '2026-10');
  const oct = g.sheet('휴무표 2026-10');
  oct.getRange(monthRowOf(g, '2026-10', '이지은').r, 2).setValue('왕십리');
  g.gs.setup();
  assert.equal(monthRowOf(g, '2026-10', '이지은').v[1], '왕십리');
});

/* ───── 근무자: 결근? 띠와 알림, 내 월차 내역, 승인된 휴무 취소 요청 ───── */

test("결근?이 적히면 본인에게 알리고, 첫 화면에 '일했어요 / 못 나왔어요' 띠를 보여줘요(요청을 보내면 사라져요)", () => {
  const g = v3({ email: 'owner@example.com' });
  tgOn(g, { 김민우: '9002' });
  g.setKst('2026-11-16 23:40');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민우', '2026-11-16'), '결근?');
  const dm = sentTo(g, 9002).find((t) => /휴무표에 '결근\?'으로 적혔어요/.test(t));
  assert.ok(dm, '본인에게 알림');
  assert.match(dm, /11\/16\(월\) 출퇴근 기록이 없어요[\s\S]*11\/30까지/);
  g.setKst('2026-11-17 09:30');
  let h = plain(g.gs.getHome('김민우', '0123'));
  assert.deepEqual(h.absent, [{ date: '2026-11-16', dow: '월', until: '2026-11-30' }]);
  assert.equal(plain(g.gs.getHome('김민우', '9999')).absent, undefined, '비밀번호가 틀리면 안 보여줘요');
  // 사장님이 직접 적은 '무단'은 띠에 안 넣어요
  g.gs.setMark_('2026-11-13', '김민우', () => '무단');
  assert.equal(plain(g.gs.getHome('김민우', '0123')).absent.length, 1);
  // 무급으로 바꿔 달라고 요청하면 띠에서 빠져요
  req(g, '김민우', '0123', 'off', { offType: '무급', date: '2026-11-16', reason: '아팠어요', to: 'admin' });
  h = plain(g.gs.getHome('김민우', '0123'));
  assert.deepEqual(h.absent, []);
  // 14일이 지난 결근?은 띠에 안 나와요(요청도 못 보내요)
  g.gs.setMark_('2026-11-02', '김민우', () => '결근?');
  assert.deepEqual(plain(g.gs.getHome('김민우', '0123')).absent, []);
  // 신청 화면에 보여줄 남은 개수
  assert.ok('monthly' in h.leave && 'sub' in h.leave);
});

test('내 월차 내역: 달마다 받은 것·쓴 날·남은 것·만근을 직원이 직접 봐요', () => {
  const g = v3();
  g.setKst('2026-11-20 10:00');
  g.gs.adminMakeMonth('582941', '2026-10');
  g.gs.setMark_('2026-10-14', '김민우', () => '월차');
  g.gs.setMark_('2026-11-05', '김민우', () => '9월차');
  g.gs.setMark_('2026-11-12', '김민우', () => '월차');
  // 수식은 가짜 시트가 계산을 못 해서, 시트가 계산해 둔 값처럼 적어 둬요
  const nov = g.sheet('휴무표 2026-11');
  const r = monthRowOf(g, '2026-11', '김민우').r;
  nov.getRange(r, 7, 1, 2).setValues([[1, 2]]); // 부여 1, 잔여 2
  nov.getRange(r, 10).setValue('아님: 11/17 결근?');
  const L = plain(g.gs.getLeave('김민우', '0123', ''));
  assert.equal(L.year, '2026');
  const m10 = L.months.find((m) => m.m === 10), m11 = L.months.find((m) => m.m === 11);
  assert.deepEqual([m10.used, m10.dates], [1, [14]]);
  assert.deepEqual([m11.used, m11.dates, m11.grant, m11.left, m11.full], [2, [5, 12], 1, 2, '아님: 11/17 결근?']);
  assert.equal(L.left, 2, '지금 남은 월차는 이번 달 잔여');
  assert.equal(L.month, 11);
  assert.throws(() => g.gs.getLeave('김민우', '9999', ''), /비밀번호가 틀렸어요/);
});

test('승인된 휴무 취소 요청: 승인되면 그날 칸이 비워지고, 대체휴무였으면 쓴 것도 되돌려요', () => {
  const g = v3();
  tgOn(g, { 김민우: '9002' });
  g.setKst('2026-11-16 10:00');
  g.gs.setMark_('2026-11-25', '김민우', () => '월차');
  g.gs.addSub_('2026-11-01', '이지은', '적립', 1, '휴무날 출근');
  req(g, '이지은', '5678', 'off', { offType: '대체', date: '2026-11-26', reason: '쉬고 싶어요', to: 'admin' });
  g.gs.adminRequest('582941', reqRows(g)[0][0], true);
  assert.equal(mark(g, '이지은', '2026-11-26'), '대체');
  assert.equal(g.gs.subBalance_('이지은').left, 0);
  // 취소 요청
  req(g, '김민우', '0123', 'cancel', { date: '2026-11-25', to: 'admin' });
  req(g, '이지은', '5678', 'cancel', { date: '2026-11-26', to: 'admin' });
  assert.throws(() => req(g, '김민우', '0123', 'cancel', { date: '2026-11-25' }), /이미 보냈어요/);
  assert.throws(() => req(g, '김민우', '0123', 'cancel', { date: '2026-11-24' }), /승인된 휴무\(휴무·월차·반차·대체·무급\)가 아니에요/);
  const t = plain(g.gs.adminToday('582941'));
  const q1 = t.requests.find((x) => x.name === '김민우'), q2 = t.requests.find((x) => x.name === '이지은' && x.kind === '취소');
  assert.deepEqual([q1.kind, q1.what], ['취소', '월차 취소']);
  g.gs.adminRequest('582941', q1.id, true);
  g.gs.adminRequest('582941', q2.id, true);
  assert.equal(mark(g, '김민우', '2026-11-25'), '');
  assert.equal(mark(g, '이지은', '2026-11-26'), '');
  assert.equal(g.gs.subBalance_('이지은').left, 1, '대체휴무가 되돌아와요');
  assert.match(sentTo(g, 9002).at(-1), /휴무 취소 요청이 승인됐어요[\s\S]*월차 취소/);
  // 그 사이 사장님이 칸을 다른 걸로 바꿨으면 승인이 막혀요
  g.gs.setMark_('2026-11-27', '김민우', () => '휴무');
  req(g, '김민우', '0123', 'cancel', { date: '2026-11-27', to: 'admin' });
  g.gs.setMark_('2026-11-27', '김민우', () => '반차');
  const q3 = plain(g.gs.adminToday('582941')).requests.find((x) => x.date === '2026-11-27');
  assert.throws(() => g.gs.adminRequest('582941', q3.id, true), /이미 "반차"\(으\)로 바뀌어 있어요/);
  // 지난 날짜는 취소 요청을 못 보내요
  g.gs.setMark_('2026-11-10', '김민우', () => '휴무');
  assert.throws(() => req(g, '김민우', '0123', 'cancel', { date: '2026-11-10' }), /지난 날짜의 휴무는 취소할 수 없어요/);
});

test('예전 휴무표 가져오기(검토에서 나온 것): 퇴사 뒤 빈 줄, 같은 이름 두 줄, 중간에 빠진 달, 다시 가져오기', () => {
  const g = v3();
  g.gs.setSetting_('앱시작일', '');
  g.setKst('2026-11-20 10:00');
  const build = (edit) => oldFile(g, [
    oldBlock(2026, 1, [
      { store: '왕십리', name: '김민우', days: { 3: '휴무', 9: '12월차', ...(edit ? { 20: '10월차', 22: '11월차' } : { 14: '휴무' }) } },
      { store: '왕십리', name: '한퇴사', days: { 4: '휴무', 20: '퇴사' } },
      { store: '왕십리', name: '박두줄', days: { 2: '휴무', 5: '월차' } },
      { store: '가산', name: '박두줄', days: { 15: '휴무', 20: '월차', 25: '무단' } }, // 달 중간에 옮겨서 줄이 둘
      { store: '가산', name: '이지은', days: { 6: '휴무' } },
    ]),
    oldBlock(2026, 2, [
      { store: '왕십리', name: '김민우', days: { 2: '휴무' } },
      { store: '왕십리', name: '한퇴사' }, // 퇴사했는데 달 틀을 복사하면서 따라온 빈 줄
      { store: '가산', name: '박두줄', days: { 3: '휴무' } },
      // 이지은은 2월 묶음에 없음(중간에 빠진 달)
    ]),
    oldBlock(2026, 3, [
      { store: '왕십리', name: '김민우', days: { 7: '휴무' } },
      { store: '왕십리', name: '한퇴사' },
      { store: '가산', name: '박두줄', days: { 9: '휴무' } },
      { store: '가산', name: '이지은', days: { 10: '월차' } },
    ]),
  ]);
  build(false);
  const v = plain(g.gs.adminImportPreview('582941', OLD_URL, '2026'));
  assert.equal(v.dups, 1, '같은 이름 두 줄을 알려줘요');
  assert.deepEqual([v.people.gone, v.people.notInStaff], [1, ['박두줄']], '한퇴사는 퇴사자로(빈 줄이 남아 있어도)');
  assert.deepEqual(v.months.map((m) => m.people), [4, 2, 3], '2·3월에 한퇴사 빈 줄은 안 넣어요');
  importAll(g);
  // 같은 이름 두 줄: 한 줄로 합치고(나중 줄 매장), 둘째 줄 기록도 들어가요
  const two = monthCells(g, '2026-01', '박두줄');
  assert.deepEqual([two.row[1], two.row[10 + 1], two.row[10 + 4], two.row[10 + 14], two.row[10 + 19], two.row[10 + 24]], ['가산', '휴무', '월차', '휴무', '월차', '무단']);
  assert.ok(!monthCells(g, '2026-02', '한퇴사') && !monthCells(g, '2026-03', '한퇴사'));
  assert.deepEqual([hrRow(g, '한퇴사')['상태'], hrRow(g, '한퇴사')['퇴사일']], ['퇴사', '2026-01-20']);
  // 중간에 빠진 달: 3월 이월 칸에 1월 말 잔여(부여 1 − 사용 0 = 1)를 숫자로 적어 이어 줘요
  const lee3 = monthCells(g, '2026-03', '이지은');
  assert.equal(lee3.raw[5], 1, '빠진 달 다음 달 이월 = 그때까지의 잔여');
  assert.match(String(lee3.raw[6]), /'휴무표 2026-02'/, '부여는 수식(2월에 줄이 없어서 0)');
  assert.equal(plain(g.gs.oldLoad_(OLD_URL, '2026')).people['이지은'].left, 0, '예상 잔여 = 1 + 0 − 1');
  const done = plain(g.gs.adminImportFinish('582941', OLD_URL, '2026')).done;
  assert.equal(done.kept, 0, '가져오기가 넣은 이월 숫자는 직접 적은 숫자로 세지 않아요');
  // 예전 파일을 고친 뒤 다시 가져오기: 1/14 휴무를 지우고, 작년 월차 2개를 더 씀
  build(true);
  const v2 = plain(g.gs.adminImportPreview('582941', OLD_URL, '2026'));
  assert.deepEqual([v2.months[0].change, v2.months[0].clear], [2, 1], '바꿀 칸 2, 지울 칸 1(가져오기가 만든 탭은 예전 파일과 똑같이)');
  importAll(g);
  const kim1 = monthCells(g, '2026-01', '김민우');
  assert.deepEqual([kim1.row[10 + 13], kim1.row[10 + 19], kim1.row[10 + 21]], ['', '10월차', '11월차']);
  assert.deepEqual([kim1.raw[5], kim1.raw[6]], [2, 1], '1월 이월도 다시 맞춰요(작년 월차 3개 − 1월 부여 1)');
  // 원래 있던 탭(11월)은 새 시트에만 있는 칸을 그대로 두고, 미리 보기에 몇 칸인지 알려줘요
  g.gs.setMark_('2026-11-12', '김민우', () => '휴무');
  oldFile(g, [oldBlock(2026, 11, [{ store: '왕십리', name: '김민우', days: { 3: '휴무' } }])]);
  const v3b = plain(g.gs.adminImportPreview('582941', OLD_URL, '2026'));
  assert.deepEqual([v3b.months[0].m, v3b.months[0].extra, v3b.months[0].clear], [11, 1, 0]);
});

test('검토에서 나온 것(퇴사): 퇴사 취소하면 \'퇴사\' 글자가 지워지고, 며칠 뒤 퇴사 처리하면 그 사이 \'결근?\'을 치워요', () => {
  const g = v3({ email: 'owner@example.com' });
  g.setKst('2026-11-20 10:00');
  // 잘못 눌러 퇴사 처리(어제) → 바로 퇴사 취소
  g.gs.adminRetire('582941', '박점장', '2026-11-19');
  assert.equal(mark(g, '박점장', '2026-11-20'), '퇴사');
  const back = plain(g.gs.adminUnretire('582941', '박점장'));
  assert.equal(mark(g, '박점장', '2026-11-20'), '', "'퇴사' 글자가 남으면 오늘이 쉬는 날이 돼요");
  assert.match(back.note, /취소된 요청, 다음 달에 골라 둔 휴무, 점장 칸은 되돌아오지 않으니/);
  assert.notEqual(plain(g.gs.adminToday('582941').list).find((p) => p.name === '박점장').status, '휴무');
  // 11/10까지만 나오고 연락이 끊긴 직원: 밤 마감이 적은 '결근?'이 쌓였다가, 11/20에 '마지막 근무일 11/10'으로 퇴사 처리
  ['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16'].forEach((d) => g.gs.setMark_(d, '최유나', () => '결근?'));
  g.gs.setMark_('2026-11-17', '최유나', () => '무단'); // 사장님이 직접 적은 건 그대로
  g.gs.adminRetire('582941', '최유나', '2026-11-10');
  assert.deepEqual(['2026-11-11', '2026-11-12', '2026-11-13', '2026-11-16', '2026-11-17'].map((d) => mark(g, '최유나', d)), ['퇴사', '', '', '', '무단']);
  assert.equal(g.gs.adminYear('582941', '최유나', '2026').months[10].absent, 1, "치운 '결근?'은 안 세고 사장님이 적은 '무단'만 세요");
  // 달을 넘겨 처리(마지막 10/30, 처리 11/20): 11월 탭에 '결근?'만 있으면 줄을 빼요
  ['2026-11-02', '2026-11-03'].forEach((d) => g.gs.setMark_(d, '이지은', () => '결근?'));
  const c = plain(g.gs.adminRetire('582941', '이지은', '2026-10-30'));
  assert.match(c.note, /11·12월 휴무표에서 줄을 뺐어요|11월 휴무표에서 줄을 뺐어요/);
  assert.ok(!monthRowOf(g, '2026-11', '이지은'));
});

test('검토에서 나온 것(퇴사): 손으로 만든 빈 휴무표 탭이 있어도 퇴사 정리가 끝나고, 자동 퇴사는 새벽 5시 뒤에 해요', () => {
  const g = v3({ email: 'owner@example.com' });
  g.setKst('2026-11-16 10:00');
  g.book.insertSheet('휴무표 2027-01'); // 칸 26개짜리 빈 탭
  req(g, '최유나', '1357', 'off', { date: '2026-11-25', reason: '개인', to: 'admin' });
  g.gs.adminRetire('582941', '최유나', '2026-11-16'); // 오늘이 마지막 근무일(퇴사 예정)
  g.setKst('2026-11-16 12:00');
  punch(g, '최유나', '1357', 'in', NEAR, 'dddddddddddddddd');
  // 자정을 넘겨 퇴근: 00:05 검사가 먼저 퇴사 처리하면 못 찍어요 → 5시 전에는 퇴사 처리를 안 해요
  g.setKst('2026-11-17 00:05');
  g.gs.checkMissing();
  assert.equal(g.gs.findStaff_('최유나').active, true);
  g.setKst('2026-11-17 00:20');
  assert.equal(punch(g, '최유나', '1357', 'out', NEAR, 'dddddddddddddddd').prevDay, '2026-11-16');
  g.setKst('2026-11-17 05:10');
  g.gs.checkMissing();
  assert.equal(g.gs.findStaff_('최유나').active, false, '5시 뒤 첫 검사에서 퇴사 처리');
  assert.equal(reqRows(g)[0][7], '취소', '빈 탭이 있어도 남은 요청 정리까지 끝나요');
  assert.doesNotThrow(() => g.gs.monthGrid_('2027-01', true));
});

test("검토에서 나온 것(요청): 대타를 구하다 안 나온 날, 쉬는 공휴일의 거절, 마감 뒤 같은 날 거절", () => {
  const g = v3({ email: 'owner@example.com' });
  tgOn(g);
  // 대타를 구하는 중인데 아무도 안 받고 본인도 안 나옴 → 밤 마감이 '결근?'을 적어요
  g.setKst('2026-11-16 09:00');
  req(g, '김민우', '0123', 'swap', { date: '2026-11-16', reason: '급한 일' });
  // 이지은은 휴무 요청을 보내고 안 나옴 → 마감은 기다리고, 마감 뒤 23:50에 거절해도 '결근?'이 적혀요
  req(g, '이지은', '5678', 'off', { date: '2026-11-16', reason: '병원', to: 'admin' });
  g.setKst('2026-11-16 23:40');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민우', '2026-11-16'), '결근?', '대타를 받은 사람이 없으면 본인이 나와야 하는 날');
  assert.equal(mark(g, '이지은', '2026-11-16'), '');
  assert.match(sentTo(g, 555).find((x) => /하루 마감 정리/.test(x)), /처리 안 된 요청 2건/, '대타도 처리 안 된 요청에 나와요');
  g.setKst('2026-11-16 23:50');
  const t = plain(g.gs.adminToday('582941'));
  g.gs.adminRequest('582941', t.requests.find((x) => x.name === '이지은').id, false);
  assert.equal(mark(g, '이지은', '2026-11-16'), '결근?', '마감이 끝난 뒤에는 같은 날이어도 적어요');
  // 매장이 쉰 공휴일(성탄절)의 요청을 다음 날 거절해도 '결근?'을 안 적어요
  g.setKst('2026-12-24 10:00');
  req(g, '김민우', '0123', 'off', { date: '2026-12-25', reason: '쉬고 싶어요', to: 'admin' });
  g.setKst('2026-12-25 23:40');
  g.gs.checkMissing();
  g.setKst('2026-12-26 09:00');
  const t2 = plain(g.gs.adminToday('582941'));
  g.gs.adminRequest('582941', t2.requests.find((x) => x.name === '김민우' && x.date === '2026-12-25').id, false);
  assert.equal(mark(g, '김민우', '2026-12-25'), '', '그 매장에 아무도 안 나온 공휴일은 결근이 아니에요');
});

test('검토에서 나온 것(입사일·퇴사일): 입사일보다 먼저 나온 신입은 입사일을 당기고, 연도 없는 퇴사일은 올해로, 못 읽는 날짜는 표시해요', () => {
  const g = v3();
  g.setKst('2026-11-16 09:50');
  g.gs.joinSubmit(joinForm({ start: '2026-12-01' }));
  g.gs.adminJoin('582941', '한신입', true);
  assert.ok(!monthRowOf(g, '2026-11', '한신입'), '입사일이 12/1이라 11월 휴무표에는 줄이 없어요');
  assert.throws(() => req(g, '한신입', '4826', 'off', { date: '2026-11-25', reason: 'x' }), /입사일\(2026-12-01\) 전 날짜예요/);
  // 교육 받으러 11/17에 미리 나와 출근을 찍음(지각)
  g.setKst('2026-11-17 10:07');
  punch(g, '한신입', '4826', 'in', NEAR, NEWPHONE);
  assert.equal(hrRow(g, '한신입')['입사일'], '2026-11-17', '입사일을 실제로 나온 날로 당겨요');
  assert.match(hrRow(g, '한신입')['등록'], /입사일 전에 출근해서 입사일을 당김\(2026-12-01 → 2026-11-17\)/);
  assert.equal(mark(g, '한신입', '2026-11-17'), '10:07', '지각 시간이 휴무표에 적혀요');
  // 퇴사일을 연도 없이 '11/30'으로 적으면 올해 날짜로, '11월 말'은 못 읽는다고 표시
  const hs = g.sheet('인사');
  const rk = g.gs.hrFind_('김민우').row, rl = g.gs.hrFind_('이지은').row, cE = colOf(hs, '퇴사일'), cS = colOf(hs, '입사일');
  hs.getRange(rk, cE).setValue('11/30');
  hs.getRange(rl, cE).setValue('11월 말');
  hs.getRange(rl, cS).setValue('3/2'); // 입사일은 연도가 있어야 해요
  g.gs.onEdit({ range: hs.getRange(rk, cE, rl - rk + 1, 1) });
  assert.equal(hrRow(g, '김민우')['퇴사일'], '2026-11-30');
  assert.equal(plain(g.gs.adminHrGet('582941', '김민우')).leaving, true);
  assert.equal(hrRow(g, '이지은')['퇴사일'], '11월 말');
  assert.match(hs.notes[rl + ',' + cE], /날짜를 읽지 못했어요/);
  assert.match(hs.notes[rl + ',' + cS], /날짜를 읽지 못했어요/);
  assert.equal(plain(g.gs.adminHrGet('582941', '이지은')).leaving, false, '못 읽는 날짜는 퇴사 예정으로 안 봐요');
  hs.getRange(rl, cE).setValue('2026-11-30');
  g.gs.onEdit({ range: hs.getRange(rl, cE) });
  assert.ok(!hs.notes[rl + ',' + cE], '고치면 표시가 지워져요');
});

test('검토에서 나온 것([인사] 탭): 여러 줄을 붙여넣어도 시트 작업이 적고, 무거운 정리는 10분 검사로 넘겨요', () => {
  const g = v3();
  g.setKst('2026-11-16 14:00');
  const st = g.sheet('직원');
  st.getRange(7, 1, 10, 2).setValues(Array.from({ length: 10 }, (_, i) => ['직원' + String.fromCharCode(65 + i), '왕십리']));
  g.gs.setup();
  const hs = g.sheet('인사');
  const cS = colOf(hs, '지점'), r0 = g.gs.hrFind_('직원A').row;
  for (let i = 0; i < 10; i++) hs.getRange(r0 + i, cS).setValue('가산');
  // 시트 작업 수 세기
  let ops = 0;
  const skip = new Set(['constructor', 'each', 'getRow', 'getColumn', 'getNumRows', 'getNumColumns', 'getSheet', 'getName', 'getSheetId', 'getRange', 'getRangeList', 'key', 'get', 'fmt', 'setFmt', 'set', 'display', 'rowDisplay']);
  const protos = [Object.getPrototypeOf(hs.getRange(1, 1)), Sheet.prototype];
  const saved = [];
  for (const proto of protos) for (const k of Object.getOwnPropertyNames(proto)) {
    if (skip.has(k) || typeof proto[k] !== 'function') continue;
    const orig = proto[k];
    saved.push([proto, k, orig]);
    proto[k] = function (...a) { ops++; return orig.apply(this, a); };
  }
  try {
    g.gs.MEMO_ = {};
    g.gs.GRID_ = {};
    g.gs.onEdit({ range: hs.getRange(r0, cS, 10, 1) });
  } finally {
    for (const [proto, k, orig] of saved) proto[k] = orig;
  }
  assert.ok(ops <= 150, '지점 10줄 붙여넣기 시트 작업 ' + ops + '번 (예산 150. 예전에는 약 700번이라 30초를 넘겼어요)');
  assert.equal(g.gs.findStaff_('직원J').store, '가산', '[직원] 매장은 바로 바뀌고');
  assert.equal(monthRowOf(g, '2026-11', '직원J').v[1], '왕십리', '휴무표 줄은 아직');
  g.gs.checkMissing();
  assert.equal(monthRowOf(g, '2026-11', '직원J').v[1], '가산', '10분 검사가 옮겨요');
  assert.equal(g.props.get('hrTodo'), undefined, '넘겨 둔 일은 한 번 하고 지워요');
});

test('검토에서 나온 것([인사] 탭): 이름을 손으로 고치면 인사 정보가 따라오고, 다른 탭 이름도 맞춰요. 사장님 화면에서 이름 바꾸기', () => {
  const g = v3();
  g.setKst('2026-11-16 09:58');
  punch(g, '김민우', '0123', 'in');
  g.gs.hrSave('김민우', '0123', joinForm({ rrn: '900202-1357924', device: PHONE.김민우 }));
  req(g, '김민우', '0123', 'off', { date: '2026-11-25', reason: '병원', to: 'admin' });
  // [직원] 탭에서 이름을 김민우 → 김민우A 로 고침
  const st = g.sheet('직원');
  st.getRange(ROW.김민우, 1).setValue('김민우A');
  g.gs.onEdit({ range: st.getRange(ROW.김민우, 1), oldValue: '김민우' }); // 구글 시트는 한 칸을 고치면 고치기 전 값을 같이 알려줘요
  assert.equal(hrRow(g, '김민우'), null, '빈 줄을 새로 만들지 않고');
  const h = hrRow(g, '김민우A');
  assert.equal(h['주민번호'], '900202-1******', '인사 정보가 새 이름으로 따라와요');
  assert.match(h['이동 기록'], /2026-11-16 이름 바꿈\(김민우 → 김민우A\)/);
  assert.equal(g.gs.getHome('김민우A', '0123').hr, false, '정보를 다시 넣으라고 안 해요');
  g.gs.checkMissing(); // 다른 탭은 10분 검사가 맞춰요
  assert.ok(monthRowOf(g, '2026-11', '김민우A') && !monthRowOf(g, '2026-11', '김민우'));
  assert.equal(g.gs.getToday('김민우A', '0123').tIn, '09:58', '출퇴근기록도 새 이름으로');
  assert.equal(reqRows(g)[0][2], '김민우A');
  // [인사] 탭에서 이름 오타를 고치면 [직원] 탭 이름도 맞춰요
  const hs = g.sheet('인사');
  const rl = g.gs.hrFind_('이지은').row;
  hs.getRange(rl, 1).setValue('이지인');
  g.gs.onEdit({ range: hs.getRange(rl, 1) });
  assert.ok(g.gs.findStaff_('이지인') && !g.gs.findStaff_('이지은'));
  assert.equal(g.sheet('인사').getLastRow(), hs.getLastRow());
  assert.ok(!hrRow(g, '이지은'), '빈 줄이 안 생겨요');
  // 사장님 화면: 이름 바꾸기(한 번에 모든 탭)
  g.gs.setMark_('2026-11-10', '박점장', () => '휴무');
  const c = plain(g.gs.adminRename('582941', '박점장', '박점장B'));
  assert.equal(c.name, '박점장B');
  assert.match(c.note, /이름을 박점장B\(으\)로 바꿨어요/);
  assert.equal(mark(g, '박점장B', '2026-11-10'), '휴무');
  assert.equal(g.sheet('매장').rowDisplay(2)[7], '박점장B', '점장 칸도');
  assert.deepEqual(plain(g.gs.getStaffList().managers), ['박점장B']);
  assert.throws(() => g.gs.adminRename('582941', '박점장B', '최유나'), /이미 있는 이름/);
  assert.throws(() => g.gs.adminRename({ name: '박점장B', pin: '246813' }, '최유나', '최유나B'), /관리자/);
});

test('검토에서 나온 것([인사] 탭): 퇴사자와 이름만 같은 새 사람을 [직원]에 손으로 넣어도 예전 사람 정보가 새 사람에게 안 보여요', () => {
  const g = v3();
  g.setKst('2026-11-16 14:00');
  // 예전 박퇴사의 인사 정보(주민번호·계좌)
  const hs = g.sheet('인사');
  const rOld = g.gs.hrFind_('박퇴사').row;
  hs.getRange(rOld, colOf(hs, '주민번호')).setValue('8505051234567');
  hs.getRange(rOld, colOf(hs, '휴대폰')).setValue('010-7777-8888');
  hs.getRange(rOld, colOf(hs, '계좌번호')).setValue('110123456789');
  g.gs.onEdit({ range: hs.getRange(rOld, 1, 1, hs.getLastColumn()) });
  // 사장님이 [직원] 탭에 같은 이름의 새 직원 줄을 손으로 추가(예전 줄은 X 그대로)
  const st = g.sheet('직원');
  st.getRange(7, 1, 1, 3).setValues([['박퇴사', '가산', '2468']]);
  g.gs.onEdit({ range: st.getRange(7, 1, 1, 3) });
  assert.equal(hrRow(g, '박퇴사')['상태'], '퇴사', '예전 사람 줄을 되살리지 않아요');
  const mine = plain(g.gs.hrGet('박퇴사', '2468'));
  assert.deepEqual([mine.rrn, mine.phone, mine.account], ['', '', ''], '새 사람에게 예전 사람 정보가 안 보여요');
  assert.equal(g.gs.getHome('박퇴사', '2468').hr, true, '새 사람은 자기 정보를 넣으라는 안내를 받아요');
  assert.deepEqual(plain(g.gs.adminToday('582941').ghosts), ['박퇴사'], '사장님 화면에 알려줘요');
  // 새 사람이 자기 정보를 넣어도 예전 사람 줄을 덮어쓰지 않아요
  g.gs.hrSave('박퇴사', '2468', joinForm({ rrn: '030303-3456789', phone: '01022223333' }));
  const rows = [];
  for (let r = 2; r <= hs.getLastRow(); r++) if (hs.rowDisplay(r)[0] === '박퇴사') rows.push(hs.rowDisplay(r));
  assert.deepEqual(rows.map((r) => [r[2], r[7]]), [['퇴사', '850505-1******'], ['근무', '030303-3******']]);
});

test('검토에서 나온 것([인사] 탭): 대기 두 줄 손 승인, 같은 이름이 있으면 시트에서는 승인 안 함, 상태를 지운 대기 줄, 머리글을 바꿨을 때', () => {
  const g = v3();
  g.setKst('2026-11-16 14:00');
  // 대기 줄 둘: 박퇴사(예전 퇴사자와 같은 이름), 한신입. 그 아래에 직원 줄(최아래)이 있음
  g.gs.joinSubmit(joinForm({ name: '박퇴사', rrn: '040404-3456789', phone: '01055554444', device: 'eeeeeeeeeeeeeeee' }));
  g.gs.joinSubmit(joinForm());
  g.sheet('직원').getRange(7, 1, 1, 2).setValues([['최아래', '가산']]);
  g.gs.syncHr_();
  const hs = g.sheet('인사');
  const cT = colOf(hs, '상태');
  const r1 = g.gs.hrFind_('박퇴사', '승인 대기').row, r2 = g.gs.hrFind_('한신입', '승인 대기').row;
  hs.getRange(r1, cT).setValue('근무');
  hs.getRange(r2, cT).setValue('근무');
  g.gs.onEdit({ range: hs.getRange(Math.min(r1, r2), cT, Math.abs(r1 - r2) + 1, 1) });
  assert.ok(g.gs.findStaff_('한신입') && g.gs.findStaff_('한신입').active, '한신입은 승인');
  assert.equal(g.gs.hrFind_('박퇴사', '승인 대기').state, '승인 대기', '같은 이름이 있으면 시트에서는 승인하지 않아요');
  assert.match(hs.notes[g.gs.hrFind_('박퇴사', '승인 대기').row + ',' + cT], /같은 사람인지 확인이 필요해서 사장님 화면/);
  assert.deepEqual([hrRow(g, '최아래')['상태'], hrRow(g, '최아래')['지점']], ['근무', '가산'], '아래 직원 줄은 그대로');
  assert.deepEqual(plain(g.gs.adminToday('582941').joins).map((j) => j.name), ['박퇴사']);
  // 대기 줄의 상태 칸을 지우면 다시 '승인 대기'로 돌려요(주민번호·비밀번호가 든 줄이 떠돌지 않게)
  const rw = g.gs.hrFind_('박퇴사', '승인 대기').row;
  hs.getRange(rw, cT).setValue('');
  g.gs.onEdit({ range: hs.getRange(rw, cT) });
  assert.equal(g.gs.hrFind_('박퇴사', '승인 대기').row, rw);
  // 같은 폰으로 다른 사람이 등록하면 앞사람 등록을 덮어쓰지 않고 막아요
  assert.throws(() => g.gs.joinSubmit(joinForm({ name: '두두리', rrn: '960202-2345678', phone: '01077776666', device: 'eeeeeeeeeeeeeeee' })), /이 폰으로 이미 박퇴사 님 입사 등록을 보냈어요/);
  // 고쳐서 승인하다 실패하면 고친 이름도 원래대로
  assert.throws(() => g.gs.adminJoin('582941', '박퇴사', true, { name: '박퇴사B', store: '없는지점' }), /없는지점 지점이 \[매장\] 탭에 없어요/);
  assert.ok(g.gs.hrFind_('박퇴사', '승인 대기'));
  // 머리글 '이름'을 바꾸면 줄을 못 읽어요: 이름 없는 줄을 계속 만들지 않고 멈춰요
  const before = hs.getLastRow();
  hs.getRange(1, 1).setValue('성명');
  g.gs.MEMO_ = {};
  g.gs.onEdit({ range: g.sheet('직원').getRange(2, 2) });
  g.gs.onEdit({ range: g.sheet('직원').getRange(2, 2) });
  assert.equal(hs.getLastRow(), before);
});

/* ───── 운영자: 확인할 것 모아 보기, 월차 현황, 이동 취소, 점장 범위 ───── */

test("확인할 것 모아 보기: '결근?'·퇴근 누락을 한 곳에서 보고 한꺼번에 처리해요(바꾼 기록은 칸 메모에)", () => {
  const g = v3({ email: 'owner@example.com' });
  g.setKst('2026-11-16 12:03');
  punch(g, '이지은', '5678', 'in'); // 퇴근 안 찍음
  g.setKst('2026-11-16 23:40');
  g.gs.checkMissing(); // 김민우·박점장·최유나 결근?
  g.setKst('2026-11-17 23:40');
  g.gs.checkMissing();
  g.setKst('2026-11-18 10:00');
  req(g, '최유나', '1357', 'off', { offType: '무급', date: '2026-11-16', reason: '아팠어요', to: 'admin' });
  let is = plain(g.gs.adminIssues('582941', ''));
  assert.equal(is.ym, '2026-11');
  assert.ok(is.absent.length >= 6);
  assert.deepEqual(is.absent.filter((x) => x.name === '최유나').map((x) => [x.date, x.asked]), [['2026-11-16', '무급'], ['2026-11-17', '']], '이미 요청을 보낸 날은 표시');
  assert.deepEqual(is.noOut.map((x) => [x.name, x.date, x.tIn, x.sOut]), [['이지은', '2026-11-16', '12:03', '21:00']]);
  // 김민우 이틀을 한꺼번에 무급으로, 박점장 하루는 지우기(실제로는 나온 날)
  is = plain(g.gs.adminFixAbsent('582941', [{ name: '김민우', date: '2026-11-16' }, { name: '김민우', date: '2026-11-17' }], '무급', '병가'));
  assert.equal(is.done, 2);
  assert.deepEqual([mark(g, '김민우', '2026-11-16'), mark(g, '김민우', '2026-11-17')], ['무급', '무급']);
  const nov = g.sheet('휴무표 2026-11');
  assert.match(nov.notes[monthRowOf(g, '2026-11', '김민우').r + ',' + (10 + 16)], /11\/18 10:00 사장님: 결근\? → 무급 \(병가\)/);
  g.gs.adminFixAbsent('582941', [{ name: '박점장', date: '2026-11-16' }], '');
  assert.equal(mark(g, '박점장', '2026-11-16'), '');
  assert.ok(!plain(g.gs.adminIssues('582941', '')).absent.some((x) => x.name === '김민우'));
  assert.throws(() => g.gs.adminFixAbsent('582941', [{ name: '박점장', date: '2026-11-17' }], '반차'), /바꿀 종류/);
  // 퇴근 시간 넣기
  is = plain(g.gs.adminSetTime('582941', '이지은', '2026-11-16', 'out', '21:05'));
  assert.deepEqual(is.noOut, []);
  const log = g.sheet('출퇴근기록');
  const row = log.rowDisplay(2);
  assert.deepEqual([row[2], row[6]], ['이지은', '21:05']);
  assert.match(row[13], /사장님이 퇴근 시간 넣음: 21:05/);
  // 점장: 자기 매장 것만 보고, 고치지는 못해요
  const mi = plain(g.gs.adminIssues(MGR, ''));
  assert.ok(mi.absent.every((x) => x.store === '왕십리') && mi.admin === false);
  assert.throws(() => g.gs.adminFixAbsent(MGR, [{ name: '박점장', date: '2026-11-17' }], '무급'), /관리자/);
  assert.throws(() => g.gs.adminSetTime(MGR, '이지은', '2026-11-16', 'out', '21:00'), /관리자/);
});

test('월차 현황: 그 달 이월·부여·사용(쓴 날)·잔여·만근을 한 장으로, 1년 치는 탭으로', () => {
  const g = v3();
  g.setKst('2026-11-20 10:00');
  g.gs.setMark_('2026-11-05', '김민우', () => '월차');
  g.gs.setMark_('2026-11-12', '김민우', () => '9월차');
  const nov = g.sheet('휴무표 2026-11');
  const r = monthRowOf(g, '2026-11', '김민우').r;
  nov.getRange(r, 6, 1, 3).setValues([[2, 1, 1]]); // 시트가 계산해 둔 값처럼: 이월 2, 부여 1, 잔여 1
  nov.getRange(r, 10).setValue('만근 예정');
  const L = plain(g.gs.adminLeave('582941', '2026-11'));
  const kim = L.rows.find((x) => x.name === '김민우');
  assert.deepEqual(kim, { name: '김민우', store: '왕십리', carry: 2, grant: 1, used: 2, dates: [5, 12], left: 1, full: '만근 예정', grantAuto: false, prevFull: '' });
  assert.deepEqual(L.rows.map((x) => x.name), ['김민우', '박점장', '이지은', '최유나'], '휴무표 줄 순서(매장 묶음)');
  assert.deepEqual(plain(g.gs.adminLeave(MGR, '2026-11')).rows.map((x) => x.name), ['김민우', '박점장'], '점장은 자기 매장만');
  // 1년 탭
  const out = g.gs.adminExportLeave('582941', '2026');
  assert.equal(out.name, '월차 2026');
  const sh = g.sheet('월차 2026');
  const head = sh.rowDisplay(1);
  assert.deepEqual(head.slice(0, 6), ['이름', '매장', '지금 잔여', '올해 받음', '올해 씀', '만근 달']);
  const row = sheetRows(sh).find((x) => x[0] === '김민우');
  assert.deepEqual([row[2], row[3], row[4]], ['1', '1', '2']);
  assert.equal(row[head.indexOf('11월 잔여')], '1');
  assert.equal(row[head.indexOf('쓴 날')], '11/5, 11/12');
  assert.throws(() => g.gs.adminExportLeave(MGR, '2026'), /관리자/);
});

test('지점 이동 취소: 이동 기록의 마지막 줄을 지우고 원래 지점으로 되돌려요. [인사] 지점·상태는 목록에서 골라요', () => {
  const g = v3();
  g.setKst('2026-11-16 14:00');
  g.gs.setMark_('2026-11-10', '김민우', () => '휴무');
  const moved = plain(g.gs.adminMove('582941', '김민우', '가산', '2026-11-16'));
  assert.equal(moved.lastMove, '2026-11-16 왕십리→가산');
  const back = plain(g.gs.adminMoveUndo('582941', '김민우'));
  assert.deepEqual([back.store, back.moves, back.lastMove], ['왕십리', '', '']);
  assert.match(back.note, /2026-11-16 왕십리→가산 이동을 취소했어요/);
  assert.equal(g.gs.findStaff_('김민우').store, '왕십리');
  assert.equal(monthRowOf(g, '2026-11', '김민우').v[1], '왕십리');
  assert.equal(mark(g, '김민우', '2026-11-10'), '휴무', '기록째 돌아와요');
  assert.throws(() => g.gs.adminMoveUndo('582941', '김민우'), /되돌릴 지점 이동 기록이 없어요/);
  // [인사] 지점·상태 칸에 고르는 목록
  const hs = g.sheet('인사');
  const v1 = hs.validations['2,' + colOf(hs, '지점')], v2 = hs.validations['2,' + colOf(hs, '상태')];
  assert.deepEqual(plain(v1.calls.find((c) => c[0] === 'requireValueInList')[1]), ['왕십리', '가산']);
  assert.deepEqual(plain(v2.calls.find((c) => c[0] === 'requireValueInList')[1]), ['근무', '퇴사', '승인 대기']);
  assert.deepEqual(plain(v1.calls.find((c) => c[0] === 'setAllowInvalid')), ['setAllowInvalid', true], '직접 적거나 붙여넣어도 막지 않아요');
});

test('점장 범위: 자기 매장에 승인을 기다리는 신입이 있다는 것만 보이고(승인은 사장님), 다른 매장 신입은 안 보여요', () => {
  const g = v3();
  g.setKst('2026-11-16 14:00');
  g.gs.joinSubmit(joinForm()); // 왕십리
  g.gs.joinSubmit(joinForm({ name: '두신입', rrn: '960202-2345678', device: 'ffffffffffffffff', phone: '01077776666', store: '가산' }));
  const t = plain(g.gs.adminToday(MGR));
  assert.deepEqual(t.waiting, [{ name: '한신입', store: '왕십리', start: '2026-11-16' }]);
  assert.deepEqual(t.joins, [], '주민번호 앞자리·휴대폰 같은 정보와 승인 단추는 점장에게 안 가요');
  assert.throws(() => g.gs.adminJoin(MGR, '한신입', true), /관리자/);
  assert.deepEqual(plain(g.gs.adminToday('582941').waiting), []);
});

test('지원 근무: 자기 매장 반경 안이면(옆 매장이 더 가깝게 잡혀도) 자기 매장으로 봐요', () => {
  const g = v3();
  // 사무실이 왕십리 매장에서 40m쯤 떨어져 있어요(같은 건물·옆 건물)
  g.sheet('매장').getRange(4, 1, 1, 3).setValues([['사무실', '09:00', '18:00']]);
  g.sheet('직원').getRange(7, 1, 1, 3).setValues([['오사무', '사무실', '2468']]);
  hrFill(g, ['오사무']);
  g.gs.setup();
  g.gs.adminSetPlace('582941', '사무실', STORE.lat, STORE.lng + 0.00045);
  g.setKst('2026-11-16 08:55');
  // 오사무가 사무실에 있는데 GPS는 왕십리 매장 쪽에 더 가깝게 잡힘
  const r = g.gs.punch({ name: '오사무', pin: '2468', type: 'in', lat: STORE.lat, lng: STORE.lng + 0.0001, acc: 20, device: 'abababababababab', label: 'x', agree: true });
  assert.deepEqual([r.support, r.late], ['', 0], '지원 근무가 아니에요(자기 매장 시간 09:00 기준)');
  const log = g.sheet('출퇴근기록');
  assert.deepEqual([log.rowDisplay(2)[3], log.rowDisplay(2)[14]], ['09:00', '사무실']);
  assert.equal(mark(g, '오사무', '2026-11-16'), '');
});

test('폰 2대: 새 폰 요청을 [추가]로 승인하면 두 폰 모두 찍혀요(2대까지). [바꾸기]는 예전 폰을 못 쓰게 해요', () => {
  const g = fresh();
  const PHONE2 = 'zzzzzzzzzzzzzzzz', PHONE3 = 'yyyyyyyyyyyyyyyy';
  g.setKst('2026-11-16 09:58');
  punch(g, '김민우', '0123', 'in'); // 첫 폰 등록
  g.setKst('2026-11-16 20:01');
  assert.throws(() => punch(g, '김민우', '0123', 'out', NEAR, PHONE2, '갤럭시 업무폰'), /등록된 폰이 아니에요/);
  const pend = plain(g.gs.adminToday('582941').pending)[0];
  assert.deepEqual([pend.name, pend.have.length], ['김민우', 1]);
  assert.match(pend.label, /갤럭시 업무폰/);
  g.gs.adminDevice('582941', '김민우', true, 'add');
  assert.equal(g.gs.findStaff_('김민우').deviceIds.length, 2);
  punch(g, '김민우', '0123', 'out', NEAR, PHONE2); // 둘째 폰으로 퇴근
  g.setKst('2026-11-17 09:58');
  punch(g, '김민우', '0123', 'in'); // 첫 폰으로도 계속 찍혀요
  assert.match(plain(g.gs.adminToday('582941').devices).find((d) => d.name === '김민우').label, /iPhone 사파리.* \/ .*갤럭시 업무폰/);
  // 다른 직원은 김민우의 둘째 폰으로 못 찍어요
  g.setKst('2026-11-17 12:00');
  assert.throws(() => punch(g, '이지은', '5678', 'in', NEAR, PHONE2), /김민우 님 폰으로 등록돼 있어요/);
  // 셋째 폰: 추가는 안 되고, [바꾸기]를 누르면 그 폰만 남아요
  g.setKst('2026-11-17 20:00');
  assert.throws(() => punch(g, '김민우', '0123', 'out', NEAR, PHONE3, '새 아이폰'), /등록된 폰이 아니에요/);
  assert.throws(() => g.gs.adminDevice('582941', '김민우', true, 'add'), /이미 폰이 2대 등록돼 있어요/);
  g.gs.adminDevice('582941', '김민우', true, 'replace');
  assert.deepEqual(plain(g.gs.findStaff_('김민우').deviceIds), [PHONE3]);
  assert.throws(() => punch(g, '김민우', '0123', 'out', NEAR, PHONE2), /등록된 폰이 아니에요/);
  punch(g, '김민우', '0123', 'out', NEAR, PHONE3);
});

test('내 인사 정보 보호: 등록된 내 폰에서만 보고 고쳐요. 계좌·휴대폰이 바뀌면 사장님께 알려요', () => {
  const g = v3({ email: 'owner@example.com', hr: false });
  tgOn(g);
  g.setKst('2026-11-16 09:58');
  const f = { rrn: '900202-1234567', phone: '010-2222-3333', addr: '서울', bank: '신한', account: '110-123-456789', emergency: '010-9999-8888 어머니', start: '2024-03-02', agree: true, device: PHONE.김민우 };
  g.gs.hrSave('김민우', '0123', f); // 비밀번호가 이미 있는 직원: 인사 정보부터
  punch(g, '김민우', '0123', 'in'); // 폰 등록
  assert.equal(sentTo(g, 555).filter((t) => /인사 정보가 바뀌었어요/.test(t)).length, 0, '처음 넣는 건 알림을 안 보내요');
  // 비밀번호를 아는 다른 사람이 다른 폰에서 열어 보려 해도 안 돼요
  assert.throws(() => g.gs.hrGet('김민우', '0123', 'qqqqqqqqqqqqqqqq'), /등록된 폰\)에서만 볼 수 있어요/);
  assert.throws(() => g.gs.hrGet('김민우', '0123'), /등록된 폰/);
  assert.throws(() => g.gs.hrSave('김민우', '0123', { ...f, account: '999-999-999999', device: 'qqqqqqqqqqqqqqqq' }), /등록된 폰/);
  assert.equal(hrRow(g, '김민우')['계좌번호'], '110-123-456789');
  // 본인이 계좌와 휴대폰을 바꾸면 사장님께 알림(번호는 끝자리만)
  g.gs.hrSave('김민우', '0123', { ...f, rrn: '', bank: '국민', account: '123456-78-901234', phone: '010-9999-8888' });
  const note = sentTo(g, 555).find((t) => /인사 정보가 바뀌었어요/.test(t));
  assert.match(note, /김민우 \(왕십리\) 님이 직접 고쳤어요/);
  assert.match(note, /계좌: 신한 끝자리 6789 → 국민 끝자리 1234/);
  assert.match(note, /휴대폰: 끝자리 3333 → 끝자리 8888/);
  assert.ok(!/110-123-456789|123456-78-901234/.test(note), '알림에 계좌번호 전체는 안 넣어요');
  // 주소만 바꾸면 알림 없음
  const before = sentTo(g, 555).length;
  g.gs.hrSave('김민우', '0123', { ...f, rrn: '', bank: '국민', account: '123456-78-901234', phone: '010-9999-8888', addr: '서울 성동구' });
  assert.equal(sentTo(g, 555).length, before);
  // 아직 폰이 등록 안 된 직원(이지은)은 그대로 넣을 수 있어요
  g.gs.hrSave('이지은', '5678', { ...f, rrn: '950505-2468135', device: '' });
});

test('휴가 종류와 여러 날 신청: 휴가·병가·경조·예비군, 며칠을 한 번에 보내면 근무하는 날마다 한 줄씩 묶음으로', () => {
  const g = v3({ email: 'owner@example.com' });
  tgOn(g, { 김민우: '9002' });
  g.setKst('2026-11-16 10:00');
  // 11/23(월)~11/29(일) 여름휴가: 김민우는 토·일이 원래 쉬는 날이라 5일
  req(g, '김민우', '0123', 'off', { offType: '휴가', date: '2026-11-23', dateTo: '2026-11-29', reason: '여름휴가', to: 'admin' });
  const mine = reqRows(g).filter((r) => r[2] === '김민우');
  assert.equal(mine.length, 5);
  assert.deepEqual(mine.map((r) => r[4]), ['2026-11-23', '2026-11-24', '2026-11-25', '2026-11-26', '2026-11-27']);
  assert.ok(mine.every((r) => r[3] === '휴가' && /^R[0-9A-Z]+\.\d$/.test(r[0])), '묶음 번호');
  const note = sentTo(g, 555).filter((t) => /휴가 요청/.test(t));
  assert.equal(note.length, 1, '알림은 한 번만');
  assert.match(note[0], /김민우 · 휴가 요청 \(5일\)[\s\S]*11\/23\(월\) ~ 11\/27\(금\) · 근무하는 날 5일/);
  // 사장님: 묶음을 한 번에 승인
  const ids = mine.map((r) => r[0]);
  const out = plain(g.gs.adminRequestMany('582941', ids, true));
  assert.deepEqual(out.many, { done: 5, fail: [] });
  assert.deepEqual(['2026-11-23', '2026-11-27', '2026-11-28'].map((d) => mark(g, '김민우', d)), ['휴가', '휴가', '']);
  assert.equal(g.gs.adminYear('582941', '김민우', '2026').months[10].off, 5, '휴가는 휴무 일수에 세요');
  // 병가: 결근?으로 적힌 지난 날을 병가로 바꿔 달라고(14일 안)
  g.gs.setMark_('2026-11-13', '김민우', () => '결근?');
  req(g, '김민우', '0123', 'off', { offType: '병가', date: '2026-11-13', reason: '독감', to: 'admin' });
  g.gs.adminRequest('582941', reqRows(g).at(-1)[0], true);
  assert.equal(mark(g, '김민우', '2026-11-13'), '병가');
  // 경조·예비군도 그대로 적혀요. 쉬는 날이라 그날은 미출근 알림·결근?이 없어요
  req(g, '김민우', '0123', 'off', { offType: '예비군', date: '2026-11-18', reason: '동원 훈련', to: 'admin' });
  g.gs.adminRequest('582941', reqRows(g).at(-1)[0], true);
  g.setKst('2026-11-18 23:40');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민우', '2026-11-18'), '예비군');
  // 한 번에 너무 길게는 안 돼요
  g.setKst('2026-11-19 10:00');
  assert.throws(() => req(g, '이지은', '5678', 'off', { offType: '휴가', date: '2026-11-23', dateTo: '2026-12-31', reason: 'x' }), /31일까지만|14일/);
  // 대체휴무 여러 날: 남은 것보다 많이는 안 돼요
  g.gs.addSub_('2026-11-01', '이지은', '적립', 1, '휴무날 출근');
  assert.throws(() => req(g, '이지은', '5678', 'off', { offType: '대체', date: '2026-11-23', dateTo: '2026-11-24', reason: 'x' }), /대체휴무가 모자라요/);
});

/* ───── 3차: 대신 찍기, 자동 올림, 퇴근 알림, 지각 사유, 외근 요청, 알림 단추 ───── */

test('대신 찍어 주기: 점장은 자기 매장 직원만, 이유가 기록·의심기록에 남고 사장님께 알림', () => {
  const g = v3({ email: 'owner@example.com' });
  tgOn(g);
  g.setKst('2026-11-16 10:03');
  const out = plain(g.gs.proxyPunch(MGR, '김민우', 'in', '폰 방전'));
  assert.deepEqual(out.proxy, { name: '김민우', type: 'in', time: '10:03', late: 3 });
  const row = g.sheet('출퇴근기록').rowDisplay(2);
  assert.deepEqual([row[2], row[5]], ['김민우', '10:03']);
  assert.match(row[13], /박점장 점장이 대신 찍음: 폰 방전/);
  assert.deepEqual(plain(suspects(g).at(-1).slice(1, 3)), ['김민우', '대신 찍음']);
  assert.match(sentTo(g, 555).at(-1), /대신 찍음\n[\s\S]*\[왕십리\] 김민우 출근 10:03\n박점장 점장: 폰 방전/);
  assert.equal(mark(g, '김민우', '2026-11-16'), '10:03', '지각 표시도 평소처럼');
  assert.throws(() => g.gs.proxyPunch(MGR, '이지은', 'in', '폰 고장'), /점장님 매장 직원만/);
  assert.throws(() => g.gs.proxyPunch(MGR, '박점장', 'in', '폰 고장'), /본인 출퇴근은 대신 찍을 수 없어요/);
  assert.throws(() => g.gs.proxyPunch(MGR, '김민우', 'out', ''), /이유를 적어주세요/);
  assert.throws(() => g.gs.proxyPunch(MGR, '김민우', 'in', '또'), /이미 10:03에 출근/);
  g.setKst('2026-11-16 20:05');
  g.gs.proxyPunch('582941', '김민우', 'out', '폰 분실');
  assert.match(g.sheet('출퇴근기록').rowDisplay(2)[13], /사장님이 대신 찍음: 폰 분실/);
});

test('점장이 하루 넘게 안 본 요청은 사장님께 자동으로 올라가요', () => {
  const g = v3({ email: 'owner@example.com' });
  tgOn(g);
  g.setKst('2026-11-16 15:00');
  req(g, '김민우', '0123', 'off', { date: '2026-11-25', reason: '병원' }); // 점장에게
  assert.equal(reqRows(g)[0][10], '점장');
  g.setKst('2026-11-17 14:50');
  g.gs.checkMissing();
  assert.equal(reqRows(g)[0][10], '점장', '24시간 전에는 그대로');
  g.setKst('2026-11-17 15:10');
  g.gs.checkMissing();
  assert.equal(reqRows(g)[0][10], '관리자');
  assert.match(reqRows(g)[0][11], /자동 · 점장 확인 없이 하루가 지나서/);
  assert.match(sentTo(g, 555).at(-1), /점장이 하루 넘게 안 본 요청 1건\n[\s\S]*김민우 11\/25\(수\) 휴무/);
  assert.equal(plain(g.gs.adminToday('582941')).requests.length, 1, '사장님 화면에서 승인할 수 있어요');
  const n = sentTo(g, 555).length;
  g.setKst('2026-11-17 15:20');
  g.gs.checkMissing();
  assert.equal(sentTo(g, 555).length, n, '한 번만 알려요');
});

test('퇴근 예정 10분 뒤에도 안 찍으면 본인에게 한 번 알리고, 지각한 날은 사유를 바로 남길 수 있어요', () => {
  const g = v3();
  tgOn(g, { 김민우: '9002' });
  g.setKst('2026-11-16 10:12');
  punch(g, '김민우', '0123', 'in');
  g.gs.lateNote('김민우', '0123', '지하철 고장');
  assert.match(g.sheet('출퇴근기록').rowDisplay(2)[13], /지각 사유: 지하철 고장/);
  g.gs.lateNote('김민우', '0123', '2호선 지연');
  const memo = g.sheet('출퇴근기록').rowDisplay(2)[13];
  assert.ok(/지각 사유: 2호선 지연/.test(memo) && !/지하철 고장/.test(memo), '다시 적으면 바꿔요');
  assert.throws(() => g.gs.lateNote('이지은', '5678', '늦잠'), /오늘 지각 기록이 없어요/);
  g.setKst('2026-11-16 20:05');
  g.gs.checkMissing();
  assert.ok(!sentTo(g, 9002).some((t) => /퇴근을 아직 안 찍었어요/.test(t)), '10분 전에는 안 보내요');
  g.setKst('2026-11-16 20:15');
  g.gs.checkMissing();
  assert.match(sentTo(g, 9002).at(-1), /퇴근을 아직 안 찍었어요\n오늘 20:00 퇴근 예정이었어요/);
  const n = sentTo(g, 9002).length;
  g.setKst('2026-11-16 20:25');
  g.gs.checkMissing();
  assert.equal(sentTo(g, 9002).length, n, '한 번만');
});

test('외근·교육 요청: 승인되면 그날은 매장 밖에서도 찍히고 휴무표에 외근이 적혀요', () => {
  const g = v3({ email: 'owner@example.com' });
  tgOn(g);
  g.setKst('2026-11-16 09:00');
  const FAR = { lat: 37.7, lng: 126.978, acc: 10 };
  req(g, '김민우', '0123', 'out', { date: '2026-11-17', reason: '본사 교육', to: 'admin' });
  assert.throws(() => req(g, '김민우', '0123', 'out', { date: '2026-11-17', reason: '또' }), /이미 보냈어요/);
  assert.throws(() => req(g, '김민우', '0123', 'out', { date: '2026-11-18', reason: '' }), /어디서 무엇을/);
  const q = plain(g.gs.adminToday('582941')).requests[0];
  assert.deepEqual([q.kind, q.what], ['외근', '외근']);
  // 승인 전에는 매장 밖에서 못 찍어요
  g.setKst('2026-11-17 09:55');
  assert.throws(() => punch(g, '김민우', '0123', 'in', FAR), /떨어져 있어요/);
  g.gs.adminRequest('582941', q.id, true);
  assert.equal(mark(g, '김민우', '2026-11-17'), '외근');
  const r = punch(g, '김민우', '0123', 'in', FAR);
  assert.equal(r.late, 0);
  assert.match(g.sheet('출퇴근기록').rowDisplay(2)[13], /외근\(승인\)/);
  // 다음 날은 다시 매장에서만
  g.setKst('2026-11-18 09:55');
  assert.throws(() => punch(g, '김민우', '0123', 'in', FAR), /떨어져 있어요/);
  // 사장님 알림에는 [사장님 화면 열기] 단추가 붙어요
  const last = g.tg.sent.filter((m) => String(m.chat_id) === '555').at(-1);
  assert.deepEqual(plain(last.reply_markup), { inline_keyboard: [[{ text: '사장님 화면 열기', url: 'https://script.google.com/macros/s/TEST/exec?page=admin' }]] });
});

test('지점 이동 예약: 앞날을 고르면 그날 새벽에 자동으로 옮기고, 본인·사장님에게 알려요', () => {
  const g = v3({ email: 'owner@example.com' });
  tgOn(g, { 김민우: '9002' });
  g.setKst('2026-11-16 14:00');
  const c = plain(g.gs.adminMove('582941', '김민우', '가산', '2026-11-20'));
  assert.deepEqual(c.moveDue, { store: '가산', date: '2026-11-20' });
  assert.equal(c.store, '왕십리', '아직 안 옮겼어요');
  assert.match(c.note, /11\/20\(금\)에 자동으로 가산\(으\)로 옮겨요\. 본인에게 텔레그램으로 알렸어요/);
  assert.match(sentTo(g, 9002).at(-1), /지점 이동 예정\n11\/20\(금\)부터 가산 지점으로 옮겨요/);
  assert.deepEqual(plain(g.gs.adminHrList('582941')).list.find((x) => x.name === '김민우').moveDue, { store: '가산', date: '2026-11-20' });
  // 그날 전에는 그대로
  g.setKst('2026-11-19 12:00');
  g.gs.checkMissing();
  assert.equal(g.gs.findStaff_('김민우').store, '왕십리');
  // 그날 새벽 5시 전에도 그대로(전날 밤 근무를 자정 넘겨 끝내는 사람)
  g.setKst('2026-11-20 04:50');
  g.gs.checkMissing();
  assert.equal(g.gs.findStaff_('김민우').store, '왕십리');
  g.setKst('2026-11-20 05:10');
  g.gs.checkMissing();
  assert.equal(g.gs.findStaff_('김민우').store, '가산');
  assert.equal(hrRow(g, '김민우')['이동 기록'], '2026-11-20 왕십리→가산');
  assert.equal(monthRowOf(g, '2026-11', '김민우').v[1], '가산');
  assert.match(sentTo(g, 9002).at(-1), /오늘부터 가산 지점이에요/);
  assert.match(sentTo(g, 555).at(-1), /지점 이동\n[^\n]*\n김민우: 왕십리 → 가산 \(예약해 둔 이동\)/);
  assert.equal(plain(g.gs.adminHrGet('582941', '김민우')).moveDue, null);
  const n = sentTo(g, 555).length;
  g.setKst('2026-11-20 05:20');
  g.gs.checkMissing();
  assert.equal(sentTo(g, 555).length, n, '한 번만');
});

test('지점 이동 예약: 취소, 다시 예약하면 바뀜, 이름을 바꿔도 따라가고, 퇴사하면 없어져요', () => {
  const g = v3();
  g.setKst('2026-11-16 14:00');
  g.gs.adminMove('582941', '김민우', '가산', '2026-11-20');
  g.gs.adminMove('582941', '김민우', '가산', '2026-11-25'); // 날짜 바꾸기
  assert.equal(plain(g.gs.adminHrGet('582941', '김민우')).moveDue.date, '2026-11-25');
  const c = plain(g.gs.adminMoveCancel('582941', '김민우'));
  assert.equal(c.moveDue, null);
  assert.match(c.note, /지점 이동 예약\(11\/25\(수\) 가산\)을 취소했어요/);
  assert.throws(() => g.gs.adminMoveCancel('582941', '김민우'), /예약해 둔 지점 이동이 없어요/);
  // 이름 바꾸기
  g.gs.adminMove('582941', '김민우', '가산', '2026-11-25');
  g.gs.adminRename('582941', '김민우', '김민우A');
  assert.equal(plain(g.gs.adminHrGet('582941', '김민우A')).moveDue.store, '가산');
  // 퇴사 예정일보다 뒤로는 예약할 수 없어요
  g.gs.adminRetire('582941', '이지은', '2026-11-20');
  assert.throws(() => g.gs.adminMove('582941', '이지은', '왕십리', '2026-11-25'), /마지막 근무일\(2026-11-20\)보다 뒤/);
  // 바로 퇴사 처리하면 예약도 없어져요
  g.gs.adminRetire('582941', '김민우A', '2026-11-15');
  assert.equal(plain(g.gs.adminHrGet('582941', '김민우A')).moveDue, null);
  g.setKst('2026-11-25 06:00');
  g.gs.checkMissing();
  assert.equal(g.gs.findStaff_('김민우A').store, '왕십리');
  // 오늘 날짜로 옮기면 예약은 지워져요
  g.setKst('2026-11-26 10:00');
  g.gs.adminMove('582941', '최유나', '왕십리', '2026-11-30');
  g.gs.adminMove('582941', '최유나', '왕십리', '2026-11-26');
  assert.equal(plain(g.gs.adminHrGet('582941', '최유나')).moveDue, null);
  assert.equal(g.gs.findStaff_('최유나').store, '왕십리');
  assert.throws(() => g.gs.adminMove(MGR, '최유나', '가산', '2026-11-30'), /관리자/);
});

test('휴직: 기간 동안 쉬는 날로 보고 휴무표에 적어요. 결근?·미출근 알림이 없고 그 달은 만근이 아니에요', () => {
  const g = v3({ email: 'owner@example.com' });
  tgOn(g);
  g.setKst('2026-11-16 09:00');
  g.gs.setMark_('2026-11-19', '김민우', () => '월차');
  const c = plain(g.gs.adminAway('582941', '김민우', '2026-11-17', '2026-12-10', '병가'));
  assert.deepEqual(c.away, { from: '2026-11-17', to: '2026-12-10', why: '병가', on: false });
  assert.equal(c.moves, '2026-11-17 휴직(~2026-12-10, 병가)');
  assert.match(c.note, /11\/17\(화\)부터 12\/10\(목\)까지 휴직으로 넣었어요/);
  assert.equal(mark(g, '김민우', '2026-11-17'), '휴직');
  assert.equal(mark(g, '김민우', '2026-11-19'), '월차', '이미 적힌 말은 그대로');
  assert.equal(mark(g, '김민우', '2026-11-30'), '휴직');
  assert.equal(mark(g, '김민우', '2026-12-10'), '휴직', '다음 달 탭이 있으면 같이');
  assert.equal(mark(g, '김민우', '2026-12-11'), '');
  assert.equal(mark(g, '김민우', '2026-11-16'), '');
  // 만근 수식에 휴직 조건이 들어 있어요
  const me = monthRowOf(g, '2026-11', '김민우');
  const full = colOf(g.sheet('휴무표 2026-11'), '만근');
  assert.match(String(g.sheet('휴무표 2026-11').cells.get(me.r + ',' + full)), /REGEXMATCH\(K\d+:AO\d+&"","휴직"\)\),"아님: 휴직 "/);
  // 그 기간은 쉬는 날: 미출근 알림도, 밤의 결근?도 없어요
  g.setKst('2026-11-17 10:30');
  assert.equal(g.gs.schedFor_(g.gs.findStaff_('김민우'), '2026-11-17'), null);
  g.gs.checkMissing();
  assert.ok(!sentTo(g, 555).some((t) => /아직 출근 안 찍은 직원[\s\S]*김민우/.test(t)));
  g.setKst('2026-11-17 23:40');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민우', '2026-11-17'), '휴직');
  const today = plain(g.gs.adminToday('582941')).list.find((x) => x.name === '김민우');
  assert.deepEqual([today.status, today.mark], ['휴무', '휴직']);
  const row = plain(g.gs.adminHrList('582941')).list.find((x) => x.name === '김민우');
  assert.deepEqual(row.away, { from: '2026-11-17', to: '2026-12-10', on: true });
  // 휴직 중에 출근을 찍으면 사장님께 알려요
  g.setKst('2026-11-18 09:55');
  punch(g, '김민우', '0123', 'in');
  assert.match(sentTo(g, 555).at(-1), /휴직 중인 직원이 출근을 찍었어요\n[^\n]*\n김민우 \(왕십리\) 09:55/);
  assert.throws(() => g.gs.adminAway('582941', '김민우', '2026-12-01', '2026-11-20'), /앞이에요/);
  assert.throws(() => g.gs.adminAway(MGR, '김민우', '2026-12-01', '2026-12-20'), /관리자/);
});

test('휴직: 일찍 끝내면 뒤 날짜 표시를 지우고 복직을 남겨요. 시작 전이면 통째로 취소, 기간을 다시 넣으면 바뀌어요', () => {
  const g = v3();
  g.setKst('2026-11-16 09:00');
  g.gs.adminAway('582941', '김민우', '2026-11-12', '2026-12-10', '');
  assert.equal(mark(g, '김민우', '2026-11-12'), '휴직', '지난 날도 빈 칸이면 적어요');
  // 이미 시작한 휴직은 첫날을 바꿀 수 없고, 끝나는 날만 바꿔요(지난 칸과 이동 기록 줄은 그대로)
  assert.throws(() => g.gs.adminAway('582941', '김민우', '2026-11-14', '2026-11-30', ''), /첫날을 바꿀 수 없어요/);
  const c1 = plain(g.gs.adminAway('582941', '김민우', '2026-11-12', '2026-11-30', '개인 사정'));
  assert.equal(c1.moves, '2026-11-12 휴직(~2026-11-30, 개인 사정)', '그 줄을 바꿔 적어요');
  assert.match(c1.note, /11\/30\(월\)까지로 줄였어요/);
  assert.equal(mark(g, '김민우', '2026-11-12'), '휴직', '지난 칸은 그대로');
  assert.equal(mark(g, '김민우', '2026-12-05'), '');
  assert.equal(mark(g, '김민우', '2026-11-30'), '휴직');
  const c1b = plain(g.gs.adminAway('582941', '김민우', '2026-11-12', '2026-12-03', '개인 사정'));
  assert.match(c1b.note, /12\/03\(목\)까지로 늘렸어요/);
  assert.equal(mark(g, '김민우', '2026-12-02'), '휴직');
  g.gs.adminAway('582941', '김민우', '2026-11-12', '2026-11-30', '개인 사정');
  // 일찍 끝내기: 날짜를 안 주면 어제까지
  g.setKst('2026-11-20 09:00');
  const c2 = plain(g.gs.adminAwayEnd('582941', '김민우', ''));
  assert.equal(c2.away, null, '끝난 휴직은 카드에서 빠져요');
  assert.equal(c2.moves, '2026-11-12 휴직(~2026-11-30, 개인 사정) · 2026-11-20 복직');
  assert.equal(mark(g, '김민우', '2026-11-19'), '휴직');
  assert.equal(mark(g, '김민우', '2026-11-20'), '');
  assert.ok(g.gs.schedFor_(g.gs.findStaff_('김민우'), '2026-11-20'), '다시 근무일');
  // 시작 전 취소
  g.gs.adminAway('582941', '이지은', '2026-12-01', '2026-12-31', '');
  const c3 = plain(g.gs.adminAwayEnd('582941', '이지은', ''));
  assert.equal(c3.away, null);
  assert.equal(c3.moves, '');
  assert.match(c3.note, /휴직을 취소했어요/);
  assert.equal(mark(g, '이지은', '2026-12-15'), '');
  assert.throws(() => g.gs.adminAwayEnd('582941', '이지은', ''), /넣어 둔 휴직이 없어요/);
});

test('휴직: 나중에 생긴 달 탭은 10분 검사가 채우고, 퇴사하면 마지막 근무일 뒤 표시를 지워요', () => {
  const g = v3();
  g.setKst('2026-11-16 09:00');
  g.gs.adminAway('582941', '최유나', '2026-11-20', '2027-02-10', '');
  assert.ok(!g.sheet('휴무표 2027-01'));
  g.setKst('2026-12-21 09:00');
  g.gs.checkMissing(); // 20일이 지나 다음 달(1월) 탭이 생겨요
  assert.equal(mark(g, '최유나', '2027-01-05'), '휴직');
  assert.equal(mark(g, '최유나', '2026-12-25'), '휴직');
  // 지난 날을 사장님이 지웠으면 다시 채우지 않아요
  g.gs.setMark_('2026-12-01', '최유나', () => '');
  g.gs.setMark_('2026-12-28', '최유나', () => '');
  g.gs.GRID_ = {};
  g.gs.checkMissing();
  assert.equal(mark(g, '최유나', '2026-12-01'), '');
  assert.equal(mark(g, '최유나', '2026-12-28'), '휴직', '앞날은 다시 채워요');
  // 휴직 중 퇴사: 마지막 근무일 뒤 표시는 지우고, 다음 달 줄은 빠져요
  const c = plain(g.gs.adminRetire('582941', '최유나', '2026-12-10'));
  assert.equal(c.away, null);
  assert.equal(mark(g, '최유나', '2026-12-10'), '휴직');
  assert.equal(mark(g, '최유나', '2026-12-11'), '퇴사');
  assert.equal(mark(g, '최유나', '2026-12-20'), '');
  assert.equal(monthRowOf(g, '2027-01', '최유나'), null);
});

test('인사 카드 체크 칸: 입사 서류·퇴사 정리를 체크하면 [인사] 탭에 적히고, 남은 개수가 목록에 보여요', () => {
  const g = v3();
  g.setKst('2026-11-16 09:00');
  const c0 = plain(g.gs.adminHrGet('582941', '김민우'));
  assert.deepEqual(c0.docs, { items: ['근로계약서', '신분증 사본', '통장 사본', '개인정보 보안 서약서'], done: [] });
  assert.equal(c0.offb.items.length, 6);
  const save = (name, extra) => {
    const c = plain(g.gs.adminHrGet('582941', name));
    return plain(g.gs.adminHrSave('582941', name, Object.assign({ start: c.start, phone: c.phone, addr: c.addr, bank: c.bank, account: c.account, holder: c.holder, emergency: c.emergency, memo: c.memo }, extra)));
  };
  const c1 = save('김민우', { docs: ['근로계약서', '통장 사본', '통장 사본', ''] });
  assert.deepEqual(c1.docs.done, ['근로계약서', '통장 사본']);
  assert.equal(hrRow(g, '김민우')['입사 서류'], '근로계약서, 통장 사본');
  const list = () => plain(g.gs.adminHrList('582941')).list;
  assert.equal(list().find((x) => x.name === '김민우').docsLeft, 2);
  assert.equal(list().find((x) => x.name === '이지은').docsLeft, 4);
  assert.equal(list().find((x) => x.name === '김민우').offLeft, 0, '퇴사 정리는 퇴사 예정·퇴사한 사람만');
  // 체크 칸을 안 보낸 저장(예전 화면)은 그대로 둬요
  assert.deepEqual(save('김민우', {}).docs.done, ['근로계약서', '통장 사본']);
  // 퇴사 예정이면 퇴사 정리도 세요
  g.gs.adminRetire('582941', '김민우', '2026-11-30');
  assert.equal(list().find((x) => x.name === '김민우').offLeft, 6);
  save('김민우', { offb: ['사직서', '인수인계'] });
  assert.equal(hrRow(g, '김민우')['퇴사 정리'], '사직서, 인수인계');
  assert.equal(list().find((x) => x.name === '김민우').offLeft, 4);
  // 항목은 [설정]에서 바꿀 수 있어요. 목록에서 빠진 예전 항목도 체크돼 있으면 그대로 남아요
  g.gs.setSetting_('입사서류목록', '근로계약서, 보건증');
  const c2 = plain(g.gs.adminHrGet('582941', '김민우'));
  assert.deepEqual(c2.docs, { items: ['근로계약서', '보건증'], done: ['근로계약서', '통장 사본'] });
  assert.equal(list().find((x) => x.name === '김민우').docsLeft, 1);
});

test('월 마감: 그달 숫자를 장부 탭에 적고, 그달 날짜의 요청·시간 고치기·결근? 정리를 막아요', () => {
  const g = v3({ email: 'owner@example.com' });
  // 10월 탭을 만들고 기록을 넣어요
  g.setKst('2026-10-05 10:07');
  g.gs.setup();
  punch(g, '김민우', '0123', 'in');
  g.setKst('2026-10-05 20:01');
  punch(g, '김민우', '0123', 'out');
  g.gs.setMark_('2026-10-12', '김민우', () => '월차');
  g.gs.setMark_('2026-10-13', '이지은', () => '결근?');
  g.gs.setMark_('2026-10-14', '최유나', () => '휴무');
  // 달이 안 끝났으면 못 해요
  assert.throws(() => g.gs.adminMonthClose('582941', '2026-10'), /달이 끝난 뒤에/);
  assert.equal(plain(g.gs.adminIssues('582941', '2026-10')).canClose, false);
  // 말일 밤 정리가 끝나기 전(다음 날 새벽 6시 전)에는 못 해요
  g.setKst('2026-11-01 00:20');
  assert.throws(() => g.gs.adminMonthClose('582941', '2026-10'), /아침 6시 뒤/);
  g.setKst('2026-11-03 14:20');
  assert.deepEqual([plain(g.gs.adminIssues('582941', '2026-10')).canClose, plain(g.gs.adminIssues('582941', '2026-10')).closed], [true, '']);
  // 기다리는 요청이 있으면 먼저 처리
  req(g, '김민우', '0123', 'fix', { date: '2026-10-30', which: 'out', time: '20:00', reason: '깜빡', to: 'admin' });
  assert.throws(() => g.gs.adminMonthClose('582941', '2026-10'), /기다리는 요청이 1건/);
  g.gs.adminRequest('582941', plain(g.gs.adminToday('582941')).requests[0].id, false);
  // 결근?이 남아 있으면 한 번 더 물어봐요
  const need = plain(g.gs.adminMonthClose('582941', '2026-10'));
  assert.equal(need.need, true);
  assert.ok(need.absent >= 1);
  assert.equal(g.gs.isClosed_('2026-10'), false);
  assert.throws(() => g.gs.adminMonthClose(MGR, '2026-10', true), /관리자/);
  const r = plain(g.gs.adminMonthClose('582941', '2026-10', true));
  assert.equal(r.closed, '2026-11-03 14:20');
  assert.match(r.done, /10월을 마감했어요\. \d+명의 숫자를 \[월 마감 2026\] 탭에 적어 뒀어요/);
  assert.throws(() => g.gs.adminMonthClose('582941', '2026-10', true), /이미 마감/);
  // 장부
  const book = sheetRows(g.sheet('월 마감 2026'));
  assert.deepEqual(book[0].slice(0, 6), ['월', '매장', '이름', '출근 기록(일)', '휴무', '월차 씀']);
  const mine = book.find((x) => x[2] === '김민우');
  assert.deepEqual([mine[0], mine[1], mine[3], mine[5], mine[9], mine[10], mine[14]], ['2026-10', '왕십리', '1', '1', '1', '7', '2026-11-03 14:20']);
  assert.equal(book.find((x) => x[2] === '이지은')[11], '1', '결근? 1칸');
  assert.equal(book.find((x) => x[2] === '최유나')[4], '1', '휴무 1');
  // 탭 보호(경고만)와 탭 색
  const tab = g.sheet('휴무표 2026-10');
  assert.deepEqual(tab.getProtections().map((p) => [p.getDescription(), p.isWarningOnly()]), [['월 마감 2026-11-03 14:20', true]]);
  assert.equal(tab.tabColor, '#9ca3af');
  // 막히는 것들
  assert.throws(() => req(g, '김민우', '0123', 'fix', { date: '2026-10-30', which: 'out', time: '20:00', reason: '깜빡' }), /10월은 마감한 달이라 요청을 보낼 수 없어요/);
  assert.throws(() => g.gs.adminSetTime('582941', '김민우', '2026-10-05', 'out', '20:30'), /10월은 마감한 달/);
  assert.throws(() => g.gs.adminFixAbsent('582941', [{ name: '이지은', date: '2026-10-13' }], '무급', ''), /10월은 마감한 달/);
  assert.throws(() => g.gs.adminRetire('582941', '최유나', '2026-10-20'), /10월은 마감한 달/);
  assert.equal(mark(g, '이지은', '2026-10-13'), '결근?');
  // 이번 달은 그대로 돼요
  req(g, '김민우', '0123', 'off', { date: '2026-11-10', offType: '휴무', reason: '집안일', to: 'admin' });
  // 마감 취소 → 고치고 → 다시 마감하면 장부의 그달 줄이 새로 적혀요
  const o = plain(g.gs.adminMonthOpen('582941', '2026-10'));
  assert.deepEqual([o.closed, o.canClose], ['', true]);
  assert.deepEqual(tab.getProtections(), []);
  assert.throws(() => g.gs.adminMonthOpen('582941', '2026-10'), /마감한 달이 아니에요/);
  assert.equal(mark(g, '김민우', '2026-10-30'), '결근?', '거절된 요청의 날은 결근?으로 적혀 있어요');
  g.gs.adminFixAbsent('582941', [{ name: '이지은', date: '2026-10-13' }, { name: '김민우', date: '2026-10-30' }], '무급', '');
  g.setKst('2026-11-04 09:00');
  const r2 = plain(g.gs.adminMonthClose('582941', '2026-10'));
  assert.equal(r2.closed, '2026-11-04 09:00', '결근?이 없으면 바로 마감');
  const book2 = sheetRows(g.sheet('월 마감 2026'));
  assert.equal(book2.filter((x) => x[2] === '이지은').length, 1, '그달 줄은 한 번만');
  assert.deepEqual([book2.find((x) => x[2] === '이지은')[11], book2.find((x) => x[2] === '이지은')[14]], ['0', '2026-11-04 09:00']);
});

test('월 마감: 마감한 달의 요청은 승인이 막히고, 가져오기는 건너뛰고, 5일부터 하루 요약에 알려줘요', () => {
  const g = v3({ email: 'owner@example.com' });
  tgOn(g);
  g.setKst('2026-10-29 10:00');
  g.gs.setup();
  req(g, '김민우', '0123', 'off', { date: '2026-10-30', offType: '휴무', reason: '집안일', to: 'admin' });
  const id = plain(g.gs.adminToday('582941')).requests[0].id;
  // 요청이 남은 채로 마감이 됐다고 치고(직접 표시) 승인을 눌러 봐요
  g.setKst('2026-11-05 10:00');
  g.gs.checkMissing();
  PropertiesServiceSet(g, 'monthClosed', JSON.stringify({ '2026-10': '2026-11-05 09:00' }));
  assert.throws(() => g.gs.adminRequest('582941', id, true), /10월은 마감한 달이라 바꿀 수 없어요/);
  g.gs.adminRequest('582941', id, false); // 거절은 돼요
  // 하루 요약: 마감했으면 알림이 없어요
  g.setKst('2026-11-05 23:40');
  g.gs.checkMissing();
  assert.ok(!sentTo(g, 555).some((t) => /아직 마감하지 않았어요/.test(t)));
  // 마감을 풀면 다음 날 밤 요약에 나와요
  g.gs.adminMonthOpen('582941', '2026-10');
  g.setKst('2026-11-06 23:40');
  g.gs.checkMissing();
  assert.match(sentTo(g, 555).at(-1), /10월을 아직 마감하지 않았어요 → 사장님 화면 \[월별\]에서 10월을 열고 \[마감하기\]/);
});

test('휴무 바꾸기: 원래 쉬는 날에 출근하고 다른 날 쉬어요. 승인되면 두 날이 근무표에서 맞바뀌어요', () => {
  const g = v3({ email: 'owner@example.com' });
  tgOn(g, { 김민우: '9002' });
  g.setKst('2026-11-16 09:00');
  // 김민우: 토·일 휴무(11/21 토, 11/22 일), 11/24(화)는 근무
  assert.equal(g.gs.schedFor_(g.gs.findStaff_('김민우'), '2026-11-21'), null);
  req(g, '김민우', '0123', 'move', { dateFrom: '2026-11-21', date: '2026-11-24', reason: '가족 모임이 화요일로 바뀜', to: 'admin' });
  const q = plain(g.gs.adminToday('582941')).requests[0];
  assert.deepEqual([q.kind, q.date, q.from, q.what], ['바꾸기', '2026-11-24', '2026-11-21', '2026-11-21 출근 10:00-20:00']);
  assert.match(sentTo(g, 555).at(-1), /휴무 바꾸기 요청\n[^\n]*\n11\/24\(화\) 쉬고, 대신 11\/21\(토\) 10:00-20:00 출근/);
  // 같은 날을 또 바꾸거나, 그 날에 다른 휴무 요청은 안 돼요
  assert.throws(() => req(g, '김민우', '0123', 'move', { dateFrom: '2026-11-21', date: '2026-11-25', reason: '또' }), /11\/21을\(를\) 바꾸는 요청을 이미/);
  assert.throws(() => req(g, '김민우', '0123', 'off', { date: '2026-11-24', offType: '월차', reason: '또' }), /이미 휴무 바꾸기 요청이 있어요/);
  // 잘못 고른 날
  assert.throws(() => req(g, '김민우', '0123', 'move', { dateFrom: '2026-11-23', date: '2026-11-25', reason: 'x' }), /11\/23\(월\)은 원래 근무하는 날이에요/);
  assert.throws(() => req(g, '김민우', '0123', 'move', { dateFrom: '2026-11-28', date: '2026-11-29', reason: 'x' }), /11\/29\(일\)은 원래 쉬는 날이에요/);
  assert.throws(() => req(g, '김민우', '0123', 'move', { dateFrom: '2026-11-28', date: '2026-11-28', reason: 'x' }), /같아요/);
  assert.throws(() => req(g, '김민우', '0123', 'move', { dateFrom: '2026-11-14', date: '2026-11-25', reason: 'x' }), /60일 안/);
  assert.throws(() => req(g, '김민우', '0123', 'move', { dateFrom: '2026-11-28', date: '2026-11-25', reason: '' }), /사유/);
  g.gs.setMark_('2026-11-28', '김민우', () => '월차');
  assert.throws(() => req(g, '김민우', '0123', 'move', { dateFrom: '2026-11-28', date: '2026-11-25', reason: 'x' }), /'월차'\(으\)로 적혀 있어서 바꿀 수 없어요/);
  // 승인: 11/24는 휴무, 11/21은 근무변경으로 10:00-20:00 출근
  g.gs.adminRequest('582941', q.id, true);
  assert.equal(mark(g, '김민우', '2026-11-24'), '쉼', "요일로 쉬는 날을 옮긴 거라 '쉼'(그달 휴무 수가 늘지 않게)");
  const s21 = g.gs.schedFor_(g.gs.findStaff_('김민우'), '2026-11-21');
  assert.deepEqual([s21.start, s21.end], [600, 1200]);
  assert.equal(g.gs.schedFor_(g.gs.findStaff_('김민우'), '2026-11-24'), null);
  assert.match(changeRows(g).at(-1).join('|'), /2026-11-21\|김민우\|10:00-20:00\|휴무 바꾸기: 11\/24\(화\) 대신 출근/);
  assert.match(sentTo(g, 9002).at(-1), /휴무 바꾸기 요청이 승인됐어요\n11\/24\(화\) 쉬고, 대신 11\/21\(토\) 10:00-20:00 출근/);
  const mine = plain(g.gs.getRequests('김민우', '0123')).mine[0];
  assert.deepEqual([mine.kind, mine.from, mine.state], ['바꾸기', '2026-11-21', '승인']);
  // 바뀐 쉬는 날(11/21)에 안 나오면 밤 마감이 결근?을 적어요
  g.setKst('2026-11-21 23:40');
  g.gs.checkMissing();
  assert.equal(mark(g, '김민우', '2026-11-21'), '결근?');
});

test('휴무 바꾸기: 휴무표에 휴무로 적힌 날도 바꿀 수 있고, 지난 쉬는 날은 출근 기록이 있어야 승인돼요', () => {
  const g = v3();
  g.setKst('2026-11-16 09:00');
  // 이지은: 수·일 휴무. 휴무표에 고른 휴무 11/20(금) → 11/25(수)는 원래 쉬는 날
  g.gs.setMark_('2026-11-20', '이지은', () => '휴무');
  req(g, '이지은', '5678', 'move', { dateFrom: '2026-11-20', date: '2026-11-19', reason: '병원 예약이 목요일', to: 'admin' });
  const id = plain(g.gs.adminToday('582941')).requests[0].id;
  g.gs.adminRequest('582941', id, true);
  assert.equal(mark(g, '이지은', '2026-11-20'), '', '휴무 표시를 지우면 원래 근무하는 날');
  assert.equal(mark(g, '이지은', '2026-11-19'), '휴무');
  assert.ok(g.gs.schedFor_(g.gs.findStaff_('이지은'), '2026-11-20'));
  assert.ok(!changeRows(g).some((r) => r[1] === '이지은'), '근무변경은 필요 없어요');
  // 지난 쉬는 날: 그날 출근을 안 찍었으면 승인 안 돼요
  req(g, '이지은', '5678', 'move', { dateFrom: '2026-11-18', date: '2026-11-24', reason: '수요일에 나올게요', to: 'admin' });
  const id2 = plain(g.gs.adminToday('582941')).requests[0].id;
  g.setKst('2026-11-19 10:00');
  assert.throws(() => g.gs.adminRequest('582941', id2, true), /이미 지났는데 그날 출근 기록이 없어요/);
  g.gs.adminRequest('582941', id2, false);
  // 점장은 승인 못 해요(관리자만)
  assert.throws(() => g.gs.adminRequest(MGR, id2, true), /관리자/);
});

test('공지: 올리면 대상 직원 화면 맨 위에 보이고, [확인했어요]를 누르면 누가 언제 읽었는지 남아요', () => {
  const g = v3({ email: 'owner@example.com' });
  tgOn(g, { 김민우: '9002', 최유나: '9006' });
  g.setKst('2026-11-16 09:00');
  assert.throws(() => g.gs.adminNotice('582941', '   ', []), /내용을 적어주세요/);
  const r = plain(g.gs.adminNotice('582941', '토요일은 재고 조사라\n30분 일찍 출근해 주세요.', ['왕십리']));
  assert.match(r.done, /공지를 올렸어요\(왕십리\)\. 텔레그램으로 1명에게 알렸어요/);
  assert.match(sentTo(g, 9002).at(-1), /새 공지 \(사장님\)\n토요일은 재고 조사라\n30분 일찍 출근해 주세요\.\n출퇴근 앱을 열고 \[확인했어요\]/);
  assert.equal(sentTo(g, 9006).length, 0, '가산 직원에게는 안 가요');
  const v = r.list[0];
  assert.deepEqual([v.to, v.by, v.total, v.read, v.unread.sort()], ['왕십리', '사장님', 2, [], ['김민우', '박점장']]);
  // 직원 화면
  const home = plain(g.gs.getHome('김민우', '0123'));
  assert.equal(home.notices.length, 1);
  assert.deepEqual([home.notices[0].text, home.notices[0].read], ['토요일은 재고 조사라\n30분 일찍 출근해 주세요.', false]);
  assert.equal(plain(g.gs.getHome('이지은', '5678')).notices.length, 0, '다른 매장 공지는 안 보여요');
  assert.equal(plain(g.gs.getHome('김민우', '')).notices, undefined, '비밀번호 없이는 안 보여요');
  // 읽음
  g.setKst('2026-11-16 10:05');
  assert.throws(() => g.gs.noticeRead('김민우', '9999', v.id), /틀렸어요/);
  assert.throws(() => g.gs.noticeRead('이지은', '5678', v.id), /찾을 수 없어요/);
  const after = plain(g.gs.noticeRead('김민우', '0123', v.id));
  assert.equal(after[0].read, true);
  g.gs.noticeRead('김민우', '0123', v.id); // 두 번 눌러도 한 번만
  assert.equal(sheetRows(g.sheet('공지'))[1][5], '김민우 11/16 10:05');
  const v2 = plain(g.gs.adminToday('582941')).notices[0];
  assert.deepEqual([v2.read, v2.unread], [['김민우 11/16 10:05'], ['박점장']]);
  // 전체 공지, 점장 공지(자기 매장만), 점장 화면에는 자기 매장 직원 것만
  g.gs.adminNotice('582941', '연말 회식 안내', []);
  assert.equal(plain(g.gs.getHome('이지은', '5678')).notices[0].text, '연말 회식 안내');
  assert.throws(() => g.gs.adminNotice(MGR, '다른 매장', ['가산']), /우리 매장에만/);
  const m = plain(g.gs.adminNotice(MGR, '왕십리 청소 당번 바뀌었어요', []));
  assert.equal(m.list[0].to, '왕십리', '점장은 자기 매장에만');
  assert.equal(m.list[0].by, '박점장 점장');
  const all = plain(g.gs.adminNotices(MGR)).list;
  assert.equal(all.find((x) => x.text === '연말 회식 안내').total, 2, '점장에게는 자기 매장 직원 수만');
  // 다시 알림: 안 읽은 사람 중 텔레그램을 켠 사람에게, 안 켠 사람은 이름으로
  const rem = plain(g.gs.adminNoticeRemind('582941', all.find((x) => x.text === '연말 회식 안내').id));
  assert.match(rem.done, /2명에게 텔레그램으로 다시 알렸어요\. 텔레그램을 안 켠 .*이지은.* 님에게는 직접 알려주세요/);
  // 내리기: 점장은 자기가 올린 것만, 내리면 직원 화면에서 사라져요
  assert.throws(() => g.gs.adminNoticeOff(MGR, v.id), /직접 올린 공지만/);
  g.gs.adminNoticeOff(MGR, m.list[0].id);
  g.gs.adminNoticeOff('582941', v.id);
  assert.deepEqual(plain(g.gs.getHome('김민우', '0123')).notices.map((x) => x.text), ['연말 회식 안내']);
  assert.throws(() => g.gs.noticeRead('김민우', '0123', v.id), /찾을 수 없어요/);
  // 60일이 지나면 화면에서 빠져요
  g.setKst('2027-01-20 09:00');
  assert.deepEqual(plain(g.gs.getHome('김민우', '0123')).notices, []);
});

test('공지: 이름을 바꾸면 읽음 기록도 따라가고, 시트를 손으로 고치면 바로 보여요', () => {
  const g = v3();
  g.setKst('2026-11-16 09:00');
  const id = plain(g.gs.adminNotice('582941', '공지 하나', [])).list[0].id;
  g.gs.noticeRead('이지은', '5678', id);
  g.gs.adminRename('582941', '이지은', '이지은B');
  const v = plain(g.gs.adminNotices('582941')).list[0];
  assert.ok(v.read.some((x) => /^이지은B /.test(x)), '새 이름으로 읽음');
  assert.ok(!v.unread.includes('이지은B'));
  // 시트에서 내용을 고치면(onEdit) 기억해 둔 것을 지워서 바로 보여요
  const sh = g.sheet('공지');
  sh.getRange(2, 5).setValue('고친 공지');
  g.gs.onEdit({ range: sh.getRange(2, 5) });
  g.gs.MEMO_ = {};
  assert.equal(plain(g.gs.getHome('김민우', '0123')).notices[0].text, '고친 공지');
});

test('검토 고침(입사): 퇴사자 폰을 물려받은 신입, 다시 입사 체크 칸, 월말 입사, 같은 이름 새 사람, 처음 보낸 시각, 손으로 고친 폰 칸', () => {
  const g = v3();
  g.setKst('2026-11-16 09:00');
  // 퇴사자(박퇴사) 폰을 물려받은 신입: 등록·승인·출근 모두 돼요
  g.gs.setStaffCell_(4, '등록폰', '#' + PHONE['박퇴사'] + ' 업무폰 · 03/01 등록');
  g.gs.joinSubmit(joinForm({ device: PHONE['박퇴사'] }));
  g.gs.adminJoin('582941', '한신입', true);
  g.gs.setSetting_('위치확인', '안함');
  assert.equal(g.gs.punch({ name: '한신입', pin: '4826', type: 'in', device: PHONE['박퇴사'], label: '업무폰', agree: true }).type, 'in');
  // 손으로 줄바꿈으로 적은 폰 2대: 셋째 폰은 [추가]가 안 돼요
  g.gs.setStaffCell_(2, '등록폰', '#' + PHONE['김민우'] + ' 아이폰 · 01/01\n#' + 'b2b2b2b2b2b2b2b2' + ' 업무폰 · 02/01');
  g.gs.setStaffCell_(2, '새폰요청', '#c3c3c3c3c3c3c3c3 새 폰 · 11/16 요청');
  assert.throws(() => g.gs.adminDevice('582941', '김민우', true, 'add'), /이미 폰이 2대/);
  assert.deepEqual(plain(g.gs.adminToday('582941')).pending.find((x) => x.name === '김민우').have, ['아이폰', '업무폰']);
});

test('검토 고침(입사): 다시 입사하면 서류 체크가 비고, 지난달 입사면 그달 휴무표에도 줄이 생겨요', () => {
  const g = v3({ hr: false });
  g.setKst('2026-11-16 09:00');
  const c = plain(g.gs.adminHrGet('582941', '최유나'));
  g.gs.adminHrSave('582941', '최유나', { start: c.start, phone: c.phone, addr: c.addr, bank: c.bank, account: c.account, holder: c.holder, emergency: c.emergency, memo: c.memo, docs: ['근로계약서'], offb: ['사직서'] });
  g.gs.adminRetire('582941', '최유나', '2026-11-10');
  g.gs.joinSubmit(joinForm({ name: '최유나', device: 'd4d4d4d4d4d4d4d4' }));
  g.gs.adminJoin('582941', '최유나', true);
  assert.deepEqual([hrRow(g, '최유나')['입사 서류'], hrRow(g, '최유나')['퇴사 정리']], ['', '']);
  // 11/30에 등록, 12/1에 승인: 11월 휴무표에도 줄이 생겨요
  g.setKst('2026-11-30 18:00');
  g.gs.joinSubmit(joinForm({ name: '말일신입', start: '2026-11-30', device: 'e5e5e5e5e5e5e5e5' }));
  g.setKst('2026-12-01 10:00');
  g.gs.adminJoin('582941', '말일신입', true);
  assert.ok(monthRowOf(g, '2026-11', '말일신입'), '11월 줄');
  assert.ok(monthRowOf(g, '2026-12', '말일신입'), '12월 줄');
});

test('검토 고침(입사): 고쳐서 다시 보내도 처음 보낸 시각으로 출근이 적혀요', () => {
  const g = v3();
  g.setKst('2026-11-16 09:50');
  g.gs.joinSubmit(joinForm());
  g.setKst('2026-11-16 10:30');
  g.gs.joinSubmit(joinForm({ addr: '서울 성동구 왕십리로 2' }));
  assert.match(hrRow(g, '한신입')['등록'], /^2026-11-16 09:50 본인 입력\(입사 등록\) · 2026-11-16 10:30 고쳐 보냄/);
  assert.equal(plain(g.gs.adminToday('582941')).joins[0].firstIn, '09:50');
  g.setKst('2026-11-16 10:40');
  g.gs.adminJoin('582941', '한신입', true, { firstIn: true });
  const row = sheetRows(g.sheet('출퇴근기록')).find((r) => r[2] === '한신입');
  assert.equal(row[5], '09:50');
});

test('검토 고침(입사): 예전 퇴사자 [직원] 줄을 지우고 같은 이름 새 사람을 넣어도 예전 인사 정보가 안 넘어가요', () => {
  const g = v3();
  g.setKst('2026-11-16 09:00');
  g.gs.hrSave('최유나', '1357', { rrn: '850505-1234567', phone: '010-7777-8888', addr: '서울 마포구 비밀로 9', bank: '신한', account: '110123456789', holder: '', emergency: '010-9999-8888', agree: true, device: '' });
  g.gs.adminRetire('582941', '최유나', '2026-11-10');
  // [직원]에서 최유나 줄을 지우고(이름 칸 비우기) 같은 이름 새 사람을 손으로 넣어요
  g.gs.setStaffCell_(6, '이름', '');
  g.gs.setStaffCell_(6, '재직', '');
  g.sheet('직원').getRange(8, 1, 1, 3).setValues([['최유나', '가산', '2222']]);
  g.gs.MEMO_ = {};
  g.gs.syncHr_();
  assert.equal(hrRow(g, '최유나')['상태'], '퇴사', '예전 인사 줄을 저절로 되살리지 않아요');
  assert.deepEqual(plain(g.gs.adminToday('582941')).ghosts, ['최유나']);
  const mine = plain(g.gs.hrGet('최유나', '2222', ''));
  assert.ok(!mine.account && !mine.addr, '새 사람에게 예전 계좌·주소가 안 보여요');
  // [직원]에 이름 줄이 하나뿐이라 같은 사람인지 몰라요: 사장님이 확인할 때까지 인사 정보 입력을 기다려요([인사]에 같은 이름 줄이 또 생기지 않게)
  assert.equal(plain(g.gs.getHome('최유나', '2222')).hr, false);
  assert.throws(() => g.gs.hrSave('최유나', '2222', joinForm({ name: '최유나', device: '' })), /사장님이 확인하는 중/);
  // 사장님이 같은 사람이라고 [인사] 상태를 '근무'로 바꾸면 다시 돼요
  const hs = g.sheet('인사');
  hs.getRange(g.gs.hrFind_('최유나').row, colOf(hs, '상태')).setValue('근무');
  g.gs.onEdit({ range: hs.getRange(g.gs.hrFind_('최유나').row, colOf(hs, '상태')) });
  g.gs.MEMO_ = {};
  assert.deepEqual(plain(g.gs.adminToday('582941')).ghosts, []);
});

test('검토 고침(근무자): 여러 날 신청은 지난 날 중 일한 날·첫 날의 쉬는 날을 건너뛰고, 취소된 휴무 날은 다시 신청돼요', () => {
  const g = v3({ email: 'owner@example.com' });
  g.setKst('2026-11-16 09:00');
  // 11/10 결근?, 11/11·12는 일함 → 11/10~11/12 월차를 보내면 11/10 하루만
  g.gs.setMark_('2026-11-10', '이지은', () => '결근?');
  req(g, '이지은', '5678', 'off', { date: '2026-11-10', dateTo: '2026-11-12', offType: '월차', reason: '몸살', to: 'admin' });
  assert.deepEqual(reqRows(g).filter((r) => r[2] === '이지은').map((r) => r[4]), ['2026-11-10']);
  // 첫 날이 쉬는 날(토)이면 그다음 근무일부터
  req(g, '김민우', '0123', 'off', { date: '2026-11-21', dateTo: '2026-11-24', offType: '휴가', reason: '여행', to: 'admin' });
  assert.deepEqual(reqRows(g).filter((r) => r[2] === '김민우').map((r) => r[4]), ['2026-11-23', '2026-11-24']);
  assert.throws(() => req(g, '김민우', '0123', 'off', { date: '2026-11-28', dateTo: '2026-11-29', offType: '휴가', reason: '여행' }), /신청할 근무일이 없어요/);
  // 휴무 승인 → 취소 승인 → 같은 날 다시 월차 신청이 돼요
  req(g, '최유나', '1357', 'off', { date: '2026-11-25', offType: '휴무', reason: '집안일', to: 'admin' });
  const id1 = plain(g.gs.adminToday('582941')).requests.find((q) => q.name === '최유나').id;
  g.gs.adminRequest('582941', id1, true);
  req(g, '최유나', '1357', 'cancel', { date: '2026-11-25', reason: '', to: 'admin' });
  const id2 = plain(g.gs.adminToday('582941')).requests.find((q) => q.name === '최유나').id;
  g.gs.adminRequest('582941', id2, true);
  assert.equal(mark(g, '최유나', '2026-11-25'), '');
  req(g, '최유나', '1357', 'off', { date: '2026-11-25', offType: '월차', reason: '다시', to: 'admin' });
});

test('검토 고침(근무자): 근무변경이 있는 날의 휴무 승인, 쉬는 요일의 휴무 취소, 퇴근 정정의 결근? 지우기', () => {
  const g = v3();
  g.setKst('2026-11-16 09:00');
  // 11/25에 근무변경(대타 등)이 있는 김민우가 그날 월차를 승인받으면 쉬는 날이 돼요
  g.gs.addChange_('2026-11-25', '김민우', '10:00-20:00', '대타');
  req(g, '김민우', '0123', 'off', { date: '2026-11-25', offType: '월차', reason: '병원', to: 'admin' });
  g.gs.adminRequest('582941', plain(g.gs.adminToday('582941')).requests[0].id, true);
  g.gs.MEMO_ = {};
  assert.equal(g.gs.schedFor_(g.gs.findStaff_('김민우'), '2026-11-25'), null);
  // 쉬는 요일(토)에 적힌 휴무를 취소하면 그날 근무(매장 시간)
  g.gs.setMark_('2026-11-21', '김민우', () => '휴무');
  req(g, '김민우', '0123', 'cancel', { date: '2026-11-21', reason: '', to: 'admin' });
  g.gs.adminRequest('582941', plain(g.gs.adminToday('582941')).requests[0].id, true);
  g.gs.MEMO_ = {};
  const s21 = g.gs.schedFor_(g.gs.findStaff_('김민우'), '2026-11-21');
  assert.deepEqual([s21.start, s21.end], [600, 1200]);
  // 결근?인 날 퇴근 정정이 승인되면 결근?이 지워져요
  g.gs.setMark_('2026-11-13', '이지은', () => '결근?');
  req(g, '이지은', '5678', 'fix', { date: '2026-11-13', type: 'out', time: '21:00', reason: '깜빡', to: 'admin' });
  g.gs.adminRequest('582941', plain(g.gs.adminToday('582941')).requests[0].id, true);
  assert.equal(mark(g, '이지은', '2026-11-13'), '');
});

test('검토 고침(근무자): 대타를 늦게 수락하면 그때부터 하루, 지각 사유 다시 적기, 묶음 처리 알림은 한 통', () => {
  const g = v3({ email: 'owner@example.com' });
  tgOn(g, { 김민우: '9002' });
  g.setKst('2026-11-16 10:00');
  req(g, '김민우', '0123', 'swap', { date: '2026-11-24', reason: '' }); // 왕십리는 박점장이 먼저 봐요
  assert.equal(reqRows(g).find((r) => r[2] === '김민우')[10], '점장');
  g.setKst('2026-11-19 10:00');
  g.gs.takeSwap('최유나', '1357', reqRows(g).find((r) => r[2] === '김민우')[0]);
  g.setKst('2026-11-19 10:10');
  g.gs.checkMissing();
  assert.equal(reqRows(g).find((r) => r[2] === '김민우')[10], '점장', '수락한 지 하루가 안 지나서 아직 점장 차례');
  g.setKst('2026-11-20 10:20');
  g.gs.checkMissing();
  assert.equal(reqRows(g).find((r) => r[2] === '김민우')[10], '관리자');
  g.gs.adminRequest('582941', reqRows(g).find((r) => r[2] === '김민우')[0], false);
  // 지각 사유: 쉼표·앞 메모가 있어도 옛 사유를 바꿔 적어요
  g.setKst('2026-11-23 10:15');
  punch(g, '김민우', '0123', 'in');
  g.gs.lateNote('김민우', '0123', '버스, 지하철 지연');
  g.gs.lateNote('김민우', '0123', '늦잠');
  const memo = sheetRows(g.sheet('출퇴근기록')).find((r) => r[0] === '2026-11-23' && r[2] === '김민우')[13];
  assert.equal((memo.match(/지각 사유/g) || []).length, 1);
  assert.match(memo, /지각 사유: 늦잠$/);
  // 묶음 승인: 직원에게 한 통
  req(g, '김민우', '0123', 'off', { date: '2026-12-01', dateTo: '2026-12-04', offType: '휴가', reason: '여행', to: 'admin' });
  const ids = plain(g.gs.adminToday('582941')).requests.filter((q) => q.name === '김민우').map((q) => q.id);
  assert.equal(ids.length, 4);
  const before = sentTo(g, 9002).length;
  const out = plain(g.gs.adminRequestMany('582941', ids, true));
  assert.equal(out.many.done, 4);
  assert.equal(sentTo(g, 9002).length, before + 1, '한 통');
  assert.match(sentTo(g, 9002).at(-1), /휴가 요청이 승인됐어요\n12\/01\(화\) ~ 12\/04\(금\) \(4일\)/);
});

test('검토 고침(지원 근무): 사장님이 적은 지원 매장은 남고 그 매장 시간 기준, 쉬는 날 지원은 지각 없음, 달 중간 이동 전 지원도 세요', () => {
  const g = v3();
  g.gs.setSetting_('위치확인', '안함');
  g.setKst('2026-11-17 12:20');
  // 김민우(왕십리) 11/17 칸에 사장님이 '가산'(12:00 시작)을 적어 둠 → 12:20 출근: 가산 기준 지각 20분, 칸은 '가산 12:20'
  g.gs.setMark_('2026-11-17', '김민우', () => '가산');
  const r = punch(g, '김민우', '0123', 'in');
  assert.equal(r.late, 20);
  assert.equal(mark(g, '김민우', '2026-11-17'), '가산 12:20');
  assert.equal(plain(g.gs.adminSupport('582941', '2026-11')).total, 1);
  // 쉬는 날(토) 가산으로 지원: 지각 없음
  g.gs.setSetting_('위치확인', '필수');
  g.gs.adminSetPlace('582941', '가산', GASAN.lat, GASAN.lng);
  g.setKst('2026-11-21 12:30');
  const r2 = punch(g, '김민우', '0123', 'in', { ...GASAN, acc: 10 });
  assert.equal(r2.late, 0);
  // 달 중간에 가산으로 옮겨도 옮기기 전의 가산 지원은 그대로 세요
  g.setKst('2026-11-25 09:00');
  g.gs.adminMove('582941', '김민우', '가산', '2026-11-25');
  const sup = plain(g.gs.adminSupport('582941', '2026-11'));
  assert.equal(sup.people.find((p) => p.name === '김민우').total, 2);
});

test('검토 고침(지원 근무): 띄어 쓴 매장 이름도 세고, 기록이 500줄 넘어도 예전 날짜를 찾아요, 월차 탭은 이번 달까지', () => {
  const g = v3();
  assert.equal(g.gs.supportOf_('가산 디지털 12:08', { '가산 디지털': '가산 디지털', 왕십리: '왕십리' }), '가산 디지털');
  // 출퇴근기록 600줄 뒤의 예전 날짜 찾기
  const sh = g.sheet('출퇴근기록');
  sh.getRange(2, 1, 1, 7).setValues([['2026-11-02', '월', '김민우', '10:00', '20:00', '', '09:58']]);
  const filler = [];
  for (let i = 0; i < 600; i++) filler.push(['2026-11-20', '금', '사람' + i, '10:00', '20:00', '', '10:00']);
  sh.getRange(3, 1, filler.length, 7).setValues(filler);
  g.setKst('2026-11-21 10:00');
  const f = g.gs.findLog_(sh, '2026-11-02', '김민우');
  assert.equal(f && f.row, 2);
  // '월차 YYYY' 탭: 다음 달 탭(미리 만든 것)의 부여·잔여는 '올해 받음'·'지금 잔여'에 안 넣어요
  g.gs.ensureMonth_('2026-12');
  const out = g.gs.exportLeave_('2026');
  assert.ok(out.people >= 1);
});

test('검토 고침(휴직·마감): 휴직 날 출근은 대체휴무로 안 쌓이고, 마감한 달은 자동 퇴사가 안 고치고, 장부의 사장님 칸이 남아요', () => {
  const g = v3({ email: 'owner@example.com' });
  tgOn(g);
  g.setKst('2026-11-16 09:00');
  g.gs.adminAway('582941', '이지은', '2026-11-16', '2026-11-30', '병가');
  g.setKst('2026-11-17 12:00');
  g.gs.setSetting_('위치확인', '안함');
  punch(g, '이지은', '5678', 'in');
  g.setKst('2026-11-17 21:00');
  punch(g, '이지은', '5678', 'out');
  g.setKst('2026-11-17 23:40');
  g.gs.checkMissing();
  assert.ok(!sheetRows(g.sheet('대체휴무')).some((r) => r[1] === '이지은'), '휴직 날 출근은 대체휴무로 안 쌓여요');
  assert.match(sentTo(g, 555).find((t) => /하루 마감/.test(t)) || '', /휴직 중인데 출근/);
  // 10월 마감 → [인사] 퇴사일을 10월 날짜로 손으로 적어도 10월 휴무표는 그대로
  g.setKst('2026-10-20 10:00');
  g.gs.ensureMonth_('2026-10');
  g.gs.setMark_('2026-10-25', '최유나', () => '결근?');
  g.setKst('2026-11-18 10:00');
  g.gs.adminMonthClose('582941', '2026-10', true);
  // 장부 오른쪽에 사장님 칸
  const book = g.sheet('월 마감 2026');
  const w = book.getLastColumn();
  book.getRange(1, w + 1).setValue('확인(사장님)');
  book.getRange(2, w + 1).setValue('본인 확인함');
  const firstName = book.rowDisplay(2)[2];
  const hs = g.sheet('인사');
  hs.getRange(g.gs.hrFind_('최유나').row, colOf(hs, '퇴사일')).setValue('2026-10-20');
  g.gs.MEMO_ = {};
  g.setKst('2026-11-19 05:10');
  g.gs.checkMissing();
  assert.equal(g.gs.findStaff_('최유나').active, false);
  assert.equal(mark(g, '최유나', '2026-10-25'), '결근?', '마감한 10월은 그대로');
  // 다시 열고 다시 마감해도 사장님 칸이 그 줄과 같이 남아요
  g.gs.adminMonthOpen('582941', '2026-10');
  g.gs.adminMonthClose('582941', '2026-10', true);
  const rows = sheetRows(g.sheet('월 마감 2026'));
  assert.equal(rows[0][w], '확인(사장님)');
  assert.ok(rows.every((r, i) => i === 0 || r[w] === '' || r[2] === firstName), '사장님 칸 메모가 다른 줄로 밀리지 않아요');
});

test('검토 고침(10분 검사): 퇴사자 줄을 지우고 신입을 넣어도 기록이 안 넘어가고, 다시 온 사람을 자동 퇴사하지 않고, 이상한 탭은 건드리지 않아요', () => {
  const g = v3({ email: 'owner@example.com' });
  tgOn(g);
  g.setKst('2026-11-16 10:00');
  g.gs.setSetting_('위치확인', '안함');
  punch(g, '최유나', '1357', 'in');
  g.gs.adminRetire('582941', '최유나', '2026-11-16');
  g.setKst('2026-11-17 06:00');
  g.gs.checkMissing();
  // [직원]에서 최유나 줄을 지우고(이름 비움) 같은 매장에 신입을 적어요 → 이름 바꿈으로 보지 않아요
  g.gs.setStaffCell_(6, '이름', '');
  g.gs.setStaffCell_(6, '재직', '');
  g.sheet('직원').getRange(9, 1, 1, 3).setValues([['나신입', '가산', '4444']]);
  g.gs.MEMO_ = {};
  g.gs.syncHr_();
  g.gs.checkMissing();
  assert.ok(hrRow(g, '최유나'), '퇴사자 인사 줄은 그대로');
  assert.ok(sheetRows(g.sheet('출퇴근기록')).some((r) => r[2] === '최유나'), '퇴사자 기록도 그대로');
  // 다시 온 같은 이름을 새 줄로 넣어도 예전 퇴사일로 자동 퇴사하지 않아요(사장님 확인)
  g.sheet('직원').getRange(10, 1, 1, 3).setValues([['최유나', '가산', '5555']]);
  g.gs.MEMO_ = {};
  g.setKst('2026-11-17 12:10');
  g.gs.checkMissing();
  assert.equal(g.gs.findStaff_('최유나').active, true);
  // 이번 달 탭 1행 위에 제목 줄을 끼우면 건드리지 않고 하루 한 번 알려요
  const tab = g.sheet('휴무표 2026-11');
  const before = tab.getLastColumn();
  tab.insertRowsAfter(0, 1); // 맨 위에 줄 하나 끼우기
  tab.getRange(1, 1).setValue('11월 휴무표');
  g.gs.GRID_ = {};
  g.gs.MEMO_ = {};
  g.setKst('2026-11-17 12:20');
  g.gs.checkMissing();
  assert.equal(tab.getLastColumn(), before, '칸을 끼워 넣지 않아요');
  assert.match(sentTo(g, 555).at(-1), /휴무표 탭을 확인해주세요\n[^\n]*\n휴무표 2026-11 탭 1행에 머리글/);
  const n = sentTo(g, 555).length;
  g.setKst('2026-11-17 12:30');
  g.gs.checkMissing();
  assert.equal(sentTo(g, 555).filter((t) => /휴무표 탭을 확인해주세요/.test(t)).length, 1, '하루 한 번');
  assert.ok(sentTo(g, 555).length >= n);
});

test('검토 고침(10분 검사): 연도 없는 퇴사일, 이름 바꾼 사이 찍은 줄 합치기, 이동 예약한 지점이 없어지면 알림', () => {
  const g = v3({ email: 'owner@example.com' });
  tgOn(g);
  // 1월 초에 '12/31'을 적으면 작년 12/31
  g.setKst('2027-01-04 10:00');
  assert.equal(g.gs.hrTidy_({ end: '12/31' }).end, '2026-12-31');
  g.setKst('2026-11-16 10:00');
  assert.equal(g.gs.hrTidy_({ end: '11/30' }).end, '2026-11-30');
  // 이름을 고친 뒤 맞추기 전에 새 이름 줄이 생겼어도 합쳐요
  g.gs.setMark_('2026-11-02', '김민우', () => '월차');
  const st = g.sheet('직원');
  st.getRange(ROW.김민우, 1).setValue('김민우B');
  g.gs.onEdit({ range: st.getRange(ROW.김민우, 1), oldValue: '김민우' });
  g.gs.MEMO_ = {};
  g.gs.GRID_ = {};
  g.gs.setMark_('2026-11-16', '김민우B', () => '10:05'); // 새 이름으로 줄이 생김
  g.gs.checkMissing();
  g.gs.GRID_ = {};
  assert.ok(!monthRowOf(g, '2026-11', '김민우'));
  assert.deepEqual([mark(g, '김민우B', '2026-11-02'), mark(g, '김민우B', '2026-11-16')], ['월차', '10:05']);
  // 이동 예약한 지점 이름이 [매장]에서 바뀌면 예약은 남기고 알려요
  g.gs.adminMove('582941', '이지은', '왕십리', '2026-11-20');
  g.sheet('매장').getRange(2, 1).setValue('왕십리역');
  g.gs.MEMO_ = {};
  g.setKst('2026-11-20 05:10');
  g.gs.checkMissing();
  assert.equal(g.gs.findStaff_('이지은').store, '가산');
  assert.ok(plain(g.gs.adminHrGet('582941', '이지은')).moveDue, '예약은 남아요');
  assert.ok(sentTo(g, 555).some((t) => /지점 이동 예약을 못 했어요/.test(t)));
});

test('월차 부여는 사장님이 정해요: 자동(전달 만근이면 1개)·0~3개, 칸 메모에 남고, 마감한 달·점장은 못 바꿔요', () => {
  const g = v3();
  g.setKst('2026-11-20 10:00');
  g.gs.ensureMonth_('2026-12');
  // 처음에는 자동(수식)
  const L0 = plain(g.gs.adminLeave('582941', '2026-12'));
  const k0 = L0.rows.find((x) => x.name === '김민우');
  assert.equal(k0.grantAuto, true);
  assert.equal(L0.admin, true);
  // 11월에 휴직이 있어 만근이 아니어도 12월 월차 1개를 줘요
  g.sheet('휴무표 2026-11').getRange(monthRowOf(g, '2026-11', '김민우').r, 10).setValue('아님: 휴직 12일'); // 시트가 계산한 값처럼
  const L1 = plain(g.gs.adminSetGrant('582941', '2026-12', '김민우', 1));
  const k1 = L1.rows.find((x) => x.name === '김민우');
  assert.deepEqual([k1.grant, k1.grantAuto, k1.prevFull], [1, false, '아님: 휴직 12일']);
  const dec = g.sheet('휴무표 2026-12');
  const r = monthRowOf(g, '2026-12', '김민우').r;
  assert.match(dec.notes[r + ',7'], /사장님이 정함: 1개/);
  // 다음 달 탭을 다시 이어도(setup 등) 사장님이 정한 숫자는 그대로
  g.gs.relinkMonth_('2026-12');
  assert.equal(dec.cells.get(r + ',7'), 1);
  // 자동으로 되돌리기
  const L2 = plain(g.gs.adminSetGrant('582941', '2026-12', '김민우', 'auto'));
  assert.equal(L2.rows.find((x) => x.name === '김민우').grantAuto, true);
  assert.match(String(dec.cells.get(r + ',7')), /^=IF\(LEFT\(IFERROR\(INDEX\('휴무표 2026-11'/);
  assert.equal(dec.notes[r + ',7'] || '', '');
  // 반 개 단위, 잘못된 값, 점장, 마감한 달
  g.gs.adminSetGrant('582941', '2026-12', '이지은', 0.5);
  assert.throws(() => g.gs.adminSetGrant('582941', '2026-12', '이지은', 4), /0~3개/);
  assert.throws(() => g.gs.adminSetGrant('582941', '2026-12', '없는사람', 1), /줄이 없어요/);
  assert.throws(() => g.gs.adminSetGrant(MGR, '2026-12', '김민우', 1), /관리자/);
  g.gs.ensureMonth_('2026-10');
  g.gs.adminMonthClose('582941', '2026-10', true);
  assert.throws(() => g.gs.adminSetGrant('582941', '2026-10', '김민우', 1), /마감한 달/);
  assert.equal(plain(g.gs.adminLeave('582941', '2026-10')).closed, true);
});

test('마지막 확인 고침(휴무 바꾸기): 대체휴무 두 번 받기·받은 휴무 바꾸기·바꾼 날 취소·일한 날 승인·옮긴 뒤 시간', () => {
  const g = v3({ email: 'owner@example.com' });
  g.gs.setSetting_('위치확인', '안함');
  g.setKst('2026-11-16 09:00');
  // 승인 전에 원래 쉬는 날(토)에 나와도 대체휴무로 안 쌓이고, 나중에 승인돼도 하루를 두 번 받지 않아요
  req(g, '김민우', '0123', 'move', { dateFrom: '2026-11-21', date: '2026-11-24', reason: '모임', to: 'admin' });
  g.setKst('2026-11-21 10:00');
  punch(g, '김민우', '0123', 'in');
  g.setKst('2026-11-21 20:00');
  punch(g, '김민우', '0123', 'out');
  g.setKst('2026-11-21 23:40');
  g.gs.checkMissing();
  assert.equal(g.gs.subBalance_('김민우').left, 0, '기다리는 바꾸기로 나온 날은 안 쌓여요');
  g.setKst('2026-11-22 10:00');
  g.gs.adminRequest('582941', reqRows(g).find((r) => r[3] === '바꾸기')[0], true);
  assert.equal(mark(g, '김민우', '2026-11-24'), '쉼');
  // 바꾼 날(11/24)은 '휴무 취소'로 못 되돌려요
  assert.throws(() => req(g, '김민우', '0123', 'cancel', { date: '2026-11-24', reason: '' }), /휴무 바꾸기로 받은 휴무예요/);
  // 대타·휴무 요청으로 받은 날은 원래 쉬는 날로 못 골라요
  req(g, '이지은', '5678', 'off', { date: '2026-11-27', offType: '휴무', reason: '병원', to: 'admin' });
  g.gs.adminRequest('582941', reqRows(g).find((r) => r[2] === '이지은' && r[3] === '휴무')[0], true);
  assert.throws(() => req(g, '이지은', '5678', 'move', { dateFrom: '2026-11-27', date: '2026-11-30', reason: 'x' }), /휴무 요청으로 받은 휴무라서/);
  // 대신 쉴 날이 지났는데 그날 일했으면 승인이 막혀요
  g.gs.setStaffCell_(ROW.최유나, '토', '휴무'); // 최유나는 토요일에 쉬어요
  g.gs.MEMO_ = {};
  req(g, '최유나', '1357', 'move', { dateFrom: '2026-11-28', date: '2026-11-23', reason: 'x', to: 'admin' });
  g.setKst('2026-11-23 12:00');
  punch(g, '최유나', '1357', 'in');
  g.setKst('2026-11-24 10:00');
  assert.throws(() => g.gs.adminRequest('582941', reqRows(g).find((r) => r[2] === '최유나' && r[3] === '바꾸기')[0], true), /대신 쉴 날\)에 이미 출근했어요/);
});

test('마지막 확인 고침(휴무 바꾸기): 요청 뒤 지점을 옮기면 지금 지점 시간으로 출근이 잡혀요', () => {
  const g = v3();
  g.setKst('2026-11-16 09:00');
  req(g, '김민우', '0123', 'move', { dateFrom: '2026-11-21', date: '2026-11-24', reason: '모임', to: 'admin' });
  g.setKst('2026-11-18 10:00');
  g.gs.adminMove('582941', '김민우', '가산', '2026-11-18');
  g.setKst('2026-11-19 10:00');
  g.gs.adminRequest('582941', reqRows(g).find((r) => r[3] === '바꾸기')[0], true);
  const s21 = g.gs.schedFor_(g.gs.findStaff_('김민우'), '2026-11-21');
  assert.deepEqual([s21.start, s21.end], [720, 1260], '가산 12:00-21:00');
});

test('마지막 확인 고침: 안 읽은 공지는 다 보이고, 퇴사자 줄 이름 덮어쓰기는 이름 바꿈이 아니고, 따로 정한 시간으로 휴무 취소', () => {
  const g = v3();
  g.setKst('2026-11-16 09:00');
  const first = plain(g.gs.adminNotice('582941', '중요한 첫 공지', [])).list[0].id;
  for (let i = 0; i < 11; i++) g.gs.adminNotice('582941', '공지 ' + i, []);
  const ns = plain(g.gs.getHome('김민우', '0123')).notices;
  assert.equal(ns.length, 12, '안 읽은 건 다');
  assert.ok(ns.some((x) => x.id === first));
  // 퇴사자 [직원] 줄 이름 칸을 새 사람 이름으로 덮어써도 퇴사자 기록은 그대로
  g.gs.adminRetire('582941', '최유나', '2026-11-10');
  const st = g.sheet('직원');
  st.getRange(ROW.최유나, 1).setValue('나신입');
  g.gs.onEdit({ range: st.getRange(ROW.최유나, 1), oldValue: '최유나' });
  assert.ok(hrRow(g, '최유나'), '퇴사자 인사 줄 이름은 그대로');
  // [근무변경]으로 12:00-21:00을 정한 날에 월차 → 취소하면 12:00-21:00으로
  g.gs.addChange_('2026-11-25', '김민우', '12:00-21:00', '사장님이 정함');
  req(g, '김민우', '0123', 'off', { date: '2026-11-25', offType: '월차', reason: '병원', to: 'admin' });
  g.gs.adminRequest('582941', reqRows(g).find((r) => r[2] === '김민우' && r[3] === '월차')[0], true);
  req(g, '김민우', '0123', 'cancel', { date: '2026-11-25', reason: '', to: 'admin' });
  g.gs.adminRequest('582941', reqRows(g).find((r) => r[2] === '김민우' && r[3] === '취소')[0], true);
  g.gs.MEMO_ = {};
  const s25 = g.gs.schedFor_(g.gs.findStaff_('김민우'), '2026-11-25');
  assert.deepEqual([s25.start, s25.end], [720, 1260]);
});

test('마지막 확인 고침: 점장 묶음 올리기는 끝난 날을 건너뛰고, 대신 찍기도 적어 둔 지원 매장 기준, 위치가 소속 매장이면 적어 둔 매장은 지워요', () => {
  const g = v3({ email: 'owner@example.com' });
  tgOn(g);
  g.setKst('2026-11-16 09:00');
  req(g, '김민우', '0123', 'off', { date: '2026-11-24', dateTo: '2026-11-26', offType: '휴가', reason: '여행' });
  const ids = reqRows(g).filter((r) => r[2] === '김민우').map((r) => r[0]);
  g.gs.cancelRequest('김민우', '0123', ids[1]);
  const before = sentTo(g, 555).length;
  g.gs.mgrForward(MGR, ids, '확인');
  const rows = reqRows(g).filter((r) => r[2] === '김민우');
  assert.deepEqual(rows.map((r) => [r[7], r[10]]), [['대기', '관리자'], ['취소', '점장'], ['대기', '관리자']]);
  assert.equal(sentTo(g, 555).length, before + 1, '사장님께 한 통');
  // 대신 찍기: 휴무표에 '가산'이 적힌 날은 가산(12:00) 기준
  g.gs.setMark_('2026-11-17', '김민우', () => '가산');
  g.setKst('2026-11-17 12:05');
  const out = plain(g.gs.proxyPunch('582941', '김민우', 'in', '폰 방전'));
  assert.equal(out.proxy.late, 5);
  assert.equal(mark(g, '김민우', '2026-11-17'), '가산 12:05');
  // 위치가 소속 매장(왕십리)으로 잡히면(가산은 반경 밖) 적어 둔 가산은 지워요
  g.gs.adminSetPlace('582941', '가산', GASAN.lat, GASAN.lng);
  g.gs.setMark_('2026-11-18', '김민우', () => '가산');
  g.setKst('2026-11-18 10:15');
  punch(g, '김민우', '0123', 'in');
  assert.equal(mark(g, '김민우', '2026-11-18'), '10:15');
});

test('마지막 확인 고침: 장부 숫자는 숫자로, 12월에 적은 연도 없는 퇴사일은 내년, 날짜 없는 예전 이동이 있어도 지난달 지원은 그 달 매장 기준', () => {
  const g = v3();
  g.setKst('2026-10-05 10:00');
  g.gs.ensureMonth_('2026-10');
  g.setKst('2026-11-18 10:00');
  g.gs.adminMonthClose('582941', '2026-10', true);
  const book = g.sheet('월 마감 2026');
  const head = book.rowDisplay(1);
  const r2 = 2;
  assert.equal(typeof book.cells.get(r2 + ',' + (head.indexOf('휴무') + 1)), 'number');
  assert.equal(book.fmt(r2, head.indexOf('이름') + 1), '@');
  g.setKst('2026-12-20 10:00');
  assert.equal(g.gs.hrTidy_({ end: '1/5' }).end, '2027-01-05');
  // 지난달(10월) 탭 김민우 줄 매장은 왕십리, 이동 기록에는 날짜 없는 예전 이동과 11월 이동이 있어요
  g.setKst('2026-11-20 10:00');
  g.gs.setMark_('2026-10-07', '김민우', () => '가산');
  const h = g.gs.hrFind_('김민우');
  g.gs.hrWrite_(h.row, { moves: '2026-03 가산→왕십리 · 2026-11-25 왕십리→가산' });
  g.gs.MEMO_ = {};
  const sup = plain(g.gs.adminSupport('582941', '2026-10'));
  assert.equal(sup.total, 1, '10월 왕십리 소속으로 가산 지원 1번');
});

test('안티 검사 고침(보안): 동료 근무표는 쉬는 종류를 가리고, 비밀번호 없이 남의 출근 시각을 못 보고, 주소만 알아도 setup·10분 실행은 못 불러요', () => {
  const g = v3({ email: 'owner@example.com' });
  g.gs.setSetting_('위치확인', '안함');
  g.setKst('2026-11-16 09:00');
  ['무단', '병가', '출산휴가', '휴직', '월차', '반차', '휴무?'].forEach((m, i) => g.gs.setMark_('2026-11-' + (20 + i), '박점장', () => m));
  const park = plain(g.gs.getSchedule('김민우', '0123', '2026-11')).others.find((o) => o.name === '박점장');
  assert.deepEqual(park.days.slice(19, 26), ['', '쉼', '쉼', '쉼', '쉼', '반차', '휴무?'], '무단은 안 보이고, 병가·출산휴가·휴직·월차는 쉼으로');
  // 비밀번호 없이 남의 출근 시각을 볼 수 없어요
  g.setKst('2026-11-16 10:04');
  punch(g, '김민우', '0123', 'in');
  assert.deepEqual([g.gs.getToday('김민우').tIn, g.gs.getToday('김민우').sIn], ['', '10:00']);
  assert.equal(plain(g.gs.getHome('김민우', '')).today.tIn, '');
  assert.equal(plain(g.gs.getHome('김민우', '9999')).today.tIn, '', '틀린 비밀번호도');
  assert.equal(plain(g.gs.getHome('김민우', '0123')).today.tIn, '10:04');
  assert.equal(g.gs.getToday('김민우', '0123').tIn, '10:04');
  // 웹 앱을 연 다른 사람(실행한 사람 메일이 빈칸)은 setup·checkMissing을 못 불러요
  g.setActiveUser('');
  assert.throws(() => g.gs.setup(), /시트 메뉴/);
  const before = g.sheet('출퇴근기록').getLastRow();
  g.setKst('2026-11-16 23:40');
  g.gs.checkMissing();
  assert.equal(PropertiesServiceGet(g, 'close:2026-11-16'), null, '아무것도 안 해요');
  // 진짜 10분 트리거(이 프로젝트의 트리거 번호)면 돌아요
  const trig = g.triggers.find((t) => t.getHandlerFunction() === 'checkMissing');
  g.gs.checkMissing({ triggerUid: trig.getUniqueId() });
  assert.equal(PropertiesServiceGet(g, 'close:2026-11-16'), '1');
  g.gs.checkMissing({ triggerUid: 'fake' }); // 가짜 번호는 무시
  g.setActiveUser('owner@example.com');
  assert.equal(g.sheet('출퇴근기록').getLastRow() >= before, true);
  // 주민번호 전체 보기는 [의심기록]에 남아요
  g.gs.hrSave('김민우', '0123', joinForm({ rrn: '900202-1357924', device: PHONE.김민우 }));
  g.gs.adminHrRrn('582941', '김민우');
  assert.ok(sheetRows(g.sheet('의심기록')).some((r) => r[2] === '주민번호 전체 보기' && r[3] === '김민우'));
});

test('안티 검사 고침(잠금): 남이 내 이름으로 일부러 틀려도 등록된 내 폰으로는 찍히고, 사장님·점장 화면도 폰마다 잠겨요', () => {
  const g = v3({ email: 'owner@example.com' });
  g.gs.setSetting_('위치확인', '안함');
  g.setKst('2026-11-16 09:55');
  punch(g, '김민우', '0123', 'in'); // 김민우 폰 등록
  g.setKst('2026-11-17 09:30');
  // 남(다른 폰)이 김민우 이름으로 5번 틀림
  for (let i = 0; i < 5; i++) assert.throws(() => g.gs.punch({ name: '김민우', pin: '1111', type: 'in', device: 'zzzzzzzzzzzzzzzz', label: 'x', agree: true }), /틀렸어요/);
  assert.throws(() => g.gs.punch({ name: '김민우', pin: '1111', type: 'in', device: 'zzzzzzzzzzzzzzzz', label: 'x', agree: true }), /잠겼어요/);
  g.setKst('2026-11-17 09:58');
  assert.equal(punch(g, '김민우', '0123', 'in').time, '09:58', '내 폰으로는 찍혀요');
  // 사장님 화면: 다른 폰에서 5번 틀려도 사장님 폰은 들어가요
  for (let i = 0; i < 5; i++) assert.throws(() => g.gs.adminToday({ pin: '000001', dev: 'aaaaaaaaaaaaaaaa' }), /틀렸어요/);
  assert.throws(() => g.gs.adminToday({ pin: '582941', dev: 'aaaaaaaaaaaaaaaa' }), /잠겼어요/);
  assert.equal(plain(g.gs.adminToday({ pin: '582941', dev: 'bbbbbbbbbbbbbbbb' })).role, 'admin');
  // 여러 폰으로 30번 넘게 맞혀 보면 모두 잠깐 막히고 사장님께 알림
  tgOn(g);
  for (let i = 0; i < 30; i++) { try { g.gs.adminToday({ pin: '000002', dev: 'c' + String(i).padStart(15, '0') }); } catch (e) { /* 틀림 */ } }
  assert.throws(() => g.gs.adminToday({ pin: '582941', dev: 'bbbbbbbbbbbbbbbb' }), /틀린 기록이 많아서/);
  assert.ok(sentTo(g, 555).some((t) => /사장님 화면 비밀번호가 여러 번 틀렸어요/.test(t)));
  // 점장은 6자리 비밀번호가 있어야 들어와요
  g.cache.clear(); // 10분이 지났다고 치고
  g.gs.adminSetPin({ pin: '582941', dev: 'bbbbbbbbbbbbbbbb' }, '박점장', '2468');
  assert.throws(() => g.gs.adminToday({ name: '박점장', pin: '2468' }), /점장 화면은 비밀번호 6자리가 필요해요/);
});

test('안티 검사 고침(사장님 쪽): 일찍 보낸 날은 조퇴가 아니고, 지난달을 마감 안 했으면 [월별]에서 알리고, 입사 때 위치 동의는 따로 받아요', () => {
  const g = v3({ email: 'owner@example.com' });
  g.setKst('2026-10-05 10:00');
  g.gs.setup(); // 10월 휴무표 탭
  const logOf = (date, name) => {
    const sh = g.sheet('출퇴근기록');
    for (let i = 2; i <= sh.getLastRow(); i++) { const r = sh.rowDisplay(i); if (r[0] === date && r[2] === name) return r; }
    return null;
  };
  // 위치 미등록 매장(가산)은 밤 요약에 알려요(그 매장 직원은 어디서든 찍혀요)
  g.setKst('2026-11-16 09:00');
  assert.match(g.gs.adminClosePreview('582941', 'today', false).text, /위치를 등록하지 않은 매장: 가산 → 그 매장 직원은 어디서든 출근이 찍혀요/);
  g.gs.setSetting_('위치확인', '안함');
  assert.doesNotMatch(g.gs.adminClosePreview('582941', 'today', false).text, /위치를 등록하지 않은 매장/, '위치 확인을 안 쓰면 안 알려요');
  // 1) 일찍 보냄: 근무 중에 누르면 예정 퇴근이 지금 시각이 돼서, 그 뒤에 퇴근을 찍어도 조퇴가 아니에요
  g.setKst('2026-11-16 09:58');
  punch(g, '김민우', '0123', 'in');
  g.setKst('2026-11-16 16:00');
  assert.throws(() => g.gs.adminEarlyOk(MGR, '김민우'), /관리자/);
  assert.equal(plain(g.gs.adminEarlyOk('582941', '김민우')).early.time, '16:00');
  g.setKst('2026-11-16 16:04');
  punch(g, '김민우', '0123', 'out');
  let r = logOf('2026-11-16', '김민우');
  assert.deepEqual([r[4], r[8], r[10]], ['16:00', '', ''], '예정 퇴근이 16:00이라 조퇴·차감 없음');
  assert.match(r[13], /사장님이 일찍 보냄\(조퇴 아님, 16:00\)/);
  // 이미 퇴근을 찍었으면 예정 퇴근을 실제 퇴근 시각으로 바꿔요
  g.setKst('2026-11-17 09:57');
  punch(g, '김민우', '0123', 'in');
  g.setKst('2026-11-17 15:30');
  punch(g, '김민우', '0123', 'out');
  assert.ok(Number(logOf('2026-11-17', '김민우')[8]) > 0, '그대로면 조퇴로 적혀요');
  g.gs.adminEarlyOk('582941', '김민우');
  r = logOf('2026-11-17', '김민우');
  assert.deepEqual([r[4], r[8], r[10]], ['15:30', '', '']);
  assert.throws(() => g.gs.adminEarlyOk('582941', '최유나'), /오늘 출근 기록이 없어요/);
  // 2) 지난달(10월)을 마감 안 했으면 이번 달 [월별]에 알려요. 마감하면 사라져요
  let is = plain(g.gs.adminIssues('582941', ''));
  assert.equal(is.prevOpen.ym, '2026-10');
  assert.equal(plain(g.gs.adminIssues('582941', '2026-10')).prevOpen, null, '지난달을 볼 때는 안 띄워요');
  assert.equal(plain(g.gs.adminIssues(MGR, '')).prevOpen, null, '점장 화면에는 없어요');
  g.gs.adminMonthClose('582941', '2026-10', true);
  assert.equal(plain(g.gs.adminIssues('582941', '')).prevOpen, null);
  // 3) 정산 시트: 차감은 참고액이라고 머리글과 옆 칸에 적어요
  g.gs.adminExport('582941', '2026-11');
  const ex = g.sheet('정산 2026-11');
  assert.equal(ex.rowDisplay(1)[7], '차감 참고액(확인 필요)');
  assert.match(ex.rowDisplay(1)[11], /참고 숫자예요.*급여에 반영하기 전에 꼭 확인하세요/);
  // 4) 입사 등록: 출퇴근 확인(위치) 동의를 따로 안 했으면 승인 뒤 첫 출근 때 다시 물어요
  g.setKst('2026-11-17 16:00');
  g.gs.joinSubmit(joinForm({ agreeLoc: false, start: '2026-11-17' }));
  g.gs.adminJoin('582941', '한신입', true);
  assert.equal(g.gs.findStaff_('한신입').agreed, false);
  assert.throws(() => g.gs.punch({ name: '한신입', pin: '4826', type: 'in', device: NEWPHONE, label: 'x' }), /동의가 필요해요/);
  g.gs.punch({ name: '한신입', pin: '4826', type: 'in', device: NEWPHONE, label: 'x', agree: true });
  assert.equal(g.gs.findStaff_('한신입').agreed, true);
});

test('안티 검사 고침(시트): 시간은 10.30·1030도 읽고, [근무변경] 날짜를 맞추고, 자동 작업이 실패하면 알리고, 지운 지난달 탭·내년 공휴일을 알려요', () => {
  const { gs } = createGas({ now: Date.parse('2026-11-21T09:00:00+09:00') });
  assert.equal(gs.parseTime_('10.30'), 630);
  assert.equal(gs.parseTime_('10.3'), 630, '숫자 칸에 10.30을 적으면 10.3으로 보여요');
  assert.equal(gs.parseTime_('19.05'), 19 * 60 + 5);
  assert.equal(gs.parseTime_('1030'), 630);
  assert.equal(gs.parseTime_('930'), 570);
  assert.equal(gs.parseTime_(0.4166666667), 600, '하루의 몇 분의 몇');
  assert.equal(gs.parseTime_('0.4166666667'), 600);
  assert.equal(gs.parseTime_('10:05'), 605);
  assert.equal(gs.parseTime_('오후 6:30:00'), 18 * 60 + 30);
  assert.equal(gs.parseTime_('10시 30분'), 630);
  assert.equal(gs.parseTime_('2575'), null);
  assert.deepEqual({ ...gs.parseSchedule_('10.30-19.30') }, { start: 630, end: 1170 });
  assert.equal(gs.mdGuess_('11/20'), '2026-11-20');
  assert.equal(gs.mdGuess_('1월 5일'), '2027-01-05', '연말에 적은 1월은 내년');
  assert.equal(gs.mdGuess_('11/20/2026'), '2026-11-20');
  assert.equal(gs.mdGuess_('다음주'), '');

  const g = v3();
  tgOn(g);
  const all = () => sentTo(g, 555).join('\n');
  // [근무변경]: '11/20'처럼 적으면 날짜로 맞추고, 못 읽으면 칸 메모
  g.setKst('2026-11-16 09:00');
  const ch = g.sheet('근무변경');
  ch.getRange(2, 1, 2, 3).setValues([['11/20', '김민우', '14:00-20:00'], ['다음주', '이지은', '12:00-18:00']]);
  g.gs.onEdit({ range: ch.getRange(2, 1, 2, 1) });
  assert.equal(ch.rowDisplay(2)[0], '2026-11-20');
  assert.equal(ch.rowDisplay(3)[0], '다음주');
  assert.match(ch.notes['3,1'], /날짜를 못 읽었어요/);
  assert.equal(g.gs.schedFor_(g.gs.findStaff_('김민우'), '2026-11-20').start, 14 * 60, '맞춘 날짜는 바로 쓰여요');
  ch.getRange(3, 1).setValue('2026-11-21');
  g.gs.onEdit({ range: ch.getRange(3, 1) });
  assert.equal(ch.notes['3,1'], '', '고치면 메모를 지워요');
  // 10분 자동 실행: 한 단계가 실패하면 사장님께 하루 한 번 알려요
  g.gs.awayFill_ = () => { throw new Error('시험 오류'); };
  g.setKst('2026-11-16 09:10');
  g.gs.checkMissing();
  assert.match(all(), /자동 작업을 못 했어요[\s\S]*\[휴직 칸 채우기\] 시험 오류/);
  const n1 = sentTo(g, 555).length;
  g.setKst('2026-11-16 09:20');
  g.gs.checkMissing();
  assert.equal(sentTo(g, 555).length, n1, '같은 날은 한 번만');
  // 지난달 탭을 지우면(수식이 #REF!) 알리고, 다시 생기면 수식을 다시 이어요
  const mt = g.sheet('휴무표 2026-11');
  mt.getRange(3, 6).setFormula('=IFERROR(VLOOKUP($C3,#REF!,6,FALSE),0)');
  let msgs = g.gs.monthLinkCheck_(g.gs.settings_(), g.gs.nowKst_());
  assert.match(msgs.join('\n'), /\[휴무표 2026-10\] 탭을 지워서 \[휴무표 2026-11\] 탭의 이월·부여가 0으로 나와요/);
  g.book.insertSheet('휴무표 2026-10'); // 사장님이 같은 이름 탭을 다시 만들었어요(앱이 만들면 그때 바로 이어요)
  g.gs.GRID_ = {};
  msgs = g.gs.monthLinkCheck_(g.gs.settings_(), g.gs.nowKst_());
  assert.match(msgs.join('\n'), /다시 이었어요/);
  assert.match(mt.getRange(3, 6).getFormulas()[0][0], /'휴무표 2026-10'!\$C:\$H/);
  assert.deepEqual(plain(g.gs.monthLinkCheck_(g.gs.settings_(), g.gs.nowKst_())), []);
  // 11월부터 내년 공휴일이 앱에 없으면 밤 요약에 알려요(2027년은 앱에 들어 있어요)
  assert.doesNotMatch(g.gs.adminClosePreview('582941', 'today', false).text, /공휴일이 아직 앱에 없어요/);
  g.setKst('2027-11-02 09:00');
  assert.match(g.gs.adminClosePreview('582941', 'today', false).text, /내년\(2028년\) 공휴일이 아직 앱에 없어요/);
  g.gs.setSetting_('공휴일추가', '2028-01-01 신정, 2028-01-26 설날, 2028-01-27 설날, 2028-01-28 설날, 2028-03-01 삼일절');
  g.gs.MEMO_ = {};
  assert.doesNotMatch(g.gs.adminClosePreview('582941', 'today', false).text, /공휴일이 아직 앱에 없어요/);
});

test('사장님 화면 찾기: 시트 메뉴에 주소 보기, 예전 휴무표를 안 가져왔으면 [오늘] 맨 위에 알려요', () => {
  const g = v3();
  const html = g.gs.linksHtml_();
  assert.match(html, /사장님 화면[\s\S]*\/exec\?page=admin/);
  assert.match(html, /직원 화면[\s\S]*\/exec"/);
  assert.throws(() => g.gs.menuLinks(), /getUi/, '웹 화면에서는 못 불러요(시트 메뉴에서만)');
  g.setKst('2026-11-21 10:00');
  // 지난달(10월) 탭도 없고 가져오기도 안 했어요
  assert.equal(plain(g.gs.adminToday('582941')).noOld, true);
  assert.equal(plain(g.gs.adminToday(MGR)).noOld, false, '점장 화면에는 없어요');
  g.gs.ensureMonth_('2026-10');
  assert.equal(plain(g.gs.adminToday('582941')).noOld, false, '지난달 탭이 있으면 안 띄워요');
});

test('그달 중간 퇴사자: 11월 탭이 퇴사 뒤에 만들어져도 퇴사일이 11월이면 11월 명단·월별·근무표에 나오고, 빈 퇴사일은 인사 카드에서 고쳐요', () => {
  // 사장님이 [직원]을 미리 채울 때 그만둔 사람을 '퇴사'로 적어 두고(퇴사일 모름), 11/21에 setup
  const g = createGas({ now: Date.parse('2026-11-21T10:00:00+09:00') });
  const st = g.book.insertSheet('매장');
  st.getRange(1, 1, 3, 7).setNumberFormat('@');
  st.getRange(1, 1, 3, 7).setValues([
    ['매장', '출근', '퇴근', '위도', '경도', '반경(m)', '메모'],
    ['왕십리', '10:00', '20:00', '', '', '', ''],
    ['가산', '12:00', '21:00', '', '', '', ''],
  ]);
  const sf = g.book.insertSheet('직원');
  sf.getRange(1, 1, 4, 14).setValues([
    ['이름', '매장', 'PIN', '시급', '월', '화', '수', '목', '금', '토', '일', '재직', '등록폰', '새폰요청'],
    ['김민우', '왕십리', '4321', 12000, '', '', '', '', '', '', '', '', '', ''],
    ['한중간', '왕십리', '2468', 10320, '', '', '', '', '', '', '', '퇴사', '', ''],
    ['이지은', '가산', '5678', 10320, '', '', '', '', '', '', '', '', '', ''],
  ]);
  g.gs.setup();
  g.gs.setSetting_('관리자PIN', '582941');
  const names = (ym) => { const sh = g.sheet('휴무표 ' + ym); const out = []; if (!sh) return out; for (let r = 3; r <= sh.getLastRow(); r++) if (sh.rowDisplay(r)[2]) out.push(sh.rowDisplay(r)[2]); return out; };
  assert.deepEqual(names('2026-11'), ['김민우', '이지은'], '퇴사일을 모르면 어느 달인지 몰라서 안 넣어요');
  const hl = plain(g.gs.adminHrList('582941'));
  assert.equal(hl.list.find((x) => x.name === '한중간').end, '', '퇴사일이 비어 있어요(사장님 화면에 알려요)');
  // 인사 카드: 마지막 근무일 고치기(이미 퇴사한 사람)
  assert.throws(() => g.gs.adminRetire('582941', '한중간', ''), /날짜를 골라주세요/);
  assert.throws(() => g.gs.adminRetire('582941', '한중간', '2026-11-25'), /어제까지의 날짜/);
  const c = plain(g.gs.adminRetire('582941', '한중간', '2026-11-15'));
  assert.match(c.note, /마지막 근무일을 11\/15/);
  assert.deepEqual(names('2026-11'), ['김민우', '한중간', '이지은'], '11월 명단에 들어가요(매장 순서대로)');
  assert.ok(!names('2026-12').includes('한중간'), '12월에는 없어요');
  g.gs.GRID_ = {};
  assert.equal(g.gs.dayMark_('한중간', '2026-11-16'), '퇴사', '다음 날 칸에 퇴사');
  assert.throws(() => g.gs.adminRetire('582941', '한중간', '2026-11-15'), /이미 11\/15/);
  // 날짜를 다시 고치면 예전 '퇴사' 칸은 지우고 새 날짜 다음 날에 적어요
  g.gs.adminRetire('582941', '한중간', '2026-11-12');
  g.gs.GRID_ = {};
  assert.deepEqual([g.gs.dayMark_('한중간', '2026-11-13'), g.gs.dayMark_('한중간', '2026-11-16')], ['퇴사', '']);
  // 월별 합계·월차 현황·동료 근무표에도 11월에 나와요(동료 근무표에는 퇴사 다음 날부터 빈칸)
  assert.ok(plain(g.gs.adminMonth('582941', '2026-11')).staff.some((s) => s.name === '한중간'), '출퇴근 기록이 없어도 월별에 나와요');
  assert.ok(plain(g.gs.adminLeave('582941', '2026-11')).rows.some((r) => r.name === '한중간'));
  g.gs.setMark_('2026-11-05', '한중간', () => '휴무');
  const sd = plain(g.gs.getSchedule('김민우', '4321', '2026-11'));
  const mate = sd.others.find((o) => o.name === '한중간');
  assert.ok(mate, '같은 매장 동료 근무표에 나와요');
  assert.equal(mate.days[4], '쉼');
  assert.equal(mate.days[12], '', '퇴사 다음 날부터는 빈칸(퇴사 표시를 쉼으로 세지 않아요)');
  // [직원] 줄을 지운 퇴사자([인사]에만 퇴사일이 있음)도 휴무표를 다시 만들면 들어가고, 그 매장 점장도 봐요
  g.sheet('매장').getRange(2, 8).setValue('김민우');
  g.gs.adminSetPin('582941', '김민우', '135792');
  g.sheet('휴무표 2026-11').deleteRows(names('2026-11').indexOf('한중간') + 3, 1);
  sf.deleteRows(3, 1);
  g.gs.GRID_ = {}; g.gs.MEMO_ = {};
  g.gs.ensureMonth_('2026-11');
  assert.ok(names('2026-11').includes('한중간'), '[인사] 퇴사일로 다시 넣어요');
  const mgr = { name: '김민우', pin: '135792' };
  assert.ok(plain(g.gs.adminLeave(mgr, '2026-11')).rows.some((r) => r.name === '한중간'), '점장도 휴무표 줄의 매장으로 봐요');
});

test('예전 휴무표 가져오기: 앱 시작일 뒤에만 표시가 있는 그달 퇴사자도 이미 있는 탭에 넣고, 퇴사를 이어서 적었으면 첫 칸이 퇴사일', () => {
  const g = v3();
  g.setKst('2026-11-21 10:00');
  g.gs.setSetting_('앱시작일', '2026-11-10');
  g.gs.setup();
  const blank = () => Array(31).fill('');
  const rows = [['', '', '11월', '', '', '', '매장', '이름', '', '', '', '', '', ...Array.from({ length: 31 }, (_, i) => String(i + 1))]];
  const add = (store, name, marks) => { const d = blank(); Object.entries(marks).forEach(([k, v]) => { d[Number(k) - 1] = v; }); rows.push(['', '', '11월', '', '', '', store, name, '', '', '', '', '', ...d]); };
  add('왕십리', '김민우', { 3: '휴무' });
  add('왕십리', '가늦게', { 12: '휴무', 16: '퇴사', 17: '퇴사', 18: '퇴사' }); // 앱 시작일(11/10) 뒤에만 표시
  const ID = 'OLDFILE_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789xyz';
  g.addBook(ID, { 휴무표: rows });
  const URL = 'https://docs.google.com/spreadsheets/d/' + ID + '/edit';
  const plan = g.gs.oldLoad_(URL, '2026');
  assert.equal(plan.people['가늦게'].quitDay, '2026-11-16', '이어서 적은 퇴사 칸은 첫 칸');
  const v = plain(g.gs.adminImportPreview('582941', URL, '2026'));
  for (const m of v.months) if (!m.skip) g.gs.adminImportMonth('582941', URL, '2026', m.m);
  g.gs.adminImportFinish('582941', URL, '2026');
  assert.ok(monthRowOf(g, '2026-11', '가늦게'), '이미 있던 11월 탭에도 들어가요');
  g.gs.MEMO_ = {};
  assert.equal(g.gs.hrDates_()['가늦게'].end, '2026-11-16');
});

test('인사 정보 필수: 빠진 칸 이름만 알려주고 다 넣기 전에는 출근이 안 찍혀요(서버에서 막음). 퇴근은 출근 기록을 닫을 때만', () => {
  const g = v3({ hr: false });
  g.setKst('2026-11-16 09:55');
  const st = () => { g.gs.MEMO_ = {}; return plain(g.gs.hrStatus_(g.gs.findStaff_('김민우'))); };
  const set = (rec) => { g.gs.MEMO_ = {}; g.gs.hrWrite_(g.gs.hrFind_('김민우').row, rec); g.gs.MEMO_ = {}; };
  hrFill(g, ['김민우']);
  assert.deepEqual(st(), { state: 'ok', missing: [] });
  const keep = hrRow(g, '김민우');
  for (const [rec, label] of [[{ enc: '' }, '주민등록번호'], [{ phone: '0212345678' }, '휴대폰'], [{ addr: '' }, '주소'], [{ bank: '' }, '은행'],
    [{ account: '1234567' }, '계좌번호'], [{ emergency: '' }, '비상연락처'], [{ start: '11월 말' }, '입사일']]) {
    set(rec);
    assert.deepEqual(st().missing, [label], label);
    set({ enc: keep['주민번호(암호)'], phone: keep['휴대폰'], addr: keep['주소'], bank: keep['은행'], account: keep['계좌번호'], emergency: keep['비상연락처'], start: keep['입사일'] });
  }
  assert.deepEqual(st().missing, [], '휴대폰2·예금주는 비어도 돼요');
  // 막히면 기록이 안 생기고 폰도 안 묶여요
  set({ addr: '', emergency: '' });
  assert.throws(() => punch(g, '김민우', '0123', 'in'), /인사 정보를 먼저 다 넣어야 출근이 찍혀요\. 아직 안 넣은 것: 주소, 비상연락처\./);
  assert.equal(g.sheet('출퇴근기록').getLastRow(), 1, '기록 줄이 안 생겨요(머리글만)');
  g.gs.MEMO_ = {};
  assert.deepEqual(plain(g.gs.findStaff_('김민우').deviceIds || []), []);
  assert.throws(() => punch(g, '김민우', '0123', 'out'), /인사 정보를 먼저/, '출근 기록 없이 퇴근만 찍어서 결근?을 피하지 못해요');
  // 점장은 대신 출근을 못 찍어 주고, 사장님은 찍어 줄 수 있어요(급할 때). 그 뒤 본인 퇴근은 돼요
  assert.throws(() => g.gs.proxyPunch(MGR, '김민우', 'in', '폰 방전'), /인사 정보를 아직 다 안 넣어서 점장님이 대신 출근을 찍을 수 없어요\(아직: 주소, 비상연락처\)/);
  g.gs.proxyPunch('582941', '김민우', 'in', '폰 방전');
  g.setKst('2026-11-16 20:01');
  assert.equal(punch(g, '김민우', '0123', 'out').time, '20:01');
  // 다음 날: 주소·비상연락처를 사장님이 인사 카드에 넣으면 바로 찍혀요
  g.setKst('2026-11-17 09:58');
  assert.throws(() => punch(g, '김민우', '0123', 'in'), /주소, 비상연락처/);
  const card = plain(g.gs.adminHrGet('582941', '김민우')); // 인사 카드 화면은 칸을 모두 보내요
  g.gs.adminHrSave('582941', '김민우', { ...card, rrn: card.rrn, addr: '서울 성동구 왕십리로 1', emergency: '010-9999-8888 어머니' });
  assert.equal(punch(g, '김민우', '0123', 'in').time, '09:58');
  // 출근한 뒤 칸을 지워도 그날 퇴근은 돼요(자정 넘긴 퇴근도)
  set({ emergency: '' });
  g.setKst('2026-11-18 01:30');
  assert.equal(punch(g, '김민우', '0123', 'out').prevDay, '2026-11-17');
  g.setKst('2026-11-18 09:58');
  assert.throws(() => punch(g, '김민우', '0123', 'in'), /아직 안 넣은 것: 비상연락처\./);
  // 사장님 화면에 같은 기준으로 보여요
  const hl = plain(g.gs.adminHrList('582941')).list.find((x) => x.name === '김민우');
  assert.deepEqual([hl.filled, hl.missing], [false, ['비상연락처']]);
  assert.equal(plain(g.gs.adminToday('582941')).list.find((x) => x.name === '김민우').hrOk, false);
  // 출근이 몰려 곤란할 때: [설정] 인사정보필수 = 안함 → 안내만(막지 않아요)
  g.gs.setSetting_('인사정보필수', '안함');
  g.gs.MEMO_ = {};
  assert.equal(punch(g, '김민우', '0123', 'in').time, '09:58');
  assert.equal(plain(g.gs.getHome('김민우', '0123')).hr, true, '안내는 그대로');
  // [인사] 머리글을 지워도 그 칸 때문에 모두가 막히지는 않아요
  g.gs.setSetting_('인사정보필수', '필수');
  const hs = g.sheet('인사');
  hs.getRange(1, colOf(hs, '비상연락처')).setValue('');
  assert.deepEqual(st(), { state: 'ok', missing: [] });
  assert.equal(g.gs.hrExempt_('테스트') && g.gs.hrExempt_('예시직원'), true, '테스트·예시 직원은 막지 않아요');
});

test('인사 정보 필수: 비밀번호가 없는 처음 온 직원은 인사 정보를 넣으면서 비밀번호를 정하고, 그 폰이 등록돼요', () => {
  const g = v3({ hr: false });
  tgOn(g);
  g.setKst('2026-11-16 09:30');
  hrFill(g, ['김민우']);
  punch(g, '김민우', '0123', 'in'); // 김민우 폰 등록
  g.sheet('직원').getRange(3, 3).setValue(''); // 이지은: 비밀번호 없음(처음 온 직원)
  g.gs.MEMO_ = {};
  const home = plain(g.gs.getHome('이지은', ''));
  assert.deepEqual([home.first, home.hr, home.hrBlock], [true, true, true]);
  assert.deepEqual(home.hrMissing, ['주민등록번호', '휴대폰', '주소', '은행', '계좌번호', '비상연락처', '입사일']);
  // 출근을 먼저 눌러도 막히고, 비밀번호·폰이 저장되지 않아요(이름을 잘못 눌러도 그 이름이 묶이지 않게)
  assert.throws(() => punch(g, '이지은', '2468', 'in', NEAR, 'cdcdcdcdcdcdcdcd'), /인사 정보를 먼저 다 넣어야/);
  g.gs.MEMO_ = {};
  assert.deepEqual([g.gs.findStaff_('이지은').pin, plain(g.gs.findStaff_('이지은').deviceIds || [])], ['', []]);
  const f = { rrn: '950505-2468135', phone: '010-5555-6666', addr: '서울 금천구', bank: '우리', account: '1002-123-456789', emergency: '010-9999-8888 어머니',
    start: '2025-05-01', agree: true, agreeLoc: true, device: PHONE.이지은, label: 'iPhone 사파리' };
  assert.throws(() => g.gs.hrSave('이지은', '1234', f), /너무 쉬운 비밀번호/);
  assert.throws(() => g.gs.hrSave('이지은', '2468', { ...f, device: '' }), /폰 확인이 안 돼요/);
  assert.throws(() => g.gs.hrSave('이지은', '2468', { ...f, device: PHONE.김민우 }), /김민우 님 폰으로 등록돼 있어요/);
  assert.ok(suspects(g).some((r) => r[1] === '이지은' && /다른 직원 폰/.test(r[2])), '[의심기록]에 남아요');
  assert.throws(() => g.gs.hrSave('이지은', '2468', { ...f, emergency: '' }), /비상연락처/);
  assert.throws(() => g.gs.hrSave('이지은', '2468', { ...f, start: '' }), /입사일/);
  assert.throws(() => g.gs.hrSave('이지은', '2468', { ...f, start: '2027-03-01' }), /입사일을 확인/);
  g.gs.MEMO_ = {};
  assert.equal(g.gs.findStaff_('이지은').pin, '', '막히면 아무것도 저장 안 해요');
  assert.equal(plain(g.gs.hrSave('이지은', '2468', f)).first, true);
  g.gs.MEMO_ = {};
  const p = g.gs.findStaff_('이지은');
  assert.deepEqual([p.pin, plain(p.deviceIds), !!p.agreed], ['2468', [PHONE.이지은], true]);
  assert.match(hrRow(g, '이지은')['등록'], /본인 입력\(처음 · 비밀번호 정함\)/);
  const note = sentTo(g, 555).find((t) => /처음 인사 정보 입력/.test(t));
  assert.match(note, /이지은 \(가산\) 님이 앱에서 처음 비밀번호를 정하고 인사 정보를 넣었어요/);
  assert.ok(!/1002-123-456789|950505|5555-6666/.test(note), '알림에는 끝자리만');
  // 이제 출근(동의는 이미 했어요). 다른 폰·다른 번호로는 그 이름을 못 써요
  g.setKst('2026-11-16 12:00');
  assert.equal(g.gs.punch({ name: '이지은', pin: '2468', type: 'in', device: PHONE.이지은, label: 'x' }).time, '12:00');
  assert.throws(() => g.gs.hrSave('이지은', '1357', { ...f, device: 'zzzzzzzzzzzzzzzz' }), /비밀번호가 틀렸어요/);
  // 폰 확인을 안 쓰는 가게: 폰 없이도 처음 정할 수 있고 폰은 안 묶어요
  g.gs.setSetting_('폰확인', '안함');
  g.sheet('직원').getRange(6, 3).setValue(''); // 최유나: 비밀번호 없음
  g.gs.MEMO_ = {};
  g.gs.hrSave('최유나', '9753', { ...f, rrn: '880808-2345678', device: '' });
  g.gs.MEMO_ = {};
  assert.deepEqual([g.gs.findStaff_('최유나').pin, plain(g.gs.findStaff_('최유나').deviceIds || [])], ['9753', []]);
});

test('인사 정보 필수: 통장을 나중에 넣기로 한 신입은 승인돼도 계좌를 넣기 전에는 출근이 안 찍혀요', () => {
  const g = v3({ hr: false });
  g.setKst('2026-11-16 14:00');
  assert.throws(() => g.gs.joinSubmit(joinForm({ emergency: '' })), /비상연락처/);
  g.gs.joinSubmit(joinForm({ later: true, bank: '', account: '' }));
  g.gs.adminJoin('582941', '한신입', true);
  assert.throws(() => g.gs.punch({ name: '한신입', pin: '4826', type: 'in', ...NEAR, device: NEWPHONE, label: 'x' }), /아직 안 넣은 것: 은행, 계좌번호\./);
  g.gs.hrSave('한신입', '4826', { rrn: '', phone: '010-1234-5678', addr: '서울 성동구 왕십리로 1', bank: '국민', account: '123456-78-901234', emergency: '010-9999-8888 어머니', agree: true, device: NEWPHONE });
  assert.equal(g.gs.punch({ name: '한신입', pin: '4826', type: 'in', ...NEAR, device: NEWPHONE, label: 'x' }).type, 'in');
});

test('검토 고침(인사 정보 필수): 사장님이 넣어 둔 주민번호가 있으면 같은 번호여야 이름을 차지하고, 새 폰에서 열면 승인 요청이 가고, 못 읽는 입사일은 직원이 고쳐요', () => {
  const g = v3({ hr: false });
  tgOn(g);
  g.setKst('2026-11-16 09:30');
  // 사장님이 이지은 인사 정보를 미리 넣어 둠(주민번호 포함), 비밀번호는 없음
  hrFill(g, ['이지은'], { rrn: '950505-2******', enc: g.gs.rrnEncrypt_('950505-2468135') });
  g.sheet('직원').getRange(3, 3).setValue('');
  g.gs.MEMO_ = {};
  const f = { rrn: '900101-1234567', phone: '010-5555-6666', addr: '서울', bank: '우리', account: '1002-123-456789', emergency: '010-9999-8888 어머니', start: '2025-05-01', agree: true, device: PHONE.이지은, label: 'x' };
  assert.throws(() => g.gs.hrSave('이지은', '2468', f), /주민등록번호가 사장님이 넣어 둔 것과 달라요/);
  assert.throws(() => g.gs.hrSave('이지은', '2468', { ...f, rrn: '' }), /주민등록번호가 사장님이 넣어 둔 것과 달라요/, '비워 두고는 차지 못해요');
  g.gs.MEMO_ = {};
  assert.equal(g.gs.findStaff_('이지은').pin, '');
  assert.equal(plain(g.gs.hrSave('이지은', '2468', { ...f, rrn: '950505-2468135' })).first, true);
  assert.ok(sentTo(g, 555).some((t) => /처음 인사 정보 입력/.test(t)));
  // 새 폰·새 브라우저에서 인사 정보를 열면: 새 폰 승인 요청이 가요(출근 버튼이 막혀도 막다른 길이 안 되게)
  g.gs.MEMO_ = {};
  assert.throws(() => g.gs.hrGet('이지은', '2468', 'n1n1n1n1n1n1n1n1', 'Chrome'), /이 폰을 쓰려면 사장님 승인이 필요해서 요청을 보냈어요/);
  g.gs.MEMO_ = {};
  assert.match(g.gs.findStaff_('이지은').request, /n1n1n1n1n1n1n1n1 Chrome/);
  hrFill(g, ['김민우']);
  punch(g, '김민우', '0123', 'in'); // 김민우 폰 등록
  assert.throws(() => g.gs.hrGet('이지은', '2468', PHONE.김민우, 'x'), /등록된 폰\)에서만 볼 수 있어요\.$/, '동료 폰이면 요청 없이 막아요');
  // 못 읽는 입사일: 내 정보에서 빈칸으로 와서 직원이 넣을 수 있어요
  g.gs.hrWrite_(g.gs.hrFind_('이지은').row, { start: '2023.3' });
  g.gs.MEMO_ = {};
  assert.equal(g.gs.hrGet('이지은', '2468', PHONE.이지은).start, '');
  g.gs.hrSave('이지은', '2468', { ...f, rrn: '', start: '2023-03-02' });
  g.gs.MEMO_ = {};
  assert.equal(hrRow(g, '이지은')['입사일'], '2023-03-02');
  // 인사 정보가 빠진 직원은 출근 정정도 못 보내요(퇴근 정정은 돼요)
  g.gs.hrWrite_(g.gs.hrFind_('이지은').row, { emergency: '' });
  g.gs.MEMO_ = {};
  assert.throws(() => req(g, '이지은', '2468', 'fix', { date: '2026-11-15', which: 'in', time: '12:00', reason: '깜빡', to: 'admin' }), /인사 정보를 먼저 다 넣어야/);
  // [인사] '이름' 머리글을 바꿔도 모두가 막히지 않아요. [설정] 안함이면 사장님·점장 화면도 대신 출근을 막지 않아요
  const hs = g.sheet('인사');
  assert.equal(plain(g.gs.adminToday(MGR)).list.find((x) => x.name === '이지은'), undefined, '점장은 자기 매장만');
  g.gs.setSetting_('인사정보필수', '안함');
  g.gs.MEMO_ = {};
  assert.equal(plain(g.gs.adminToday('582941')).list.find((x) => x.name === '이지은').hrOk, true);
  g.gs.setSetting_('인사정보필수', '필수');
  hs.getRange(1, colOf(hs, '이름')).setValue('성명');
  g.gs.MEMO_ = {};
  assert.equal(plain(g.gs.hrStatus_(g.gs.findStaff_('이지은'))).state, 'ok');
});

test('검토 고침(퇴사자): 마지막 근무일 고치기는 같은 이름 근무자를 건드리지 않고, 없는 탭을 만들지 않고, 마감한 달은 막고, 그 사람 줄만 넣어요', () => {
  const g = v3();
  g.setKst('2026-10-05 10:00');
  g.gs.setup(); // 10월 탭
  g.setKst('2026-11-21 10:00');
  // 최유나: 10월 5일에 퇴사한 걸로 잘못 처리됨 → 실제로는 11월 15일까지 일했어요
  g.gs.adminRetire('582941', '최유나', '2026-10-05');
  const names = (ym) => { const sh = g.sheet('휴무표 ' + ym); const out = []; if (!sh) return out; for (let r = 3; r <= sh.getLastRow(); r++) if (sh.rowDisplay(r)[2]) out.push(sh.rowDisplay(r)[2]); return out; };
  assert.ok(!names('2026-11').includes('최유나'));
  const tabs = () => g.book.getSheets().map((s) => s.getName()).filter((n) => n.startsWith('휴무표')).sort().join(',');
  const before = tabs();
  const octOthers = names('2026-10').filter((n) => n !== '최유나').join(',');
  g.gs.adminRetire('582941', '최유나', '2026-11-15');
  assert.equal(tabs(), before, '탭을 새로 만들지 않아요');
  assert.ok(names('2026-11').includes('최유나'), '11월 명단에 들어가요');
  assert.equal(names('2026-10').filter((n) => n !== '최유나').join(','), octOthers, '다른 사람 줄은 넣지 않아요');
  g.gs.GRID_ = {};
  assert.equal(g.gs.dayMark_('최유나', '2026-10-06'), '', '예전 날짜 다음 날의 퇴사 칸은 지워요');
  g.gs.adminRetire('582941', '최유나', '2026-11-10'); // 11월끼리 다시 고치기도 돼요
  // 예전 날짜가 마감한 달이면(그달 '퇴사' 칸을 지워야 해서) 막아요
  g.gs.adminRetire('582941', '이지은', '2026-10-20');
  g.gs.adminMonthClose('582941', '2026-10', true);
  g.gs.MEMO_ = {}; g.gs.GRID_ = {};
  assert.throws(() => g.gs.adminRetire('582941', '이지은', '2026-11-12'), /10월은 마감한 달이라/);
  // 근무 중인 같은 이름(새 사람)이 있는데 [인사]가 예전 퇴사 줄이면 막아요(근무 중인 사람을 퇴사시키지 않게)
  g.sheet('직원').getRange(8, 1, 1, 3).setValues([['최유나', '가산', '2222']]);
  g.gs.MEMO_ = {};
  assert.throws(() => g.gs.adminRetire('582941', '최유나', '2026-11-01'), /근무 중인 최유나 님과 같은 이름의 퇴사 기록이에요/);
});

test('검토 고침(퇴사자): [직원] 줄을 지운 그달 퇴사자도 점장 월별·동료 근무표에 나오고, 예전 휴무표의 퇴사 사이 휴무는 퇴사가 이어진 걸로 봐요', () => {
  const g = v3();
  g.setKst('2026-11-21 10:00');
  g.gs.adminRetire('582941', '박점장', '2026-11-12'); // 왕십리
  g.sheet('매장').getRange(2, 8).setValue('김민우');
  g.gs.adminSetPin('582941', '김민우', '135792');
  g.sheet('직원').deleteRows(5, 1); // 박점장 줄 지움
  g.gs.MEMO_ = {}; g.gs.GRID_ = {};
  const mgr = { name: '김민우', pin: '135792' };
  const m = plain(g.gs.adminMonth(mgr, '2026-11'));
  const row = m.staff.find((x) => x.name === '박점장');
  assert.ok(row, '점장 월별에 나와요');
  assert.equal(plain(g.gs.adminMonth('582941', '2026-11')).staff.find((x) => x.name === '박점장').store, '왕십리', '사장님 월별에 매장이 보여요');
  const sd = plain(g.gs.getSchedule('김민우', '135792', '2026-11'));
  assert.ok(sd.others.some((o) => o.name === '박점장'), '동료 근무표에 나와요');
  // 예전 휴무표: 퇴사 칸 사이에 미리 적어 둔 휴무가 있어도 첫 퇴사 칸이 퇴사일
  const rows = [['', '', '9월', '', '', '', '매장', '이름', '', '', '', '', '', ...Array.from({ length: 31 }, (_, i) => String(i + 1))]];
  const d = Array(31).fill(''); d[15] = '퇴사'; d[16] = '휴무'; d[17] = '퇴사'; d[18] = '퇴사';
  rows.push(['', '', '9월', '', '', '', '왕십리', '나휴무', '', '', '', '', '', ...d]);
  const d2 = Array(31).fill(''); d2[2] = '휴무';
  rows.push(['', '', '9월', '', '', '', '왕십리', '김민우', '', '', '', '', '', ...d2]);
  const ID = 'OLDFILE_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789qrs';
  g.addBook(ID, { 휴무표: rows });
  assert.equal(g.gs.oldLoad_('https://docs.google.com/spreadsheets/d/' + ID + '/edit', '2026').people['나휴무'].quitDay, '2026-09-16');
});
