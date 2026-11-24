// 퇴사 사유와 근로자 명부: [인사] '퇴사 사유' 칸, 퇴사 처리 때 사유(꼭), 직원 퇴사 신청 → 사장님 승인, [근로자 명부 만들기]
// 실행: node --test attendance/test/f8-retire-reason-roster.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const { createGas } = require('./gas-mock');

// 스크립트 안에서 만든 배열·객체를 평범한 값으로 바꿔서 비교해요
const plain = (x) => JSON.parse(JSON.stringify(x));
const ADMIN = '582941';
const MGR = { name: '박점장', pin: '246813' };
const TOKEN = '123456789:' + 'A'.repeat(35);
const PIN = { 김민우: '0123', 이지은: '5678', 박점장: '246813', 최유나: '1357' };
const ROW = { 김민우: 2, 이지은: 3, 박퇴사: 4, 박점장: 5, 최유나: 6 };
// 가짜 주민번호(성별 숫자: 1·3·5·7 남, 2·4·6·8 여 / 3·4·7·8은 2000년대생)
const RRN = { 김민우: '9501011234567', 이지은: '0203154123456', 박점장: '8807072345678', 최유나: '9912316123456' };

// 인사 정보를 다 넣은 상태로(입사일 2020-01-01)
function hrFill(g) {
  for (const n of Object.keys(RRN)) {
    g.gs.MEMO_ = {};
    if (!g.gs.hrFind_(n)) g.gs.syncHr_();
    const h = g.gs.hrFind_(n);
    g.gs.hrWrite_(h.row, {
      rrn: g.gs.rrnMask_(RRN[n]), enc: g.gs.rrnEncrypt_(RRN[n]), phone: '010-1000-' + (1000 + h.row), addr: '서울 성동구 ' + n, bank: '국민',
      account: '123456-78-' + (900000 + h.row), emergency: '010-9999-8888 가족', start: '2020-01-01',
    });
  }
  g.gs.MEMO_ = {};
}

// 2026-11-16(월) 09:00
// 왕십리(10:00-20:00, 점장 박점장): 김민우(토·일 휴무), 박점장 · 가산(12:00-21:00, 점장 없음): 이지은(수·일 휴무), 최유나 · 박퇴사: 재직 X
function world() {
  const g = createGas({ now: Date.parse('2026-11-16T09:00:00+09:00') });
  g.gs.setup();
  g.sheet('매장').getRange(2, 1, 2, 7).setValues([
    ['왕십리', '10:00', '20:00', '', '', '', ''],
    ['가산', '12:00', '21:00', '', '', '', ''],
  ]);
  g.sheet('매장').getRange(2, 8).setValue('박점장');
  //  이름 매장 PIN 시급 월 화 수 목 금 토 일 재직 등록폰 새폰요청
  g.sheet('직원').getRange(2, 1, 5, 14).setValues([
    ['김민우', '왕십리', PIN.김민우, 12000, '', '', '', '', '', '휴무', '휴무', '', '', ''],
    ['이지은', '가산', PIN.이지은, 10320, '', '', '휴무', '', '', '', '휴무', '', '', ''],
    ['박퇴사', '왕십리', '9999', 10320, '', '', '', '', '', '', '', 'X', '', ''],
    ['박점장', '왕십리', PIN.박점장, 12000, '', '', '', '', '', '', '', '', '', ''],
    ['최유나', '가산', PIN.최유나, 10320, '', '', '', '', '', '', '', '', '', ''],
  ]);
  g.gs.setSetting_('관리자PIN', ADMIN);
  g.gs.setSetting_('앱시작일', '2026-01-01');
  g.gs.setSetting_('위치확인', '안함');
  g.gs.setup(); // 새 직원 줄을 휴무표에
  hrFill(g);
  return g;
}
const reset = (g) => { g.gs.MEMO_ = {}; g.gs.GRID_ = {}; };
const hr = (g, name) => { reset(g); return g.gs.hrFind_(name); };
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
const req = (g, name, kind, extra = {}) => g.gs.makeRequest({ name, pin: PIN[name], kind, ...extra });
const reqRows = (g) => {
  const sh = g.sheet('요청');
  const out = [];
  for (let r = 2; r <= sh.getLastRow(); r++) out.push(sh.rowDisplay(r));
  return out;
};
const lastReq = (g, name) => { reset(g); return g.gs.readReqsNow_().filter((r) => r.name === name).pop(); };
// 텔레그램: 사장님 채팅 555, 직원 채팅은 chats = {이름: 번호}
const tgOn = (g, chats = {}) => {
  g.gs.setSetting_('텔레그램토큰', TOKEN);
  g.gs.setSetting_('텔레그램채팅ID', '555');
  g.gs.setSetting_('텔레그램봇', 'goodphone_test_bot');
  for (const [n, id] of Object.entries(chats)) g.gs.setStaffCell_(ROW[n], '텔레그램', id);
};
const sentTo = (g, chat) => g.tg.sent.filter((m) => String(m.chat_id) === String(chat)).map((m) => m.text);
const sheetRows = (sh) => { const out = []; for (let r = 1; r <= sh.getLastRow(); r++) out.push(sh.rowDisplay(r)); return out; };

test('[인사] 퇴사 사유 칸: 새 시트는 맨 끝에 있고, 예전 [인사] 탭에는 setup이 오른쪽 끝에 붙여요', () => {
  const g = world();
  const head = g.sheet('인사').rowDisplay(1);
  const at = head.indexOf('퇴사 사유');
  assert.equal(at, head.length - 3, 'HR_HEAD 맨 끝(뒤에 수습 끝·계약 끝)');
  assert.deepEqual(head.slice(-2), ['수습 끝', '계약 끝']);
  assert.match(g.sheet('인사').notes['1,' + (at + 1)], /자진 퇴사 \/ 계약 만료 \/ 권고사직 \/ 해고 \/ 기타/);
  g.gs.hrWrite_(hr(g, '김민우').row, { reason: '계약 만료' });
  assert.equal(hr(g, '김민우').reason, '계약 만료');
  assert.equal(hrRow(g, '김민우')['퇴사 사유'], '계약 만료');

  // 예전 [인사] 탭(퇴사 사유 칸 없음): setup이 오른쪽 끝에 붙이고 다른 칸은 그대로예요. 다시 해도 한 칸
  const o = createGas({ now: Date.parse('2026-11-16T09:00:00+09:00') });
  const old = ['이름', '지점', '상태', '입사일', '첫 지점', '이동 기록', '퇴사일', '주민번호', '휴대폰', '휴대폰2', '주소', '은행', '계좌번호', '예금주', '비상연락처', '비고', '입사 서류', '퇴사 정리', '등록', '주민번호(암호)', '가입(임시)'];
  const sh = o.book.insertSheet('인사');
  sh.getRange(1, 1, 2, old.length).setNumberFormat('@').setValues([old, ['한예전', '왕십리', '퇴사', '2024-01-02', '왕십리', '', '2025-03-31', '', '', '', '', '', '', '', '', '메모', '', '', '', '', '']]);
  o.gs.setup();
  const h2 = sh.rowDisplay(1);
  assert.equal(h2.indexOf('퇴사 사유'), old.length, '오른쪽 끝에');
  assert.equal(sh.rowDisplay(2)[15], '메모', '있던 값은 그대로');
  o.gs.setup();
  assert.equal(sh.rowDisplay(1).filter((x) => x === '퇴사 사유').length, 1);
});

test('퇴사 사유 맞추기: 띄어쓰기가 달라도 알아보고, 기타는 자세히가 꼭 있어야 해요. 목록에 없는 글은 기타로 봐요', () => {
  const { gs } = world();
  const w = (v) => gs.retireWhy_(v);
  assert.equal(w(''), '');
  assert.equal(w(null), '');
  assert.equal(w('자진퇴사'), '자진 퇴사');
  assert.equal(w('  계약  만료 '), '계약 만료');
  assert.equal(w('권고 사직'), '권고사직');
  assert.equal(w('해고'), '해고');
  assert.equal(w('기타 (가족 사정으로 이사)'), '기타 (가족 사정으로 이사)');
  assert.equal(w('기타: 가족 이사'), '기타 (가족 이사)');
  assert.equal(w('자진 퇴사 (본인 신청 11/21)'), '자진 퇴사 (본인 신청 11/21)', '여러 번 맞춰도 그대로');
  assert.equal(w(w('기타 (가족 (이사))')), '기타 (가족 (이사))');
  assert.equal(w('학업'), '기타 (학업)');
  assert.equal(w('해고당함'), '기타 (해고당함)', '분류 이름 뒤에 다른 글자가 붙으면 그 글 그대로 기타');
  assert.equal(w('기타 ' + '가'.repeat(60)), '기타 (' + '가'.repeat(40) + ')', '자세히는 40자까지');
  assert.throws(() => w('기타'), /기타를 고르면 퇴사 사유를 짧게 적어주세요/);
  assert.throws(() => w('기타 ()'), /기타를 고르면/);
  assert.equal(gs.whyKind_('자진 퇴사 (본인 신청 11/21)'), '자진 퇴사');
  assert.equal(gs.whyKind_('권고사직'), '권고사직');
  assert.equal(gs.whyKind_('그냥 그만둠'), '기타', '시트에 직접 적은 글');
  assert.equal(gs.whyKind_(''), '');
});

test('퇴사 처리: 근무 중인 사람은 사유를 꼭 골라야 하고, 퇴사 예정·바로 퇴사 모두 [인사] 퇴사 사유에 적혀요. 점장 알림에는 사유를 안 적어요', () => {
  const g = world();
  tgOn(g, { 박점장: '9005' });
  assert.throws(() => g.gs.adminRetire(ADMIN, '김민우', '2026-11-30'), /퇴사 사유를 골라주세요/);
  assert.throws(() => g.gs.adminRetire(ADMIN, '김민우', '2026-11-30', ''), /퇴사 사유를 골라주세요/);
  assert.throws(() => g.gs.adminRetire(ADMIN, '김민우', '2026-11-30', '기타'), /기타를 고르면/);
  assert.equal(hr(g, '김민우').end, '', '막혔을 때는 아무것도 안 바뀌어요');
  assert.throws(() => g.gs.adminRetire(MGR, '김민우', '2026-11-30', '해고'), /관리자\(사장님\)만/, '점장은 퇴사 처리 못 해요');

  // 퇴사 예정(앞날)
  let c = plain(g.gs.adminRetire(ADMIN, '김민우', '2026-11-30', '권고사직'));
  assert.equal(c.leaving, true);
  assert.equal(c.reason, '권고사직');
  assert.match(c.note, /11\/30\(월\)까지 근무하고 다음 날 자동으로 퇴사 처리돼요/);
  assert.equal(hrRow(g, '김민우')['퇴사 사유'], '권고사직');
  const toMgr = sentTo(g, 9005).filter((t) => /퇴사 예정/.test(t));
  assert.equal(toMgr.length, 1);
  assert.match(toMgr[0], /\[왕십리\] 김민우 님이 11\/30\(월\)까지 일하고 퇴사해요/);
  assert.doesNotMatch(toMgr[0], /권고사직/, '점장에게는 이름·지점·날짜만');
  // 날짜만 바꾸면(사유를 안 보내면) 적어 둔 사유 그대로, 다른 분류를 고르면 바뀌어요
  c = plain(g.gs.adminRetire(ADMIN, '김민우', '2026-12-05'));
  assert.equal(c.end, '2026-12-05');
  assert.equal(c.reason, '권고사직');
  c = plain(g.gs.adminRetire(ADMIN, '김민우', '2026-12-05', '기타 (본사 발령)'));
  assert.equal(c.reason, '기타 (본사 발령)');
  // 지난 날짜: 바로 퇴사
  c = plain(g.gs.adminRetire(ADMIN, '이지은', '2026-11-13', '해고'));
  assert.equal(c.state, '퇴사');
  assert.equal(c.reason, '해고');
  assert.equal(hrRow(g, '이지은')['퇴사 사유'], '해고');
  reset(g);
  assert.equal(g.gs.findStaff_('이지은').active, false);
  // [인사]에 줄이 없던 직원도(시트에 바로 적은 사람) 사유와 함께 줄이 생겨요
  g.sheet('직원').getRange(7, 1, 1, 4).setValues([['정새줄', '가산', '2468', 10320]]);
  const sh = g.sheet('인사');
  for (let r = 2; r <= sh.getLastRow(); r++) if (sh.rowDisplay(r)[0] === '정새줄') sh.deleteRow(r);
  reset(g);
  assert.equal(g.gs.hrFind_('정새줄'), null);
  g.gs.adminRetire(ADMIN, '정새줄', '2026-11-12', '계약 만료');
  assert.equal(hrRow(g, '정새줄')['상태'], '퇴사');
  assert.equal(hrRow(g, '정새줄')['퇴사 사유'], '계약 만료');
});

test('퇴사 사유: 같은 분류를 다시 고르면 자세한 내용(본인 신청 날짜)은 그대로, 자동 퇴사 처리도 사유를 지키고, 퇴사 취소·다시 근무는 사유를 지워요', () => {
  const g = world();
  g.gs.adminRetire(ADMIN, '김민우', '2026-11-16', '자진 퇴사 (본인 신청 11/10)');
  assert.equal(hr(g, '김민우').reason, '자진 퇴사 (본인 신청 11/10)');
  g.gs.adminRetire(ADMIN, '김민우', '2026-11-20', '자진 퇴사'); // 화면은 분류만 보내요
  assert.equal(hr(g, '김민우').reason, '자진 퇴사 (본인 신청 11/10)', '같은 분류: 자세한 내용 그대로');
  g.gs.adminRetire(ADMIN, '김민우', '2026-11-16', '계약 만료');
  assert.equal(hr(g, '김민우').reason, '계약 만료');
  // 다음 날 새벽 자동 퇴사: 적어 둔 사유 그대로
  g.setKst('2026-11-17 06:00');
  reset(g);
  assert.equal(g.gs.retireDue_(g.gs.settings_(), g.gs.nowKst_()), 1);
  assert.equal(hrRow(g, '김민우')['상태'], '퇴사');
  assert.equal(hrRow(g, '김민우')['퇴사 사유'], '계약 만료');
  // 퇴사 취소(다시 근무): 퇴사일과 함께 사유도 지워요
  let c = plain(g.gs.adminUnretire(ADMIN, '김민우'));
  assert.equal(c.state, '근무');
  assert.equal(c.reason, '');
  assert.equal(hrRow(g, '김민우')['퇴사 사유'], '');
  // 퇴사 예정 취소도
  g.gs.adminRetire(ADMIN, '최유나', '2026-11-30', '계약 만료');
  c = plain(g.gs.adminUnretire(ADMIN, '최유나'));
  assert.equal(c.leaving, false);
  assert.equal(hrRow(g, '최유나')['퇴사 사유'], '');
  // 시트 [인사] 상태를 손으로 '근무'로 되돌려 다시 근무해도
  g.gs.adminRetire(ADMIN, '이지은', '2026-11-13', '해고');
  const hs = g.sheet('인사'), cState = hs.rowDisplay(1).indexOf('상태') + 1, rJ = hr(g, '이지은').row;
  hs.getRange(rJ, cState).setValue('근무');
  g.gs.onEdit({ range: hs.getRange(rJ, cState) });
  reset(g);
  assert.equal(g.gs.findStaff_('이지은').active, true);
  assert.equal(hrRow(g, '이지은')['상태'], '근무');
  assert.equal(hrRow(g, '이지은')['퇴사 사유'], '');
  assert.match(hrRow(g, '이지은')['이동 기록'], /다시 근무\(퇴사 2026-11-13\)/);
  // 인사 카드: 근무 중이고 퇴사 예정이 없으면 시트에 남은 글이 있어도 사유를 안 보여줘요
  g.gs.hrWrite_(hr(g, '최유나').row, { reason: '예전에 적은 글' });
  assert.equal(plain(g.gs.adminHrGet(ADMIN, '최유나')).reason, '');
  // 다시 입사(입사 등록 → 승인): 예전 퇴사 사유는 지워지고, 예전에 다닌 기간은 이동 기록에 남아요
  g.gs.adminRetire(ADMIN, '최유나', '2026-11-10', '계약 만료');
  g.gs.joinSubmit({
    name: '최유나', rrn: '991231-6123456', phone: '01012345678', addr: '서울 성동구', bank: '국민', account: '123456-78-901234', holder: '',
    emergency: '010-9999-8888 어머니', store: '가산', start: '2026-11-16', pin: '4826', device: 'f6f6f6f6f6f6f6f6', label: 'Galaxy 크롬', agree: true, agreeLoc: true,
  });
  g.gs.adminJoin(ADMIN, '최유나', true);
  assert.equal(hrRow(g, '최유나')['상태'], '근무');
  assert.equal(hrRow(g, '최유나')['퇴사일'], '');
  assert.equal(hrRow(g, '최유나')['퇴사 사유'], '');
  assert.match(hrRow(g, '최유나')['이동 기록'], /2020-01-01~2026-11-10 가산 근무\(계약 만료\), 2026-11-16 다시 입사\(가산\)/, '예전 퇴사 사유는 이동 기록에 남아요(근로자 명부 이력)');
});

test('이미 퇴사한 사람: 날짜 없이 사유만 고칠 수 있고(마감한 달이어도), 날짜를 고치면서 사유도 바꿔요. 예전 막는 말은 그대로예요', () => {
  const g = world();
  // 박퇴사: 시트에 재직 X로만 적힌 퇴사자(퇴사일·사유 없음)
  assert.equal(hr(g, '박퇴사').state, '퇴사');
  assert.throws(() => g.gs.adminRetire(ADMIN, '박퇴사'), /이미 퇴사 처리된 직원이에요\. 마지막 근무일을 고치려면 날짜를 골라주세요/);
  let c = plain(g.gs.adminRetire(ADMIN, '박퇴사', '', '기타 (연락이 끊김)'));
  assert.equal(c.note, '퇴사 사유를 기타 (연락이 끊김)(으)로 적었어요.');
  assert.equal(c.reason, '기타 (연락이 끊김)');
  assert.equal(c.end, '', '날짜는 그대로');
  assert.throws(() => g.gs.adminRetire(ADMIN, '박퇴사', '', '기타 (연락이 끊김)'), /이미 퇴사 사유가 기타 \(연락이 끊김\)\(으\)로 적혀 있어요/);
  c = plain(g.gs.adminRetire(ADMIN, '박퇴사', '2026-11-10', '자진 퇴사'));
  assert.equal(c.end, '2026-11-10');
  assert.equal(c.reason, '자진 퇴사');
  assert.match(c.note, /마지막 근무일을 11\/10\(화\)\(으\)로 적었어요\. 퇴사 사유는 자진 퇴사\(이\)에요/);
  c = plain(g.gs.adminRetire(ADMIN, '박퇴사', '2026-11-12'));
  assert.equal(c.end, '2026-11-12');
  assert.equal(c.reason, '자진 퇴사', '날짜만 고치면 사유 그대로');
  assert.doesNotMatch(c.note, /퇴사 사유는/);
  assert.throws(() => g.gs.adminRetire(ADMIN, '박퇴사', '2026-11-12'), /이미 11\/12\(목\)로 적혀 있어요/);
  c = plain(g.gs.adminRetire(ADMIN, '박퇴사', '2026-11-12', '권고사직'), '적힌 날짜 그대로 + 새 사유 = 사유만 고치기');
  assert.equal(c.reason, '권고사직');
  assert.equal(c.end, '2026-11-12');
  assert.throws(() => g.gs.adminRetire(ADMIN, '박퇴사', '', '기타'), /기타를 고르면/);

  // 마감한 달: 사유만 고치는 건 돼요(휴무표를 안 건드려요). 날짜를 그 달로 고치는 건 막혀요
  g.gs.adminRetire(ADMIN, '이지은', '2026-10-30', '자진 퇴사');
  g.gs.PropertiesService.getScriptProperties().setProperty('monthClosed', JSON.stringify({ '2026-10': '2026-11-02 마감' }));
  reset(g);
  c = plain(g.gs.adminRetire(ADMIN, '이지은', '', '계약 만료'));
  assert.equal(c.reason, '계약 만료');
  c = plain(g.gs.adminRetire(ADMIN, '이지은', '2026-10-30', '해고'));
  assert.equal(c.reason, '해고');
  assert.equal(c.end, '2026-10-30');
  assert.throws(() => g.gs.adminRetire(ADMIN, '이지은', '2026-10-29'), /10월은 마감한 달/);
  assert.throws(() => g.gs.adminRetire(ADMIN, '최유나', '2026-10-29', '해고'), /10월은 마감한 달/, '근무 중인 사람의 지난 날짜도 그대로 막혀요');
});

test('직원 퇴사 신청: 마지막 근무일은 오늘부터 60일 안, 이유는 꼭. 이미 퇴사 예정이거나 보낸 신청이 있으면 막고, 점장이 먼저 봐요', () => {
  const g = world();
  tgOn(g, { 박점장: '9005', 김민우: '9002' });
  assert.throws(() => req(g, '김민우', 'quit', { date: '2026-11-15', reason: '학업' }), /오늘부터 60일 안/);
  assert.throws(() => req(g, '김민우', 'quit', { date: '2027-01-16', reason: '학업' }), /오늘부터 60일 안/);
  assert.throws(() => req(g, '김민우', 'quit', { date: '2026-12-15', reason: ' ' }), /그만두는 이유를 적어주세요/);
  assert.throws(() => req(g, '김민우', 'quit', { date: '', reason: '학업' }), /날짜를 골라주세요/);
  assert.throws(() => g.gs.makeRequest({ name: '김민우', pin: '9999', kind: 'quit', date: '2026-12-15', reason: '학업' }), /비밀번호가 틀렸어요/);
  assert.equal(reqRows(g).length, 0);

  const d = plain(req(g, '김민우', 'quit', { date: '2026-12-15', reason: '학업', to: 'mgr' }));
  const row = reqRows(g)[0];
  assert.equal(row[1], '2026-11-16 09:00', '요청일시(보낸 때)가 남아요');
  assert.deepEqual([row[2], row[3], row[4], row[5], row[6], row[7], row[10]], ['김민우', '퇴사', '2026-12-15', '마지막 근무일', '학업', '대기', '점장']);
  assert.deepEqual([d.mine[0].kind, d.mine[0].what, d.mine[0].reason, d.mine[0].state], ['퇴사', '마지막 근무일', '학업', '대기'], '내 요청 목록에 보여요');
  const m = sentTo(g, 9005).at(-1);
  assert.match(m, /\[왕십리\] 김민우 · 퇴사 요청/);
  assert.match(m, /12\/15\(화\) 마지막 근무일로 퇴사/);
  assert.match(m, /사유: 학업/);
  assert.equal(sentTo(g, 555).length, 0, '사장님께는 점장이 올리면 가요');
  assert.throws(() => req(g, '김민우', 'quit', { date: '2026-12-20', reason: '학업' }), /퇴사 신청을 이미 보냈어요\(12\/15\(화\)까지 근무\)/);
  assert.ok(req(g, '김민우', 'off', { date: '2026-11-18', reason: '병원' }), '다른 요청은 그대로 보낼 수 있어요');
  // 취소하면 다시 보낼 수 있어요
  g.gs.cancelRequest('김민우', PIN.김민우, lastReq(g, '김민우').id); // 휴무 요청
  g.gs.cancelRequest('김민우', PIN.김민우, reqRows(g)[0][0]);
  req(g, '김민우', 'quit', { date: '2027-01-15', reason: '이사' }); // 60일째 날까지 돼요
  assert.equal(lastReq(g, '김민우').date, '2027-01-15');

  // 이미 퇴사 예정이면 막아요(사장님이 정한 날짜)
  g.gs.adminRetire(ADMIN, '이지은', '2026-11-30', '계약 만료');
  assert.throws(() => req(g, '이지은', 'quit', { date: '2026-12-10', reason: '학업' }), /이미 퇴사 예정이에요\(11\/30\(월\)까지 근무\)/);
});

test('퇴사 신청 결재: 점장이 올리고 사장님이 승인하면 퇴사 예정(자진 퇴사 · 본인 신청 날짜). 직원·점장에게 알리고, 다음 날 자동 퇴사', () => {
  const g = world();
  tgOn(g, { 박점장: '9005', 김민우: '9002' });
  req(g, '김민우', 'quit', { date: '2026-12-15', reason: '학업' });
  const id = reqRows(g)[0][0];
  // 점장 화면: 우리 매장 퇴사 신청이 보이고 [관리자에게 올리기]
  let mine = plain(g.gs.adminToday(MGR).requests);
  assert.deepEqual(mine.map((q) => [q.name, q.kind, q.route]), [['김민우', '퇴사', '점장']]);
  assert.equal(mine[0].at, '2026-11-16 09:00');
  assert.throws(() => g.gs.adminRequest(MGR, id, true), /관리자\(사장님\)만/, '승인은 사장님만');
  g.setKst('2026-11-16 15:00');
  g.gs.mgrForward(MGR, id, '확인했어요');
  assert.match(sentTo(g, 555).at(-1), /김민우 · 퇴사 요청 \(점장 확인\)/);
  assert.match(sentTo(g, 555).at(-1), /12\/15\(화\) 마지막 근무일로 퇴사/);
  assert.match(sentTo(g, 555).at(-1), /점장 박점장: 확인했어요/);
  mine = plain(g.gs.adminToday(MGR).requests);
  assert.equal(mine.length, 1, '점장이 올린 건 계속 보여요(관리자 승인 대기)');
  // 사장님 승인
  const before = g.tg.sent.length;
  g.gs.adminRequest(ADMIN, id, true);
  const h = hr(g, '김민우');
  assert.equal(h.state, '근무', '아직 근무(퇴사 예정)');
  assert.equal(h.end, '2026-12-15');
  assert.equal(h.reason, '자진 퇴사 (본인 신청 11/16)');
  const row = reqRows(g)[0];
  assert.equal(row[1], '2026-11-16 09:00', '보낸 때는 그대로(증거)');
  assert.equal(row[7], '승인');
  assert.match(row[9], /^2026-11-16 15:00/);
  const after = g.tg.sent.slice(before).map((x) => x.text);
  assert.ok(after.some((t) => /퇴사 요청이 승인됐어요/.test(t) && /12\/15\(화\) 마지막 근무일로 퇴사/.test(t)), '직원에게');
  const mgrMsg = sentTo(g, 9005).filter((t) => /퇴사 예정/.test(t));
  assert.equal(mgrMsg.length, 1, '점장에게(퇴사 예정)');
  assert.match(mgrMsg[0], /\[왕십리\] 김민우 님이 12\/15\(화\)까지 일하고 퇴사해요/);
  assert.doesNotMatch(mgrMsg[0], /학업|자진/, '점장 알림에 사유는 안 적어요');
  assert.equal(plain(g.gs.adminHrGet(ADMIN, '김민우')).reason, '자진 퇴사 (본인 신청 11/16)');
  // 다음 날 자동 퇴사
  g.setKst('2026-12-16 06:00');
  reset(g);
  assert.equal(g.gs.retireDue_(g.gs.settings_(), g.gs.nowKst_()), 1);
  assert.equal(hrRow(g, '김민우')['상태'], '퇴사');
  assert.equal(hrRow(g, '김민우')['퇴사 사유'], '자진 퇴사 (본인 신청 11/16)');
});

test('퇴사 신청: 관리자에게 바로 보내면 점장에게 안 보여요. 날짜가 지나서 승인하면 바로 퇴사, 거절·돌려보냄은 그대로, 이미 퇴사 예정이면 카드에 알려요', () => {
  const g = world();
  tgOn(g, { 박점장: '9005', 김민우: '9002', 최유나: '9006' });
  // 관리자에게 바로: 점장 화면에는 안 보이고, 사장님께 바로 가요
  req(g, '김민우', 'quit', { date: '2026-12-01', reason: '개인 사정', to: 'admin' });
  assert.equal(lastReq(g, '김민우').route, '관리자');
  assert.match(sentTo(g, 555).at(-1), /\[왕십리\] 김민우 · 퇴사 요청/);
  assert.equal(sentTo(g, 9005).length, 0, '점장에게는 안 가요');
  assert.deepEqual(plain(g.gs.adminToday(MGR).requests), [], '점장 화면에도 안 보여요');
  assert.equal(plain(g.gs.adminToday(ADMIN).requests).filter((q) => q.kind === '퇴사').length, 1);
  // 거절: 아무것도 안 바뀌어요
  g.gs.adminRequest(ADMIN, lastReq(g, '김민우').id, false);
  assert.equal(hr(g, '김민우').end, '');
  assert.equal(lastReq(g, '김민우').state, '거절');
  assert.match(sentTo(g, 9002).at(-1), /퇴사 요청이 거절됐어요/);
  // 점장이 돌려보내면 직원에게 이유가 가요
  req(g, '김민우', 'quit', { date: '2026-12-01', reason: '개인 사정' });
  g.gs.mgrReturn(MGR, lastReq(g, '김민우').id, '면담 먼저 해요');
  assert.match(sentTo(g, 9002).at(-1), /퇴사 요청을 점장이 돌려보냈어요[\s\S]*면담 먼저 해요/);

  // 최유나(가산, 점장 없음): 사장님께 바로. 마지막 근무일이 지난 뒤 승인하면 바로 퇴사 처리(요청은 승인으로 남아요)
  req(g, '최유나', 'quit', { date: '2026-11-18', reason: '이사' });
  g.setKst('2026-11-20 10:00');
  const yid = lastReq(g, '최유나').id;
  assert.ok(plain(g.gs.adminToday(ADMIN).requests).find((q) => q.id === yid).past, '지난 날짜라고 보여요');
  g.gs.adminRequest(ADMIN, yid, true);
  assert.equal(hrRow(g, '최유나')['상태'], '퇴사');
  assert.equal(hrRow(g, '최유나')['퇴사일'], '2026-11-18');
  assert.equal(hrRow(g, '최유나')['퇴사 사유'], '자진 퇴사 (본인 신청 11/16)');
  assert.equal(lastReq(g, '최유나').state, '승인');
  assert.match(sentTo(g, 9006).at(-1), /퇴사 요청이 승인됐어요/);

  // 신청 뒤에 사장님이 다른 날로 퇴사 예정을 정했으면: 카드에 알리고, 승인하면 신청한 날·자진 퇴사로 바뀌어요
  req(g, '박점장', 'quit', { date: '2026-12-20', reason: '창업' });
  const pid = lastReq(g, '박점장').id;
  assert.equal(lastReq(g, '박점장').route, '관리자', '점장 본인은 사장님께 바로');
  g.gs.adminRetire(ADMIN, '박점장', '2026-12-31', '계약 만료');
  const card = plain(g.gs.adminToday(ADMIN).requests).find((q) => q.id === pid);
  assert.equal(card.note, '이미 12/31(목)까지 근무하는 퇴사 예정이 있어요. 승인하면 12/20(일)까지로 바뀌어요.');
  g.gs.adminRequest(ADMIN, pid, true);
  assert.equal(hr(g, '박점장').end, '2026-12-20');
  assert.equal(hr(g, '박점장').reason, '자진 퇴사 (본인 신청 11/20)');

  // 그사이 [직원]에서 퇴사로 바뀐 사람: 승인하지 않고 거절하라고 알려요
  req(g, '김민우', 'quit', { date: '2026-12-01', reason: '개인 사정', to: 'admin' });
  const kid = lastReq(g, '김민우').id;
  g.sheet('직원').getRange(ROW.김민우, g.gs.staffCols_()['재직'] + 1).setValue('퇴사');
  reset(g);
  assert.throws(() => g.gs.adminRequest(ADMIN, kid, true), /김민우 님은 이미 퇴사 처리됐어요\. 이 요청은 거절해 주세요/);
  assert.equal(lastReq(g, '김민우').state, '대기', '승인되지 않았어요');
});

test('밤 마감: 마지막 근무일로 퇴사 신청만 해 두고 안 나온 날은 결근?으로 적혀요(휴무 요청처럼 기다리지 않아요)', () => {
  const g = world();
  req(g, '김민우', 'quit', { date: '2026-11-16', reason: '개인 사정' }); // 오늘(월) 10:00-20:00 근무인데 안 나왔어요
  req(g, '박점장', 'off', { date: '2026-11-16', reason: '병원' }); // 견주기: 휴무 요청은 결과를 기다려요
  g.setKst('2026-11-16 23:40');
  reset(g);
  g.gs.dailyClose_(g.gs.settings_(), '2026-11-16');
  reset(g);
  assert.equal(g.gs.dayMark_('김민우', '2026-11-16'), '결근?');
  assert.equal(g.gs.dayMark_('박점장', '2026-11-16'), '', '휴무 요청을 보낸 사람은 처리 결과를 기다려요');
});

test('근로자 명부: 사장님만 만들고, 근무 중인 직원과 퇴사 3년 안의 퇴사자를 법에서 정한 칸으로 적어요. 계약 기간은 다시 만들어도 남아요', () => {
  const g = world();
  assert.throws(() => g.gs.adminRoster(MGR), /관리자\(사장님\)만/);
  assert.throws(() => g.gs.adminRoster('111111'), /관리자 비밀번호가 틀렸어요/);
  assert.equal(g.sheet('근로자 명부'), null, '막혔을 때는 탭을 안 만들어요');

  g.gs.adminMove(ADMIN, '김민우', '가산', '2026-11-16'); // 이동 기록: 2026-11-16 왕십리→가산
  g.gs.hrWrite_(hr(g, '김민우').row, { memo: '보건증 2027-01 만료' });
  g.gs.adminRetire(ADMIN, '이지은', '2026-11-13', '해고');
  g.gs.adminRetire(ADMIN, '최유나', '2026-12-31', '계약 만료'); // 퇴사 예정
  g.gs.hrWrite_(0, { name: '한오래', store: '왕십리', state: '퇴사', start: '2021-01-04', end: '2023-11-15', reason: '자진 퇴사' }); // 3년 넘음
  g.gs.hrWrite_(0, { name: '한경계', store: '가산', state: '퇴사', start: '2022-05-02', end: '2023-11-16' }); // 딱 3년(넣어요), 사유 없음
  g.gs.hrWrite_(0, { name: '한대기', store: '왕십리', state: '승인 대기', start: '2026-11-20' }); // 입사 승인 전
  reset(g);
  const r = plain(g.gs.adminRoster(ADMIN));
  assert.equal(r.name, '근로자 명부');
  assert.match(r.url, /#gid=\d+$/);
  assert.deepEqual([r.active, r.gone, r.people], [3, 3, 6]);
  const sh = g.sheet('근로자 명부');
  const rows = sheetRows(sh);
  assert.match(rows[0][0], /^근로자 명부 · 2026-11-16 기준 · 근무 3명 · 퇴사 3명\(퇴사일 3년 안\)/);
  assert.deepEqual(rows[1], ['성명', '성별', '생년월일', '주소', '이력', '종사 업무', '고용 연월일', '계약 기간', '그 밖의 고용 사항', '해고·퇴직 연월일', '해고·퇴직 사유']);
  assert.match(sh.notes['2,8'], /명부를 다시 만들어도 이 칸은 남아요/);
  // 근무 중(매장 순서: 왕십리 → 가산) → 퇴사자(최근 퇴사부터, 퇴사일이 빈 사람은 맨 아래)
  assert.deepEqual(rows.slice(2).map((x) => x[0]), ['박점장', '김민우', '최유나', '이지은', '한경계', '박퇴사']);
  const by = Object.fromEntries(rows.slice(2).map((x) => [x[0], x]));
  assert.deepEqual(by.김민우, ['김민우', '남', '1995-01-01', '서울 성동구 김민우', '2020-01-01 입사(왕십리) · 2026-11-16 왕십리→가산', '가산', '2020-01-01', '', '보건증 2027-01 만료', '', '']);
  assert.deepEqual(by.박점장.slice(1, 3), ['여', '1988-07-07']);
  assert.deepEqual(by.최유나.slice(1, 3), ['여', '1999-12-31'], '외국인 등록번호(6)도 1900년대 여성');
  assert.deepEqual(by.최유나.slice(9), ['2026-12-31 (예정)', '계약 만료']);
  assert.deepEqual(by.이지은.slice(1, 3), ['여', '2002-03-15'], '4 = 2000년대생 여성');
  assert.deepEqual(by.이지은.slice(5), ['가산', '2020-01-01', '', '', '2026-11-13', '해고']);
  assert.deepEqual(by.한경계.slice(9), ['2023-11-16', '']);
  assert.deepEqual(by.박퇴사.slice(1, 3), ['', ''], '주민번호가 없으면 비워요');
  assert.equal(by.박퇴사[9], '');
  assert.ok(!rows.some((x) => /한오래|한대기|예시직원/.test(x[0])), '3년 넘은 퇴사자·승인 대기·예시 직원은 빼요');
  // 주민번호·전화·계좌는 명부에 안 들어가요
  const cells = rows.flat().join('\n');
  assert.ok(!cells.includes('9501011234567') && !cells.includes('******') && !cells.includes('010-1000-') && !cells.includes('123456-78-'));
  assert.deepEqual(sh.filter.range, [2, 1, 7, 11], '머리글부터 거르기');
  assert.equal(r.warn.length, 3);
  assert.match(r.warn[0], /퇴사 사유가 빈 퇴사자 2명: 한경계, 박퇴사\. 인사 카드/);
  assert.match(r.warn[1], /퇴사일이 빈 퇴사자 1명도 넣었어요\(3년이 지났는지 몰라서\): 박퇴사/);
  assert.match(r.warn[2], /주민번호가 없어서 성별·생년월일이 빈 사람 2명: 한경계, 박퇴사/);

  // 사장님이 적은 계약 기간은 다시 만들어도 남아요(성명·고용 연월일이 같은 줄). 줄이 늘지 않아요
  const at = rows.findIndex((x) => x[0] === '최유나') + 1;
  sh.getRange(at, 8).setValue('2026-01-01 ~ 2026-12-31');
  g.gs.adminRetire(ADMIN, '박퇴사', '2026-11-10', '자진 퇴사');
  g.gs.adminRetire(ADMIN, '최유나', '2026-12-31'); // 날짜 그대로 다시 저장해도
  const r2 = plain(g.gs.adminRoster(ADMIN));
  const rows2 = sheetRows(sh);
  assert.equal(rows2.length, 8, '머리글 2줄 + 6명');
  const by2 = Object.fromEntries(rows2.slice(2).map((x) => [x[0], x]));
  assert.equal(by2.최유나[7], '2026-01-01 ~ 2026-12-31');
  assert.deepEqual(by2.박퇴사.slice(9), ['2026-11-10', '자진 퇴사']);
  assert.equal(r2.warn.length, 2, '박퇴사의 퇴사일·사유를 넣었더니 경고가 줄었어요');
  assert.equal(g.book.getSheets().filter((x) => x.getName() === '근로자 명부').length, 1, '탭은 하나');
});
