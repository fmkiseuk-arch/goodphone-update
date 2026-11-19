// 실행: node --test attendance/test
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./gas-mock');

const STORE = { lat: 37.5665, lng: 126.978 };
const NEAR = { lat: 37.5668, lng: 126.978, acc: 20 }; // 약 33m
const FAR = { lat: 37.58, lng: 126.978, acc: 20 }; // 약 1.5km

// 2026-11-16 은 월요일
function fresh({ grace = '0', mode = '필수', email = '' } = {}) {
  const g = createGas({ now: Date.parse('2026-11-16T09:00:00+09:00') });
  g.gs.setup();
  const staff = g.sheet('직원');
  staff.getRange(2, 1, 3, 11).setValues([
    ['김민수', '0123', 12000, '10:00-20:00', '10:00-20:00', '10:00-20:00', '10:00-20:00', '10:00-20:00', '휴무', '휴무', ''],
    ['이지은', '', '10,320', '12:00~21:00', '12:00~21:00', '', '12:00~21:00', '12:00~21:00', '12:00~21:00', '', ''],
    ['박퇴사', '9999', 10320, '10:00-20:00', '', '', '', '', '', '', 'X'],
  ]);
  const set = (k, v) => g.gs.setSetting_(k, v);
  set('관리자PIN', '777777');
  set('지각유예(분)', grace);
  set('위치확인', mode);
  set('알림이메일', email);
  g.gs.adminSetPlace('777777', STORE.lat, STORE.lng);
  return g;
}
// 직원마다 자기 폰 번호
const PHONE = { 김민수: 'aaaaaaaaaaaaaaaa', 이지은: 'bbbbbbbbbbbbbbbb', 박퇴사: 'cccccccccccccccc', 예시직원: 'dddddddddddddddd' };
const punch = (g, name, pin, type, pos = NEAR, device = PHONE[name], label = 'iPhone 사파리') =>
  g.gs.punch({ name, pin, type, lat: pos && pos.lat, lng: pos && pos.lng, acc: pos && pos.acc, device, label });
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

test('처음 설정: 시트 4개와 10분 알림이 만들어지고, 다시 실행해도 그대로예요', () => {
  const g = fresh();
  for (const n of ['설정', '직원', '근무변경', '출퇴근기록']) assert.ok(g.sheet(n), n);
  assert.equal(g.triggers.length, 1);
  g.gs.setup();
  assert.equal(g.triggers.length, 1);
  assert.equal(g.sheet('직원').rowDisplay(2)[0], '김민수');
  assert.equal(g.sheet('직원').rowDisplay(2)[1], '0123', 'PIN 앞의 0이 사라지면 안 돼요');
});

test('정시 출근 → 지각 출근 → 중복 출근 막기 → 퇴근', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:58');
  let r = punch(g, '김민수', '0123', 'in');
  assert.equal(r.time, '09:58');
  assert.equal(r.late, 0);

  g.setKst('2026-11-16 12:09');
  r = punch(g, '이지은', '', 'in'); // 비밀번호 없는 직원
  assert.equal(r.late, 9);

  g.setKst('2026-11-16 12:30');
  assert.throws(() => punch(g, '김민수', '0123', 'in'), /이미 09:58에 출근/);

  g.setKst('2026-11-16 20:03');
  r = punch(g, '김민수', '0123', 'out');
  assert.equal(r.work, 20 * 60 + 3 - (9 * 60 + 58));
  assert.equal(r.early, 0);

  const log = g.sheet('출퇴근기록');
  assert.equal(log.getLastRow(), 3);
  const kim = log.rowDisplay(2);
  assert.deepEqual(kim.slice(0, 7), ['2026-11-16', '월', '김민수', '10:00', '20:00', '09:58', '20:03']);
  const lee = log.rowDisplay(3);
  assert.equal(lee[3], '12:00');
  assert.equal(lee[7], '9');
  assert.equal(lee[10], '1,548'); // 10,320 × 9 ÷ 60 = 1548
  assert.ok(Number(lee[11]) > 0 && Number(lee[11]) < 60, '출근거리(m)가 남아요');
});

test('비밀번호: 틀리면 거절, 5번 틀리면 잠김', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:59');
  assert.throws(() => punch(g, '김민수', '123', 'in'), /비밀번호가 틀렸어요/);
  for (let i = 0; i < 4; i++) assert.throws(() => punch(g, '김민수', '1111', 'in'));
  assert.throws(() => punch(g, '김민수', '0123', 'in'), /잠겼어요/);
  g.cache.clear();
  assert.equal(punch(g, '김민수', '0123', 'in').time, '09:59');
});

test('퇴사자는 목록에도 없고 찍을 수도 없어요', () => {
  const g = fresh();
  const names = Array.from(g.gs.getStaffList().staff, (p) => p.name);
  assert.deepEqual(names, ['김민수', '이지은']);
  assert.throws(() => punch(g, '박퇴사', '9999', 'in'), /명단에 없는/);
});

test('위치 확인: 멀면 거절, 위치 없으면 거절, 기록만 모드면 통과', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:50');
  assert.throws(() => punch(g, '김민수', '0123', 'in', FAR), /떨어져 있어요/);
  assert.throws(() => punch(g, '김민수', '0123', 'in', null), /위치를 확인하지 못했어요/);
  // 실내 GPS 오차: 반경 100m + 오차 최대 100m까지 봐줘요
  const edge = { lat: 37.5665 + 0.0016, lng: 126.978, acc: 90 }; // 약 178m
  assert.equal(punch(g, '김민수', '0123', 'in', edge).time, '09:50');

  const g2 = fresh({ mode: '기록만' });
  g2.setKst('2026-11-16 09:50');
  assert.equal(punch(g2, '김민수', '0123', 'in', FAR).time, '09:50');
  assert.ok(Number(g2.sheet('출퇴근기록').rowDisplay(2)[11]) > 1000, '먼 거리도 기록은 남아요');
});

test('매장 위치를 등록 안 했으면 필수 모드에서 알려줘요', () => {
  const g = createGas({ now: Date.parse('2026-11-16T09:00:00+09:00') });
  g.gs.setup();
  assert.throws(() => punch(g, '예시직원', '1234', 'in'), /매장 위치를 등록하지 않았어요/);
});

test('일찍 퇴근, 퇴근 다시 찍기, 출근 없이 퇴근', () => {
  const g = fresh();
  g.setKst('2026-11-16 10:00');
  punch(g, '김민수', '0123', 'in');
  g.setKst('2026-11-16 19:40');
  let r = punch(g, '김민수', '0123', 'out');
  assert.equal(r.early, 20);
  g.setKst('2026-11-16 20:10');
  r = punch(g, '김민수', '0123', 'out');
  assert.equal(r.early, 0);
  let row = g.sheet('출퇴근기록').rowDisplay(2);
  assert.equal(row[6], '20:10');
  assert.match(row[13], /퇴근 다시 찍음\(이전 19:40\)/);

  g.setKst('2026-11-16 21:00');
  r = punch(g, '이지은', '', 'out');
  assert.equal(r.work, null);
  row = g.sheet('출퇴근기록').rowDisplay(3);
  assert.match(row[13], /출근 기록 없음/);
});

test('근무변경 시트가 요일 근무표보다 우선해요', () => {
  const g = fresh();
  g.sheet('근무변경').appendRow(['2026-11-16', '김민수', '13:00-21:00', '대타']);
  g.setKst('2026-11-16 12:55');
  const t = g.gs.getToday('김민수');
  assert.equal(t.sIn, '13:00');
  assert.equal(punch(g, '김민수', '0123', 'in').late, 0);

  g.sheet('근무변경').appendRow(['2026-11-17', '이지은', '휴무', '']);
  g.setKst('2026-11-17 09:00');
  assert.equal(g.gs.getToday('이지은').sIn, '');
});

test('사장님 오늘 화면: 상태를 맞게 보여줘요', () => {
  const g = fresh();
  g.setKst('2026-11-16 10:03');
  punch(g, '김민수', '0123', 'in');
  g.setKst('2026-11-16 12:20');
  const r = g.gs.adminToday('777777');
  const by = Object.fromEntries(r.list.map((p) => [p.name, p]));
  assert.equal(by['김민수'].status, '근무중');
  assert.equal(by['김민수'].late, 3);
  assert.equal(by['이지은'].status, '미출근');
  assert.equal(r.info.hasPlace, true);
  assert.equal(r.info.weakPin, false);
  assert.throws(() => g.gs.adminToday('0000'), /관리자 비밀번호가 틀렸어요/);

  g.setKst('2026-11-21 11:00'); // 토요일: 김민수 휴무
  const sat = Object.fromEntries(g.gs.adminToday('777777').list.map((p) => [p.name, p]));
  assert.equal(sat['김민수'].status, '휴무');
  assert.equal(sat['이지은'].status, '출근 전');
});

test('월별 합계, 내 기록, 정산 시트', () => {
  const g = fresh();
  const day = (d, tin, tout) => {
    g.setKst(`2026-11-${d} ${tin}`); punch(g, '김민수', '0123', 'in');
    if (tout) { g.setKst(`2026-11-${d} ${tout}`); punch(g, '김민수', '0123', 'out'); }
  };
  day('16', '10:00', '20:00');
  day('17', '10:12', '20:00'); // 12분 지각 → 2,400원
  day('18', '09:50', null); // 퇴근 안 찍음
  g.setKst('2026-11-19 09:00');

  const mine = g.gs.getMyMonth('김민수', '0123', '');
  assert.equal(mine.ym, '2026-11');
  assert.equal(mine.rows.length, 3);
  assert.equal(mine.total.days, 3);
  assert.equal(mine.total.lateCount, 1);
  assert.equal(mine.total.lateMin, 12);
  assert.equal(mine.total.deduct, 2400);
  assert.equal(mine.total.noOut, 1);
  assert.equal(mine.total.work, 600 + 588);
  assert.throws(() => g.gs.getMyMonth('김민수', '', ''), /비밀번호/);

  const m = g.gs.adminMonth('777777', '2026-11');
  const kim = m.staff.find((s) => s.name === '김민수');
  assert.equal(kim.deduct, 2400);
  assert.ok(m.staff.find((s) => s.name === '이지은'), '기록이 없어도 재직자는 보여요');
  assert.ok(!m.staff.find((s) => s.name === '박퇴사'));

  const ex = g.gs.adminExport('777777', '2026-11');
  assert.equal(ex.name, '정산 2026-11');
  const sh = g.sheet('정산 2026-11');
  const kimRow = sh.rowDisplay(2);
  assert.equal(kimRow[0], '김민수');
  assert.equal(kimRow[2], '19시간 48분');
  assert.equal(kimRow[6], '2,400');
  assert.equal(sh.rowDisplay(5)[0], '날짜');
  assert.equal(sh.rowDisplay(6)[5], '10:00', '정산 시트의 시간도 그대로 보여요');
  // 다시 만들어도 한 벌만
  g.gs.adminExport('777777', '2026-11');
  assert.equal(g.book.getSheets().filter((s) => s.getName() === '정산 2026-11').length, 1);
});

test('사장님이 시트에서 출근 시간을 고치면 지각·차감이 다시 계산돼요', () => {
  const g = fresh();
  g.setKst('2026-11-16 10:30');
  punch(g, '김민수', '0123', 'in');
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
  punch(g, '김민수', '0123', 'in');
  const log = g.sheet('출퇴근기록');
  log.setFmt(2, 6, ''); // 누가 서식을 '자동'으로 바꿈
  log.getRange(2, 6).setValue('10:20');
  assert.equal(log.rowDisplay(2)[5], '오전 10:20:00');
  g.gs.onEdit({ range: log.getRange(2, 6) });
  assert.equal(log.rowDisplay(2)[7], '20');
  g.setKst('2026-11-16 20:00');
  assert.equal(punch(g, '김민수', '0123', 'out').late, 20);
});

test('미출근 메일: 기준 시간이 지나면 한 번만 보내요', () => {
  const g = fresh({ email: 'owner@example.com' });
  g.setKst('2026-11-16 10:05');
  g.gs.checkMissing();
  assert.equal(g.mails.length, 0, '아직 10분 안 지남');
  g.setKst('2026-11-16 10:10');
  g.gs.checkMissing();
  assert.equal(g.mails.length, 1);
  assert.match(g.mails[0].body, /김민수 \(출근 예정 10:00\)/);
  assert.doesNotMatch(g.mails[0].body, /이지은/);
  g.setKst('2026-11-16 10:20');
  g.gs.checkMissing();
  assert.equal(g.mails.length, 1, '같은 날 같은 사람은 한 번만');
  g.setKst('2026-11-16 12:15');
  punch(g, '이지은', '', 'in');
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
  punch(g, '김민수', '0123', 'in');
  g.setKst('2026-11-16 12:00');
  punch(g, '이지은', '', 'in');
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
  punch(g, '김민수', '0123', 'in');
  const staff = g.sheet('직원');
  assert.match(staff.rowDisplay(2)[11], /^#aaaaaaaaaaaaaaaa iPhone 사파리 · 11\/16 등록$/);

  g.setKst('2026-11-16 20:00');
  assert.equal(punch(g, '김민수', '0123', 'out').time, '20:00', '같은 폰은 통과');
});

test('동료 폰으로 대신 찍기: 다른 직원 폰이면 거절하고 기록·메일', () => {
  const g = fresh({ email: 'owner@example.com' });
  g.setKst('2026-11-16 09:58');
  punch(g, '김민수', '0123', 'in');
  g.setKst('2026-11-16 12:01');
  // 김민수가 이지은 비밀번호를 알고 자기 폰으로 대신 찍으려 함
  assert.throws(() => punch(g, '이지은', '', 'in', NEAR, PHONE['김민수']), /김민수 님 폰으로 등록돼 있어요/);
  assert.equal(g.gs.getToday('이지은').tIn, '', '출근이 안 찍혀요');
  assert.deepEqual(suspects(g).at(-1).slice(1, 3), ['이지은', '다른 직원 폰']);
  assert.match(suspects(g).at(-1)[3], /김민수 님 폰으로 찍으려 함/);
  assert.equal(g.mails.length, 1);
  assert.match(g.mails[0].subject, /이지은 · 다른 직원 폰/);
  assert.equal(g.sheet('직원').rowDisplay(3)[11], '', '이지은 폰으로 등록되지도 않아요');
});

test('새 폰: 거절 → 사장님 승인 → 새 폰만 통과, 예전 폰은 거절', () => {
  const g = fresh({ email: 'owner@example.com' });
  g.setKst('2026-11-16 09:58');
  punch(g, '김민수', '0123', 'in');

  const NEW = 'eeeeeeeeeeeeeeee';
  g.setKst('2026-11-17 09:59');
  assert.throws(() => punch(g, '김민수', '0123', 'in', NEAR, NEW, 'Android 크롬'), /새 폰 승인을 요청했어요/);
  assert.throws(() => punch(g, '김민수', '0123', 'in', NEAR, NEW, 'Android 크롬'), /새 폰 승인/);
  assert.equal(g.mails.length, 1, '같은 폰으로 여러 번 눌러도 메일은 한 번');
  assert.equal(suspects(g).filter((s) => s[2] === '새 폰 승인 요청').length, 2, '시도는 매번 남아요');
  assert.match(suspects(g).at(-1)[3], /Android 크롬 \(등록된 폰: iPhone 사파리\)/);

  const today = g.gs.adminToday('777777');
  assert.equal(today.pending.length, 1);
  assert.equal(today.pending[0].name, '김민수');
  assert.match(today.pending[0].label, /Android 크롬 · 11\/17 09:59 요청/);
  assert.equal(today.suspects.length, 2);

  const after = g.gs.adminDevice('777777', '김민수', true);
  assert.equal(after.pending.length, 0);
  assert.match(after.devices.find((d) => d.name === '김민수').label, /Android 크롬 · 11\/17 승인/);
  assert.equal(g.sheet('직원').rowDisplay(2)[12], '', '요청 칸은 비워져요');

  g.setKst('2026-11-17 10:02');
  assert.equal(punch(g, '김민수', '0123', 'in', NEAR, NEW).late, 2);
  g.setKst('2026-11-17 20:00');
  assert.throws(() => punch(g, '김민수', '0123', 'out', NEAR, PHONE['김민수']), /등록된 폰이 아니에요/);
});

test('새 폰 거절, 관리자 비밀번호 틀림', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:58');
  punch(g, '김민수', '0123', 'in');
  assert.throws(() => punch(g, '김민수', '0123', 'out', NEAR, 'ffffffffffffffff'));
  assert.throws(() => g.gs.adminDevice('1111', '김민수', false), /관리자 비밀번호/);
  assert.equal(suspects(g).at(-1)[2], '관리자 비밀번호 틀림');
  g.gs.adminDevice('777777', '김민수', false);
  assert.equal(g.gs.adminToday('777777').pending.length, 0);
  assert.match(g.sheet('직원').rowDisplay(2)[11], /aaaaaaaaaaaaaaaa/, '등록폰은 그대로');
  assert.throws(() => g.gs.adminDevice('777777', '김민수', true), /승인 대기 중인 폰이 없어요/);
});

test('다른 직원 폰을 승인하려 하면 막아요', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:58');
  punch(g, '김민수', '0123', 'in');
  punch(g, '이지은', '', 'in', NEAR, PHONE['이지은']);
  // 이지은 줄에 김민수 폰 번호로 요청이 생긴 상황(시트를 손으로 고친 경우 등)
  g.sheet('직원').getRange(3, 13).setValue('#aaaaaaaaaaaaaaaa iPhone 사파리 · 11/16 12:00 요청');
  assert.throws(() => g.gs.adminDevice('777777', '이지은', true), /김민수 님 폰으로 등록돼 있어서/);
});

test('폰 번호가 없으면(시크릿 모드 등) 거절, 폰확인=안함이면 통과', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:58');
  assert.throws(() => punch(g, '김민수', '0123', 'in', NEAR, ''), /시크릿/);
  assert.equal(suspects(g).at(-1)[2], '폰 확인 안 됨');
  g.gs.setSetting_('폰확인', '안함');
  assert.equal(punch(g, '김민수', '0123', 'in', NEAR, '').time, '09:58');
});

test('의심기록: 비밀번호 틀림, 매장 밖, 위치 없음, 기록만 모드의 매장 밖', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:50');
  assert.throws(() => punch(g, '김민수', '9999', 'in'));
  assert.throws(() => punch(g, '김민수', '0123', 'in', FAR));
  assert.throws(() => punch(g, '김민수', '0123', 'in', null));
  const s = suspects(g);
  assert.deepEqual(s.map((x) => x[2]), ['비밀번호 틀림', '매장 밖', '위치 없음']);
  assert.equal(s[0][0], '2026-11-16 09:50');
  assert.match(s[1][3], /매장에서 1\.5km \(GPS 오차 20m\)/);

  g.gs.setSetting_('위치확인', '기록만');
  g.setKst('2026-11-16 09:55');
  assert.equal(punch(g, '김민수', '0123', 'in', FAR).time, '09:55');
  assert.equal(suspects(g).at(-1)[2], '매장 밖에서 찍음');
  assert.equal(g.gs.adminToday('777777').suspects[0].kind, '매장 밖에서 찍음', '최근 것이 위에');
});

test('예전 버전 시트에 setup을 다시 돌리면 등록폰 칸과 의심기록 탭이 생겨요', () => {
  const g = createGas({ now: Date.parse('2026-11-16T09:00:00+09:00') });
  const old = g.book.insertSheet('직원');
  old.getRange(1, 1, 2, 11).setValues([
    ['이름', 'PIN', '시급', '월', '화', '수', '목', '금', '토', '일', '재직'],
    ['김민수', '0123', 12000, '10:00-20:00', '', '', '', '', '', '', ''],
  ]);
  g.gs.setup();
  assert.deepEqual(old.rowDisplay(1).slice(11, 13), ['등록폰', '새폰요청']);
  assert.ok(g.sheet('의심기록'));
  assert.equal(old.rowDisplay(2)[0], '김민수', '기존 직원은 그대로');
});

/* ───── 정정·휴무·대타 요청, 텔레그램 ───── */

const req = (g, name, pin, kind, extra = {}) => g.gs.makeRequest({ name, pin, kind, ...extra });
const reqRows = (g) => {
  const sh = g.sheet('요청');
  const out = [];
  for (let r = 2; r <= sh.getLastRow(); r++) out.push(sh.rowDisplay(r));
  return out;
};
const changeRows = (g) => {
  const sh = g.sheet('근무변경');
  const out = [];
  for (let r = 2; r <= sh.getLastRow(); r++) out.push(sh.rowDisplay(r).slice(0, 4));
  return out;
};

test('정정 요청: 퇴근을 깜빡함 → 사장님 승인 → 기록에 반영', () => {
  const g = fresh({ email: 'owner@example.com' });
  g.setKst('2026-11-16 10:03');
  punch(g, '김민수', '0123', 'in');
  g.setKst('2026-11-17 09:40');
  const r = req(g, '김민수', '0123', 'fix', { date: '2026-11-16', type: 'out', time: '20:05', reason: '마감하다 깜빡함' });
  assert.equal(r.mine.length, 1);
  assert.equal(r.mine[0].state, '대기');
  assert.equal(r.mine[0].what, '퇴근 20:05');
  assert.equal(g.mails.length, 1);
  assert.match(g.mails[0].subject, /김민수 · 정정 요청/);
  assert.match(g.mails[0].body, /사유: 마감하다 깜빡함/);

  const t = g.gs.adminToday('777777');
  assert.equal(t.requests.length, 1);
  assert.equal(t.requests[0].before, '', '퇴근 기록이 원래 없었어요');
  g.gs.adminRequest('777777', t.requests[0].id, true);

  const row = g.sheet('출퇴근기록').rowDisplay(2);
  assert.equal(row[6], '20:05');
  assert.equal(row[9], String(20 * 60 + 5 - (10 * 60 + 3)), '근무시간이 다시 계산돼요');
  assert.match(row[13], /정정 승인: 퇴근 20:05 마감하다 깜빡함/);
  assert.equal(reqRows(g)[0][7], '승인');
  assert.equal(g.gs.adminToday('777777').requests.length, 0);
});

test('정정 요청: 출근 시간 고치기(이전 시간 남김), 기록이 없던 날도 새로 만들어요', () => {
  const g = fresh();
  g.setKst('2026-11-16 10:30');
  punch(g, '김민수', '0123', 'in');
  g.setKst('2026-11-18 12:00');
  req(g, '김민수', '0123', 'fix', { date: '2026-11-16', type: 'in', time: '09:58', reason: '폰이 꺼져서 늦게 찍음' });
  req(g, '김민수', '0123', 'fix', { date: '2026-11-17', type: 'in', time: '10:00', reason: '출근 깜빡' });
  const ids = g.gs.adminToday('777777').requests.map((x) => x.id);
  assert.equal(g.gs.adminToday('777777').requests[0].before, '10:30');
  ids.forEach((id) => g.gs.adminRequest('777777', id, true));
  const log = g.sheet('출퇴근기록');
  const d16 = log.rowDisplay(2);
  assert.equal(d16[5], '09:58');
  assert.equal(d16[7], '', '지각이 없어졌어요');
  assert.match(d16[13], /이전 10:30/);
  const d17 = log.rowDisplay(3);
  assert.deepEqual(d17.slice(0, 6), ['2026-11-17', '화', '김민수', '10:00', '20:00', '10:00']);
});

test('정정 요청 검사: 미래, 14일 넘음, 사유 없음, 같은 요청 중복, 비밀번호', () => {
  const g = fresh();
  g.setKst('2026-11-18 12:00');
  assert.throws(() => req(g, '김민수', '0123', 'fix', { date: '2026-11-18', type: 'out', time: '20:00', reason: 'x' }), /아직 지나지 않은 시간/);
  assert.throws(() => req(g, '김민수', '0123', 'fix', { date: '2026-11-19', type: 'out', time: '10:00', reason: 'x' }), /14일 전까지/);
  assert.throws(() => req(g, '김민수', '0123', 'fix', { date: '2026-11-01', type: 'out', time: '10:00', reason: 'x' }), /14일 전까지/);
  assert.throws(() => req(g, '김민수', '0123', 'fix', { date: '2026-11-17', type: 'out', time: '20:00', reason: ' ' }), /사유/);
  assert.throws(() => req(g, '김민수', '0123', 'fix', { date: '2026-11-17', type: 'out', time: '8시', reason: 'x' }), /시간을 넣어/);
  assert.throws(() => req(g, '김민수', '1111', 'fix', { date: '2026-11-17', type: 'out', time: '20:00', reason: 'x' }), /비밀번호/);
  req(g, '김민수', '0123', 'fix', { date: '2026-11-17', type: 'out', time: '20:00', reason: 'x' });
  assert.throws(() => req(g, '김민수', '0123', 'fix', { date: '2026-11-17', type: 'out', time: '20:10', reason: 'x' }), /이미 있어요/);
  req(g, '김민수', '0123', 'fix', { date: '2026-11-17', type: 'in', time: '10:00', reason: 'x' }); // 출근은 따로 돼요
  assert.equal(reqRows(g).length, 2);
});

test('휴무 요청: 승인하면 근무변경에 휴무가 들어가요, 거절·취소', () => {
  const g = fresh();
  g.setKst('2026-11-16 15:00');
  assert.throws(() => req(g, '김민수', '0123', 'off', { date: '2026-11-21', reason: '병원' }), /원래 근무가 없는 날/); // 토요일
  assert.throws(() => req(g, '김민수', '0123', 'off', { date: '2026-11-15', reason: '병원' }), /60일 안/);
  assert.throws(() => req(g, '김민수', '0123', 'off', { date: '2026-11-20', reason: '' }), /사유/);
  req(g, '김민수', '0123', 'off', { date: '2026-11-20', reason: '병원' });
  assert.throws(() => req(g, '김민수', '0123', 'swap', { date: '2026-11-20' }), /이미 휴무 요청/);

  const id = g.gs.adminToday('777777').requests[0].id;
  g.gs.adminRequest('777777', id, true);
  assert.deepEqual(changeRows(g), [['2026-11-20', '김민수', '휴무', '휴무 승인: 병원']]);
  g.setKst('2026-11-20 09:00');
  assert.equal(g.gs.getToday('김민수').sIn, '', '그날은 휴무');
  assert.throws(() => g.gs.adminRequest('777777', id, false), /이미 승인된/);

  g.setKst('2026-11-16 15:00');
  const r2 = req(g, '김민수', '0123', 'off', { date: '2026-11-19', reason: '가족 행사' });
  g.gs.adminRequest('777777', r2.mine[0].id, false);
  const r3 = req(g, '김민수', '0123', 'off', { date: '2026-11-18', reason: '개인 사정' });
  const after = g.gs.cancelRequest('김민수', '0123', r3.mine[0].id);
  assert.deepEqual(after.mine.map((x) => x.state), ['취소', '거절', '승인']);
  assert.equal(changeRows(g).length, 1, '거절·취소는 근무표를 안 바꿔요');
});

test('대타: 구함 → 동료 수락 → 사장님 승인 → 두 사람 근무표가 바뀌어요', () => {
  const g = fresh({ email: 'owner@example.com' });
  g.setKst('2026-11-16 15:00');
  // 11/20(금) 김민수 10:00-20:00 → 이지은이 대신 (이지은도 금요일 12:00-21:00 근무 → 합쳐서 10:00-21:00)
  const a = req(g, '김민수', '0123', 'swap', { date: '2026-11-20', reason: '집안일' });
  assert.equal(a.mine[0].what, '10:00-20:00');
  assert.match(g.mails.at(-1).subject, /김민수 · 대타 구하는 중/);

  assert.throws(() => g.gs.adminRequest('777777', a.mine[0].id, true), /아직 대타를 해줄 동료가 없어요/);

  const seen = g.gs.getRequests('이지은', '');
  assert.equal(seen.swaps.length, 1);
  assert.equal(seen.swaps[0].reason, '', '동료에게는 사유를 안 보여줘요');
  assert.equal(g.gs.getRequests('김민수', '0123').swaps.length, 0, '내 요청은 대타 목록에 안 떠요');
  assert.throws(() => g.gs.takeSwap('김민수', '0123', a.mine[0].id), /본인 요청/);

  const b = g.gs.takeSwap('이지은', '', a.mine[0].id);
  assert.equal(b.mine[0].taker, '이지은');
  assert.equal(b.swaps.length, 0);
  assert.match(g.mails.at(-1).subject, /대타 수락/);
  assert.match(g.mails.at(-1).body, /이지은 님은 그날 원래 12:00-21:00 근무라서/);
  assert.throws(() => g.gs.takeSwap('박퇴사', '9999', a.mine[0].id), /명단에 없는/);

  const t = g.gs.adminToday('777777').requests[0];
  assert.equal(t.state, '수락');
  assert.match(t.note, /두 시간을 합쳐요/);
  g.gs.adminRequest('777777', t.id, true);
  assert.deepEqual(changeRows(g), [
    ['2026-11-20', '김민수', '휴무', '대타: 이지은 님이 대신 근무'],
    ['2026-11-20', '이지은', '10:00-21:00', '김민수 님 대신 대타 (원래 12:00-21:00 근무와 합침)'],
  ]);
  g.setKst('2026-11-20 09:00');
  assert.equal(g.gs.getToday('이지은').sIn, '10:00');
  assert.equal(g.gs.getToday('김민수').sIn, '');
});

test('대타: 수락한 사람이 취소하면 다시 구하는 중, 요청자가 취소하면 끝', () => {
  const g = fresh();
  g.setKst('2026-11-16 15:00');
  const a = req(g, '이지은', '', 'swap', { date: '2026-11-17' }); // 화요일 12:00-21:00
  const id = a.mine[0].id;
  g.gs.takeSwap('김민수', '0123', id);
  g.gs.cancelRequest('김민수', '0123', id);
  assert.equal(g.gs.getRequests('김민수', '0123').swaps.length, 1, '다시 대타 목록에 떠요');
  g.gs.cancelRequest('이지은', '', id);
  assert.equal(g.gs.getRequests('김민수', '0123').swaps.length, 0);
  assert.throws(() => g.gs.takeSwap('김민수', '0123', id), /끝난 요청/);
});

test('오늘 대타가 승인되면 이미 찍은 출근 기록의 예정 시간도 바뀌어요', () => {
  const g = fresh();
  g.setKst('2026-11-16 09:00');
  const a = req(g, '이지은', '', 'swap', { date: '2026-11-16' }); // 월 12:00-21:00
  g.gs.takeSwap('김민수', '0123', a.mine[0].id);
  g.setKst('2026-11-16 10:00');
  punch(g, '김민수', '0123', 'in');
  g.gs.adminRequest('777777', a.mine[0].id, true);
  const row = g.sheet('출퇴근기록').rowDisplay(2);
  assert.deepEqual(row.slice(2, 6), ['김민수', '10:00', '21:00', '10:00']);
  g.setKst('2026-11-16 20:00');
  assert.equal(punch(g, '김민수', '0123', 'out').early, 60, '바뀐 퇴근 예정(21:00) 기준으로 조퇴 계산');
});

test('텔레그램: 토큰 저장 → 연결 확인 → 알림이 텔레그램으로, 끊기면 메일로', () => {
  const g = fresh({ email: 'owner@example.com' });
  assert.throws(() => g.gs.adminTelegram('777777', 'abc'), /토큰 모양/);
  assert.throws(() => g.gs.adminTelegram('777777', '123456789:' + 'x'.repeat(32) + 'BAD'), /텔레그램 오류: Unauthorized/);
  const TOKEN = '123456789:' + 'A'.repeat(35);
  const r = g.gs.adminTelegram('777777', TOKEN);
  assert.equal(r.bot, 'goodphone_test_bot');
  assert.equal(r.info.tg, '토큰만');

  assert.throws(() => g.gs.adminTelegramLink('777777'), /봇에게 온 메시지가 없어요/);
  g.tg.updates.push({ update_id: 1, message: { chat: { id: 555111, type: 'private' }, text: 'hi' } });
  const info = g.gs.adminTelegramLink('777777');
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

  g.gs.adminTelegramOff('777777');
  assert.equal(g.gs.adminToday('777777').info.tg, '');
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
  g.gs.punch({ name: '예시직원', pin: '1234', type: 'in' });
  const log = g.sheet('출퇴근기록');
  log.getRange(2, 6).setValue('10:05');
  g.gs.sheetEdited({ range: log.getRange(2, 6) });
  assert.equal(log.rowDisplay(2)[7], '5');
});

test('같은 순간에 보낸 요청도 번호가 겹치지 않아요', () => {
  const g = fresh();
  g.setKst('2026-11-16 15:00');
  for (const d of ['17', '18', '19', '20']) req(g, '김민수', '0123', 'off', { date: `2026-11-${d}`, reason: '개인' });
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
  g.gs.setSetting_('관리자PIN', '777777');
  g.gs.adminSetPlace('777777', 37.5665, 126.978);
  g.setKst('2026-11-16 10:02');
  assert.equal(g.gs.punch({ name: '예시직원', pin: '1234', type: 'in', ...NEAR, device: 'dddddddddddddddd', label: 'x' }).late, 2);
});

test('원본(Code.gs)은 HTML 파일을 그대로 써요', () => {
  const g = createGas({ now: 0 });
  assert.equal(g.gs.doGet({ parameter: { page: 'admin' } }).file, 'Admin');
  assert.equal(g.gs.doGet({}).file, 'Index');
});
