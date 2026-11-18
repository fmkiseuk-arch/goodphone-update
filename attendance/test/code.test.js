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
const punch = (g, name, pin, type, pos = NEAR) => g.gs.punch({ name, pin, type, lat: pos && pos.lat, lng: pos && pos.lng, acc: pos && pos.acc });

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
  const names = g.gs.getStaffList().staff.map((p) => p.name);
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
