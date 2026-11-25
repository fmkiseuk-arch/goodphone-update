/**
 * 굳폰 출퇴근 기록 (구글 시트 + Apps Script)
 * 설치 방법은 같은 폴더의 README.md를 보세요.
 *
 * 시트(탭)
 *  - 설정          : 상호, 관리자 비밀번호, 위치·폰 확인 방식, 지각 기준, 알림(텔레그램·메일), 휴무 고르기 규칙, 공휴일
 *  - 매장          : 매장마다 기본 출근·퇴근 시간, 위치, 점장, 휴무 규칙(하루 최대·한 달 최대)
 *  - 직원          : 이름, 매장, 비밀번호, 시급, 요일별 근무시간(사무실 등), 등록된 폰, 텔레그램
 *  - 휴무표 YYYY-MM: 달마다 한 장. 휴무·월차·반차를 적고, 지각 시간은 앱이 자동으로 적어요
 *  - 근무변경      : 특정 날짜만 근무시간이 다를 때 (대타 등)
 *  - 출퇴근기록 : 하루 한 줄씩 자동으로 쌓이는 기록
 *  - 의심기록   : 비밀번호 틀림, 매장 밖, 다른 폰 같은 거절된 시도
 *  - 요청       : 직원이 보낸 출퇴근 정정, 휴무, 대타 요청과 처리 결과 (직원 → 점장 → 관리자)
 *  - 대체휴무   : 쉬는 날·공휴일에 일해서 쌓인 대체휴무와 쓴 날
 */

/**
 * 시트에 붙인 스크립트(확장 프로그램 → Apps Script)면 비워 두세요.
 * 시트와 따로 만든 스크립트면 시트 주소의 /d/ 와 /edit 사이 글자를 넣어요. (자동 설치가 채워요)
 */
var SHEET_ID = '';

// 사장님이 앱을 시험해 볼 때 쓰는 직원 이름. 폰 등록·위치 확인을 안 하고, 월별·정산에서 빠지고,
// 사장님 화면 [설정] → 테스트 → [테스트 지우기]로 이 이름의 기록을 통째로 지워요
var TEST_NAME = '테스트';
var SHEETS = { set: '설정', store: '매장', staff: '직원', change: '근무변경', log: '출퇴근기록', suspect: '의심기록', req: '요청', sub: '대체휴무', hr: '인사' };
var MONTH_PREFIX = '휴무표 '; // 예전 휴무표 탭 이름 앞말('휴무표 2026-11'). 이제는 '26.11'처럼 짧게 만들고, 예전 탭은 이름을 바꿔요(monthRename_)
var RENAMED_ = false; // 이번 실행에서 예전 이름 탭을 바꿔 봤는지
var DOW = ['일', '월', '화', '수', '목', '금', '토'];

// [직원] 칸은 머리글 이름으로 찾아요. 칸 순서를 바꾸거나 칸을 더해도 돼요.
var STAFF_HEAD = ['이름', '매장', 'PIN', '시급', '월', '화', '수', '목', '금', '토', '일', '재직', '등록폰', '새폰요청', '동의', '텔레그램'];
// 너무 쉬워서 바꾸라고 알려줄 비밀번호
var EASY_PINS = ['0000', '1111', '2222', '3333', '4444', '5555', '6666', '7777', '8888', '9999', '1234', '4321', '0123', '1212', '1004', '2580'];
var STAFF_FMT = { '시급': '#,##0' }; // 나머지는 모두 글자(@)
// [매장] 칸도 머리글 이름으로 찾아요. 점장: 그 매장 점장 이름(여러 명이면 쉼표) · 최대휴무: 하루에 쉴 수 있는 사람 수(비우면 1, 0이면 제한 없음) · 월휴무: 한 달에 고를 수 있는 휴무 일수(비우면 제한 없음)
var STORE_HEAD = ['매장', '출근', '퇴근', '위도', '경도', '반경(m)', '메모', '점장', '최대휴무', '월휴무', '최소인원'];
// 최소인원: 그날 그 매장에서 일해야 하는 사람 수. 모자라면 밤 마감 정리(내일 것)·휴무 승인 카드에 알려요. 비우면 아무도 없을 때만, 0이면 안 알려요
// 휴무표 한 달 탭(새로 만들 때): A No · B 매장 · C 이름 · D 휴무 · E 월차 · F 이월 · G 부여 · H 잔여 · I 지각 · J 만근 · K~AO 1~31일 · AP 메모
// 읽고 쓸 때는 1행 머리글('이름', '11/1', '메모')로 칸을 찾아요. 다만 이월·부여 수식은 칸 위치(C·H칸)로 지난달을 읽어서,
// 날짜 칸 앞(A~J)에는 칸을 넣거나 지우지 말아야 해요(README에 적어 뒀어요). 칸을 더하려면 메모 칸 오른쪽에.
var MT = { no: 0, store: 1, name: 2, off: 3, used: 4, carry: 5, grant: 6, left: 7, late: 8, full: 9, day1: 10, memo: 41 };
/**
 * 월차: 그 달에 결근이 없으면 만근이고, 만근한 달 다음 달에 1개 생겨요(12월 만근분은 1월에). 해를 넘겨 이월은 안 돼요(1월 이월 0).
 * 만근을 깨는 건 결근(앱이 적는 '결근?', 무단)뿐이에요. 휴무·월차·반차·대체·무급·지각은 괜찮아요.
 * 사장님이 결근을 '무급'으로 바꿔 주면 만근이 돼요. 입사한 달도 입사일 뒤로 결근이 없으면 만근이에요(사장님: 월차는 넉넉하게).
 */
var FULL_BREAK = '결근|무단';
var AWAY_MARK = '휴직'; // 휴직 기간 칸에 적는 말. 이 말이 낀 달은 만근이 아니에요
var FULL_NOTE = '그 달에 결근(결근?·무단)이 없으면 만근이에요. 휴무·월차·반차·대체·무급·지각은 괜찮아요.\n' +
  '결근을 무급으로 바꿔 주면(사장님 승인) 만근이 돼요. 입사한 달도 입사일 뒤로 결근이 없으면 만근이에요.\n' +
  '달이 끝나기 전에는 "만근 예정"이에요. 만근이면 다음 달 부여에 월차 1개가 생겨요.';
var GRANT_NOTE = '전달이 만근이면 1이에요(12월 만근분은 1월에). 숫자를 직접 적으면 그 값을 써요(사장님 재량).';
var CARRY_NOTE = '지난달 잔여. 1월은 0이에요(해를 넘겨 이월 안 돼요).';
// 휴무표 칸에 이런 말이 있으면 그날은 쉬는 날(지각·미출근 안 봄)
// '대체'는 칸 전체가 '대체'일 때만(대체휴무 쓰는 날). '대체근무 12-21' 같은 건 근무로 봐요
var OFF_RE = /휴|쉼|월차|반차|무급|명절|추석|설날|여름|동원|예비군|출산|무단|퇴사|병가|경조|부고|기타|^\s*대체\s*$/;
// 직원이 신청할 수 있는 쉬는 날 종류. 대체 = 쌓아 둔 대체휴무를 쓰는 날
// 결근으로 적힌 칸: 앱이 밤에 적는 '결근?', 사장님이 적는 '결근'·'무단'·'무단결근'
var ABSENT_RE = /결근|무단/;
// 휴무 신청 종류. 승인되면 휴무표 그날 칸에 이 글자가 그대로 적혀요(휴가·병가·경조·예비군·기타는 쉬는 날로 보고 만근에는 상관없어요)
// 기타 = 위에 없는 사정(가족 일·이사 등). 사유를 꼭 적어요
var OFF_KINDS = ['휴무', '월차', '반차', '대체', '무급', '휴가', '병가', '경조', '예비군', '기타'];
var KIND_NAME = { '정정': '기록 정정', '휴무': '휴무', '월차': '월차', '반차': '반차', '대체': '대체휴무', '무급': '무급', '대타': '대타', '취소': '휴무 취소',
  '휴가': '휴가', '병가': '병가', '경조': '경조 휴가', '예비군': '예비군', '기타': '기타', '외근': '외근·교육', '바꾸기': '휴무 바꾸기', '퇴사': '퇴사',
  '조퇴': '조퇴', '외출': '외출' };
// 다음 달 휴무 고르기에서 고를 수 있는 종류. 휴무표에 '병가?'처럼 '?'를 붙여 적고, 사장님이 확정하면 '?'가 빠져요
var WISH_KINDS = ['휴무', '월차', '휴가', '병가', '경조', '예비군', '무급', '기타'];
var WISH_RE = /^(휴무|월차|휴가|병가|경조|예비군|무급|기타)\?$/;
// 사유를 휴무표 칸 메모('사유: …')에 남기는 종류(휴무·월차·반차·대체는 사유가 따로 필요 없어요)
var WHY_KINDS = ['휴가', '병가', '경조', '예비군', '무급', '기타'];
var SUSPECT_HEAD = ['일시', '이름', '구분', '내용'];
// 보낼곳: 점장(점장이 먼저 보고 관리자에게 올리거나 돌려보냄) / 관리자 · 점장확인: 점장이 올리거나 돌려보낸 기록
// 증빙: 직원이 올린 사진(드라이브 [출퇴근 증빙] 폴더) 주소. 사장님만 열 수 있어요
var REQ_HEAD = ['번호', '요청일시', '이름', '종류', '날짜', '내용', '사유', '상태', '대타', '처리일시', '보낼곳', '점장확인', '증빙'];
var R = { id: 0, at: 1, name: 2, kind: 3, date: 4, what: 5, reason: 6, state: 7, taker: 8, done: 9, route: 10, mgr: 11, proof: 12 };
var PROOF_FOLDER = '출퇴근 증빙';
var PROOF_MAX = 5 * 1024 * 1024; // 사진 글자 수(base64) 한도. 화면이 줄여서 보내서 보통 0.3MB쯤이에요
// 대체휴무 장부: 적립(쉬는 날·공휴일에 일함) / 사용(대체휴무 신청 승인). 사장님이 손으로 줄을 더하거나 지워도 돼요
var SUB_HEAD = ['날짜', '이름', '구분', '일수', '사유', '기록일시'];
var SUB_FMT = ['@', '@', '@', '0.0', '@', '@'];
var CHANGE_HEAD = ['날짜', '이름', '근무시간', '메모'];
// 매장 = 그 직원의 소속 매장(매장별로 거르기 쉽게). 찍은매장 = 실제로 찍은 곳(다른 매장 지원 근무면 달라요)
var LOG_HEAD = ['날짜', '요일', '이름', '예정출근', '예정퇴근', '출근', '퇴근',
  '지각(분)', '조퇴(분)', '근무(분)', '차감액', '출근거리(m)', '퇴근거리(m)', '메모', '찍은매장', '매장'];
var LOG_FMT = ['@', '@', '@', '@', '@', '@', '@', '0', '0', '0', '#,##0', '0', '0', '@', '@', '@'];
var C = { date: 0, dow: 1, name: 2, sIn: 3, sOut: 4, tIn: 5, tOut: 6,
  late: 7, early: 8, work: 9, deduct: 10, dIn: 11, dOut: 12, memo: 13, place: 14, store: 15 };

var K = {
  store: '상호', adminPin: '관리자PIN',
  radius: '허용반경(m)', mode: '위치확인', device: '폰확인', grace: '지각유예(분)',
  email: '알림이메일', alertMin: '알림기준(분)', tgToken: '텔레그램토큰', tgChat: '텔레그램채팅ID', tgBot: '텔레그램봇',
  remind: '출근전알림(분)', wishWin: '휴무신청기간', wishBlock: '휴무금지일',
  mgrAlert: '점장알림',
  outCheck: '퇴근확인',
  holAdd: '공휴일추가', holDel: '공휴일제외', subMode: '대체휴무적립', start: '앱시작일',
  alias: '예전매장이름', oldSrc: '예전휴무표주소', joinCode: '입사코드', hrMust: '인사정보필수',
  backup: '자동백업', // 매주 새벽 시트 전체를 구글 드라이브 [출퇴근 백업] 폴더에 사본으로(켬/끔)
  docsIn: '입사서류목록', docsOut: '퇴사정리목록',
  probMonths: '수습개월', leaveRule: '경조휴가',
};
// 경조 휴가 규정 기본값(가게 규칙. 배우자 출산은 법정 20일: 남녀고용평등법 18조의2, 근무일 기준, 출산 후 120일 안)
var LEAVE_RULE = '본인 결혼 5, 자녀 결혼 1, 배우자 출산 20, 부모·배우자 사망 5, 배우자 부모 사망 5, 조부모 사망 3, 형제자매 사망 3';
var DOCS_IN = '근로계약서, 신분증 사본, 통장 사본, 개인정보 보안 서약서';
var DOCS_OUT = '사직서, 매장 열쇠·출입카드, 유니폼·명찰, 업무폰·태블릿, 전산 아이디 정리, 인수인계';
var SETTINGS = [
  [K.store, '굳폰', '직원 화면 맨 위에 보이는 이름'],
  [K.adminPin, '0000', '사장님 화면 비밀번호. 꼭 바꾸세요'],
  [K.radius, '100', '매장에서 이 거리(m) 안에서만 찍혀요([매장] 탭에 매장별로 따로 정해도 돼요). 실내 GPS 오차는 최대 100m까지 봐줘요'],
  [K.mode, '필수', '필수: 등록된 매장 근처에서만 찍힘(어느 매장이든) / 기록만: 위치는 남기고 어디서든 찍힘 / 안함'],
  [K.device, '필수', '필수: 직원마다 처음 찍은 폰에서만 찍힘. 폰을 바꾸면 사장님 승인 필요 / 안함'],
  [K.grace, '0', '이 시간(분)까지 늦은 건 지각으로 안 봐요. 넘으면 늦은 시간 전체가 지각'],
  [K.email, '', '알림 받을 메일 주소. 텔레그램을 연결하면 텔레그램으로 가고, 안 되면 이 메일로 가요'],
  [K.alertMin, '10', '출근 예정 시간에서 몇 분 지나도 안 찍으면 알림을 보낼지'],
  [K.tgToken, '', '텔레그램 봇 토큰. 사장님 화면 [설정] 탭에서 넣으면 돼요. 남에게 보여주지 마세요'],
  [K.tgChat, '', '알림 받을 텔레그램 채팅 번호. 사장님 화면에서 [연결 확인]을 누르면 채워져요'],
  [K.tgBot, '', '텔레그램 봇 아이디. 토큰을 저장하면 저절로 채워져요. 직원이 앱에서 알림을 켤 때 써요'],
  [K.remind, '20', '텔레그램 알림을 켠 직원에게 출근 몇 분 전에 알려줄지. 0이면 안 보내요'],
  [K.outCheck, '안함', '안함: 퇴근을 안 찍어도 알림·안내를 안 보내요(찍으면 기록은 남아요) / 함: 퇴근 예정 10분 뒤 본인에게 알리고, 직원 화면 "퇴근 누락" 안내·밤 마감 정리·[월별] 확인할 것에 보여요'],
  [K.mgrAlert, '켬', '켬: 점장에게 그 매장 소식(출근 안 찍은 직원, 늦어요, 새 직원 입사, 지점 이동, 퇴사)을 텔레그램으로 보내요. 점장이 직원 화면 맨 아래에서 텔레그램 알림을 켜야 가요 / 끔: 점장에게 안 보내요(사장님 알림은 그대로)'],
  [K.wishWin, '20-25', '직원이 앱에서 다음 달 휴무를 고를 수 있는 날짜(매달 20~25일). 비우면 언제든 고를 수 있어요'],
  [K.wishBlock, '', '휴무를 고를 수 없는 날. 예: 12/24, 12/31 (해마다) 또는 2026-12-24'],
  [K.holAdd, '', '앱에 없는 공휴일·회사 쉬는 날 더하기. 예: 2027-05-03 대체공휴일, 2026-12-31 회사휴무'],
  [K.holDel, '', '앱에 들어 있는 공휴일 빼기. 예: 2026-05-01'],
  [K.subMode, '휴무날만', '대체휴무 쌓기. 휴무날만: 쉬는 날 출근하면 / 휴무날·공휴일: 공휴일에 출근해도 / 안함'],
  [K.start, '', '직원들이 실제로 출퇴근을 찍기 시작하는 날. 예: 2026-12-01. 비워 두면 "시작 전"이라 미출근 알림·결근? 표시·하루 마감 알림을 안 해요(찍는 건 돼요. 텔레그램을 켠 직원의 출근 전 알림은 가요). 사장님 화면 [설정]에서 정해도 돼요'],
  [K.alias, '아라=검단, 사무실(영)=사무실(왕)', '예전에 쓰던 매장 이름을 지금 [매장] 탭 이름으로 맞춰요. 예: 옛이름=지금이름, 옛이름2=지금이름2 (예전 휴무표 가져오기·1년 보기에 써요)'],
  [K.oldSrc, '', '예전 휴무표 구글 시트 주소. 사장님 화면 [설정] → 예전 휴무표 가져오기에서 넣으면 여기에 기억돼요'],
  [K.backup, '켬', '켬: 매주 한 번(보통 월요일 새벽 3~6시) 이 시트 전체를 구글 드라이브 [출퇴근 백업] 폴더에 사본으로 저장해요. 최근 8개만 남기고 오래된 것은 휴지통으로 옮겨요 / 끔: 안 해요'],
  [K.joinCode, '', '입사 등록 때 넣는 숫자 4자리. 사장님이(또는 사장님께 들은 점장이) 신입에게 알려줘요. 입사 링크(사장님 화면 [설정])에는 코드가 들어 있어요. 비워 두면 코드 없이 등록할 수 있어요(주소만 알면 누구나 보낼 수 있으니 정해 두는 걸 권해요). 사장님 화면 [설정]에서 정해도 돼요'],
  [K.docsIn, DOCS_IN, '인사 카드의 입사 서류 체크 칸에 나오는 항목(쉼표로 나눠 적어요). 받은 것만 체크해 두면 누가 뭘 안 냈는지 보여요'],
  [K.docsOut, DOCS_OUT, '인사 카드의 퇴사 정리 체크 칸에 나오는 항목(쉼표로 나눠 적어요). 퇴사 예정·퇴사한 직원 카드에 나와요'],
  [K.leaveRule, LEAVE_RULE, '경조 휴가 규정: "경조사 일수"를 쉼표로(예: 본인 결혼 5). 직원이 [휴무 신청] → 경조를 고르면 이 목록에서 고르고, 근무하는 날 기준 그 일수까지만 보낼 수 있어요. 배우자 출산 20일은 법으로 정한 휴가예요(남녀고용평등법, 출산 후 120일 안). 비우면 고르지 않고 일수 제한도 없어요'],
  [K.probMonths, '3', '입사 등록을 승인할 때 인사 카드 "수습 끝"을 입사일부터 이 개월 수로 채워요(0이면 안 채워요). 수습 끝·계약 끝은 30일 전·7일 전·전날 밤 마감 정리와 사장님 화면 [오늘]에 알려줘요'],
  [K.hrMust, '필수', '필수: 인사 정보(주민등록번호·휴대폰·주소·은행·계좌번호·비상연락처·입사일)를 다 넣어야 출근이 찍혀요 / 안함: 안내만 하고 막지 않아요(출근이 몰려 곤란할 때 잠깐)'],
];

/*
 * 공휴일(대체공휴일·선거일 포함). 휴무표 머리글을 빨갛게 칠하고, 직원 근무표에 이름이 보여요.
 * 정부 발표가 바뀌면 [설정]의 공휴일추가·공휴일제외로 고치면 돼요.
 */
var HOLIDAYS = {
  '2026-01-01': '신정', '2026-02-16': '설 연휴', '2026-02-17': '설날', '2026-02-18': '설 연휴',
  '2026-03-01': '삼일절', '2026-03-02': '대체공휴일', '2026-05-01': '노동절', '2026-05-05': '어린이날',
  '2026-05-24': '부처님오신날', '2026-05-25': '대체공휴일', '2026-06-03': '지방선거', '2026-06-06': '현충일',
  '2026-07-17': '제헌절', '2026-08-15': '광복절', '2026-08-17': '대체공휴일',
  '2026-09-24': '추석 연휴', '2026-09-25': '추석', '2026-09-26': '추석 연휴',
  '2026-10-03': '개천절', '2026-10-05': '대체공휴일', '2026-10-09': '한글날', '2026-12-25': '성탄절',
  '2027-01-01': '신정', '2027-02-06': '설 연휴', '2027-02-07': '설날', '2027-02-08': '설 연휴', '2027-02-09': '대체공휴일',
  '2027-03-01': '삼일절', '2027-05-01': '노동절', '2027-05-05': '어린이날', '2027-05-13': '부처님오신날',
  '2027-06-06': '현충일', '2027-07-17': '제헌절', '2027-08-15': '광복절', '2027-08-16': '대체공휴일',
  '2027-09-14': '추석 연휴', '2027-09-15': '추석', '2027-09-16': '추석 연휴',
  '2027-10-03': '개천절', '2027-10-04': '대체공휴일', '2027-10-09': '한글날', '2027-10-11': '대체공휴일',
  '2027-12-25': '성탄절', '2027-12-27': '대체공휴일',
};

/* ───────────── 웹 화면 ───────────── */

function doGet(e) {
  var q = (e && e.parameter) || {};
  if (q.vcf) return contactOut_(q.vcf, q.dl === '1'); // 사장님 화면 [연락처 저장]
  var admin = q.page === 'admin';
  var name = admin ? 'Admin' : 'Index';
  // 한 파일 버전(dist/Code.gs)은 화면 HTML을 PAGES 안에 담고 있어요.
  var out = typeof PAGES !== 'undefined' && PAGES[name]
    ? HtmlService.createHtmlOutput(PAGES[name])
    : HtmlService.createHtmlOutputFromFile(name);
  return out.setTitle(admin ? '출퇴근 관리' : '출퇴근')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

/* ───────────── 직원 화면에서 부르는 함수 ───────────── */

/**
 * 웹 앱 주소(카톡·네이버앱 안에서 열렸을 때 [기본 브라우저로 열기]에 써요). 시트를 안 읽어서 빨라요.
 * 직원에게 나눠 준 주소와 같은 것이라 비밀이 아니에요.
 */
function getAppUrl() {
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (err) { /* 배포 전 */ }
  return { url: url };
}

function getStaffList() {
  var set = settings_();
  var stores = stores_();
  var active = staff_().filter(function (p) { return p.active; });
  // 매장마다 점장(직원 명단에 있는 사람만). 직원 화면의 '점장에게 보내기', 사장님 화면의 점장 로그인에 써요
  var mgr = {}, managers = [];
  stores.forEach(function (st) {
    var m = managersOf_(st.name);
    if (m.length) mgr[st.name] = m.join(', ');
    m.forEach(function (n) { if (managers.indexOf(n) < 0) managers.push(n); });
  });
  return {
    store: set.store,
    mode: set.mode,
    stores: stores.map(function (st) { return st.name; }),
    joinCode: !!set.joinCode, // 입사 등록 때 코드를 물어볼지(코드 자체는 안 보내요)
    appUrl: (function () { try { return ScriptApp.getService().getUrl() || ''; } catch (err) { return ''; } })(), // '내 전용 주소'를 만들 때 써요
    mgr: mgr,
    managers: managers,
    leaveRules: set.leaveRules, // 경조 휴가 규정(휴무 신청 → 경조에서 골라요)
    staff: sortByStore_(active, stores)
      .map(function (p) { return { name: p.name, store: p.store, pin: !!p.pin, agreed: p.agreed, test: p.name === TEST_NAME }; }),
  };
}

/**
 * 직원 화면: 오늘 근무 예정과 출근·퇴근 시각. 출근·퇴근 시각은 비밀번호가 맞을 때만 보여줘요
 * (이름 목록은 누구나 보니까, 비밀번호 없이 남의 출근 시각·혼자 나서는 시각을 알 수 없게).
 */
function getToday(name, pin) {
  var p = person_(name);
  var t = todayFor_(p);
  if (!p.pin || !String(pin == null ? '' : pin).trim()) return maskToday_(t);
  checkPin_(p, pin);
  return t;
}

function todayFor_(p) {
  var now = nowKst_();
  var found = findLog_(sheet_(SHEETS.log), now.date, p.name);
  if (found) return todayOf_(found.vals);
  var s = schedFor_(p, now.date);
  return { date: now.date, sIn: s ? fmtTime_(s.start) : '', sOut: s ? fmtTime_(s.end) : '', tIn: '', tOut: '' };
}

/** 근무 예정만 남기고 출근·퇴근 시각은 지워요. */
function maskToday_(t) { return { date: t.date, sIn: t.sIn, sOut: t.sOut, tIn: '', tOut: '', masked: true }; }

function punch(req) {
  req = req || {};
  var type = req.type === 'out' ? 'out' : 'in';
  // 시간은 '누른 순간'으로 기록해요. 사람이 몰려 줄을 서도 그만큼 늦게 찍히지 않아요.
  var now = nowKst_();
  // 비밀번호·폰·위치 확인은 줄 서기 전에 해요(동시에 여러 명 처리돼서 빨라요)
  var set = settings_();
  var people = staff_();
  var p = person_(req.name, people);
  checkPin_(p, req.pin, true, req.device);
  checkAgree_(p, req);
  // 인사 정보를 다 넣어야 출근이 찍혀요. 폰이 아직 없는 사람은 폰 확인 전에 막아요(막힌 시도·이름을 잘못 누른 시도에 폰이 묶이지 않게).
  // 폰이 있는 사람은 폰 확인 뒤에(새 폰이면 '새 폰 승인 요청'이 먼저 가야 그 폰으로 인사 정보를 넣을 수 있어요)
  var hst = set.hrMust === '안함' ? { state: 'ok' } : hrStatus_(p);
  if (hst.state !== 'ok' && !(p.deviceIds || []).length) {
    if (type === 'in' || !todayIn_(p.name, now)) throw new Error(type === 'in' ? tryBlock_(set, p, req, now, people, hst) : hrBlockMsg_(hst));
  }
  // 막힌 출근(새 폰 승인 요청·인사 정보 미입력)은 매장 반경 안이면 처음 누른 시각을 기억해요(tryNote_. 기록 줄은 안 만들어요)
  try { checkDevice_(set, p, req, people); } catch (err) { if (type === 'in') tryNote_(set, p, req, now, 'phone', people); throw err; }
  if (hst.state !== 'ok' && type === 'in') throw new Error(tryBlock_(set, p, req, now, people, hst));
  var needIn = hst.state !== 'ok' ? hrBlockMsg_(hst) : ''; // 퇴근은 그날(자정 넘기면 어제) 출근 기록을 닫을 때만
  var place = checkPlace_(set, req, p, now);
  var sched = schedFor_(p, now.date); // 오늘 근무시간도 미리 읽어 둬요
  // 지원 근무(다른 매장에서 찍음): 지각은 지원 간 매장 시간 기준이에요. 그날 [근무변경]으로 시간을 따로 정해 뒀으면 그걸 써요
  var away = place.store && p.store && place.store !== p.store ? storeOf_(place.store) : null;
  if (!away) {
    var ts = typedAway_(set, p, now.date, place, req);
    if (ts) { away = ts; place = { dist: place.dist, store: ts.name, memo: (place.memo ? place.memo + ', ' : '') + '휴무표에 적힌 지원 매장' }; }
  }
  // 원래 근무하는 날만 지원 간 매장 시간으로 봐요(쉬는 날 지원은 지각이 아니에요. 자기 매장에 나온 쉬는 날과 같게)
  if (away && sched && away.open != null && !changes_().some(function (r) { return parseDate_(r[0]) === now.date && String(r[1]).trim() === p.name; })) {
    sched = { start: away.open, end: away.close };
  }
  // 인사 정보 때문에 막혔던 출근이 풀린 뒤 그 폰으로 TRY_MIN분 안에 다시 누르면 처음 누른 시각으로 찍어요
  // (사장님이 인사 카드에서 대신 채운 때도 같아요. 막힐 때 화면에 그렇게 약속했어요. 새 폰 승인 대기는 사장님이 [이 시각으로 출근 적기]로 적어요)
  var at = now, tmemo = '', t0 = type === 'in' ? tryGet_(now.date, p.name) : null;
  if (t0 && t0.why === 'hr' && t0.min <= now.min && now.min - t0.min <= TRY_MIN && (set.device === '안함' || t0.dev === cleanDevId_(req.device))) {
    at = { date: now.date, time: t0.time, min: t0.min, ym: now.ym, dow: now.dow };
    tmemo = '처음 누른 시각으로 적음(' + (TRY_WHY[t0.why] || '출근이 막힘') + ' · 막힌 게 풀린 뒤 ' + now.time + '에 다시 누름)';
  }
  var w = punchWrite_(set, p, type, at, place, sched, away, tmemo, needIn);
  var v = w.v;
  if (tmemo) {
    tryDone_(now.date, p.name);
    logSuspect_(p.name, '처음 누른 시각으로 적음', '다시 눌러서 출근 ' + t0.time + '로 적음 (' + now.time + '에 · ' + (TRY_WHY[t0.why] || '출근이 막힘') + tryDist_(t0) + ')');
  }
  if (type === 'in' && awayOn_(p.name, now.date)) {
    // 휴직 기간인데 출근을 찍었어요: 사장님이 휴직을 끝내야 근무일로 돌아와요
    try { notify_(set, '휴직 중인 직원이 출근을 찍었어요', p.name + (p.store ? ' (' + p.store + ')' : '') + ' ' + now.time + '\n복직이면 사장님 화면 [직원] → 인사 카드에서 [휴직 끝내기]를 눌러주세요.', { silent: true }); } catch (err) { console.error(err); }
  }
  // 처음 정한 비밀번호·동의는 줄 밖에서 저장해요(기록이 성공한 뒤에만)
  if (p.newPin) setStaffCell_(p.row, 'PIN', p.newPin);
  if (p.newAgree) setStaffCell_(p.row, '동의', now.date + ' ' + now.time);
  return {
    type: type, time: at.time, first: tmemo ? 1 : 0, // first: 막혔던 출근을 처음 누른 시각으로 적었어요
    late: toNum_(v[C.late]), early: toNum_(v[C.early]), work: v[C.work] === '' ? null : toNum_(v[C.work]),
    today: w.prevDay ? todayFor_(p) : todayOf_(v), weakPin: weakPin_(p, people), place: place.memo || '', // 자정 넘긴 퇴근은 어제 줄에 적었으니 화면에는 오늘 상태를
    support: type === 'in' && away ? away.name : '', // 다른 매장에서 출근 = 지원 근무로 적었어요
    prevDay: w.prevDay, // 자정을 넘겨 찍은 퇴근이면 어제 날짜
  };
}

/**
 * 출근·퇴근을 기록에 써요(한 명씩 줄을 서서). 직원이 직접 찍을 때(punch)와 점장·사장님이 대신 찍어 줄 때(proxyPunch) 같이 써요.
 * place = {dist, store, memo}, away = 지원 간 매장(없으면 null), memo = 기록 메모에 덧붙일 말. {v: 쓴 줄, prevDay} 를 돌려줘요.
 */
/**
 * 사장님이 휴무표 그날 칸에 적어 둔 지원 매장(소속이 아닌 매장 이름). 이럴 때 그 매장에서 일한 걸로 봐요:
 *  - 위치로 매장을 모를 때(위치 확인 안 함·기록만·대신 찍기)
 *  - 위치가 소속 매장으로 잡혔지만 적어 둔 매장도 반경 안일 때(매장과 사무실이 붙어 있어 위치로 못 가를 때)
 * 위치가 소속 매장(적어 둔 매장은 반경 밖)이나 또 다른 매장으로 잡히면 계획이 바뀐 거라 안 봐요.
 */
function typedAway_(set, p, date, place, req) {
  if (!p.store) return null;
  var typed = supportOf_(dayMark_(p.name, date), storeNames_());
  var ts = typed && typed !== p.store ? storeOf_(typed) : null;
  if (!ts) return null;
  if (!place.store) return ts;
  if (place.store !== p.store || !req || typeof req.lat !== 'number' || typeof req.lng !== 'number' || ts.lat == null || ts.lng == null) return null;
  var acc = Math.max(Number(req.acc) || 0, 0);
  return distance_(ts.lat, ts.lng, req.lat, req.lng) - Math.min(acc, 100) <= (ts.radius || set.radius) ? ts : null;
}

function punchWrite_(set, p, type, now, place, sched, away, memo, needIn) {
  var v, prevDay = '';
  // 기록을 쓰는 부분만 한 명씩
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) throw new Error('지금 찍는 사람이 많아서 잠깐 밀렸어요. 다시 한 번 눌러주세요.');
  try {
    var sh = sheet_(SHEETS.log);
    var found = findLog_(sh, now.date, p.name);
    if (type === 'out' && now.min < 5 * 60 && !(found && found.vals[C.tIn])) {
      // 자정을 넘겨 퇴근(새벽 5시 전): 어제 출근만 있고 퇴근이 없으면 어제 줄에 적어요
      var yday = addDays_(now.date, -1);
      var prev = findLog_(sh, yday, p.name);
      if (prev && prev.vals[C.tIn] && !prev.vals[C.tOut]) { found = prev; prevDay = yday; }
    }
    // 인사 정보를 다 안 넣은 직원: 퇴근은 출근 기록을 닫을 때만(퇴근만 찍어서 '결근?'을 피하지 못하게)
    if (needIn && !(found && found.vals[C.tIn])) throw new Error(needIn);
    var row;
    if (found) {
      row = found.row;
      v = found.vals.slice();
    } else {
      row = Math.max(sh.getLastRow(), 1) + 1;
      v = newLogRow_(now.date, p, sched);
      // 기록이 생기기 전에 승인된 조퇴·외출 등은 맡아 둔 메모를 그날 첫 기록에 적어요(dayMemo_)
      var held = PropertiesService.getScriptProperties().getProperty(dayMemoKey_(p.name, now.date));
      if (held) v[C.memo] = addMemo_(v[C.memo], held);
    }
    if (type === 'in') {
      if (v[C.tIn]) throw new Error('오늘은 이미 ' + v[C.tIn] + '에 출근을 찍었어요.');
      v[C.tIn] = now.time;
      v[C.dIn] = place.dist;
      var ahead = lateMemo_(p.name, now.date); // [늦어요]로 미리 알린 날: 기록 메모에 '미리 알림: 20분'(지각은 평소처럼 적혀요)
      if (ahead) v[C.memo] = addMemo_(v[C.memo], ahead);
      if (away && sched) { // 지원 간 매장 시간으로 예정 시간을 적어요(이미 있던 줄이어도)
        v[C.sIn] = fmtTime_(sched.start);
        v[C.sOut] = sched.end != null ? fmtTime_(sched.end) : '';
        v[C.memo] = addMemo_(v[C.memo], '지원 근무(' + place.store + ') 시간 기준');
      }
      if (away && !v[C.place]) v[C.place] = place.store;
    } else {
      if (v[C.tOut]) v[C.memo] = addMemo_(v[C.memo], '퇴근 다시 찍음(이전 ' + v[C.tOut] + ')');
      if (!v[C.tIn]) v[C.memo] = addMemo_(v[C.memo], '출근 기록 없음');
      v[C.tOut] = now.time;
      v[C.dOut] = place.dist;
    }
    if (place.store && !v[C.place]) v[C.place] = place.store;
    if (!v[C.store]) v[C.store] = p.store || '';
    if (place.memo) v[C.memo] = addMemo_(v[C.memo], place.memo);
    if (memo) v[C.memo] = addMemo_(v[C.memo], memo);
    applyCalc_(v, p.wage, set.grace);
    writeLog_(sh, row, v);
    if (type === 'in') {
      syncLateMark_(now.date, p.name, v);
      // 입사일보다 먼저 나와 찍은 신입(교육 등): 그 달 휴무표에 줄이 없어서 기록이 안 적혀요 → 입사일을 오늘로 당기고 줄을 만들어요
      var mg = monthGrid_(now.ym);
      if (p.name !== TEST_NAME && !(mg && mg.rows[p.name])) {
        var hd = hrDates_()[p.name], hh = hd && hd.start && hd.start > now.date ? hrFind_(p.name) : null;
        if (hh) {
          hrWrite_(hh.row, { start: now.date, reg: addMove_(hh.reg, now.date + ' 입사일 전에 출근해서 입사일을 당김(' + hd.start + ' → ' + now.date + ')').slice(-200) });
          ensureMonth_(now.ym);
          syncLateMark_(now.date, p.name, v);
        }
      }
    }
  } finally {
    lock.releaseLock();
  }
  return { v: v, prevDay: prevDay };
}

/**
 * 대신 찍어 주기: 직원 폰이 고장·방전·분실됐을 때 점장(자기 매장 직원만)이나 사장님이 지금 시각으로 찍어 줘요.
 * 폰·위치 확인 없이 찍히는 대신, 누가 대신 찍었는지와 이유가 기록 메모·[의심기록]에 남고 사장님께 알림이 가요.
 */
function proxyPunch(cred, name, type, reason) {
  var a = auth_(cred);
  var set = a.set;
  reason = clean_(reason, 60);
  if (!reason) throw new Error('이유를 적어주세요. (예: 폰 방전, 폰 고장)');
  var p = person_(name);
  if (!canSee_(a, p)) throw new Error('점장님 매장 직원만 대신 찍을 수 있어요.');
  if (a.role === 'manager' && a.name === p.name) throw new Error('본인 출퇴근은 대신 찍을 수 없어요. 사장님께 말씀해주세요.');
  type = type === 'out' ? 'out' : 'in';
  var now = nowKst_();
  var who = a.role === 'admin' ? '사장님' : a.name + ' 점장';
  var pl = { dist: '', store: '', memo: '' }, sch = schedFor_(p, now.date), aw = null;
  var ts = type === 'in' ? typedAway_(set, p, now.date, pl, null) : null; // 휴무표에 적힌 지원 매장이 있으면 그 매장 시간 기준(직접 찍을 때와 같게)
  if (ts) {
    aw = ts;
    pl = { dist: '', store: ts.name, memo: '휴무표에 적힌 지원 매장' };
    if (sch && ts.open != null && !changes_().some(function (r) { return parseDate_(r[0]) === now.date && String(r[1]).trim() === p.name; })) sch = { start: ts.open, end: ts.close };
  }
  var pst = a.role === 'admin' || set.hrMust === '안함' ? { state: 'ok', missing: [] } : hrStatus_(p);
  if (pst.state !== 'ok' && type === 'in') throw new Error(p.name + ' 님은 인사 정보를 아직 다 안 넣어서 점장님이 대신 출근을 찍을 수 없어요' + (pst.missing.length ? '(아직: ' + pst.missing.join(', ') + ')' : '') + '. 본인 폰에서 인사 정보를 넣거나 사장님께 말씀해 주세요.');
  var w = punchWrite_(set, p, type, now, pl, sch, aw, who + '이 대신 찍음: ' + reason, pst.state !== 'ok' ? p.name + ' 님은 인사 정보를 아직 다 안 넣었어요. 출근 기록이 없는 날은 대신 퇴근도 찍을 수 없어요.' : '');
  var label = type === 'in' ? '출근' : '퇴근';
  logSuspect_(p.name, '대신 찍음', who + '이 ' + label + ' ' + now.time + ' (' + reason + ')');
  if (a.role !== 'admin') {
    try { notify_(set, '대신 찍음', (p.store ? '[' + p.store + '] ' : '') + p.name + ' ' + label + ' ' + now.time + '\n' + who + ': ' + reason, { silent: true }); } catch (err) { console.error(err); }
  }
  var out = adminToday(cred);
  out.proxy = { name: p.name, type: type, time: now.time, late: toNum_(w.v[C.late]) };
  return out;
}

/* ───── 막힌 출근: 처음 누른 시각으로 넣기 (새 폰 승인 대기·인사 정보 미입력) ───── */

var TRY_WHY = { phone: '새 폰 승인 대기', hr: '인사 정보 미입력' };
var TRY_MIN = 60; // 인사 정보를 다 넣은 때가 처음 누른 때부터 이 시간(분) 안이면 그 시각으로 저절로 출근을 찍어요

/**
 * 누른 곳이 매장 반경 안인지. checkPlace_와 같은 기준이에요(자기 매장 반경 안이면 자기 매장, 아니면 가장 가까운 매장, GPS 오차는 100m까지).
 * 반경 안이면 {dist, store}, 아니면 null(위치 없음·위치 확인 안 함·내 매장 위치 미등록·반경 밖). 막지도 않고 [의심기록]에 남기지도 않아요.
 */
function nearStore_(set, req, p) {
  try {
    if (set.mode === '안함' || !req || typeof req.lat !== 'number' || typeof req.lng !== 'number' || !isFinite(req.lat) || !isFinite(req.lng)) return null;
    var stores = stores_(), own = null, best = null;
    stores.forEach(function (st) { if (st.name === p.store) own = st; });
    if (own && (own.lat == null || own.lng == null)) return null; // 내 매장 위치가 없으면 반경을 알 수 없어요
    stores.forEach(function (st) {
      if (st.lat == null || st.lng == null) return;
      var d = distance_(st.lat, st.lng, req.lat, req.lng);
      if (!best || d < best.d) best = { d: d, st: st };
    });
    if (!best) return null;
    var acc = Math.min(Math.max(Number(req.acc) || 0, 0), 100);
    if (own && best.st.name !== own.name) {
      var dOwn = distance_(own.lat, own.lng, req.lat, req.lng);
      if (dOwn - acc <= (own.radius || set.radius)) best = { d: dOwn, st: own };
    }
    return best.d - acc <= (best.st.radius || set.radius) ? { dist: best.d, store: best.st.name } : null;
  } catch (err) {
    console.error(err);
    return null;
  }
}

/**
 * 출근이 막혔을 때(새 폰 승인 요청·인사 정보 미입력) 누른 시각을 기억해요. 기록 줄은 만들지 않아요.
 * 한 사람에 하루 한 번(처음 것만), 매장 반경 안에서 눌렀을 때만. 비밀번호가 맞은 사람만 받아요(처음 정하는 번호는 아무나 넣을 수 있어서),
 * 동료 폰으로 누른 건 안 받아요. 스크립트 속성 'try:날짜:이름' = {time, min, dist, store, typed, why, dev, ag}. 다음 날 10분 검사가 지워요.
 * 오늘 이 폰으로 처음 누른 시도(방금 것 또는 아까 것)를 돌려줘요. 없으면 null.
 */
function tryNote_(set, p, req, now, why, people) {
  try {
    if (!p || !p.pin || p.name === TEST_NAME || !TRY_WHY[why]) return null;
    var dev = cleanDevId_(req && req.device);
    if (set.device === '안함') {
      if (why === 'phone') return null;
    } else {
      if (!dev || (people || staff_()).some(function (x) { return x.active && x.name !== p.name && hasDev_(x, dev); })) return null;
      if (why === 'phone' && (!(p.deviceIds || []).length || hasDev_(p, dev))) return null; // 새 폰 승인 요청이 간 때만(폰 확인 안 됨은 아니에요)
    }
    var props = PropertiesService.getScriptProperties(), key = 'try:' + now.date + ':' + p.name;
    var old = tryParse_(props.getProperty(key));
    if (old) return set.device === '안함' || old.dev === dev ? old : null; // 처음 누른 것만
    var pl = nearStore_(set, req, p);
    if (!pl) return null; // 매장 반경 밖이거나 위치를 몰라요
    // 휴무표에 적힌 지원 매장(자기 매장과 붙어 있어 위치로 못 가를 때)은 직접 찍을 때처럼 그 매장으로
    var ts = pl.store === p.store ? typedAway_(set, p, now.date, pl, req) : null;
    var t = {
      time: now.time, min: now.min, dist: pl.dist, store: ts ? ts.name : pl.store, typed: ts ? 1 : 0, why: why, dev: dev,
      ag: p.newAgree ? 1 : 0, // 처음 동의를 이번에 눌렀어요(동의는 출근이 찍혀야 저장돼요)
    };
    props.setProperty(key, JSON.stringify(t));
    return t;
  } catch (err) {
    console.error(err);
    return null;
  }
}

/** 인사 정보 때문에 막힌 출근: 누른 시각을 기억하고(tryNote_), 막는 말 뒤에 '언제까지 넣으면 그 시각으로 찍히는지'를 붙여요. */
function tryBlock_(set, p, req, now, people, hst) {
  var msg = hrBlockMsg_(hst), t = tryNote_(set, p, req, now, 'hr', people);
  if (!t || hst.state !== 'need' || now.min - t.min > TRY_MIN) return msg;
  return msg + '\n처음 누른 시각(' + t.time + ')은 기억해 둘게요. ' + fmtTime_(Math.min(t.min + TRY_MIN, 24 * 60 - 1)) + '까지 인사 정보를 다 넣으면 그 시각으로 출근이 찍혀요.';
}

function tryParse_(s) {
  var t = null;
  try { t = JSON.parse(s || 'null'); } catch (err) { t = null; }
  return t && /^\d{2}:\d{2}$/.test(String(t.time)) && typeof t.min === 'number' && isFinite(t.min) ? t : null;
}

/** 그날 이 사람의 막힌 출근 시도(없으면 null). */
function tryGet_(date, name) {
  try { return tryParse_(PropertiesService.getScriptProperties().getProperty('try:' + date + ':' + name)); } catch (err) { return null; }
}

function tryDone_(date, name) {
  try { PropertiesService.getScriptProperties().deleteProperty('try:' + date + ':' + name); } catch (err) { console.error(err); }
}

/** 사장님 화면 [오늘]: 오늘 막힌 출근 시도가 있고 아직 출근 기록이 없는 사람 {이름: {time, dist, store, why, whyText}}. logs = 오늘 기록 줄들. */
function tryToday_(date, logs) {
  var out = {}, pre = 'try:' + date + ':', all = {};
  try { all = PropertiesService.getScriptProperties().getProperties(); } catch (err) { console.error(err); }
  Object.keys(all).forEach(function (k) {
    if (k.indexOf(pre) !== 0) return;
    var name = k.slice(pre.length), t = tryParse_(all[k]);
    if (!t || (logs || []).some(function (r) { return r.name === name && r.tIn; })) return;
    out[name] = { time: t.time, dist: t.dist === '' || t.dist == null ? '' : Math.round(Number(t.dist)), store: t.store || '', why: t.why, whyText: TRY_WHY[t.why] || '' };
  });
  return out;
}

/**
 * 막힌 출근 시도를 그 시각으로 오늘 기록에 적어요(punchWrite_에 '누른 때'를 넘겨서, 지각도 그 시각으로 계산돼요).
 * 다른 매장 반경 안에서 눌렀거나 휴무표에 적힌 지원 매장이면 직접 찍을 때처럼 지원 근무(그 매장 시간 기준)예요. {v, prevDay}를 돌려줘요.
 */
function tryWrite_(set, p, t, now, memo) {
  var at = { date: now.date, time: t.time, min: t.min, ym: now.ym, dow: now.dow };
  var store = String(t.store || ''), other = !!(store && p.store && store !== p.store);
  var place = { dist: t.dist === '' || t.dist == null ? '' : Number(t.dist), store: store, memo: t.typed ? '휴무표에 적힌 지원 매장' : other ? '다른 매장(' + store + ')' : '' };
  var sched = schedFor_(p, now.date);
  var away = other ? storeOf_(store) : null;
  if (away && sched && away.open != null && !changes_().some(function (r) { return parseDate_(r[0]) === now.date && String(r[1]).trim() === p.name; })) {
    sched = { start: away.open, end: away.close };
  }
  return punchWrite_(set, p, 'in', at, place, sched, away, memo, '');
}

function tryDist_(t) { return t.dist === '' || t.dist == null ? '' : ' · 약 ' + fmtDist_(Math.round(Number(t.dist))); }

/**
 * 사장님 화면: 막힌 출근을 처음 누른 시각으로 적어요([오늘] 새 폰 승인 카드의 [이 시각으로 출근 적기], 직원 줄의 [10:58로 대신 찍기]).
 * 사장님, 또는 그 직원 매장의 점장(본인 것은 안 돼요). 오늘 누른 것이고 아직 출근 기록이 없을 때만.
 * 대신 찍기처럼 [의심기록]에 남고, 점장이 했으면 사장님께 알려요. 점장은 인사 정보를 다 안 넣은 직원은 못 적어요(대신 찍기와 같아요).
 */
function adminTryPunch(cred, name) {
  var a = auth_(cred);
  var set = a.set;
  var p = person_(name);
  if (!canSee_(a, p)) throw new Error('점장님 매장 직원만 할 수 있어요.');
  if (a.role === 'manager' && a.name === p.name) throw new Error('본인 출근은 대신 적을 수 없어요. 사장님께 말씀해주세요.');
  var now = nowKst_();
  var t = tryGet_(now.date, p.name);
  if (!t || t.min > now.min) throw new Error(p.name + ' 님은 오늘 막힌 출근 기록이 없어요. 새로고침 해주세요.');
  var pst = a.role === 'admin' || set.hrMust === '안함' ? { state: 'ok', missing: [] } : hrStatus_(p);
  if (pst.state !== 'ok') throw new Error(p.name + ' 님은 인사 정보를 아직 다 안 넣어서 점장님이 대신 출근을 적을 수 없어요' + (pst.missing.length ? '(아직: ' + pst.missing.join(', ') + ')' : '') + '. 본인 폰에서 인사 정보를 넣거나 사장님께 말씀해 주세요.');
  var f = findLog_(sheet_(SHEETS.log), now.date, p.name);
  if (f && f.vals[C.tIn]) throw new Error(p.name + ' 님은 오늘 이미 ' + fmtTime_(parseTime_(f.vals[C.tIn])) + ' 출근 기록이 있어요.');
  var who = a.role === 'admin' ? '사장님' : a.name + ' 점장';
  var why = TRY_WHY[t.why] || '출근이 막힘';
  var w = tryWrite_(set, p, t, now, '처음 누른 시각으로 적음(' + why + ' · ' + who + '이 ' + now.time + '에 적음)');
  tryDone_(now.date, p.name);
  logSuspect_(p.name, '처음 누른 시각으로 적음', who + '이 출근 ' + t.time + '로 적음 (' + now.time + '에 · ' + why + tryDist_(t) + ')');
  if (a.role !== 'admin') {
    try { notify_(set, '처음 누른 시각으로 출근 적음', (p.store ? '[' + p.store + '] ' : '') + p.name + ' 출근 ' + t.time + ' (' + why + tryDist_(t) + ')\n' + who + '이 ' + now.time + '에 적었어요.', { silent: true }); } catch (err) { console.error(err); }
  }
  var out = adminToday(cred);
  out.tried = { name: p.name, time: t.time, late: toNum_(w.v[C.late]) };
  return out;
}

/**
 * 인사 정보를 다 넣었을 때(hrSave 끝): 오늘 막혔던 출근을 처음 누른 시각으로 찍어요. 누른 지 TRY_MIN분 안일 때만.
 * 직접 찍을 때처럼 확인해요: 그때 누른 폰에서 넣었는지, 그 폰이 내 폰인지(폰이 하나도 없으면 지금 등록), 동의, 오늘 출근 기록이 없는지.
 * hrWas = 넣기 전 인사 정보 상태('ok'면 막혀 있지 않았으니 안 해요). 찍었으면 out.punched = {type, time, late, today, support}.
 */
function tryAfterHr_(name, f, hrWas, out) {
  if (hrWas === 'ok') return out;
  try {
    var now = nowKst_();
    var t = tryGet_(now.date, name);
    if (!t || now.min < t.min || now.min - t.min > TRY_MIN) return out;
    var set = settings_();
    forget_('staff');
    var people = staff_();
    var p = person_(name, people);
    if (hrStatus_(p).state !== 'ok') return out;
    if (!p.agreed && !t.ag) return out; // 동의(출근을 누를 때 처음 동의했으면 그것)
    var found = findLog_(sheet_(SHEETS.log), now.date, p.name);
    if (found && found.vals[C.tIn]) return out;
    if (set.device !== '안함') {
      var dev = cleanDevId_(f && f.device);
      if (!dev || dev !== t.dev) return out; // 출근을 누른 그 폰에서 넣었을 때만
      checkDevice_(set, p, { device: dev, label: f.label }, people); // 내 폰이면 통과, 폰이 하나도 없으면 지금 등록(직접 찍을 때와 같아요). 남의 폰·새 폰이면 막혀요
    }
    var why = TRY_WHY[t.why] || '출근이 막힘';
    var w = tryWrite_(set, p, t, now, '처음 누른 시각으로 적음(' + why + ' · 인사 정보를 다 넣은 ' + now.time + '에 저절로)');
    tryDone_(now.date, p.name);
    if (!p.agreed) setStaffCell_(p.row, '동의', now.date + ' ' + t.time + ' 출근 누를 때');
    logSuspect_(p.name, '처음 누른 시각으로 적음', '인사 정보를 다 넣어서 출근 ' + t.time + '로 저절로 적음 (' + now.time + '에 · ' + why + tryDist_(t) + ')');
    out.punched = {
      type: 'in', time: t.time, late: toNum_(w.v[C.late]), today: todayOf_(w.v),
      support: t.store && p.store && t.store !== p.store ? t.store : '',
    };
  } catch (err) {
    console.error(err);
  }
  return out;
}

/**
 * 일찍 보냄(조퇴 아님): 사장님이 한가해서 일찍 보낸 직원은 조퇴가 아니에요.
 * 오늘 기록의 예정 퇴근을 실제 퇴근 시각(아직 안 찍었으면 지금)으로 바꿔서 조퇴·차감이 안 붙게 해요. 기록 메모에 남아요.
 */
function adminEarlyOk(cred, name) {
  var a = auth_(cred);
  if (a.role !== 'admin') throw new Error('관리자(사장님)만 할 수 있어요.');
  var p = person_(name);
  var now = nowKst_();
  var at = '';
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sh = sheet_(SHEETS.log);
    var f = findLog_(sh, now.date, p.name);
    if (!f || parseTime_(f.vals[C.tIn]) == null) throw new Error(p.name + ' 님은 오늘 출근 기록이 없어요.');
    var v = f.vals.slice();
    var o = parseTime_(v[C.tOut]);
    at = o != null ? fmtTime_(o) : now.time;
    v[C.sOut] = at;
    v[C.memo] = addMemo_(v[C.memo], '사장님이 일찍 보냄(조퇴 아님, ' + at + ')');
    applyCalc_(v, p.wage, a.set.grace);
    writeLog_(sh, f.row, v);
  } finally {
    lock.releaseLock();
  }
  var out = adminToday(cred);
  out.early = { name: p.name, time: at };
  return out;
}

/** 지각 사유 남기기: 오늘 지각으로 찍힌 직원이 바로 이유를 적어요(기록 메모에 남아 사장님이 월별 기록에서 봐요). */
function lateNote(name, pin, text) {
  var p = person_(name);
  checkPin_(p, pin);
  text = clean_(String(text == null ? '' : text).replace(/,/g, ' '), 60); // 메모는 쉼표로 이어져서, 사유 안의 쉼표는 띄어쓰기로
  if (!text) throw new Error('늦은 이유를 적어주세요.');
  var now = nowKst_();
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var sh = sheet_(SHEETS.log);
    var f = findLog_(sh, now.date, p.name);
    if (!f || !toNum_(f.vals[C.late])) throw new Error('오늘 지각 기록이 없어요.');
    var v = f.vals.slice();
    v[C.memo] = addMemo_(String(v[C.memo] || '').replace(/(^|,\s*)지각 사유: [^,]*/g, '').replace(/^,\s*/, ''), '지각 사유: ' + text);
    writeLog_(sh, f.row, v);
  } finally {
    lock.releaseLock();
  }
  return { ok: true };
}

/* ───── 출근 전에 미리 알리기: [늦어요] · [오늘 못 나가요] (직원 화면 출근·퇴근 버튼 아래) ───── */

var LATE_MINS = [10, 20, 30, 60]; // [늦어요]에서 고르는 시간(분)
var LATE_MAX = 3; // [늦어요]는 하루 3번까지(시간을 바꿔 다시 알릴 때). 점장·사장님 텔레그램이 넘치지 않게
var OFF_TODAY = ['병가', '월차', '무급', '기타']; // [오늘 못 나가요]에서 고르는 종류(기타는 사유를 꼭)

/**
 * 직원 화면 [늦어요]: 오늘 출근 예정 시간보다 몇 분 늦는지 미리 알려요(근무하는 날, 출근을 찍기 전에만).
 *  - 그 매장 점장(텔레그램, [설정] 점장알림)과 사장님께 소리 없이: '[왕십리] 김민우 약 20분 늦어요 (지하철 지연)'
 *  - 말한 시간(예정 출근 + 늦는 시간)에서 알림기준(분)이 지날 때까지 미출근 알림을 안 보내요(checkMissing)
 *  - 지각은 출근을 찍을 때 평소처럼 적히고, 기록 메모에 '미리 알림: 20분'이 남아요(punchWrite_)
 * 시간을 바꿔 다시 누르면 새 시간으로 다시 알려요(같은 시간·이유면 또 보내지 않아요). 등록된 내 폰에서만 돼요.
 * 돌려주는 값: {ok, late: {min, until, why}, again: 이미 알린 것, mgr: 알린 점장 수, owner: 사장님 알림이 간 곳('' = 못 감)}
 */
function lateNotice(name, pin, minutes, reason, device) {
  var p = person_(name);
  checkPin_(p, pin, false, device);
  var set = settings_();
  aheadOk_(set, p, device);
  var min = Number(minutes);
  if (LATE_MINS.indexOf(min) < 0) throw new Error('몇 분 늦는지 골라주세요.');
  var why = clean_(String(reason == null ? '' : reason).replace(/,/g, ' '), 40); // 기록 메모는 쉼표로 이어져서, 이유 안의 쉼표는 띄어쓰기로
  // 인사 정보 때문에 출근이 막혀 있으면 늦는다고 알려도 출근을 못 찍어요: 인사 정보부터 넣게 해요
  if (set.hrMust !== '안함') {
    var hs = hrStatus_(p);
    if (hs.state !== 'ok') throw new Error(hrBlockMsg_(hs));
  }
  var now = nowKst_();
  var s = aheadDay_(p, now, '');
  if (offAsked_(p.name, now.date)) throw new Error('오늘 쉬겠다는 요청을 이미 보냈어요. 나올 수 있게 됐으면 그 요청을 취소하고 다시 알려주세요.');
  var until = s.start + min;
  if (until <= now.min) throw new Error(fmtTime_(until) + '이 벌써 지났어요. 더 긴 시간을 골라주세요.');
  var old = lateGet_(p.name, now.date);
  var out = { ok: true, late: { min: min, until: fmtTime_(until), why: why }, again: false, mgr: 0, owner: '' };
  if (old && Number(old.min) === min && (old.why || '') === why) { out.again = true; return out; } // 두 번 눌러도 한 번만 알려요
  var n = (old && Number(old.n)) || (old ? 1 : 0);
  if (n >= LATE_MAX) throw new Error('오늘은 벌써 ' + LATE_MAX + '번 알렸어요. 또 바뀌면 점장님께 전화해 주세요.');
  PropertiesService.getScriptProperties().setProperty(lateKey_(p.name, now.date),
    JSON.stringify({ min: min, until: until, why: why, at: now.time, n: n + 1 }));
  var at = (workAt_(p, now.date) || {}).at || p.store; // 그날 일하는 매장(다른 매장 대타·지원이면 그 매장)
  var title = (at ? '[' + at + '] ' : '') + p.name + ' 약 ' + hm_(min) + ' 늦어요' + (why ? ' (' + why + ')' : '');
  var again = !old ? '' : Number(old.min) === min ? ' (이유를 고쳐서 다시 보내요)' : ' (아까 ' + hm_(Number(old.min)) + '이라고 했다가 바꿨어요)';
  var body = '오늘 ' + fmtTime_(s.start) + ' 출근 → ' + fmtTime_(until) + '쯤 와요.' + again +
    (started_(set, now.date) ? '\n' + fmtTime_(until + set.alertMin) + '까지 출근을 안 찍으면 그때 미출근 알림이 가요.' : ''); // 앱 시작 전에는 미출근 알림이 없어요
  out.mgr = mgrTell_(set, at, p.name, function () { return [title, body]; }); // 소리 없이
  try { out.owner = notify_(set, title, body, { silent: true }); } catch (err) { console.error(err); }
  return out;
}

/**
 * 직원 화면 [오늘 못 나가요]: 오늘 쉬겠다는 요청(병가·월차·무급)을 [휴무 신청]과 같은 길로 보내요
 * (makeRequest: 같은 검사, 같은 결재 직원 → 점장 → 관리자). 사유는 안 적어도 돼요('(안 적음)'으로 남아요). 등록된 내 폰에서만 돼요.
 * 오늘 일이라 그 매장 점장과 사장님께 바로 알려요. 결재 알림을 받은 쪽에는 같은 소식을 또 보내지 않아요
 * (점장 차례면 점장이 받았어요. 점장이 아무도 텔레그램을 안 켰으면 그 결재 알림이 사장님께 갔어요).
 * 요청을 기다리는 동안 미출근 알림이 안 가고(checkMissing), 밤 마감도 그날 '결근?'을 안 적어요(요청 처리를 기다려요).
 * 화면은 보낸 뒤 '대타도 구할까요?'를 묻고 [대타 구하기]를 오늘 날짜로 열어요(오늘은 대타를 같이 보낼 수 있어요: swapPair_).
 */
function offToday(name, pin, kind, reason, device) {
  var p = person_(name);
  checkPin_(p, pin, false, device);
  var set = settings_();
  aheadOk_(set, p, device);
  kind = String(kind == null ? '' : kind).trim();
  if (OFF_TODAY.indexOf(kind) < 0) throw new Error('병가·월차·무급·기타 가운데 골라주세요.');
  var why = clean_(reason, 100);
  if (kind === '기타' && !why) throw new Error('기타는 사유를 꼭 적어주세요. (예: 가족 일, 아이가 아파요)');
  var now = nowKst_();
  var s = aheadDay_(p, now, ' 일찍 가야 하면 점장님께 말씀해 주세요.');
  var reqs = makeRequest({ name: p.name, pin: pin, kind: 'off', offType: kind, date: now.date, reason: why || '(안 적음)', to: 'mgr', device: device });
  var r = null;
  readReqs_().forEach(function (q) { if (q.name === p.name && q.date === now.date && q.kind === kind && q.state === '대기') r = q; });
  var route = r ? r.route : '관리자';
  var at = (workAt_(p, now.date) || {}).at || p.store; // 그날 일하는 매장(다른 매장 대타·지원이면 그 매장)
  var title = (at ? '[' + at + '] ' : '') + p.name + ' 오늘 못 나와요 (' + KIND_NAME[kind] + ')';
  var body = whenOf_(now.date) + ' ' + fmtSched_(s) + ' 근무' + (why ? '\n사유: ' + why : '') + '\n대신 일할 사람을 챙겨 주세요.';
  var told = { mgr: 0, owner: '' };
  if (route === '점장') {
    // 점장이 결재 알림을 받았으면 사장님께만 알려요(아무 점장도 못 받았으면 결재 알림이 이미 사장님께 갔어요)
    var mgrs = managersOf_(p.store, p.name);
    if (reqs && reqs.toMgr) { // 결재 알림이 점장 텔레그램에 실제로 갔을 때만(못 갔으면 결재 알림이 사장님께 갔어요)
      try { told.owner = notify_(set, title, body + '\n' + KIND_NAME[kind] + ' 요청은 ' + mgrs.join(', ') + ' 점장이 먼저 봐요(사장님이 바로 승인해도 돼요).'); } catch (err) { console.error(err); }
    }
  } else {
    // 결재 알림은 사장님이 받았어요: 그 매장 점장에게만(본인이 점장이면 다른 점장에게). 오늘 일이라 소리 나게
    told.mgr = mgrTell_(set, p.store, p.name, function () { return [title, body]; }, {});
  }
  if (at && at !== p.store) told.mgr += mgrTell_(set, at, p.name, function () { return [title, body]; }, {}); // 오늘 일하러 가는 매장 점장에게도
  var nobody = !(reqs && reqs.sentTo) && !told.owner && !told.mgr; // 결재 알림도, 따로 보낸 알림도 아무에게도 안 갔어요(텔레그램·메일 연결 전)
  if (reqs) { delete reqs.toMgr; delete reqs.sentTo; }
  return { reqs: reqs, kind: kind, route: route, told: told, nobody: nobody };
}

/** [늦어요]·[오늘 못 나가요]를 쓸 수 있는 사람인지: 테스트 직원은 안 돼요. 폰 확인을 하는 가게에서 폰이 등록된 직원은 그 폰(2대까지)에서만. */
function aheadOk_(set, p, device) {
  if (p.name === TEST_NAME) throw new Error('테스트 직원은 이 버튼을 쓸 수 없어요. 출근·퇴근 찍기로 시험해 주세요.');
  if (set.device === '안함' || !(p.deviceIds || []).length || hasDev_(p, cleanDevId_(device))) return;
  throw new Error('출퇴근을 찍는 내 폰(등록된 폰)에서만 보낼 수 있어요. 급하면 점장님께 전화해 주세요.');
}

/** 오늘 근무가 있고 아직 출근을 안 찍었는지 보고, 오늘 근무시간 {start, end}를 돌려줘요. tail: 이미 출근했을 때 덧붙일 말. */
function aheadDay_(p, now, tail) {
  var s = schedFor_(p, now.date);
  if (!s) throw new Error('오늘은 근무 예정이 없어요.');
  var f = findLog_(sheet_(SHEETS.log), now.date, p.name);
  var tin = f ? parseTime_(f.vals[C.tIn]) : null;
  if (tin != null) throw new Error('오늘은 이미 ' + fmtTime_(tin) + '에 출근을 찍었어요.' + (tail || ''));
  return s;
}

/**
 * 그날 쉬겠다고 보낸 요청이 있는지: 휴무·월차·병가·반차·휴무 바꾸기 등이 기다리는 중이거나 승인됨(reqLive_).
 * 대타는 받은 동료가 있을 때만(못 구하면 본인이 나와야 해요. 밤 마감 '결근?'과 같은 기준).
 * 이런 사람에게는 출근 전·미출근 알림을 안 보내고, [늦어요]도 안 받아요.
 */
function offAsked_(name, date) {
  return readReqs_().some(function (q) {
    return q.name === name && q.date === date && isDayOffKind_(q.kind) && !(q.kind === '대타' && !q.taker) && reqLive_(q);
  });
}

/** 하루를 다 쉬는 휴무 종류(반차 말고). */
function fullOff_(k) { return OFF_KINDS.indexOf(k) >= 0 && k !== '반차'; }

/**
 * 같은 날 같이 둘 수 있는 요청 짝: 오늘 날짜의 대타 + 하루 쉬는 요청(병가·월차·무급 등, 반차 말고).
 * [오늘 못 나가요]로 병가를 보낸 뒤 대타도 구할 수 있게요(대타가 승인돼도 병가·월차 칸은 그대로예요: applyReq_).
 */
function swapPair_(a, b, date, today) {
  return date === today && ((a === '대타' && fullOff_(b)) || (b === '대타' && fullOff_(a)));
}

/** [늦어요] 기록을 두는 곳(스크립트 속성). 'dm:'으로 시작해서 날짜가 지나고 3일 뒤 저절로 지워져요(checkMissing). */
function lateKey_(name, date) { return 'dm:' + date + ':late:' + name; }

/** [늦어요]로 그날 알린 것 {min, until(분), why, at, n} 또는 null. all: 미리 읽어 둔 속성 전체(10분 검사에서 한 번에 읽어요). */
function lateGet_(name, date, all) {
  var k = lateKey_(name, date);
  var v = all ? all[k] : PropertiesService.getScriptProperties().getProperty(k);
  try {
    var o = JSON.parse(v || 'null');
    return o && LATE_MINS.indexOf(Number(o.min)) >= 0 && typeof o.until === 'number' ? o : null;
  } catch (err) {
    return null;
  }
}

/** 직원 화면에 보여줄 오늘 [늦어요] {min, until: 'HH:MM', why} 또는 null. */
function lateView_(name, date) {
  var o = lateGet_(name, date);
  return o ? { min: Number(o.min), until: fmtTime_(o.until), why: o.why || '' } : null;
}

/** 출근 기록 메모에 남길 말: '미리 알림: 20분(지하철 지연)'. [늦어요]를 안 눌렀으면 ''. */
function lateMemo_(name, date) {
  var o = lateGet_(name, date);
  return o ? '미리 알림: ' + hm_(Number(o.min)) + (o.why ? '(' + o.why + ')' : '') : '';
}

function getMyMonth(name, pin, ym) {
  var p = person_(name);
  checkPin_(p, pin);
  var now = nowKst_();
  ym = validYm_(ym) || now.ym;
  var rows = monthRows_(ym).filter(function (r) { return r.name === p.name; });
  return { ym: ym, rows: rows, total: total_(rows, now.date) };
}

/**
 * 직원 화면을 열 때 한 번에: 오늘 근무, 요청·대타, 퇴근 누락, 쉬운 비밀번호 여부.
 * (예전에는 3번 나눠 불러서 느렸어요)
 */
function getHome(name, pin) {
  var p = person_(name);
  var now = nowKst_();
  var full = todayFor_(p);
  var out = { today: maskToday_(full), requests: null, missingOut: null, weakPin: false, pinError: '' }; // 비밀번호가 맞기 전에는 출근·퇴근 시각을 가려요
  var gate = function () { // 인사 정보: 빠진 칸 이름만(값은 안 보내요). block = 다 넣어야 출근이 찍혀요
    var st = hrStatus_(p);
    out.hr = st.state === 'need'; out.hrMissing = st.missing; out.hrWait = st.state === 'wait'; out.hrBlock = settings_().hrMust !== '안함';
  };
  if (!p.pin) { out.first = true; gate(); return out; } // 처음 온 직원: 인사 정보부터 넣고 그때 비밀번호를 정해요
  if (!String(pin == null ? '' : pin).trim()) return out;
  try {
    checkPin_(p, pin);
  } catch (err) {
    out.pinError = err.message;
    out.pinWrong = /틀렸어요/.test(err.message); // 폰에 기억된 옛 비밀번호면 화면이 지워서, 열 때마다 틀린 횟수가 쌓이지 않게
    return out;
  }
  out.today = full;
  out.requests = reqsFor_(p.name);
  out.weakPin = weakPin_(p, staff_());
  out.missingOut = settings_().outCheck === '함' ? missingOut_(p.name, now.date) : null; // [설정] 퇴근확인이 안함이면 '퇴근 누락' 안내를 안 띄워요
  out.late = lateView_(p.name, now.date); // [늦어요]로 오늘 알린 것(다시 열어도 화면에 보여요)
  gate(); // 인사 정보를 다 넣기 전에는 출근이 안 찍혀요([설정] 인사정보필수)
  out.absent = absentDays_(p.name, now.date); // 휴무표에 '결근?'으로 적힌 지난 날(14일 안) → 첫 화면 띠
  out.leave = leaveNow_(p.name, now.ym); // 남은 월차·대체휴무(신청 화면에 보여줘요)
  try { out.notices = noticesFor_(p, now); } catch (err) { console.error(err); out.notices = []; } // 공지(안 읽은 것은 맨 위에)
  // 텔레그램 알림: 사장님이 봇을 연결했을 때만 직원이 켤 수 있어요 ('' = 못 씀, 'off' = 꺼짐, 'on' = 켜짐)
  var set = settings_();
  out.tg = set.tgToken ? (p.tg ? 'on' : 'off') : '';
  // 다음 달 휴무를 고를 수 있는 기간이면 화면 위에 알려줘요
  var w = wishOpen_(set, now, p.name);
  out.wish = { open: w.open, ym: w.ym, text: w.text };
  return out;
}

/**
 * 지난 14일 중 휴무표에 '결근?'(밤 마감이 적은 것)으로 남아 있고 아직 요청을 안 보낸 날. 가까운 날부터 3개까지.
 * 사장님이 직접 적은 '결근'·'무단'은 넣지 않아요(확정한 날에 띠가 계속 뜨면 곤란해서).
 */
function absentDays_(name, today) {
  var out = [], reqs = readReqs_();
  for (var i = 1; i <= 14 && out.length < 3; i++) {
    var d = addDays_(today, -i);
    if (dayMark_(name, d) !== '결근?') continue;
    if (reqs.some(function (q) { return q.name === name && q.date === d && (q.state === '대기' || q.state === '수락'); })) continue;
    out.push({ date: d, dow: DOW[dowOf_(d)], until: addDays_(d, 14) });
  }
  return out;
}

/** 지금 남은 월차(이번 달 휴무표 잔여 칸. 모르면 null)와 대체휴무(신청 중인 것 빼고). */
function leaveNow_(name, ym) {
  var g = monthGrid_(ym), r = g && g.rows[name];
  var left = r ? String(r.vals[g.cols.left] || '').trim() : '';
  var sub = subBalance_(name);
  return { monthly: /^-?\d+(\.\d+)?$/.test(left) ? Number(left) : null, sub: Math.round((sub.left - sub.pending) * 10) / 10 };
}

/**
 * 내 월차 내역(그 해): 달마다 이월·부여·사용(쓴 날짜)·잔여·만근. 근무표 카드의 [내 월차 내역]에서 봐요.
 * 직원이 "왜 이번 달에 월차가 안 생겼지?"를 스스로 확인할 수 있게요.
 */
function getLeave(name, pin, year) {
  var p = person_(name);
  checkPin_(p, pin);
  var now = nowKst_();
  year = validYear_(year) || now.date.slice(0, 4);
  var d = yearData_(year, [p.name])[p.name];
  var months = [];
  d.months.forEach(function (m) {
    if (!m.row || (year === now.date.slice(0, 4) && m.ym > nextYm_(now.ym))) return;
    var g = monthGrid_(m.ym), r = g.rows[p.name], dates = [];
    for (var day = 1; day <= daysIn_(m.ym); day++) {
      if (/월차/.test(String(r.vals[g.cols.day1 + day - 1] || ''))) dates.push(day);
    }
    months.push({ m: m.m, ym: m.ym, grant: m.grant, used: m.monthly, left: m.monthlyLeft, full: m.full, dates: dates });
  });
  var cur = null;
  months.forEach(function (m) { if (m.ym <= now.ym) cur = m; });
  return {
    year: year, thisYear: year === now.date.slice(0, 4), month: Number(now.ym.slice(5)), months: months,
    left: cur ? cur.left : null, sub: leaveNow_(p.name, now.ym).sub,
  };
}

/** 지난 7일 중 출근만 찍고 퇴근을 안 찍은 가장 최근 날 (정정 요청을 이미 보냈으면 빼요). */
function missingOut_(name, today) {
  var tail = logTail_();
  if (tail.last < 2) return null;
  var vals = tail.vals;
  var asked = {};
  readReqs_().forEach(function (r) {
    if (r.name === name && r.kind === '정정' && r.state === '대기' && r.what.indexOf('퇴근') === 0) asked[r.date] = true;
  });
  for (var i = vals.length - 1; i >= 0; i--) {
    var v = vals[i];
    var d = parseDate_(v[C.date]);
    if (String(v[C.name]).trim() !== name || !d || d >= today) continue;
    var ago = daysBetween_(d, today);
    if (ago > 7) continue;
    if (fmtTime_(parseTime_(v[C.tIn])) && !fmtTime_(parseTime_(v[C.tOut])) && !asked[d]) {
      return { date: d, dow: DOW[dowOf_(d)], tIn: fmtTime_(parseTime_(v[C.tIn])) };
    }
  }
  return null;
}

/** 직원이 직접 비밀번호 바꾸기. */
function changePin(name, pin, newPin) {
  var p = person_(name);
  if (!p.pin) throw new Error('아직 비밀번호가 없어요. 출근을 찍을 때 정하면 돼요.');
  checkPin_(p, pin);
  newPin = String(newPin == null ? '' : newPin).trim();
  if (!/^\d{4,6}$/.test(newPin)) throw new Error('새 비밀번호는 숫자 4~6자리로 정해주세요.');
  if (newPin === p.pin) throw new Error('지금 비밀번호와 같아요. 다른 번호로 정해주세요.');
  if (EASY_PINS.indexOf(newPin) >= 0) throw new Error('너무 쉬운 번호예요(1234, 0000 같은). 다른 번호로 정해주세요.');
  setStaffCell_(p.row, 'PIN', newPin);
  return { ok: true };
}

/* ───────────── 직원 화면: 근무표 보기, 다음 달 휴무 고르기 ───────────── */

/**
 * 우리 매장 한 달 근무표(누가 언제 쉬는지), 공휴일, 내 휴무·월차·대체휴무.
 * 동료 칸은 쉬는 날·대타만 보여줘요(지각 시간·결근 표시는 본인만).
 */
function getSchedule(name, pin, ym) {
  var p = person_(name);
  checkPin_(p, pin);
  var now = nowKst_();
  ym = validYm_(ym) || now.ym;
  if ([prevYm_(now.ym), now.ym, nextYm_(now.ym)].indexOf(ym) < 0) throw new Error('지난달·이번 달·다음 달만 볼 수 있어요.');
  return schedule_(p, ym, now);
}

/**
 * 다음 달 휴무 고르기(on=true) / 빼기(on=false). 휴무표에 '휴무?'로 적고, 사장님이 확정하면 '휴무'가 돼요.
 * 규칙: 신청 기간, 휴무금지일, 하루 최대 인원(매장 최대휴무), 한 달 최대 일수(매장 월휴무).
 */
function wishDay(name, pin, date, on) {
  var p = person_(name);
  checkPin_(p, pin);
  var set = settings_();
  var now = nowKst_();
  var ym = nextYm_(now.ym);
  date = parseDate_(date);
  if (!date || date.slice(0, 7) !== ym) throw new Error('다음 달(' + Number(ym.slice(5)) + '월) 날짜만 고를 수 있어요.');
  var w = wishOpen_(set, now, p.name);
  if (!w.open) throw new Error(w.msg);
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('지금 고르는 사람이 많아요. 잠깐 뒤에 다시 눌러주세요.');
  try {
    var g = monthGrid_(ym, true);
    if (!g || !g.rows[p.name]) { ensureMonth_(ym); g = monthGrid_(ym, true); }
    if (!g || !g.rows[p.name]) throw new Error(ym + ' 휴무표에 이름이 없어요. 사장님께 말씀해주세요.');
    var cur = dayMark_(p.name, date);
    var day = mmdd_(date) + '(' + DOW[dowOf_(date)] + ')';
    if (on) {
      if (cur !== '휴무?') {
        if (cur) throw new Error(day + '은 이미 "' + cur + '"(이)라고 적혀 있어요.');
        var base = String(p.week[dowOf_(date)] || '').trim();
        if (base && !parseSchedule_(base)) throw new Error(day + '은 원래 쉬는 날이에요.');
        if (blockedDay_(set, date)) throw new Error(day + '은 휴무를 고를 수 없는 날이에요. (사장님이 막아 둔 날)');
        var st = storeOf_(p.store);
        var offs = offNames_(p.store, date, p.name);
        if (st && st.maxOff > 0 && offs.length >= st.maxOff) {
          throw new Error(day + '은 이미 ' + offs.join(', ') + ' 님이 쉬어요. (' + p.store + ' 하루 최대 ' + st.maxOff + '명)');
        }
        var mine = monthOffCount_(p.name, ym);
        if (st && st.monthOff > 0 && mine >= st.monthOff) {
          throw new Error('한 달에 휴무는 ' + st.monthOff + '일까지 고를 수 있어요. 고른 날을 하나 빼고 다시 골라주세요.');
        }
        setMark_(date, p.name, function () { return '휴무?'; });
      }
    } else if (cur === '휴무?') {
      setMark_(date, p.name, function () { return ''; });
    } else if (cur) {
      throw new Error(day + '의 "' + cur + '"는 확정된 거라 앱에서 못 빼요. 사장님께 말씀해주세요.');
    }
  } finally {
    lock.releaseLock();
  }
  return schedule_(p, ym, now);
}

/**
 * 다음 달 휴무 고르기: 화면에서 여러 날을 고른 뒤 [저장]을 누르면 한 번에 적어요(날마다 서버를 부르지 않아서 빨라요).
 * list = [{date: '2026-12-05', v: '휴무' | '월차' | '병가' | … | '기타' | '', why: '치과 수술'}]  ('' = 고른 것 빼기).
 * 휴무표에 '휴무?'·'월차?'·'병가?'처럼 적고, 사장님이 확정하면 '?'가 빠져요. 이유는 그 칸 메모에 '사유: …'로 남겨요.
 *  - 휴무·월차: 신청 기간, 원래 쉬는 날, 휴무금지일, 하루 최대 인원, 한 달 최대 휴무, 월차는 다음 달에 쓸 수 있는 개수까지.
 *  - 그 밖의 종류(병가·경조·예비군·휴가·무급·기타): 사정이 있는 날이라 휴무금지일·하루 최대 인원으로 막지 않아요(사장님이 보고 정해요).
 *    기타는 이유를 꼭 적어요.
 * 안 되는 날은 빼고 나머지는 저장해요. {sched, saved: [{date, v}], errors: [{date, msg}]}
 */
function wishSave(name, pin, list, device) {
  var p = person_(name);
  checkPin_(p, pin, false, device);
  var set = settings_();
  var now = nowKst_();
  var ym = nextYm_(now.ym);
  var w = wishOpen_(set, now, p.name);
  if (!w.open) throw new Error(w.msg);
  var items = [].concat(list || []).slice(0, 62).map(function (x) {
    var v = x && WISH_KINDS.indexOf(x.v) >= 0 ? x.v : '';
    return { date: parseDate_(x && x.date), v: v, why: v && WHY_KINDS.indexOf(v) >= 0 ? clean_(x.why, 40) : '' };
  }).filter(function (x) { return x.date && x.date.slice(0, 7) === ym; });
  // 빼는 것부터(그래야 한 달 최대 일수·월차 개수가 맞게 세져요)
  items.sort(function (a, b) { return (a.v ? 1 : 0) - (b.v ? 1 : 0); });
  var saved = [], errors = [];
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) throw new Error('지금 저장하는 사람이 많아요. 잠깐 뒤에 다시 눌러주세요.');
  try {
    var g = monthGrid_(ym, true);
    if (!g || !g.rows[p.name]) { ensureMonth_(ym); g = monthGrid_(ym, true); }
    if (!g || !g.rows[p.name]) throw new Error(Number(ym.slice(5)) + '월 휴무표에 이름이 없어요. 사장님께 말씀해주세요.');
    var r = g.rows[p.name], n = daysIn_(ym), base = g.cols.day1, vals = [];
    for (var d0 = 1; d0 <= n; d0++) vals.push(String(r.vals[base + d0 - 1] || '').trim());
    var orig = vals.slice();
    // 칸 메모(사유)는 사유가 있는 종류를 고르거나 그런 칸을 바꿀 때만 읽어요
    var needNotes = items.some(function (it) { return it.why || WHY_KINDS.indexOf(String(vals[Number(it.date.slice(8)) - 1]).replace(/\?$/, '')) >= 0; });
    var notes = needNotes ? g.sh.getRange(r.row, base + 1, 1, n).getNotes()[0].map(String) : null;
    var notes0 = notes ? notes.slice() : null;
    var st = storeOf_(p.store);
    // 다음 달에 쓸 수 있는 월차 = 다음 달 잔여(이미 적힌 월차를 뺀 값) + 이미 적힌 월차. 잔여를 못 읽으면(수식 오류 등) 개수는 안 막아요
    var leftTxt = String(r.vals[g.cols.left] || '').trim();
    var usedNow = orig.filter(function (m) { return /월차/.test(m); }).length;
    var pool = /^-?\d+(\.\d+)?$/.test(leftTxt) ? Number(leftTxt) + usedNow : null;
    items.forEach(function (it) {
      var d = Number(it.date.slice(8)), cur = vals[d - 1];
      var day = mmdd_(it.date) + '(' + DOW[dowOf_(it.date)] + ')';
      try {
        var nv = it.v ? it.v + '?' : '';
        var whyNow = notes ? noteWhy_(notes[d - 1]) : '';
        if (nv === cur && (!it.v || WHY_KINDS.indexOf(it.v) < 0 || it.why === whyNow)) return;
        if (cur && !WISH_RE.test(cur)) throw new Error(day + '은 이미 "' + cur + '"(이)라고 적혀 있어요. 바꾸려면 사장님께 말씀해주세요.');
        if (it.v) {
          var wk = String(p.week[dowOf_(it.date)] || '').trim();
          if (wk && !parseSchedule_(wk)) throw new Error(day + '은 원래 쉬는 날이에요.');
          if (it.v === '기타' && !it.why) throw new Error(day + ': 기타는 이유를 적어주세요. (예: 가족 일, 이사)');
          var basic = it.v === '휴무' || it.v === '월차';
          if (basic && blockedDay_(set, it.date)) throw new Error(day + '은 휴무를 고를 수 없는 날이에요. (사장님이 막아 둔 날)');
          if (basic && !cur) {
            var offs = offNames_(p.store, it.date, p.name);
            if (st && st.maxOff > 0 && offs.length >= st.maxOff) throw new Error(day + '은 이미 ' + offs.join(', ') + ' 님이 쉬어요. (' + p.store + ' 하루 최대 ' + st.maxOff + '명)');
          }
          var others = vals.filter(function (m, i) { return i !== d - 1; });
          if (it.v === '휴무' && st && st.monthOff > 0 && others.filter(function (m) { return /휴무/.test(m); }).length >= st.monthOff) {
            throw new Error(day + ': 한 달에 휴무는 ' + st.monthOff + '일까지 고를 수 있어요.');
          }
          if (it.v === '월차' && pool != null && others.filter(function (m) { return /월차/.test(m); }).length >= pool) {
            throw new Error(day + ': 다음 달에 쓸 수 있는 월차가 ' + Math.max(0, pool) + '개라서 더 고를 수 없어요.');
          }
        }
        vals[d - 1] = nv;
        if (notes) notes[d - 1] = noteWithWhy_(notes[d - 1], it.why);
        saved.push({ date: it.date, v: it.v });
      } catch (err) {
        errors.push({ date: it.date, msg: err.message });
      }
    });
    // 바뀐 칸만 한 번에 써요
    var a = -1, b = -1;
    for (var i = 0; i < n; i++) if (vals[i] !== orig[i]) { if (a < 0) a = i; b = i; }
    if (a >= 0) {
      g.sh.getRange(r.row, base + a + 1, 1, b - a + 1).setNumberFormat('@').setValues([vals.slice(a, b + 1)]);
      for (var j = a; j <= b; j++) r.vals[base + j] = vals[j];
    }
    if (notes) {
      var na = -1, nb = -1;
      for (var k = 0; k < n; k++) if (notes[k] !== notes0[k]) { if (na < 0) na = k; nb = k; }
      if (na >= 0) g.sh.getRange(r.row, base + na + 1, 1, nb - na + 1).setNotes([notes.slice(na, nb + 1)]);
    }
  } finally {
    lock.releaseLock();
  }
  return { sched: schedule_(p, ym, now), saved: saved, errors: errors };
}

/** 칸 메모에서 사유 줄('사유: …')만 꺼내요. */
function noteWhy_(note) {
  var m = /(?:^|\n)사유: ([^\n]*)/.exec(String(note || ''));
  return m ? m[1].trim() : '';
}

/** 칸 메모의 사유 줄을 바꿔요(why가 비면 지워요). 다른 줄(사장님이 바꾼 기록 등)은 그대로 둬요. */
function noteWithWhy_(note, why) {
  var lines = String(note || '').split('\n').filter(function (l) { return l.trim() && !/^사유: /.test(l); });
  if (why) lines.unshift('사유: ' + why);
  return lines.join('\n');
}

/** 휴무표 그날 칸 메모의 사유 줄을 바꿔요(요청 승인·취소). why가 비면 사유 줄을 지워요. */
function setWhy_(date, name, why) {
  if (!inMonth_(date)) return;
  var g = monthGrid_(date.slice(0, 7)), r = g && g.rows[name];
  if (!r) return;
  var cell = g.sh.getRange(r.row, g.cols.day1 + Number(date.slice(8)));
  var prev = String(cell.getNotes()[0][0] || '');
  var next = noteWithWhy_(prev, clean_(why, 40));
  if (next !== prev) cell.setNote(next);
}

/** 직원 텔레그램 알림 켜기 1단계: 봇 링크를 만들어요. 직원이 링크를 열고 [시작]을 누르면 2단계(staffTgCheck). */
function staffTgStart(name, pin) {
  var set = settings_();
  var p = person_(name);
  checkPin_(p, pin);
  if (!set.tgToken) throw new Error('사장님이 아직 텔레그램 알림을 연결하지 않았어요.');
  var bot = set.tgBot;
  if (!bot) {
    try { bot = String(tgCall_(set.tgToken, 'getMe', null, { wait: true }).username || ''); } catch (err) {
      if (tgKind_(err) === 'busy') throw new Error(tgBusyText_(err, '그 뒤에 다시 눌러 주세요.'));
      throw err;
    }
    if (bot) setSetting_(K.tgBot, bot);
  }
  if (!bot) throw new Error('텔레그램 봇 정보를 읽지 못했어요. 사장님께 말씀해주세요.');
  var code = 'g' + Utilities.getUuid().replace(/-/g, '').slice(0, 15);
  CacheService.getScriptCache().put('tglink:' + p.name, code, 1800);
  return { bot: bot, url: 'https://t.me/' + bot + '?start=' + code };
}

/** 2단계: 봇이 받은 '/start 코드' 메시지로 직원 채팅방을 찾아 [직원] 텔레그램 칸에 저장해요. */
function staffTgCheck(name, pin) {
  var set = settings_();
  var p = person_(name);
  checkPin_(p, pin);
  if (!set.tgToken) throw new Error('사장님이 아직 텔레그램 알림을 연결하지 않았어요.');
  var code = CacheService.getScriptCache().get('tglink:' + p.name);
  if (!code) throw new Error('연결 시간(30분)이 지났어요. [텔레그램 알림 켜기]를 다시 눌러주세요.');
  var u;
  try {
    u = tgFind_(set.tgToken, function (x) {
      return x.message && x.message.chat && String(x.message.text || '').trim() === '/start ' + code;
    });
  } catch (err) {
    if (tgKind_(err) === 'busy') throw new Error(tgBusyText_(err, '그 뒤에 ②를 다시 눌러 주세요(①은 다시 안 눌러도 돼요. 연결 코드는 30분 동안 그대로예요).'));
    throw err;
  }
  if (!u) throw new Error('아직 연결 전이에요. 텔레그램 봇 화면에서 [시작]을 누른 뒤 다시 눌러주세요.');
  setStaffCell_(p.row, '텔레그램', String(u.message.chat.id));
  CacheService.getScriptCache().remove('tglink:' + p.name);
  p.tg = String(u.message.chat.id);
  notifyStaff_(set, p, '알림 연결 완료', p.name + ' 님, 앞으로 요청 결과·대타 구함·출근 알림이 여기로 와요. 끄려면 출퇴근 앱에서 [알림 끄기]를 누르세요.');
  return { tg: 'on' };
}

function staffTgOff(name, pin) {
  var p = person_(name);
  checkPin_(p, pin);
  setStaffCell_(p.row, '텔레그램', '');
  return { tg: settings_().tgToken ? 'off' : '' };
}

/* ───────────── 사장님 화면에서 부르는 함수 ───────────── */

/**
 * 사장님 화면 [오늘]. cred = 관리자 비밀번호(글자) 또는 점장 {name, pin}.
 * 점장은 자기 매장 직원만 보고, 폰 승인·비밀번호·텔레그램·정산은 안 보여요.
 */
function adminToday(cred) {
  var t0 = Date.now(); // 서버에서 걸린 시간(화면 맨 아래 '불러오는 데 …초')
  var a = auth_(cred);
  var set = a.set;
  var admin = a.role === 'admin';
  var now = nowKst_();
  var logs = logRows_(now.date);
  var tries = tryToday_(now.date, logs); // 막힌 출근을 처음 누른 시각(아직 출근 기록이 없는 사람만)
  var stores = stores_();
  var ctx = { changes: changes_(), stores: stores };
  var active = sortByStore_(staff_().filter(function (p) { return p.active && canSee_(a, p); }), stores);
  var names = active.map(function (p) { return p.name; });
  var list = active.map(function (p) {
    var r = null;
    logs.forEach(function (x) { if (x.name === p.name) r = x; });
    var s = schedFor_(p, now.date, ctx);
    var mark = dayMark_(p.name, now.date);
    var sIn = r ? r.sIn : (s ? fmtTime_(s.start) : '');
    var sOut = r ? r.sOut : (s ? fmtTime_(s.end) : '');
    var changed = null;
    ctx.changes.forEach(function (c) { if (parseDate_(c[0]) === now.date && String(c[1]).trim() === p.name) changed = String(c[2]); });
    var offDay = OFF_RE.test(mark) || OFF_RE.test(String(p.week[now.dow] || '')) || (changed !== null && !parseSchedule_(changed));
    var status;
    if (r && r.tOut) status = '퇴근';
    else if (r && r.tIn) status = '근무중';
    else if (!sIn) status = offDay ? '휴무' : '시간 미정';
    else if (!employedOn_(p.name, now.date)) status = '입사 전';
    else if (started_(set, now.date) && now.min > parseTime_(sIn) + set.grace) status = '미출근';
    else status = '출근 전';
    return {
      tried: tries[p.name] || null, // 막힌 출근 시도 {time, dist, why…} → [10:58로 대신 찍기]
      name: p.name, store: p.store, sIn: sIn, sOut: sOut,
      tIn: r ? r.tIn : '', tOut: r ? r.tOut : '',
      late: r ? r.late : 0, early: r ? r.early : 0, status: status,
      mark: OFF_RE.test(mark) ? mark : '',
      place: r && r.place && r.place !== p.store ? r.place : '',
      hrOk: set.hrMust === '안함' || hrStatus_(p).state === 'ok', // 인사 정보를 다 넣었는지(점장은 안 넣은 직원을 대신 출근 찍을 수 없어요)
    };
  });
  var subs = admin ? subTotals_() : {};
  return {
    role: a.role, me: a.name, myStores: a.stores || [],
    startDate: set.startDate, started: started_(set, now.date),
    oldSrc: admin ? set.oldSrc : '', oldImport: admin ? oldInfo_() : null,
    // 예전 휴무표를 아직 안 가져왔고 지난달 탭도 없어요: 월차(이월·부여)가 0부터 시작해요 → [오늘] 맨 위에 알려요
    noOld: admin && !oldInfo_() && !monthSheet_(prevYm_(now.ym)),
    gone: !admin ? [] : hrRows_().filter(function (h) { return h.state === '퇴사'; }).map(function (h) { return h.name; }),
    dups: admin ? dupNames_() : [], // [직원] 탭에 근무 중인 같은 이름이 두 줄
    ghosts: admin ? sameAsGone_() : [], // 퇴사한 같은 이름 줄이 있는 새 직원(같은 사람인지 확인 필요)
    date: now.date, dow: DOW[now.dow], time: now.time, list: list, info: info_(set, a),
    holiday: holidays_()[now.date] || '',
    pending: !admin ? [] : active.filter(function (p) { return devId_(p.request); }).map(function (p) {
      // have: 지금 등록된 폰들(1대면 [추가]로 2대째 등록할 수 있어요)
      return { name: p.name, label: devText_(p.request), have: devParts_(p.device).map(devLabel_), tried: tries[p.name] || null };
    }),
    devices: !admin ? [] : active.map(function (p) {
      return {
        name: p.name, store: p.store, label: p.deviceId ? devParts_(p.device).map(devText_).join(' / ') : '',
        pin: !p.pin ? '미정' : weakPin_(p, active) ? '쉬움' : '정함', agreed: p.agreed,
        tg: !!p.tg, sub: subs[p.name] || 0,
      };
    }),
    waiting: admin ? [] : hrRows_().filter(function (h) { return h.state === HR_WAIT && a.stores.indexOf(h.store) >= 0; }).map(function (h) {
      return { name: h.name, store: h.store, start: h.start }; // 점장: 자기 매장에 승인을 기다리는 신입이 있다는 것만(승인은 사장님)
    }),
    hrDue: !admin ? [] : hrDueList_(now.date, 30), // 30일 안에 끝나는 수습·계약(사장님만)
    joins: !admin ? [] : hrRows_().filter(function (h) { return h.state === HR_WAIT; }).map(function (h) {
      var prev = hrFind_(h.name); // 예전에 다닌 같은 이름(퇴사자)
      var jj = parseJoin_(h.join);
      var regAt = /^(\d{4}-\d{2}-\d{2}) (\d{1,2}:\d{2})/.exec(h.reg || '');
      return {
        name: h.name, store: h.store, start: h.start, phone: h.phone, phone2: h.phone2, birth: birthLabel_(h.rrn), at: h.reg,
        addr: h.addr, bank: h.bank, account: h.account ? '끝자리 ' + h.account.replace(/\D/g, '').slice(-4) : '', emergency: h.emergency,
        device: jj.label || '', noAccount: !h.account,
        // 입사일이 오늘이고 오늘 등록했으면 '등록 보낸 시각을 오늘 출근으로' 할 수 있어요
        firstIn: regAt && regAt[1] === now.date && h.start <= now.date ? regAt[2] : '',
        prev: !prev ? null : {
          store: prev.store, end: prev.end, birth: birthLabel_(prev.rrn),
          other: !!(prev.rrn && h.rrn && prev.rrn.slice(0, 8) !== h.rrn.slice(0, 8)), // 생년월일이 달라요 = 다른 사람
        },
      };
    }),
    suspects: suspectsOn_(now.date).filter(function (s) { return admin || names.indexOf(s.name) >= 0; }),
    requests: openReqsForAdmin_(now.date, a),
    notices: (function () { try { return noticeView_(a); } catch (err) { console.error(err); return []; } })(),
    health: healthFor_(a, now), // 맨 위 빨간 띠: 자동 실행 멈춤·텔레그램 실패·웹 앱 예전 버전(관리자만)
    ms: Date.now() - t0,
  };
}

/** 새 폰 승인(ok=true) 또는 거절. 승인하면 예전 폰으로는 더 이상 안 찍혀요. */
function adminDevice(pin, name, ok, mode) {
  adminAuth_(pin);
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var people = staff_();
    var p = findStaff_(String(name == null ? '' : name).trim());
    if (!p) throw new Error('직원을 찾을 수 없어요.');
    var id = devId_(p.request);
    if (!id) throw new Error('승인 대기 중인 폰이 없어요. 새로고침 해주세요.');
    if (ok) {
      people.forEach(function (x) {
        if (x.active && x.name !== p.name && hasDev_(x, id)) throw new Error('이 폰은 ' + x.name + ' 님 폰으로 등록돼 있어서 승인할 수 없어요.');
      });
      var entry = devCell_(id, devLabel_(p.request), mmdd_(nowKst_().date) + ' 승인');
      if (mode === 'add') {
        // 폰을 2대 쓰는 사람(개인폰·업무폰): 예전 폰도 그대로 쓰고 새 폰을 더해요(2대까지)
        var have = devParts_(p.device);
        if (have.length >= 2 || devIds_(p.device).length >= 2) throw new Error('이미 폰이 2대 등록돼 있어요. [바꾸기]를 누르면 예전 폰들은 못 쓰고 이 폰만 등록돼요.');
        setStaffCell_(p.row, '등록폰', have.concat([entry]).join(' | '));
      } else {
        setStaffCell_(p.row, '등록폰', entry); // 바꾸기: 예전 폰으로는 더 못 찍어요
      }
    }
    setStaffCell_(p.row, '새폰요청', '');
  } finally {
    lock.releaseLock();
  }
  return adminToday(pin);
}

/** 사장님이 직원 비밀번호를 미리 정하거나 바꿔줘요(잊어버렸을 때). 빈칸이면 지워서 첫 출근 때 직원이 정해요. */
function adminSetPin(pin, name, newPin) {
  adminAuth_(pin);
  var p = null;
  staff_().forEach(function (x) { if (x.name === String(name == null ? '' : name).trim()) p = x; });
  if (!p) throw new Error('직원을 찾을 수 없어요.');
  newPin = String(newPin == null ? '' : newPin).trim();
  if (newPin && !/^\d{4,6}$/.test(newPin)) throw new Error('비밀번호는 숫자 4~6자리로 정해주세요.');
  setStaffCell_(p.row, 'PIN', newPin);
  // 잠김도 풀어줘요(이름 잠금, 그 사람 폰마다의 잠금, 점장 화면 잠금)
  var cache = CacheService.getScriptCache();
  ['fail:pin:' + p.name, 'fail:mgr:' + p.name + ':all'].concat((p.deviceIds || []).map(function (d) { return 'fail:pin:' + p.name + ':' + d; })).forEach(function (k) { cache.remove(k); });
  return adminToday(pin);
}

/** 사장님이 직원 폰 등록을 지워요. 다음에 찍는 폰이 새로 등록돼요. */
function adminResetDevice(pin, name) {
  adminAuth_(pin);
  var p = null;
  staff_().forEach(function (x) { if (x.name === String(name == null ? '' : name).trim()) p = x; });
  if (!p) throw new Error('직원을 찾을 수 없어요.');
  setStaffCell_(p.row, '등록폰', '');
  setStaffCell_(p.row, '새폰요청', '');
  return adminToday(pin);
}

/** 월별 합계·기록. 점장은 자기 매장 직원만, 차감액은 빼고 봐요. */
function adminMonth(cred, ym) {
  var a = auth_(cred);
  ym = validYm_(ym) || nowKst_().ym;
  if (a.role === 'admin') return monthData_(ym);
  var names = staff_().filter(function (p) { return canSee_(a, p); }).map(function (p) { return p.name; });
  // [직원] 줄을 지운 그달 퇴사자: 휴무표 줄의 매장으로 봐요
  var mg0 = monthGrid_(ym);
  if (mg0) Object.keys(mg0.rows).forEach(function (n) { if (!findStaff_(n) && canSee_(a, { store: String(mg0.rows[n].vals[mg0.cols.store] || '').trim() })) names.push(n); });
  var d = monthData_(ym, names);
  d.staff.forEach(function (s) { s.deduct = 0; });
  d.rows.forEach(function (r) { r.deduct = 0; });
  d.noMoney = true;
  return d;
}

function adminExport(pin, ym) {
  adminAuth_(pin);
  return exportMonth_(validYm_(ym) || nowKst_().ym);
}

/** 지금 위치를 그 매장의 위치로 등록해요. 점장은 자기 매장만 (등록하면 사장님께 알려요). */
function adminSetPlace(cred, store, lat, lng) {
  var a = auth_(cred);
  lat = Number(lat);
  lng = Number(lng);
  if (!isFinite(lat) || !isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) {
    throw new Error('위치 값이 이상해요. 다시 시도해주세요.');
  }
  var st = storeOf_(String(store == null ? '' : store).trim());
  if (!st) throw new Error('[매장] 탭에 없는 매장이에요: ' + store);
  if (a.role !== 'admin' && a.stores.indexOf(st.name) < 0) throw new Error('점장님 매장만 등록할 수 있어요.');
  var sh = sheet_(SHEETS.store);
  sh.getRange(st.row, st.cLat + 1).setNumberFormat('@').setValue(lat.toFixed(6));
  sh.getRange(st.row, st.cLng + 1).setNumberFormat('@').setValue(lng.toFixed(6));
  forget_('stores');
  if (a.role !== 'admin') notify_(a.set, '[' + st.name + '] 매장 위치 등록', a.name + ' 점장이 매장 위치를 ' + (st.lat != null ? '다시 ' : '') + '등록했어요.');
  return info_(settings_(), a);
}

/**
 * 다음 달 휴무: 매장마다 직원이 고른 날('휴무?'), 확정된 날('휴무'), 하루 최대 인원을 넘는 날.
 * 점장은 자기 매장만 보고, 확정은 관리자만 해요.
 */
function adminWishes(cred) {
  var a = auth_(cred);
  var now = nowKst_();
  var ym = nextYm_(now.ym);
  var w = wishOpen_(a.set, now);
  var g = monthGrid_(ym);
  var n = daysIn_(ym);
  var people = staff_().filter(function (p) { return p.active; });
  var out = [];
  // 병가·기타 등을 고른 칸이 있으면 칸 메모(사유)를 한 번에 읽어요
  var notes = null;
  var hasE = g && Object.keys(g.rows).some(function (nm) {
    for (var d = 1; d <= n; d++) { var m = String(g.rows[nm].vals[g.cols.day1 + d - 1] || '').trim(); if (WISH_RE.test(m) && m !== '휴무?' && m !== '월차?') return true; }
    return false;
  });
  if (hasE) notes = g.sh.getRange(1, g.cols.day1 + 1, g.sh.getLastRow(), n).getNotes();
  stores_().forEach(function (st) {
    if (a.role !== 'admin' && a.stores.indexOf(st.name) < 0) return;
    var mates = people.filter(function (p) { return p.store === st.name; });
    if (!mates.length) return;
    var rows = mates.map(function (p) {
      var r = g && g.rows[p.name];
      var wish = [], mwish = [], ewish = [], fixed = [], other = [];
      for (var d = 1; d <= n; d++) {
        var m = r ? String(r.vals[g.cols.day1 + d - 1] || '').trim() : '';
        if (m === '휴무?') wish.push(d);
        else if (m === '월차?') mwish.push(d);
        else if (WISH_RE.test(m)) ewish.push({ d: d, kind: m.slice(0, -1), why: notes && notes[r.row - 1] ? noteWhy_(notes[r.row - 1][d - 1]) : '' });
        else if (/휴무/.test(m)) fixed.push(d);
        else if (m && OFF_RE.test(m)) other.push(d + ' ' + m);
      }
      return { name: p.name, wish: wish, mwish: mwish, ewish: ewish, fixed: fixed, other: other, count: wish.length + fixed.length };
    });
    var over = [];
    for (var d = 1; d <= n; d++) {
      var date = ym + '-' + pad2_(d);
      var offs = offNames_(st.name, date, '');
      if (st.maxOff > 0 && offs.length > st.maxOff) over.push({ day: d, dow: DOW[dowOf_(date)], names: offs });
    }
    out.push({
      name: st.name, maxOff: st.maxOff, monthOff: st.monthOff, rows: rows, over: over,
      wishes: rows.reduce(function (s, r) { return s + r.wish.length + r.mwish.length + r.ewish.length; }, 0),
    });
  });
  return {
    ym: ym, role: a.role, open: w.open, forced: !!w.forced, window: w.text, hasTab: !!g, stores: out,
    blocked: blockedList_(a.set, ym), holidays: holidaysIn_(ym),
  };
}

/** 관리자: 그 매장(비우면 전체)의 '휴무?'·'월차?'·'병가?' 같은 고른 칸을 '휴무'·'월차'·'병가'로 확정해요(사유 메모는 그대로). */
function adminConfirmWishes(cred, store) {
  adminAuth_(cred);
  store = String(store == null ? '' : store).trim();
  var ym = nextYm_(nowKst_().ym);
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  var done = 0;
  try {
    var g = monthGrid_(ym, true);
    if (!g) throw new Error(ym + ' 휴무표가 아직 없어요.');
    var n = daysIn_(ym);
    staff_().forEach(function (p) {
      if (!p.active || (store && p.store !== store)) return;
      var r = g.rows[p.name];
      if (!r) return;
      var vals = [], changed = false;
      for (var d = 1; d <= n; d++) {
        var m = String(r.vals[g.cols.day1 + d - 1] || '').trim();
        if (WISH_RE.test(m)) { m = m.slice(0, -1); changed = true; done++; }
        vals.push(m);
      }
      if (!changed) return;
      g.sh.getRange(r.row, g.cols.day1 + 1, 1, n).setNumberFormat('@').setValues([vals]);
      vals.forEach(function (v, i) { r.vals[g.cols.day1 + i] = v; });
    });
  } finally {
    lock.releaseLock();
  }
  var res = adminWishes(cred);
  res.confirmed = done;
  return res;
}

/* ───────────── 1년 보기 (휴무표 탭 12개를 열지 않고 한 사람의 1년을 한 번에) ───────────── */

/**
 * 사장님 화면: 직원 한 명의 1년을 달마다(근무·지각·휴무·월차·대체휴무·결근?).
 * [출퇴근기록]·그 해 휴무표 탭들·[대체휴무]를 모아서 보여줘요. 점장은 자기 매장 직원만, 차감액은 빼고.
 */
function adminYear(cred, name, year) {
  var a = auth_(cred);
  name = String(name == null ? '' : name).trim();
  var p = findStaff_(name);
  year = validYear_(year) || nowKst_().date.slice(0, 4);
  if (!p) {
    // [직원] 탭에 없는 사람(예전 휴무표에서 가져온 퇴사자 등)은 관리자만, 그 해 기록이 있을 때
    var old = a.role === 'admin' && name ? yearData_(year, [name])[name] : null;
    if (!old || !old.months.some(function (m) { return m.any; })) throw new Error('직원을 찾을 수 없어요.');
    old.name = name;
    old.year = year;
    old.gone = true;
    return old;
  }
  if (!canSee_(a, p)) throw new Error('점장님 매장 직원만 볼 수 있어요.');
  var d = yearData_(year, [p.name])[p.name];
  if (a.role !== 'admin') {
    d.months.forEach(function (m) { m.deduct = 0; });
    d.total.deduct = 0;
    d.noMoney = true;
  }
  d.name = p.name;
  d.store = p.store;
  d.year = year;
  return d;
}

/** 관리자: 1년 요약 시트('연간 2026')를 만들어요. 한 사람 한 달이 한 줄이라, 이름으로 거르면 그 사람 1년이 한눈에 보여요. */
function adminExportYear(cred, year) {
  adminAuth_(cred);
  return exportYear_(validYear_(year) || nowKst_().date.slice(0, 4));
}

/** 시트 메뉴: 올해 1년 요약 시트. */
function menuExportYear() {
  SpreadsheetApp.getUi();
  var r = exportYear_(nowKst_().date.slice(0, 4));
  book_().setActiveSheet(book_().getSheetByName(r.name));
  book_().toast("'" + r.name + "' 시트를 만들었어요. 이름 칸 필터로 한 사람만 볼 수 있어요.");
}

function validYear_(y) { return /^\d{4}$/.test(String(y == null ? '' : y)) ? String(y) : ''; }

/**
 * 그 해 이름별 12달 요약. names를 안 주면 재직자 + 그 해 기록이 있는 사람 모두(테스트 직원 빼고).
 * 달마다: 근무일·근무시간·지각·조퇴·차감액·퇴근/출근 누락(출퇴근기록), 휴무·월차·잔여 월차·결근?(휴무표), 대체휴무 적립·사용(장부)
 */
function yearData_(year, names) {
  var today = nowKst_().date;
  var logs = logRows_(year);
  var people = staff_();
  var list = names ? names.slice() : people.filter(function (p) { return p.active; }).map(function (p) { return p.name; });
  var subs = subRows_();
  if (!names) {
    var add = function (n) { if (n && list.indexOf(n) < 0) list.push(n); };
    people.forEach(function (p) { add(p.name); }); // 퇴사 처리된 직원도(기록이 없으면 보는 쪽에서 빼요)
    logs.forEach(function (r) { add(r.name); });
    monthNames_(year).forEach(add); // 휴무표에만 있는 사람(예전 휴무표에서 가져온 퇴사자 등)
    subs.forEach(function (sr) { if (sr.date.indexOf(year) === 0) add(sr.name); });
  }
  list = list.filter(function (n) { return n !== TEST_NAME; });
  var storeNames = storeNames_();
  var byKey = {};
  logs.forEach(function (r) {
    var k = r.name + '|' + r.date.slice(0, 7);
    (byKey[k] = byKey[k] || []).push(r);
  });
  var out = {};
  list.forEach(function (n) { out[n] = { months: [] }; });
  for (var mi = 1; mi <= 12; mi++) {
    var ym = year + '-' + pad2_(mi);
    var g = monthGrid_(ym);
    list.forEach(function (n) {
      var t = total_(byKey[n + '|' + ym] || [], today);
      var row = g && g.rows[n];
      var off = 0, monthly = 0, absent = 0, left = null, marks = 0, full = '', grant = null;
      var store = '', lateMarks = 0, sup = 0, supBy = {};
      if (row) {
        store = String(row.vals[g.cols.store] || '').trim();
        store = storeNames[store] || store; // 예전 이름은 지금 이름으로
        for (var d = 1; d <= daysIn_(ym); d++) {
          var m = String(row.vals[g.cols.day1 + d - 1] || '');
          if (m) marks++;
          if (/\d{1,2}:\d{2}/.test(m)) lateMarks++; // 휴무표에 적힌 지각 시간(출퇴근기록이 없는 예전 달은 이걸로 세요)
          var sp = supportOf_(m, storeNames);
          if (sp && sp !== homeAt_(n, ym + '-' + pad2_(d), store)) { sup++; supBy[sp] = (supBy[sp] || 0) + 1; } // 다른 매장 이름 = 지원 근무(그날 소속 기준)
          // 휴무표 수식과 같게: 휴무 + 휴가 + 반차×0.5
          if (/휴무/.test(m)) off++;
          if (/휴가/.test(m)) off++;
          if (/반차/.test(m)) off += 0.5;
          if (/월차/.test(m)) monthly++;
          if (new RegExp(FULL_BREAK).test(m)) absent++; // 결근·무단(만근 칸과 같은 기준)
        }
        var lv = String(row.vals[g.cols.left] || '').trim();
        if (/^-?\d+(\.\d+)?$/.test(lv)) left = Number(lv);
        if (g.cols.full >= 0) full = String(row.vals[g.cols.full] || '').trim(); // 만근 / 만근 예정 / 아님: 이유
        var gv = String(row.vals[g.cols.grant] || '').trim();
        if (/^-?\d+(\.\d+)?$/.test(gv)) grant = Number(gv);
      }
      var got = 0, used = 0;
      subs.forEach(function (sr) {
        if (sr.name !== n || sr.date.indexOf(ym) !== 0) return;
        if (/적립/.test(sr.kind)) got += sr.days; else if (/사용/.test(sr.kind)) used += sr.days;
      });
      out[n].months.push({
        ym: ym, m: mi, days: t.days, work: t.work, lateCount: Math.max(t.lateCount, lateMarks), lateMin: t.lateMin, earlyMin: t.earlyMin,
        deduct: t.deduct, noOut: t.noOut, noIn: t.noIn, off: off, monthly: monthly, monthlyLeft: left, absent: absent,
        full: /^-|^=/.test(full) ? '' : full, grant: grant, store: store, sup: sup, supBy: supBy, row: !!row,
        subGot: got, subUsed: used, any: !!(t.days || t.noIn || marks || got || used),
      });
    });
  }
  list.forEach(function (n) {
    out[n].total = yearTotal_(out[n].months);
    out[n].store = '';
    out[n].months.forEach(function (m) { if (m.store) out[n].store = m.store; }); // 가장 최근 달의 매장
  });
  return out;
}

/** 여러 달 합계(1년 합계, 매장별로 그 매장에 있던 달만 합칠 때도 써요). */
function yearTotal_(months) {
  var tot = { days: 0, work: 0, lateCount: 0, lateMin: 0, earlyMin: 0, deduct: 0, noOut: 0, noIn: 0, off: 0, monthly: 0, absent: 0, subGot: 0, subUsed: 0, monthlyLeft: null, grant: 0, sup: 0, fullMonths: 0 };
  var skip = { monthlyLeft: 1, fullMonths: 1 };
  tot.supBy = {};
  months.forEach(function (m) {
    Object.keys(tot).forEach(function (k) { if (!skip[k] && k !== 'supBy') tot[k] += m[k] || 0; });
    if (m.monthlyLeft != null) tot.monthlyLeft = m.monthlyLeft; // 가장 최근 달의 잔여
    if (m.full === '만근') tot.fullMonths++;
    Object.keys(m.supBy || {}).forEach(function (st) { tot.supBy[st] = (tot.supBy[st] || 0) + m.supBy[st]; });
  });
  tot.full = tot.fullMonths ? '만근 ' + tot.fullMonths + '달' : '';
  return tot;
}

/** '가산 12번 · 검단 5번' (지원 간 곳과 횟수). 없으면 ''. */
function supText_(supBy) {
  return Object.keys(supBy || {}).sort(function (a, b) { return supBy[b] - supBy[a]; })
    .map(function (st) { return st + ' ' + supBy[st] + '번'; }).join(' · ');
}

/** 그 해 휴무표 탭들에 나오는 이름 모두(처음 나온 순서). 퇴사자도 들어 있어요. */
function monthNames_(year) {
  var seen = {}, out = [];
  for (var mi = 1; mi <= 12; mi++) {
    var g = monthGrid_(year + '-' + pad2_(mi));
    if (!g) continue;
    Object.keys(g.rows).sort(function (a, b) { return g.rows[a].row - g.rows[b].row; }).forEach(function (n) {
      if (!seen[n]) { seen[n] = true; out.push(n); }
    });
  }
  return out;
}

function exportYear_(year) {
  var ss = book_();
  var name = '연간 ' + year;
  var sh = ss.getSheetByName(name);
  if (sh) {
    if (sh.getFilter()) sh.getFilter().remove();
    sh.clear();
  } else {
    sh = ss.insertSheet(name);
  }
  var data = yearData_(year, null);
  var storeOf = {}, order = {};
  sortByStore_(staff_()).forEach(function (p, i) { storeOf[p.name] = p.store; order[p.name] = i; });
  var names = Object.keys(data).sort(function (a, b) {
    return (order[a] == null ? 9999 : order[a]) - (order[b] == null ? 9999 : order[b]);
  });
  var head = ['이름', '매장', '월', '근무일', '근무시간', '지각(회)', '지각(분)', '조퇴(분)', '차감 참고액', '휴무', '월차 사용', '월차 잔여',
    '대체휴무 적립', '대체휴무 사용', '결근?', '퇴근 누락', '출근 누락', '월차 부여', '만근(아니면 이유)', '지원(회)', '지원 간 곳'];
  var line = function (n, label, m) {
    // 매장: 그달 휴무표에 적힌 매장(옮긴 사람은 달마다 달라요), 없으면 [직원] 탭 매장
    return [n, m.store || storeOf[n] || data[n].store || '', label, m.days, hm_(m.work), m.lateCount, m.lateMin, m.earlyMin, m.deduct, m.off, m.monthly,
      m.monthlyLeft == null ? '' : m.monthlyLeft, m.subGot, m.subUsed, m.absent, m.noOut, m.noIn, m.grant == null ? '' : m.grant, m.full || '',
      m.sup || 0, supText_(m.supBy)];
  };
  var rows = [], totals = [];
  names.forEach(function (n) {
    var months = data[n].months.filter(function (m) { return m.any; });
    if (!months.length) return;
    months.forEach(function (m) { rows.push(line(n, m.m + '월', m)); });
    rows.push(line(n, '합계', data[n].total));
    totals.push(rows.length + 1); // 합계 줄 번호(머리글이 1줄)
  });
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#eef2f7');
  if (rows.length) {
    sh.getRange(2, 1, rows.length, 3).setNumberFormat('@');
    sh.getRange(2, 1, rows.length, head.length).setValues(rows);
    sh.getRange(2, 9, rows.length, 1).setNumberFormat('#,##0');
    totals.forEach(function (r) { sh.getRange(r, 1, 1, head.length).setFontWeight('bold').setBackground('#f1f5f9'); });
    // 사람마다(합계 줄 아래) 선을 그어 구분
    storeLines_(sh, 2, rows.map(function (r) { return r[0]; }), head.length);
    sh.getRange(1, 1, rows.length + 1, head.length).createFilter();
  }
  sh.setFrozenRows(1);
  sh.setFrozenColumns(3);
  return { name: name, url: ss.getUrl() + '#gid=' + sh.getSheetId(), rows: rows.length, people: totals.length };
}

/* ───────────── 시트에서 보는 1년 (PC용): '직원 1년'·'매장 1년' 탭 ───────────── */
/*
 * 3행에서 고르면 바로 채워져요: B3 직원(또는 매장), D3 연도, F3 새로고침(체크하면 최신 기록으로 다시).
 * 탭 내용은 앱이 그때그때 다시 그려요. 손으로 고친 건 다음에 고를 때 지워지니, 기록은 원래 탭에서 고치세요.
 */
var YEAR_TABS = { staff: '직원 1년', store: '매장 1년' };

/** 시트 메뉴: '직원 1년' 탭 열기(없으면 만들어요). */
function menuStaffYear() {
  SpreadsheetApp.getUi();
  book_().setActiveSheet(renderYearTab_(YEAR_TABS.staff));
}

/** 시트 메뉴: '매장 1년' 탭 열기(없으면 만들어요). */
function menuStoreYear() {
  SpreadsheetApp.getUi();
  book_().setActiveSheet(renderYearTab_(YEAR_TABS.store));
}

/**
 * '직원 1년'·'매장 1년' 탭을 3행에서 고른 값으로 다시 그려요. 처음이면 탭을 만들어요.
 * 시트 고침 감지(onEdit)는 30초 안에 끝나야 해서, 내용을 한 덩어리로 만들어 한 번에 쓰고
 * 서식도 여러 칸을 묶어서 몇 번에 칠해요. skeleton이면 고르는 칸만 만들어요(setup 때).
 */
function renderYearTab_(tab, skeleton) {
  var ss = book_();
  var sh = ss.getSheetByName(tab);
  if (!sh) {
    // 휴무표 탭들 바로 뒤에 둬요
    var at = 0;
    ss.getSheets().forEach(function (x, i) { if (tabYm_(x.getName())) at = i + 1; });
    sh = ss.insertSheet(tab, at);
  }
  var W = 33;
  if (sh.getMaxColumns() < W) sh.insertColumnsAfter(sh.getMaxColumns(), W - sh.getMaxColumns());
  var isStaff = tab === YEAR_TABS.staff;
  var now = nowKst_();
  var thisYear = now.date.slice(0, 4);
  var people = sortByStore_(staff_().filter(function (p) { return p.name !== TEST_NAME; }));
  var top = sh.getRange(3, 1, 1, 4).getDisplayValues()[0];
  var year = validYear_(String(top[3]).trim()) || thisYear;
  var options = isStaff
    ? people.filter(function (p) { return p.active; }).concat(people.filter(function (p) { return !p.active; })).map(function (p) { return p.name; })
    : stores_().map(function (st) { return st.name; });
  if (isStaff && !skeleton) {
    // 그 해 휴무표에만 있는 사람(예전 휴무표에서 가져온 퇴사자 등)도 맨 아래에
    monthNames_(year).forEach(function (n) { if (n !== TEST_NAME && options.indexOf(n) < 0) options.push(n); });
  }
  var cur = String(top[1]).trim();
  var pick = options.indexOf(cur) >= 0 ? cur : options[0] || '';
  var years = [String(Number(thisYear) - 1), thisYear];
  if (years.indexOf(year) < 0) years.push(year);

  var out = [];
  var st = { bold: ['A3', 'C3', 'E3'], big: ['A1'], mid: [], head: [], total: [], grey: ['A2', 'G3'], cal: null };
  var row = function (a) { var r = a.slice(); while (r.length < W) r.push(''); out.push(r); return out.length; };
  row([isStaff ? '직원 1년 보기' : '매장 1년 보기']);
  row([(isStaff ? 'B3에서 직원' : 'B3에서 매장') + ', D3에서 연도를 고르면 바로 채워져요. 그 사이 기록이 바뀌었으면 F3을 체크하세요. (이 탭은 보기용이라, 고칠 건 원래 탭에서 고치세요)']);
  row([isStaff ? '직원' : '매장', pick, '연도', year, '새로고침', '', '기준 ' + now.date + ' ' + now.time]);
  row([]);
  if (!pick) row([isStaff ? '[직원] 탭에 직원을 먼저 넣어주세요.' : '[매장] 탭에 매장을 먼저 넣어주세요.']);
  else if (skeleton) row([(isStaff ? 'B3에서 직원을' : 'B3에서 매장을') + ' 고르면 여기에 1년이 채워져요.']);
  else if (isStaff) staffYearRows_(row, st, pick, year);
  else storeYearRows_(row, st, pick, year, people);

  // 쓰기: 지우고 → 한 번에 쓰고 → 묶어서 칠하기
  sh.clear();
  sh.getRange(1, 1, out.length, W).setNumberFormat('@').setValues(out);
  var list = function (a) { return a.length ? sh.getRangeList(a) : null; };
  var b;
  if ((b = list(st.bold.concat(st.mid, st.head, st.total)))) b.setFontWeight('bold');
  if ((b = list(st.big))) b.setFontSize(14);
  if ((b = list(st.mid))) b.setFontSize(12);
  if ((b = list(st.head))) b.setBackground('#eef2f7');
  if ((b = list(st.total))) b.setBackground('#f1f5f9');
  if ((b = list(st.grey))) b.setFontColor('#6b7280');
  sh.getRange(3, 2, 1, 3).setBackground('#fef9c3');
  if (options.length) sh.getRange(3, 2).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(options, true).setAllowInvalid(false).build());
  sh.getRange(3, 4).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(years, true).setAllowInvalid(false).build());
  sh.getRange(3, 6).insertCheckboxes();
  sh.setFrozenRows(3);
  sh.setColumnWidth(1, isStaff ? 90 : 120);
  sh.setColumnWidth(2, 110);
  sh.setColumnWidths(3, W - 2, isStaff ? 52 : 72);
  if (st.cal) {
    var body = sh.getRange(st.cal.row, 2, 12, 31);
    body.setBackgrounds(st.cal.bgs);
    sh.getRange(st.cal.row - 1, 2, 13, 31).setHorizontalAlignment('center');
    markRules_(sh, body, colA1_(2) + st.cal.row);
  } else {
    sh.setConditionalFormatRules([]);
  }
  return sh;
}

/** 표 하나를 out에 더해요: 제목 줄, 머리글 줄, 내용 줄(마지막이 합계면 total). */
function yearSection_(row, st, title, head, rows, total) {
  st.mid.push(a1_(row([title]), 1));
  st.head.push(a1_(row(head), 1, 1, head.length));
  var last = 0;
  rows.forEach(function (r) { last = row(r); });
  if (total && last) st.total.push(a1_(last, 1, 1, head.length));
  row([]);
}

/** '직원 1년': 달마다 합계 + 1년 달력(휴무표 칸 그대로, 12달 × 31일). */
function staffYearRows_(row, st, name, year) {
  var d = yearData_(year, [name])[name];
  var p = findStaff_(name);
  var line = function (label, m) {
    return [label, m.days, hm_(m.work), m.lateCount, m.lateMin, m.earlyMin, won_(m.deduct), m.off, m.grant == null ? '' : m.grant, m.monthly,
      m.monthlyLeft == null ? '' : m.monthlyLeft, m.subGot, m.subUsed, m.absent, m.noOut, m.noIn, m.full || '', m.sup || 0, m.store || ''];
  };
  var rows = d.months.map(function (m) { return line(m.m + '월', m); });
  rows.push(line('합계', d.total));
  var where = p && p.active ? p.store : (d.store || (p && p.store) || '');
  yearSection_(row, st, '달마다 합계 · ' + name + (where ? ' (' + where + (p && p.active ? '' : ', 퇴사') + ')' : p && p.active ? '' : ' (퇴사)') + ' · ' + year + '년',
    ['월', '근무일', '근무시간', '지각(회)', '지각(분)', '조퇴(분)', '차감 참고액', '휴무', '월차 부여', '월차 사용', '월차 잔여', '대체 적립', '대체 사용', '결근?', '퇴근 누락', '출근 누락', '만근(아니면 이유)', '지원(회)', '그달 매장'],
    rows, true);
  if (d.total.sup) {
    row(['지원 간 곳 · ' + supText_(d.total.supBy)]);
    row([]);
  }

  // 1년 달력
  st.mid.push(a1_(row(['1년 달력 · 휴무표 칸 그대로 (휴무·월차·반차·지각 시간·대타·결근?)']), 1));
  var head = ['월'];
  for (var d1 = 1; d1 <= 31; d1++) head.push(String(d1));
  st.head.push(a1_(row(head), 1, 1, 32));
  var hol = holidays_();
  var bgs = [], first = 0;
  for (var mi = 1; mi <= 12; mi++) {
    var ym = year + '-' + pad2_(mi), n = daysIn_(ym), g = monthGrid_(ym), r = g && g.rows[name];
    var cells = [mi + '월'], bg = [];
    for (var day = 1; day <= 31; day++) {
      var date = ym + '-' + pad2_(day), dow = day <= n ? dowOf_(date) : -1;
      cells.push(day <= n && r ? String(r.vals[g.cols.day1 + day - 1] || '').trim() : '');
      bg.push(day > n ? '#e5e7eb' : hol[date] || dow === 0 ? '#fef2f2' : dow === 6 ? '#eff6ff' : '#ffffff');
    }
    var at = row(cells);
    if (!first) first = at;
    bgs.push(bg);
  }
  st.cal = { row: first, bgs: bgs };
}

/**
 * '매장 1년': 직원별 1년 합계, 달마다 매장 합계, 달마다 지각·휴무 (직원 × 달), 지원 근무.
 * 달마다 그때 이 매장이던 사람만 합쳐요: 휴무표 그달 줄의 매장 칸을 보고, 줄이 없으면 [직원] 탭 매장으로 봐요.
 * 그래서 중간에 옮겨 간 사람·퇴사자(예전 휴무표에서 가져온 사람 포함)도 이 매장에 있던 달만큼 나와요.
 */
function storeYearRows_(row, st, store, year, people) {
  var data = yearData_(year, null);
  var byName = {}, order = {};
  people.forEach(function (p, i) { byName[p.name] = p; order[p.name] = i; });
  var here = function (n, m) { return m.store ? m.store === store : !!(byName[n] && byName[n].store === store); };
  var names = Object.keys(data).filter(function (n) {
    var p = byName[n];
    return (p && p.active && p.store === store) || data[n].months.some(function (m) { return m.any && here(n, m); });
  }).sort(function (a, b) { return (order[a] == null ? 9999 : order[a]) - (order[b] == null ? 9999 : order[b]); });
  var mine = {}, label = {};
  names.forEach(function (n) {
    var p = byName[n];
    mine[n] = data[n].months.map(function (m) { return here(n, m) ? m : null; });
    label[n] = n + (p && p.active ? (p.store !== store ? ' (지금 ' + p.store + ')' : '') : ' (퇴사)');
  });
  var sum = function (list, k) { return list.reduce(function (s, x) { return s + ((x && x[k]) || 0); }, 0); };
  var totalOf = {};
  names.forEach(function (n) { totalOf[n] = yearTotal_(mine[n].filter(Boolean)); });
  var totals = names.map(function (n) { return totalOf[n]; });
  var rows = names.map(function (n) {
    var t = totalOf[n];
    return [label[n], t.days, hm_(t.work), t.lateCount, t.lateMin, t.earlyMin, won_(t.deduct), t.off, t.monthly,
      t.monthlyLeft == null ? '' : t.monthlyLeft, t.subGot, t.subUsed, t.absent, t.noOut, t.sup];
  });
  rows.push(['매장 합계', sum(totals, 'days'), hm_(sum(totals, 'work')), sum(totals, 'lateCount'), sum(totals, 'lateMin'), sum(totals, 'earlyMin'),
    won_(sum(totals, 'deduct')), sum(totals, 'off'), sum(totals, 'monthly'), '', sum(totals, 'subGot'), sum(totals, 'subUsed'), sum(totals, 'absent'), sum(totals, 'noOut'), sum(totals, 'sup')]);
  yearSection_(row, st, '직원별 1년 합계 · ' + store + ' · ' + year + '년',
    ['이름', '근무일', '근무시간', '지각(회)', '지각(분)', '조퇴(분)', '차감 참고액', '휴무', '월차 사용', '월차 잔여', '대체 적립', '대체 사용', '결근?', '퇴근 누락', '지원 나감(회)'],
    rows, true);

  var monthRows = [];
  for (var i = 0; i < 12; i++) {
    var ms = names.map(function (n) { return mine[n][i]; }).filter(Boolean);
    monthRows.push([(i + 1) + '월', sum(ms, 'days'), hm_(sum(ms, 'work')), sum(ms, 'lateCount'), sum(ms, 'lateMin'), sum(ms, 'off'),
      sum(ms, 'monthly'), sum(ms, 'absent'), sum(ms, 'noOut')]);
  }
  yearSection_(row, st, '달마다 매장 합계', ['월', '근무일(연인원)', '근무시간', '지각(회)', '지각(분)', '휴무', '월차', '결근?', '퇴근 누락'], monthRows);

  var grid = function (k) {
    return names.map(function (n) {
      return [label[n]].concat(mine[n].map(function (m) { return m ? m[k] : ''; })).concat([totalOf[n][k]]);
    });
  };
  var mh = ['이름'];
  for (var j = 1; j <= 12; j++) mh.push(j + '월');
  mh.push('합계');
  yearSection_(row, st, '달마다 지각(회)', mh, grid('lateCount'));
  yearSection_(row, st, '달마다 휴무(일)', mh, grid('off'));

  // 지원 근무: 이 매장 직원이 다른 매장으로 나간 날 / 다른 매장 직원이 이 매장으로 온 날
  var outRows = names.filter(function (n) { return totalOf[n].sup; }).map(function (n) {
    return [label[n]].concat(mine[n].map(function (m) { return m ? m.sup || '' : ''; })).concat([totalOf[n].sup, supText_(totalOf[n].supBy)]);
  });
  if (outRows.length) yearSection_(row, st, '지원 나간 날(이 매장 직원이 다른 매장으로)', mh.concat(['어디로']), outRows);
  var inRows = [];
  Object.keys(data).forEach(function (n) {
    var cells = data[n].months.map(function (m) { return (!here(n, m) && m.supBy && m.supBy[store]) || ''; });
    var total = cells.reduce(function (a, b) { return a + (b || 0); }, 0);
    if (total) inRows.push([n + (data[n].store ? ' (' + data[n].store + ')' : '')].concat(cells).concat([total]));
  });
  if (inRows.length) yearSection_(row, st, '지원 온 날(다른 매장 직원이 이 매장으로)', mh, inRows);
}

/** 1234567 → '1,234,567' */
function won_(n) { return String(Math.round(Number(n) || 0)).replace(/\B(?=(\d{3})+(?!\d))/g, ','); }

/** 휴무표 칸 색칠 규칙(휴무표 탭과 같은 색). first = 범위 맨 위 왼쪽 칸('J3' 같은). */
function markRules_(sh, days, first, extra) {
  var rule = function () { return SpreadsheetApp.newConditionalFormatRule().setRanges([days]); };
  sh.setConditionalFormatRules([
    rule().whenFormulaSatisfied('=ISNUMBER(SEARCH(":",' + first + '))').setFontColor('#c62828').setBold(true).build(),
    rule().whenTextContains('결근').setBackground('#fecaca').setBold(true).build(),
    rule().whenTextContains('대타').setBackground('#fef3c7').build(),
    rule().whenTextContains('반차').setBackground('#ede9fe').build(),
    rule().whenTextContains('월차?').setBackground('#f0fdf4').setItalic(true).build(),
    rule().whenTextContains('월차').setBackground('#dcfce7').build(),
    rule().whenTextContains('대체').setBackground('#cffafe').build(),
    rule().whenTextContains('휴무?').setBackground('#f1f5f9').setItalic(true).build(),
    rule().whenTextContains('휴').setBackground('#dbeafe').build(),
  ].concat(extra || []).concat([
    // 병가·경조·예비군·무급·기타: 고른 것('병가?')은 옅게 기울여서, 확정된 것은 주황
    rule().whenFormulaSatisfied('=REGEXMATCH(' + first + '&"","^(병가|경조|예비군|무급|기타)\\?$")').setBackground('#fff7ed').setItalic(true).build(),
    rule().whenFormulaSatisfied('=REGEXMATCH(' + first + '&"","병가|경조|예비군|무급|기타")').setBackground('#ffedd5').build(),
  ]));
}

/* ───────────── 사장님 화면: 휴무표 만들기, 테스트 도구 ───────────── */

/** 휴무표 만들기: 그 달 탭이 없으면 만들고, 있으면 빠진 직원 줄만 넣어요. 공휴일 표시·색칠도 맞춰요. */
function adminMakeMonth(cred, ym) {
  adminAuth_(cred);
  return makeMonth_(ym);
}

/**
 * 앞으로 올 달을 만들 때는 사이에 빠진 달도 차례로 만들어요(지난달 잔여 월차를 이어 받는 수식이 끊기지 않게).
 * 앞뒤 12달 안에서만 돼요.
 */
function makeMonth_(ym) {
  monthRename_();
  ym = normYm_(ym);
  if (!ym) throw new Error('달을 골라주세요. (예: 2026-12)');
  var now = nowKst_();
  var ahead = monthsBetween_(now.ym, ym);
  if (ahead < -12 || ahead > 12) throw new Error('이번 달 앞뒤 12달 안에서만 만들 수 있어요.');
  var existed = !!monthSheet_(ym);
  var before = existed ? Object.keys(monthGrid_(ym, true).rows).length : 0;
  var made = [];
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var g;
  try {
    var list = [];
    if (ahead > 1) for (var m = nextYm_(now.ym); m !== ym; m = nextYm_(m)) list.push(m);
    list.push(ym);
    list.forEach(function (x) {
      if (!monthSheet_(x)) made.push(monthName_(x));
      ensureMonth_(x);
    });
    g = monthGrid_(ym, true);
    paintMonth_(g.sh, ym, g.cols);
    monthRules_(g.sh, g.cols.day1, g.cols);
  } finally {
    lock.releaseLock();
  }
  return {
    ym: ym, name: monthName_(ym), created: !existed, made: made, added: Object.keys(g.rows).length - before,
    staff: staff_().filter(function (p) { return p.active && g.rows[p.name]; }).length,
    holidays: Object.keys(holidaysIn_(ym)).length, url: book_().getUrl() + '#gid=' + g.sh.getSheetId(),
  };
}

/** 테스트: 하루 마감 정리를 미리 봐요. 휴무표·장부를 안 바꾸고 직원에게도 안 보내요. send면 사장님 알림으로도 보내요. */
function adminClosePreview(cred, day, send) {
  var set = adminAuth_(cred);
  var now = nowKst_();
  var date = day === 'yesterday' ? addDays_(now.date, -1) : now.date;
  var res = dailyClose_(set, date, { dry: true });
  var via = send ? notify_(set, '[미리 보기] 하루 마감 정리', res.text + '\n\n※ 미리 보기라 휴무표·장부는 그대로예요.') : '';
  if (send && !via) throw new Error('알림 받을 곳이 없어요. 텔레그램을 연결하거나 [설정] 탭 알림이메일을 넣어주세요.');
  return {
    date: date, text: res.text, via: via,
    done: !!PropertiesService.getScriptProperties().getProperty('close:' + date), // 진짜 마감 정리가 이미 돌았는지
  };
}

/** 테스트: 사장님께 시험 알림. 어디로 갔는지('텔레그램'/'메일') 돌려줘요. */
function adminNotifyTest(cred) {
  var set = adminAuth_(cred);
  var via = notify_(set, '시험 알림', '알림이 잘 와요. 사장님 화면 [설정] → 테스트에서 보낸 메시지예요.');
  if (via) return { via: via };
  if (set.tgToken && set.tgChat) throw new Error('텔레그램으로 못 보냈어요. [설정] 탭 텔레그램 연결을 다시 확인해주세요.');
  throw new Error('알림 받을 곳이 없어요. 텔레그램을 연결하거나 [설정] 탭 알림이메일을 넣어주세요.');
}

/** 테스트: 다음 달 휴무 고르기를 오늘만 열어요(on=false면 닫아요). [설정] 휴무신청기간은 그대로예요. */
function adminWishOpen(cred, on) {
  adminAuth_(cred);
  var key = 'wishOpen:' + nowKst_().date;
  var props = PropertiesService.getScriptProperties();
  if (on) props.setProperty(key, '1'); else props.deleteProperty(key);
  var ym = nextYm_(nowKst_().ym);
  if (on && !monthSheet_(ym)) makeMonth_(ym); // 고를 휴무표가 없으면 만들어 둬요
  return adminWishes(cred);
}

/**
 * 테스트 직원 만들기: [직원]에 '테스트' 줄을 그 매장으로 넣어요(이미 있으면 매장만 바꿔요).
 * 비밀번호는 비워 둬서 처음 찍을 때 정해요. 이번 달·다음 달 휴무표에도 줄을 넣어요.
 */
function adminTestStaff(cred, store) {
  adminAuth_(cred);
  var st = storeOf_(String(store == null ? '' : store).trim()) || stores_()[0];
  if (!st) throw new Error('[매장] 탭에 매장을 먼저 넣어주세요.');
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var p = findStaff_(TEST_NAME);
    var sh = sheet_(SHEETS.staff);
    var row = p ? p.row : Math.max(sh.getLastRow(), 1) + 1;
    if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 10);
    if (!p) setStaffCell_(row, '이름', TEST_NAME);
    setStaffCell_(row, '매장', st.name);
    setStaffCell_(row, '재직', '');
    var now = nowKst_();
    [now.ym, nextYm_(now.ym)].forEach(function (ym) { if (monthSheet_(ym)) ensureMonth_(ym); });
  } finally {
    lock.releaseLock();
  }
  return adminToday(cred);
}

/**
 * 테스트 지우기: '테스트' 직원과 그 사람 기록을 통째로 지워요.
 * [출퇴근기록]·[요청]·[근무변경]·[의심기록]·[대체휴무]에서 이름이 정확히 '테스트'인 줄, 휴무표마다 그 줄, [직원] 그 줄.
 */
function adminTestClear(cred) {
  adminAuth_(cred);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var n = 0;
  try {
    var ss = book_();
    [[SHEETS.log, C.name + 1], [SHEETS.req, R.name + 1], [SHEETS.change, 2], [SHEETS.suspect, 2], [SHEETS.sub, 2]].forEach(function (x) {
      n += deleteRowsNamed_(ss.getSheetByName(x[0]), x[1], 2);
    });
    ss.getSheets().forEach(function (sh) {
      var tym = tabYm_(sh.getName());
      if (!tym) return;
      var g = monthGrid_(tym, true);
      if (g) n += deleteRowsNamed_(sh, g.cols.name + 1, 3);
    });
    var col = staffCols_()['이름'];
    n += deleteRowsNamed_(sheet_(SHEETS.staff), (col == null ? 0 : col) + 1, 2);
    MEMO_ = {};
    GRID_ = {};
    var cache = CacheService.getScriptCache();
    cache.remove('fail:pin:' + TEST_NAME);
    cache.remove('tglink:' + TEST_NAME);
  } finally {
    lock.releaseLock();
  }
  var t = adminToday(cred);
  t.removed = n;
  return t;
}

/** 그 칸(col, 1부터)이 정확히 '테스트'인 줄을 아래에서부터 지워요. 지운 줄 수를 돌려줘요. */
function deleteRowsNamed_(sh, col, first) {
  if (!sh) return 0;
  var last = sh.getLastRow();
  if (last < first) return 0;
  var vals = sh.getRange(first, col, last - first + 1, 1).getDisplayValues();
  var n = 0;
  for (var i = vals.length - 1; i >= 0; i--) {
    if (String(vals[i][0]).trim() === TEST_NAME) {
      sh.deleteRow(first + i);
      n++;
    }
  }
  return n;
}

/* ───────────── 요청: 출퇴근 정정, 휴무, 대타 ───────────── */
/*
 * 정정: 대기 → 승인(출퇴근기록에 반영) / 거절 / 취소
 * 휴무·월차·반차·대체: 대기 → 승인(휴무표에 적음) / 거절 / 취소
 * 대타: 대기(구하는 중) → 수락(동료가 '제가 할게요') → 승인([근무변경]에 두 사람 반영) / 거절 / 취소
 *
 * 누가 먼저 보나([요청] 보낼곳 칸):
 *  - 점장: 그 매장 점장이 먼저 보고 [관리자에게 올리기](보낼곳 → 관리자) 또는 [돌려보내기](상태 → 돌려보냄)
 *  - 관리자: 관리자에게 바로. 점장이 없는 매장, 점장 본인 요청도 관리자에게 가요
 * 승인·거절은 관리자만 해요. 점장 확인 전이라도 관리자는 바로 처리할 수 있어요.
 */

/** 직원 화면: 내 요청과, 동료가 올린 대타 구함 목록. */
function getRequests(name, pin) {
  var p = person_(name);
  checkPin_(p, pin);
  return reqsFor_(p.name);
}

/**
 * 직원 화면: 요청 보내기.
 * req = {name, pin, kind: 'fix'|'off'|'swap', offType: '휴무'|'월차'|'반차'|'대체'|'무급', date, type: 'in'|'out', time, reason,
 *        to: 'mgr'(점장에게, 기본) | 'admin'(관리자에게 바로)}
 */
function makeRequest(req) {
  req = req || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  var set, p, r;
  try {
    set = settings_();
    p = person_(req.name);
    checkPin_(p, req.pin, false, req.device); // 등록된 내 폰이면 그 폰만의 잠금(남이 내 이름으로 틀려도 내 폰으로는 보낼 수 있어요)
    var kind = { fix: '정정', off: '휴무', swap: '대타', cancel: '취소', out: '외근', move: '바꾸기', quit: '퇴사', early: '조퇴' }[req.kind];
    if (kind === '휴무' && OFF_KINDS.indexOf(req.offType) >= 0) kind = req.offType;
    if (kind === '조퇴' && req.earlyType === '외출') kind = '외출';
    if (!kind) throw new Error('요청 종류가 이상해요. 화면을 새로고침 해주세요.');
    var now = nowKst_();
    var date = parseDate_(req.date);
    if (!date) throw new Error('날짜를 골라주세요.');
    if (isClosed_(date)) throw new Error(Number(date.slice(5, 7)) + '월은 마감한 달이라 요청을 보낼 수 없어요. 사장님께 직접 말해주세요.');
    var reason = clean_(req.reason, 100);
    if (kind === '기타' && (!reason || reason === '(안 적음)')) throw new Error('기타는 사유를 꼭 적어주세요. (예: 가족 일, 이사)');
    var evRule = null; // 경조 휴가 규정([설정] 경조휴가): 어떤 경조사인지 고르고, 사유 맨 앞에 남겨요. 일수는 아래에서 근무일로 세요
    if (kind === '경조' && set.leaveRules.length) {
      var evName = clean_(req.event, 20);
      set.leaveRules.forEach(function (x) { if (x.name === evName) evRule = x; });
      if (!evRule) throw new Error('어떤 경조사인지 골라주세요. (' + set.leaveRules.map(function (x) { return x.name + ' ' + x.days + '일'; }).join(', ') + ')');
      reason = clean_(evRule.name + (reason && reason !== evRule.name ? ' · ' + reason : ''), 100);
    }
    var all = readReqs_();
    var what, more = [];
    var hd0 = hrDates_()[p.name];
    if (hd0 && hd0.start && date < hd0.start) throw new Error('입사일(' + hd0.start + ') 전 날짜예요. 입사일이 틀렸으면 사장님께 말해 고쳐 주세요.');
    var endAt = lastDay_(p.name); // 퇴사 예정이면 그 뒤 날짜는 요청할 수 없어요(정정·취소·퇴사 신청은 돼요)
    if (endAt && date > endAt && kind !== '정정' && kind !== '취소' && kind !== '퇴사') throw new Error('마지막 근무일(' + endAt + ') 뒤 날짜예요.');

    if (kind === '정정') {
      var raw = String(req.time == null ? '' : req.time).trim();
      var t = /^\d{1,2}:\d{2}$/.test(raw) ? parseTime_(raw) : null;
      if (t == null) throw new Error('시간을 넣어주세요.');
      var ago = daysBetween_(date, now.date);
      if (ago < 0 || ago > 14) throw new Error('정정은 오늘부터 14일 전까지의 기록만 요청할 수 있어요.');
      if (ago === 0 && t > now.min) throw new Error('아직 지나지 않은 시간이에요.');
      if (!reason) throw new Error('사유를 적어주세요. (예: 퇴근 찍는 걸 깜빡함)');
      what = (req.type === 'out' ? '퇴근 ' : '출근 ') + fmtTime_(t);
      // 인사 정보를 다 안 넣은 직원은 출근 정정도 못 보내요(승인으로 출근 기록이 생겨서 인사 정보 필수를 비켜 가지 않게). 퇴근 정정은 돼요
      if (req.type !== 'out' && set.hrMust !== '안함') { var hs0 = hrStatus_(p); if (hs0.state !== 'ok') throw new Error(hrBlockMsg_(hs0)); }
      all.forEach(function (r) {
        if (r.name === p.name && r.kind === '정정' && r.date === date && r.state === '대기' && r.what.slice(0, 2) === what.slice(0, 2)) {
          throw new Error('같은 날 ' + what.slice(0, 2) + ' 정정 요청이 이미 있어요. 먼저 보낸 요청을 취소하고 다시 보내주세요.');
        }
      });
    } else if (kind === '바꾸기') {
      // 휴무 바꾸기: 원래 쉬는 날(dateFrom)에 출근하고, 대신 근무하는 날(date)에 쉬어요. 승인되면 두 날 다 바뀌어요
      var from = parseDate_(req.dateFrom);
      if (!from) throw new Error('원래 쉬는 날을 골라주세요.');
      if (from === date) throw new Error('원래 쉬는 날과 대신 쉴 날이 같아요.');
      [from, date].forEach(function (d) {
        var far2 = daysBetween_(now.date, d);
        if (far2 < 0 || far2 > 60) throw new Error('오늘부터 60일 안의 날짜만 고를 수 있어요.');
      });
      if (isClosed_(from)) throw new Error(Number(from.slice(5, 7)) + '월은 마감한 달이라 요청을 보낼 수 없어요.');
      if (hd0 && hd0.start && from < hd0.start) throw new Error('입사일(' + hd0.start + ') 전 날짜예요.');
      if (hd0 && hd0.end && (from > hd0.end || date > hd0.end)) throw new Error('마지막 근무일(' + hd0.end + ') 뒤 날짜예요.');
      if (schedFor_(p, from)) throw new Error(whenOf_(from) + '은 원래 근무하는 날이에요. 쉬는 날을 골라주세요.');
      var mkA = dayMark_(p.name, from);
      if (mkA && !/^(휴무\??|쉼)$/.test(mkA)) throw new Error(whenOf_(from) + '은 휴무표에 \'' + mkA + '\'(으)로 적혀 있어서 바꿀 수 없어요. 그냥 쉬는 날만 바꿀 수 있어요.');
      var sB = schedFor_(p, date);
      if (!sB) throw new Error(whenOf_(date) + '은 원래 쉬는 날이에요. 근무하는 날을 골라주세요.');
      if (!reason) throw new Error('사유를 적어주세요.');
      all.forEach(function (r) {
        if (r.name !== p.name || !reqLive_(r)) return;
        if (r.date === date && isDayOffKind_(r.kind)) throw new Error(mmdd_(date) + '은 이미 ' + KIND_NAME[r.kind] + ' 요청이 있어요.');
        if (r.date === from && isDayOffKind_(r.kind)) throw new Error(whenOf_(from) + '은 ' + KIND_NAME[r.kind] + ' 요청으로 받은 휴무라서 바꿀 수 없어요. 원래 쉬는 날만 바꿀 수 있어요.');
        if (r.kind === '바꾸기' && r.state !== '승인' && moveFrom_(r) === from) throw new Error(mmdd_(from) + '을(를) 바꾸는 요청을 이미 보냈어요.');
      });
      what = from + ' 출근 ' + fmtSched_(sB); // 예: '2026-11-24 출근 10:00-20:00' (원래 쉬는 날, 그날 일할 시간)
    } else if (kind === '외근') {
      // 외근·교육·회의: 그날은 매장 밖에서 일해요. 승인되면 그날은 위치 확인 없이 찍혀요
      var far = daysBetween_(now.date, date);
      if (far < 0 || far > 60) throw new Error('오늘부터 60일 안의 날짜만 고를 수 있어요.');
      if (!reason) throw new Error('어디서 무엇을 하는지 적어주세요. (예: 본사 교육, 거래처 방문)');
      all.forEach(function (r) {
        if (r.name === p.name && r.date === date && r.kind === '외근' && /대기|수락|승인/.test(r.state)) throw new Error(mmdd_(date) + ' 외근 요청을 이미 보냈어요.');
      });
      what = '외근';
    } else if (kind === '취소') {
      // 승인된 휴무·월차 등을 취소해 달라는 요청(그날 근무하겠다는 것). 승인되면 휴무표 그날 칸이 비워져요
      if (daysBetween_(now.date, date) < 0) throw new Error('지난 날짜의 휴무는 취소할 수 없어요.');
      all.forEach(function (r) {
        if (r.name === p.name && r.kind === '바꾸기' && r.date === date && reqLive_(r)) {
          throw new Error(mmdd_(date) + '은 휴무 바꾸기로 받은 휴무예요. 되돌리려면 [휴무 바꾸기]로 이날 출근하고 ' + mmdd_(moveFrom_(r)) + '에 쉬겠다고 보내주세요.');
        }
      });
      var cur = dayMark_(p.name, date);
      if (OFF_KINDS.indexOf(cur) < 0) throw new Error(mmdd_(date) + '은 승인된 휴무(휴무·월차·반차·대체·무급)가 아니에요.');
      all.forEach(function (r) {
        if (r.name === p.name && r.date === date && r.kind === '취소' && (r.state === '대기' || r.state === '수락')) {
          throw new Error(mmdd_(date) + ' 취소 요청을 이미 보냈어요.');
        }
      });
      what = KIND_NAME[cur] + ' 취소';
    } else if (kind === '퇴사') {
      what = quitAsk_(p, date, reason, all, now); // 퇴사 신청: 마지막 근무일(오늘부터 60일 안)과 이유
    } else if (kind === '조퇴' || kind === '외출') {
      what = earlyAsk_(p, kind, date, req, reason, all, now);
    } else {
      var dupOn = function (dx) { return all.some(function (r) { return r.name === p.name && r.date === dx && isDayOffKind_(r.kind) && reqLive_(r); }); };
      // 여러 날 한 번에(여름휴가·경조 등): dateTo까지 근무하는 날마다 한 줄씩 요청을 만들어요.
      // 원래 쉬는 날·이미 요청한 날은 건너뛰고(첫 날이어도), 지난 날은 휴무표에 결근으로 적힌 날만(14일 안) 넣어요
      var dateTo = kind !== '대타' && kind !== '반차' ? parseDate_(req.dateTo) : '';
      if (dateTo && endAt && dateTo > endAt) dateTo = endAt; // 여러 날 묶음은 마지막 근무일까지만
      var days = [];
      if (dateTo && dateTo > date) {
        if (daysBetween_(date, dateTo) > 30) throw new Error('한 번에 31일까지만 신청할 수 있어요.');
        if (daysBetween_(now.date, dateTo) > 60) throw new Error('오늘부터 60일 안의 날짜만 고를 수 있어요.');
        for (var dx = date; dx <= dateTo; dx = addDays_(dx, 1)) {
          var ago = daysBetween_(dx, now.date);
          if (ago > 0 && (ago > 14 || !ABSENT_RE.test(dayMark_(p.name, dx)))) continue; // 지난 날 중 실제로 일한 날은 빼요
          var sx = schedFor_(p, dx, { absentOk: true });
          if (sx && !dupOn(dx)) days.push({ date: dx, s: sx });
        }
        if (!days.length) throw new Error(mmdd_(date) + '~' + mmdd_(dateTo) + '에는 신청할 근무일이 없어요. (원래 쉬는 날, 이미 요청한 날, 지난 날 중 일한 날은 빠져요)');
        if (days.length > 14) throw new Error('한 번에 14일(근무하는 날 기준)까지만 신청할 수 있어요. 나눠서 보내주세요.');
        date = days[0].date;
      }
      var ahead = daysBetween_(now.date, date);
      // 지난 날짜: 결근으로 적힌 날(결근?·결근·무단)은 14일 안이면 월차·대체휴무·휴무·무급으로 바꿔 달라고 요청할 수 있어요(승인은 사장님)
      var absent = ahead < 0 && ABSENT_RE.test(dayMark_(p.name, date));
      var back = kind === '무급' || (absent && OFF_KINDS.indexOf(kind) >= 0 && kind !== '반차') ? 14 : 0;
      if (ahead < -back || ahead > 60) {
        throw new Error(ahead < 0 && !back
          ? (kind === '대타' || kind === '반차' ? '지난 날짜는 고를 수 없어요.' : "지난 날짜는 휴무표에 '결근'으로 적힌 날만(14일 전까지) 바꿔 달라고 요청할 수 있어요.")
          : back ? KIND_NAME[kind] + '은(는) 14일 전부터 60일 뒤까지 고를 수 있어요.' : '오늘부터 60일 안의 날짜만 고를 수 있어요.');
      }
      var s = days.length ? days[0].s : schedFor_(p, date, { absentOk: true });
      if (!s && kind === '대타' && date === now.date) {
        // [오늘 못 나가요]로 보낸 병가·월차가 먼저 승인돼 휴무표가 바뀌었어도, 그 요청에 적어 둔 근무 시간으로 대타를 구해요
        all.forEach(function (q) { if (!s && q.name === p.name && q.date === date && OFF_TODAY.indexOf(q.kind) >= 0 && String(q.at || '').slice(0, 10) === date && reqLive_(q)) s = parseSchedule_(q.what); });
      }
      if (!s) throw new Error(mmdd_(date) + '은 원래 근무가 없는 날이에요.');
      if (kind !== '대타' && !reason) throw new Error('사유를 적어주세요.');
      if (evRule && Math.max(days.length, 1) > evRule.days) {
        throw new Error(evRule.name + '은 근무하는 날 기준 ' + evRule.days + '일까지예요. (신청하려는 근무일 ' + days.length + '일) 마지막 날을 앞당겨 주세요.');
      }
      if (!days.length) {
        all.forEach(function (r) {
          if (r.name === p.name && r.date === date && isDayOffKind_(r.kind) && reqLive_(r) && !swapPair_(kind, r.kind, date, now.date)) { // 오늘은 병가·월차 등과 대타를 같이 보낼 수 있어요
            throw new Error(mmdd_(date) + '은 이미 ' + KIND_NAME[r.kind] + ' 요청이 있어요.');
          }
        });
      }
      if (kind === '대체') {
        var bal = subBalance_(p.name), want = Math.max(days.length, 1);
        if (bal.left - bal.pending < want) {
          throw new Error(want > 1 ? '대체휴무가 모자라요. (남은 ' + fmtDays_(bal.left) + '일, 신청하려는 ' + want + '일)'
            : '쓸 수 있는 대체휴무가 없어요. (남은 대체휴무 ' + fmtDays_(bal.left) + '일' + (bal.pending ? ', 이미 신청한 ' + bal.pending + '일' : '') + ')');
        }
      }
      what = fmtSched_(s);
      more = days.slice(1).map(function (d) { return { date: d.date, what: fmtSched_(d.s) }; });
    }

    // 점장이 있으면 점장에게(직원이 '관리자에게 바로'를 고르면 관리자에게)
    var route = req.to === 'admin' || !managersOf_(p.store, p.name).length ? '관리자' : '점장';
    var sh = reqSheet_();
    // 번호: 시각 기반, 이미 있는 번호와 겹치면 -2, -3 … 을 붙여요
    var base = 'R' + Date.now().toString(36).toUpperCase(), id = base, n = 2;
    var taken = function (x) { return all.some(function (q) { return q.id === x || q.id.indexOf(x + '.') === 0; }); };
    while (taken(id)) id = base + '-' + n++;
    r = {
      id: more.length ? id + '.1' : id, // 여러 날 묶음은 번호가 R….1, R….2 … (사장님 화면에서 한 카드로 묶여요)
      at: now.date + ' ' + now.time, name: p.name, kind: kind, date: date, what: what, reason: reason, state: '대기',
      route: route,
    };
    var at0 = Math.max(sh.getLastRow(), 1) + 1;
    putReq_(sh, at0, r);
    more.forEach(function (x, i) {
      putReq_(sh, at0 + 1 + i, { id: id + '.' + (i + 2), at: r.at, name: p.name, kind: kind, date: x.date, what: x.what, reason: reason, state: '대기', route: route });
    });
    r.days = more.length + 1;
    r.lastDate = more.length ? more[more.length - 1].date : date;
    r.made = [r.id].concat(more.map(function (x, i) { return id + '.' + (i + 2); })); // 만든 요청 번호(화면이 증빙 사진을 붙여요)
  } finally {
    lock.releaseLock();
  }
  // 알림은 줄(잠금) 밖에서 보내요. 텔레그램이 느려도 다른 직원 출근이 밀리지 않게
  var when = whenOf_(r.date);
  if (r.kind === '대타') {
    // 같은 매장 동료 중 텔레그램 알림을 켠 사람에게
    staff_().forEach(function (q) {
      if (q.active && q.name !== p.name && q.store === p.store) {
        notifyStaff_(set, q, '동료가 대타를 구해요', when + ' ' + r.what + ' · ' + p.name + ' 님 대신\n할 수 있으면 출퇴근 앱에서 [제가 할게요]를 눌러주세요.');
      }
    });
    toApprover_(set, r, p, p.name + ' · 대타 구하는 중', when + ' ' + r.what + (r.reason ? '\n사유: ' + r.reason : '') +
      '\n동료가 수락하면 다시 알려드려요.', true);
  } else {
    var sentTo = toApprover_(set, r, p, p.name + ' · ' + KIND_NAME[r.kind] + ' 요청' + (r.days > 1 ? ' (' + r.days + '일)' : ''),
      when + (r.days > 1 ? ' ~ ' + whenOf_(r.lastDate) + ' · 근무하는 날 ' + r.days + '일' : '') + ' ' + reqLine_(r) + '\n사유: ' + r.reason);
    var toMgr = sentTo === true;
  }
  var res = reqsFor_(p.name);
  res.made = r.made;
  if (toMgr) res.toMgr = true; // 결재 알림이 점장 텔레그램에 실제로 갔어요([오늘 못 나가요]가 사장님께 따로 알릴지 정해요)
  if (r.kind !== '대타') res.sentTo = toMgr || !!sentTo; // 결재 알림이 누구에게든 갔는지
  return res;
}

/** 직원 화면: 동료의 대타 요청에 '제가 할게요'. */
function takeSwap(name, pin, id, device) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  var set, p, r;
  try {
    set = settings_();
    p = person_(name);
    checkPin_(p, pin, false, device); // 등록된 내 폰이면 그 폰만의 잠금
    r = findReq_(id);
    if (!r || r.kind !== '대타') throw new Error('요청을 찾을 수 없어요. 새로고침 해주세요.');
    if (r.name === p.name) throw new Error('본인 요청은 수락할 수 없어요.');
    if (r.state !== '대기') throw new Error('이미 다른 사람이 수락했거나 끝난 요청이에요.');
    if (daysBetween_(nowKst_().date, r.date) < 0) throw new Error('지난 날짜예요.');
    var endT = lastDay_(p.name);
    if (endT && r.date > endT) throw new Error('마지막 근무일(' + endT + ') 뒤 날짜라서 대타를 할 수 없어요.');
    r.state = '수락';
    r.taker = p.name;
    r.done = nowKst_().date + ' ' + nowKst_().time + ' 수락'; // 점장이 하루 넘게 안 보면 사장님께 올리는 건 이때부터 세요
    putReq_(reqSheet_(), r.row, r);
  } finally {
    lock.releaseLock();
  }
  var mine = schedFor_(p, r.date);
  var asker = findStaff_(r.name) || { name: r.name, store: '' };
  var when = whenOf_(r.date);
  toApprover_(set, r, asker, '대타 수락 · ' + (r.route === '점장' ? '확인해주세요' : '승인해주세요'),
    when + ' ' + r.name + ' ' + r.what + ' → ' + p.name + ' 님이 대신 근무' +
    (mine ? '\n※ ' + (swapAway_(asker, p) ? takerNote_(asker, p, mine) + '.' : p.name + ' 님은 그날 원래 ' + fmtSched_(mine) + ' 근무라서, 승인하면 두 시간을 합쳐요.') : ''));
  notifyStaff_(set, asker, '대타를 구했어요', when + ' ' + r.what + ' → ' + p.name + ' 님이 해주기로 했어요. 승인되면 근무표가 바뀌어요.');
  return reqsFor_(p.name);
}

/** 직원 화면: 내 요청 취소. 대타를 수락했던 사람이 부르면 수락만 취소돼요. */
/**
 * 증빙 사진 올리기: 내 요청(기다리는 중·승인된 것, 승인 뒤 30일 안)에 사진 한 장을 붙여요(병가 진단서·예비군 통지서·청첩장 등).
 * ids = 같은 묶음의 요청 번호들(여러 날 신청은 사진 한 장을 같이 써요). dataUrl = 'data:image/jpeg;base64,…'(화면이 줄여서 보내요).
 * 드라이브 [출퇴근 증빙] 폴더(사장님 드라이브, 공유 안 함)에 저장하고 [요청] 증빙 칸에 주소를 적어요. 다시 올리면 예전 사진은 휴지통으로.
 * 사장님은 요청 카드의 [증빙 보기]로 열고, 점장 카드에는 '있음'만 보여요.
 */
function reqProof(name, pin, ids, dataUrl, device) {
  var p = person_(name);
  checkPin_(p, pin, false, device);
  ids = [].concat(ids || []).map(function (x) { return String(x == null ? '' : x).trim(); }).filter(String).slice(0, 31);
  if (!ids.length) throw new Error('어느 요청에 올릴지 골라주세요.');
  var m = /^data:(image\/(jpeg|png|webp|gif|heic|heif));base64,([A-Za-z0-9+\/=]+)$/.exec(String(dataUrl == null ? '' : dataUrl));
  if (!m) throw new Error('사진 파일만 올릴 수 있어요.');
  if (m[3].length > PROOF_MAX) throw new Error('사진이 너무 커요. 다시 찍거나 다른 사진을 골라주세요.');
  var now = nowKst_();
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var list = ids.map(function (id) {
      var r = findReq_(id);
      if (!r || r.name !== p.name) throw new Error('내 요청에만 사진을 올릴 수 있어요. 새로고침 해주세요.');
      if (r.state !== '대기' && r.state !== '수락' && r.state !== '승인') throw new Error('거절되거나 취소된 요청에는 사진을 올릴 수 없어요.');
      var doneAt = parseDate_(String(r.done || '').slice(0, 10));
      if (r.state === '승인' && doneAt && daysBetween_(doneAt, now.date) > 30) throw new Error('승인되고 30일이 지난 요청이에요. 증빙은 사장님께 직접 보여 주세요.');
      return r;
    });
    var first = list[0];
    var file = proofFolder_().createFile(Utilities.newBlob(Utilities.base64Decode(m[3]), m[1],
      first.date + ' ' + p.name + ' ' + (KIND_NAME[first.kind] || first.kind) + ' ' + first.id + '.' + (m[2] === 'jpeg' ? 'jpg' : m[2])));
    var url = 'https://drive.google.com/file/d/' + file.getId() + '/view';
    var old = {};
    var sh = reqSheet_();
    list.forEach(function (r) {
      if (r.proof) old[proofId_(r.proof)] = true;
      r.proof = url;
      putReq_(sh, r.row, r);
    });
    Object.keys(old).forEach(function (fid) {
      if (fid && fid !== file.getId() && !readReqs_().some(function (q) { return proofId_(q.proof) === fid; })) {
        try { DriveApp.getFileById(fid).setTrashed(true); } catch (err) { console.error(err); }
      }
    });
  } finally {
    lock.releaseLock();
  }
  return reqsFor_(p.name);
}

/** 증빙 주소에서 드라이브 파일 번호. */
function proofId_(url) { var m = /\/d\/([A-Za-z0-9_-]+)/.exec(String(url || '')); return m ? m[1] : ''; }

/** 증빙 사진 폴더(사장님 드라이브). 없거나 휴지통에 있으면 새로 만들어요. */
function proofFolder_() {
  var props = PropertiesService.getScriptProperties(), id = props.getProperty('proofFolder');
  if (id) {
    try { var f = DriveApp.getFolderById(id); if (!f.isTrashed()) return f; } catch (err) { /* 지워졌으면 새로 만들어요 */ }
  }
  var nf = DriveApp.createFolder(PROOF_FOLDER);
  props.setProperty('proofFolder', nf.getId());
  return nf;
}

/** 거절·취소된 요청의 증빙 사진을 휴지통으로(같은 사진을 쓰는 다른 요청이 아직 살아 있으면 그대로). */
function proofDrop_(r) {
  var fid = proofId_(r && r.proof);
  if (!fid) return;
  var live = readReqs_().some(function (q) { return q.id !== r.id && proofId_(q.proof) === fid && /대기|수락|승인/.test(q.state); });
  if (live) return;
  try { DriveApp.getFileById(fid).setTrashed(true); } catch (err) { console.error(err); }
}

function cancelRequest(name, pin, id, device) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    var p = person_(name);
    checkPin_(p, pin, false, device); // 등록된 내 폰이면 그 폰만의 잠금
    var r = findReq_(id);
    if (!r) throw new Error('요청을 찾을 수 없어요. 새로고침 해주세요.');
    if (r.name === p.name && (r.state === '대기' || r.state === '수락')) {
      r.state = '취소';
      r.done = nowKst_().date + ' ' + nowKst_().time;
    } else if (r.taker === p.name && r.state === '수락') {
      r.state = '대기';
      r.taker = '';
      r.done = nowKst_().date + ' ' + nowKst_().time + ' 수락 취소';
      // 점장이 이미 관리자에게 올렸던 거면, 새 대타가 정해졌을 때 점장이 다시 봐요
      if (/^올림/.test(r.mgr || '')) {
        var asker = findStaff_(r.name);
        r.route = asker && managersOf_(asker.store, asker.name).length ? '점장' : '관리자';
        r.mgr = '';
      }
    } else {
      throw new Error('이미 처리된 요청이라 취소할 수 없어요.');
    }
    putReq_(reqSheet_(), r.row, r);
    if (r.state === '취소') { absentAfter_(settings_(), r); proofDrop_(r); }
    return reqsFor_(p.name);
  } finally {
    lock.releaseLock();
  }
}

/** 관리자: 요청 승인(ok=true) 또는 거절. 승인하면 기록·근무표에 바로 반영되고, 직원에게 결과를 알려요. */
function adminRequest(cred, id, ok, light) {
  var set = adminAuth_(cred);
  var r = decideReq_(set, id, ok);
  tellResult_(set, r);
  if (light) return { id: id, state: r.state, doneNote: r.note || '' }; // 빠르게: [오늘] 전체는 화면이 뒤에서 다시 받아요
  var out = adminToday(cred);
  if (r.note) out.doneNote = r.note;
  return out;
}

/** 승인·거절 한 건(알림은 안 보내요). 처리한 요청을 돌려줘요. */
function decideReq_(set, id, ok) {
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  var r;
  try {
    r = findReq_(id);
    if (!r) throw new Error('요청을 찾을 수 없어요. 새로고침 해주세요.');
    if (r.state !== '대기' && r.state !== '수락') throw new Error('이미 ' + doneText_(r.state) + ' 요청이에요.');
    if (ok) {
      if (r.kind === '대타' && !r.taker) throw new Error('아직 대타를 해줄 동료가 없어요. 동료가 수락하면 승인할 수 있어요.');
      var said = applyReq_(set, r);
      r.state = '승인';
      if (said) r.note = [].concat(said).join(' '); // 한 일(퇴사 신청 승인 등). 사장님 화면에 보여요
    } else {
      r.state = '거절';
    }
    r.done = nowKst_().date + ' ' + nowKst_().time;
    putReq_(reqSheet_(), r.row, r);
    if (!ok) { r.absent = absentAfter_(set, r); proofDrop_(r); }
  } finally {
    lock.releaseLock();
  }
  return r;
}

/**
 * 요청이 거절·취소·돌려보냄으로 끝났을 때: 그날이 이미 지났고(밤 마감이 '요청 처리 기다리는 중'이라 건너뛴 날)
 * 근무하는 날인데 출퇴근 기록이 없으면 휴무표에 '결근?'을 적어요. 적었으면 true.
 * (요청만 보내 놓고 안 나온 날이 빈칸으로 남아 만근이 되는 걸 막아요)
 */
function absentAfter_(set, r) {
  var now = nowKst_();
  if (!r || !r.date || r.date > now.date || !started_(set, r.date)) return false;
  // 오늘 날짜는 밤 마감이 이미 끝났을 때만(마감 전이면 마감이 알아서 적어요)
  if (r.date === now.date && !PropertiesService.getScriptProperties().getProperty('close:' + r.date)) return false;
  var p = findStaff_(r.name);
  if (!p || !employedOn_(p.name, r.date)) return false;
  // 공휴일에 그 매장에 아무도 출근하지 않았으면 매장이 쉰 날이에요(밤 마감과 같은 기준)
  if (holidays_()[r.date]) {
    var dayLogs = logRows_(r.date);
    if (!openedStores_(dayLogs)[p.store]) return false;
  }
  // 같은 날 아직 기다리는 다른 요청이 있으면 그 결과를 기다려요
  // (밤 마감과 같은 기준: 아무도 안 받은 대타·퇴사 신청은 기다리지 않아요)
  if (readReqsNow_().some(function (q) { return q.id !== r.id && q.name === r.name && q.date === r.date && (q.state === '대기' || q.state === '수락') && !(q.kind === '대타' && !q.taker) && q.kind !== '퇴사'; })) return false;
  if (!schedFor_(p, r.date, { absentOk: true })) return false;
  var f = findLog_(sheet_(SHEETS.log), r.date, p.name);
  if (f && (f.vals[C.tIn] || f.vals[C.tOut])) return false;
  if (dayMark_(p.name, r.date)) return false; // 이미 무언가 적혀 있으면 그대로
  setMark_(r.date, p.name, function (old) { return old || '결근?'; });
  return true;
}

/** 그날 그 사람의 출근 시각('10:05'). 출근 기록이 없으면 ''. */
function punchedIn_(date, name) {
  var f = findLog_(sheet_(SHEETS.log), date, name), t = f ? parseTime_(f.vals[C.tIn]) : null;
  return t == null ? '' : fmtTime_(t);
}

/** 관리자: 여러 날 묶음 요청(여름휴가 5일 등)을 한 번에 승인·거절해요. 안 되는 날은 건너뛰고 몇 건 했는지 알려줘요. */
function adminRequestMany(cred, ids, ok, light) {
  var set = adminAuth_(cred);
  var list = [].concat(ids || []).slice(0, 31), done = [], fail = [];
  list.forEach(function (id) {
    try { done.push(decideReq_(set, id, ok)); } catch (err) { fail.push(err.message); }
  });
  // 직원에게는 한 통으로(날마다 따로 보내면 10일 휴가면 10통이 가요)
  if (done.length) {
    var r0 = done[0];
    r0.days = done.map(function (x) { return x.date; });
    r0.absent = done.some(function (x) { return x.absent; });
    tellResult_(set, r0);
  }
  done = done.length;
  if (light) return { many: { done: done, fail: fail } }; // 빠르게: [오늘] 전체는 화면이 뒤에서 다시 받아요
  var out = adminToday(cred);
  out.many = { done: done, fail: fail };
  return out;
}

/** 점장: 직원 요청을 확인하고 관리자에게 올려요. 한마디(note)를 붙일 수 있어요. id에 여러 개(여러 날 묶음)를 주면 한꺼번에 올리고 알림은 한 번. */
function mgrForward(cred, id, note) {
  var a = auth_(cred);
  if (a.role !== 'manager') throw new Error('점장 화면에서만 쓰는 기능이에요.');
  note = clean_(note, 100);
  var ids = [].concat(id || []).slice(0, 31), done = [], fail = [];
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    ids.forEach(function (x) {
      try { // 묶음 중 이미 취소·처리된 날은 건너뛰어요
        var r = findReq_(x);
        mgrCheck_(a, r);
        if (r.kind === '대타' && !r.taker) throw new Error('아직 대타를 해줄 동료가 없어요. 동료가 수락하면 올릴 수 있어요.');
        var now = nowKst_();
        r.route = '관리자';
        r.mgr = '올림 ' + mmdd_(now.date) + ' ' + now.time + ' ' + a.name + (note ? ' · ' + note : '');
        putReq_(reqSheet_(), r.row, r);
        done.push(r);
      } catch (err) { fail.push(err.message); }
    });
  } finally {
    lock.releaseLock();
  }
  if (!done.length && fail.length) throw new Error(fail[0]);
  if (done.length) {
    var r = done[0], last = done[done.length - 1];
    var p = findStaff_(r.name) || { name: r.name, store: '' };
    var when = done.length > 1 ? whenOf_(r.date) + ' ~ ' + whenOf_(last.date) + ' (' + done.length + '일)' : whenOf_(r.date);
    toApprover_(a.set, r, p, r.name + ' · ' + KIND_NAME[r.kind] + ' 요청 (점장 확인)',
      when + ' ' + reqLine_(r) + (r.reason ? '\n사유: ' + r.reason : '') + '\n점장 ' + a.name + ': ' + (note || '확인했어요'));
  }
  return adminToday(cred);
}

/** 점장: 요청을 직원에게 돌려보내요(사유 필수). 직원은 고쳐서 다시 보낼 수 있어요. */
function mgrReturn(cred, id, reason) {
  var a = auth_(cred);
  if (a.role !== 'manager') throw new Error('점장 화면에서만 쓰는 기능이에요.');
  reason = clean_(reason, 100);
  if (!reason) throw new Error('돌려보내는 이유를 적어주세요. 직원에게 그대로 보여요.');
  var ids = [].concat(id || []).slice(0, 31), done = [], fail = [];
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    ids.forEach(function (x) {
      var r = findReq_(x);
      try { mgrCheck_(a, r); } catch (err) { fail.push(err.message); return; } // 묶음 중 이미 끝난 날은 건너뛰어요
      var now = nowKst_();
      r.state = '돌려보냄';
      r.done = now.date + ' ' + now.time;
      r.mgr = '돌려보냄 ' + mmdd_(now.date) + ' ' + now.time + ' ' + a.name + ' · ' + reason;
      putReq_(reqSheet_(), r.row, r);
      r.absent = absentAfter_(a.set, r);
      done.push(r);
    });
  } finally {
    lock.releaseLock();
  }
  if (!done.length && fail.length) throw new Error(fail[0]);
  if (done.length) {
    var r0 = done[0];
    r0.days = done.map(function (x) { return x.date; });
    r0.absent = done.some(function (x) { return x.absent; });
    tellResult_(a.set, r0); // 여러 날 묶음이어도 한 통
  }
  return adminToday(cred);
}

/** 점장이 이 요청을 처리할 수 있는지: 아직 열려 있고, 점장 차례이고, 점장 매장 직원의 요청. */
function mgrCheck_(a, r) {
  if (!r) throw new Error('요청을 찾을 수 없어요. 새로고침 해주세요.');
  if (r.state !== '대기' && r.state !== '수락') throw new Error('이미 ' + doneText_(r.state) + ' 요청이에요. 새로고침 해주세요.');
  if (r.route !== '점장') throw new Error('이미 관리자에게 올라간 요청이에요.');
  var p = findStaff_(r.name);
  if (!p || a.stores.indexOf(p.store) < 0) throw new Error('점장님 매장 직원의 요청만 처리할 수 있어요.');
  if (r.name === a.name) throw new Error('본인 요청은 다른 점장이나 관리자가 처리해요.');
  if (r.taker === a.name) throw new Error('본인이 대타를 맡은 요청은 다른 점장이나 관리자가 처리해요.');
}

function doneText_(state) {
  return { '승인': '승인된', '거절': '거절된', '취소': '취소된', '돌려보냄': '점장이 돌려보낸' }[state] || state + ' 상태인';
}

/**
 * 요청을 처리할 사람에게 알려요.
 *  - 보낼곳이 점장: 점장 텔레그램으로. 점장이 알림을 안 켰으면 사장님께 보내요(요청이 묻히지 않게)
 *  - 관리자: 사장님 알림(텔레그램·메일)
 * infoOnly: 아직 처리할 게 없는 알림(대타 구하는 중)
 */
function toApprover_(set, r, p, title, body, infoOnly) {
  var where = p && p.store ? '[' + p.store + '] ' : '';
  if (r.route === '점장') {
    var mgrs = managersOf_(p.store, p.name).filter(function (n) { return n !== r.taker; });
    var sent = 0;
    mgrs.forEach(function (n) {
      var url = adminUrl_();
      if (notifyStaff_(set, findStaff_(n), where + title, body +
        (infoOnly ? '' : '\n출퇴근 관리 화면에서 [관리자에게 올리기] 또는 [돌려보내기]를 눌러주세요.') + (url ? '\n관리 화면: ' + url : ''))) sent++;
    });
    if (sent) return true;
    return notify_(set, where + title + ' (점장 확인 전)', body + (mgrs.length ? '\n※ ' + mgrs.join(', ') + ' 점장에게 텔레그램 알림이 안 가서 사장님께도 보내요.' : ''));
  }
  return notify_(set, where + title, body + (infoOnly ? '' : '\n사장님 화면에서 승인해주세요.'));
}

/** 승인·거절·돌려보냄 결과를 직원(대타면 대신 일할 사람도)에게 알려요. 텔레그램을 켠 사람만. */
function tellResult_(set, r) {
  var msg = { '승인': '승인됐어요', '거절': '거절됐어요', '돌려보냄': '점장이 돌려보냈어요' }[r.state];
  if (!msg) return;
  var when = r.days && r.days.length > 1 ? whenOf_(r.days[0]) + ' ~ ' + whenOf_(r.days[r.days.length - 1]) + ' (' + r.days.length + '일)' : whenOf_(r.date);
  var why = r.state === '돌려보냄' ? '\n이유: ' + String(r.mgr).replace(/^.*?·\s*/, '') + '\n고쳐서 다시 보낼 수 있어요.' : '';
  if (r.absent) why += "\n그날은 출퇴근 기록이 없어서 휴무표에 '결근?'으로 적혔어요. 일했다면 [기록 정정]을, 못 나왔다면 [무급]·[월차] 요청을 보내주세요.";
  notifyStaff_(set, findStaff_(r.name), KIND_NAME[r.kind] + ' 요청' + (r.state === '돌려보냄' ? '을 ' : '이 ') + msg, when + ' ' + reqLine_(r) + why);
  if (r.kind === '퇴사' && r.state === '승인') quitTold_(set, r); // 퇴사 신청 승인: 그 지점 점장에게도(퇴사 예정·퇴사)
  if (r.kind === '대타' && r.taker && r.state !== '돌려보냄') {
    notifyStaff_(set, findStaff_(r.taker), '대타가 ' + msg, when + ' ' + r.name + ' 님 대신 ' + r.what +
      (r.state === '승인' ? ' 근무가 확정됐어요.' : ' 근무는 없던 일이 됐어요.'));
  } else if (r.kind === '대타' && r.taker) {
    notifyStaff_(set, findStaff_(r.taker), '대타가 취소됐어요', when + ' ' + r.name + ' 님 대신 ' + r.what + ' 근무는 없던 일이 됐어요.');
  }
}

/**
 * 조퇴·외출 요청 확인. 조퇴 = 그날 나갈 시각(req.time), 외출 = 나갔다 돌아올 시각(req.time ~ req.time2).
 * 14일 전부터 60일 뒤까지(나간 뒤에 알리는 경우도 돼요), 그날 근무 시간 안, 사유 필수, 같은 날 같은 요청·쉬는 요청이 있으면 안 돼요.
 * 돌려주는 값(요청 내용): '16:00에 퇴근 (원래 10:00-20:00)' / '14:00~15:30 외출 (원래 10:00-20:00)'
 */
function earlyAsk_(p, kind, date, req, reason, all, now) {
  var dd = daysBetween_(now.date, date);
  if (dd < -14 || dd > 60) throw new Error('14일 전부터 60일 뒤까지의 날짜만 고를 수 있어요.');
  var se = schedFor_(p, date);
  if (!se) throw new Error(whenOf_(date) + '은 근무가 없는 날이에요.');
  var hm = function (x) { x = String(x == null ? '' : x).trim(); return /^\d{1,2}:\d{2}$/.test(x) ? parseTime_(x) : null; };
  var t1 = hm(req.time), t2 = hm(req.time2);
  if (t1 == null) throw new Error('나갈 시각을 넣어주세요.');
  if (!(t1 > se.start && (se.end == null || t1 < se.end))) throw new Error('나갈 시각은 그날 근무 시간(' + fmtSched_(se) + ') 안이어야 해요.');
  if (kind === '외출' && (t2 == null || t2 <= t1 || (se.end != null && t2 > se.end))) {
    throw new Error('돌아올 시각을 나갈 시각 뒤로, 그날 근무 시간(' + fmtSched_(se) + ') 안에서 넣어주세요.');
  }
  if (!reason) throw new Error('사유를 적어주세요. (예: 병원, 은행)');
  all.forEach(function (r) {
    if (r.name !== p.name || r.date !== date) return;
    if (r.kind === kind && /대기|승인/.test(r.state)) throw new Error(whenOf_(date) + '은 이미 ' + kind + ' 요청을 보냈어요. 바꾸려면 먼저 보낸 요청을 취소하고 다시 보내주세요.');
    if (isDayOffKind_(r.kind) && r.kind !== '반차' && reqLive_(r)) throw new Error(whenOf_(date) + '은 이미 ' + KIND_NAME[r.kind] + ' 요청이 있어요.');
  });
  return kind === '조퇴' ? fmtTime_(t1) + '에 퇴근 (원래 ' + fmtSched_(se) + ')' : fmtTime_(t1) + '~' + fmtTime_(t2) + ' 외출 (원래 ' + fmtSched_(se) + ')';
}

/** 그날 출퇴근 기록 메모에 남길 말(조퇴·외출 승인 등). 기록이 아직 없으면 맡아 뒀다가 그날 처음 찍을 때 적어요(punchWrite_). */
function dayMemo_(date, name, text) {
  var sh = sheet_(SHEETS.log), f = findLog_(sh, date, name);
  if (f) {
    var v = f.vals.slice();
    v[C.memo] = addMemo_(v[C.memo], text);
    writeLog_(sh, f.row, v);
    return;
  }
  var props = PropertiesService.getScriptProperties(), k = dayMemoKey_(name, date);
  props.setProperty(k, addMemo_(props.getProperty(k) || '', text));
}
/** 맡아 둔 기록 메모를 두는 곳(스크립트 속성). 'dm:'으로 시작해서 날짜가 지나고 3일 뒤 저절로 지워져요. */
function dayMemoKey_(name, date) { return 'dm:' + date + ':memo:' + name; }

/** '10:00-20:00 근무 → 휴무', '퇴근 21:00', '10:00-20:00 → 박준호 님이 대신 근무' */
function reqLine_(r) {
  if (r.kind === '조퇴' || r.kind === '외출') return r.what;
  if (r.kind === '정정') return r.what;
  if (r.kind === '대타') return r.what + (r.taker ? ' → ' + r.taker + ' 님이 대신 근무' : ' 대타');
  if (r.kind === '취소') return r.what + ' (그날 근무할게요)';
  if (r.kind === '외근') return '외근·교육 (그날은 매장 밖에서 근무, 위치 확인 없이 찍기)';
  if (r.kind === '바꾸기') return '쉬고, 대신 ' + whenOf_(moveFrom_(r) || r.date) + ' ' + String(r.what).replace(/^\S+ 출근 /, '') + ' 출근';
  if (r.kind === '퇴사') return '마지막 근무일로 퇴사';
  return r.what + ' 근무 → ' + KIND_NAME[r.kind];
}

function whenOf_(date) { return mmdd_(date) + '(' + DOW[dowOf_(date)] + ')'; }

function clean_(s, n) { return String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n); }

/* ───────────── 텔레그램 알림 연결 (사장님 화면) ───────────── */

/** 1단계: BotFather에게 받은 토큰 저장. 토큰이 맞는지 텔레그램에 물어보고 저장해요. */
function adminTelegram(pin, token) {
  adminAuth_(pin);
  token = String(token == null ? '' : token).trim();
  if (!/^\d{5,}:[A-Za-z0-9_-]{30,}$/.test(token)) {
    throw new Error('토큰 모양이 이상해요. BotFather가 준 "123456789:ABC…" 모양의 토큰을 통째로 붙여넣어 주세요.');
  }
  var me;
  try { me = tgCall_(token, 'getMe', null, { wait: true }); } catch (err) {
    if (tgKind_(err) === 'busy') throw new Error(tgBusyText_(err, '그 뒤에 [저장]을 다시 눌러 주세요.'));
    throw err;
  }
  tgHealthClear_(); // 새 토큰: 예전 토큰으로 실패한 기록은 지워요
  setSetting_(K.tgToken, token);
  setSetting_(K.tgChat, '');
  setSetting_(K.tgBot, me.username || '');
  return { bot: me.username || '', code: ownerTgCode_(true), info: info_(settings_()) };
}

/** 사장님 채팅방을 찾을 연결 코드(숫자 6자리, 30분). fresh면 새로 만들어요. */
function ownerTgCode_(fresh) {
  var cache = CacheService.getScriptCache();
  var code = fresh ? '' : cache.get('tgowner');
  if (!code) code = String(100000 + Math.floor(Math.random() * 900000));
  cache.put('tgowner', code, 1800);
  return code;
}

/** 사장님 화면: 봇 토큰만 저장된 상태에서 보여줄 연결 코드. */
function adminTelegramCode(pin) {
  var set = adminAuth_(pin);
  if (!set.tgToken) throw new Error('봇 토큰을 먼저 저장해주세요.');
  return { bot: set.tgBot, code: ownerTgCode_(false) };
}

/**
 * 2단계: 사장님이 봇(또는 봇을 초대한 단톡방)에 보낸 '/start 연결코드'로 채팅방을 찾아 저장하고, 시험 메시지를 보내요.
 * 연결 코드가 맞는 메시지만 봐서, 같은 때 직원이 봇에게 말을 걸어도 직원 채팅방이 잘못 연결되지 않아요.
 */
function adminTelegramLink(pin) {
  var set = adminAuth_(pin);
  if (!set.tgToken) throw new Error('봇 토큰을 먼저 저장해주세요.');
  var code = CacheService.getScriptCache().get('tgowner');
  if (!code) throw new Error('연결 코드 시간(30분)이 지났어요. 화면을 새로고침하면 새 코드가 나와요.');
  var re = new RegExp('^/start(@\\w+)?\\s+(own)?' + code + '$');
  var u;
  try {
    u = tgFind_(set.tgToken, function (x) {
      var m = x.message || x.channel_post;
      return !!(m && m.chat && re.test(String(m.text || '').trim()));
    });
  } catch (err) {
    if (tgKind_(err) === 'busy') throw new Error(tgBusyText_(err, '그 뒤에 [연결 확인]을 다시 눌러 주세요(연결 코드는 30분 동안 그대로예요).'));
    throw err;
  }
  if (!u) throw new Error('봇에게 온 연결 코드가 없어요. 텔레그램에서 봇에게 "/start ' + code + '"를 보낸 뒤 다시 눌러주세요.');
  var chat = (u.message || u.channel_post).chat;
  CacheService.getScriptCache().remove('tgowner');
  tgSend_(set.tgToken, {
    chat_id: chat.id, text: '✅ ' + set.store + ' 출퇴근 알림이 연결됐어요. 앞으로 알림이 여기로 와요.',
  }, 'owner'); // 되면 '텔레그램 알림이 안 가요' 띠가 사라져요
  setSetting_(K.tgChat, String(chat.id));
  return info_(settings_());
}

function adminTelegramOff(pin) {
  adminAuth_(pin);
  tgHealthClear_();
  setSetting_(K.tgToken, '');
  setSetting_(K.tgChat, '');
  setSetting_(K.tgBot, '');
  return info_(settings_());
}

/**
 * 봇이 받은 메시지(getUpdates) 중 pred에 맞는 가장 최근 것. 100개가 넘게 쌓였으면 다음 묶음도 봐요.
 * (텔레그램은 안 읽은 메시지를 24시간 보관해요)
 */
function tgFind_(token, pred) {
  // 마지막 100개만 한 번에 봐요(offset -100: 그 앞의 옛 메시지는 텔레그램이 잊어요). 텔레그램을 여러 번 부르지 않게
  var found = null;
  var list = tgCall_(token, 'getUpdates', { offset: -100, limit: 100 }, { wait: true }) || [];
  list.forEach(function (u) { if (pred(u)) found = u; });
  return found;
}

/* ───────────── 시트 메뉴, 자동 실행 ───────────── */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('출퇴근')
    .addItem('사장님 화면·직원 화면 주소 보기', 'menuLinks')
    .addItem('setup 실행 (처음·코드 바꾼 뒤)', 'setup')
    .addItem('주민번호 열쇠 백업·되살리기', 'menuHrKey')
    .addItem('휴무표 만들기 (원하는 달)…', 'menuMakeMonth')
    .addItem('휴무표에 새 직원 넣기 (이번 달·다음 달)', 'menuMonths')
    .addItem('하루 마감 정리 미리 보기 (오늘)', 'menuClosePreview')
    .addItem('이번 달 정산 시트 만들기', 'menuExportThis')
    .addItem('올해 1년 요약 시트 만들기', 'menuExportYear')
    .addItem('직원 1년 보기 탭', 'menuStaffYear')
    .addItem('매장 1년 보기 탭', 'menuStoreYear')
    .addItem('지난 달 정산 시트 만들기', 'menuExportPrev')
    .addToUi();
}

function menuExportThis() { exportFromMenu_(nowKst_().ym); }

/** 시트 메뉴: 사장님 화면·직원 화면 주소(눌러서 바로 열어요). 사장님은 시트 말고 이 화면에서 거의 다 해요. */
function menuLinks() {
  var ui = SpreadsheetApp.getUi(); // 시트 메뉴에서만
  ui.showModalDialog(HtmlService.createHtmlOutput(linksHtml_()).setWidth(560).setHeight(300), '출퇴근 앱 주소');
}
function linksHtml_() {
  var u = '';
  try { u = ScriptApp.getService().getUrl() || ''; } catch (err) { u = ''; }
  if (!u) return '<p style="font:14px/1.6 sans-serif">아직 웹 앱으로 배포하지 않았어요. 확장 프로그램 → Apps Script → 배포 → 새 배포(유형: 웹 앱, 액세스: 모든 사용자)를 먼저 해 주세요.</p>';
  var esc = function (x) { return String(x).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;'); };
  var link = function (x) { return '<a href="' + esc(x) + '" target="_blank" rel="noopener">' + esc(x) + '</a>'; };
  return '<div style="font:14px/1.6 sans-serif;word-break:break-all">' +
    '<p><b>사장님 화면</b> (폰·PC 어디서나. 관리자 비밀번호로 들어가요. 오늘 현황·승인·월별·직원·설정)<br>' + link(u + '?page=admin') + '</p>' +
    '<p><b>직원 화면</b> (직원 단톡방에 올리는 주소)<br>' + link(u) + '</p>' +
    '<p style="color:#666">폰에서 사장님 화면 주소를 열고 공유 → 홈 화면에 추가를 누르면 앱처럼 쓸 수 있어요. 사장님 화면 주소는 직원에게 보내지 마세요.</p></div>';
}

function menuMonths() {
  SpreadsheetApp.getUi(); // 시트 메뉴에서만
  var ym = nowKst_().ym;
  ensureMonth_(ym);
  ensureMonth_(nextYm_(ym));
  book_().toast('휴무표에 빠진 직원을 넣었어요.');
}
function menuExportPrev() { exportFromMenu_(prevYm_(nowKst_().ym)); }

/** 시트 메뉴: 원하는 달 휴무표 만들기. */
function menuMakeMonth() {
  var ui = SpreadsheetApp.getUi();
  var next = nextYm_(nowKst_().ym);
  var r = ui.prompt('휴무표 만들기', '만들 달을 적어주세요. 비워두면 ' + next + '\n(이미 있으면 빠진 직원만 넣고 공휴일 표시를 맞춰요)', ui.ButtonSet.OK_CANCEL);
  if (r.getSelectedButton() !== ui.Button.OK) return;
  var res = makeMonth_(String(r.getResponseText() || '').trim() || next);
  book_().setActiveSheet(book_().getSheetByName(res.name));
  book_().toast("'" + res.name + "' " + (res.created ? '탭을 만들었어요.' : '탭에 빠진 직원 ' + res.added + '명을 넣었어요.'));
}

/** 시트 메뉴: 오늘 마감 정리 미리 보기(아무것도 안 바꿔요). */
function menuClosePreview() {
  var ui = SpreadsheetApp.getUi();
  var res = dailyClose_(settings_(), nowKst_().date, { dry: true });
  ui.alert('하루 마감 정리 미리 보기', res.text + '\n\n※ 미리 보기라 휴무표·장부는 그대로이고, 아무에게도 안 보내요.', ui.ButtonSet.OK);
}

function exportFromMenu_(ym) {
  SpreadsheetApp.getUi(); // 시트 메뉴에서만 돌게: 웹 화면에서 몰래 부르면 여기서 멈춰요
  var r = exportMonth_(ym);
  book_().setActiveSheet(book_().getSheetByName(r.name));
  book_().toast("'" + r.name + "' 시트를 만들었어요.");
}

/** 시트에서 출근·퇴근·예정 시간을 손으로 고치면 지각·근무시간·차감액을 다시 계산해요. */
function onEdit(e) {
  try {
    var rg = e.range;
    var sh = rg.getSheet();
    var tab = sh.getName();
    if (tab === YEAR_TABS.staff || tab === YEAR_TABS.store) {
      // 3행(직원·매장, 연도, 새로고침)을 고르면 그 1년으로 다시 그려요
      if (rg.getRow() === 3 && rg.getColumn() <= 6) renderYearTab_(tab);
      return;
    }
    if (tab === SHEETS.staff || tab === SHEETS.hr) {
      if (tab === SHEETS.staff) staffNameEdited_(rg, e.oldValue);
      hrEdited_(sh, rg); // 지점·재직·주민번호를 [직원]·[인사]에 맞추고 이동 기록을 남겨요
      return;
    }
    if (tab === NOTICE_TAB) { forgetNotices_(); return; } // 손으로 고친 공지가 바로 보이게
    if (tab === SHEETS.change) { changeEdited_(sh, rg); return; } // 날짜를 '2026-11-20' 모양으로
    if (tab !== SHEETS.log) return;
    var c0 = rg.getColumn();
    var c1 = c0 + rg.getNumColumns() - 1;
    if (c1 < C.name + 1 || c0 > C.tOut + 1) return;
    var r1 = Math.max(rg.getRow(), 2);
    var n = rg.getRow() + rg.getNumRows() - r1;
    if (n <= 0) return;
    var set = settings_();
    var people = staff_();
    var vals = sh.getRange(r1, 1, n, LOG_HEAD.length).getDisplayValues();
    var out = vals.map(function (v) {
      var p = null;
      people.forEach(function (x) { if (x.name === String(v[C.name]).trim()) p = x; });
      applyCalc_(v, p ? p.wage : 0, set.grace);
      return [v[C.late], v[C.early], v[C.work], v[C.deduct]];
    });
    sh.getRange(r1, C.late + 1, n, 4).setValues(out);
    vals.forEach(function (v) {
      var d = parseDate_(v[C.date]);
      if (d) syncLateMark_(d, String(v[C.name]).trim(), v);
    });
  } catch (err) {
    console.error(err);
  }
}

/**
 * 10분마다 자동 실행.
 *  - 이번 달 휴무표(새 직원 줄 포함)를 챙기고, 20일부터는 다음 달 휴무표도 미리 만들어요
 *  - 텔레그램을 켠 직원: 출근 몇 분 전 알림, 출근 시간이 지났는데 안 찍었으면 본인에게 알림
 *  - 사장님: 출근 시간이 지났는데 안 찍은 직원 알림
 *  - 밤 11시 30분이 지나면 하루 마감 정리(dailyClose_)를 한 번
 */
function checkMissing(e) {
  if (!ownerRun_(e)) return; // 웹 앱 주소를 아는 사람이 부르면 아무것도 안 해요(10분 트리거·편집기에서만)
  var set = settings_();
  var now = nowKst_();
  healthBeat_(now); // 돈 시각을 적어요(멈추면 사장님 화면에 빨간 띠). 줄을 못 서서 아래 일을 건너뛰어도 적어요
  try { monthRename_(); } catch (err) { console.error(err); } // 예전 이름 휴무표 탭을 '26.11'로(코드를 붙여넣고 setup 전에 돌아도)
  STEP_FAILS_ = [];
  var ml = LockService.getScriptLock();
  if (ml.tryLock(5000)) {
    try {
      // 단계마다 따로 해요. 한 단계에서 오류가 나도(이상한 탭 등) 나머지와 밤 마감·알림은 계속 돌아요
      [
        ['퇴사 처리', function () { retireDue_(set, now); }], // 마지막 근무일이 지난 사람은 퇴사 처리
        ['지점 이동 예약', function () { planDue_(set, now); }], // 예약해 둔 지점 이동
        ['시트 손질 뒤 정리', function () { hrTodoRun_(); }], // 시트를 손으로 고친 뒤 넘겨 둔 일(휴무표 줄 옮기기, 퇴사 정리, 이름 바꾸기)
        ['점장이 안 본 요청 올리기', function () { escalate_(set, now); }], // 점장이 하루 넘게 안 본 요청은 사장님께 올려요
        ['못 구한 대타 알리기', function () { swapNobody_(set, now); }], // 전날 18시가 지나도 아무도 안 받은 대타: 요청한 사람·점장·사장님께 한 번
        ['이번 달 휴무표 만들기', function () { ensureMonth_(now.ym); }],
        ['다음 달 휴무표 만들기', function () { if (Number(now.date.slice(8)) >= 20) ensureMonth_(nextYm_(now.ym)); }],
        ['휴직 칸 채우기', function () { awayFill_(now); }], // 휴직 중인 사람의 휴무표 칸
        ['휴무표 월차 칸 확인', function () { // 이월·부여가 지난달 탭과 끊겼는지(지난달 탭을 지웠을 때): 하루 한 번
          var lp = PropertiesService.getScriptProperties(), lk = 'dm:' + now.date + ':link';
          if (lp.getProperty(lk)) return;
          lp.setProperty(lk, '1');
          monthLinkCheck_(set, now).forEach(function (t) { notify_(set, '휴무표 월차 칸을 확인해주세요', t); });
        }],
      ].forEach(function (step) {
        try { step[1](); } catch (err) { stepFail_(step[0], err); }
      });
    } finally {
      ml.releaseLock();
    }
  }
  dataGuard_(set, now); // 주민번호 열쇠 확인·매주 새벽 드라이브 백업(줄 밖에서 해요. 복사가 오래 걸려도 출근 찍기를 안 막게)
  var props = PropertiesService.getScriptProperties();
  var sent = props.getProperties();
  // 자동 작업이 실패했으면 사장님께 알려요(같은 일은 하루 한 번). 실행 기록은 사장님이 보기 어려운 곳이라서요
  STEP_FAILS_.forEach(function (f) {
    var fk = 'dm:' + now.date + ':fail:' + f.what;
    if (sent[fk]) return;
    props.setProperty(fk, '1');
    sent[fk] = '1';
    var night = now.min < 7 * 60 || now.min >= 23 * 60; // 새벽 백업 같은 밤 작업이 실패했으면 소리 없이(같은 일은 하루 한 번)
    try { notify_(set, '자동 작업을 못 했어요', '[' + f.what + '] ' + f.msg + '\n10분마다 다시 해 봐요. 계속되면 시트의 그 줄([인사]·[직원]·휴무표)을 확인해 주세요.', night ? { silent: true } : undefined); } catch (err) { console.error(err); }
  });
  [now.ym, nextYm_(now.ym)].forEach(function (ym) {
    var bg = monthGrid_(ym), bk = 'dm:' + now.date + ':badtab:' + ym;
    if (!bg || !bg.bad || sent[bk]) return;
    props.setProperty(bk, '1');
    try { notify_(set, '휴무표 탭을 확인해주세요', monthName_(ym) + ' 탭 1행에 머리글(No·매장·이름…1일)이 없어서 이 탭은 건드리지 않고 있어요(결근?·지각 표시도 안 적혀요). 위에 끼워 넣은 줄을 지워서 머리글이 1행에 오게 해주세요.'); } catch (err) { console.error(err); }
  });
  Object.keys(sent).forEach(function (k) {
    var m = /^(alert|pre|close|dm|wishOpen|out|try):(\d{4}-\d{2}-\d{2})/.exec(k); // try: 막힌 출근을 처음 누른 시각(다음 날 지워요)
    if (m && daysBetween_(m[2], now.date) > (m[1] === 'close' || m[1] === 'dm' ? 3 : 0)) props.deleteProperty(k);
    // 새로 온 사람에게 열어 준 휴무 고르기(지나면 지움), 입사 등록 반려 이유(7일 뒤 지움)
    if (/^wishFor:/.test(k) && String(sent[k]) < now.date) props.deleteProperty(k);
    if (/^joinNo:/.test(k)) {
      var d = '';
      try { d = JSON.parse(sent[k]).date || ''; } catch (err) { d = ''; }
      if (!d || daysBetween_(d, now.date) > 7) props.deleteProperty(k);
    }
  });

  // 하루 마감 정리: 23:30 이후 한 번. 그 시간에 못 돌았으면 새벽(6시 전)에 어제 것을 해요
  var closeDay = now.min >= 23 * 60 + 30 ? now.date : now.min < 6 * 60 ? addDays_(now.date, -1) : '';
  if (closeDay && !sent['close:' + closeDay]) {
    // 두 번 겹쳐 돌지 않게 줄을 서고, 줄 안에서 이미 끝났는지 한 번 더 봐요.
    // 중간에 오류가 나면 표시를 안 해서 10분 뒤 다시 해요(결근?·대체휴무·직원 알림은 두 번 안 들어가요)
    var lock = LockService.getScriptLock();
    if (lock.tryLock(10000)) {
      OUTBOX_ = []; // 직원 수십 명에게 보내는 알림은 줄을 푼 뒤에(그동안 사장님 승인이 밀리지 않게)
      try {
        if (!props.getProperty('close:' + closeDay)) {
          if (started_(set, closeDay)) dailyClose_(set, closeDay);
          else {
            // 앱 시작 전: 결근?·알림을 안 해요. 그 전에 잘못 적힌 결근?은 치우고, [직원]·[인사]는 맞춰 둬요
            clearEarlyAbsent_(set);
            try { syncHr_(); } catch (err) { console.error(err); }
          }
          props.setProperty('close:' + closeDay, '1');
        }
      } finally {
        lock.releaseLock();
        var box = OUTBOX_ || [];
        OUTBOX_ = null;
        box.forEach(function (send) { try { send(); } catch (err) { console.error(err); } });
      }
    }
  }

  if (now.min < 7 * 60 || now.min >= 23 * 60) return; // 밤에는 출근 알림 검사 안 해요
  // 앱 시작 전에는 미출근 알림(본인·점장·사장님)·퇴근 알림을 안 보내요.
  // 출근 전 알림은 직원이 스스로 텔레그램 알림을 켠 거라 시작 전에도 보내요(시험해 보는 직원도 받을 수 있게)
  var live = started_(set, now.date);
  var owner = !!(set.email || (set.tgToken && set.tgChat));
  if (!owner && !set.tgToken) return;
  var logs = logRows_(now.date);
  // 공휴일에는 그 매장에 누가 출근해야 연 날로 봐요(설·추석처럼 매장이 쉬는 날 알림이 쏟아지지 않게)
  var hol = holidays_()[now.date] || '';
  var opened = openedStores_(logs);
  var ctx = { changes: changes_(), stores: stores_() };
  var missing = [], tried = [];
  var forMgr = []; // 점장 알림: 점장마다 자기 매장 사람만(mgrLate_)
  staff_().filter(function (p) { return p.active && (live || (p.tg && set.tgToken)) && employedOn_(p.name, now.date); }).forEach(function (p) {
    var s = schedFor_(p, now.date, ctx);
    if (!s) return;
    var mine = null;
    logs.forEach(function (r) { if (r.name === p.name) mine = r; });
    // 퇴근 예정 시간에서 10분이 지났는데 퇴근을 안 찍었으면 본인에게 한 번 알려요(텔레그램을 켠 직원. 1시간 안에만)
    if (live && set.outCheck === '함' && mine && mine.tIn && !mine.tOut && p.tg && set.tgToken) {
      var end = parseTime_(mine.sOut);
      var ok = 'out:' + now.date + ':' + p.name;
      if (end != null && now.min >= end + 10 && now.min <= end + 70 && !sent[ok]) {
        props.setProperty(ok, '1');
        notifyStaff_(set, p, '퇴근을 아직 안 찍었어요', '오늘 ' + fmtTime_(end) + ' 퇴근 예정이었어요. 퇴근했다면 지금 찍어주세요(매장을 나왔으면 [기록 정정]으로 시간을 알려주세요). 아직 일하는 중이면 끝나고 찍으면 돼요.', { silent: true });
      }
    }
    if (logs.some(function (r) { return r.name === p.name && r.tIn; })) return;
    if (hol && !opened[p.store]) return;
    if (ABSENT_RE.test(dayMark_(p.name, now.date))) return; // 사장님이 오늘 칸을 '결근'으로 정했어요: 출근 전·미출근 알림(본인·점장·사장님)을 안 보내요
    if (offAsked_(p.name, now.date)) return; // 오늘 쉬겠다는 요청(병가·월차 등, 기다리는 중·승인)을 보낸 사람: 출근 전·미출근 알림을 안 보내요
    var ahead = lateGet_(p.name, now.date, sent); // [늦어요]로 알린 사람: 말한 시간 + 알림기준(분)까지 기다려요(출근 전 알림도 안 보내요)
    if (ahead && now.min < ahead.until + set.alertMin) return;
    var bt = tryParse_(sent['try:' + now.date + ':' + p.name]); // 매장에서 출근을 눌렀는데 막힌 사람(처음 누른 시각)
    // 출근 전 알림 (텔레그램을 켠 직원만. 이미 매장에서 눌러 본 사람은 빼요)
    if (!bt && p.tg && set.tgToken && set.remind > 0 && now.min >= s.start - set.remind && now.min < s.start) {
      var pre = 'pre:' + now.date + ':' + p.name;
      // 보냈을 때만 '보냄'으로 적어요. 텔레그램이 막혀 못 갔으면 다음 10분 실행에 다시 해요(출근 시간 전까지)
      if (!sent[pre] && notifyStaff_(set, p, '곧 출근이에요', '오늘 ' + fmtTime_(s.start) + ' 출근' + (p.store ? ' (' + p.store + ')' : '') + '. 도착하면 출근을 찍어주세요.')) {
        props.setProperty(pre, '1');
        sent[pre] = '1';
      }
    }
    if (!live) return; // 시작 전: 미출근 알림은 안 해요
    if (now.min < s.start + set.alertMin || now.min > s.start + 180) return;
    // [늦어요]로 새 시간을 알렸으면 그 시간이 지나도 안 찍었을 때 한 번 더 알려요(알릴 때마다 표시가 달라요)
    var key = 'alert:' + now.date + ':' + p.name + (ahead ? ':late' + (Number(ahead.n) || 1) : '');
    var mk = key + ':mgr'; // 점장 몫은 따로 적어요: 점장에게 못 갔으면 점장에게만 다시(1시간까지)
    var dueM = sent[mk] ? alertDue_(sent[mk], now) : !sent[key]; // 점장 표시 없이 직원 몫만 있으면 이 버전 전에 보낸 것
    var dueS = alertDue_(sent[key], now); // 보냈으면 끝. 아무 데도 못 갔으면 10분마다 1시간까지 다시 해요
    if (!dueS && !dueM) return;
    var at = (workAt_(p, now.date, ctx) || {}).at || p.store; // 그날 일하는 매장(다른 매장 대타·지원이면 그 매장)
    var hint = bt ? ' · ' + bt.time + ' 매장에서 눌렀는데 ' + (TRY_WHY[bt.why] || '출근') + '에 막힘' : '';
    if (dueM) { alertTry_(props, sent, mk, now); forMgr.push({ p: p, at: at, start: s.start, hint: hint, key: mk }); }
    if (!dueS) return;
    alertTry_(props, sent, key, now);
    missing.push((at ? '[' + at + '] ' : '') + p.name + ' (출근 예정 ' + fmtTime_(s.start) + hint + ')');
    var body = '오늘 ' + fmtTime_(s.start) + ' 출근이에요. 출근했다면 지금 찍어주세요.';
    if (bt) {
      // 처음 누른 시각부터 TRY_MIN분 안에 막힌 게 풀리고 그 폰으로 다시 누르면 그 시각으로 찍혀요(punch)
      var soon = now.min - bt.min <= TRY_MIN ? fmtTime_(Math.min(bt.min + TRY_MIN, 24 * 60 - 1)) : '';
      body = '아까 ' + bt.time + '에 누른 출근이 ' + (TRY_WHY[bt.why] || '출근') + '에 막혔어요. ' +
        (bt.why !== 'hr' ? '사장님께 새 폰 승인을 부탁하세요(사장님이 ' + bt.time + '로 출근을 적어 줄 수 있어요).'
          : !soon ? '점장님·사장님께 말씀해 주세요.'
          : hrStatus_(p).state === 'need' ? soon + '까지 인사 정보를 다 넣으면 ' + bt.time + '로 출근이 찍혀요.'
          : hrStatus_(p).state === 'ok' ? '이제 인사 정보가 다 채워졌어요. ' + soon + '까지 그 폰으로 출근을 다시 누르면 ' + bt.time + '로 찍혀요.'
          : soon + '까지 인사 정보 확인이 끝나면 그 폰으로 다시 눌러 주세요(' + bt.time + '로 찍혀요).');
    }
    tried.push({ key: key, staff: !!(p.tg && set.tgToken), ok: notifyStaff_(set, p, '아직 출근을 안 찍었어요', body) });
  });
  // 그 매장 점장에게도(사장님 알림을 안 켰어도). 점장에게 갔거나 보낼 점장이 없으면 끝, 못 갔으면 다음 실행이 점장에게만 다시
  mgrLate_(set, forMgr, now).forEach(function (k) { props.setProperty(k, '1'); sent[k] = '1'; });
  var via = missing.length && owner ? notify_(set, '아직 출근 안 찍은 직원 ' + missing.length + '명', now.date + ' ' + now.time + ' 기준\n' + missing.join('\n')) : '';
  alertSent_(props, sent, tried, via, owner); // 직원·사장님 중 한 곳이라도 갔을 때만 '보냄'으로 적어요
}

/**
 * 점장에게 간 요청을 점장이 24시간 넘게 안 봤으면(올리기·돌려보내기를 안 함) 사장님께 자동으로 올려요.
 * 점장이 쉬는 날이거나 알림을 못 봐도 요청이 묻히지 않게요. 대타는 받은 동료가 있을 때만.
 */
function escalate_(set, now) {
  var due = [];
  var nowMs = Date.now();
  readReqs_().forEach(function (r) {
    if (r.route !== '점장' || (r.state !== '대기' && r.state !== '수락') || (r.kind === '대타' && !r.taker)) return;
    var at = Date.parse(String(r.at || '').replace(' ', 'T') + ':00+09:00');
    var dm = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/.exec(r.done || ''); // 대타를 수락했거나 수락이 취소된 때(점장은 그때부터 볼 수 있어요)
    if (dm) at = Math.max(at || 0, Date.parse(dm[1] + 'T' + dm[2] + ':00+09:00') || 0);
    if (!at || nowMs - at < 24 * 3600 * 1000) return;
    r.route = '관리자';
    r.mgr = '올림 ' + mmdd_(now.date) + ' ' + now.time + ' 자동 · 점장 확인 없이 하루가 지나서';
    putReq_(reqSheet_(), r.row, r);
    due.push(r.name + ' ' + whenOf_(r.date) + ' ' + (KIND_NAME[r.kind] || r.kind));
  });
  if (due.length) {
    try { notify_(set, '점장이 하루 넘게 안 본 요청 ' + due.length + '건', due.join('\n') + '\n사장님 화면에서 승인해주세요.'); } catch (err) { console.error(err); }
  }
  return due.length;
}

/**
 * 하루 마감 정리 (밤 11시 30분 이후 한 번).
 *  - 근무하는 날인데 기록이 하나도 없으면 휴무표에 '결근?' (그날 요청을 보낸 사람은 빼요.
 *    공휴일에 그 매장에 출근한 사람이 아무도 없으면 매장이 쉰 날일 수 있어서 적지 않고 요약에만 넣어요)
 *  - 퇴근을 안 찍은 사람: 목록에 넣고 본인에게 알림
 *  - 쉬는 날·공휴일에 출근한 사람: [대체휴무]에 적립(설정 '대체휴무적립'에 따라. 4시간 이상 1일, 미만 0.5일)
 *    '쉬는 날'은 근무변경·휴무표·[직원] 요일 칸에 쉰다고 적힌 날만이에요(근무시간이 아직 안 정해진 사람은 아니에요)
 *  - 사장님께 하루 요약(조용히 보내요)
 */
function dailyClose_(set, date, opts) {
  var dry = !!(opts && opts.dry); // 미리 보기: 휴무표·장부를 안 바꾸고, 아무에게도 안 보내요
  var props = PropertiesService.getScriptProperties();
  var ym = date.slice(0, 7);
  var logs = logRows_(date);
  var opened = openedStores_(logs);
  var ctx = { changes: changes_(), stores: stores_() };
  var reqs = readReqs_();
  var hol = holidays_()[date] || '';
  var res = { absent: [], sure: [], holNone: [], noOut: [], noIn: [], offWork: [], holWork: [], support: [], came: 0, late: 0, credit: 0 };
  sortByStore_(staff_().filter(function (p) { return p.active; }), ctx.stores).forEach(function (p) {
    var s = schedFor_(p, date, ctx);
    var r = null;
    logs.forEach(function (x) { if (x.name === p.name) r = x; });
    var tag = (p.store ? '[' + p.store + '] ' : '') + p.name;
    if (r && r.tIn) { res.came++; if (r.late) res.late++; }
    if (r && r.tIn && r.place && p.store && r.place !== p.store) res.support.push(tag + ' → ' + r.place);
    if (s && !(r && (r.tIn || r.tOut)) && employedOn_(p.name, date)) { // 입사일 전·마지막 근무일 뒤는 결근이 아니에요
      // 그날 요청(정정·휴무 등)을 보내 둔 사람은 처리 결과를 기다려요. 단, 대타를 구하는 중인데 아직 받은 사람이 없으면 본인이 나와야 하는 날이에요
      var asked = reqs.some(function (q) {
        return q.name === p.name && q.date === date && (q.state === '대기' || q.state === '수락') && !(q.kind === '대타' && !q.taker) && q.kind !== '퇴사';
      });
      var mk0 = dayMark_(p.name, date);
      if (asked) {
        // 그날 요청(정정·휴무 등)을 보낸 사람은 처리 결과를 기다려요
      } else if (ABSENT_RE.test(mk0) && mk0.indexOf('결근?') < 0) {
        res.sure.push(tag); // 사장님이 이미 '결근'·'무단'으로 정한 날: 결근?을 안 적고 본인에게도 안 알려요
      } else if (hol && !opened[p.store]) {
        res.holNone.push(tag);
      } else {
        if (!dry) {
          setMark_(date, p.name, function (old) { return old || '결근?'; });
          // 본인에게도 알려요(텔레그램을 켠 사람. 밤이라 소리 없이). 안 켠 사람은 다음에 앱을 열면 첫 화면 띠로 봐요
          var ak = 'dm:' + date + ':abs:' + p.name;
          if (!props.getProperty(ak) && notifyStaff_(set, p, "휴무표에 '결근?'으로 적혔어요", whenOf_(date) + ' 출퇴근 기록이 없어요.\n일했다면 출퇴근 앱에서 [기록 정정]을, 못 나왔다면 [휴무 신청]에서 그날을 월차·대체휴무·무급으로 바꿔 달라고 ' + mmdd_(addDays_(date, 14)) + '까지 보내주세요. 그대로 두면 이번 달 만근이 깨져요.', { silent: true })) {
            props.setProperty(ak, '1');
          }
        }
        res.absent.push(tag + ' (예정 ' + fmtTime_(s.start) + ')');
      }
    }
    if (set.outCheck === '함' && r && r.tIn && !r.tOut) { // [설정] 퇴근확인이 안함이면 퇴근을 안 찍어도 알리지 않아요
      res.noOut.push(tag + ' (출근 ' + r.tIn + ')');
      var dm = 'dm:' + date + ':' + p.name;
      if (!dry && !props.getProperty(dm) && notifyStaff_(set, p, '퇴근을 안 찍었어요', whenOf_(date) + ' 출근 ' + r.tIn + '. 실제 퇴근 시간을 출퇴근 앱 [기록 정정]으로 알려주세요.', { silent: true })) {
        props.setProperty(dm, '1');
      }
    }
    if (r && !r.tIn && r.tOut) res.noIn.push(tag + ' (퇴근 ' + r.tOut + ')');
    if (!(r && r.tIn)) return;
    if (!s && awayOn_(p.name, date)) { res.awayWork = (res.awayWork || []).concat([tag]); return; } // 휴직 날 출근: 사장님이 확인할 일(대체휴무로 안 쌓아요)
    if (!s && reqs.some(function (q) { return q.name === p.name && q.kind === '바꾸기' && moveFrom_(q) === date && (q.state === '대기' || q.state === '수락'); })) return; // 휴무 바꾸기로 나온 날(승인 기다리는 중)
    var offDay = !s && offDayKnown_(p, date, ctx.changes);
    if (!offDay && !hol) return;
    var why = offDay ? '휴무날 출근' : '공휴일(' + hol + ') 출근';
    (offDay ? res.offWork : res.holWork).push(tag + (r.tOut ? ' ' + hm_(r.work) : ' (퇴근 안 찍음)'));
    var credit = set.subMode === '휴무날·공휴일' || (offDay && set.subMode === '휴무날만');
    if (!credit) return;
    var days = !r.tOut || r.work >= 240 ? 1 : 0.5;
    if (dry) { if (!subCredited_(date, p.name)) res.credit += days; return; }
    if (addSubOnce_(date, p.name, days, why + (r.tOut ? ' ' + hm_(r.work) : ' · 퇴근을 안 찍어서 1일로 적음(확인 필요)'))) res.credit += days;
  });

  var lines = [whenOf_(date) + (hol ? ' ' + hol : '') + ' · 출근 ' + res.came + '명' + (res.late ? ', 지각 ' + res.late + '명' : '')];
  var add = function (title, list, tail) { if (list.length) lines.push('', title + ' ' + list.length + '명' + (tail || ''), list.join('\n')); };
  // 미리 보기는 아직 안 한 일이라 '적어요·쌓아요'로 말해요
  add('결근? (기록 없음)', res.absent, ' → 휴무표에 "결근?"으로 ' + (dry ? '적어요' : '적었어요'));
  add('결근 (사장님이 정함)', res.sure);
  add('공휴일에 아무도 출근 안 한 매장이라 결근?으로 안 적음', res.holNone);
  add('퇴근 안 찍음', res.noOut);
  add('출근 안 찍음', res.noIn);
  var piled = dry ? ' → 대체휴무로 쌓아요' : ' → 대체휴무로 쌓았어요';
  add('쉬는 날 출근', res.offWork, set.subMode !== '안함' ? piled : '');
  add('휴직 중인데 출근', res.awayWork || [], '복직이면 인사 카드에서 [휴직 끝내기]를 눌러주세요');
  add('공휴일 출근', res.holWork, set.subMode === '휴무날·공휴일' ? piled : '');
  add('지원 근무(다른 매장에서 출근)', res.support);
  if (lines.length === 1) lines.push('빠진 기록 없이 모두 정상이에요.');
  // 내일 사람이 모자란 매장([매장] 최소인원. 비우면 아무도 없는 매장만). 여기서 오류가 나도 마감 정리는 그대로 보내요
  try { res.thin = thinLines_(addDays_(date, 1), ctx); } catch (err) { console.error(err); res.thin = []; }
  if (res.thin.length) lines.push('', whenOf_(addDays_(date, 1)) + ' 사람이 모자란 매장 ' + res.thin.length + '곳 → 휴무를 다시 보거나 지원·대타를 정해 주세요', res.thin.join('\n'));
  // 날짜가 지났는데 아직 처리 안 된 요청(그날 칸이 빈칸으로 남아 있어요)
  var stale = reqs.filter(function (q) { return q.date <= date && (q.state === '대기' || q.state === '수락'); })
    .map(function (q) { return q.name + ' ' + mmdd_(q.date) + ' ' + KIND_NAME[q.kind]; });
  if (stale.length) lines.push('', '날짜가 지났는데 처리 안 된 요청 ' + stale.length + '건 → 사장님 화면 [오늘]에서 승인·거절해 주세요', stale.join('\n'));
  // 지난달을 아직 마감하지 않았으면 5일부터 알려줘요(휴무표 탭이 있고, 앱을 쓰던 달일 때만)
  var pm = prevYm_(ym);
  if (Number(date.slice(8)) >= 5 && !isClosed_(pm) && monthSheet_(pm) && started_(set, pm + '-' + pad2_(daysIn_(pm)))) {
    lines.push('', Number(pm.slice(5)) + '월을 아직 마감하지 않았어요 → 사장님 화면 [월별]에서 ' + Number(pm.slice(5)) + '월을 열고 [마감하기]');
  }
  // 11월부터: 내년 공휴일이 앱에 없으면 알려요(없으면 명절에 모두 '결근?'이 적혀요)
  if (Number(date.slice(5, 7)) >= 11) {
    var ny = String(Number(date.slice(0, 4)) + 1);
    var nh = Object.keys(holidays_()).filter(function (d) { return d.slice(0, 4) === ny; }).length;
    if (nh < 5) lines.push('', '내년(' + ny + '년) 공휴일이 아직 앱에 없어요 → 정부 발표를 보고 [설정] 탭 공휴일추가에 적어 주세요(예: ' + ny + '-01-01 신정). 안 적으면 명절에 결근?이 적혀요.');
  }
  // 위치를 등록하지 않은 매장(직원이 있는 곳): 그 매장 직원은 어디서든 출근이 찍혀요
  if (set.mode === '필수') {
    var used = {};
    staff_().forEach(function (p) { if (p.active && p.store && p.name !== TEST_NAME && p.name !== '예시직원') used[p.store] = true; });
    var noPlace = stores_().filter(function (st) { return used[st.name] && (st.lat == null || st.lng == null); }).map(function (st) { return st.name; });
    if (noPlace.length) lines.push('', '위치를 등록하지 않은 매장: ' + noPlace.join(', ') + ' → 그 매장 직원은 어디서든 출근이 찍혀요. 매장 안에서 사장님 화면 [설정] → [여기로 등록]');
  }
  // 수습 끝·계약 끝: 30일 전·7일 전·전날에 알려요
  try {
    res.hrDue = hrDueList_(date, 30).filter(function (x) { return x.left === 30 || x.left === 7 || x.left === 1; }).map(function (x) {
      return (x.store ? '[' + x.store + '] ' : '') + x.name + ' ' + x.kind + ' 끝 ' + whenOf_(x.end) + ' · ' + (x.left === 1 ? '내일이에요' : x.left + '일 남음');
    });
  } catch (err) { console.error(err); res.hrDue = []; }
  if (res.hrDue.length) lines.push('', '수습·계약 ' + res.hrDue.length + '건 → 이어서 쓸지 정해서 인사 카드의 수습 끝·계약 끝을 고치거나, 끝내면 퇴사 처리(계약 만료)를 해 주세요', res.hrDue.join('\n'));
  res.text = lines.join('\n');
  if (!dry) notify_(set, '하루 마감 정리', res.text, { silent: true });
  if (!dry) {
    try { syncHr_(); } catch (err) { console.error(err); } // [직원]·[인사] 맞추기(하루 한 번)
  }
  return res;
}

var STEP_FAILS_ = []; // 10분 자동 실행 중에 못 한 일(사장님께 하루 한 번 알려요)
function stepFail_(what, err) {
  console.error(err);
  STEP_FAILS_.push({ what: what, msg: String(err && err.message || err).slice(0, 200) });
}

/* ───────────── 앱 상태 띠: 자동 실행 멈춤 · 텔레그램 실패 · 웹 앱 예전 버전 (사장님 화면 맨 위 빨간 띠) ───────────── */

/**
 * 코드 버전. 한 파일 버전(dist/Code.gs)을 만들 때 build.js가 세 파일 내용으로 만든 짧은 번호로 바꿔 넣어요(원본은 'dev').
 * setup과 10분 자동 실행은 시트에 붙여넣은 최신 코드로 돌고, 웹 앱은 배포한 버전으로 돌아요.
 * 그래서 앞의 둘이 적어 둔 번호와 웹 앱의 번호를 비교하면 웹 앱이 예전 버전인지 알 수 있어요.
 */
var CODE_VER = 'dev';
var HEALTH_ = { beat: 'health:beat', setup: 'health:setupAt', seen: 'health:seen', tg: 'health:tg', ver: 'health:ver' };
var HEALTH_STALE_MS = 30 * 60 * 1000; // 자동 실행이 이만큼 안 돌면 멈춘 거예요(10분마다 도니까 세 번 빠짐)
var HEALTH_FIX_BEAT = ' 시트 메뉴 출퇴근 → setup 실행을 눌러 주세요. 그동안 미출근 알림과 밤 마감 정리가 멈춰 있어요.';
var TG_SYSTEM_ = { token: true, net: true, busy: true, quota: true }; // 누구에게나 안 가는 문제(직원에게 보낸 게 되면 지워요)
var TG_SHORT_ = { token: '봇 토큰이 안 맞아요', chat: '봇이 채팅방에서 빠졌거나 막혔어요', busy: '텔레그램 서버가 이 봇을 잠깐 막았어요', quota: '구글 하루 사용 한도를 다 썼어요', net: '텔레그램 서버에 연결이 안 돼요' };
var TG_FIX_ = {
  token: '봇 토큰이 바뀌었거나 봇이 지워졌어요. [텔레그램 연결 끊기]를 누르고 BotFather에서 받은 토큰으로 다시 연결해 주세요.',
  chat: '텔레그램에서 봇을 다시 열어 [시작]을 누르거나, 단톡방이면 봇을 다시 초대해 주세요. 그래도 안 되면 [텔레그램 연결 끊기] 뒤 다시 연결해 주세요.',
  busy: '조금 뒤에 다시 눌러 주세요. 새로 만든 봇은 텔레그램 쪽 사정으로 몇 시간 동안 이럴 수 있어요(알림만 못 가고 출퇴근은 그대로 돼요).',
  quota: '구글이 이 앱에 주는 하루 인터넷 사용 한도를 다 썼어요. 내일 저절로 풀려요(그동안 알림만 못 가요).',
  net: '텔레그램 서버나 인터넷이 잠깐 안 되는 것 같아요. 10분쯤 뒤에 다시 눌러 주세요.',
  etc: '잠시 뒤 다시 눌러 주세요. 계속 안 되면 [텔레그램 연결 끊기] 뒤 다시 연결해 주세요.',
};

/** 10분 자동 실행(checkMissing)이 돌 때마다: 돈 시각과 코드 버전을 적어 둬요. 줄을 못 서서 일을 건너뛰어도 적어요. */
function healthBeat_(now) {
  try {
    var props = PropertiesService.getScriptProperties();
    props.setProperty(HEALTH_.beat, now.date + ' ' + now.time);
    healthVer_(props);
  } catch (err) { console.error(err); }
}

/** setup이 돌 때: 그 시각(자동 실행을 다시 켠 뒤 30분은 '멈춤' 띠를 안 띄워요)과 코드 버전을 적어요. */
function healthSetup_() {
  try {
    var props = PropertiesService.getScriptProperties();
    var now = nowKst_();
    props.setProperty(HEALTH_.setup, now.date + ' ' + now.time);
    healthVer_(props);
  } catch (err) { console.error(err); }
}

/** 시트에 붙여넣은 코드의 버전을 맨 앞에 적어요(지금까지 본 버전을 최근 것부터 10개). */
function healthVer_(props) {
  var list = String(props.getProperty(HEALTH_.ver) || '').split(',').filter(String);
  if (list[0] === CODE_VER) return;
  props.setProperty(HEALTH_.ver, [CODE_VER].concat(list.filter(function (v) { return v !== CODE_VER; })).slice(0, 10).join(','));
}

/** 'YYYY-MM-DD HH:MM'(한국 시간) → 밀리초. 못 읽으면 0. */
function healthMs_(s) {
  var m = /^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2})/.exec(String(s || ''));
  return m ? Date.parse(m[1] + 'T' + m[2] + ':00+09:00') || 0 : 0;
}

/** 오늘이면 'HH:MM', 아니면 'M/D HH:MM'. */
function healthWhen_(s, now) {
  s = String(s || '');
  return s.slice(0, 10) === now.date ? s.slice(11, 16) : Number(s.slice(5, 7)) + '/' + Number(s.slice(8, 10)) + ' ' + s.slice(11, 16);
}

/** 10분 자동 실행(checkMissing 시간 트리거)이 있는지. 못 알아보면 null(그때는 '꺼져 있어요' 띠를 안 띄워요). */
function healthTrigger_() {
  try {
    return ScriptApp.getProjectTriggers().some(function (t) {
      if (t.getHandlerFunction() !== 'checkMissing') return false;
      try { return !ScriptApp.EventType || t.getEventType() === ScriptApp.EventType.CLOCK; } catch (err) { return true; }
    });
  } catch (err) {
    console.error(err);
    return null;
  }
}

/** 사장님 화면 [오늘]에 보낼 앱 상태(관리자만, 점장은 null). 오류가 나도 화면은 그대로 열려요. */
function healthFor_(a, now) {
  if (!a || a.role !== 'admin') return null;
  try { return healthBanners_(a.set, now); } catch (err) { console.error(err); return null; }
}

/**
 * 빨간 띠 목록 { list: [{key, text}], beat: 마지막 자동 실행, trigger: 자동 실행이 있는지, ver: 이 웹 앱의 코드 버전 }
 *  - beat: 08:00~23:30에 마지막 자동 실행이 30분 넘게 전이거나, 자동 실행(트리거)이 아예 없어요
 *  - tg:   텔레그램 알림이 실패하는 중이에요(다시 되면 저절로 사라져요)
 *  - ver:  시트에 붙여넣은 코드가 바뀌었는데 웹 앱은 예전 버전이에요
 */
function healthBanners_(set, now) {
  var props = PropertiesService.getScriptProperties();
  var all = props.getProperties();
  var list = [];
  var nowMs = Date.now();
  var beat = all[HEALTH_.beat] || '';
  var trig = healthTrigger_();
  if (trig === false) {
    list.push({ key: 'beat', text: (beat ? '자동 실행이 ' + healthWhen_(beat, now) + ' 뒤로 멈췄어요.' : '자동 실행이 꺼져 있어요.') + HEALTH_FIX_BEAT });
  } else {
    // setup을 막 돌렸으면(자동 실행을 새로 켬) 첫 실행 전이라도 그때부터 30분은 기다려요
    var last = Math.max(healthMs_(beat), healthMs_(all[HEALTH_.setup]));
    if (!last) {
      // 이 기능이 든 코드로 바꾼 뒤 setup도 자동 실행도 아직 안 돌았어요: 처음 본 때부터 30분 기다려요
      last = healthMs_(all[HEALTH_.seen]);
      if (!last) { props.setProperty(HEALTH_.seen, now.date + ' ' + now.time); last = nowMs; }
    }
    var awake = now.min >= 8 * 60 && now.min < 23 * 60 + 30;
    if (awake && nowMs - last > HEALTH_STALE_MS) {
      list.push({ key: 'beat', text: (beat ? '자동 실행이 ' + healthWhen_(beat, now) + ' 뒤로 멈췄어요.' : '자동 실행이 아직 한 번도 안 돌았어요.') + HEALTH_FIX_BEAT });
    }
  }
  var tg = tgFailRead_(all[HEALTH_.tg]);
  if (tg && set.tgToken && (TG_SYSTEM_[tg.kind] || set.tgChat)) {
    list.push({ key: 'tg', text: '텔레그램 알림이 ' + healthWhen_(tg.at, now) + '부터 안 가요(' + tg.err + '). [설정] → 텔레그램 → [연결 확인]을 눌러 주세요.' });
  }
  // 이 웹 앱의 번호가 예전에 시트 코드였던 번호면(맨 앞이 지금 시트 코드) 웹 앱이 예전 버전이에요.
  // 한 번도 못 본 번호면 setup·자동 실행 전에 막 새로 배포한 것이라 띄우지 않아요
  if (String(all[HEALTH_.ver] || '').split(',').indexOf(CODE_VER) > 0) {
    list.push({ key: 'ver', text: '시트에 붙여넣은 코드가 바뀌었는데 웹 앱은 아직 예전 버전이에요. Apps Script → 배포 → 배포 관리 → 연필 → 버전: 새 버전 → 배포를 눌러 주세요.' });
  }
  return { list: list, beat: beat, trigger: trig, ver: CODE_VER };
}

/**
 * notify_·notifyStaff_가 쓰는 텔레그램 보내기. 실패하면 처음 실패한 때와 짧은 이유를 적어 두고(사장님 화면 빨간 띠), 다시 되면 지워요.
 * who: 'owner'(사장님 채팅방) 또는 'staff'(직원 한 명). 직원 한 명이 봇을 막은 것처럼 그 사람만의 문제는 띠로 안 띄워요.
 */
function tgSend_(token, payload, who) {
  var res;
  try {
    res = tgCall_(token, 'sendMessage', payload);
  } catch (err) {
    tgHealth_(who, err);
    throw err;
  }
  tgHealth_(who, null);
  return res;
}

/** 보낸 결과를 적어요(err가 없으면 성공). 속성은 바뀔 때만 써요. */
function tgHealth_(who, err) {
  try {
    var props = PropertiesService.getScriptProperties();
    var cur = memo_('tgFail', function () { return tgFailRead_(props.getProperty(HEALTH_.tg)); });
    if (!err) {
      // 사장님 방에 가면 다 지우고, 직원에게 간 것은 토큰·서버 문제만 지워요(사장님 방 문제는 그대로)
      if (cur && (who === 'owner' || TG_SYSTEM_[cur.kind])) { props.deleteProperty(HEALTH_.tg); MEMO_.tgFail = null; }
      return;
    }
    var kind = tgKind_(err);
    if (who !== 'owner' && !TG_SYSTEM_[kind]) return; // 그 직원만의 문제(봇 차단·채팅방 없음)
    if (cur && (who !== 'owner' || cur.kind === kind)) return; // 이미 적혀 있어요(처음 실패한 때를 그대로 둬요)
    var now = nowKst_();
    var rec = { at: cur ? cur.at : now.date + ' ' + now.time, kind: kind, err: tgShort_(err) };
    props.setProperty(HEALTH_.tg, JSON.stringify(rec));
    MEMO_.tgFail = rec;
  } catch (e) { console.error(e); }
}

function tgFailRead_(s) {
  try { var r = JSON.parse(s || 'null'); return r && r.at ? r : null; } catch (err) { return null; }
}

/** 텔레그램을 새로 연결·해제할 때: 예전 실패 기록을 지워요. */
function tgHealthClear_() {
  try { PropertiesService.getScriptProperties().deleteProperty(HEALTH_.tg); MEMO_.tgFail = null; } catch (err) { console.error(err); }
}

/** 텔레그램 오류 종류: token(봇 토큰), chat(채팅방에서 빠짐·차단), busy(너무 많이 보냄·구글 하루 한도), net(서버·인터넷), etc(그 밖) */
function tgKind_(err) {
  var m = String(err && err.message || err || '');
  if (!/^텔레그램 오류:/.test(m)) return /too many times/i.test(m) ? 'quota' : 'net'; // 보내지도 못했어요(인터넷·구글 하루 한도)
  if (/Unauthorized|Not Found$|HTTP 40[14]$/.test(m)) return 'token';
  if (/Too Many Requests|HTTP 429$/.test(m)) return 'busy';
  if (/HTTP 5\d\d$|Internal Server Error|Bad Gateway|Service Unavailable|Gateway Timeout/i.test(m)) return 'net';
  if (/chat not found|blocked|kicked|deactivated|Forbidden|not a member|supergroup|user not found|rights/i.test(m)) return 'chat';
  return 'etc';
}

/** 사장님께 보여 줄 짧은 이유. 토큰·긴 숫자(채팅방 번호 등)는 가려요. */
function tgShort_(err) {
  var short = TG_SHORT_[tgKind_(err)];
  if (short) return short;
  var m = String(err && err.message || err || '').replace(/^텔레그램 오류:\s*/, '').replace(/bot\d+:[\w-]+/g, 'bot…').replace(/\d{5,}/g, '…');
  if (/message is too long/i.test(m)) return '알림 글이 너무 길어요';
  return clean_(m, 40) || '알 수 없는 오류';
}

/**
 * [설정] → 텔레그램 → [연결 확인](연결된 뒤): 사장님 채팅방에 시험 메시지를 보내 봐요(메일로 대신 보내지 않아요).
 * 되면 빨간 띠가 사라지고, 안 되면 이유와 고치는 법을 알려줘요.
 */
function adminTelegramCheck(pin) {
  var set = adminAuth_(pin);
  if (!set.tgToken || !set.tgChat) throw new Error('텔레그램이 아직 연결되지 않았어요. 아래 순서대로 연결해 주세요.');
  try {
    tgSend_(set.tgToken, { chat_id: set.tgChat, text: '[' + set.store + ' 출퇴근] 연결 확인: 알림이 잘 와요.', disable_web_page_preview: true }, 'owner');
  } catch (err) {
    throw new Error('텔레그램으로 못 보냈어요(' + tgShort_(err) + '). ' + TG_FIX_[tgKind_(err)]);
  }
  return { ok: true, info: info_(settings_()) };
}

/**
 * 미출근 알림을 (다시) 보낼 때인지. v: 'alert:날짜:이름' 값. '1' = 보냄, 'retry:처음분:마지막분' = 못 보내서 다시 해 보는 중.
 * 다시 보내기는 10분 자동 실행마다 한 번(트리거가 조금 일찍 돌아도 되게 8분), 처음 보낸 때부터 1시간까지만이에요.
 */
function alertDue_(v, now) {
  if (!v) return true;
  var m = /^retry:(\d+):(\d+)$/.exec(String(v));
  return !!m && now.min - Number(m[2]) >= 8 && now.min - Number(m[1]) < 60;
}

/** 보내기 전에 '보내는 중'으로 적어요(겹쳐 돈 실행이 또 보내지 않게). 못 보내면 이 표시가 남아서 다음 실행이 다시 해요. */
function alertTry_(props, sent, key, now) {
  var m = /^retry:(\d+):/.exec(String(sent[key] || ''));
  var v = 'retry:' + (m ? m[1] : now.min) + ':' + now.min;
  props.setProperty(key, v);
  sent[key] = v;
}

/**
 * 보낸 뒤: 직원 본인이나 사장님(텔레그램·메일) 중 한 곳이라도 갔으면 '보냄'(1)으로 적어요. 보낼 곳이 아예 없어도 1.
 * tried: [{key, staff: 직원에게 보낼 곳이 있었는지, ok: 직원에게 갔는지}], via: 사장님 알림이 간 곳(''이면 못 감)
 */
function alertSent_(props, sent, tried, via, owner) {
  tried.forEach(function (a) {
    if (!a.ok && !via && (a.staff || owner)) return; // 아무 데도 못 갔어요: 'retry' 표시를 남겨 다음 실행이 다시 해요
    props.setProperty(a.key, '1');
    sent[a.key] = '1';
  });
}

/**
 * 이번 달·다음 달 휴무표의 이월·부여가 지난달 탭과 이어져 있는지 봐요.
 * 구글 시트는 수식이 가리키던 탭을 지우면 수식 글자가 '#REF!'로 바뀌어요(이월·부여가 조용히 0이 돼요).
 *  - 지난달 탭이 다시 있으면(같은 이름으로 다시 만들었으면) 수식을 다시 이어요
 *  - 없으면 되살리라고 알려요
 * 알릴 말 목록을 돌려줘요.
 */
function monthLinkCheck_(set, now) {
  var out = [];
  [now.ym, nextYm_(now.ym)].forEach(function (ym) {
    var g = monthGrid_(ym, true);
    if (!g || g.bad || g.cols.grant < 1) return;
    var last = g.sh.getLastRow();
    if (last < 3) return;
    var fx = g.sh.getRange(3, g.cols.grant, last - 2, 2).getFormulas(); // 이월·부여
    if (!fx.some(function (r) { return /#REF!/.test(r[0] + r[1]); })) return;
    var pm = prevYm_(ym);
    if (monthSheet_(pm)) {
      relinkMonth_(ym);
      out.push('[' + monthName_(ym) + '] 탭의 이월·부여 수식이 끊겨 있어서(#REF!) [' + monthName_(pm) + '] 탭과 다시 이었어요. 월차 숫자를 한 번 확인해 주세요.');
    } else {
      out.push('[' + monthName_(pm) + '] 탭을 지워서 [' + monthName_(ym) + '] 탭의 이월·부여가 0으로 나와요. 파일 → 버전 기록에서 되살려 주세요. 안 보이게 하려면 지우지 말고 탭 오른쪽 클릭 → 시트 숨기기를 쓰세요.');
    }
  });
  return out;
}

/** 처음 한 번 실행: 시트를 만들고 10분마다 도는 알림을 켭니다. 다시 실행해도 기존 기록은 안 지워져요. */
function setup() {
  if (!ownerRun_()) throw new Error('setup은 시트 메뉴(출퇴근 → setup 실행)나 Apps Script 편집기에서만 실행할 수 있어요.');
  hrKeyGuard_(); // 주민번호 열쇠 없이 암호 칸만 있으면(사본 파일·새 프로젝트) 새 열쇠를 만들지 않고 멈춰요
  monthRename_(); // 예전 이름('휴무표 2026-11') 탭을 '26.11'로
  healthSetup_(); // 이 코드의 버전과 setup 한 때를 적어요(사장님 화면 '웹 앱이 예전 버전'·'자동 실행 멈춤' 띠)
  var ss = book_();
  var t0 = Date.now();
  var props = PropertiesService.getScriptProperties();
  var run = null;
  try { run = JSON.parse(props.getProperty('setupRun') || 'null'); } catch (err) { run = null; }
  // 1시간 안에 중간에 멈춘 setup이 있으면 끝난 단계는 건너뛰고 이어서 해요
  var done = run && run.ver === SETUP_VER && t0 - run.at < 3600e3 && run.done ? run.done : [];
  if (done.length) console.log('이어서 해요(끝난 단계: ' + done.join(', ') + ')');
  ss.setSpreadsheetTimeZone('Asia/Seoul');
  var n = SETUP_STEPS.length;
  for (var i = 0; i < n; i++) {
    var name = SETUP_STEPS[i][0];
    if (done.indexOf(name) >= 0) continue;
    // 구글은 한 번에 6분까지라, 4분이 지나면 다음 단계는 다음 실행으로 넘겨요
    if (Date.now() - t0 > SETUP_BUDGET_MS) {
      props.setProperty('setupRun', JSON.stringify({ ver: SETUP_VER, at: Date.now(), done: done }));
      return setupTell_(ss, '시간이 오래 걸려서 ' + i + '/' + n + '단계까지 하고 멈췄어요. setup을 한 번 더 실행하면 이어서 해요.');
    }
    setupTell_(ss, (i + 1) + '/' + n + ' ' + name + ' 맞추는 중…');
    var s = Date.now();
    SETUP_STEPS[i][1](ss);
    done.push(name);
    props.setProperty('setupRun', JSON.stringify({ ver: SETUP_VER, at: Date.now(), done: done }));
    console.log((i + 1) + '/' + n + ' ' + name + ' 끝 (' + Math.round((Date.now() - s) / 1000) + '초)');
  }
  props.deleteProperty('setupRun');
  return setupTell_(ss, '설정 완료! (' + Math.round((Date.now() - t0) / 1000) + '초) [설정] 탭에서 관리자PIN을 6자리 이상으로 바꾸고(바꾸기 전에는 사장님 화면이 안 열려요), [매장]·[직원] 탭을 확인한 뒤 웹 앱으로 배포하세요.');
}

/**
 * setup 단계. 단계마다 끝나면 기록해 두고, 시간이 모자라 멈추면 다음 실행이 이어서 해요.
 * (단계 이름을 바꾸거나 단계를 더하면 SETUP_VER도 올려요)
 */
var SETUP_VER = 2;
var SETUP_BUDGET_MS = 4 * 60 * 1000;
var SETUP_STEPS = [
  ['설정 탭', setupSettings_],
  ['매장·직원 탭', setupPeople_],
  ['기록 탭', setupRecords_],
  ['인사 탭', setupHr_],
  ['이번 달 휴무표', function () { setupMonth_(nowKst_().ym); }],
  ['다음 달 휴무표', function () { setupMonth_(nextYm_(nowKst_().ym)); }],
  ['1년 탭', setupYearTabs_],
  ['자동 실행', setupTriggers_],
];

/** 실행 기록(편집기 아래 실행 로그)과 시트 오른쪽 아래 알림으로 알려요. 누를 때까지 기다리는 창은 안 띄워요. */
function setupTell_(ss, msg) {
  console.log(msg);
  try { ss.toast(msg, '출퇴근 setup', 10); } catch (err) { /* 시트가 안 열려 있으면 넘어가요 */ }
  return msg;
}

function setupSettings_(ss) {
  var set = ensureSheet_(ss, SHEETS.set, ['항목', '값', '설명'], SETTINGS, ['@', '@', '@']);
  var have = rows_(SHEETS.set).map(function (r) { return String(r[0]).trim(); });
  var missing = SETTINGS.filter(function (row) { return have.indexOf(row[0]) < 0; });
  if (missing.length) {
    var at = Math.max(set.getLastRow(), 1) + 1;
    if (at + missing.length - 1 > set.getMaxRows()) set.insertRowsAfter(set.getMaxRows(), missing.length);
    set.getRange(at, 1, missing.length, 3).setNumberFormat('@').setValues(missing);
  }
  forget_('set');
  set.setColumnWidth(1, 120);
  set.setColumnWidth(2, 160);
  set.setColumnWidth(3, 520);
}

function setupPeople_(ss) {
  var store = ensureSheet_(ss, SHEETS.store, STORE_HEAD, [['본점', '11:00', '', '', '', '', '', '', '1', '']], STORE_HEAD.map(function () { return '@'; }));
  // 예전 [매장] 탭에 없는 칸(점장, 최대휴무, 월휴무)은 오른쪽 끝에 붙여요
  var sc = addHeads_(store, STORE_HEAD);
  var notes = {
    '점장': '그 매장 점장 이름([직원] 탭과 똑같이). 여러 명이면 쉼표로. 점장은 직원 요청을 먼저 보고 관리자에게 올리거나 돌려보내요',
    '최대휴무': '하루에 쉴 수 있는 사람 수. 비우면 1명, 0이면 제한 없음. 직원이 다음 달 휴무를 고를 때 확인해요',
    '월휴무': '직원 한 명이 한 달에 고를 수 있는 휴무 일수. 비우면 제한 없음',
    '최소인원': '그날 이 매장에서 일해야 하는 사람 수. 모자라면 전날 밤 마감 정리와 휴무 승인 카드에 알려요. 비우면 아무도 없을 때만 알려요. 0이면 알리지 않아요(잠깐 닫는 매장 등)',
  };
  Object.keys(notes).forEach(function (h) { store.getRange(1, sc[h] + 1).setNote(notes[h]); });
  forget_('stores');
  var staff = ensureSheet_(ss, SHEETS.staff, STAFF_HEAD,
    [['예시직원', '본점', '', 10320, '', '', '', '', '', '', '', '', '', '']],
    STAFF_HEAD.map(function (h) { return STAFF_FMT[h] || '@'; }));
  // 예전에 만든 [직원] 시트에 없는 칸(매장, 등록폰 등)은 오른쪽 끝에 붙이고 서식을 맞춰요
  var have2 = staffCols_();
  STAFF_HEAD.forEach(function (h) {
    if (have2[h] != null) return;
    var c = Math.max(staff.getLastColumn(), 1) + 1;
    staff.getRange(1, c).setValue(h).setFontWeight('bold').setBackground('#eef2f7');
    have2[h] = c - 1;
  });
  var sfmts = [];
  Object.keys(have2).forEach(function (h) { if (STAFF_HEAD.indexOf(h) >= 0) sfmts[have2[h]] = STAFF_FMT[h] || '@'; });
  for (var si = 0; si < sfmts.length; si++) if (sfmts[si] === undefined) sfmts[si] = null;
  colFormats_(staff, 1, sfmts);
}

function setupRecords_(ss) {
  ensureSheet_(ss, SHEETS.change, CHANGE_HEAD, [], ['@', '@', '@', '@']);
  ensureSheet_(ss, SHEETS.log, LOG_HEAD, [], LOG_FMT);
  ensureSheet_(ss, SHEETS.suspect, SUSPECT_HEAD, [], ['@', '@', '@', '@']);
  var rq = ensureSheet_(ss, SHEETS.req, REQ_HEAD, [], REQ_HEAD.map(function () { return '@'; }));
  addTailCols_(rq, REQ_HEAD.slice(0, R.proof), R.route); // 예전 [요청] 탭: 보낼곳·점장확인
  addTailCols_(rq, REQ_HEAD, R.proof); // 증빙(사장님이 그 자리에 쓰던 칸이 있으면 앞에 끼워 넣어요)
  addTailCols_(sheet_(SHEETS.log), LOG_HEAD, C.store); // 예전 [출퇴근기록] 탭: 매장
  var sub = ensureSheet_(ss, SHEETS.sub, SUB_HEAD, [], SUB_FMT);
  // 보기 쉽게 색칠: 출퇴근기록(주말·지각·퇴근 누락), 요청(상태), 대체휴무(적립·사용)
  logRules_(sheet_(SHEETS.log));
  statusRules_(rq, R.state + 1, [['대기', '#fef3c7'], ['수락', '#fef3c7'], ['승인', '#dcfce7'], ['거절', '#fee2e2'], ['돌려보냄', '#fee2e2'], ['취소', '#f1f5f9']]);
  statusRules_(sub, 3, [['적립', '#dcfce7'], ['사용', '#ffedd5']]);
}

/** 머리글 head가 없으면 after 머리글 바로 오른쪽에 칸을 끼워 넣어요(after도 없으면 아무것도 안 해요: addHeads_가 끝에 붙여요). */
function insertHeadAfter_(sh, head, after) {
  var width = Math.max(sh.getLastColumn(), 1);
  var heads = sh.getRange(1, 1, 1, width).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
  var a = heads.indexOf(after);
  if (heads.indexOf(head) >= 0 || a < 0) return false;
  if (a + 1 >= sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), 1);
  else sh.insertColumnsBefore(a + 2, 1);
  sh.getRange(1, a + 2).setValue(head).setFontWeight('bold').setBackground('#eef2f7');
  sh.getRange(2, a + 2, Math.max(sh.getMaxRows() - 1, 1), 1).setNumberFormat('@');
  forget_('hrCols');
  forgetHr_();
  return true;
}

/** [인사]: 입사일·지점 이동·퇴사, 연락처·계좌·비고. 주민번호 암호 칸과 가입 임시 칸은 숨겨요 */
function setupHr_(ss) {
  var hr = ensureSheet_(ss, SHEETS.hr, HR_HEAD, [], []); // 글자 서식(@)은 아래에서 칸 이름으로 맞춰요
  insertHeadAfter_(hr, '휴대폰2', '휴대폰'); // 예전 [인사] 탭: 추가 휴대폰 칸을 휴대폰 바로 옆에
  insertHeadAfter_(hr, '입사 서류', '비고'); // 체크 칸 두 개는 비고 옆에
  insertHeadAfter_(hr, '퇴사 정리', '입사 서류');
  var hc = addHeads_(hr, HR_HEAD);
  // 앱 칸만 글자 서식(@): 이어진 칸은 한 번에(시트 작업 수를 줄여요). 사장님이 붙인 칸(보건증 만료 등)은 그대로
  var tc = HR_HEAD.map(function (h) { return hc[h]; }).filter(function (c) { return c != null; }).sort(function (a, b) { return a - b; });
  var hrRows = hr.getMaxRows() - 1;
  for (var ti = 0; hrRows > 0 && ti < tc.length;) {
    var tj = ti;
    while (tj + 1 < tc.length && tc[tj + 1] === tc[tj] + 1) tj++;
    hr.getRange(2, tc[ti] + 1, hrRows, tc[tj] - tc[ti] + 1).setNumberFormat('@');
    ti = tj + 1;
  }
  var hw = Math.max(hr.getLastColumn(), HR_HEAD.length), hnotes = [];
  for (var hi = 0; hi < hw; hi++) hnotes.push('');
  Object.keys(HR_NOTES).forEach(function (h) { if (hc[h] != null) hnotes[hc[h]] = HR_NOTES[h]; });
  hr.getRange(1, 1, 1, hw).setNotes([hnotes]);
  hr.hideColumns(hc['주민번호(암호)'] + 1);
  hr.hideColumns(hc['가입(임시)'] + 1);
  hr.setFrozenColumns(1);
  statusRules_(hr, hc['상태'] + 1, [['근무', '#dcfce7'], [HR_WAIT, '#fef3c7'], ['퇴사', '#f1f5f9']]);
  // 지점·상태 칸은 목록에서 고를 수 있게(직접 적거나 붙여넣어도 돼요. 목록에 없는 값은 귀퉁이에 빨간 표시만)
  var pick = function (h, list) {
    if (hc[h] == null || !list.length) return;
    hr.getRange(2, hc[h] + 1, Math.max(hr.getMaxRows() - 1, 1), 1)
      .setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(list, true).setAllowInvalid(true).build());
  };
  pick('지점', stores_().map(function (st) { return st.name; }));
  pick('상태', ['근무', '퇴사', HR_WAIT]);
  forget_('hrCols');
  forgetHr_();
  hrKey_(true); // 주민번호 열쇠(스크립트 속성에만)
  syncHr_(); // 지금 직원들 줄을 만들어 둬요
}

/** 그 달 휴무표: 빠진 직원·만근 칸을 넣고, 예전 탭도 공휴일 표시·색칠 규칙(결근?, 휴무?, 대체, 만근)을 맞춰요 */
function setupMonth_(ym) {
  ensureMonth_(ym);
  if (ym === nowKst_().ym) clearEarlyAbsent_(settings_()); // 앱 시작 전에 잘못 적힌 '결근?' 치우기
  relinkMonth_(ym); // 이월·부여·만근 수식을 지금 것으로(앞 달 탭과 다시 잇기)
  var g = monthGrid_(ym, true);
  if (!g) return;
  if (fixStoreLabels_(ym)) g = monthGrid_(ym, true); // 예전 매장 이름·옮긴 사람의 매장 칸을 지금 [직원] 탭에 맞춰요
  paintMonth_(g.sh, ym, g.cols);
  monthRules_(g.sh, g.cols.day1, g.cols);
}

/**
 * 이번 달·다음 달 휴무표의 매장 칸을 지금 [직원] 탭에 맞춰요.
 *  - 예전 매장 이름([설정] 예전매장이름: 사무실(영) → 사무실(왕))은 이름만 바꿔 적어요
 *  - 근무 중인 직원의 매장 칸이 [직원] 탭과 다르면 그 줄을 지금 매장 묶음으로 옮겨요
 * 지난달 탭은 건드리지 않아요(그때 있던 매장이 기록이에요). 바꾼 줄 수를 돌려줘요.
 */
function fixStoreLabels_(ym) {
  if (ym < nowKst_().ym) return 0;
  var g = monthGrid_(ym);
  if (!g) return 0;
  var names = storeNames_(), known = {}, n = 0;
  stores_().forEach(function (st) { known[st.name] = true; });
  var move = [];
  Object.keys(g.rows).forEach(function (name) {
    var r = g.rows[name], label = String(r.vals[g.cols.store] || '').trim();
    var canon = names[label] || label;
    var p = findStaff_(name);
    if (canon !== label && known[canon]) {
      g.sh.getRange(r.row, g.cols.store + 1).setNumberFormat('@').setValue(canon);
      n++;
    }
    if (p && p.active && p.store && known[p.store] && canon !== p.store) move.push({ name: name, store: p.store });
  });
  if (n) delete GRID_[ym];
  move.forEach(function (m) {
    var h = hrFind_(m.name);
    var last = h && h.moves ? h.moves.split(' · ').filter(function (t) { return t.indexOf('→' + m.store) >= 0; }).pop() : '';
    if (moveMonthRow_(ym, m.name, m.store, last || '')) n++;
  });
  return n;
}

/** PC에서 보는 1년 탭: 없을 때만 빈 틀로(B3에서 고르면 채워져요). 지난번에 그리다 멈춰서 연도 고르기 칸(D3)이 없으면 다시 그려요 */
function setupYearTabs_(ss) {
  [YEAR_TABS.staff, YEAR_TABS.store].forEach(function (t) {
    var y = ss.getSheetByName(t);
    if (!y || !y.getRange(3, 4).getDataValidation()) renderYearTab_(t, true);
  });
}

function setupTriggers_(ss) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    var h = t.getHandlerFunction();
    if (h === 'checkMissing' || h === 'sheetEdited') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('checkMissing').timeBased().everyMinutes(10).create();
  // 따로 만든 스크립트는 시트의 onEdit이 저절로 안 불려서, 직접 연결해요.
  if (SHEET_ID) ScriptApp.newTrigger('sheetEdited').forSpreadsheet(ss).onEdit().create();
}

/* ───────────── 인사 정보: 입사 등록, 인사 카드, 지점 이동·퇴사 기록, 연락처 저장 ───────────── */

/**
 * [인사] 탭: 한 사람 한 줄. 입사일·첫 지점·이동 기록·퇴사일, 연락처·계좌, 비고를 한곳에서 봐요.
 *  - 상태: 근무 / 퇴사 / 승인 대기(직원이 앱에서 입사 등록하고 사장님 승인 전)
 *  - 지점·상태는 [직원] 탭과 맞춰요. 어느 쪽에서 바꿔도 이동 기록·퇴사일이 남아요.
 *  - 주민번호는 법(개인정보 보호법)에 따라 암호화해서 보관해요. 시트에는 '950101-1******'처럼 가려서 보이고,
 *    전체 번호는 암호로 바꿔 숨긴 칸에 둬요(열쇠는 스크립트 속성에만). 사장님 화면에서 관리자 비밀번호로만 볼 수 있어요.
 */
var HR_HEAD = ['이름', '지점', '상태', '입사일', '첫 지점', '이동 기록', '퇴사일', '주민번호', '휴대폰', '휴대폰2', '주소', '은행', '계좌번호', '예금주', '비상연락처', '비고', '입사 서류', '퇴사 정리', '등록', '주민번호(암호)', '가입(임시)', '퇴사 사유', '수습 끝', '계약 끝'];
var HR_KEY = {
  name: '이름', store: '지점', state: '상태', start: '입사일', first: '첫 지점', moves: '이동 기록', end: '퇴사일',
  rrn: '주민번호', phone: '휴대폰', phone2: '휴대폰2', addr: '주소', bank: '은행', account: '계좌번호', holder: '예금주', emergency: '비상연락처',
  memo: '비고', docs: '입사 서류', offb: '퇴사 정리', reg: '등록', enc: '주민번호(암호)', join: '가입(임시)',
  reason: '퇴사 사유', probEnd: '수습 끝', contractEnd: '계약 끝',
};
var HR_WAIT = '승인 대기';
var HR_NOTES = {
  '지점': '지금 지점. 바꾸면 [직원] 탭 매장도 같이 바뀌고 이동 기록에 남아요(사장님 화면 [직원] → 지점 이동도 같아요)',
  '상태': '근무 / 퇴사 / 승인 대기. 퇴사로 바꾸면 [직원] 탭 재직도 퇴사가 되고 퇴사일이 적혀요',
  '이동 기록': '지점 이동·휴직·다시 입사가 날짜와 함께 자동으로 적혀요',
  '입사 서류': '받은 서류(사장님 화면 인사 카드에서 체크하면 적혀요. 항목은 [설정] 입사서류목록)',
  '퇴사 정리': '퇴사할 때 돌려받은 것·정리한 것(인사 카드에서 체크. 항목은 [설정] 퇴사정리목록)',
  '퇴사일': '마지막 근무일. 앞날을 적어 두면 그날까지 출퇴근을 찍을 수 있고, 다음 날 자동으로 퇴사 처리돼요',
  '주민번호': '앞 6자리와 성별 숫자만 보여요. 전체 번호는 암호로 보관하고, 사장님 화면에서 관리자 비밀번호로 봐요. 여기에 13자리를 적으면 저절로 가려져요',
  '휴대폰2': '두 번째·세 번째 번호(2개까지). 여러 개면 쉼표로, 번호 뒤에 메모를 붙일 수 있어요. 예: 010-1111-2222 업무용, 010-3333-4444',
  '비고': '자유롭게 적는 칸(계약서, 보건증, 특이사항 등)',
  '등록': '정보를 언제 누가 넣었는지',
  '퇴사 사유': '자진 퇴사 / 계약 만료 / 권고사직 / 해고 / 기타 (자세히). 사장님 화면 인사 카드에서 퇴사 처리할 때 골라요. 퇴사 예정·퇴사한 사람만 써요(근로자 명부에 나와요)',
  '수습 끝': '수습 기간 마지막 날. 입사 등록 승인 때 [설정] 수습개월로 채워져요. 30일 전·7일 전·전날 밤 마감 정리와 사장님 화면 [오늘]에 알려줘요',
  '계약 끝': '기간을 정한 계약의 마지막 날(정규직이면 비워요). 30일 전·7일 전·전날 알려줘요. 근로자 명부 계약 기간에도 나와요',
};

/* ── 직원 화면: 입사 등록(처음 온 직원), 내 인사 정보 ── */

/**
 * 처음 온 직원이 폰에서 입사 정보를 보내요. [인사] 탭에 '승인 대기'로 들어가고 사장님께 알림이 가요.
 * 사장님이 승인하면 [직원]·휴무표에 들어가고, 이 폰과 정한 비밀번호로 바로 출근을 찍어요.
 * f: {name, rrn, phone, addr, bank, account, holder, emergency, store, start, pin, device, label, agree}
 */
function joinSubmit(f) {
  f = f || {};
  var set = settings_();
  if (f.agree !== true) throw new Error('개인정보 수집·이용에 동의해야 등록할 수 있어요.');
  if (set.joinCode) {
    // 입사 코드: 점장·사장님이 알려준 숫자. 주소만 아는 사람이 장난으로 등록을 보내지 못하게 해요(5번 틀리면 10분 잠김)
    var code = String(f.code == null ? '' : f.code).replace(/\D/g, '');
    if (!code) throw new Error('입사 코드를 넣어주세요. 점장님이나 사장님께 물어보면 알려줘요.');
    // 잠금은 폰마다(한 사람이 여러 번 틀려도 다른 신입은 등록할 수 있게). 여러 폰으로 번호를 바꿔 가며 맞혀 보는 건 전체 상한(10분에 30번)으로 막아요
    var jc = CacheService.getScriptCache(), jAll = Number(jc.get('fail:joincode:all') || 0);
    if (jAll >= 30) throw new Error('입사 코드를 틀린 기록이 많아서 잠깐 막혔어요. 10분 뒤에 다시 해주세요.');
    var jGen = PropertiesService.getScriptProperties().getProperty('joinGen') || '0'; // 사장님이 코드를 다시 정하면 바뀌어서 잠금이 모두 풀려요
    guard_('joincode:' + jGen + ':' + (cleanDevId_(f.device) || 'n:' + String(f.name == null ? '' : f.name).trim().slice(0, 20)), code === set.joinCode,
      '입사 코드가 달라요. 점장님이나 사장님께 다시 확인해주세요.', function () { jc.put('fail:joincode:all', String(jAll + 1), 600); },
      '입사 코드를 여러 번 틀려서 잠깐 막혔어요. 10분 뒤에 다시 해주세요.');
  }
  var d = hrForm_(f, true, f.later === true);
  if (d.name === TEST_NAME) throw new Error('"' + TEST_NAME + '"는 쓸 수 없는 이름이에요.');
  var pin = String(f.pin == null ? '' : f.pin).trim();
  if (!/^\d{4,6}$/.test(pin)) throw new Error('앞으로 쓸 비밀번호를 숫자 4~6자리로 정해주세요.');
  if (EASY_PINS.indexOf(pin) >= 0) throw new Error('너무 쉬운 비밀번호예요(1234, 0000 같은). 다른 번호로 정해주세요.');
  var dev = cleanDevId_(f.device);
  if (!dev && set.device !== '안함') throw new Error('이 브라우저에서는 폰 확인이 안 돼요. 시크릿(사생활 보호) 모드를 끄고 다시 열어주세요.');
  var label = String(f.label || '폰').replace(/[#·\n]/g, ' ').slice(0, 30).trim();
  var now = nowKst_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    staff_().forEach(function (x) {
      if (x.name === d.name && x.active) throw new Error('이미 직원 명단에 있는 이름이에요. 본인이면 처음 화면에서 이름을 누르세요. 동명이인이면 이름 뒤에 구분을 붙여주세요(예: ' + d.name + 'B).');
      if (dev && hasDev_(x, dev) && x.active) throw new Error('이 폰은 ' + x.name + ' 님 폰으로 등록돼 있어요. 본인 폰으로 등록해주세요.');
    });
    var mine = null, waiting = 0;
    hrRows_().forEach(function (h) {
      if (h.state !== HR_WAIT) return;
      waiting++;
      var j = parseJoin_(h.join);
      var same = dev ? j.dev === dev : h.name === d.name;
      if (same && h.name !== d.name) {
        // 같은 폰인데 이름이 달라요: 다른 사람이 같은 폰으로 등록하면 앞사람 등록이 덮어써져서 막아요
        throw new Error('이 폰으로 이미 ' + h.name + ' 님 입사 등록을 보냈어요. 다른 분은 자기 폰으로 등록해 주세요. 이름을 잘못 적은 거라면 사장님께 말하면 승인할 때 고쳐 줘요.');
      }
      if (same) mine = h; // 같은 폰에서 같은 이름으로 다시 보내면(고쳐서) 덮어써요
      else if (h.name === d.name) throw new Error('같은 이름으로 승인을 기다리는 등록이 있어요. 사장님께 말씀해주세요.');
    });
    if (!mine && waiting >= 20) throw new Error('승인을 기다리는 등록이 너무 많아요. 사장님께 말씀해주세요.');
    PropertiesService.getScriptProperties().deleteProperty('joinNo:' + (dev || 'n:' + d.name)); // 반려된 뒤 다시 보내는 것
    // 고쳐서 다시 보내도 처음 보낸 시각은 그대로 둬요('등록 보낸 시각으로 출근'이 처음 온 시각이 되게)
    var firstReg = mine ? /^(\d{4}-\d{2}-\d{2} \d{1,2}:\d{2})/.exec(mine.reg || '') : null;
    var regText = (firstReg ? firstReg[1] : now.date + ' ' + now.time) + ' 본인 입력(입사 등록)' + (firstReg ? ' · ' + now.date + ' ' + now.time + ' 고쳐 보냄' : '');
    hrWrite_(mine ? mine.row : 0, {
      name: d.name, store: d.store, state: HR_WAIT, start: d.start || now.date, first: d.store,
      rrn: rrnMask_(d.rrn), enc: rrnEncrypt_(d.rrn), phone: d.phone, phone2: d.phone2, addr: d.addr, bank: d.bank,
      account: d.account, holder: d.holder || d.name, emergency: d.emergency,
      reg: regText, join: JSON.stringify({ pin: pin, dev: dev, label: label, loc: f.agreeLoc === true }), // loc: 출퇴근 확인(위치) 동의를 같이 했는지
    });
  } finally {
    lock.releaseLock();
  }
  notify_(set, '새 입사 등록', d.name + ' (' + d.store + (birthLabel_(d.rrn) ? ', ' + birthLabel_(d.rrn) : '') + ')\n사장님 화면 [오늘]에서 승인해주세요.');
  return { ok: true, name: d.name, store: d.store };
}

/** 입사 등록한 폰에서 승인됐는지 확인: 'ok'(승인돼서 찍을 수 있음) / 'wait'(승인 대기) / ''(없음·거절). */
function joinStatus(name, device) {
  name = String(name == null ? '' : name).trim();
  var p = findStaff_(name);
  if (p && p.active) return { state: 'ok' };
  var dev = cleanDevId_(device);
  if (dev) {
    // 승인하면서 이름이 바뀌었을 수 있어요(동명이인 구분). 이 폰으로 등록된 직원을 찾아 새 이름을 알려줘요
    var mine = null;
    staff_().forEach(function (x) { if (x.active && hasDev_(x, dev)) mine = x; });
    if (mine) return { state: 'ok', name: mine.name };
    var wait = null;
    hrRows_().forEach(function (x) { if (x.state === HR_WAIT && parseJoin_(x.join).dev === dev) wait = x; });
    if (wait) return wait.name === name ? { state: 'wait', store: wait.store } : { state: 'wait', store: wait.store, name: wait.name };
  }
  var h = hrFind_(name, HR_WAIT);
  if (h && (!dev || parseJoin_(h.join).dev === dev || !parseJoin_(h.join).dev)) return { state: 'wait', store: h.store };
  // 반려됐으면 이유를 알려줘요(7일 동안)
  var no = null;
  try { no = JSON.parse(PropertiesService.getScriptProperties().getProperty('joinNo:' + (dev || 'n:' + name)) || 'null'); } catch (err) { no = null; }
  if (no && no.name === name) return { state: 'no', reason: no.reason || '' };
  return { state: '' };
}

/** 직원 본인 인사 정보(고칠 때 채워 보여줘요). 주민번호는 가린 번호만. */
function hrGet(name, pin, device, label) {
  var p = person_(name);
  checkPin_(p, pin, false, device);
  hrOwnPhone_(p, device, label);
  var h = hrMine_(p) || {};
  return {
    // 못 읽는 입사일은 빈칸(직원이 다시 넣어서 고칠 수 있게)
    name: p.name, store: p.store, start: parseDate_(h.start) || '', rrn: h.rrn || '', phone: h.phone || '', phone2: h.phone2 || '', addr: h.addr || '',
    bank: h.bank || '', account: h.account || '', holder: h.holder || '', emergency: h.emergency || '',
  };
}

/** 이미 일하는 직원이 인사 정보를 넣거나 고쳐요(처음 한 번은 꼭). 주민번호는 이미 있으면 비워둬도 돼요. */
function hrSave(name, pin, f) {
  var p = person_(name);
  f = f || {};
  // 비밀번호가 아직 없는 직원: 출근 전에 인사 정보부터 넣고, 여기서 정한 번호가 비밀번호가 돼요(이 폰도 내 폰으로 등록)
  var first = !p.pin;
  checkPin_(p, pin, first, f.device);
  if (first && EASY_PINS.indexOf(p.newPin) >= 0) throw new Error('너무 쉬운 비밀번호예요(1234, 0000 같은). 다른 번호로 정해주세요.');
  hrOwnPhone_(p, f.device, f.label);
  var set0 = settings_(), dev = cleanDevId_(f.device);
  var claimDev = first && set0.device !== '안함' && !hrExempt_(p.name);
  if (claimDev) {
    if (!dev) throw new Error('이 브라우저에서는 폰 확인이 안 돼요. 시크릿(사생활 보호) 모드를 끄고 다시 열어주세요.');
    staff_().forEach(function (x) { // 동료 폰으로 남의 이름을 차지하지 못하게(사장님께 알림)
      if (x.active && x.name !== p.name && hasDev_(x, dev)) {
        deny_(set0, p.name, '다른 직원 폰', x.name + ' 님 폰으로 인사 정보를 넣으려 함', '이 폰은 ' + x.name + ' 님 폰으로 등록돼 있어요. 본인 폰으로 넣어주세요.', true);
      }
    });
  }
  if (f.agree !== true) throw new Error('개인정보 수집·이용에 동의해야 저장할 수 있어요.');
  var d = hrForm_(f, false);
  var now = nowKst_();
  if (d.start && d.start > addDays_(now.date, 31)) throw new Error('입사일을 확인해주세요. (한 달 넘게 뒤의 날짜예요)');
  var hrWas = set0.hrMust === '안함' ? 'ok' : hrStatus_(p).state; // 인사 정보 때문에 출근이 막혀 있었는지(끝에서 tryAfterHr_)
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (first) {
      // 두 폰이 같은 이름을 동시에 차지하려 하면 먼저 저장한 쪽만
      forget_('staff');
      var again = person_(p.name);
      if (again.pin) throw new Error('방금 다른 폰에서 이 이름의 비밀번호를 정했어요. 본인이 아니면 사장님께 말씀해 주세요.');
      again.newPin = p.newPin;
      p = again;
    }
    var hg = hrFind_(p.name);
    if (p.active && hg && hg.state === '퇴사' && hrWaitOwner_(p)) throw new Error('같은 이름의 퇴사 기록이 있어서 사장님이 확인하는 중이에요. 사장님께 말씀해 주세요.');
    var h = hrMine_(p);
    if (first && h && h.enc) {
      // 비밀번호가 없는 이름을 처음 차지할 때, 사장님이 넣어 둔 주민번호와 같아야 해요(주소만 아는 사람이 집에서 남의 이름을 차지하지 못하게)
      var same;
      try { same = !!d.rrn && String(rrnDecrypt_(h.enc)).replace(/\D/g, '') === String(d.rrn).replace(/\D/g, ''); } catch (err) { same = !!d.rrn; } // 열쇠를 잃어 못 풀면 본인을 막지 않아요
      guard_('hrfirst:' + p.name, same, '주민등록번호가 사장님이 넣어 둔 것과 달라요. 본인 이름이 맞는지 확인해 주세요.', null, '여러 번 틀려서 10분 동안 막혔어요. 사장님께 말씀해 주세요.');
    }
    if (!d.rrn && !(h && h.enc)) throw new Error('주민등록번호를 넣어주세요.');
    if (!d.start && !(h && parseDate_(h.start))) throw new Error('입사일(처음 출근한 날)을 넣어주세요.');
    var rec = {
      phone: d.phone, addr: d.addr, bank: d.bank, account: d.account, holder: d.holder || p.name,
      emergency: d.emergency, reg: now.date + ' ' + now.time + ' 본인 입력' + (first ? '(처음 · 비밀번호 정함)' : ''),
    };
    if (f.phone2 !== undefined) rec.phone2 = d.phone2; // 추가 번호 칸을 보냈을 때만(지우면 지워져요)
    if (d.rrn) { rec.rrn = rrnMask_(d.rrn); rec.enc = rrnEncrypt_(d.rrn); }
    if (d.start && !(h && parseDate_(h.start))) rec.start = d.start; // 입사일은 비었거나 못 읽는 글자일 때만(사장님이 적은 날은 그대로)
    if (!h) { rec.name = p.name; rec.store = p.store; rec.state = p.active ? '근무' : '퇴사'; rec.first = p.store; }
    // 계좌·휴대폰이 바뀌면 사장님께 알려요(급여가 엉뚱한 계좌로 가지 않게. 남이 폰을 잠깐 빌려 바꾸는 것도 바로 알 수 있어요)
    var tail = function (x) { var d = String(x || '').replace(/\D/g, ''); return d ? '끝자리 ' + d.slice(-4) : '없음'; };
    var changed = [];
    if (h && h.account && (h.account.replace(/\D/g, '') !== rec.account.replace(/\D/g, '') || (h.bank || '') !== rec.bank)) {
      changed.push('계좌: ' + (h.bank || '') + ' ' + tail(h.account) + ' → ' + rec.bank + ' ' + tail(rec.account));
    }
    if (h && h.phone && h.phone !== rec.phone) changed.push('휴대폰: ' + tail(h.phone) + ' → ' + tail(rec.phone));
    hrWrite_(h ? h.row : 0, rec);
    if (first) {
      if (claimDev && !(p.deviceIds || []).length) setStaffCell_(p.row, '등록폰', devCell_(dev, String(f.label || '폰').replace(/[#·\n]/g, ' ').slice(0, 30).trim() || '폰', mmdd_(now.date) + ' 인사 정보 입력'));
      if (f.agreeLoc === true && !p.agreed) setStaffCell_(p.row, '동의', now.date + ' ' + now.time + ' 인사 정보 입력');
      setStaffCell_(p.row, 'PIN', p.newPin); // 비밀번호는 맨 끝에(위에서 막히면 이름이 묶이지 않게)
      forget_('staff');
    }
  } finally {
    lock.releaseLock();
  }
  if (first) { // 처음 차지한 이름: 본인이 맞는지 사장님이 볼 수 있게(끝자리만)
    try { notify_(settings_(), '처음 인사 정보 입력', p.name + (p.store ? ' (' + p.store + ')' : '') + ' 님이 앱에서 처음 비밀번호를 정하고 인사 정보를 넣었어요.\n휴대폰 ' + tail(rec.phone) + ' · 계좌 ' + rec.bank + ' ' + tail(rec.account) + (claimDev ? '\n폰: ' + String(f.label || '폰').slice(0, 30) : '') + '\n본인이 아니면 [설정] → 직원 관리에서 [비번]·[폰 초기화]를 누르고, 인사 카드에서 휴대폰·계좌를 지운 뒤 본인이 [시작하기]에서 주민등록번호까지 다시 넣게 해 주세요.'); } catch (err) { console.error(err); }
  }
  if (changed.length) {
    try { notify_(settings_(), '인사 정보가 바뀌었어요', p.name + (p.store ? ' (' + p.store + ')' : '') + ' 님이 직접 고쳤어요.\n' + changed.join('\n') + '\n본인이 바꾼 게 맞는지 확인해 주세요.'); } catch (err) { console.error(err); }
  }
  return tryAfterHr_(p.name, f, hrWas, { ok: true, first: first }); // 인사 정보 때문에 막혔던 출근이 60분 안이면 그 시각으로 찍어요
}

/** 오늘(새벽 5시 전이면 어제) 출근을 찍고 아직 퇴근을 안 찍었는지. 인사 정보를 다 안 넣은 직원도 그 기록은 닫을 수 있게요. */
function todayIn_(name, now) {
  var sh = sheet_(SHEETS.log);
  var f = findLog_(sh, now.date, name);
  if (f && f.vals[C.tIn]) return true;
  if (now.min < 5 * 60) { var y = findLog_(sh, addDays_(now.date, -1), name); return !!(y && y.vals[C.tIn] && !y.vals[C.tOut]); }
  return false;
}

/**
 * 내 인사 정보(주민번호 앞자리·주소·계좌)는 등록된 내 폰에서만 봐요. 비밀번호만 알면 다른 폰에서 볼 수 있던 걸 막아요.
 * (폰 확인을 '안함'으로 쓰는 가게나 아직 폰이 등록 안 된 직원은 그대로 통과)
 */
function hrOwnPhone_(p, device, label) {
  var set = settings_();
  if (set.device === '안함' || p.name === TEST_NAME || !(p.deviceIds || []).length) return;
  var id = cleanDevId_(device);
  if (hasDev_(p, id)) return;
  // 등록 안 된 폰(사파리가 저장 정보를 지웠거나 다른 브라우저): 출근을 누를 때처럼 새 폰 승인 요청을 보내 둬요.
  // 인사 정보가 빠져 출근 버튼이 막힌 직원도 이 폰을 쓸 수 있게요(동료 폰·폰 확인 불가는 그대로 막아요)
  var people = staff_();
  var mine = !!id && !people.some(function (x) { return x.active && x.name !== p.name && hasDev_(x, id); });
  if (mine) {
    try { checkDevice_(set, p, { device: id, label: label || '인사 정보 화면' }, people); } catch (err) { /* 새 폰 승인 요청을 보냈어요 */ }
  }
  throw new Error('내 인사 정보는 출퇴근을 찍는 내 폰(등록된 폰)에서만 볼 수 있어요.' + (mine ? ' 이 폰을 쓰려면 사장님 승인이 필요해서 요청을 보냈어요. 승인되면 다시 열어주세요.' : ''));
}

/**
 * 인사 정보에서 아직 빈 칸 이름들. 누가 넣었든(본인·입사 등록·사장님 인사 카드·시트) 같아요.
 * 꼭 있어야 하는 것: 주민등록번호(암호 칸)·휴대폰·주소·은행·계좌번호·비상연락처·입사일. 휴대폰2·예금주(비우면 본인)·비고는 안 봐요.
 * [인사] 탭 머리글이 지워졌거나 이름이 바뀐 칸은 건너뛰어요(머리글 하나 때문에 모두 출근을 못 찍는 일이 없게).
 */
function hrMissing_(h) {
  h = h || {};
  var col = hrCols_(), out = [];
  var has = function (k) { return col[HR_KEY[k]] != null; };
  if (has('enc') && !String(h.enc || '').trim()) out.push('주민등록번호');
  if (has('phone') && !phoneOf_(h.phone)) out.push('휴대폰');
  if (has('addr') && !String(h.addr || '').trim()) out.push('주소');
  if (has('bank') && !String(h.bank || '').trim()) out.push('은행');
  if (has('account') && String(h.account || '').replace(/\D/g, '').length < 8) out.push('계좌번호');
  if (has('emergency') && !String(h.emergency || '').trim()) out.push('비상연락처');
  if (has('start') && !parseDate_(h.start)) out.push('입사일');
  return out;
}
/** 인사 정보 없이도 찍히는 이름(테스트 직원·setup 예시 직원). */
function hrExempt_(name) { return name === TEST_NAME || name === '예시직원'; }
/** {state: 'ok' | 'need'(빈 칸 있음) | 'wait'(같은 이름 퇴사 기록: 사장님 확인 전), missing: [...]} */
function hrStatus_(p) {
  if (!p || hrExempt_(p.name) || hrCols_()[HR_KEY.name] == null) return { state: 'ok', missing: [] }; // [인사] 탭·'이름' 머리글이 없으면 막지 않아요
  var h0 = hrFind_(p.name);
  if (p.active && h0 && h0.state === '퇴사' && hrWaitOwner_(p)) return { state: 'wait', missing: [] };
  var miss = hrMissing_(hrMine_(p));
  return { state: miss.length ? 'need' : 'ok', missing: miss };
}
/** 출근을 막을 때 보여줄 말(직원 화면이 앞부분으로 알아봐요). */
function hrBlockMsg_(st) {
  return st.state === 'wait'
    ? '인사 정보를 먼저 확인해야 출근이 찍혀요. 같은 이름의 예전 기록이 있어서 사장님 확인이 필요해요. 사장님께 말씀해 주세요.'
    : '인사 정보를 먼저 다 넣어야 출근이 찍혀요. 아직 안 넣은 것: ' + st.missing.join(', ') + '.';
}
/** 이 직원이 인사 정보를 아직 다 안 넣었으면 true(직원 화면 안내). 같은 이름 퇴사 기록을 사장님이 확인하기 전이면 false(넣을 수 없어서). */
function hrNeed_(name) {
  return hrStatus_(findStaff_(name)).state === 'need';
}

/* ── 사장님 화면: 입사 승인, 인사 카드, 지점 이동, 퇴사, 연락처 ── */

/**
 * 입사 등록 승인(ok=true) 또는 반려. 반려하면 그 등록(주민번호 등)은 지우고, 이유는 신입 폰에 7일 동안 보여줘요.
 * opts(없어도 돼요):
 *  - name: 이름을 바꿔 승인(예전 직원과 이름이 같은 다른 사람: 박지훈 → 박지훈B). 글자만 주면 이것으로 봐요
 *  - store, start: 지점·입사일을 고쳐서 승인
 *  - off: 쉬는 요일 ['일','월',…] → [직원] 탭 요일 칸에 '휴무'(나중에 [직원] 탭에서 바꿀 수 있어요)
 *  - firstIn: true면 오늘 출근을 '등록 보낸 시각'으로 적어요(입사일이 오늘이고 오늘 등록했을 때. 승인이 늦어 지각이 되는 걸 막아요)
 *  - reason: 반려 이유(신입에게 보여요)
 */
function adminJoin(pin, name, ok, opts) {
  var set = adminAuth_(pin);
  name = String(name == null ? '' : name).trim();
  opts = typeof opts === 'string' ? { name: opts } : opts || {};
  var joined = null; // 승인한 신입(점장 알림은 줄을 푼 뒤에 보내요)
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var h = hrFind_(name, HR_WAIT);
    if (!h) throw new Error('승인을 기다리는 입사 등록이 없어요. 새로고침 해주세요.');
    if (!ok) {
      var j0 = parseJoin_(h.join), now0 = nowKst_();
      var why = clean_(opts.reason, 100);
      // 신입 폰이 '반려됐어요(이유)'를 볼 수 있게 7일 동안만 남겨요(주민번호 등은 안 남겨요)
      PropertiesService.getScriptProperties().setProperty('joinNo:' + (j0.dev || 'n:' + h.name),
        JSON.stringify({ name: h.name, reason: why, date: now0.date }));
      hrDelete_(h.row);
    } else {
      var edit = {};
      var newName = clean_(opts.name, 20);
      if (newName && newName !== h.name) {
        // 이름을 바꿔서 승인. 신입 폰은 등록한 폰으로 알아봐요
        if (!/^[가-힣A-Za-z][가-힣A-Za-z0-9 ]{0,19}$/.test(newName) || newName === TEST_NAME) throw new Error('이름을 확인해주세요. (한글·영문, 뒤에 숫자·영문 구분을 붙일 수 있어요)');
        if (findStaff_(newName) || hrFind_(newName) || hrFind_(newName, HR_WAIT)) throw new Error(newName + ' 은(는) 이미 있는 이름이에요. 다른 구분을 붙여주세요.');
        edit.name = newName;
      }
      var newStore = clean_(opts.store, 30);
      if (newStore && newStore !== h.store) {
        if (!storeOf_(newStore)) throw new Error(newStore + ' 지점이 [매장] 탭에 없어요.');
        edit.store = newStore;
        edit.first = newStore;
      }
      if (opts.start != null && String(opts.start).trim() !== '') {
        var newStart = parseDate_(opts.start);
        if (!newStart) throw new Error('입사일을 확인해주세요.');
        if (newStart !== h.start) edit.start = newStart;
      }
      var before = { name: h.name, store: h.store, first: h.first, start: h.start }, row0 = h.row;
      if (Object.keys(edit).length) {
        hrWrite_(h.row, edit);
        h = hrFind_(edit.name || h.name, HR_WAIT);
      }
      try {
        approveJoin_(h, { off: opts.off, firstIn: opts.firstIn === true, set: set });
        joined = { name: h.name, store: h.store, start: parseDate_(h.start) || nowKst_().date };
      } catch (err) {
        // 승인이 안 됐으면 고친 이름·지점·입사일도 원래대로(화면의 카드로 다시 누를 수 있게)
        if (Object.keys(edit).length) {
          var still = hrFind_(edit.name || before.name, HR_WAIT);
          if (still && still.row === row0) {
            var undo = {};
            Object.keys(edit).forEach(function (k) { undo[k] = before[k]; });
            hrWrite_(still.row, undo);
          }
        }
        throw err;
      }
    }
  } finally {
    lock.releaseLock();
  }
  if (joined) mgrJoin_(set, joined.name, joined.store, joined.start); // 그 지점 점장에게(소리 없이)
  return adminToday(pin);
}

/** 승인: [직원]에 넣고(예전에 퇴사한 같은 이름이면 그 줄을 다시 살려요), 폰·비밀번호를 등록하고, 휴무표에 넣어요. */
function approveJoin_(h, opts) {
  opts = opts || {};
  var j = parseJoin_(h.join);
  var now = nowKst_();
  if (!storeOf_(h.store)) throw new Error(h.store + ' 지점이 [매장] 탭에 없어요. 지점을 확인해주세요.');
  var same = hrFind_(h.name);
  if (same && same.rrn && h.rrn && same.rrn.slice(0, 8) !== h.rrn.slice(0, 8)) {
    throw new Error('예전에 다닌 ' + h.name + (birthLabel_(same.rrn) ? '(' + birthLabel_(same.rrn) + ')' : '') + ' 님과 이름만 같은 다른 사람이에요. ' +
      '기록이 섞이지 않게 이름 뒤에 구분을 붙여서 승인해 주세요. 예: ' + h.name + 'B');
  }
  var old = findStaff_(h.name); // 같은 이름 줄이 여러 개면 근무 중인 줄(있으면 아래에서 막혀요)
  staff_().forEach(function (x) {
    if (x.name !== h.name && j.dev && hasDev_(x, j.dev) && x.active) throw new Error('이 폰은 ' + x.name + ' 님 폰으로 등록돼 있어서 승인할 수 없어요.');
  });
  if (old && old.active) throw new Error(h.name + ' 님은 이미 직원 명단에 있어요. 이 등록은 거절하고 [직원] 탭에서 정보를 확인해주세요.');
  var row = old ? old.row : appendStaff_(h.name);
  var cells = {
    // 동의: 입사 등록 때 출퇴근 확인(위치) 동의도 했으면 적어요. 안 했으면 비워 둬서 첫 출근 때 다시 물어봐요(예전 등록은 한 칸 동의라 했다고 봐요)
    '매장': h.store, '재직': '', 'PIN': j.pin || '', '새폰요청': '', '동의': j.loc === false ? '' : now.date + ' ' + now.time + ' 입사 등록',
    '등록폰': j.dev ? devCell_(j.dev, j.label || '폰', mmdd_(now.date) + ' 입사 등록') : '',
  };
  // 쉬는 요일: 승인할 때 고른 요일은 '휴무', 나머지 요일 칸은 비워요(매장 기본 시간). 안 고르면 그대로 둬요
  var off = [].concat(opts.off || []).filter(function (d) { return DOW.indexOf(d) >= 0; });
  if (off.length) DOW.forEach(function (d) { cells[d] = off.indexOf(d) >= 0 ? '휴무' : ''; });
  Object.keys(cells).forEach(function (k) { setStaffCell_(row, k, cells[k]); });
  var info = {
    store: h.store, state: '근무', start: h.start || now.date, end: '', rrn: h.rrn, enc: h.enc, phone: h.phone,
    phone2: h.phone2, addr: h.addr, bank: h.bank, account: h.account, holder: h.holder, emergency: h.emergency, reg: h.reg, join: '',
  };
  var pm = settings_().probMonths; // 수습 끝: 입사일 + [설정] 수습개월(0이면 안 채워요)
  info.probEnd = pm > 0 && parseDate_(info.start) ? probEndOf_(parseDate_(info.start), pm) : '';
  info.contractEnd = '';
  var prev = hrFind_(h.name); // 예전에 다닌 기록(퇴사)이 있으면 그 줄에 합쳐요
  if (prev) {
    var was = prev.reason ? '(' + prev.reason + ')' : ''; // 예전 퇴사 사유는 이동 기록에 남겨요(근로자 명부 이력. 다시 입사하면 퇴사 사유 칸은 비워져요)
    var before = (prev.start || prev.end ? (prev.start || '?') + '~' + (prev.end || '?') + ' ' : '') + (prev.store ? prev.store + ' 근무' + was + ', ' : was ? was + ', ' : '');
    info.moves = addMove_(prev.moves, before + info.start + ' 다시 입사(' + h.store + ')');
    info.docs = ''; // 새 근로계약서 등은 다시 받아야 해요
    info.offb = '';
    if (prev.memo && h.memo) info.memo = prev.memo + ' / ' + h.memo;
    hrWrite_(prev.row, info);
    hrDelete_(h.row);
  } else {
    info.first = h.store;
    hrWrite_(h.row, info);
  }
  // 휴무표: 이번 달(과 이미 만든 다음 달)에 매장 묶음으로 넣어요. 입사일이 지난달이면(월말에 와서 1일에 승인 등) 그 달 탭에도(마감 전이면)
  for (var jm = String(info.start || now.date).slice(0, 7), guardN = 0; jm < now.ym && guardN < 3; jm = nextYm_(jm), guardN++) {
    if (monthSheet_(jm) && !isClosed_(jm)) ensureMonth_(jm);
  }
  ensureMonth_(now.ym);
  if (monthSheet_(nextYm_(now.ym))) ensureMonth_(nextYm_(now.ym));
  // 신입은 휴무 고르는 기간(매달 20~25일)을 놓쳤을 수 있어서, 승인한 날부터 3일 동안 다음 달 휴무를 고를 수 있게 열어 줘요
  PropertiesService.getScriptProperties().setProperty('wishFor:' + h.name, addDays_(now.date, 2));
  // 오늘 출근을 등록 보낸 시각으로(입사일이 오늘이고 오늘 등록했을 때만)
  var reg = /^(\d{4}-\d{2}-\d{2}) (\d{1,2}:\d{2})/.exec(h.reg || '');
  if (opts.firstIn && reg && reg[1] === now.date && (info.start || now.date) <= now.date) {
    var p = findStaff_(h.name);
    var sh = sheet_(SHEETS.log);
    if (p && !findLog_(sh, now.date, p.name)) {
      var v = newLogRow_(now.date, p, schedFor_(p, now.date));
      v[C.tIn] = fmtTime_(parseTime_(reg[2]));
      v[C.store] = p.store || '';
      v[C.memo] = addMemo_(v[C.memo], '입사 등록 보낸 시각으로 출근 기록(사장님 승인 ' + now.time + ')');
      applyCalc_(v, p.wage, (opts.set || settings_()).grace);
      writeLog_(sh, Math.max(sh.getLastRow(), 1) + 1, v);
      syncLateMark_(now.date, p.name, v);
    }
  }
}

/** [직원] 탭 맨 아래에 새 직원 줄(이름만). 줄 번호를 돌려줘요. */
function appendStaff_(name) {
  var sh = sheet_(SHEETS.staff);
  var row = Math.max(sh.getLastRow(), 1) + 1;
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 10);
  sh.getRange(row, staffCols_()['이름'] + 1).setNumberFormat('@').setValue(name);
  forget_('staff');
  return row;
}

/** 직원 목록([직원] 탭과 맞춘 뒤): 사장님 화면 [직원] 탭. */
function adminHrList(pin) {
  var a = auth_(pin);
  if (a.role !== 'admin') {
    // 점장: 자기 매장에서 근무 중인 직원의 이름·휴대폰만(주민번호·계좌·주소·입사일은 사장님만)
    var mine = sortByStore_(staff_().filter(function (p) { return p.active && canSee_(a, p) && p.name !== TEST_NAME; }));
    return {
      mgr: true, date: nowKst_().date, stores: a.stores,
      list: mine.map(function (p) {
        var h = hrMine_(p) || {};
        return { name: p.name, store: p.store, state: '근무', phone: h.phone || '', phone2: h.phone2 || '' };
      }),
    };
  }
  var lock = LockService.getScriptLock();
  if (lock.tryLock(15000)) {
    try { syncHr_(); hrTodoRun_(); } finally { lock.releaseLock(); }
  }
  var stores = stores_();
  var order = {};
  stores.forEach(function (st, i) { order[st.name] = i; });
  var plan = hrPlan_(), today = nowKst_().date;
  var docsIn = checkItems_(settings_().docsIn), docsOut = checkItems_(settings_().docsOut);
  var left = function (items, done) { var d = checkItems_(done); return items.filter(function (x) { return d.indexOf(x) < 0; }).length; };
  var list = hrRows_().filter(function (h) { return h.state !== HR_WAIT; }).map(function (h) {
    return {
      name: h.name, store: h.store, state: h.state, start: h.start, end: h.end, birth: birthLabel_(h.rrn),
      phone: h.phone, phone2: h.phone2, filled: !hrMissing_(h).length, missing: h.state === '퇴사' ? [] : hrMissing_(h), leaving: h.state !== '퇴사' && !!parseDate_(h.end),
      moveDue: plan.move[h.name] || null,
      away: plan.away[h.name] && plan.away[h.name].to >= today ? { from: plan.away[h.name].from, to: plan.away[h.name].to, on: today >= plan.away[h.name].from } : null,
      docsLeft: h.state === '근무' ? left(docsIn, h.docs) : 0,
      // 퇴사 정리: 퇴사 예정이거나 퇴사한 지 두 달 안인 사람만 세요(오래된 퇴사자까지 '남음'이 뜨지 않게)
      offLeft: parseDate_(h.end) && (h.state !== '퇴사' || daysBetween_(parseDate_(h.end), today) <= 62) ? left(docsOut, h.offb) : 0,
    };
  });
  list.sort(function (a, b) {
    var x = (a.state === '퇴사') - (b.state === '퇴사');
    if (x) return x;
    var oa = order[a.store] == null ? 999 : order[a.store], ob = order[b.store] == null ? 999 : order[b.store];
    return oa - ob;
  });
  return { list: list, stores: stores.map(function (st) { return st.name; }), date: nowKst_().date };
}

/** 인사 카드 한 사람. 주민번호는 가린 번호만(전체는 adminHrRrn). */
function adminHrGet(pin, name) {
  adminAuth_(pin);
  return hrCard_(hrNeedRow_(name));
}

function hrCard_(h) {
  return {
    name: h.name, store: h.store, state: h.state, start: h.start, first: h.first, moves: h.moves, end: h.end,
    rrn: h.rrn, hasRrn: !!h.enc, birth: birthLabel_(h.rrn), phone: h.phone, phone2: h.phone2, addr: h.addr, bank: h.bank,
    account: h.account, holder: h.holder, emergency: h.emergency, memo: h.memo, reg: h.reg,
    leaving: h.state !== '퇴사' && !!parseDate_(h.end), // 퇴사 예정(마지막 근무일이 적혀 있고 아직 근무 중)
    reason: h.state === '퇴사' || parseDate_(h.end) ? h.reason : '', // 퇴사 사유(퇴사 예정·퇴사한 사람만)
    missing: h.state === '퇴사' ? [] : hrMissing_(h), // 빈 인사 정보 칸(다 채워야 출근이 찍혀요)
    moveDue: hrPlan_().move[h.name] || null, // 예약해 둔 지점 이동 {store, date}
    away: (function () { var a = hrPlan_().away[h.name], t = nowKst_().date; return a && a.to >= t ? { from: a.from, to: a.to, why: a.why || '', on: t >= a.from } : null; })(), // 휴직(끝난 건 이동 기록에만)
    docs: { items: checkItems_(settings_().docsIn), done: checkItems_(h.docs) },
    offb: { items: checkItems_(settings_().docsOut), done: checkItems_(h.offb) },
    lastMove: (function () { var x = String(h.moves || '').split(' · ').pop() || ''; return /^\d{4}-\d{2}-\d{2} .+→.+$/.test(x) && x.split('→').pop() === h.store ? x : ''; })(), // 취소할 수 있는 마지막 이동
    probEnd: parseDate_(h.probEnd) || '', contractEnd: parseDate_(h.contractEnd) || '', // 수습 끝·계약 끝
    contractNote: contractNote_(h),
  };
}

/** 계약 끝이 입사일부터 2년을 넘으면 안내(기간제법 4조: 2년을 넘겨 쓰면 기간을 정하지 않은 근로자로 봐요). */
function contractNote_(h) {
  var st = parseDate_(h.start), ce = parseDate_(h.contractEnd);
  if (!st || !ce || ce <= addDays_(probEndOf_(st, 24), 1)) return '';
  return '입사일(' + st + ')부터 2년이 넘는 기간제 계약이에요. 상시 5명 이상 사업장은 기간제로 2년을 넘게 쓰면 기간을 정하지 않은 근로자(정규직)로 봐요(기간제법 4조, 예외 있음). 노무사 확인을 권해요.';
}

/** 입사일부터 n개월 뒤의 전날(수습 끝). 그 달에 같은 날이 없으면(11/30 + 3개월) 그 달 마지막 날. */
function probEndOf_(start, n) {
  var y = Number(start.slice(0, 4)), m = Number(start.slice(5, 7)) - 1 + n, d = Number(start.slice(8, 10));
  y += Math.floor(m / 12);
  m = ((m % 12) + 12) % 12;
  var ym = y + '-' + pad2_(m + 1), last = daysIn_(ym);
  return d > last ? ym + '-' + pad2_(last) : addDays_(ym + '-' + pad2_(d), -1);
}

/**
 * 끝나 가는 수습·계약: 근무 중인 직원(마지막 근무일이 그보다 먼저면 빼요) 중 date부터 within일 안에 끝나는 것.
 * [{name, store, kind: '수습'|'계약', end, left}] (left = 남은 날 수, 0 = 그날)
 */
function hrDueList_(date, within) {
  var out = [];
  var people = {};
  staff_().forEach(function (p) { if (p.active) people[p.name] = p; });
  hrRows_().forEach(function (h) {
    var p = people[h.name];
    if (!p || h.state === '퇴사' || h.state === HR_WAIT || hrFind_(h.name) !== h) return;
    var last = parseDate_(h.end);
    [['수습', h.probEnd], ['계약', h.contractEnd]].forEach(function (x) {
      var end = parseDate_(x[1]);
      if (!end || (last && last <= end)) return;
      var left = daysBetween_(date, end);
      if (left >= 0 && left <= within) out.push({ name: h.name, store: p.store, kind: x[0], end: end, left: left });
    });
  });
  return out.sort(function (a, b) { return a.left - b.left || (a.name < b.name ? -1 : 1); });
}

function hrNeedRow_(name) {
  name = String(name == null ? '' : name).trim();
  var h = hrFind_(name);
  if (!h) throw new Error('[인사] 탭에 ' + name + ' 님이 없어요. 새로고침 해주세요.');
  return h;
}

/** 주민번호 전체 보기(관리자만). */
function adminHrRrn(pin, name) {
  var set = adminAuth_(pin);
  var h = hrNeedRow_(name);
  if (!h.enc) throw new Error('아직 주민번호를 받지 않았어요.');
  var d = rrnDecrypt_(h.enc);
  logSuspect_('(사장님 화면)', '주민번호 전체 보기', h.name); // 누가 언제 봤는지 남겨요(번호는 안 적어요)
  var shown = String(h.rrn || '').trim();
  if (/^\d{6}-?[1-8]/.test(shown) && shown.replace('-', '').slice(0, 7) !== d.slice(0, 7)) {
    // 가린 번호(앞 7자리)와 보관된 번호가 달라요: [인사] 탭을 일부 칸만 골라 정렬·붙여넣기 해서 줄이 섞인 거예요
    throw new Error('[인사] 탭 줄이 섞인 것 같아요(보이는 번호와 보관된 번호가 달라요). 번호를 보여주지 않을게요. ' +
      '구글 시트 메뉴 파일 → 버전 기록에서 섞이기 전으로 되돌려 주세요. 정렬은 머리글의 필터 단추로만 해주세요.');
  }
  if (!shown) hrWrite_(h.row, { rrn: rrnMask_(d) }); // 가린 번호 칸이 지워졌으면 다시 채워요
  rrnSeen_(set, h.name); // 사장님께도 소리 없이 알려요(이름·시각만)
  return { rrn: d.slice(0, 6) + '-' + d.slice(6) };
}

/** 인사 카드 고치기: 입사일, 연락처·계좌, 비상연락처, 비고. 주민번호 칸에 13자리를 넣으면 바꿔요(비우면 그대로). */
function adminHrSave(pin, name, f) {
  adminAuth_(pin);
  f = f || {};
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var h = hrNeedRow_(name);
    var t = function (k, max) { return String(f[k] == null ? '' : f[k]).replace(/[ \t]+/g, ' ').trim().slice(0, max); };
    var rec = {
      addr: t('addr', 120), bank: t('bank', 20), account: String(f.account == null ? '' : f.account).replace(/[^\d-]/g, '').slice(0, 30),
      holder: t('holder', 20), emergency: t('emergency', 60), memo: String(f.memo == null ? '' : f.memo).trim().slice(0, 500),
    };
    var phone = t('phone', 20);
    if (phone && !phoneOf_(phone)) throw new Error('휴대폰 번호를 확인해주세요. (010-0000-0000)');
    rec.phone = phoneOf_(phone);
    if (f.phone2 !== undefined) rec.phone2 = phones2_(f.phone2, rec.phone);
    var start = t('start', 20);
    if (start && !parseDate_(start)) throw new Error('입사일을 확인해주세요.');
    rec.start = parseDate_(start);
    [['probEnd', '수습 끝'], ['contractEnd', '계약 끝']].forEach(function (x) {
      if (f[x[0]] === undefined) return;
      var v = t(x[0], 20);
      if (v && !parseDate_(v)) throw new Error(x[1] + ' 날짜를 확인해주세요. (예: 2027-02-15)');
      rec[x[0]] = parseDate_(v) || '';
    });
    var rrn = t('rrn', 20);
    if (rrn && rrn !== h.rrn) {
      var d = rrnParse_(rrn);
      if (!d) throw new Error('주민등록번호를 확인해주세요. (13자리)');
      rec.rrn = rrnMask_(d);
      rec.enc = rrnEncrypt_(d);
    }
    var now = nowKst_();
    if (f.docs !== undefined) rec.docs = checkItems_([].concat(f.docs || []).join(',')).join(', ');
    if (f.offb !== undefined) rec.offb = checkItems_([].concat(f.offb || []).join(',')).join(', ');
    rec.reg = addMove_(h.reg, now.date + ' 사장님 고침').slice(-200);
    hrWrite_(h.row, rec);
  } finally {
    lock.releaseLock();
  }
  return hrCard_(hrNeedRow_(name));
}

/**
 * 지점 이동. [직원] 매장, [인사] 지점·이동 기록, 이번 달·다음 달 휴무표 줄을 새 지점 묶음으로 옮겨요.
 *  - 오늘이나 지난 날짜: 바로 옮겨요
 *  - 앞날: 예약해 두고 그날 새벽에 자동으로 옮겨요(본인에게 미리 알리고, 옮긴 날 다시 알려요)
 */
function adminMove(pin, name, store, date) {
  var set = adminAuth_(pin);
  var now = nowKst_();
  store = String(store == null ? '' : store).trim();
  date = parseDate_(date) || now.date;
  var later = date > now.date;
  if (!storeOf_(store)) throw new Error('옮길 지점을 골라주세요.');
  if (later && daysBetween_(now.date, date) > 92) throw new Error('지점 이동 예약은 석 달 안의 날짜로 해주세요.');
  var p, dropped = [];
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    p = findStaff_(String(name == null ? '' : name).trim());
    if (!p || !p.active) throw new Error('근무 중인 직원이 아니에요.');
    if (p.store === store) throw new Error('이미 ' + store + ' 소속이에요.');
    if (later) {
      var h = hrNeedRow_(p.name);
      if (parseDate_(h.end) && date > parseDate_(h.end)) throw new Error('마지막 근무일(' + h.end + ')보다 뒤예요.');
      hrPlanSave_(function (o) { o.move[p.name] = { store: store, date: date }; });
    } else {
      setStaffCell_(p.row, '매장', store);
      dropped = hrMoved_(p.name, p.store, store, date);
      if (hrPlan_().move[p.name]) hrPlanSave_(function (o) { delete o.move[p.name]; }); // 예약해 둔 이동은 지워요
    }
  } finally {
    lock.releaseLock();
  }
  var told = false;
  if (later) told = notifyStaff_(set, p, '지점 이동 예정', whenOf_(date) + '부터 ' + store + ' 지점으로 옮겨요. 그날부터 출근·퇴근은 ' + store + '에서 찍어주세요.');
  else if (date === now.date) told = notifyStaff_(set, p, '지점이 바뀌었어요', '오늘부터 ' + store + ' 지점 소속이에요. 출근·퇴근은 ' + store + '에서 찍어주세요.');
  if (!later) mgrMove_(set, 'now', p.name, p.store, store, date); // 예전·새 지점 점장에게(p.store는 옮기기 전 지점). 예약은 옮기는 날(planDue_)에
  var card = hrCard_(hrNeedRow_(name));
  card.note = later
    ? whenOf_(date) + '에 자동으로 ' + store + '(으)로 옮겨요.' + (told ? ' 본인에게 텔레그램으로 알렸어요.' : ' 본인이 텔레그램 알림을 안 켜서, 직접 알려주세요.')
    : store + '(으)로 옮겼어요. 휴무표 줄도 옮겼어요.' + (told ? ' 본인에게 알렸어요.' : '') +
      (dropped && dropped.length ? ' ' + dropped.join('·') + ' 점장 칸에서 뺐어요. 새 점장을 [매장] 탭에 적어주세요.' : '');
  return card;
}

/** 예약해 둔 지점 이동 취소. */
function adminMoveCancel(pin, name) {
  var set = adminAuth_(pin);
  var h = hrNeedRow_(name);
  var m = hrPlan_().move[h.name];
  if (!m) throw new Error('예약해 둔 지점 이동이 없어요.');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    hrPlanSave_(function (o) { delete o.move[h.name]; });
  } finally {
    lock.releaseLock();
  }
  notifyStaff_(set, findStaff_(h.name), '지점 이동 예정 취소', whenOf_(m.date) + ' ' + m.store + ' 이동이 취소됐어요. 지금 지점에서 그대로 근무해요.');
  var card = hrCard_(hrNeedRow_(name));
  card.note = '지점 이동 예약(' + whenOf_(m.date) + ' ' + m.store + ')을 취소했어요.';
  return card;
}

/* ── 예약해 둔 일: 지점 이동 예정, 휴직 기간 (스크립트 속성 hrPlan 하나에 모아 둬요) ── */

function hrPlan_() {
  return memo_('hrPlan', function () {
    var o = {};
    try { o = JSON.parse(PropertiesService.getScriptProperties().getProperty('hrPlan') || '{}') || {}; } catch (err) { o = {}; }
    return { move: o.move || {}, away: o.away || {} };
  });
}

function hrPlanSave_(fn) {
  var o = hrPlan_();
  fn(o);
  PropertiesService.getScriptProperties().setProperty('hrPlan', JSON.stringify(o));
  return o;
}

/** 예약해 둔 지점 이동을 그날 새벽(5시 뒤 첫 10분 검사)에 해요. 사장님과 본인에게 알려요. 끝난 휴직도 여기서 치워요. */
function planDue_(set, now) {
  var plan = hrPlan_(), n = 0;
  Object.keys(plan.away).forEach(function (name) {
    if (plan.away[name].to < now.date) hrPlanSave_(function (o) { delete o.away[name]; }); // 끝난 휴직(기록은 이동 기록에 남아 있어요)
  });
  if (now.min < 5 * 60) return 0; // 전날 밤 근무를 자정 넘어 끝내는 사람이 예전 매장에서 퇴근을 찍을 수 있게
  Object.keys(plan.move).forEach(function (name) {
    var m = plan.move[name];
    if (!m || m.date > now.date) return;
    try { // 한 사람에서 오류가 나도 나머지는 계속
      var p = findStaff_(name);
      if (p && p.active && p.store !== m.store && !storeOf_(m.store)) {
        // 그사이 [매장] 탭에서 그 지점 이름을 바꿨거나 지웠어요: 예약은 남겨 두고 하루 한 번 알려요
        var pk = 'dm:' + now.date + ':move:' + name, pp = PropertiesService.getScriptProperties();
        if (!pp.getProperty(pk)) {
          pp.setProperty(pk, '1');
          notify_(set, '지점 이동 예약을 못 했어요', name + ': ' + whenOf_(m.date) + ' ' + m.store + '(으)로 옮기기로 예약했는데, [매장] 탭에 ' + m.store + ' 지점이 없어요. 지점 이름을 바꿨다면 인사 카드에서 다시 예약해 주세요.');
        }
        return;
      }
      if (p && p.active && p.store !== m.store && storeOf_(m.store)) {
        setStaffCell_(p.row, '매장', m.store);
        var dropped = hrMoved_(p.name, p.store, m.store, m.date);
        n++;
        notify_(set, '지점 이동', p.name + ': ' + (p.store || '?') + ' → ' + m.store + ' (예약해 둔 이동)' +
          (dropped.length ? '\n' + dropped.join('·') + ' 점장 칸에서 뺐어요. 새 점장을 [매장] 탭에 적어주세요.' : ''), { silent: true });
        notifyStaff_(set, p, '오늘부터 ' + m.store + ' 지점이에요', '출근·퇴근은 ' + m.store + '에서 찍어주세요.');
        mgrMove_(set, 'now', p.name, p.store, m.store, m.date); // 예전·새 지점 점장에게
      }
      hrPlanSave_(function (o) { delete o.move[name]; });
    } catch (err) {
      stepFail_('지점 이동 예약(' + name + ')', err);
    }
  });
  return n;
}

/* ── 휴직 ── */

/** 그날이 그 사람 휴직 기간인지. */
function awayOn_(name, date) {
  var a = hrPlan_().away[name];
  return !!a && date >= a.from && date <= a.to;
}

/**
 * 휴직 넣기(기간을 다시 넣으면 바뀌어요). from = 휴직 첫날, to = 휴직 마지막 날.
 * 그 기간은 쉬는 날로 봐요(미출근 알림·'결근?' 없음). 휴무표 그 기간의 빈 칸에 '휴직'을 적고 이동 기록에 남겨요.
 * 휴직이 낀 달은 만근이 아니에요(다음 달 월차가 자동으로는 안 생겨요. 주려면 사장님 화면 월차 현황에서 '받음'을 정해요).
 */
function adminAway(pin, name, from, to, why) {
  adminAuth_(pin);
  var now = nowKst_();
  from = parseDate_(from);
  to = parseDate_(to);
  why = clean_(why, 40).replace(/[·()]/g, ' ').trim();
  if (!from || !to) throw new Error('휴직 첫날과 마지막 날을 골라주세요.');
  if (to < from) throw new Error('휴직 마지막 날이 첫날보다 앞이에요.');
  if (daysBetween_(from, to) > 366) throw new Error('휴직은 한 번에 1년까지 넣을 수 있어요. 더 길면 끝날 때 다시 늘려주세요.');
  var filled = 0, note = '';
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var p = findStaff_(String(name == null ? '' : name).trim());
    if (!p || !p.active) throw new Error('근무 중인 직원이 아니에요.');
    var h = hrNeedRow_(p.name);
    if (parseDate_(h.start) && from < parseDate_(h.start)) throw new Error('휴직 첫날이 입사일(' + h.start + ')보다 앞이에요.');
    if (parseDate_(h.end) && to > parseDate_(h.end)) throw new Error('휴직 마지막 날이 마지막 근무일(' + h.end + ')보다 뒤예요.');
    var old = hrPlan_().away[p.name];
    var keep = old && old.from <= now.date; // 이미 시작한 휴직: 첫날은 그대로 두고 끝나는 날만 바꿔요(지난 '휴직' 칸은 그대로)
    if (keep && from !== old.from) throw new Error('이미 시작한 휴직(' + old.from + '부터)은 첫날을 바꿀 수 없어요. 끝나는 날만 바꾸거나, [휴직 끝내기]를 누른 뒤 새로 넣어주세요.');
    if (!keep && daysBetween_(from, now.date) > 92) throw new Error('석 달보다 더 지난 날부터는 넣을 수 없어요. 휴무표에 직접 적어주세요.');
    // 바뀌는 날짜만 마감 여부를 봐요
    var c0 = keep ? addDays_(to < old.to ? to : old.to, 1) : from, c1 = keep ? (to > old.to ? to : old.to) : to;
    for (var cy = c0.slice(0, 7); c0 <= c1 && cy <= c1.slice(0, 7) && cy < now.ym; cy = nextYm_(cy)) needOpen_(cy);
    var parts = String(h.moves || '').split(' · ').filter(String);
    var line = from + ' ' + AWAY_MARK + '(~' + to + (why ? ', ' + why : '') + ')';
    var at = -1;
    if (old) parts.forEach(function (x, k) { if (String(x).indexOf(old.from + ' ' + AWAY_MARK + '(~') === 0) at = k; });
    if (keep) {
      if (to > old.to) filled = awayMarks_(p.name, addDays_(old.to, 1), to, true);
      else if (to < old.to) awayMarks_(p.name, addDays_(to, 1), old.to, false);
      note = to === old.to ? '휴직 사유를 고쳤어요.' : '휴직을 ' + whenOf_(to) + '까지로 ' + (to > old.to ? '늘렸어요.' : '줄였어요.');
    } else {
      if (old) awayMarks_(p.name, old.from, old.to, false); // 아직 시작 안 한 휴직은 통째로 바꿔요
      filled = awayMarks_(p.name, from, to, true);
      note = whenOf_(from) + '부터 ' + whenOf_(to) + '까지 휴직으로 넣었어요. 그동안은 미출근 알림과 \'결근?\'이 없어요.';
    }
    if (at >= 0) parts[at] = line; else parts.push(line);
    hrPlanSave_(function (o) { o.away[p.name] = { from: from, to: to, why: why }; });
    hrWrite_(h.row, { moves: parts.join(' · ') });
  } finally {
    lock.releaseLock();
  }
  var card = hrCard_(hrNeedRow_(name));
  card.note = note + (filled ? ' 휴무표 ' + filled + '칸에 \'' + AWAY_MARK + '\'을 적었어요.' : '') + ' 일찍 돌아오면 [휴직 끝내기]를 눌러주세요.' +
    ' 휴직이 낀 달은 만근이 아니라서 다음 달 월차가 0개로 계산돼요. 주려면 [월별] → 월차 현황에서 다음 달 \'받음\'을 1개로 바꿔 주세요.' +
    ' 출산휴가·육아휴직·산재로 쉬는 거면 법에서 출근한 것으로 보니 꼭 1개로 바꿔 주세요.';
  return card;
}

function awayLine_(text) { return /^\d{4}-\d{2}-\d{2} 휴직\(~/.test(String(text || '')); }

/**
 * 휴직 끝내기. date = 휴직 마지막 날(비우면 어제 = 오늘부터 다시 근무). 휴직 첫날보다 앞이면 휴직을 통째로 취소해요.
 * 그 뒤 날짜 칸의 '휴직'을 지우고 이동 기록에 '복직'을 남겨요.
 */
function adminAwayEnd(pin, name, date) {
  adminAuth_(pin);
  var now = nowKst_();
  date = parseDate_(date) || addDays_(now.date, -1);
  var note = '';
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var h = hrNeedRow_(name);
    var a = hrPlan_().away[h.name];
    if (!a) throw new Error('넣어 둔 휴직이 없어요.');
    if (date >= a.to) throw new Error('휴직은 이미 ' + whenOf_(a.to) + '까지예요. 더 늘리려면 기간을 다시 넣어주세요.');
    for (var cy = (date < a.from ? a.from : addDays_(date, 1)).slice(0, 7); cy <= a.to.slice(0, 7) && cy < now.ym; cy = nextYm_(cy)) needOpen_(cy);
    var parts = String(h.moves || '').split(' · ').filter(String);
    if (date < a.from) {
      awayMarks_(h.name, a.from, a.to, false);
      hrPlanSave_(function (o) { delete o.away[h.name]; });
      if (awayLine_(parts[parts.length - 1])) parts.pop(); else parts.push(now.date + ' ' + AWAY_MARK + ' 취소');
      note = '휴직을 취소했어요. 휴무표의 \'' + AWAY_MARK + '\' 표시도 지웠어요.';
    } else {
      awayMarks_(h.name, addDays_(date, 1), a.to, false);
      hrPlanSave_(function (o) { if (date < now.date) delete o.away[h.name]; else o.away[h.name].to = date; }); // 이미 끝난 기간이면 예약에서 지워요
      parts.push(addDays_(date, 1) + ' 복직');
      note = '휴직을 ' + whenOf_(date) + '까지로 줄였어요. ' + whenOf_(addDays_(date, 1)) + '부터 다시 근무예요.';
    }
    hrWrite_(h.row, { moves: parts.join(' · ') });
  } finally {
    lock.releaseLock();
  }
  var card = hrCard_(hrNeedRow_(name));
  card.note = note;
  return card;
}

/**
 * 휴무표 from~to 칸에 '휴직'을 적거나(on: 빈 칸·'결근?'만) 지워요(off: '휴직'인 칸만). 아직 없는 달 탭은 건너뛰어요
 * (탭이 생기면 10분 검사가 채워요). 적은·지운 칸 수를 돌려줘요. only = 이 날짜부터만(10분 검사가 지난 날을 다시 채우지 않게).
 */
function awayMarks_(name, from, to, on, only) {
  var n = 0;
  if (only && only > from) from = only;
  for (var ym = from.slice(0, 7); ym <= to.slice(0, 7); ym = nextYm_(ym)) {
    if (!monthSheet_(ym)) continue;
    var g = monthGrid_(ym);
    var r = g && g.rows[name];
    if (!r) continue;
    var d0 = ym === from.slice(0, 7) ? Number(from.slice(8)) : 1;
    var d1 = ym === to.slice(0, 7) ? Number(to.slice(8)) : daysIn_(ym);
    if (d1 < d0) continue;
    var row = [], hit = 0;
    for (var d = d0; d <= d1; d++) {
      var idx = g.cols.day1 + d - 1;
      var cur = String(r.vals[idx] || '').trim();
      var nv = on ? (!cur || cur === '결근?' ? AWAY_MARK : cur) : (cur === AWAY_MARK ? '' : cur);
      if (nv !== cur) hit++;
      row.push(nv);
    }
    if (!hit) continue;
    if (String(g.sh.getRange(r.row, g.cols.name + 1).getDisplayValue()).trim() !== name) { // 읽은 뒤에 줄이 바뀌었으면 다시 읽어요
      delete GRID_[ym];
      ym = prevYm_(ym);
      continue;
    }
    g.sh.getRange(r.row, g.cols.day1 + d0, 1, row.length).setNumberFormat('@').setValues([row]);
    for (var k = 0; k < row.length; k++) r.vals[g.cols.day1 + d0 - 1 + k] = row[k];
    if (on && g.cols.full >= 0) {
      // 예전 버전이 만든 탭이면 만근 수식에 휴직 조건이 없어요. 수식인 칸만 지금 수식으로 다시 적어요
      var fc = g.sh.getRange(r.row, g.cols.full + 1);
      if (fc.getFormulas()[0][0]) fc.setFormula(fullFormula_(ym, r.row, g.cols.day1));
    }
    n += hit;
  }
  return n;
}

/** 10분 검사: 휴직 중인 사람의 오늘부터의 빈 칸을 채워요(새로 생긴 달 탭 등). 지난 날은 다시 채우지 않아요. */
function awayFill_(now) {
  var plan = hrPlan_(), n = 0;
  var until = nextYm_(now.ym) + '-' + pad2_(daysIn_(nextYm_(now.ym)));
  Object.keys(plan.away).forEach(function (name) {
    var a = plan.away[name];
    if (a.to < now.date || a.from > until) return;
    try { n += awayMarks_(name, a.from, a.to < until ? a.to : until, true, now.date); } catch (err) { console.error(err); }
  });
  return n;
}

/** 쉼표로 나눈 체크 항목 목록(빈 것·겹친 것 빼고 12개까지). */
function checkItems_(text) {
  var out = [];
  String(text == null ? '' : text).split(/\s*[,，]\s*/).forEach(function (x) {
    x = x.replace(/\s+/g, ' ').trim().slice(0, 24);
    if (x && out.indexOf(x) < 0 && out.length < 12) out.push(x);
  });
  return out;
}

/**
 * 방금 한 지점 이동 취소: 이동 기록의 마지막 줄(예: 2026-11-16 왕십리→가산)을 지우고 원래 지점으로 되돌려요.
 * [직원] 매장, [인사] 지점·이동 기록, 이번 달·다음 달 휴무표 줄을 원래 지점 묶음으로 옮겨요. 점장 칸은 되돌아오지 않아요.
 */
function adminMoveUndo(pin, name) {
  adminAuth_(pin);
  var note = '';
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var h = hrNeedRow_(name);
    var p = findStaff_(h.name);
    if (!p || !p.active) throw new Error('근무 중인 직원이 아니에요.');
    var parts = String(h.moves || '').split(' · ').filter(String);
    var last = parts[parts.length - 1] || '';
    var m = /^(\d{4}-\d{2}-\d{2}) (.+)→(.+)$/.exec(last);
    if (!m || m[3] !== p.store) throw new Error('되돌릴 지점 이동 기록이 없어요. (이동 기록의 마지막 줄이 지금 지점으로 온 이동일 때만 취소할 수 있어요)');
    if (!storeOf_(m[2])) throw new Error(m[2] + ' 지점이 [매장] 탭에 없어서 되돌릴 수 없어요.');
    setStaffCell_(p.row, '매장', m[2]);
    hrWrite_(h.row, { store: m[2], moves: parts.slice(0, -1).join(' · ') });
    var now = nowKst_();
    [now.ym, nextYm_(now.ym)].forEach(function (ym) { moveMonthRow_(ym, p.name, m[2], ''); });
    note = last + ' 이동을 취소했어요. 다시 ' + m[2] + ' 소속이에요.' + (storeOf_(m[2]).managers.indexOf(p.name) < 0 ? '' : '');
  } finally {
    lock.releaseLock();
  }
  mgrMove_(settings_(), 'undo', p.name, m[3], m[2], ''); // 여기까지 오면 되돌린 거예요: 두 지점 점장에게(옮겼다고 알렸던 것 바로잡기)
  var card = hrCard_(hrNeedRow_(name));
  card.note = note;
  return card;
}

/**
 * 퇴사 처리. date = 마지막 근무일, reason = 퇴사 사유(자진 퇴사·계약 만료·권고사직·해고·기타 (자세히)).
 *  - 지난 날짜: 바로 퇴사 처리([직원] 재직 '퇴사' → 앱 명단에서 빠져요, [인사] 상태·퇴사일)
 *  - 오늘이나 앞날: '퇴사 예정'. 그날까지는 출퇴근을 찍을 수 있고, 다음 날 자동으로 퇴사 처리돼요
 *  - 근무 중인 사람은 사유가 꼭 있어야 해요(퇴사 예정 날짜만 바꿀 때는 적어 둔 사유를 그대로 써요)
 *  - 이미 퇴사한 사람: 날짜를 고르면 마지막 근무일을 고치고, 사유를 주면 사유도 고쳐요(날짜 없이 사유만 고쳐도 돼요)
 * 퇴사한 달 휴무표에는 줄이 그대로 남고, 다음 달부터의 탭에서는 빠져요. 기록·인사 카드는 남아요.
 */
function adminRetire(pin, name, date, reason) {
  adminAuth_(pin);
  var now = nowKst_();
  var explicit = !!parseDate_(date); // 이미 퇴사한 사람은 날짜를 골랐을 때만 마지막 근무일을 고쳐요
  date = parseDate_(date) || addDays_(now.date, -1);
  var why = retireWhy_(reason); // '자진 퇴사' 또는 '기타 (가족 사정)' 모양으로. 기타인데 자세히가 없으면 여기서 막아요
  name = String(name == null ? '' : name).trim();
  var note = [];
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var p = findStaff_(name);
    var h = hrFind_(name);
    if (!p && !(h && h.state === '퇴사')) throw new Error('직원을 찾을 수 없어요.');
    // 근무 중인 같은 이름이 있는데 [인사]는 예전 퇴사 줄: 엉뚱한 사람(근무 중인 사람)을 퇴사시키지 않게 막아요
    if (p && p.active && h && h.state === '퇴사') throw new Error('근무 중인 ' + name + ' 님과 같은 이름의 퇴사 기록이에요. 같은 사람이면 [인사] 상태를 근무로, 다른 사람이면 [직원] 이름에 구분(예: ' + name + 'B)을 붙인 뒤 해주세요.');
    var had = h && (h.state === '퇴사' || parseDate_(h.end)) ? h.reason : ''; // 지금 적힌 퇴사 사유(퇴사 예정·퇴사한 사람만)
    if (why && why !== '기타' && why === whyKind_(had)) why = had; // 같은 분류를 다시 고르면 적어 둔 자세한 내용(본인 신청 날짜 등)은 그대로
    // 이미 퇴사한 사람의 사유만 고쳐요(날짜를 안 골랐거나 적힌 날짜 그대로). 휴무표를 안 건드려서 마감한 달이어도 돼요
    var only = !!why && (!p || !p.active) && !!h && h.state === '퇴사' && (!explicit || parseDate_(h.end) === date);
    if (!only) needOpen_(date);
    var start = h ? parseDate_(h.start) : '';
    if (start && date < start && !only) throw new Error('마지막 근무일이 입사일(' + start + ')보다 앞이에요.');
    if (p && p.active && !why) why = had; // 퇴사 예정 날짜만 바꿀 때는 적어 둔 사유 그대로
    if (p && p.active && !why) throw new Error('퇴사 사유를 골라주세요. (자진 퇴사 · 계약 만료 · 권고사직 · 해고 · 기타)');
    if (only) {
      if (why === had) throw new Error('이미 퇴사 사유가 ' + why + '(으)로 적혀 있어요.');
      hrWrite_(h.row, { reason: why });
      note.push('퇴사 사유를 ' + why + '(으)로 적었어요.');
    } else if (!p || !p.active) {
      // 이미 퇴사한 사람: 마지막 근무일만 고쳐요(예: 시트에 퇴사로만 적혀 있어서 퇴사일이 비었거나 틀렸을 때)
      // 그 달 휴무표에 줄이 생기고(그달 중간 퇴사면 그달 명단에 나와요), 뒤 달 줄은 빠져요
      if (!explicit || !h || h.state !== '퇴사') throw new Error('이미 퇴사 처리된 직원이에요. 마지막 근무일을 고치려면 날짜를 골라주세요.');
      if (date >= now.date) throw new Error('이미 퇴사한 직원은 어제까지의 날짜로만 고칠 수 있어요.');
      var oldEnd = parseDate_(h.end);
      if (oldEnd === date) throw new Error('이미 ' + whenOf_(date) + '로 적혀 있어요.');
      // 예전 날짜 다음 날의 '퇴사' 칸: 그 달 탭이 있고 마감 전일 때만 지워요(없는 탭을 새로 만들지 않고, 마감한 달은 사장님이 먼저 마감을 풀어야 해요)
      var oldNext = oldEnd ? addDays_(oldEnd, 1) : '';
      var dropOld = !!oldNext && !!monthSheet_(oldNext.slice(0, 7)) && dayMark_(name, oldNext) === '퇴사';
      if (dropOld) needOpen_(oldNext);
      hrWrite_(h.row, why ? { end: date, reason: why } : { end: date });
      if (dropOld) setMark_(oldNext, name, function (old) { return old === '퇴사' ? '' : old; });
      // 이 사람 줄만 넣어요: 예전 날짜(없으면 새 날짜)의 달부터 새 날짜의 달까지, 탭이 있고 마감 전인 달
      for (var fm = (oldEnd && oldEnd < date ? oldEnd : date).slice(0, 7); fm <= date.slice(0, 7); fm = nextYm_(fm)) {
        if (monthSheet_(fm) && !isClosed_(fm)) ensureMonth_(fm, false, name);
      }
      note = ['마지막 근무일을 ' + whenOf_(date) + '(으)로 적었어요.' + (why && why !== had ? ' 퇴사 사유는 ' + why + '(이)에요.' : '')].concat(retireCleanup_(name, date));
    } else {
      note = retirePlan_(p, h, date, why); // 오늘이나 앞날이면 퇴사 예정, 지난 날이면 바로 퇴사 처리
    }
  } finally {
    lock.releaseLock();
  }
  if (p && p.active) mgrRetire_(settings_(), date >= now.date ? 'plan' : 'done', p.name, p.store, date); // 그 지점 점장에게(이미 퇴사한 사람의 날짜 고치기는 빼요)
  var card = hrCard_(hrNeedRow_(name));
  card.note = note.join(' ');
  return card;
}

/** 퇴사 예정 취소(날짜 지우기) 또는 퇴사 취소(다시 근무: [직원] 재직·[인사] 상태를 되돌리고 이번 달 휴무표에 다시 넣어요). */
function adminUnretire(pin, name) {
  adminAuth_(pin);
  var now = nowKst_();
  var msg = '';
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var h = hrNeedRow_(name);
    var p = findStaff_(h.name);
    var endWas = parseDate_(h.end); // 점장 알림에 쓸 퇴사(예정)일. hrWrite_가 h도 같이 고쳐서 지우기 전에 읽어 둬요
    if (p && p.active) {
      if (!h.end) throw new Error('퇴사 예정이 없어요.');
      hrWrite_(h.row, { end: '' });
      msg = '퇴사 예정을 취소했어요.';
    } else {
      if (!p) throw new Error('[직원] 탭에 ' + h.name + ' 님 줄이 없어요. 다시 다니게 되면 입사 등록으로 받아주세요.');
      staff_().forEach(function (x) {
        if (x.active && x.name !== p.name && (p.deviceIds || []).some(function (d) { return hasDev_(x, d); })) setStaffCell_(p.row, '등록폰', ''); // 그 폰을 다른 직원이 쓰고 있으면 비워요
      });
      setStaffCell_(p.row, '재직', '');
      var endDay = parseDate_(h.end); // 아래에서 퇴사일 칸을 지우기 전에 읽어 둬요
      hrWrite_(h.row, { state: '근무', end: '', moves: addMove_(h.moves, now.date + ' 퇴사 취소' + (h.end ? '(' + h.end + ')' : '')) });
      ensureMonth_(now.ym);
      if (monthSheet_(nextYm_(now.ym))) ensureMonth_(nextYm_(now.ym));
      // 퇴사 처리 때 마지막 근무일 다음 날 칸에 적은 '퇴사'를 지워요(남아 있으면 그날이 쉬는 날로 처리돼요)
      if (endDay) setMark_(addDays_(endDay, 1), h.name, function (old) { return old === '퇴사' ? '' : old; });
      msg = '퇴사를 취소했어요. 다시 앱 명단에 나와요. 퇴사 처리 때 취소된 요청, 다음 달에 골라 둔 휴무, 점장 칸은 되돌아오지 않으니 필요하면 다시 넣어주세요.';
    }
  } finally {
    lock.releaseLock();
  }
  mgrRetire_(settings_(), p.active ? 'cancel' : 'back', p.name, p.store, endWas); // 퇴사 소식을 들은 점장에게 바로잡기
  var card = hrCard_(hrNeedRow_(name));
  card.note = msg;
  return card;
}

/** 바로 퇴사 처리(잠금 안에서 불러요). 한 일을 글로 돌려줘요. */
function retire_(p, date, why, skipId) {
  setStaffCell_(p.row, '재직', '퇴사');
  var h = hrFind_(p.name);
  var rec = { state: '퇴사', end: date };
  if (why) rec.reason = why; // 퇴사 사유(자동 퇴사 처리는 퇴사 예정 때 적어 둔 사유 그대로)
  if (h) hrWrite_(h.row, rec);
  else { rec.name = p.name; rec.store = p.store; rec.first = p.store; hrWrite_(0, rec); }
  var note = ['퇴사 처리했어요(마지막 근무일 ' + whenOf_(date) + ').'];
  try {
    note = note.concat(retireCleanup_(p.name, date, skipId));
  } catch (err) {
    console.error(err);
    note.push('뒷정리(다음 달 휴무표 줄·남은 요청·점장 칸)를 다 못 했어요: ' + err.message + ' 직접 확인해 주세요.');
  }
  return note;
}

/**
 * 퇴사 뒤 정리(여러 번 해도 괜찮아요). 한 일을 글로 돌려줘요.
 *  - 휴무표: 퇴사한 달 탭은 그대로 두고 마지막 근무일 다음 날 칸에 '퇴사'(비어 있을 때만), 그 뒤 달 탭에서는 줄을 빼요
 *    (뒤 달 줄에 오늘까지의 기록이 있으면 그대로 두고 알려줘요)
 *  - 마지막 근무일 뒤 날짜의 기다리던 요청은 취소, 대타를 해 주기로 한 건 다시 '구하는 중'으로.
 *    마지막 근무일까지(일한 날)의 정정·휴무·대타는 그대로 둬요(사장님이 승인·거절). skipId: 지금 승인하는 퇴사 신청
 *  - 마지막 근무일 뒤에 맡기로 한 승인된 대타가 있으면 알려줘요(그날 근무를 다시 정해야 해요)
 *  - [매장] 점장 칸에서 이름 빼기
 */
function retireCleanup_(name, date, skipId) {
  var out = [], now = nowKst_(), ym = date.slice(0, 7);
  var next = addDays_(date, 1);
  var pl = hrPlan_();
  if (pl.away[name]) awayMarks_(name, next > pl.away[name].from ? next : pl.away[name].from, pl.away[name].to, false); // 마지막 근무일 뒤의 '휴직' 표시
  if (pl.move[name] || pl.away[name]) hrPlanSave_(function (o) { delete o.move[name]; delete o.away[name]; });
  // 마지막 근무일 뒤에 밤 마감이 적어 둔 '결근?'은 지워요(며칠 뒤에 퇴사 처리했을 때. 사장님이 적은 '결근'·'무단'은 그대로)
  // 마감한 달은 건드리지 않아요(장부와 휴무표가 서로 달라지지 않게)
  var shut = isClosed_(ym);
  if (shut) out.push(Number(ym.slice(5)) + '월은 마감한 달이라 휴무표는 그대로 뒀어요.');
  for (var dd = next; !shut && dd <= now.date && dd.slice(0, 7) === ym; dd = addDays_(dd, 1)) {
    if (dayMark_(name, dd) === '결근?') setMark_(dd, name, function () { return ''; });
  }
  if (!shut && next.slice(0, 7) === ym) {
    var g0 = monthGrid_(ym);
    if (g0 && g0.rows[name]) setMark_(next, name, function (old) { return old || '퇴사'; });
  }
  var removed = [], kept = [];
  book_().getSheets().forEach(function (sh) {
    var nm = sh.getName();
    var m = tabYm_(nm);
    if (!m) return;
    if (!m || m <= ym || isClosed_(m)) return;
    try { // 손으로 만든 빈 탭 같은 이상한 탭 하나 때문에 정리가 통째로 멈추지 않게
      var g = monthGrid_(m, true);
      var r = g && g.rows[name];
      if (!r) return;
      var used = false;
      for (var d = 1; d <= daysIn_(m); d++) {
        var cell = String(r.vals[g.cols.day1 + d - 1] || '').trim();
        if (m + '-' + pad2_(d) <= now.date && cell && cell !== '결근?' && cell !== '퇴사') used = true; // 앱이 적은 '결근?'은 기록으로 안 쳐요
      }
      if (used) { kept.push(Number(m.slice(5)) + '월'); return; }
      sh.deleteRow(r.row);
      delete GRID_[m];
      paintMonth_(sh, m, monthGrid_(m, true).cols);
      removed.push(Number(m.slice(5)) + '월');
    } catch (err) {
      console.error(err);
    }
  });
  if (removed.length) out.push(removed.join('·') + ' 휴무표에서 줄을 뺐어요.');
  if (kept.length) out.push(kept.join('·') + ' 휴무표에는 이미 기록이 있어서 줄을 그대로 뒀어요.');
  // 요청 정리
  var sh2 = reqSheet_(), canceled = 0, reopened = 0, stay = 0, late = [], stamp = now.date + ' ' + now.time;
  readReqsNow_().forEach(function (r) {
    if (r.state === '승인' && r.kind === '대타' && r.taker === name && r.date > date && r.date >= now.date) late.push(whenOf_(r.date) + ' ' + r.name);
    if (r.state !== '대기' && r.state !== '수락') return;
    if (r.name !== name && r.taker !== name) return;
    if (skipId && r.id === skipId) return; // 지금 승인하는 퇴사 신청(승인으로 끝나요)
    // 마지막 근무일까지의 요청은 그 사람이 실제로 일하거나 쉰 날이에요: 지우지 않고 사장님이 처리하게 둬요
    // (휴무 바꾸기는 두 날 중 늦은 날 기준, 아무도 안 받은 지난 대타는 받을 수 없으니 취소)
    var upto = moveFrom_(r) > r.date ? moveFrom_(r) : r.date;
    if (upto && upto <= date && r.kind !== '퇴사' && !(r.kind === '대타' && !r.taker)) { stay++; return; }
    if (r.name === name) {
      r.state = '취소';
      r.done = stamp + ' 퇴사';
      putReq_(sh2, r.row, r);
      canceled++;
    } else if (r.taker === name) {
      r.state = '대기';
      r.taker = '';
      putReq_(sh2, r.row, r);
      reopened++;
    }
  });
  if (canceled) out.push('기다리던 요청 ' + canceled + '건을 취소했어요.');
  if (reopened) out.push('대타를 해 주기로 한 ' + reopened + '건은 다시 구하는 중으로 돌렸어요.');
  if (stay) out.push('마지막 근무일까지의 요청 ' + stay + '건은 그대로 뒀어요. 요청 카드에서 승인·거절해 주세요.');
  if (late.length) out.push(name + ' 님이 마지막 근무일 뒤에 맡기로 한 대타(' + late.join(', ') + ' 님 대신)가 승인돼 있어요. 그날 근무를 [근무표]에서 다시 정해 주세요.');
  var dropped = dropManager_(name);
  if (dropped.length) out.push(dropped.join('·') + ' 점장 칸에서 뺐어요. 새 점장을 [매장] 탭에 적어주세요.');
  return out;
}

/** [매장] 탭 점장 칸에서 그 이름을 빼요(only를 주면 그 매장에서만). 뺀 매장 이름들을 돌려줘요. */
function dropManager_(name, only) {
  if (!stores_().some(function (st) { return st.managers.indexOf(name) >= 0 && (!only || st.name === only); })) return [];
  var sh = book_().getSheetByName(SHEETS.store);
  if (!sh || sh.getLastRow() < 2) return [];
  var head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
  var c = head.indexOf('점장');
  if (c < 0) return [];
  var out = [];
  stores_().forEach(function (st) {
    if (st.managers.indexOf(name) < 0 || (only && st.name !== only)) return;
    sh.getRange(st.row, c + 1).setNumberFormat('@').setValue(st.managers.filter(function (n) { return n !== name; }).join(', '));
    out.push(st.name);
  });
  if (out.length) forget_('stores');
  return out;
}

/** 마지막 근무일이 지난 사람을 퇴사 처리해요(10분마다 도는 검사에서. 보통 자정 넘어 첫 검사 때). 사장님께 알려요. */
function retireDue_(set, now) {
  if (!book_().getSheetByName(SHEETS.hr)) return 0;
  if (now.min < 5 * 60) return 0; // 마지막 근무일에 자정을 넘겨 퇴근하는 사람이 찍을 수 있게, 새벽 5시 뒤에 해요
  var dates = hrDates_(), n = 0;
  staff_().forEach(function (p) {
    var d = dates[p.name];
    if (!p.active || !d || !d.end || d.end >= now.date || p.name === TEST_NAME) return;
    if (d.state === '퇴사') return; // [인사]는 이미 퇴사인데 [직원]에서 근무 중: 다시 온 사람이거나 이름만 같은 새 사람이에요(사장님 화면에 알려요)
    try { // 한 사람에서 오류가 나도 나머지 사람·10분 검사는 계속 돼요
      var note = retire_(p, d.end);
      n++;
      notify_(set, '퇴사 처리', p.name + (p.store ? ' (' + p.store + ')' : '') + '\n' + note.join('\n'), { silent: true });
      mgrRetire_(set, 'done', p.name, p.store, d.end); // 그 지점 점장에게
    } catch (err) {
      stepFail_('퇴사 처리(' + p.name + ')', err);
    }
  });
  return n;
}

/* ───── 퇴사 사유 · 직원 퇴사 신청 · 근로자 명부 ───── */

/** 퇴사 사유 분류. [인사] '퇴사 사유' 칸에는 '분류' 또는 '분류 (자세히)'로 적어요. 예: 기타 (가족 사정으로 이사), 자진 퇴사 (본인 신청 11/21) */
var RETIRE_WHY = ['자진 퇴사', '계약 만료', '권고사직', '해고', '기타'];

/**
 * 받은 퇴사 사유를 '분류' 또는 '분류 (자세히)' 모양으로 맞춰요. 비었으면 ''.
 * 띄어쓰기가 달라도 알아봐요(자진퇴사 → 자진 퇴사). 목록에 없는 글은 '기타 (그 글)'로 봐요. 기타는 자세히(40자까지)가 꼭 있어야 해요.
 */
function retireWhy_(v) {
  var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!s) return '';
  var kind = '', rest = s;
  RETIRE_WHY.forEach(function (k) {
    var m = kind ? null : new RegExp('^' + k.replace(/\s/g, '').split('').join('\\s*') + '(?=$|[\\s:：(（\\-·,])').exec(s);
    if (m) { kind = k; rest = s.slice(m[0].length); }
  });
  rest = rest.replace(/^[\s:：\-·,]+/, '').replace(/^[(（]\s*([\s\S]*?)\s*[)）]$/, '$1').trim().slice(0, 40);
  kind = kind || '기타';
  if (kind === '기타' && !rest) throw new Error('기타를 고르면 퇴사 사유를 짧게 적어주세요. (예: 가족 사정으로 이사)');
  return rest ? kind + ' (' + rest + ')' : kind;
}

/** 적힌 퇴사 사유의 분류('자진 퇴사 (본인 신청 11/21)' → '자진 퇴사'). 목록에 없는 글이면 '기타', 비었으면 ''. */
function whyKind_(t) {
  t = String(t == null ? '' : t).trim();
  if (!t) return '';
  for (var i = 0; i < RETIRE_WHY.length; i++) if (t === RETIRE_WHY[i] || t.indexOf(RETIRE_WHY[i] + ' (') === 0) return RETIRE_WHY[i];
  return '기타';
}

/** 근무 중인 사람의 퇴사(잠금 안에서 불러요). 오늘이나 앞날이면 퇴사 예정(날짜·사유만 적어요), 지난 날이면 바로 퇴사 처리. 한 일을 글로 돌려줘요. */
function retirePlan_(p, h, date, why, skipId) {
  if (date < nowKst_().date) return retire_(p, date, why, skipId);
  if (h) hrWrite_(h.row, { end: date, reason: why });
  else hrWrite_(0, { name: p.name, store: p.store, state: '근무', end: date, first: p.store, reason: why });
  var out = [whenOf_(date) + '까지 근무하고 다음 날 자동으로 퇴사 처리돼요.'];
  var sw = swapsAfter_(p.name, date);
  if (sw.length) out.push('그 뒤에 맡기로 한 대타가 있어요(' + sw.join(', ') + ' 님 대신). 다시 정해 주세요.');
  return out;
}

/**
 * 직원 퇴사 신청 확인(makeRequest 잠금 안). 마지막 근무일은 오늘부터 60일 안, 이유는 꼭 적어요.
 * 이미 퇴사 예정이거나 기다리는 퇴사 신청이 있으면 막아요. [요청] '내용' 칸에 적을 글을 돌려줘요.
 */
function quitAsk_(p, date, reason, all, now) {
  var far = daysBetween_(now.date, date);
  if (far < 0 || far > 60) throw new Error('마지막 근무일은 오늘부터 60일 안의 날짜로 골라주세요.');
  if (!reason) throw new Error('그만두는 이유를 적어주세요. (예: 학업, 이사, 개인 사정)');
  var hd = hrDates_()[p.name];
  if (hd && hd.state !== '퇴사' && hd.end) throw new Error('이미 퇴사 예정이에요(' + whenOf_(hd.end) + '까지 근무). 날짜를 바꾸려면 사장님께 말씀해 주세요.');
  all.forEach(function (r) {
    if (r.name === p.name && r.kind === '퇴사' && (r.state === '대기' || r.state === '수락')) {
      throw new Error('퇴사 신청을 이미 보냈어요(' + whenOf_(r.date) + '까지 근무). 날짜를 바꾸려면 보낸 신청을 취소하고 다시 보내주세요.');
    }
  });
  return '마지막 근무일';
}

/**
 * 퇴사 신청 승인(decideReq_ 잠금 안): 신청한 날까지 근무하고 퇴사해요. 앞날이면 퇴사 예정, 이미 지났으면 바로 퇴사 처리.
 * 사유는 '자진 퇴사 (본인 신청 MM/DD)'. 신청한 때는 [요청] 줄 요청일시에 그대로 남아요(증거).
 */
function quitApply_(r) {
  var p = findStaff_(r.name);
  if (!p || !p.active) throw new Error(r.name + ' 님은 이미 퇴사 처리됐어요. 이 요청은 거절해 주세요.');
  var h = hrFind_(p.name);
  if (h && h.state === '퇴사') throw new Error('근무 중인 ' + p.name + ' 님과 같은 이름의 퇴사 기록이 있어요. 같은 사람인지 [인사] 탭에서 먼저 확인해 주세요.');
  var start = h ? parseDate_(h.start) : '';
  if (start && r.date < start) throw new Error('마지막 근무일이 입사일(' + start + ')보다 앞이에요. 이 요청은 거절해 주세요.');
  var asked = parseDate_(String(r.at || '').slice(0, 10)) || nowKst_().date;
  return retirePlan_(p, h, r.date, '자진 퇴사 (본인 신청 ' + mmdd_(asked) + ')', r.id); // 한 일을 글로 돌려줘요(사장님 화면에 보여요)
}

/** 사장님 화면 퇴사 신청 카드의 알림 줄: 이미 퇴사 예정이 있으면 승인했을 때 바뀌는 것. 없으면 ''. */
function quitNote_(r) {
  var hd = hrDates_()[r.name], out = [];
  if (hd && hd.state !== '퇴사' && hd.end) {
    out.push(hd.end === r.date ? '이미 같은 날(' + whenOf_(r.date) + ')로 퇴사 예정이에요. 승인하면 퇴사 사유만 자진 퇴사(본인 신청)로 바뀌어요.'
      : '이미 ' + whenOf_(hd.end) + '까지 근무하는 퇴사 예정이 있어요. 승인하면 ' + whenOf_(r.date) + '까지로 바뀌어요.');
  }
  var sw = swapsAfter_(r.name, r.date);
  if (sw.length) out.push('마지막 근무일 뒤에 맡기로 한 대타가 있어요(' + sw.join(', ') + ' 님 대신). 승인하면 그날 근무를 다시 정해 주세요.');
  return out.join(' ');
}

/** 퇴사 신청을 승인했을 때 그 지점 점장에게(줄 밖에서. 이름·지점·날짜만, 사유는 안 적어요). */
function quitTold_(set, r) {
  var p = findStaff_(r.name);
  mgrRetire_(set, r.date >= nowKst_().date ? 'plan' : 'done', r.name, p ? p.store : '', r.date);
}

/** 가린 주민번호('950101-1******')에서 생년월일·성별. {birth: '1995-01-01', sex: '남'}. 모르면 빈칸. */
function rrnBirth_(s) {
  var m = /^(\d{2})(\d{2})(\d{2})-?(\d)/.exec(String(s == null ? '' : s).trim());
  if (!m) return { birth: '', sex: '' };
  var g = Number(m[4]);
  var y = (g === 3 || g === 4 || g === 7 || g === 8 ? 2000 : g === 9 || g === 0 ? 1800 : 1900) + Number(m[1]);
  var date = y + '-' + m[2] + '-' + m[3];
  if (parseDate_(date) !== date) return { birth: '', sex: '' };
  return { birth: date, sex: g % 2 ? '남' : '여' };
}

var ROSTER_TAB = '근로자 명부';
// 근로기준법 시행령 제20조의 근로자 명부 칸
var ROSTER_HEAD = ['성명', '성별', '생년월일', '주소', '이력', '종사 업무', '고용 연월일', '계약 기간', '그 밖의 고용 사항', '해고·퇴직 연월일', '해고·퇴직 사유'];
var ROSTER_NOTES = {
  '성별': '[인사] 주민번호(가린 번호)의 성별 숫자로 적어요',
  '생년월일': '[인사] 주민번호(가린 번호) 앞 6자리로 적어요',
  '이력': '입사일과 [인사] 이동 기록(지점 이동·휴직·다시 입사)',
  '종사 업무': '일하는 지점(퇴사자는 마지막 지점)',
  '고용 연월일': '[인사] 입사일',
  '계약 기간': '기간을 정한 계약이면 직접 적어요(예: 2026-03-02 ~ 2027-03-01). 인사 카드에 계약 끝을 적어 두면 저절로 채워져요. 명부를 다시 만들어도 이 칸은 남아요',
  '그 밖의 고용 사항': '[인사] 비고',
  '해고·퇴직 연월일': '[인사] 퇴사일(마지막 근무일). (예정)은 아직 근무 중이에요',
  '해고·퇴직 사유': '[인사] 퇴사 사유(사장님 화면 인사 카드에서 골라요)',
};

/**
 * [근로자 명부 만들기] (사장님만): '근로자 명부' 탭을 만들어요(있으면 다시 채워요). 근로기준법 제41조·시행령 제20조의 칸이에요.
 * 근무 중인 직원과 퇴사일이 3년 안인 퇴사자(퇴사일이 빈 퇴사자도 넣고 알려줘요). 성별·생년월일은 가린 주민번호에서 읽어요.
 * '계약 기간'은 앱이 모르는 값이라 비워 두고, 사장님이 적어 둔 값은 다시 만들어도 남겨요(성명·고용 연월일이 같은 줄).
 */
function adminRoster(pin) {
  adminAuth_(pin);
  var lock = LockService.getScriptLock();
  if (lock.tryLock(15000)) {
    try { syncHr_(); } finally { lock.releaseLock(); } // [직원] 탭에 직접 적은 새 직원도 들어가게
  }
  return roster_(nowKst_());
}

function roster_(now) {
  var ss = book_();
  var cut = (Number(now.date.slice(0, 4)) - 3) + now.date.slice(4); // 3년 전 오늘(근로자 명부 보관 기간)
  var order = {};
  stores_().forEach(function (st, i) { order[st.name] = i; });
  var on = [], gone = [];
  hrRows_().forEach(function (h, i) {
    if (h.state === HR_WAIT || hrExempt_(h.name)) return;
    if (h.state !== '퇴사') on.push({ h: h, i: i });
    else if (!parseDate_(h.end) || parseDate_(h.end) >= cut) gone.push({ h: h, i: i });
  });
  var rank = function (x) { return order[x.h.store] == null ? 999 : order[x.h.store]; };
  var endOf = function (x) { return parseDate_(x.h.end) || '0000'; }; // 퇴사일이 빈 사람은 맨 아래
  on = on.sort(function (a, b) { return rank(a) - rank(b) || a.i - b.i; }).map(function (x) { return x.h; });
  gone = gone.sort(function (a, b) { return endOf(a) < endOf(b) ? 1 : endOf(a) > endOf(b) ? -1 : a.i - b.i; }).map(function (x) { return x.h; });
  // 사장님이 적어 둔 계약 기간(성명·고용 연월일이 같은 줄)
  var sh = ss.getSheetByName(ROSTER_TAB), keep = {}, keepName = {};
  if (sh && sh.getLastRow() >= 2) {
    var old = sh.getRange(1, 1, sh.getLastRow(), Math.max(sh.getLastColumn(), 1)).getDisplayValues();
    for (var top = 0; top < Math.min(old.length, 5); top++) {
      var head = old[top].map(function (x) { return String(x).trim(); });
      var cN = head.indexOf('성명'), cS = head.indexOf('고용 연월일'), cT = head.indexOf('계약 기간'), cE = head.indexOf('해고·퇴직 연월일');
      if (cN < 0 || cT < 0) continue;
      old.slice(top + 1).forEach(function (r) {
        var t = String(r[cT]).trim();
        var nm = String(r[cN]).trim();
        if (t) { keep[nm + '|' + (cS < 0 ? '' : String(r[cS]).trim())] = t; (keepName[nm] = keepName[nm] || []).push({ t: t, end: cE < 0 ? '' : String(r[cE]).trim() }); }
      });
      break;
    }
  }
  if (sh) {
    if (sh.getFilter()) sh.getFilter().remove();
    sh.clear();
  } else {
    sh = ss.insertSheet(ROSTER_TAB);
  }
  var W = ROSTER_HEAD.length;
  var pad = function (r) { r = r.slice(); while (r.length < W) r.push(''); return r; };
  var cnt = {}, lostT = [];
  on.concat(gone).forEach(function (h) { cnt[h.name] = (cnt[h.name] || 0) + 1; });
  var rows = on.concat(gone).map(function (h) {
    var b = rrnBirth_(h.rrn), start = parseDate_(h.start) || h.start, end = parseDate_(h.end), left = h.state === '퇴사';
    // 계약 기간: 성명·고용 연월일이 같은 줄. 입사일을 고쳤거나 새로 넣었어도 같은 이름이 한 줄뿐이면 그 줄 것
    var endCell = end ? end + (left ? '' : ' (예정)') : '';
    var one = cnt[h.name] === 1 && keepName[h.name] && keepName[h.name].length === 1 ? keepName[h.name][0] : null;
    var ct = keep[h.name + '|' + start] || (one && one.end === endCell ? one.t : ''); // 다시 입사했으면(퇴직 연월일이 달라요) 예전 계약 기간은 안 옮겨요
    if (!ct && parseDate_(h.contractEnd)) ct = (start ? start + ' ' : '') + '~ ' + parseDate_(h.contractEnd); // 인사 카드의 계약 끝
    if (!ct && keepName[h.name]) lostT.push(h.name);
    var hist = [];
    if (start) hist.push(start + ' 입사' + (h.first ? '(' + h.first + ')' : ''));
    else if (h.first) hist.push('첫 지점 ' + h.first);
    if (h.moves) hist.push(h.moves);
    return [h.name, b.sex, b.birth, h.addr, hist.join(' · '), h.store, start, ct, h.memo,
      endCell, left || end ? h.reason : ''];
  });
  var title = ROSTER_TAB + ' · ' + now.date + ' 기준 · 근무 ' + on.length + '명 · 퇴사 ' + gone.length + '명(퇴사일 3년 안) · 근로기준법 제41조, 퇴사 후 3년 보관(제42조)';
  var out = [pad([title]), ROSTER_HEAD.slice()].concat(rows);
  if (out.length > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), out.length - sh.getMaxRows());
  if (W > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), W - sh.getMaxColumns());
  sh.getRange(1, 1, out.length, W).setNumberFormat('@').setValues(out);
  sh.getRange(1, 1).setFontWeight('bold');
  sh.getRange(2, 1, 1, W).setFontWeight('bold').setBackground('#eef2f7')
    .setNotes([ROSTER_HEAD.map(function (x) { return ROSTER_NOTES[x] || ''; })]);
  sh.getRange(2, 1, rows.length + 1, W).createFilter();
  sh.setFrozenRows(2);
  sh.setFrozenColumns(1);
  [[4, 220], [5, 360], [9, 220], [11, 200]].forEach(function (x) { sh.setColumnWidth(x[0], x[1]); });
  var names = function (list) { return list.slice(0, 5).join(', ') + (list.length > 5 ? ' 외 ' + (list.length - 5) + '명' : ''); };
  var noWhy = gone.filter(function (h) { return !h.reason; }).map(function (h) { return h.name; });
  var noEnd = gone.filter(function (h) { return !parseDate_(h.end); }).map(function (h) { return h.name; });
  var noBirth = on.concat(gone).filter(function (h) { return !rrnBirth_(h.rrn).birth; }).map(function (h) { return h.name; });
  var warn = [];
  if (noWhy.length) warn.push('퇴사 사유가 빈 퇴사자 ' + noWhy.length + '명: ' + names(noWhy) + '. 인사 카드 [마지막 근무일·퇴사 사유 고치기]에서 넣어 주세요.');
  if (noEnd.length) warn.push('퇴사일이 빈 퇴사자 ' + noEnd.length + '명도 넣었어요(3년이 지났는지 몰라서): ' + names(noEnd) + '.');
  if (noBirth.length) warn.push('주민번호가 없어서 성별·생년월일이 빈 사람 ' + noBirth.length + '명: ' + names(noBirth) + '.');
  if (lostT.length) warn.push('적어 둔 계약 기간을 옮기지 못한 사람(같은 이름이 여러 줄): ' + names(lostT) + '. 명부 탭에 다시 적어 주세요.');
  return { name: ROSTER_TAB, url: ss.getUrl() + '#gid=' + sh.getSheetId(), people: rows.length, active: on.length, gone: gone.length, warn: warn };
}

/**
 * 폰 연락처에 저장할 파일 주소(10분 동안). 이름은 '홍길동 950101'(이름 + 생년월일 6자리, 주민번호가 없으면 이름만), 회사 칸에 지점.
 * names를 비우면 근무 중인 직원 모두. 열면 아이폰은 연락처 화면이 바로 뜨고, 안드로이드는 파일을 눌러 저장해요.
 */
function adminContact(pin, names) {
  var a = auth_(pin);
  var want = [].concat(names || []).map(function (n) { return String(n).trim(); }).filter(String);
  var list = [];
  var mgr = a.role !== 'admin', mineNames = {};
  if (mgr) staff_().forEach(function (p) { if (p.active && canSee_(a, p)) mineNames[p.name] = true; }); // 점장은 자기 매장 근무자만
  hrRows_().forEach(function (h) {
    if (want.length ? want.indexOf(h.name) < 0 : h.state !== '근무') return;
    if (mgr && (!mineNames[h.name] || h.state !== '근무')) return;
    if ((!h.phone && !h.phone2) || h.name === TEST_NAME) return;
    list.push({ name: h.name, birth: mgr ? '' : birth6_(h.rrn), store: h.store, phone: h.phone, phone2: h.phone2 }); // 점장에게는 생년월일을 안 줘요
  });
  if (!list.length) throw new Error(want.length ? '휴대폰 번호가 아직 없어요. 인사 정보를 먼저 받아주세요.' : '휴대폰 번호가 있는 직원이 없어요.');
  var url = '';
  try { url = ScriptApp.getService().getUrl() || ''; } catch (err) { /* 배포 전 */ }
  if (!url) throw new Error('웹 앱으로 배포한 뒤에 쓸 수 있어요.');
  var token = Utilities.getUuid();
  CacheService.getScriptCache().put('vcf:' + token, vcard_(list), 600);
  return {
    url: url + '?vcf=' + token, count: list.length,
    names: list.map(function (c) { return c.name + (c.birth ? ' ' + c.birth : ''); }),
  };
}

/** doGet: 연락처 파일. dl=1이면 파일로 받아요(안드로이드). */
function contactOut_(token, dl) {
  var text = CacheService.getScriptCache().get('vcf:' + String(token || '').replace(/[^A-Za-z0-9-]/g, ''));
  if (!text) return ContentService.createTextOutput('연락처 링크가 만료됐어요(10분). 사장님 화면에서 다시 눌러주세요.');
  var out = ContentService.createTextOutput(text).setMimeType(ContentService.MimeType.VCARD);
  return dl ? out.downloadAsFile('contact.vcf') : out;
}

/** vCard 3.0. 이름 '홍길동 950101', 회사 칸에 지점, 휴대폰(추가 번호도 모두. 메모에 업무·회사가 있으면 '직장' 번호로). */
function vcard_(list) {
  var esc = function (s) { return String(s).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/([,;])/g, '\\$1'); };
  return list.map(function (c) {
    var fn = c.name + (c.birth ? ' ' + c.birth : '');
    var tels = c.phone ? ['TEL;TYPE=CELL:' + c.phone] : [];
    phones2List_(c.phone2).forEach(function (x) { tels.push('TEL;TYPE=' + (/업무|회사|사무|매장/.test(x.memo) ? 'WORK' : 'CELL') + ':' + x.num); });
    return ['BEGIN:VCARD', 'VERSION:3.0', 'N:;' + esc(fn) + ';;;', 'FN:' + esc(fn),
      c.store ? 'ORG:' + esc(c.store) : ''].concat(tels, ['END:VCARD']).filter(String).join('\r\n');
  }).join('\r\n') + '\r\n';
}

/* ── [인사] 탭 읽기·쓰기, [직원]과 맞추기 ── */

function hrCols_() {
  return memo_('hrCols', function () {
    var v = snap_(SHEETS.hr);
    var col = {};
    if (!v || !v.length) return col;
    v[0].forEach(function (h, i) {
      h = String(h).trim();
      if (h && col[h] == null) col[h] = i;
    });
    return col;
  });
}

function hrRows_() { return memo_('hr', readHr_); }
function forgetHr_() { forget_('hr'); forget_('hrDates'); }

/** [인사] 탭의 입사일·퇴사일. 이름 → {start, end, state}. (승인 대기 줄은 빼요) */
function hrDates_() {
  return memo_('hrDates', function () {
    var map = {};
    if (!book_().getSheetByName(SHEETS.hr)) return map;
    hrRows_().forEach(function (h) {
      if (h.state === HR_WAIT) return;
      // 같은 이름 줄이 둘(예전 퇴사자 + 지금 직원)이면 퇴사가 아닌 줄(hrFind_와 같게)
      if (!map[h.name] || (map[h.name].state === '퇴사' && h.state !== '퇴사')) map[h.name] = { start: parseDate_(h.start), end: parseDate_(h.end), state: h.state };
    });
    return map;
  });
}

/**
 * 그날 그 사람이 다니는 중인지. 입사일 전이나 마지막 근무일(퇴사일) 뒤면 false.
 * 날짜가 비어 있으면 다니는 걸로 봐요(예전부터 다닌 직원은 입사일이 비어 있어요).
 */
function employedOn_(name, date) {
  var d = hrDates_()[name];
  return !d || ((!d.start || date >= d.start) && (!d.end || date <= d.end));
}

/** 퇴사 예정인 사람의 마지막 근무일(아직 근무 중일 때만). 없으면 ''. (예전 퇴사 줄만 있는 같은 이름 직원은 빼요) */
function lastDay_(name) {
  var d = hrDates_()[name];
  return d && d.end && d.state !== '퇴사' ? d.end : '';
}

/** 그 사람이 마지막 근무일(end) 뒤 날짜에 맡기로 한 대타(수락·승인, 오늘부터). ['11/30(월) 김민우', …] */
function swapsAfter_(name, end) {
  var today = nowKst_().date;
  return readReqsNow_().filter(function (r) {
    return r.kind === '대타' && r.taker === name && r.date > end && r.date >= today && (r.state === '수락' || r.state === '승인');
  }).map(function (r) { return whenOf_(r.date) + ' ' + r.name; });
}

/** 그 달에 하루라도 다니는지(휴무표 그달 탭에 줄이 있어야 하는 사람인지). */
function employedIn_(name, ym) {
  var d = hrDates_()[name];
  return !d || ((!d.start || d.start.slice(0, 7) <= ym) && (!d.end || d.end.slice(0, 7) >= ym));
}

function readHr_() {
  var all = snap_(SHEETS.hr);
  if (!all || all.length < 2) return [];
  var col = hrCols_();
  var vals = all.slice(1);
  var out = [];
  vals.forEach(function (r, i) {
    var o = { row: i + 2 };
    Object.keys(HR_KEY).forEach(function (k) {
      var c = col[HR_KEY[k]];
      o[k] = c == null || r[c] == null ? '' : String(r[c]).trim();
    });
    if (o.name) out.push(o);
  });
  return out;
}

/** 이름으로 [인사] 줄 찾기. state를 주면 그 상태만, 안 주면 승인 대기는 빼고. */
function hrFind_(name, state) {
  var hit = null;
  hrRows_().forEach(function (h) {
    if (h.name !== name || !(state ? h.state === state : h.state !== HR_WAIT)) return;
    // 같은 이름 줄이 둘(예전 퇴사자 + 지금 직원)이면 퇴사가 아닌 줄을 먼저
    if (!hit || (hit.state === '퇴사' && h.state !== '퇴사')) hit = h;
  });
  return hit;
}

/**
 * 직원 본인이 볼 수 있는 [인사] 줄. [직원] 탭에 같은 이름의 퇴사 줄과 근무 줄이 같이 있고 [인사]에는 퇴사 줄만 있으면
 * 예전 사람의 줄일 수 있어서(이름만 같은 다른 사람) 보여주지 않아요. 그때는 null.
 */
/**
 * 근무 중인데 [인사]에는 같은 이름이 퇴사로만 있을 때, [직원]에 그 이름 줄이 하나뿐이면(재직을 되돌렸거나 예전 줄을 지우고 다시 넣음)
 * 같은 사람인지 앱이 알 수 없어서 사장님 확인을 기다려요(인사 정보 입력을 막아 [인사]에 같은 이름 줄이 또 생기지 않게).
 */
function hrWaitOwner_(p) { return staff_().filter(function (q) { return q.name === p.name; }).length <= 1; }

function hrMine_(p) {
  var h = hrFind_(p.name);
  if (h && h.state === '퇴사' && p.active) return null; // 근무 중인 사람에게 퇴사한 인사 기록(이름만 같은 예전 사람일 수 있어요)은 안 보여줘요
  return h;
}

/** 나중에 할 일(시트 고침 감지는 30초 안에 끝나야 해서, 무거운 정리는 10분마다 도는 검사로 넘겨요). */
function hrTodo_(fn) {
  var props = PropertiesService.getScriptProperties();
  var todo;
  try { todo = JSON.parse(props.getProperty('hrTodo') || '{}'); } catch (err) { todo = {}; }
  if (!fn) return todo;
  fn(todo);
  props.setProperty('hrTodo', JSON.stringify(todo));
  return todo;
}

/** 넘겨 둔 일 하기: 휴무표 매장 칸·줄 옮기기, 퇴사 뒤 정리, 이름 바꾼 뒤 다른 탭 맞추기. (10분 검사, 사장님 화면 [직원] 탭) */
function hrTodoRun_() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('hrTodo')) return;
  var todo = hrTodo_();
  props.deleteProperty('hrTodo'); // 먼저 지워요(중간에 멈춰도 같은 일을 끝없이 되풀이하지 않게)
  var now = nowKst_();
  (todo.rename || []).forEach(function (x) { try { renameEverywhere_(x.from, x.to); } catch (err) { console.error(err); } });
  (todo.retire || []).forEach(function (x) { try { retireCleanup_(x.name, parseDate_(x.date) || now.date); } catch (err) { console.error(err); } });
  if (todo.labels) {
    [now.ym, nextYm_(now.ym)].forEach(function (ym) {
      try {
        if (monthSheet_(ym)) { ensureMonth_(ym); fixStoreLabels_(ym); }
      } catch (err) { console.error(err); }
    });
  }
}

/**
 * [인사] 한 줄 쓰기. row 0이면 맨 아래 새 줄. rec에 있는 칸 가운데 **바뀐 칸만** 써요(나머지 칸은 안 건드려요.
 * 사장님이 옆에 붙여 둔 칸의 수식·서식이 망가지지 않게). 쓴 줄 번호를 돌려줘요.
 */
function hrWrite_(row, rec) {
  var sh = sheet_(SHEETS.hr);
  var col = hrCols_();
  if (row && rec.end === '' && rec.reason === undefined && col[HR_KEY.reason] != null) rec.reason = ''; // 퇴사일을 지우면(퇴사 취소·다시 근무) 퇴사 사유도 같이 지워요
  Object.keys(rec).forEach(function (k) {
    var h = HR_KEY[k];
    if (col[h] != null) return;
    // 새 버전에서 늘어난 칸은 오른쪽 끝에 붙여요
    var c = Math.max(sh.getLastColumn(), 1) + 1;
    if (c > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), 1);
    sh.getRange(1, c).setValue(h).setFontWeight('bold').setBackground('#eef2f7');
    col[h] = c - 1;
  });
  var cur = null, known = null, isNew = !row;
  if (isNew) {
    row = Math.max(sh.getLastRow(), 1) + 1;
    if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 20);
  } else {
    // 이번 실행에서 이미 읽어 둔 줄이 있으면 그걸로 견줘요(시트를 다시 읽지 않아 빨라요)
    if (Object.prototype.hasOwnProperty.call(MEMO_, 'hr')) MEMO_.hr.forEach(function (x) { if (x.row === row) known = x; });
    if (!known) cur = sh.getRange(row, 1, 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues()[0];
  }
  // 바뀐 칸을 모아, 이웃한 칸끼리 묶어서 써요
  var changed = [];
  Object.keys(rec).forEach(function (k) {
    var c = col[HR_KEY[k]], v = rec[k] == null ? '' : String(rec[k]);
    var have = known ? known[k] : cur ? cur[c] : null;
    if (!isNew && String(have == null ? '' : have).trim() === v.trim()) return;
    if (isNew && v === '') return;
    changed.push({ c: c, v: v, k: k });
  });
  changed.sort(function (x, y) { return x.c - y.c; });
  for (var i = 0; i < changed.length;) {
    var j = i;
    while (j + 1 < changed.length && changed[j + 1].c === changed[j].c + 1) j++;
    var vals = changed.slice(i, j + 1).map(function (x) { return x.v; });
    sh.getRange(row, changed[i].c + 1, 1, vals.length).setNumberFormat('@').setValues([vals]);
    i = j + 1;
  }
  if (known) {
    changed.forEach(function (x) { known[x.k] = x.v.trim(); }); // 기억해 둔 줄도 같이 고쳐요(다시 안 읽게)
    forget_('hrDates');
  } else {
    forgetHr_();
  }
  return row;
}

function hrDelete_(row) {
  sheet_(SHEETS.hr).deleteRow(row);
  forgetHr_();
}

function parseJoin_(s) {
  try { var j = JSON.parse(s || '{}'); return j && typeof j === 'object' ? j : {}; } catch (err) { return {}; }
}

function addMove_(moves, text) { return moves ? moves + ' · ' + text : text; }

/**
 * [인사] 한 줄에서 앱이 읽는 모양으로 고칠 칸({} 이면 고칠 것 없음).
 *  - 입사일·퇴사일: 2026.3.2, 2026/3/2, 2026년 3월 2일 → 2026-03-02
 *  - 주민번호: 13자리가 그대로 적혀 있으면 암호로 바꾸고 가려요. 엑셀에서 붙여 앞 0이 빠진 12자리(2000년대생)도 알아봐요
 *  - 휴대폰: 01012345678, 1012345678(앞 0 빠짐) → 010-1234-5678
 */
function hrTidy_(h) {
  var rec = {};
  ['start', 'end'].forEach(function (k) {
    var d = h[k] ? parseDate_(h[k]) : '';
    if (d && d !== h[k]) rec[k] = d;
  });
  // 퇴사일을 '11/18', '11월 18일'처럼 연도 없이 적으면 올해 날짜로 봐요(입사일은 몇 년 전일 수 있어서 연도까지 적어야 해요)
  var guess = !rec.end && h.end && !parseDate_(h.end) ? mdGuess_(h.end) : '';
  if (guess) rec.end = guess;
  var raw = String(h.rrn || '').replace(/[\s-]/g, '');
  var plain = rrnParse_(raw);
  if (!plain && /^\d{12}$/.test(raw) && /[3478]/.test(raw.charAt(5))) plain = rrnParse_('0' + raw); // 0X년생: 앞 0이 빠진 번호
  if (plain) { rec.rrn = rrnMask_(plain); rec.enc = rrnEncrypt_(plain); }
  var ph = String(h.phone || '').trim();
  if (ph) {
    var digits = ph.replace(/\D/g, '');
    var fixed = phoneOf_(ph) || (/^10\d{8}$/.test(digits) ? phoneOf_('0' + digits) : '');
    if (fixed && fixed !== ph) rec.phone = fixed;
  }
  return rec;
}

/**
 * 연도 없이 적은 날짜('11/18', '11월 18일')를 오늘에 가까운 해로 맞혀요(1월 초에 적은 '12/31'은 작년, 12월에 적은 '1/5'는 내년).
 * 미국식 '11/18/2026'도 읽어요. 못 읽으면 ''.
 */
function mdGuess_(text) {
  var t = String(text == null ? '' : text).trim();
  var us = /^(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})$/.exec(t);
  if (us) return parseDate_(us[3] + '-' + us[1] + '-' + us[2]);
  var md = /^(\d{1,2})\s*(?:[\/.\-]|월)\s*(\d{1,2})\s*일?$/.exec(t);
  if (!md) return '';
  var today = nowKst_().date, y = Number(today.slice(0, 4));
  var guess = parseDate_(y + '-' + md[1] + '-' + md[2]);
  if (guess && daysBetween_(today, guess) > 183) guess = parseDate_((y - 1) + '-' + md[1] + '-' + md[2]);
  else if (guess && daysBetween_(guess, today) > 183) guess = parseDate_((y + 1) + '-' + md[1] + '-' + md[2]);
  return guess || '';
}

/** 주민번호 칸에 적힌 글자가 가린 번호(950101-1******)도 13자리도 아닌지(잘못 적힌 번호). */
function rrnOdd_(h) {
  var v = String(h.rrn || '').trim();
  return !!v && !/^\d{6}-[1-8]\*{6}$/.test(v) && !Object.keys(hrTidy_({ rrn: v })).length;
}

/**
 * [직원]과 [인사]를 맞춰요(setup, 하루 마감, [직원]·[인사] 탭을 고쳤을 때, 사장님 화면 [직원] 탭).
 *  - [인사] 날짜·주민번호·휴대폰을 앱이 읽는 모양으로 고쳐요(hrTidy_). 못 알아본 주민번호·날짜 칸은 빨갛게 표시해요
 *  - [인사]에서 '승인 대기'를 손으로 '근무'로 바꾼 줄은 앱에서 승인한 것처럼 처리해요
 *  - [인사]에 없는 직원은 줄을 만들어요. [직원] 이름을 손으로 고친 것 같으면(짝이 하나뿐일 때) 줄을 새로 만들지 않고 이름을 바꿔요
 *  - [직원] 매장이 바뀌었으면 [인사] 지점과 이동 기록, 휴무표 줄을 맞춰요
 *  - 재직이 바뀌었으면 상태(퇴사면 퇴사일)를 맞춰요
 * [직원]에 같은 이름이 두 줄이면 근무 중인 줄 하나만 보고, 근무 중인 같은 이름이 둘이면 그 이름은 건드리지 않아요.
 * opts.light(시트 고침 감지에서 부를 때): 휴무표 줄 옮기기·퇴사 뒤 정리 같은 무거운 일은 10분 검사로 넘겨요(30초 제한).
 */
function syncHr_(opts) {
  if (!book_().getSheetByName(SHEETS.hr)) return 0;
  var light = !!(opts && opts.light);
  var cols = hrCols_();
  if (cols[HR_KEY.name] == null || cols[HR_KEY.store] == null || cols[HR_KEY.state] == null) {
    // 머리글(이름·지점·상태)을 바꾸면 줄을 못 읽어요. 이름 없는 줄을 계속 만들지 않게 여기서 멈춰요
    try { book_().toast("[인사] 탭 1행의 머리글 '이름'·'지점'·'상태'를 바꾸면 앱이 줄을 못 읽어요. 원래 이름으로 되돌려 주세요.", '출퇴근', 10); } catch (err) { /* 알림을 못 띄워도 괜찮아요 */ }
    return 0;
  }
  var now = nowKst_();
  var known = {};
  stores_().forEach(function (st) { known[st.name] = true; });
  var n = 0, gone = [];
  var hsh = sheet_(SHEETS.hr), rrnCol = cols[HR_KEY.rrn], stCol = cols[HR_KEY.state];
  // 입사일·퇴사일 칸의 메모(못 읽는 날짜 표시)를 한 번에 읽어 둬요
  var dateNotes = { start: [], end: [] };
  var allHr = hrRows_(), lastHr = allHr.length ? allHr[allHr.length - 1].row : 1;
  var cs = cols[HR_KEY.start], ce = cols[HR_KEY.end];
  if (cs != null && ce != null && lastHr >= 2) {
    // 두 칸을 한 번에 읽어요(시트 호출을 아끼려고)
    var c0 = Math.min(cs, ce), wN = Math.abs(cs - ce) + 1;
    hsh.getRange(2, c0 + 1, lastHr - 1, wN).getNotes().forEach(function (r) {
      dateNotes.start.push(r[cs - c0]);
      dateNotes.end.push(r[ce - c0]);
    });
  }
  allHr.forEach(function (h) {
    var tidy, held = false;
    try { tidy = hrTidy_(h); } catch (err) {
      if (!hrKeyLost_()) throw err;
      // 주민번호 열쇠가 없어요: 13자리를 암호로 못 바꾸니 그 칸만 표시하고 나머지 맞추기는 계속해요(열쇠를 되살리면 저절로 가려져요)
      held = true;
      tidy = hrTidy_({ start: h.start, end: h.end, phone: h.phone });
      if (rrnCol != null) hsh.getRange(h.row, rrnCol + 1).setBackground('#fee2e2').setNote('주민번호 열쇠가 없어서 아직 가리지 못했어요. 시트 메뉴 ' + HR_KEY_MENU + '에서 열쇠를 되살리면 저절로 가려지고 암호로 바뀌어요.');
    }
    if (Object.keys(tidy).length) {
      hrWrite_(h.row, tidy);
      if (tidy.rrn && rrnCol != null) hsh.getRange(h.row, rrnCol + 1).setNote('').setBackground(null);
      n++;
    }
    if (!held && !tidy.rrn && rrnCol != null && rrnOdd_(h)) {
      hsh.getRange(h.row, rrnCol + 1).setBackground('#fee2e2')
        .setNote('주민등록번호 13자리가 아니에요. 다시 확인해서 13자리를 적어주세요(적으면 저절로 가려져요). 엑셀에서 붙일 때는 값만 붙여넣기(Ctrl+Shift+V)를 쓰세요.');
    }
    // 못 읽는 날짜(예: '11월 말', '3/2'처럼 연도 없는 입사일)는 빨갛게 표시해요. 앱은 이 칸을 빈칸으로 봐요
    [['start', HR_KEY.start], ['end', HR_KEY.end]].forEach(function (x) {
      var c = cols[x[1]], v = tidy[x[0]] || h[x[0]];
      if (c == null) return;
      var flagged = /^날짜를 읽지 못했어요/.test(dateNotes[x[0]][h.row - 2] || '');
      if (v && !parseDate_(v)) {
        if (!flagged) hsh.getRange(h.row, c + 1).setBackground('#fee2e2').setNote('날짜를 읽지 못했어요. 2026-11-18처럼 연도·월·일로 적어주세요.');
      } else if (flagged) {
        hsh.getRange(h.row, c + 1).setBackground(null).setNote(''); // 고쳤으면 표시를 지워요
      }
    });
  });

  // 승인 대기 줄을 손으로 고친 것
  //  - 상태를 '근무'로: 앱에서 승인한 것과 똑같이. 안 되면 '승인 대기'로 돌리고 이유를 메모로
  //  - 상태를 지우거나 다른 글자로: '승인 대기'로 되돌려요(거절은 사장님 화면에서. 주민번호·비밀번호가 든 줄이 떠돌지 않게)
  // 줄 번호는 승인하면서 바뀔 수 있어서(예전 줄에 합쳐지면 한 줄이 지워져요) 매번 이름+가입 값으로 다시 찾아요
  var pending = hrRows_().filter(function (h) { return h.join && h.state !== HR_WAIT && h.state !== '퇴사'; })
    .map(function (h) { return { name: h.name, join: h.join, ok: /근무/.test(h.state) }; });
  var approved = 0;
  pending.forEach(function (x) {
    var find = function () {
      var hit = null;
      hrRows_().forEach(function (h) { if (!hit && h.name === x.name && h.join === x.join) hit = h; });
      return hit;
    };
    var h0 = find();
    if (!h0) return;
    if (!x.ok) {
      hrWrite_(h0.row, { state: HR_WAIT });
      if (stCol != null) hsh.getRange(h0.row, stCol + 1).setNote('승인 대기 줄이에요. 승인·반려는 사장님 화면 [오늘]에서 해주세요(여기서 근무로 바꿔도 승인돼요).');
      return;
    }
    if (light && approved >= 2) return; // 시트 고침 감지는 30초 제한: 나머지는 다음 맞추기 때(하루 마감·사장님 화면) 이어서 해요
    hrWrite_(h0.row, { state: HR_WAIT });
    var h = find();
    try {
      // 예전에 다닌 같은 이름이 있으면 같은 사람인지 물어봐야 해서, 시트에서는 승인하지 않아요
      if (hrFind_(h.name)) throw new Error('예전에 다닌 같은 이름이 있어요. 같은 사람인지 확인이 필요해서 사장님 화면 [오늘]에서 승인해 주세요.');
      approveJoin_(h);
      approved++;
      var done = hrFind_(x.name);
      if (done && stCol != null) hsh.getRange(done.row, stCol + 1).setNote('');
      n++;
    } catch (err) {
      var back = find();
      if (back && stCol != null) hsh.getRange(back.row, stCol + 1).setNote('승인하지 못했어요: ' + err.message);
    }
  });

  var by = {};
  hrRows_().forEach(function (h) {
    if (h.state === HR_WAIT) return;
    if (!by[h.name] || (by[h.name].state === '퇴사' && h.state !== '퇴사')) by[h.name] = h; // 같은 이름이면 퇴사가 아닌 줄
  });
  var dups = dupNames_();
  var basis = {}, rowsOf = {};
  staff_().forEach(function (p) {
    rowsOf[p.name] = (rowsOf[p.name] || 0) + 1;
    if (!basis[p.name] || (p.active && !basis[p.name].active)) basis[p.name] = p;
  });
  // [직원] 이름을 손으로 고친 건 시트 고침 감지(staffNameEdited_)가 고치기 전 이름을 보고 맞춰요.
  // (여기서 '지운 줄 + 새 줄'을 이름 바꿈으로 짐작하면, 퇴사자 줄을 지우고 신입을 넣었을 때 퇴사자 기록이 신입에게 넘어가요)
  var add = [];
  Object.keys(basis).forEach(function (name) {
    var p = basis[name];
    if (p.name === TEST_NAME || p.name === '예시직원') return; // 테스트·setup 예시 직원은 빼요
    if (dups.indexOf(p.name) >= 0) return; // 근무 중인 같은 이름이 두 줄: 어느 쪽이 맞는지 몰라서 건드리지 않아요(사장님 화면에 알려줘요)
    var h = by[p.name];
    var state = p.active ? '근무' : '퇴사';
    // [직원]에 같은 이름의 퇴사 줄과 근무 줄이 같이 있고 [인사]에는 퇴사 줄만 있어요: 다시 온 같은 사람인지, 이름만 같은 새 사람인지
    // 앱은 알 수 없어요. 예전 사람의 주민번호·계좌가 새 사람 것으로 쓰이지 않게 건드리지 않고 사장님 화면에 알려요(sameAsGone_)
    if (h && h.state === '퇴사' && p.active && (rowsOf[p.name] > 1 || h.enc || h.account)) return; // 예전 줄을 지우고 같은 이름을 새로 넣은 것일 수도 있어요
    if (!h) { add.push({ name: p.name, store: p.store, state: state, first: p.store }); return; } // 예전 퇴사일은 몰라서 비워둬요
    var rec = {};
    if (p.store && h.store !== p.store) {
      if (known[h.store] && known[p.store]) { hrMoved_(p.name, h.store, p.store, now.date, light); h = hrFind_(p.name); }
      else rec.store = p.store;
      if (!h.first) rec.first = p.store;
    }
    if (h.state !== state) {
      rec.state = state;
      if (state === '퇴사' && (!h.end || h.end > now.date)) rec.end = now.date; // 퇴사 예정일보다 먼저 퇴사 처리했으면 오늘로
      if (state === '퇴사') gone.push({ name: p.name, date: rec.end || h.end });
      if (state === '근무' && h.state === '퇴사') {
        rec.moves = addMove_(h.moves, now.date + ' 다시 근무' + (h.end ? '(퇴사 ' + h.end + ')' : ''));
        rec.end = '';
      }
    }
    if (Object.keys(rec).length) { hrWrite_(h.row, rec); n++; }
  });
  if (add.length) {
    // 없는 직원은 한 번에 붙여요
    var sh = sheet_(SHEETS.hr);
    var col = hrCols_();
    var width = Math.max(sh.getLastColumn(), HR_HEAD.length);
    var start = Math.max(sh.getLastRow(), 1) + 1;
    if (start + add.length - 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), add.length + 20);
    var rows = add.map(function (rec) {
      var r = [];
      for (var i = 0; i < width; i++) r.push('');
      Object.keys(rec).forEach(function (k) { if (col[HR_KEY[k]] != null) r[col[HR_KEY[k]]] = rec[k] || ''; });
      return r;
    });
    sh.getRange(start, 1, rows.length, width).setNumberFormat('@').setValues(rows);
    forgetHr_();
  }
  // [직원] 탭 재직 칸을 손으로 '퇴사'로 바꾼 사람: 다음 달 휴무표 줄·남은 요청·점장 칸 정리
  if (gone.length && light) {
    hrTodo_(function (t) { t.retire = (t.retire || []).concat(gone); });
  } else {
    gone.forEach(function (x) {
      try { retireCleanup_(x.name, parseDate_(x.date) || now.date); } catch (err) { console.error(err); }
    });
  }
  return n + add.length;
}

/**
 * [직원] 탭에 같은 이름의 퇴사 줄과 근무 줄이 같이 있는데 [인사]에는 그 이름의 퇴사 줄만 있는 이름들.
 * (다시 온 같은 사람이면 [인사] 상태를 '근무'로, 이름만 같은 다른 사람이면 이름에 구분을 붙여야 해요)
 */
function sameAsGone_() {
  if (!book_().getSheetByName(SHEETS.hr)) return [];
  var n = {}, active = {};
  staff_().forEach(function (p) { n[p.name] = (n[p.name] || 0) + 1; if (p.active) active[p.name] = true; });
  return Object.keys(n).filter(function (name) {
    var h = hrFind_(name);
    return active[name] && h && h.state === '퇴사' && (n[name] > 1 || !!(h.enc || h.account));
  });
}

/**
 * 이름을 바꾼 뒤 다른 탭도 새 이름으로 맞춰요: 모든 휴무표 탭, 출퇴근기록, 요청(요청한 사람·대타), 대체휴무, 근무변경, 의심기록, [매장] 점장 칸.
 * ([직원]·[인사] 탭의 이름은 부르는 쪽에서 먼저 바꿔요.) 바꾼 칸 수를 돌려줘요.
 */
function renameEverywhere_(from, to) {
  var ss = book_(), n = 0;
  if (!from || !to || from === to) return 0;
  var swapCol = function (sh, c, first) { // c: 1부터. 그 칸에서 이름이 from인 칸을 to로
    if (!sh) return;
    var last = sh.getLastRow();
    if (last < first) return;
    var rg = sh.getRange(first, c, last - first + 1, 1);
    var vals = rg.getDisplayValues(), hit = 0;
    vals.forEach(function (r) { if (String(r[0]).trim() === from) { r[0] = to; hit++; } });
    if (hit) { rg.setNumberFormat('@').setValues(vals); n += hit; }
  };
  ss.getSheets().forEach(function (sh) {
    var nm = sh.getName();
    if (!tabYm_(nm)) return;
    try {
      var ym = tabYm_(nm), g = monthGrid_(ym, true);
      if (g && g.rows[from] && g.rows[to]) {
        // 이름을 고친 뒤 맞추기 전에 새 이름으로 찍어서 줄이 둘이 됐어요: 새 줄의 날짜 칸을 옛 줄 빈칸에 옮기고 새 줄을 지워요
        var a = g.rows[from], b = g.rows[to], merged = [];
        for (var d = 0; d < 31; d++) {
          var av = String(a.vals[g.cols.day1 + d] || '').trim(), bv = String(b.vals[g.cols.day1 + d] || '').trim();
          merged.push(av || bv);
        }
        sh.getRange(a.row, g.cols.day1 + 1, 1, 31).setNumberFormat('@').setValues([merged]);
        sh.deleteRow(b.row);
        delete GRID_[ym];
        g = monthGrid_(ym, true);
      }
      if (g && g.rows[from] && !g.rows[to]) {
        sh.getRange(g.rows[from].row, g.cols.name + 1).setNumberFormat('@').setValue(to);
        delete GRID_[ym];
        n++;
      }
    } catch (err) { console.error(err); }
  });
  swapCol(ss.getSheetByName(SHEETS.log), C.name + 1, 2);
  logForget_();
  swapCol(ss.getSheetByName(SHEETS.req), R.name + 1, 2);
  swapCol(ss.getSheetByName(SHEETS.req), R.taker + 1, 2);
  swapCol(ss.getSheetByName(SHEETS.sub), 2, 2);
  swapCol(ss.getSheetByName(SHEETS.change), 2, 2);
  swapCol(ss.getSheetByName(SHEETS.suspect), 2, 2);
  // [공지] 읽음 칸('김민우 11/20 10:05 · …')
  var ns = ss.getSheetByName(NOTICE_TAB);
  if (ns && ns.getLastRow() >= 2) {
    var nrg = ns.getRange(2, 6, ns.getLastRow() - 1, 1), nv = nrg.getDisplayValues(), nhit = 0;
    nv.forEach(function (r) {
      var ch = false;
      var parts = String(r[0] || '').split(' · ').map(function (x) {
        var m = /^(.+) (\d{2}\/\d{2} \d{1,2}:\d{2})$/.exec(x.trim());
        if (m && m[1] === from) { ch = true; return to + ' ' + m[2]; }
        return x;
      });
      if (ch) { r[0] = parts.join(' · '); nhit++; }
    });
    if (nhit) { nrg.setNumberFormat('@').setValues(nv); n += nhit; forgetNotices_(); }
  }
  // [매장] 점장 칸
  var st = ss.getSheetByName(SHEETS.store);
  if (st && st.getLastRow() >= 2) {
    var head = st.getRange(1, 1, 1, Math.max(st.getLastColumn(), 1)).getDisplayValues()[0].map(function (h) { return String(h).trim(); });
    var c = head.indexOf('점장');
    if (c >= 0) {
      stores_().forEach(function (x) {
        if (x.managers.indexOf(from) < 0) return;
        st.getRange(x.row, c + 1).setNumberFormat('@').setValue(x.managers.map(function (m) { return m === from ? to : m; }).join(', '));
        n++;
      });
    }
  }
  var props = PropertiesService.getScriptProperties();
  var pl = hrPlan_();
  if (pl.move[from] || pl.away[from]) {
    hrPlanSave_(function (o) {
      if (o.move[from]) { o.move[to] = o.move[from]; delete o.move[from]; }
      if (o.away[from]) { o.away[to] = o.away[from]; delete o.away[from]; }
    });
  }
  var w = props.getProperty('wishFor:' + from);
  if (w) { props.setProperty('wishFor:' + to, w); props.deleteProperty('wishFor:' + from); }
  ['stores', 'reqs', 'sub', 'changes'].forEach(forget_);
  return n;
}

/**
 * 이름 바꾸기(사장님 화면 인사 카드). 동명이인 구분을 붙이거나 틀린 이름을 고칠 때 써요.
 * [직원]·[인사]와 휴무표·출퇴근기록·요청·대체휴무 등 모든 탭의 이름을 한꺼번에 바꿔요.
 * 그 직원 폰은 예전 이름을 기억하고 있어서, 다음에 열면 이름 목록에서 새 이름을 한 번 다시 골라야 해요.
 */
function adminRename(pin, name, newName) {
  adminAuth_(pin);
  name = String(name == null ? '' : name).trim();
  newName = clean_(newName, 20);
  if (!/^[가-힣A-Za-z][가-힣A-Za-z0-9 ]{0,19}$/.test(newName) || newName === TEST_NAME) throw new Error('이름을 확인해주세요. (한글·영문, 뒤에 숫자·영문 구분을 붙일 수 있어요)');
  if (newName === name) throw new Error('지금 이름과 같아요.');
  var changed = 0;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var h = hrNeedRow_(name);
    if (findStaff_(newName) || hrFind_(newName) || hrFind_(newName, HR_WAIT)) throw new Error(newName + ' 은(는) 이미 있는 이름이에요. 다른 구분을 붙여주세요.');
    var now = nowKst_();
    staff_().forEach(function (p) { if (p.name === name) setStaffCell_(p.row, '이름', newName); });
    hrWrite_(h.row, { name: newName, moves: addMove_(h.moves, now.date + ' 이름 바꿈(' + name + ' → ' + newName + ')') });
    changed = renameEverywhere_(name, newName);
  } finally {
    lock.releaseLock();
  }
  var card = hrCard_(hrNeedRow_(newName));
  card.note = '이름을 ' + newName + '(으)로 바꿨어요(다른 탭 ' + changed + '칸도 같이). 그 직원 폰에서는 이름 목록에서 새 이름을 한 번 다시 골라야 해요.';
  return card;
}

/** 지점이 바뀐 뒤: [인사] 지점·이동 기록, 이번 달·다음 달 휴무표에서 새 지점 묶음으로 줄 옮기기. */
function hrMoved_(name, from, to, date, light) {
  var h = hrFind_(name);
  var text = date + ' ' + (from || '?') + '→' + to;
  if (h) hrWrite_(h.row, { store: to, moves: addMove_(h.moves, text), first: h.first || from || to });
  else hrWrite_(0, { name: name, store: to, state: '근무', first: from || to, moves: from ? text : '' });
  if (light) {
    // 시트를 손으로 고쳤을 때: 휴무표 줄 옮기기·칠하기는 오래 걸려서 10분 검사로 넘겨요(여러 줄을 붙여넣어도 30초 안에 끝나게)
    hrTodo_(function (t) { t.labels = true; });
  } else {
    var now = nowKst_();
    [now.ym, nextYm_(now.ym)].forEach(function (ym) { moveMonthRow_(ym, name, to, text); });
  }
  return from ? dropManager_(name, from) : []; // 옮기기 전 매장의 점장이었으면 점장 칸에서 빼요
}

/** 휴무표 한 달 탭에서 그 직원 줄을 새 지점 묶음 마지막 줄 아래로 옮기고, 매장 칸에 메모를 남겨요. */
function moveMonthRow_(ym, name, store, note) {
  var g = monthGrid_(ym, true);
  if (!g || !g.rows[name]) return false;
  var sh = g.sh, from = g.rows[name].row;
  var order = {};
  stores_().forEach(function (st, i) { order[st.name] = i; });
  var idx = function (st) { return order[st] == null ? 999 : order[st]; };
  var after = 2;
  Object.keys(g.rows).forEach(function (n) {
    var r = g.rows[n];
    if (n !== name && idx(String(r.vals[g.cols.store] || '').trim()) <= idx(store) && r.row > after) after = r.row;
  });
  var dest = after + 1, at = from;
  if (dest !== from && dest !== from + 1) {
    sh.moveRows(sh.getRange(from, 1, 1, sh.getMaxColumns()), dest);
    at = dest > from ? dest - 1 : dest;
  }
  sh.getRange(at, g.cols.store + 1).setValue(store).setNote(note);
  delete GRID_[ym];
  paintMonth_(sh, ym, monthGrid_(ym, true).cols);
  return true;
}

/**
 * [직원] 탭 이름 칸 한 칸을 손으로 고쳤을 때(오타 고치기·구분 붙이기): 고치기 전 이름의 [인사] 줄 이름을 바꾸고,
 * 다른 탭(휴무표·기록·요청 등)은 10분 검사가 바꿔요. 여러 칸을 붙여넣었거나 고치기 전 이름을 모르면 아무것도 안 해요.
 */
function staffNameEdited_(rg, oldValue) {
  if (rg.getNumRows() !== 1 || rg.getNumColumns() !== 1 || rg.getRow() < 2) return;
  var c = staffCols_()['이름'];
  if (c == null || rg.getColumn() !== c + 1) return;
  var from = String(oldValue == null ? '' : oldValue).trim(), to = String(rg.getDisplayValue() || '').trim();
  if (!from || !to || from === to || to === TEST_NAME) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    forget_('staff');
    forgetHr_();
    var h = hrFind_(from);
    if (!h || hrFind_(to) || staff_().filter(function (q) { return q.name === from; }).length) return; // 같은 이름이 아직 [직원]에 있으면 이름 바꿈이 아니에요
    var edited = staff_().filter(function (q) { return q.row === rg.getRow(); })[0];
    if (h.state === '퇴사' || (edited && !edited.active)) return; // 퇴사자 줄을 새 사람에게 다시 쓴 거예요(퇴사자 기록이 넘어가지 않게)
    hrWrite_(h.row, { name: to, moves: addMove_(h.moves, nowKst_().date + ' 이름 바꿈(' + from + ' → ' + to + ')') });
    hrTodo_(function (t) { (t.rename = t.rename || []).push({ from: from, to: to }); });
  } finally {
    lock.releaseLock();
  }
}

/** [직원]·[인사] 탭을 손으로 고쳤을 때(onEdit). 고친 줄들을 바로 맞추고, 나머지는 하루 마감 때 맞춰요. */
function hrEdited_(sh, rg) {
  if (rg.getRow() + rg.getNumRows() - 1 < 2) return;
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return;
  try {
    if (sh.getName() === SHEETS.hr) hrSheetEdited_(rg);
    syncHr_({ light: true }); // 무거운 정리(휴무표 줄 옮기기 등)는 10분 검사로 넘겨요
  } finally {
    lock.releaseLock();
  }
}

/**
 * [인사] 탭에서 지점·상태 칸을 손으로 고쳤을 때: 고친 줄마다 **[인사]에 적은 대로** [직원]·휴무표를 맞춰요.
 * 여러 줄을 한꺼번에 붙여넣거나 끌어서 채워도 돼요. 시트 고침 감지는 30초 안에 끝나야 해서 한 번에 10명까지만 하고,
 * 넘는 줄은 원래대로 되돌린 뒤 알려줘요.
 */
function hrSheetEdited_(rg) {
  var col = hrCols_();
  var c0 = rg.getColumn() - 1, c1 = c0 + rg.getNumColumns() - 1;
  var hit = function (k) { return col[k] != null && col[k] >= c0 && col[k] <= c1; };
  var storeHit = hit(HR_KEY.store), stateHit = hit(HR_KEY.state);
  var r0 = Math.max(rg.getRow(), 2), r1 = rg.getRow() + rg.getNumRows() - 1;
  if (hit(HR_KEY.name) && r0 === r1) {
    // 이름 칸 한 줄을 고쳤어요(오타 고치기·구분 붙이기): [직원]에서 [인사]에 없는 근무 직원이 같은 지점에 딱 한 명이면 그 사람으로 보고 이름을 맞춰요
    var edited = null;
    hrRows_().forEach(function (x) { if (x.row === r0) edited = x; });
    if (edited && edited.state !== HR_WAIT && !edited.join && !findStaff_(edited.name)) {
      var names = {};
      hrRows_().forEach(function (x) { names[x.name] = true; });
      var lost = staff_().filter(function (q) { return q.active && !names[q.name] && q.store === edited.store && q.name !== TEST_NAME; });
      if (lost.length === 1) {
        var oldName = lost[0].name;
        setStaffCell_(lost[0].row, '이름', edited.name);
        hrWrite_(edited.row, { moves: addMove_(edited.moves, nowKst_().date + ' 이름 바꿈(' + oldName + ' → ' + edited.name + ')') });
        hrTodo_(function (t) { (t.rename = t.rename || []).push({ from: oldName, to: edited.name }); });
      }
    }
  }
  if (!storeHit && !stateHit) return;
  var now = nowKst_(), done = 0, skipped = 0, badStore = [];
  var dups = dupNames_();
  var targets = hrRows_().filter(function (h) { return h.row >= r0 && h.row <= r1 && h.state !== HR_WAIT && !h.join; })
    .map(function (h) { return h.row; });
  // [직원]은 처음에 한 번만 읽어 둬요(줄마다 다시 읽으면 여러 줄 붙여넣기가 30초를 넘겨요)
  var staffOf = {};
  targets.forEach(function (row) {
    hrRows_().forEach(function (x) { if (x.row === row && !(x.name in staffOf)) staffOf[x.name] = findStaff_(x.name); });
  });
  targets.forEach(function (row) {
    var h = null;
    hrRows_().forEach(function (x) { if (x.row === row) h = x; });
    var p = h ? staffOf[h.name] : null;
    if (!p || dups.indexOf(h.name) >= 0) return;
    var storeDiff = storeHit && !!h.store && h.store !== p.store;
    var want = /퇴사/.test(h.state) ? '퇴사' : /근무/.test(h.state) ? '근무' : '';
    var stateDiff = stateHit && !!want && (want === '퇴사') === p.active;
    if (!storeDiff && !stateDiff) return;
    if (done >= 10) {
      var back = {};
      if (storeDiff) back.store = p.store;
      if (stateDiff) back.state = p.active ? '근무' : '퇴사';
      hrWrite_(h.row, back);
      skipped++;
      return;
    }
    done++;
    if (storeDiff) {
      if (storeOf_(h.store)) {
        var from = p.store;
        setStaffCell_(p.row, '매장', h.store);
        hrMoved_(p.name, from, h.store, now.date, true); // 휴무표 줄은 10분 검사가 옮겨요
      } else {
        badStore.push(h.store);
        hrWrite_(h.row, { store: p.store }); // [매장] 탭에 없는 지점 이름은 되돌려요
      }
    }
    if (stateDiff && want === '퇴사') {
      var endDay = h.end && parseDate_(h.end) && parseDate_(h.end) <= now.date ? parseDate_(h.end) : now.date;
      setStaffCell_(p.row, '재직', '퇴사');
      hrWrite_(h.row, { state: '퇴사', end: endDay });
      hrTodo_(function (t) { (t.retire = t.retire || []).push({ name: p.name, date: endDay }); }); // 뒷정리는 10분 검사가 해요
    } else if (stateDiff) {
      setStaffCell_(p.row, '재직', '');
      hrWrite_(h.row, { state: '근무', end: '', moves: addMove_(h.moves, now.date + ' 다시 근무' + (h.end ? '(퇴사 ' + h.end + ')' : '')) });
      hrTodo_(function (t) { t.labels = true; }); // 휴무표 줄은 10분 검사가 넣어요
    }
  });
  var msg = [];
  if (skipped) msg.push('한 번에 10명까지만 바꿀 수 있어요. 나머지 ' + skipped + '명은 되돌렸어요. 다시 바꿔 주세요.');
  if (badStore.length) msg.push('[매장] 탭에 없는 지점 이름(' + badStore.join(', ') + ')은 되돌렸어요.');
  if (msg.length) { try { book_().toast(msg.join(' '), '출퇴근', 10); } catch (err) { /* 알림을 못 띄워도 괜찮아요 */ } }
}

/** 입사 등록·내 정보 칸 확인. full=true(입사 등록)면 이름·지점·주민번호까지 꼭. */
function hrForm_(f, full, later) {
  var t = function (k, max) { return String(f[k] == null ? '' : f[k]).replace(/\s+/g, ' ').trim().slice(0, max); };
  var d = {
    name: t('name', 20), store: t('store', 30), rrn: rrnParse_(f.rrn), phone: phoneOf_(f.phone),
    addr: t('addr', 120), bank: t('bank', 20), account: String(f.account == null ? '' : f.account).replace(/[^\d-]/g, '').slice(0, 30),
    holder: t('holder', 20), emergency: t('emergency', 60), start: parseDate_(t('start', 20)),
  };
  d.phone2 = phones2_(f.phone2, d.phone);
  if (full) {
    if (!/^[가-힣A-Za-z][가-힣A-Za-z0-9 ]{0,19}$/.test(d.name)) throw new Error('이름을 확인해주세요. (한글·영문)');
    if (!storeOf_(d.store)) throw new Error('근무 지점을 골라주세요.');
    if (!d.rrn) throw new Error('주민등록번호를 확인해주세요. (앞 6자리 - 뒤 7자리)');
  } else if (String(f.rrn == null ? '' : f.rrn).trim() && !d.rrn) {
    throw new Error('주민등록번호를 확인해주세요. (앞 6자리 - 뒤 7자리)');
  }
  if (!d.phone) throw new Error('휴대폰 번호를 확인해주세요. (010-0000-0000)');
  if (!d.addr) throw new Error('주소를 넣어주세요.');
  if (String(d.emergency || '').replace(/\D/g, '').length < 9) throw new Error('비상연락처(가족 등 급할 때 연락할 사람의 전화번호)를 넣어주세요.');
  // later: 입사 등록 때 '계좌는 나중에'(통장이 지금 없을 때). 비워서 보내면 승인 뒤 '인사 정보를 입력해 주세요' 안내가 계속 떠요
  var noAccount = !d.bank && !d.account;
  if (!(later && noAccount) && (!d.bank || d.account.replace(/\D/g, '').length < 8)) throw new Error('급여 받을 은행과 계좌번호를 넣어주세요.');
  return d;
}

/**
 * 추가 휴대폰(2개까지). v: 글자('010-1111-2222 업무용, 010-3333-4444') 또는 그런 글자들의 배열.
 * '010-1111-2222 업무용, 010-3333-4444' 모양으로 돌려줘요. 번호가 이상하면 알려줘요. 대표 번호와 같은 번호·겹친 번호는 빼요.
 */
function phones2_(v, main) {
  var parts = [];
  [].concat(v == null ? [] : v).forEach(function (x) { String(x == null ? '' : x).split(/[,\n]+/).forEach(function (y) { parts.push(y); }); });
  var out = [], seen = {};
  if (main) seen[main] = true;
  parts.forEach(function (raw) {
    var t = String(raw).replace(/\s+/g, ' ').trim();
    if (!t) return;
    var m = /(?:\+?82[\s.-]?)?0?1[016789](?:[\s.-]?\d){7,8}/.exec(t);
    var num = m ? phoneOf_(m[0]) : '';
    if (!num) throw new Error('추가 휴대폰 번호를 확인해주세요. (010-0000-0000) : ' + t.slice(0, 20));
    if (seen[num]) return;
    seen[num] = true;
    var memo = t.replace(m[0], ' ').replace(/[()\[\]{}<>:;·]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 10);
    out.push(num + (memo ? ' ' + memo : ''));
  });
  if (out.length > 2) throw new Error('추가 휴대폰은 2개까지 넣을 수 있어요.');
  return out.join(', ');
}

/** [인사] 휴대폰2 칸 → [{num, memo}] (손으로 적은 이상한 값은 건너뛰어요). */
function phones2List_(s) {
  var out = [];
  String(s == null ? '' : s).split(/[,\n]+/).forEach(function (t) {
    var m = /(?:\+?82[\s.-]?)?0?1[016789](?:[\s.-]?\d){7,8}/.exec(t);
    var num = m ? phoneOf_(m[0]) : '';
    if (num) out.push({ num: num, memo: t.replace(m[0], ' ').replace(/\s+/g, ' ').trim() });
  });
  return out;
}

/** 휴대폰 번호 '010-1234-5678'. 아니면 ''. (+82 10-…도 받아요) */
function phoneOf_(s) {
  var d = String(s == null ? '' : s).replace(/\D/g, '');
  if (/^82(0?1\d{8,9})$/.test(d)) d = d.replace(/^820?/, '0'); // +82 10-1234-5678 → 010-1234-5678
  if (!/^01\d{8,9}$/.test(d) || (d.slice(0, 3) === '010' && d.length !== 11)) return ''; // 010은 11자리만
  return d.length === 11 ? d.slice(0, 3) + '-' + d.slice(3, 7) + '-' + d.slice(7) : d.slice(0, 3) + '-' + d.slice(3, 6) + '-' + d.slice(6);
}

/** 주민(외국인)등록번호 13자리. 앞 6자리는 있는 날짜, 7번째는 1~8(3·4·7·8은 2000년대). 아니면 ''. */
function rrnParse_(s) {
  var d = String(s == null ? '' : s).replace(/[\s-]/g, '');
  if (!/^\d{13}$/.test(d)) return '';
  var g = Number(d.charAt(6));
  if (g < 1 || g > 8) return '';
  var y = (g === 3 || g === 4 || g === 7 || g === 8 ? 2000 : 1900) + Number(d.slice(0, 2));
  var date = y + '-' + d.slice(2, 4) + '-' + d.slice(4, 6);
  return parseDate_(date) === date ? d : '';
}

function rrnMask_(d) { return d ? d.slice(0, 6) + '-' + d.charAt(6) + '******' : ''; }

/** '950101-1******'(가린 번호)나 13자리에서 생년월일 6자리 '950101'(연락처 이름에 붙여요). 모르면 ''. */
function birth6_(s) {
  var m = /^(\d{6})-?[1-8]/.exec(String(s == null ? '' : s).trim());
  return m ? m[1] : '';
}

/** '950101-1******'(가린 번호)나 13자리에서 '95년생'. 모르면 ''. */
function birthLabel_(s) {
  var m = /^(\d{2})\d{4}-?[1-8]/.exec(String(s == null ? '' : s).trim());
  return m ? m[1] + '년생' : '';
}

/* ── 주민번호 암호화: AES-256-CTR + HMAC-SHA256. 열쇠(32바이트)는 스크립트 속성 hrKey에만 있어요 ── */

/**
 * 열쇠. create=true면 없을 때 새로 만들어요(setup, 처음 저장할 때). 열쇠를 잃으면 주민번호를 다시 받아야 해요.
 * 단, 열쇠가 없는데 [인사]에 암호로 저장된 번호가 있으면 새로 만들지 않고 멈춰요(만들면 그 번호들을 영영 못 풀어요).
 * fresh=true는 사장님이 시트 메뉴에서 '새로 시작'을 골랐을 때만.
 */
function hrKey_(create, fresh) {
  var props = PropertiesService.getScriptProperties();
  var k = props.getProperty('hrKey');
  if (!k && create) {
    if (!fresh && hrEncCount_()) throw new Error('주민번호 열쇠가 없어서 지금은 주민번호를 저장할 수 없어요. 사장님이 시트 메뉴 ' + HR_KEY_MENU + '에서 열쇠를 되살려야 해요.');
    var seed = Utilities.getUuid() + Utilities.getUuid() + Date.now() + Math.random();
    k = Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, seed));
    props.setProperty('hrKey', k);
  }
  return k ? u8_(Utilities.base64Decode(k)) : null;
}

function rrnEncrypt_(digits, key) {
  var k = key || hrKey_(true); // key: 열쇠를 되살릴 때 그 열쇠로 다시 암호화
  var iv = hexBytes_(Utilities.getUuid().replace(/-/g, '')).slice(0, 16);
  var ct = aesCtr_(hmac_(k, 'enc'), iv, asciiBytes_(digits));
  var tag = hmac_(hmac_(k, 'mac'), iv.concat(ct)).slice(0, 16);
  return 'enc1:' + Utilities.base64Encode(s8_(iv.concat(ct, tag)));
}

function rrnDecrypt_(s, key) {
  var m = /^enc1:([A-Za-z0-9+\/=]+)$/.exec(String(s == null ? '' : s).trim());
  if (!m) throw new Error('주민번호 암호 칸이 비었거나 모양이 달라요.');
  var k = key || hrKey_(false); // key: 붙여넣은 열쇠가 맞는지 볼 때
  if (!k) throw new Error('주민번호 열쇠가 없어요(스크립트를 새로 만들었나요?). 시트 메뉴 ' + HR_KEY_MENU + '에서 백업해 둔 열쇠를 되살려 주세요.');
  var b = u8_(Utilities.base64Decode(m[1]));
  var iv = b.slice(0, 16), ct = b.slice(16, b.length - 16), tag = b.slice(b.length - 16);
  var want = hmac_(hmac_(k, 'mac'), iv.concat(ct)).slice(0, 16), diff = ct.length ? 0 : 1;
  for (var i = 0; i < 16; i++) diff |= want[i] ^ tag[i];
  if (diff) throw new Error('주민번호를 풀 수 없어요(열쇠가 바뀌었거나 칸이 고쳐졌어요). 직원에게 다시 받아주세요.');
  return String.fromCharCode.apply(null, aesCtr_(hmac_(k, 'enc'), iv, ct));
}

function hmac_(key, data) {
  var d = typeof data === 'string' ? s8_(asciiBytes_(data)) : s8_(data);
  return u8_(Utilities.computeHmacSha256Signature(d, s8_(key)));
}
function u8_(a) { var o = []; for (var i = 0; i < a.length; i++) o.push(a[i] & 0xff); return o; }
function s8_(a) { var o = []; for (var i = 0; i < a.length; i++) o.push(a[i] > 127 ? a[i] - 256 : a[i]); return o; }
function asciiBytes_(s) { var o = []; for (var i = 0; i < s.length; i++) o.push(s.charCodeAt(i) & 0xff); return o; }
function hexBytes_(h) { var o = []; for (var i = 0; i + 1 < h.length; i += 2) o.push(parseInt(h.substr(i, 2), 16)); return o; }

var AES_SBOX_ = null;
function aesSbox_() {
  if (AES_SBOX_) return AES_SBOX_;
  var s = [], p = 1, q = 1;
  var rot = function (x, k) { return ((x << k) | (x >>> (8 - k))) & 0xff; };
  do {
    p = (p ^ (p << 1) ^ (p & 0x80 ? 0x1b : 0)) & 0xff; // p × 3
    q = (q ^ (q << 1)) & 0xff; q = (q ^ (q << 2)) & 0xff; q = (q ^ (q << 4)) & 0xff; // q ÷ 3
    if (q & 0x80) q ^= 0x09;
    s[p] = (q ^ rot(q, 1) ^ rot(q, 2) ^ rot(q, 3) ^ rot(q, 4) ^ 0x63) & 0xff;
  } while (p !== 1);
  s[0] = 0x63;
  AES_SBOX_ = s;
  return s;
}

function aesXtime_(a) { return ((a << 1) ^ (a & 0x80 ? 0x1b : 0)) & 0xff; }

/** AES-256 열쇠 늘리기: 32바이트 → 240바이트(라운드 열쇠 15개). */
function aesKeys_(key) {
  var s = aesSbox_(), w = key.slice(0, 32), rcon = 1;
  for (var i = 32; i < 240; i += 4) {
    var t = [w[i - 4], w[i - 3], w[i - 2], w[i - 1]];
    if (i % 32 === 0) {
      t = [s[t[1]] ^ rcon, s[t[2]], s[t[3]], s[t[0]]];
      rcon = aesXtime_(rcon);
    } else if (i % 32 === 16) {
      t = [s[t[0]], s[t[1]], s[t[2]], s[t[3]]];
    }
    for (var j = 0; j < 4; j++) w[i + j] = w[i - 32 + j] ^ t[j];
  }
  return w;
}

/** AES 한 블록(16바이트) 암호화. */
function aesBlock_(w, b) {
  var s = aesSbox_(), st = [], i, c, r;
  for (i = 0; i < 16; i++) st[i] = b[i] ^ w[i];
  for (r = 1; r <= 14; r++) {
    var t = [];
    for (c = 0; c < 4; c++) for (i = 0; i < 4; i++) t[c * 4 + i] = s[st[((c + i) % 4) * 4 + i]]; // SubBytes + ShiftRows
    if (r < 14) {
      for (c = 0; c < 16; c += 4) { // MixColumns
        var a0 = t[c], a1 = t[c + 1], a2 = t[c + 2], a3 = t[c + 3], x = a0 ^ a1 ^ a2 ^ a3;
        t[c] ^= x ^ aesXtime_(a0 ^ a1);
        t[c + 1] ^= x ^ aesXtime_(a1 ^ a2);
        t[c + 2] ^= x ^ aesXtime_(a2 ^ a3);
        t[c + 3] ^= x ^ aesXtime_(a3 ^ a0);
      }
    }
    for (i = 0; i < 16; i++) st[i] = t[i] ^ w[r * 16 + i];
  }
  return st;
}

/** AES-256-CTR(16바이트 카운터를 큰 쪽부터 1씩). 암호화·풀기가 같아요. */
function aesCtr_(key, iv, data) {
  var w = aesKeys_(u8_(key)), ctr = u8_(iv).slice(0, 16), out = [], ks = null;
  for (var i = 0; i < data.length; i++) {
    if (i % 16 === 0) {
      ks = aesBlock_(w, ctr);
      for (var j = 15; j >= 0; j--) { ctr[j] = (ctr[j] + 1) & 0xff; if (ctr[j]) break; }
    }
    out.push((data[i] ^ ks[i % 16]) & 0xff);
  }
  return out;
}

/* ───────────── 기록 지키기: 주민번호 열쇠 백업·되살리기, 매주 드라이브 백업, 사장님 화면 알림 ───────────── */
/*
 * 1) 주민번호 열쇠(스크립트 속성 hrKey)는 시트에 없어서, Apps Script를 새로 만들거나 사본 파일을 쓰면 없어요.
 *    - 열쇠가 없는데 [인사]에 암호로 저장된 번호가 있으면 setup·저장이 새 열쇠를 만들지 않고 멈춰요(hrKey_, hrKeyGuard_)
 *    - 시트 메뉴 '주민번호 열쇠 백업·되살리기'(menuHrKey): 관리자 비밀번호를 물은 뒤 지금 열쇠를 보여주고(시트 밖에 적어 두게),
 *      백업해 둔 열쇠를 붙여넣으면 저장된 번호로 맞는지 확인하고 되살려요. 끝내 못 찾으면 '새로 시작'
 *    - 10분 자동 실행: 열쇠가 없어졌으면 사장님께 하루 한 번 알려요
 * 2) 매주 백업: 새벽 3~6시에 한 번(ISO 주마다) 시트 전체를 드라이브 [출퇴근 백업] 폴더에 사본으로. 앱이 만든 것은 최근 8개만 남겨요
 * 3) 알림: 처음 보는 폰이 사장님 화면에 들어오면, 주민번호 전체 보기를 쓰면 사장님 텔레그램으로
 */
var HR_KEY_MENU = '출퇴근 → 주민번호 열쇠 백업·되살리기'; // 안내 글에 쓰는 메뉴 위치

/** [인사] 탭에서 주민번호가 암호로 저장된 줄(승인 대기·퇴사 줄도). */
function hrEncRows_() {
  if (!book_().getSheetByName(SHEETS.hr)) return [];
  return hrRows_().filter(function (h) { return /^enc1:/.test(h.enc); });
}
function hrEncCount_() { return hrEncRows_().length; }

/** 열쇠가 없는데 암호로 저장된 번호가 있으면 그 수(열쇠를 잃었어요). 아니면 0. */
function hrKeyLost_() {
  if (PropertiesService.getScriptProperties().getProperty('hrKey')) return 0;
  return hrEncCount_();
}

/** setup 첫머리: 열쇠를 잃었으면 멈추고 되살리는 법을 알려요(새 열쇠를 만들면 저장된 번호를 영영 못 풀어요). */
function hrKeyGuard_() {
  var n = hrKeyLost_();
  forgetHr_();
  forget_('hrCols');
  if (!n) return;
  throw new Error('setup을 멈췄어요. 주민번호 열쇠가 없어요. [인사] 탭에 암호로 저장된 주민번호가 ' + n + '명 있는데, 새 열쇠를 만들면 이 번호들을 영영 못 풀어요.\n' +
    '시트 메뉴 ' + HR_KEY_MENU + '에서 백업해 둔 열쇠를 붙여넣은 뒤 setup을 다시 실행해 주세요. 이 파일이 사본이면 원본 시트의 같은 메뉴에서 열쇠를 볼 수 있어요.');
}

/** 10분 자동 실행: 열쇠를 잃었으면 사장님께 하루 한 번 알려요(그동안 주민번호를 보거나 새로 저장할 수 없어요). */
function hrKeyWatch_(set, now) {
  var n = hrKeyLost_();
  if (!n) return false;
  if (now.min < 7 * 60 || now.min >= 23 * 60) return false; // 밤에는 안 울려요(아침 7시 뒤 첫 실행에 알려요)
  var props = PropertiesService.getScriptProperties(), k = 'dm:' + now.date + ':hrkey';
  if (props.getProperty(k)) return false;
  props.setProperty(k, '1');
  notify_(set, '주민번호 열쇠가 없어요', '[인사] 탭에 암호로 저장된 주민번호가 ' + n + '명 있는데 풀 열쇠가 없어요. 지금은 주민번호를 보거나 새로 저장할 수 없어요(신입 입사 등록도 막혀요).\n' +
    '시트 메뉴 ' + HR_KEY_MENU + '에서 백업해 둔 열쇠를 붙여넣어 주세요.');
  return true;
}

/** 붙여넣은 열쇠 글자 → {raw, bytes}(띄어쓰기·줄바꿈은 빼요). 모양이 틀리면 null. */
function hrKeyParse_(text) {
  var raw = String(text == null ? '' : text).replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+\/]{43}=$/.test(raw)) return null;
  var b = u8_(Utilities.base64Decode(raw));
  return b.length === 32 ? { raw: raw, bytes: b } : null;
}

/** 그 열쇠로 풀리면 13자리, 아니면 ''. */
function rrnTry_(enc, key) {
  try { return rrnDecrypt_(enc, key); } catch (err) { return ''; }
}

/** 메뉴에 보여줄 열쇠 상태: {key: 열쇠 글자('' = 없음), count: 암호로 저장된 수, open: 지금 열쇠로 풀리는 수} */
function hrKeyInfo_() {
  var raw = PropertiesService.getScriptProperties().getProperty('hrKey') || '';
  var rows = hrEncRows_(), key = raw ? u8_(Utilities.base64Decode(raw)) : null, open = 0;
  if (key) rows.forEach(function (h) { if (rrnTry_(h.enc, key)) open++; });
  return { key: raw, count: rows.length, open: open };
}

/**
 * 백업해 둔 열쇠 되살리기. 저장된 암호가 이 열쇠로 하나라도 풀려야 넣어요(엉뚱한 열쇠로 덮어써서 모두 못 풀게 되지 않게).
 * 지금 열쇠로만 풀리는 번호('새로 시작' 뒤에 받은 번호)는 되살린 열쇠로 다시 암호화해서 하나도 잃지 않아요.
 * 돌려주는 값: {ok, msg, open: 풀리는 수, moved: 다시 암호화한 수, lost: 어느 열쇠로도 안 풀리는 수}
 */
function hrKeyRestore_(text) {
  var key = hrKeyParse_(text);
  if (!key) return { ok: false, msg: '열쇠 모양이 아니에요. 열쇠는 영어·숫자로 된 44글자이고 끝이 = 예요. 빠진 글자 없이 그대로 붙여넣어 주세요.' };
  var props = PropertiesService.getScriptProperties();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000); // 그사이 직원이 주민번호를 저장하지 않게
  try {
    var curRaw = props.getProperty('hrKey') || '';
    if (curRaw === key.raw) return { ok: true, same: true, msg: '지금 쓰는 열쇠와 같아요. 잘 적어 두셨어요.' };
    var cur = curRaw ? u8_(Utilities.base64Decode(curRaw)) : null;
    forgetHr_();
    var rows = hrEncRows_(), open = 0, lost = 0, moved = [];
    // 저장된 번호가 없으면 맞는 열쇠인지 알 수 없어요. 지금 열쇠가 있으면 바꾸지 않아요(적어 둔 열쇠를 확인하다 잘못 적은 걸로 바뀌지 않게)
    if (!rows.length && curRaw) return { ok: false, msg: '지금 쓰는 열쇠와 달라요. 아직 저장된 주민번호가 없어서 바꾸지 않았어요. 위에 보이는 지금 열쇠를 다시 적어 두세요.' };
    rows.forEach(function (h) {
      if (rrnTry_(h.enc, key.bytes)) { open++; return; }
      var d = cur ? rrnTry_(h.enc, cur) : '';
      if (d) moved.push({ row: h.row, enc: rrnEncrypt_(d, key.bytes) });
      else lost++;
    });
    if (rows.length && !open) return { ok: false, msg: '이 열쇠로는 저장된 주민번호를 하나도 풀 수 없어요. 다른 열쇠인지, 빠진 글자가 없는지 확인해 주세요. (열쇠는 그대로 뒀어요)' };
    moved.forEach(function (m) { hrWrite_(m.row, { enc: m.enc }); }); // 먼저 다시 암호화하고
    props.setProperty('hrKey', key.raw); // 그다음 열쇠를 바꿔요
    forgetHr_();
  } finally {
    lock.releaseLock();
  }
  logSuspect_('(시트 메뉴)', '주민번호 열쇠 되살림', '풀림 ' + (open + moved.length) + '명' + (lost ? ' · 못 풂 ' + lost + '명' : ''));
  var msg = '열쇠를 되살렸어요. ' + (rows.length ? '저장된 주민번호 ' + (open + moved.length) + '명을 다시 볼 수 있어요.' : '아직 저장된 주민번호가 없어서 맞는 열쇠인지는 확인하지 못했어요.');
  if (moved.length) msg += ' (그중 ' + moved.length + '명은 지금 열쇠로 저장돼 있어서 되살린 열쇠로 다시 저장했어요)';
  if (lost) msg += '\n' + lost + '명은 이 열쇠로도 안 풀려요. 그 직원들에게 주민번호를 다시 받아 주세요.';
  if (!curRaw) msg += '\n이제 시트 메뉴 출퇴근 → setup 실행을 다시 눌러 주세요.';
  return { ok: true, msg: msg, open: open + moved.length, moved: moved.length, lost: lost };
}

/** 열쇠를 끝내 못 찾았을 때 '새로 시작': 새 열쇠를 만들어요. 예전 열쇠로 저장된 번호(그 수를 돌려줘요)는 못 풀어서 직원에게 다시 받아야 해요. */
function hrKeyFresh_() {
  if (PropertiesService.getScriptProperties().getProperty('hrKey')) return 0; // 열쇠가 있으면 아무것도 안 해요
  var n = hrEncCount_();
  hrKey_(true, true);
  logSuspect_('(시트 메뉴)', '주민번호 열쇠 새로 만듦', '예전 열쇠로 저장된 ' + n + '명은 못 풀어요');
  return n;
}

function hrKeyShowText_(info, canPaste) {
  return '지금 쓰는 주민번호 열쇠예요. 아래 44글자를 빠짐없이 복사해서 시트 밖 안전한 곳에 보관해 두세요(비밀번호 관리 앱, 사장님만 보는 메모, 종이 등).\n\n' +
    info.key + '\n\n' +
    '· 이 열쇠가 있어야 저장된 주민번호(' + info.open + '명)를 볼 수 있어요. Apps Script를 새로 만들거나 사본·백업 파일을 쓰게 되면 이 열쇠를 넣어야 해요.\n' +
    (info.count > info.open ? '· ' + (info.count - info.open) + '명은 이 열쇠로 안 풀려요. 그 직원들에게 주민번호를 다시 받아 주세요.\n' : '') +
    '· 시트 안이나 단톡방처럼 다른 사람도 보는 곳에는 적지 마세요. 시트와 열쇠를 같이 가진 사람은 주민번호를 모두 볼 수 있어요.' +
    (canPaste ? '\n\n적어 둔 열쇠가 맞는지 볼 때나 열쇠를 되살릴 때는 아래 칸에 붙여넣고 [확인]을 누르세요(맞게 적었으면 "지금 쓰는 열쇠와 같아요"가 나와요). 다 적었으면 [취소]를 눌러 닫으세요.' : '');
}

function hrKeyLostText_(info) {
  return '주민번호 열쇠가 없어요. 그래서 저장된 주민번호 ' + info.count + '명을 지금은 볼 수 없고, 새 주민번호도 저장할 수 없어요(setup도 멈춰요).\n\n' +
    '백업해 둔 열쇠(44글자)를 아래 칸에 붙여넣고 [확인]을 누르세요. 저장된 번호로 맞는 열쇠인지 확인한 뒤에 넣어요.\n' +
    '· 이 파일이 사본·백업이면 원본 시트의 같은 메뉴에서 열쇠를 볼 수 있어요.\n' +
    '· 예전 Apps Script 프로젝트가 남아 있으면 그 프로젝트 설정(톱니바퀴) → 스크립트 속성의 hrKey 값이 열쇠예요.\n\n' +
    '끝내 못 찾으면 아래 칸에 새로 시작 이라고 적으세요. 새 열쇠를 만들고, 이미 받은 주민번호는 직원들에게 다시 받아야 해요.';
}

/**
 * 시트 메뉴 '주민번호 열쇠 백업·되살리기'(웹 화면에서는 안 돌아요).
 *  - 관리자 비밀번호를 한 번 더 물은 뒤 지금 열쇠를 보여줘요(시트 밖 안전한 곳에 적어 두게)
 *  - 백업해 둔 열쇠를 붙여넣으면 저장된 번호로 맞는지 확인하고 되살려요
 *  - 열쇠가 없고 끝내 못 찾으면 '새로 시작'(새 열쇠. 예전 번호는 직원에게 다시 받아요)
 * 무엇을 했는지 돌려줘요: 'shown' | 'restored' | 'same' | 'bad' | 'fresh' | 'wrong' | 'cancel' | 'nopin'
 */
function menuHrKey() {
  var ui = SpreadsheetApp.getUi(); // 시트 메뉴에서만(웹 화면에서 부르면 여기서 멈춰요)
  if (!ownerRun_()) throw new Error('주민번호 열쇠는 시트 메뉴에서만 볼 수 있어요.');
  var title = '주민번호 열쇠 백업·되살리기';
  var set = settings_();
  if (!set.adminPin) { ui.alert(title, '먼저 [설정] 탭에 관리자PIN을 넣어 주세요.', ui.ButtonSet.OK); return 'nopin'; }
  var p = ui.prompt(title, '주민번호 열쇠는 사장님만 봐야 해요. 관리자 비밀번호를 넣어 주세요.', ui.ButtonSet.OK_CANCEL);
  if (p.getSelectedButton() !== ui.Button.OK) return 'cancel';
  if (String(p.getResponseText() || '').trim() !== set.adminPin) {
    logSuspect_('(시트 메뉴)', '주민번호 열쇠 비밀번호 틀림', '');
    ui.alert(title, '관리자 비밀번호가 틀렸어요. 열쇠는 보여주지 않았어요.', ui.ButtonSet.OK);
    return 'wrong';
  }
  var info = hrKeyInfo_();
  if (!info.key && !info.count) { hrKey_(true); info = hrKeyInfo_(); } // 저장된 번호가 아직 없으면 지금 만들어서 보여줘요
  if (info.key) logSuspect_('(시트 메뉴)', '주민번호 열쇠 보기', '');
  var r = ui.prompt(title, info.key ? hrKeyShowText_(info, true) : hrKeyLostText_(info), ui.ButtonSet.OK_CANCEL);
  var text = String(r.getResponseText() || '').trim();
  if (r.getSelectedButton() !== ui.Button.OK || !text) return info.key ? 'shown' : 'cancel';
  if (!info.key && text.replace(/\s+/g, '') === '새로시작') {
    var yes = ui.alert(title, '정말 새 열쇠를 만들까요?\n이미 받은 주민번호 ' + info.count + '명은 영영 볼 수 없게 돼요. 직원들에게 다시 받아야 해요(직원 화면 [내 인사 정보]나 사장님 화면 인사 카드).', ui.ButtonSet.YES_NO);
    if (yes !== ui.Button.YES) return 'cancel';
    hrKeyFresh_();
    ui.alert(title, '새 열쇠를 만들었어요. 이제 setup을 다시 실행해 주세요.\n\n' + hrKeyShowText_(hrKeyInfo_(), false), ui.ButtonSet.OK);
    return 'fresh';
  }
  var res = hrKeyRestore_(text);
  ui.alert(title, res.msg, ui.ButtonSet.OK);
  return res.ok ? (res.same ? 'same' : 'restored') : 'bad';
}

/** 주민번호 전체 보기를 쓰면 사장님께 소리 없이 알려요(이름·시각만, 번호는 안 적어요). [의심기록]에도 남아요. */
function rrnSeen_(set, name) {
  notify_(set, '주민번호 전체 보기 (' + nowKst_().time + ')', name + ' 님 주민번호 전체를 사장님 화면에서 봤어요.\n사장님이 본 게 아니면 시트 [설정] 탭의 관리자PIN을 바로 바꿔 주세요.', { silent: true });
}

/**
 * 사장님 화면(관리자 비밀번호)에 처음 보는 폰이 들어오면 사장님께 텔레그램으로 알려요.
 * 사장님 화면이 폰마다 만들어 두는 번호(dev)로 알아보고, 본 적 있는 번호는 스크립트 속성에 남겨요(최근 20대).
 * 번호 없이 부르면(예전 화면) 알아볼 수 없어서 건너뛰어요. 알림은 한 시간에 5번까지(번호를 바꿔 가며 들어와도 알림이 쏟아지지 않게).
 * 그동안 들어온 폰은 '본 폰'으로 적지 않아서, 쉬는 시간이 끝나면 알려요(알림을 일부러 채워 몰래 들어오지 못하게).
 */
var ADMIN_DEVS_ = { key: 'adminDevs', max: 20, perHour: 5 };
function adminDevNew_(set, dev) {
  try {
    // 사장님 화면은 늘 폰 번호를 보내요. 번호 없이 부른 건 화면 밖에서 부른 것이에요:
    // 사장님 폰을 한 번이라도 본 뒤에는 처음 보는 폰처럼 알려요(6시간에 한 번. 본 폰 목록에는 안 넣어요)
    var nodev = !dev;
    var cache = CacheService.getScriptCache(), ck = 'admdev:' + (dev || 'nodev');
    if (cache.get(ck)) return false; // 6시간 안에 본 폰은 속성을 다시 안 읽어요
    var props = PropertiesService.getScriptProperties();
    var list = String(props.getProperty(ADMIN_DEVS_.key) || '').split(',').filter(String);
    if (nodev && !list.length) return false; // 아직 사장님 폰을 한 번도 못 봤어요(처음 설치·예전 화면)
    if (!nodev && list.indexOf(dev) >= 0) { cache.put(ck, '1', 21600); return false; }
    var n = Number(cache.get('admdev:n') || 0);
    if (n >= ADMIN_DEVS_.perHour) return false;
    cache.put('admdev:n', String(n + 1), 3600);
    if (!nodev) {
      list.push(dev);
      props.setProperty(ADMIN_DEVS_.key, list.slice(-ADMIN_DEVS_.max).join(','));
    }
    cache.put(ck, '1', 21600);
    notify_(set, (nodev ? '사장님 화면 밖에서 관리자 비밀번호로 들어왔어요' : '처음 보는 폰에서 사장님 화면에 들어왔어요') + ' (' + nowKst_().time + ')',
      (nodev ? '사장님 화면을 거치지 않고 관리자 비밀번호로 앱 기능을 불렀어요(아주 오래 열어 둔 예전 화면이 아니면 사장님이 한 일이 아니에요).'
        : '사장님이 새 폰·PC로 들어왔거나 브라우저 기록을 지운 거면 괜찮아요.') +
      '\n모르는 일이면 시트 [설정] 탭의 관리자PIN을 바로 바꿔 주세요(바꾸면 다른 폰은 모두 다시 들어와야 해요).' +
      (n + 1 === ADMIN_DEVS_.perHour ? '\n※ 한 시간 안에 처음 보는 폰이 ' + ADMIN_DEVS_.perHour + '번 들어와서, 한동안은 이 알림을 더 안 보내요.' : ''));
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

/* ── 매주 백업: 구글 드라이브 [출퇴근 백업] 폴더 (드라이브 권한이 필요해요. 코드를 붙여넣은 뒤 setup을 한 번 실행하면 물어봐요) ── */
var BACKUP_DIR = '출퇴근 백업', BACKUP_KEEP = 8;
var BACKUP_ = { week: 'backup:week', folder: 'backup:folder' };

/** 10분 자동 실행에서: 주민번호 열쇠 확인(없어졌으면 하루 한 번 알림), 매주 새벽 드라이브 백업. 백업을 못 하면 사장님께 하루 한 번(stepFail_). */
function dataGuard_(set, now) {
  try { hrKeyWatch_(set, now); } catch (err) { console.error(err); }
  try { weeklyBackup_(set, now); } catch (err2) { stepFail_('주간 백업', err2); }
}

/** ISO 주('2026-W47'). 주는 월요일에 시작하고, 그 주 목요일이 든 해가 그 주의 해예요. */
function isoWeek_(date) {
  var thu = addDays_(date, 4 - (dowOf_(date) || 7));
  var y = thu.slice(0, 4);
  return y + '-W' + pad2_(Math.floor(daysBetween_(y + '-01-01', thu) / 7) + 1);
}

/**
 * 매주 한 번(새벽 3~6시) 이 시트 전체를 구글 드라이브 [출퇴근 백업] 폴더에 '출퇴근 백업 YYYY-MM-DD'로 복사해요.
 * 앱이 만든 백업은 최근 8개만 남기고 오래된 것은 휴지통으로 옮겨요(사장님이 넣은 파일·이름을 바꾼 백업은 그대로).
 * [설정] 자동백업이 끔이면 안 해요. 만든 파일 이름을 돌려줘요('' = 할 때가 아니에요). 못 하면 오류를 내요.
 */
function weeklyBackup_(set, now) {
  if (set.backup === '끔' || now.min < 3 * 60 || now.min >= 6 * 60) return '';
  var props = PropertiesService.getScriptProperties(), week = isoWeek_(now.date);
  if (props.getProperty(BACKUP_.week) === week) return '';
  var id = book_().getId(), name = BACKUP_DIR + ' ' + now.date, folder, copy;
  try {
    folder = backupFolder_(props);
    copy = DriveApp.getFileById(id).makeCopy(name, folder);
  } catch (err) {
    throw new Error('드라이브 [' + BACKUP_DIR + '] 폴더에 사본을 못 만들었어요. 시트 메뉴 출퇴근 → setup 실행을 한 번 눌러 드라이브 권한을 허용했는지 확인해 주세요. (' + String(err && err.message || err).slice(0, 80) + ')');
  }
  props.setProperty(BACKUP_.week, week); // 만들었으면 이번 주는 끝(아래 정리가 안 돼도 또 만들지 않게)
  try {
    copy.setDescription(backupNote_(id));
    backupPrune_(folder, id);
  } catch (err2) {
    throw new Error('이번 주 백업(' + name + ')은 만들었는데 오래된 백업을 정리하지 못했어요. 다음 주에 다시 해 봐요. (' + String(err2 && err2.message || err2).slice(0, 80) + ')');
  }
  return name;
}

/** 앱이 만든 백업 표시(파일 설명). 원본 파일 번호를 넣어서, 다른 시트(시험용 사본 등)의 백업과 한 폴더에 섞여도 내 것만 정리해요. */
function backupNote_(id) {
  return '출퇴근 앱이 매주 자동으로 만든 백업이에요. 최근 ' + BACKUP_KEEP + '개만 남기고 오래된 것은 휴지통으로 옮겨요. (원본 ' + id + ')';
}

/** [출퇴근 백업] 폴더: 기억해 둔 폴더 → 같은 이름 폴더 → 새로 만들기. 휴지통에 있는 폴더는 안 써요. */
function backupFolder_(props) {
  var id = props.getProperty(BACKUP_.folder) || '', f = null;
  if (id) {
    try { f = DriveApp.getFolderById(id); } catch (err) { f = null; } // 아주 지운 폴더
    if (f && (f.isTrashed() || !mineFolder_(f))) f = null; // 휴지통에 있거나 사장님 것이 아니면(예전 버전이 남의 폴더를 기억했을 수 있어요) 다시 찾아요
  }
  if (!f) {
    // 사장님(스크립트 주인) 것만 찾아요: 남이 같은 이름으로 만들어 공유한 폴더('공유 문서함')에 백업이 들어가면 그 사람이 열어 볼 수 있어요
    var it = DriveApp.searchFolders("title = '" + BACKUP_DIR + "' and 'me' in owners and trashed = false");
    if (it.hasNext()) f = it.next();
  }
  if (!f) f = DriveApp.createFolder(BACKUP_DIR);
  if (f.getId() !== id) props.setProperty(BACKUP_.folder, f.getId());
  return f;
}

/** 그 폴더가 스크립트 주인(사장님) 것인지. 공유 드라이브 폴더(주인 없음)는 아니라고 봐요. 확인 자체가 안 되면 그대로 써요. */
function mineFolder_(f) {
  try {
    var o = f.getOwner(), me = Session.getEffectiveUser().getEmail();
    return !!(o && me && String(o.getEmail()).toLowerCase() === String(me).toLowerCase());
  } catch (err) {
    console.error(err);
    return true;
  }
}

/** 앱이 만든 백업(이름이 '출퇴근 백업 YYYY-MM-DD'이고 설명에 이 시트 번호)을 최근 BACKUP_KEEP개만 남기고 휴지통으로. 옮긴 수를 돌려줘요. */
function backupPrune_(folder, id) {
  var mine = [], it = folder.getFiles(), mark = '(원본 ' + id + ')';
  while (it.hasNext()) {
    var f = it.next();
    if (f.isTrashed() || !/^출퇴근 백업 \d{4}-\d{2}-\d{2}$/.test(f.getName()) || String(f.getDescription() || '').indexOf(mark) < 0) continue;
    mine.push({ f: f, at: f.getDateCreated().getTime(), name: f.getName() });
  }
  mine.sort(function (a, b) { return b.at - a.at || (a.name < b.name ? 1 : a.name > b.name ? -1 : 0); });
  mine.slice(BACKUP_KEEP).forEach(function (x) { x.f.setTrashed(true); });
  return Math.max(mine.length - BACKUP_KEEP, 0);
}


/* ───────────── 예전 휴무표 가져오기 (한 해 치) ───────────── */
/*
 * 예전에 쓰던 휴무표(1월~12월 묶음이 아래로 쌓인 탭)를 읽어 '휴무표 YYYY-MM' 탭으로 옮겨요.
 *  - 달마다 그때 명단 그대로: 퇴사자는 다닌 달까지만, 중간에 들어온 사람은 들어온 달부터 나와요
 *  - 없는 달 탭은 새로 만들고, 이미 있는 탭은 예전 파일에 적힌 칸만 맞춰요(새 시트에만 적힌 칸은 그대로)
 *  - 앱을 시작한 뒤에는 시작일부터의 칸은 건드리지 않아요(그때부터는 앱 기록이 기준)
 *  - 첫출근·퇴사·매장 바뀜은 [인사] 탭 입사일·퇴사일·이동 기록으로
 *  - 월차: 1월 부여 1개(작년 12월 만근분), 작년 월차를 올해 쓴 만큼은 1월 이월로 넣어 마이너스가 안 되게 해요
 * 사장님 화면 [설정] → 예전 휴무표 가져오기: [미리 보기] → [가져오기](달마다 한 번씩 불러서 오래 걸려도 안 끊겨요)
 * 예전 파일에서는 '휴무표' 탭만 읽어요(다른 탭은 열어 보지 않아요).
 */
var OLD_TAB = '휴무표'; // 예전 파일 안의 탭 이름
var OLD_LOCAL_TAB = '예전 휴무표'; // 주소 없이: 이 시트 안에 복사해 둔 탭 이름
var OLD_EMPTY = '기록 없음'; // 지난달인데 한 칸도 안 적힌 줄의 만근 칸(다음 달 월차 부여 0)
var OLD_ALIAS = '아라=검단, 사무실(영)=사무실(왕)';

/** 미리 보기: 무엇이 어떻게 들어갈지만 계산해요. 시트는 안 바뀌어요(주소만 [설정]에 기억). */
function adminImportPreview(pin, src, year) {
  adminAuth_(pin);
  var plan = oldLoad_(src, year);
  src = String(src == null ? '' : src).trim();
  if (src && settings_().oldSrc !== src) setSetting_(K.oldSrc, src);
  return oldView_(plan);
}

/** 한 달 가져오기(화면이 달마다 차례로 불러요). */
function adminImportMonth(pin, src, year, m) {
  adminAuth_(pin);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var plan = oldLoad_(src, year);
    var mo = null;
    plan.months.forEach(function (x) { if (x.m === Number(m)) mo = x; });
    if (!mo) throw new Error(m + '월은 예전 휴무표에 적힌 게 없어요.');
    return oldImportMonth_(plan, mo, false);
  } finally {
    lock.releaseLock();
  }
}

/** 마무리: 달 탭들의 월차 수식을 앞 달과 잇고, [인사] 탭에 입사일·퇴사·이동 기록을 정리해요. */
function adminImportFinish(pin, src, year) {
  adminAuth_(pin);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var plan = oldLoad_(src, year);
    var kept = 0, tabs = 0;
    for (var m = 1; m <= 12; m++) {
      var ym = plan.year + '-' + pad2_(m);
      if (!monthSheet_(ym)) continue;
      kept += relinkMonth_(ym);
      tabs++;
    }
    // 가져오기가 넣은 이월 숫자(작년 월차 쓴 만큼, 빠진 달 잇기)는 '사장님이 직접 적은 숫자'로 세지 않아요
    var made = oldMade_();
    Object.keys(plan.people).forEach(function (n) {
      var pp = plan.people[n];
      pp.months.forEach(function (mi) {
        if (made.indexOf(plan.year + '-' + pad2_(mi)) < 0) return;
        var ty = oldTyped_(pp, mi);
        if (ty.carry) kept--;
        if (ty.grant != null) kept--;
      });
    });
    kept = Math.max(0, kept);
    var hr = oldHr_(plan, false);
    var now = nowKst_();
    PropertiesService.getScriptProperties().setProperty('oldImport', JSON.stringify({
      at: now.date + ' ' + now.time, year: plan.year, months: plan.months.map(function (x) { return x.m; }),
    }));
    var view = oldView_(plan);
    view.done = { tabs: tabs, kept: kept, hrAdded: hr.added, hrFilled: hr.filled };
    return view;
  } finally {
    lock.releaseLock();
  }
}

/** 예전 휴무표 탭 찾기. src = 구글 시트 주소(또는 파일 ID). 비우면 이 시트 안의 '예전 휴무표' 탭. */
function oldSource_(src) {
  src = String(src == null ? '' : src).trim();
  if (!src) {
    var local = book_().getSheetByName(OLD_LOCAL_TAB);
    if (!local) throw new Error('예전 휴무표 파일 주소를 넣어주세요. (그 구글 시트를 열고 주소창의 주소를 그대로 붙여넣으면 돼요)');
    return { sh: local, title: OLD_LOCAL_TAB };
  }
  var m = /\/d\/([A-Za-z0-9_-]{20,})/.exec(src) || /^([A-Za-z0-9_-]{20,})$/.exec(src);
  if (!m) throw new Error('주소를 확인해주세요. 구글 시트 주소(https://docs.google.com/spreadsheets/d/…)를 붙여넣어 주세요.');
  var ss;
  try {
    ss = SpreadsheetApp.openById(m[1]);
  } catch (err) {
    throw new Error('그 파일을 열 수 없어요. 사장님 구글 계정으로 볼 수 있는 구글 시트인지 확인해주세요.');
  }
  var sh = ss.getSheetByName(OLD_TAB) || ss.getSheetByName(OLD_LOCAL_TAB);
  if (!sh) throw new Error("그 파일에 '" + OLD_TAB + "' 탭이 없어요. 예전 휴무표 탭 이름을 '" + OLD_TAB + "'로 바꾼 뒤 다시 해주세요.");
  var title = '';
  try { title = ss.getName(); } catch (err2) { /* 이름을 못 읽어도 괜찮아요 */ }
  return { sh: sh, title: title };
}

function oldLoad_(src, year) {
  year = validYear_(year) || nowKst_().date.slice(0, 4);
  var s = oldSource_(src);
  var n = s.sh.getLastRow(), w = s.sh.getLastColumn();
  if (n < 3 || w < 10) throw new Error('예전 휴무표 탭이 비어 있어요.');
  var parsed = oldParse_(s.sh.getRange(1, 1, n, w).getDisplayValues());
  var plan = oldPlan_(parsed, year);
  if (!plan.months.length) throw new Error("그 탭에서 휴무표를 찾지 못했어요. '1월' 같은 달 칸과 '이름' 칸이 있는 예전 휴무표인지 확인해주세요.");
  plan.title = s.title;
  return plan;
}

/**
 * 예전 휴무표(화면에 보이는 글자 그대로의 표)를 달마다 사람 줄로 정리해요. 계산만 하고 시트는 안 건드려요.
 * 칸 위치는 머리글에서 찾아요: '이름', '매장명', 달 칸('1월'이 가장 많이 적힌 칸), 첫 날짜 칸('1-1').
 * 돌려주는 것: { months: { 1: { rows: [{name, store, days[31], memo}], dow: '목' }, … }, nameless, dups }
 */
function oldParse_(vals) {
  var t = function (x) { return String(x == null ? '' : x).replace(/\s+/g, ' ').trim(); };
  var isDow = function (x) { return DOW.indexOf(x) >= 0; };
  var cName = -1, cStore = -1, cDay1 = -1, i, j;
  for (i = 0; i < Math.min(vals.length, 30) && cName < 0; i++) {
    var r = vals[i].map(t);
    if (r.indexOf('이름') < 0) continue;
    cName = r.indexOf('이름');
    cStore = r.indexOf('매장명') >= 0 ? r.indexOf('매장명') : r.indexOf('매장');
  }
  if (cName < 0) return { months: {}, nameless: 0, dups: 0 };
  if (cStore < 0) cStore = cName - 1;
  for (i = 0; i < Math.min(vals.length, 30) && cDay1 < 0; i++) {
    for (j = cName + 1; j < vals[i].length; j++) {
      if (/^\d{1,2}\s*[-\/.]\s*1$/.test(t(vals[i][j]))) { cDay1 = j; break; }
    }
  }
  if (cDay1 < 0) {
    // 날짜 머리글이 없으면 요일이 이어서 적힌 첫 칸
    for (i = 0; i < Math.min(vals.length, 30) && cDay1 < 0; i++) {
      for (j = cName + 1; j + 2 < vals[i].length; j++) {
        if (isDow(t(vals[i][j])) && isDow(t(vals[i][j + 1])) && isDow(t(vals[i][j + 2]))) { cDay1 = j; break; }
      }
    }
  }
  if (cDay1 < 0) cDay1 = cName + 6;
  // 달 칸: 이름 칸 앞에서 '3월' 같은 값이 가장 많은 칸
  var cMonth = -1, best = 0;
  for (j = 0; j < cName; j++) {
    var cnt = 0;
    for (i = 0; i < vals.length; i++) if (/^\d{1,2}\s*월$/.test(t(vals[i][j]))) cnt++;
    if (cnt > best) { best = cnt; cMonth = j; }
  }
  var out = { months: {}, nameless: 0, dups: 0 };
  if (cMonth < 0) return out;
  var dow = ''; // 가장 가까운 위쪽 머리글 줄의 1일 요일
  for (i = 0; i < vals.length; i++) {
    var v = vals[i];
    if (t(v[cName]) === '이름') {
      if (isDow(t(v[cDay1]))) dow = t(v[cDay1]);
      continue;
    }
    var mm = /^(\d{1,2})\s*월$/.exec(t(v[cMonth]));
    if (!mm || Number(mm[1]) < 1 || Number(mm[1]) > 12) continue;
    var name = t(v[cName]).slice(0, 20);
    if (!name) { out.nameless++; continue; }
    var blk = out.months[Number(mm[1])] = out.months[Number(mm[1])] || { rows: [], dow: dow, seen: {} };
    var days = [];
    for (var d = 0; d < 31; d++) days.push(t(v[cDay1 + d]));
    var memo = [t(v[cDay1 + 31]), t(v[cDay1 + 32]), t(v[cDay1 + 33])].filter(String).join(' / ');
    if (blk.seen[name]) {
      // 같은 달에 같은 이름 줄이 또 있어요(달 중간에 매장을 옮겨 줄이 둘인 경우 등): 한 줄로 합쳐요.
      // 빈 칸은 둘째 줄 값으로 채우고, 매장은 나중 줄 것으로(옮겨 간 매장)
      out.dups++;
      var first = blk.seen[name];
      days.forEach(function (x, k) { if (x && !first.days[k]) first.days[k] = x; });
      if (t(v[cStore])) first.store = t(v[cStore]);
      if (memo) first.memo = first.memo ? first.memo + ' / ' + memo : memo;
      continue;
    }
    var rec = { name: name, store: t(v[cStore]), days: days, memo: memo };
    blk.seen[name] = rec;
    blk.rows.push(rec);
  }
  return out;
}

/** '아라=검단, 사무실(영)=사무실(왕)' → {아라: '검단', …}. 예전 이름을 지금 [매장] 이름으로 맞춰요. */
function oldAlias_(set) {
  var map = {};
  String(set.alias || '').split(/[,\n]/).forEach(function (x) {
    var p = x.split('=');
    if (p.length === 2 && p[0].trim() && p[1].trim()) map[p[0].trim()] = p[1].trim();
  });
  return map;
}

/** 예전 칸 글자를 앱이 읽는 모양으로: 11:8 → 11:08, 휴뮤 → 휴무, 예전 매장 이름 → 지금 이름. */
function oldMark_(v, alias) {
  var s = String(v == null ? '' : v).replace(/\s+/g, ' ').trim();
  if (!s) return '';
  s = s.replace(/휴뮤/g, '휴무');
  s = s.replace(/(\d{1,2}):(\d{1,2})(?!\d)/g, function (all, h, mi) { return h + ':' + (mi.length < 2 ? '0' + mi : mi); });
  if (alias[s]) s = alias[s];
  return s.slice(0, 40);
}

/** 그 칸이 '다른 매장 이름'(지원 근무)이면 그 매장 이름을, 아니면 ''. names = {매장 이름·예전 이름: 지금 이름} */
function supportOf_(mark, names) {
  var s = String(mark == null ? '' : mark).trim();
  if (!s) return '';
  if (names[s]) return names[s];
  // '가산 11:08'(지원 가서 지각), '휴무 가산'(쉬는 날 지원), '대타 가산'처럼 다른 말과 같이 적힌 것도 봐요(띄어 쓴 한 낱말일 때만)
  var hit = '';
  // 띄어 쓴 매장 이름('가산 디지털')은 낱말로 나누기 전에 찾아요
  Object.keys(names).forEach(function (k) { if (!hit && /\s/.test(k) && (' ' + s.replace(/\s+/g, ' ') + ' ').indexOf(' ' + k + ' ') >= 0) hit = names[k]; });
  (' ' + s + ' ').split(/\s+/).forEach(function (w) { if (!hit && w && names[w]) hit = names[w]; });
  return hit;
}

/** [인사] 이동 기록의 지점 이동들 [{date, from, to}] (날짜 순서). */
function moveList_(name) {
  return memo_('moves:' + name, function () {
    var h = hrFind_(name), names = storeNames_(), out = [];
    String((h && h.moves) || '').split(' · ').forEach(function (x) {
      var m = /^(\d{4}-\d{2}-\d{2}) (.+)→(.+)$/.exec(String(x).trim());
      if (m && names[m[3].trim()]) out.push({ date: m[1], from: names[m[2].trim()] || m[2].trim(), to: names[m[3].trim()] });
    });
    return out;
  });
}

/** 그날 그 사람의 소속 매장: 이동 기록으로 정해요(이동 기록이 없으면 fallback). */
function homeAt_(name, date, fallback) {
  // 그 달에 지점 이동이 없으면 그 달 휴무표 줄의 매장이 맞아요(지난달 줄은 그때 소속 그대로 남아 있어요)
  var mv = moveList_(name).filter(function (x) { return x.date.slice(0, 7) === date.slice(0, 7); }), home = '';
  if (!mv.length) return fallback;
  mv.forEach(function (x) { if (x.date <= date) home = x.to; });
  return home || mv[0].from || fallback;
}

/** 매장 이름 → 지금 이름 표([매장] 탭 이름 + [설정] 예전매장이름). */
function storeNames_() {
  return memo_('storeNames', function () {
    var names = {}, alias = oldAlias_(settings_());
    stores_().forEach(function (st) { names[st.name] = st.name; });
    Object.keys(alias).forEach(function (k) { if (!names[k]) names[k] = alias[k]; });
    return names;
  });
}

/** 예전 파일이 '주인'인 날 수: 그 달 1일부터 며칠까지 가져올지. 앱을 시작했으면 시작일 전날까지만. */
function oldOwnDays_(ym, set, now) {
  var n = daysIn_(ym);
  if (!started_(set, now.date)) return n; // 아직 시작 전: 앞으로의 계획(휴무)까지 모두 예전 파일 기준
  var sm = set.startDate.slice(0, 7);
  return ym < sm ? n : ym > sm ? 0 : Number(set.startDate.slice(8)) - 1;
}

/**
 * 가져올 내용 정리(계산만). months: [{m, ym, rows:[{name, store, days[], marks, memo, moveDay}], dowOk, own}],
 * people: {이름: {months, first, last, stores, firstDay, quitDay, carry, janGrant, moves, left …}}
 */
function oldPlan_(parsed, year) {
  var set = settings_(), now = nowKst_();
  var alias = oldAlias_(set), known = storeNames_();
  var plan = {
    year: year, months: [], people: {}, skipped: [], nameless: parsed.nameless, dups: parsed.dups,
    unknownStores: {}, mapped: {}, words: {}, typos: 0, times: 0, overflow: 0,
  };
  var who = function (name) {
    return plan.people[name] = plan.people[name] || {
      name: name, months: [], stores: {}, uses: {}, broke: {}, empty: {}, firstDay: '', quitDay: '', quitSure: false, lastYear: 0, moves: [],
    };
  };
  var began = {}, quit = {};
  for (var m = 1; m <= 12; m++) {
    var blk = parsed.months[m];
    if (!blk) continue;
    var ym = year + '-' + pad2_(m), n = daysIn_(ym), total = 0, rows = [];
    blk.rows.forEach(function (r) {
      var st = String(r.store || '').trim(), moveDay = 0;
      var mv = /^(\d{1,2})\s*일\s*(.+)$/.exec(st); // '10일 가산' = 그달 10일에 가산으로 옮김
      if (mv) { moveDay = Number(mv[1]); st = mv[2].trim(); }
      var raw = st;
      if (alias[st]) st = alias[st];
      var days = [], marks = 0;
      for (var d = 0; d < 31; d++) {
        if (d >= n) { if (r.days[d]) plan.overflow++; continue; }
        days.push(oldMark_(r.days[d], alias));
        if (days[d]) marks++;
      }
      rows.push({ name: r.name, store: st, rawStore: raw, moveDay: moveDay, days: days, marks: marks, memo: String(r.memo || '').slice(0, 200), src: r.days });
      total += marks;
    });
    if (!total) { plan.skipped.push(m); continue; } // 빈 틀(아직 안 쓴 달)은 건너뛰어요
    // 처음 적힌 달보다 앞에 미리 만들어 둔 빈 줄은 빼요(그 사람은 첫 기록이 있는 달부터).
    // '퇴사'가 확실히 적힌 달 뒤에 남아 있는 빈 줄도 빼요(달 틀을 복사하면서 따라온 줄)
    rows = rows.filter(function (r) {
      if (r.marks) began[r.name] = true;
      if (!began[r.name]) return false;
      if (quit[r.name] && !r.marks) return false;
      if (r.days.some(function (v) { return /퇴사|마지막\s*근무/.test(v) && !/\?|예정/.test(v); })) quit[r.name] = true;
      else if (r.marks) quit[r.name] = false; // 퇴사 표시 뒤에 다시 기록이 있으면 계속 다니는 사람
      return true;
    });
    var past = ym < now.ym;
    rows.forEach(function (r) {
      if (r.rawStore !== r.store) plan.mapped[r.rawStore + '→' + r.store] = (plan.mapped[r.rawStore + '→' + r.store] || 0) + 1;
      if (r.store && !known[r.store]) plan.unknownStores[r.store] = (plan.unknownStores[r.store] || 0) + 1;
      var p = who(r.name), uses = 0, broke = false;
      r.days.forEach(function (v, d) {
        if (!v) return;
        var src = String(r.src[d] || '').replace(/\s+/g, ' ').trim();
        if (/휴뮤/.test(src)) plan.typos++;
        else if (v !== src && /\d:\d/.test(v)) plan.times++;
        var date = ym + '-' + pad2_(d + 1);
        if (/월차/.test(v)) {
          uses++;
          var lm = /(\d{1,2})\s*월\s*(?:월)?\s*차/.exec(v);
          if (lm && Number(lm[1]) - m >= 6) p.lastYear++; // 1~6월에 쓴 '12월차'·'10월차' = 작년 것
        }
        if (new RegExp(FULL_BREAK + '|' + AWAY_MARK).test(v)) broke = true;
        if (/첫\s*출근/.test(v) && !p.firstDay) p.firstDay = date;
        var qk = /퇴사/.test(v) ? 'q' : /마지막\s*근무/.test(v) ? 'l' : '';
        if (qk) {
          // '퇴사'를 남은 날마다 이어서 적은 경우: 첫 칸이 퇴사일(나중에 다시 다니다 또 퇴사한 것만 새 날짜로)
          var cont = qk === 'q' && p.quitKind === 'q' && p.quitRun && addDays_(p.quitRun, 1) === date;
          if (!cont) { p.quitDay = date; p.quitSure = !/\?|예정/.test(v); p.quitKind = qk; }
          p.quitRun = date;
        } else if (p.quitKind === 'q' && p.quitRun && addDays_(p.quitRun, 1) === date && OFF_RE.test(v)) {
          p.quitRun = date; // 퇴사 칸 사이에 미리 적어 둔 휴무: 퇴사가 이어진 걸로 봐요(다음 퇴사 칸이 새 퇴사일이 되지 않게)
        }
        var kind = /\d{1,2}:\d{2}/.test(v) || OFF_RE.test(v) || /첫\s*출근|마지막\s*근무|대타|결근/.test(v) || supportOf_(v, known);
        if (!kind) plan.words[v] = (plan.words[v] || 0) + 1;
      });
      p.months.push(m);
      p.stores[m] = r.store;
      p.uses[m] = uses;
      p.broke[m] = broke;
      p.empty[m] = past && !r.marks;
      if (r.moveDay) { p.moveDay = p.moveDay || {}; p.moveDay[m] = r.moveDay; }
      delete r.src;
    });
    var want = DOW[dowOf_(ym + '-01')];
    plan.months.push({ m: m, ym: ym, rows: rows, marks: total, dowOk: !blk.dow || blk.dow === want, own: oldOwnDays_(ym, set, now) });
  }
  var lastM = plan.months.length ? plan.months[plan.months.length - 1].m : 0;
  Object.keys(plan.people).forEach(function (name) {
    var p = plan.people[name];
    p.first = p.months[0];
    p.last = p.months[p.months.length - 1];
    p.firstStore = p.stores[p.first];
    p.lastStore = p.stores[p.last];
    p.joined = !!p.firstDay && Number(p.firstDay.slice(5, 7)) === p.first; // 올해 들어온 사람(첫 달에 '첫출근')
    p.janGrant = p.first === 1 && !(p.firstDay && p.firstDay.slice(5, 7) === '01') ? 1 : 0;
    p.carry = Math.max(0, p.lastYear - (p.first === 1 ? p.janGrant : 0));
    // 지금은 없는 사람: 마지막 달 명단에 없거나, 마지막으로 나온 달에 '퇴사'가 적힌 사람
    p.gone = p.last < lastM || (!!p.quitDay && p.quitSure && Number(p.quitDay.slice(5, 7)) === p.last);
    // 매장이 바뀐 달 → 이동 기록
    for (var i = 1; i < p.months.length; i++) {
      var a = p.months[i - 1], b = p.months[i];
      if (p.stores[a] && p.stores[b] && p.stores[a] !== p.stores[b]) {
        var day = p.moveDay && p.moveDay[b];
        p.moves.push((day ? year + '-' + pad2_(b) + '-' + pad2_(day) : year + '-' + pad2_(b)) + ' ' + p.stores[a] + '→' + p.stores[b]);
      }
    }
    // 가져온 뒤 월차 잔여(시트 수식과 같은 규칙으로 미리 계산): 이월 + 부여 − 사용
    // 중간에 한 달이 빠진 사람(그 달 묶음에 줄이 없음)은 다음 달 이월 수식이 앞 달에서 못 찾아 0이 돼요.
    // 그래서 빠진 달 바로 다음 달에는 그때까지의 잔여를 이월 칸에 숫자로 적어 이어 줘요(p.carryAt)
    var left = p.carry, prev = 0;
    p.carryAt = {};
    p.months.forEach(function (mi) {
      var gap = prev && prev !== mi - 1;
      if (gap && left) p.carryAt[mi] = left;
      var grant = mi === 1 ? p.janGrant : !gap && prev === mi - 1 && !p.broke[prev] && !p.empty[prev] ? 1 : 0;
      left += grant - p.uses[mi];
      prev = mi;
    });
    p.left = left;
  });
  return plan;
}

/** 화면에 보여 줄 미리 보기(이미 있는 탭과 견줘서 무엇이 바뀌는지까지). */
function oldView_(plan) {
  var set = settings_(), now = nowKst_();
  var top = function (map, n) {
    return Object.keys(map).map(function (k) { return { w: k, n: map[k] }; })
      .sort(function (a, b) { return b.n - a.n; }).slice(0, n);
  };
  var months = plan.months.map(function (mo) {
    var r = oldImportMonth_(plan, mo, true);
    return {
      m: mo.m, ym: mo.ym, people: mo.rows.length, marks: mo.marks, dowOk: mo.dowOk, own: mo.own, days: daysIn_(mo.ym),
      exists: r.exists, add: r.added, change: r.changed, clear: r.cleared, skip: r.skip, extra: r.extra || 0,
    };
  });
  var names = Object.keys(plan.people);
  var staffNames = {};
  staff_().forEach(function (p) { staffNames[p.name] = p; });
  var hr = oldHr_(plan, true);
  var people = names.map(function (n) { return plan.people[n]; });
  return {
    year: plan.year, title: plan.title || '', live: started_(set, now.date), startDate: set.startDate || '',
    months: months, skipped: plan.skipped, nameless: plan.nameless, dups: plan.dups, overflow: plan.overflow,
    typos: plan.typos, times: plan.times,
    unknownStores: top(plan.unknownStores, 20), mapped: top(plan.mapped, 20), words: top(plan.words, 40),
    people: {
      total: names.length,
      inStaff: names.filter(function (n) { return staffNames[n]; }).length,
      gone: people.filter(function (p) { return p.gone && !staffNames[p.name]; }).length,
      notInStaff: people.filter(function (p) { return !p.gone && !staffNames[p.name]; }).map(function (p) { return p.name; }),
      joins: people.filter(function (p) { return p.firstDay; }).length,
      quits: people.filter(function (p) { return p.quitDay; }).length,
      moves: people.reduce(function (s, p) { return s + p.moves.length; }, 0),
    },
    leave: {
      janGrant: people.filter(function (p) { return p.janGrant; }).length,
      carry: people.filter(function (p) { return p.carry; }).map(function (p) { return { name: p.name, n: p.carry }; }),
      minus: people.filter(function (p) { return !p.gone && p.left < 0; }).map(function (p) { return { name: p.name, n: p.left }; }),
      many: people.filter(function (p) { return !p.gone && p.left >= 6; }).map(function (p) { return { name: p.name, n: p.left }; }),
    },
    hr: { add: hr.added, fill: hr.filled },
    last: oldInfo_(),
  };
}

function oldInfo_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('oldImport') || 'null'); } catch (err) { return null; }
}

/**
 * 한 달 가져오기. dry면 세기만 해요(미리 보기).
 *  - 탭이 없으면: 그달 명단 그대로 새 탭
 *  - 탭이 있으면: 예전 파일에 적힌 칸으로 맞추고(다르면 바꿈), 예전 파일에 없고 새 시트에만 있는 칸은 그대로
 *    (앱이 밤에 적은 '결근?'만 지워요). 탭에 없는 사람은 줄을 더해요.
 */
function oldImportMonth_(plan, mo, dry) {
  if (!dry) monthRename_();
  var ss = book_(), ym = mo.ym, n = daysIn_(ym), own = mo.own;
  var res = { m: mo.m, ym: ym, exists: !!monthSheet_(ym), made: false, rows: 0, added: 0, changed: 0, cleared: 0, skip: '' };
  if (!own) { res.skip = '앱 시작일 뒤라서 건드리지 않아요'; return res; }
  if (isClosed_(ym)) { res.skip = '마감한 달이라 건드리지 않아요'; return res; }
  var past = ym < nowKst_().ym;
  if (!res.exists) {
    res.rows = mo.rows.length;
    if (dry) return res;
    var at = 0;
    ss.getSheets().forEach(function (x, i) {
      var nm = x.getName();
      if (tabYm_(nm) > ym) at = i + 1;
    });
    var sh = ss.insertSheet(monthName_(ym), at);
    buildMonth_(sh, ym);
    var order = {};
    stores_().forEach(function (st, i) { order[st.name] = i; });
    var sorted = mo.rows.map(function (r, i) { return { r: r, i: i }; }).sort(function (a, b) {
      var x = order[a.r.store] == null ? 999 : order[a.r.store], y = order[b.r.store] == null ? 999 : order[b.r.store];
      return x - y || a.i - b.i;
    }).map(function (x) { return x.r; });
    if (2 + sorted.length > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), sorted.length + 50);
    var out = sorted.map(function (r, i) {
      var row = monthRow_(3 + i, r, ym, MT);
      var p = plan.people[r.name];
      var typed = oldTyped_(p, mo.m);
      if (typed.carry != null) row[MT.carry] = typed.carry;
      if (typed.grant != null) row[MT.grant] = typed.grant;
      if (past && !r.marks) row[MT.full] = OLD_EMPTY;
      for (var d = 0; d < 31; d++) row.push(d < own ? r.days[d] || '' : '');
      row.push(r.memo || '');
      return row;
    });
    sh.getRange(3, 1, out.length, MT.memo + 1).setValues(out);
    delete GRID_[ym];
    var g0 = monthGrid_(ym, true);
    paintMonth_(sh, ym, g0.cols);
    monthRules_(sh, g0.cols.day1, g0.cols);
    oldMadeAdd_(ym); // 가져오기가 만든 탭(다시 가져올 때 예전 파일과 똑같이 맞춰요)
    linked_(ym, true);
    res.made = true;
    return res;
  }
  // 이미 있는 탭
  var g = monthGrid_(ym, true);
  if (g.cols.full < 0 && !dry) { addFullCol_(g, ym); g = monthGrid_(ym, true); }
  var d1 = g.cols.day1;
  var mine = oldMade_().indexOf(ym) >= 0; // 지난번 가져오기가 만든 탭: 예전 파일과 똑같이 맞춰요(예전 파일에서 지운 칸은 여기서도 지움)
  res.extra = 0; // 예전 파일에는 없는데 새 시트에 남는 칸(원래 있던 탭은 그대로 둬요)
  var diff = function (r, cur) { // 바꿀 칸: [{d, v}]
    var list = [];
    for (var d = 0; d < Math.min(own, n); d++) {
      var want = r.days[d] || '', have = String((cur && cur[d1 + d]) || '').trim();
      if (want && want !== have) list.push({ d: d, v: want, clear: false });
      else if (!want && have && (have === '결근?' || mine)) list.push({ d: d, v: '', clear: true });
      else if (!want && have) res.extra++;
    }
    return list;
  };
  var hasOwn = function (r) { for (var d = 0; d < Math.min(own, n); d++) if (r.days[d]) return true; return false; };
  var missing = mo.rows.filter(function (r) { return !g.rows[r.name] && (hasOwn(r) || r.marks > 0); });
  res.added = missing.length;
  if (!dry && missing.length) {
    var have = Object.keys(g.rows).map(function (nm) {
      return { row: g.rows[nm].row, store: String(g.rows[nm].vals[g.cols.store] || '').trim() };
    });
    missing.forEach(function (r) {
      var at = insertMonthRow_(g.sh, g, have, r, ym);
      var typed = oldTyped_(plan.people[r.name], mo.m);
      if (typed.carry != null) g.sh.getRange(at, g.cols.grant).setValue(typed.carry); // 이월 칸 = 부여 칸 바로 앞
      if (typed.grant != null) g.sh.getRange(at, g.cols.grant + 1).setValue(typed.grant);
    });
    g = monthGrid_(ym, true);
  }
  // 가져오기가 만든 탭: 예전 파일이 바뀌어 이월·1월 부여가 달라졌으면 다시 적어요(수식 칸·숫자 칸 모두)
  if (!dry && mine) {
    mo.rows.forEach(function (r) {
      var row = g.rows[r.name];
      if (!row) return;
      var typed = oldTyped_(plan.people[r.name], mo.m);
      var curCarry = String(row.vals[g.cols.grant - 1] || '').trim(), curGrant = String(row.vals[g.cols.grant] || '').trim();
      if (typed.carry != null && curCarry !== String(typed.carry)) g.sh.getRange(row.row, g.cols.grant).setValue(typed.carry);
      if (typed.grant != null && curGrant !== String(typed.grant)) g.sh.getRange(row.row, g.cols.grant + 1).setValue(typed.grant);
    });
  }
  mo.rows.forEach(function (r) {
    var row = g.rows[r.name];
    if (!row) { if (dry && hasOwn(r)) res.changed += diff(r, null).length; return; }
    var list = diff(r, row.vals);
    list.forEach(function (x) { if (x.clear) res.cleared++; else res.changed++; });
    var memoNow = String(row.vals[g.cols.memo] || '').trim();
    if (dry) return;
    if (list.length) {
      var line = [];
      for (var d = 0; d < n; d++) line.push(String(row.vals[d1 + d] || '').trim());
      list.forEach(function (x) { line[x.d] = x.v; });
      g.sh.getRange(row.row, d1 + 1, 1, n).setNumberFormat('@').setValues([line]);
    }
    if (r.memo && !memoNow) g.sh.getRange(row.row, g.cols.memo + 1).setNumberFormat('@').setValue(r.memo);
  });
  if (!dry) {
    delete GRID_[ym];
    if (res.added) paintMonth_(g.sh, ym, monthGrid_(ym, true).cols);
  }
  return res;
}

/**
 * 그 사람 그 달 줄에 숫자로 적을 이월·부여({carry, grant}. 수식 그대로면 null).
 *  - 첫 달: 작년 월차를 올해 쓴 만큼 이월, 1월이면 부여(작년 12월 만근분 1, 1월 입사자는 0)
 *  - 중간에 빠진 달 바로 다음 달: 그때까지의 잔여를 이월로(앞 달 탭에 줄이 없어서 수식으로는 0이 돼요)
 */
function oldTyped_(p, m) {
  var out = { carry: null, grant: null };
  if (!p) return out;
  if (p.first === m) {
    if (p.carry || m === 1) out.carry = p.carry || 0;
    if (m === 1) out.grant = p.janGrant;
  } else if (p.carryAt && p.carryAt[m] != null) {
    out.carry = p.carryAt[m];
  }
  return out;
}

/** 가져오기가 새로 만든 달 탭 목록(스크립트 속성 oldMade). */
function oldMade_() {
  try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('oldMade') || '[]'); } catch (err) { return []; }
}
function oldMadeAdd_(ym) {
  var list = oldMade_();
  if (list.indexOf(ym) < 0) list.push(ym);
  PropertiesService.getScriptProperties().setProperty('oldMade', JSON.stringify(list));
}

/**
 * [인사] 탭 정리. dry면 세기만.
 *  - 이미 있는 사람: 입사일(비었고 '첫출근'이 있으면), 첫 지점, 이동 기록(없는 것만 앞에), 퇴사일(퇴사인데 비었으면)
 *  - 예전 휴무표에만 있고 지금은 없는 사람(퇴사자): 상태 '퇴사'로 새 줄. 이름·지점·기간만 적어요
 */
function oldHr_(plan, dry) {
  var res = { added: 0, filled: 0 };
  if (!book_().getSheetByName(SHEETS.hr)) return res;
  if (!dry) syncHr_();
  var now = nowKst_();
  var inStaff = {};
  staff_().forEach(function (p) { inStaff[p.name] = true; });
  Object.keys(plan.people).forEach(function (name) {
    var p = plan.people[name];
    var h = hrFind_(name);
    if (h) {
      var rec = {};
      if (!h.start && p.firstDay) rec.start = p.firstDay;
      if (!h.first && p.joined) rec.first = p.firstStore;
      var fresh = p.moves.filter(function (t) { return h.moves.indexOf(t) < 0; });
      if (fresh.length) rec.moves = fresh.join(' · ') + (h.moves ? ' · ' + h.moves : '');
      if (h.state === '퇴사' && !h.end && p.quitDay) rec.end = p.quitDay;
      if (!Object.keys(rec).length) return;
      res.filled++;
      if (!dry) hrWrite_(h.row, rec);
    } else if (!inStaff[name] && p.gone) {
      res.added++;
      if (dry) return;
      var span = p.first === p.last ? p.first + '월' : p.first + '~' + p.last + '월';
      hrWrite_(0, {
        name: name, store: p.lastStore, state: '퇴사', start: p.firstDay || '', first: p.joined ? p.firstStore : '',
        moves: p.moves.join(' · '), end: p.quitDay || '',
        memo: '예전 휴무표 ' + plan.year + '년 ' + span + (p.quitDay ? (p.quitSure ? '' : ' (퇴사일은 추정)') : ' (퇴사일 모름)'),
        reg: now.date + ' 예전 휴무표에서 가져옴',
      });
    }
  });
  return res;
}

/* ───────────── 사장님: 확인할 것 모아 보기(결근?·퇴근 누락), 월차 현황 ───────────── */

/**
 * 그 달에 확인이 필요한 것을 한 곳에: 휴무표의 '결근?' 칸, 퇴근을 안 찍은 날, 출근 없이 퇴근만 찍은 날.
 * 점장은 자기 매장 직원 것만 봐요(고치는 건 사장님).
 */
function adminIssues(cred, ym) {
  var a = auth_(cred);
  var now = nowKst_();
  ym = validYm_(ym) || now.ym;
  var by = {};
  staff_().forEach(function (p) { by[p.name] = p; });
  // 점장: 자기 매장 직원만. [직원] 줄을 지운 퇴사자는 그 달 휴무표 줄의 매장으로 봐요
  var see = function (name, store) {
    if (name === TEST_NAME || name === '예시직원') return false;
    if (a.role === 'admin') return true;
    return by[name] ? canSee_(a, by[name]) : !!store && canSee_(a, { store: store });
  };
  var reqs = readReqs_();
  var g = monthGrid_(ym);
  var absent = [], left = {};
  if (g) {
    Object.keys(g.rows).forEach(function (name) {
      var r = g.rows[name];
      if (!see(name, String(r.vals[g.cols.store] || '').trim())) return;
      var lv = String(r.vals[g.cols.left] || '').trim();
      for (var d = 1; d <= daysIn_(ym); d++) {
        if (String(r.vals[g.cols.day1 + d - 1] || '').trim() !== '결근?') continue;
        var date = ym + '-' + pad2_(d);
        var asked = '';
        reqs.forEach(function (q) { if (q.name === name && q.date === date && (q.state === '대기' || q.state === '수락') && !quitHidden_(q, a)) asked = KIND_NAME[q.kind] || q.kind; });
        absent.push({ name: name, store: String(r.vals[g.cols.store] || '').trim(), date: date, dow: DOW[dowOf_(date)], asked: asked });
        if (/^-?\d+(\.\d+)?$/.test(lv)) left[name] = Number(lv);
      }
    });
  }
  var noOut = [], noIn = [];
  monthRows_(ym).forEach(function (r) {
    if (!see(r.name, r.store)) return;
    if (a.set.outCheck === '함' && r.tIn && !r.tOut && r.date < now.date) noOut.push({ name: r.name, date: r.date, dow: DOW[dowOf_(r.date)], tIn: r.tIn, sOut: r.sOut });
    if (!r.tIn && r.tOut) noIn.push({ name: r.name, date: r.date, dow: DOW[dowOf_(r.date)], tOut: r.tOut, sIn: r.sIn });
  });
  var byDate = function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : 0; };
  var block = closeBlock_(ym, now);
  // 이번 달을 보는데 지난달이 아직 마감 전이면 알려줘요(12월 2일에 [월별]을 열면 12월만 보여서 11월 정리를 놓치기 쉬워요)
  var prevOpen = null, pm = prevYm_(now.ym);
  if (a.role === 'admin' && ym === now.ym && !isClosed_(pm) && monthSheet_(pm) && started_(a.set, pm + '-' + pad2_(daysIn_(pm)))) {
    var pc = closeCheck_(pm);
    prevOpen = { ym: pm, absent: pc.absent, pending: pc.pending };
  }
  return {
    ym: ym, admin: a.role === 'admin', absent: absent.sort(byDate), noOut: noOut, noIn: noIn, left: left,
    closed: closedMonths_()[ym] || '', // 마감한 때('' = 아직)
    canClose: !block && !isClosed_(ym), closeWhy: ym >= now.ym ? '' : block,
    ledger: CLOSE_TAB + ' ' + ym.slice(0, 4), prevOpen: prevOpen,
  };
}

/**
 * '결근?' 칸을 한꺼번에 정리해요(관리자만). items: [{name, date}]
 * to: '무급' | '휴무' | '월차' | '결근'(결근으로 확정) | ''(지우기: 실제로는 나왔거나 쉬는 날이었음)
 * 누가 언제 무엇으로 바꿨는지는 그 칸 메모에 남아요.
 */
function adminFixAbsent(pin, items, to, why) {
  adminAuth_(pin);
  to = String(to == null ? '' : to).trim();
  if (['무급', '휴무', '월차', '결근', ''].indexOf(to) < 0) throw new Error('바꿀 종류를 골라주세요.');
  why = clean_(why, 60);
  var list = [].concat(items || []).slice(0, 100);
  if (!list.length) throw new Error('바꿀 날을 골라주세요.');
  var now = nowKst_(), done = 0, ym0 = '';
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    list.forEach(function (it) {
      var name = String((it && it.name) || '').trim(), date = parseDate_(it && it.date);
      if (!name || !date || dayMark_(name, date) !== '결근?') return; // 그 사이 바뀐 칸은 건드리지 않아요
      needOpen_(date);
      ym0 = ym0 || date.slice(0, 7);
      setMark_(date, name, function () { return to; });
      var g = monthGrid_(date.slice(0, 7)), r = g && g.rows[name];
      if (r) {
        g.sh.getRange(r.row, g.cols.day1 + Number(date.slice(8))).setNote(
          mmdd_(now.date) + ' ' + now.time + ' 사장님: 결근? → ' + (to || '지움') + (why ? ' (' + why + ')' : ''));
      }
      done++;
    });
  } finally {
    lock.releaseLock();
  }
  var out = adminIssues(pin, ym0 || now.ym);
  out.done = done;
  return out;
}

/** 퇴근(which='out')이나 출근('in')을 안 찍은 날에 사장님이 시간을 넣어요(관리자만). 기록 메모에 남아요. */
function adminSetTime(pin, name, date, which, time) {
  var set = adminAuth_(pin);
  name = String(name == null ? '' : name).trim();
  date = parseDate_(date);
  var raw = String(time == null ? '' : time).trim();
  var t = /^\d{1,2}:\d{2}$/.test(raw) ? parseTime_(raw) : null;
  if (!date || t == null) throw new Error('시간을 넣어주세요. (예: 21:00)');
  needOpen_(date);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = sheet_(SHEETS.log);
    var f = findLog_(sh, date, name);
    if (!f) throw new Error('그날 기록이 없어요. 새로고침 해주세요.');
    var v = f.vals.slice();
    var col = which === 'in' ? C.tIn : C.tOut, label = which === 'in' ? '출근' : '퇴근';
    var before = fmtTime_(parseTime_(v[col]));
    v[col] = fmtTime_(t);
    v[C.memo] = addMemo_(v[C.memo], '사장님이 ' + label + ' 시간 넣음: ' + fmtTime_(t) + (before ? '(이전 ' + before + ')' : ''));
    var p = findStaff_(name);
    applyCalc_(v, p ? p.wage : 0, set.grace);
    writeLog_(sh, f.row, v);
    if (which === 'in') syncLateMark_(date, name, v);
  } finally {
    lock.releaseLock();
  }
  return adminIssues(pin, date.slice(0, 7));
}

/**
 * 그 달 월차 현황 한 장: 이름·매장·이월·부여·사용(쓴 날)·잔여·만근(아니면 이유). 휴무표 탭에 계산돼 있는 값을 그대로 읽어요.
 * 점장은 자기 매장만.
 */
function adminLeave(cred, ym) {
  var a = auth_(cred);
  ym = validYm_(ym) || nowKst_().ym;
  var by = {};
  staff_().forEach(function (p) { by[p.name] = p; });
  var g = monthGrid_(ym), rows = [];
  var pg = monthGrid_(prevYm_(ym)), fx = {};
  if (g && !g.bad && g.sh.getLastRow() >= 3) {
    // 부여 칸이 수식(자동: 전달이 만근이면 1)인지, 사장님이 정한 숫자인지
    g.sh.getRange(3, g.cols.grant + 1, g.sh.getLastRow() - 2, 1).getFormulas().forEach(function (f, i) { fx[i + 3] = !!f[0]; });
  }
  if (g) {
    Object.keys(g.rows).sort(function (x, y) { return g.rows[x].row - g.rows[y].row; }).forEach(function (name) {
      var v = g.rows[name].vals, dates = [];
      // 점장: 자기 매장 직원만. [직원] 줄을 지운 퇴사자는 그 달 휴무표 줄의 매장으로 봐요
      var rowStore = String(v[g.cols.store] || '').trim();
      if (name === TEST_NAME || name === '예시직원' || !(a.role === 'admin' || (by[name] ? canSee_(a, by[name]) : !!rowStore && canSee_(a, { store: rowStore })))) return;
      var pr = pg && pg.cols.full >= 0 && pg.rows[name];
      for (var d = 1; d <= daysIn_(ym); d++) if (/월차/.test(String(v[g.cols.day1 + d - 1] || ''))) dates.push(d);
      var num = function (c) { var x = String(v[c] == null ? '' : v[c]).trim(); return /^-?\d+(\.\d+)?$/.test(x) ? Number(x) : null; };
      rows.push({
        name: name, store: String(v[g.cols.store] || '').trim(), carry: num(g.cols.grant - 1), grant: num(g.cols.grant),
        used: dates.length, dates: dates, left: num(g.cols.left),
        full: g.cols.full >= 0 ? String(v[g.cols.full] || '').trim().replace(/^[=-].*$/, '') : '',
        grantAuto: !!fx[g.rows[name].row], // false = 사장님이 정한 숫자
        prevFull: pr ? String(pr.vals[pg.cols.full] || '').trim().replace(/^[=-].*$/, '') : '', // 전달 만근(받음의 근거)
      });
    });
  }
  return { ym: ym, hasTab: !!g, rows: rows, admin: a.role === 'admin', closed: isClosed_(ym) };
}

/**
 * 월차 부여를 사장님이 정해요(그 달 휴무표 '부여' 칸). value: 'auto'(자동: 전달이 만근이면 1개) 또는 0~3개(반 개 단위).
 * 휴직·사정이 있어 만근이 아니어도 주고 싶을 때, 만근이어도 안 줄 때 써요. 정한 때와 값은 그 칸 메모에 남아요.
 */
function adminSetGrant(pin, ym, name, value) {
  adminAuth_(pin);
  ym = validYm_(ym);
  if (!ym) throw new Error('달을 골라주세요.');
  needOpen_(ym);
  name = String(name == null ? '' : name).trim();
  var auto = value === 'auto' || value === '' || value == null;
  var n = auto ? null : Number(value);
  if (!auto && !(n >= 0 && n <= 3 && Math.round(n * 2) === n * 2)) throw new Error('월차는 0~3개(반 개 단위)로 정해주세요.');
  var now = nowKst_();
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    // 예전 버전이 만든 탭은 먼저 앞 달과 이어 둬요(나중에 처음 이을 때 사장님이 정한 숫자가 수식으로 바뀌지 않게)
    if (!linked_(ym) && monthSheet_(prevYm_(ym))) relinkMonth_(ym);
    var g = monthGrid_(ym, true);
    var r = g && !g.bad && g.rows[name];
    if (!r) throw new Error('그 달 휴무표에 ' + name + ' 님 줄이 없어요.');
    if (g.cols.full < 0) throw new Error('그 달 휴무표에 만근 칸이 없어요. setup을 한 번 실행해 주세요.');
    var cell = g.sh.getRange(r.row, g.cols.grant + 1);
    if (auto) cell.setFormula(grantFormula_(monthName_(prevYm_(ym)), r.row)).setNote('');
    else cell.setValue(n).setNote(mmdd_(now.date) + ' ' + now.time + ' 사장님이 정함: ' + n + '개');
    delete GRID_[ym];
  } finally {
    lock.releaseLock();
  }
  return adminLeave(pin, ym);
}

/**
 * 지원 근무 집계: 누가 어디로 몇 번(며칠에) 갔는지, 매장마다 지원을 몇 번 받았는지.
 * 휴무표 칸에 적힌 '다른 매장 이름'으로 세요(앱이 찍을 때 적은 것, 사장님이 적은 것, 예전 휴무표에서 가져온 것 모두).
 * scope: 'YYYY-MM'(그 달) 또는 'YYYY'(그 해 전체). 점장은 자기 매장 직원과 자기 매장으로 온 지원만.
 */
function adminSupport(cred, scope) {
  var a = auth_(cred);
  var now = nowKst_();
  scope = String(scope == null ? '' : scope).trim();
  var year = validYear_(scope) || (validYm_(scope) || now.ym).slice(0, 4);
  var only = validYear_(scope) ? '' : (validYm_(scope) || now.ym);
  var data = supportDays_(year, only);
  var by = {};
  staff_().forEach(function (p) { by[p.name] = p; });
  var mine = function (store) { return a.role === 'admin' || a.stores.indexOf(store) >= 0; };
  var people = {}, into = {};
  data.forEach(function (x) {
    if (!mine(x.home) && !mine(x.to)) return;
    var p = people[x.name] = people[x.name] || { name: x.name, store: x.home, total: 0, by: {} };
    p.total++;
    var t = p.by[x.to] = p.by[x.to] || { to: x.to, n: 0, days: [] };
    t.n++;
    t.days.push(x.date.slice(5).replace('-', '/').replace(/^0/, ''));
    into[x.to] = (into[x.to] || 0) + 1;
  });
  var list = Object.keys(people).map(function (n) {
    var p = people[n];
    p.by = Object.keys(p.by).map(function (k) { return p.by[k]; }).sort(function (x, y) { return y.n - x.n; });
    p.gone = !(by[n] && by[n].active);
    return p;
  }).sort(function (x, y) { return y.total - x.total; });
  return {
    scope: only || year, year: year, month: only ? Number(only.slice(5)) : 0, total: data.filter(function (x) { return mine(x.home) || mine(x.to); }).length,
    people: list,
    stores: Object.keys(into).map(function (k) { return { store: k, n: into[k] }; }).sort(function (x, y) { return y.n - x.n; }),
  };
}

/** 그 해(only를 주면 그 달만)의 지원 근무 날 목록: [{date, name, home(그달 소속 매장), to(지원 간 매장), mark}] */
function supportDays_(year, only) {
  var names = storeNames_(), out = [];
  for (var mi = 1; mi <= 12; mi++) {
    var ym = year + '-' + pad2_(mi);
    if (only && ym !== only) continue;
    var g = monthGrid_(ym);
    if (!g) continue;
    Object.keys(g.rows).forEach(function (name) {
      if (name === TEST_NAME) return;
      var r = g.rows[name];
      var home = String(r.vals[g.cols.store] || '').trim();
      home = names[home] || home;
      for (var d = 1; d <= daysIn_(ym); d++) {
        var m = String(r.vals[g.cols.day1 + d - 1] || '').trim();
        var to = supportOf_(m, names);
        if (!to) continue;
        var dt = ym + '-' + pad2_(d), homeD = homeAt_(name, dt, home); // 달 중간에 옮겼으면 그날의 소속
        if (to !== homeD) out.push({ date: dt, name: name, home: homeD, to: to, mark: m });
      }
    });
  }
  return out.sort(function (x, y) { return x.date < y.date ? -1 : x.date > y.date ? 1 : x.name < y.name ? -1 : 1; });
}

/** '지원 YYYY' 탭: 위쪽에 사람 × 매장 횟수 표, 아래쪽에 날짜별 목록. */
function adminExportSupport(pin, year) {
  adminAuth_(pin);
  year = validYear_(year) || nowKst_().date.slice(0, 4);
  var ss = book_();
  var name = '지원 ' + year;
  var sh = ss.getSheetByName(name);
  if (sh) sh.clear(); else sh = ss.insertSheet(name);
  var days = supportDays_(year, '');
  var stores = [];
  days.forEach(function (x) { if (stores.indexOf(x.to) < 0) stores.push(x.to); });
  var order = {};
  stores_().forEach(function (st, i) { order[st.name] = i; });
  stores.sort(function (x, y) { return (order[x] == null ? 999 : order[x]) - (order[y] == null ? 999 : order[y]); });
  var per = {};
  days.forEach(function (x) {
    var p = per[x.name] = per[x.name] || { home: x.home, total: 0, by: {} };
    p.total++;
    p.home = x.home; // 가장 최근 소속
    p.by[x.to] = (p.by[x.to] || 0) + 1;
  });
  var W = Math.max(stores.length + 3, 5);
  var pad = function (r) { r = r.slice(); while (r.length < W) r.push(''); return r; };
  var out = [pad([year + '년 지원 근무 (다른 매장에서 일한 날) · 모두 ' + days.length + '번'])];
  out.push(pad(['이름', '소속 매장', '합계'].concat(stores.map(function (st) { return st + '(으)로'; }))));
  Object.keys(per).sort(function (x, y) { return per[y].total - per[x].total; }).forEach(function (n) {
    out.push(pad([n, per[n].home, per[n].total].concat(stores.map(function (st) { return per[n].by[st] || ''; }))));
  });
  out.push(pad(['지원 받은 횟수', '', days.length].concat(stores.map(function (st) { return days.filter(function (x) { return x.to === st; }).length; }))));
  var listAt = out.length + 2;
  out.push(pad([]));
  out.push(pad(['날짜', '요일', '이름', '소속 매장', '지원 간 매장']));
  days.forEach(function (x) { out.push(pad([x.date, DOW[dowOf_(x.date)], x.name, x.home, x.to])); });
  if (out.length > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), out.length - sh.getMaxRows());
  if (W > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), W - sh.getMaxColumns());
  sh.getRange(1, 1, out.length, W).setNumberFormat('@').setValues(out);
  sh.getRangeList(['A1', a1_(2, 1, 1, W), a1_(listAt, 1, 1, 5)]).setFontWeight('bold');
  sh.getRangeList([a1_(2, 1, 1, W), a1_(listAt, 1, 1, 5)]).setBackground('#eef2f7');
  sh.setFrozenRows(2);
  return { name: name, url: ss.getUrl() + '#gid=' + sh.getSheetId(), days: days.length, people: Object.keys(per).length };
}

/** '월차 YYYY' 탭(사람마다 한 줄: 지금 잔여, 올해 받음·씀, 만근 달 수, 달마다 잔여, 쓴 날, 만근 못 한 달과 이유). */
function adminExportLeave(pin, year) {
  adminAuth_(pin);
  return exportLeave_(validYear_(year) || nowKst_().date.slice(0, 4));
}

function exportLeave_(year) {
  var ss = book_();
  var name = '월차 ' + year;
  var sh = ss.getSheetByName(name);
  if (sh) {
    if (sh.getFilter()) sh.getFilter().remove();
    sh.clear();
  } else {
    sh = ss.insertSheet(name);
  }
  var data = yearData_(year, null);
  var order = {}, storeOf = {};
  sortByStore_(staff_()).forEach(function (p, i) { order[p.name] = i; storeOf[p.name] = p.store; });
  var names = Object.keys(data).filter(function (n) { return data[n].months.some(function (m) { return m.row; }); })
    .sort(function (a, b) { return (order[a] == null ? 9999 : order[a]) - (order[b] == null ? 9999 : order[b]); });
  var head = ['이름', '매장', '지금 잔여', '올해 받음', '올해 씀', '만근 달'];
  for (var mi = 1; mi <= 12; mi++) head.push(mi + '월 잔여');
  head.push('쓴 날', '만근 못 한 달(이유)');
  var rows = names.map(function (n) {
    var d = data[n], used = [], miss = [], got = 0, spent = 0, full = 0, left = '';
    var nowYm = nowKst_().ym;
    var cells = d.months.map(function (m) {
      if (!m.row) return '';
      var past = m.ym <= nowYm; // 다음 달 탭(미리 만들어 둔 것)의 부여는 아직 안 받은 거예요
      if (past) got += m.grant || 0;
      spent += m.monthly || 0;
      if (m.full === '만근') full++;
      if (/^아님/.test(m.full || '')) miss.push(m.m + '월 ' + m.full.replace(/^아님:\s*/, ''));
      if (past && m.monthlyLeft != null) left = m.monthlyLeft;
      var g = monthGrid_(m.ym), r = g && g.rows[n];
      if (r) for (var day = 1; day <= daysIn_(m.ym); day++) if (/월차/.test(String(r.vals[g.cols.day1 + day - 1] || ''))) used.push(m.m + '/' + day);
      return m.monthlyLeft == null ? '' : m.monthlyLeft;
    });
    return [n, storeOf[n] || d.store || '', left, got, spent, full].concat(cells, [used.join(', '), miss.join(' / ')]);
  });
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#eef2f7');
  if (rows.length) {
    sh.getRange(2, 1, rows.length, 2).setNumberFormat('@');
    sh.getRange(2, head.length - 1, rows.length, 2).setNumberFormat('@');
    sh.getRange(2, 1, rows.length, head.length).setValues(rows);
    sh.getRange(1, 1, rows.length + 1, head.length).createFilter();
  }
  sh.setFrozenRows(1);
  sh.setFrozenColumns(3);
  return { name: name, url: ss.getUrl() + '#gid=' + sh.getSheetId(), people: rows.length };
}

/* ───────────── 공지와 읽음 확인 ───────────── */

var NOTICE_TAB = '공지';
var NOTICE_HEAD = ['번호', '올린 때', '올린 사람', '대상', '내용', '읽음', '상태'];
var NOTICE_DAYS = 60; // 이 날수가 지난 공지는 화면에 안 보여요(시트에는 남아요)

/** [공지] 줄들(5분 동안 기억해 둬요. 많은 직원이 한꺼번에 앱을 열어도 시트를 매번 안 읽게). */
function noticeRows_() {
  return memo_('notices', function () {
    var cache = CacheService.getScriptCache();
    var hit = cache.get('notices');
    if (hit) {
      try { return JSON.parse(hit); } catch (err) { /* 다시 읽어요 */ }
    }
    var sh = book_().getSheetByName(NOTICE_TAB);
    var out = [];
    if (sh && sh.getLastRow() >= 2) {
      sh.getRange(2, 1, sh.getLastRow() - 1, NOTICE_HEAD.length).getDisplayValues().forEach(function (v, i) {
        var id = String(v[0]).trim();
        if (!id) return;
        out.push({ row: i + 2, id: id, at: String(v[1]).trim(), by: String(v[2]).trim(), to: String(v[3]).trim(), text: String(v[4]), reads: String(v[5]), state: String(v[6]).trim() });
      });
    }
    var js = JSON.stringify(out);
    if (js.length < 90000) {
      try { cache.put('notices', js, 300); } catch (err) { /* 기억 못 해도 괜찮아요 */ }
    }
    return out;
  });
}

function forgetNotices_() {
  forget_('notices');
  try { CacheService.getScriptCache().remove('notices'); } catch (err) { /* 괜찮아요 */ }
}

/** 읽음 칸('김민우 11/20 10:05 · 이지은 11/20 11:30') → {이름: '11/20 10:05'} */
function noticeReaders_(text) {
  var out = {};
  String(text || '').split(' · ').forEach(function (x) {
    var m = /^(.+) (\d{2}\/\d{2} \d{1,2}:\d{2})$/.exec(x.trim());
    if (m) out[m[1]] = m[2];
  });
  return out;
}

/** 대상 칸 → 매장 이름 목록(전체면 null). */
function noticeStores_(to) { return !to || to === '전체' ? null : String(to).split(/\s*,\s*/).filter(String); }

/** 지금 이 공지를 봐야 하는 직원(근무 중, 대상 매장). */
function noticeTargets_(n) {
  var st = noticeStores_(n.to), today = nowKst_().date;
  return staff_().filter(function (p) {
    return p.active && p.name !== TEST_NAME && (!st || st.indexOf(p.store) >= 0) && employedOn_(p.name, today);
  });
}

/** 화면에 보일 공지인지(내리지 않았고, 60일 안). */
function noticeLive_(n, today) {
  var d = parseDate_(String(n.at).slice(0, 10));
  return n.state !== '내림' && !!d && daysBetween_(d, today) <= NOTICE_DAYS;
}

/** 직원 화면: 나에게 온 공지(새것부터 10개). read = 내가 [확인했어요]를 눌렀는지. */
function noticesFor_(p, now) {
  var out = [];
  noticeRows_().forEach(function (n) {
    var st = noticeStores_(n.to);
    if (!noticeLive_(n, now.date) || (st && st.indexOf(p.store) < 0)) return;
    out.push({ id: n.id, at: n.at, by: n.by, text: n.text, read: !!noticeReaders_(n.reads)[p.name] });
  });
  out.reverse(); // 새것부터
  return out.filter(function (x) { return !x.read; }).concat(out.filter(function (x) { return x.read; }).slice(0, 10)); // 안 읽은 건 다 보여요
}

/** 사장님·점장 화면: 공지 목록과 읽은 사람·안 읽은 사람. 점장은 자기 매장 대상 공지와 자기 매장 직원만. */
function noticeView_(a) {
  var today = nowKst_().date;
  var mine = function (p) { return a.role === 'admin' || a.stores.indexOf(p.store) >= 0; };
  var list = [];
  noticeRows_().forEach(function (n) {
    if (!noticeLive_(n, today)) return;
    var st = noticeStores_(n.to);
    if (a.role !== 'admin' && st && !st.some(function (x) { return a.stores.indexOf(x) >= 0; })) return;
    var rd = noticeReaders_(n.reads);
    var targets = noticeTargets_(n).filter(mine);
    list.push({
      id: n.id, at: n.at, by: n.by, to: n.to, text: n.text, total: targets.length,
      read: targets.filter(function (p) { return rd[p.name]; }).map(function (p) { return p.name + ' ' + rd[p.name]; }),
      unread: targets.filter(function (p) { return !rd[p.name]; }).map(function (p) { return p.name; }),
      mine: a.role === 'admin' || n.by === a.name + ' 점장', // 내릴 수 있는지
    });
  });
  return list.reverse();
}

function adminNotices(cred) {
  var a = auth_(cred);
  return { list: noticeView_(a), stores: a.role === 'admin' ? stores_().map(function (st) { return st.name; }) : a.stores, admin: a.role === 'admin' };
}

/**
 * 공지 올리기. stores = 매장 이름들(비우면 전체). 점장은 자기 매장에만 올릴 수 있어요.
 * 텔레그램을 켠 대상 직원에게 바로 알리고, 직원 화면에는 [확인했어요]를 누를 때까지 맨 위에 보여요.
 */
function adminNotice(cred, text, stores) {
  var a = auth_(cred);
  text = String(text == null ? '' : text).replace(/\r\n?/g, '\n').trim().slice(0, 1000);
  if (!text) throw new Error('공지 내용을 적어주세요.');
  var all = stores_().map(function (st) { return st.name; });
  var pick = [].concat(stores || []).map(function (x) { return String(x).trim(); }).filter(function (x, i, arr) { return all.indexOf(x) >= 0 && arr.indexOf(x) === i; });
  if (a.role !== 'admin') {
    pick = pick.length ? pick.filter(function (x) { return a.stores.indexOf(x) >= 0; }) : a.stores.slice();
    if (!pick.length) throw new Error('우리 매장에만 공지를 올릴 수 있어요.');
  }
  var to = !pick.length || (a.role === 'admin' && pick.length === all.length) ? '전체' : pick.join(', ');
  var now = nowKst_();
  var n;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var sh = ensureSheet_(book_(), NOTICE_TAB, NOTICE_HEAD, [], NOTICE_HEAD.map(function () { return '@'; }));
    var id = 'N' + Date.now().toString(36).toUpperCase();
    noticeRows_().forEach(function (x) { if (x.id === id) id += '-2'; });
    var row = Math.max(sh.getLastRow(), 1) + 1;
    n = { id: id, at: now.date + ' ' + now.time, by: a.role === 'admin' ? '사장님' : a.name + ' 점장', to: to, text: text };
    sh.getRange(row, 1, 1, NOTICE_HEAD.length).setNumberFormat('@').setValues([[n.id, n.at, n.by, n.to, n.text, '', '']]);
    forgetNotices_();
  } finally {
    lock.releaseLock();
  }
  // 알림은 줄(잠금) 밖에서
  var sent = 0;
  noticeTargets_(n).forEach(function (p) {
    if (notifyStaff_(a.set, p, '새 공지 (' + n.by + ')', text.slice(0, 300) + (text.length > 300 ? '…' : '') + '\n출퇴근 앱을 열고 [확인했어요]를 눌러주세요.')) sent++;
  });
  var res = adminNotices(cred);
  res.done = '공지를 올렸어요(' + to + ').' + (sent ? ' 텔레그램으로 ' + sent + '명에게 알렸어요.' : '') + ' 직원이 앱을 열면 맨 위에 보여요.';
  return res;
}

/** 공지 내리기: 직원 화면에서 사라져요(시트에는 '내림'으로 남아요). 점장은 자기가 올린 것만. */
function adminNoticeOff(cred, id) {
  var a = auth_(cred);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    forgetNotices_();
    var n = null;
    noticeRows_().forEach(function (x) { if (x.id === String(id)) n = x; });
    if (!n) throw new Error('공지를 찾을 수 없어요. 새로고침 해주세요.');
    if (a.role !== 'admin' && n.by !== a.name + ' 점장') throw new Error('직접 올린 공지만 내릴 수 있어요.');
    book_().getSheetByName(NOTICE_TAB).getRange(n.row, 7).setNumberFormat('@').setValue('내림');
    forgetNotices_();
  } finally {
    lock.releaseLock();
  }
  var res = adminNotices(cred);
  res.done = '공지를 내렸어요. 직원 화면에서 사라져요(시트 [공지] 탭에는 남아요).';
  return res;
}

/** 아직 안 읽은 사람에게 텔레그램으로 다시 알려요. 텔레그램을 안 켠 사람은 이름을 돌려줘요(직접 알려야 해요). */
function adminNoticeRemind(cred, id) {
  var a = auth_(cred);
  var v = null;
  noticeView_(a).forEach(function (x) { if (x.id === String(id)) v = x; });
  if (!v) throw new Error('공지를 찾을 수 없어요. 새로고침 해주세요.');
  if (!v.unread.length) throw new Error('모두 읽었어요.');
  var sent = 0, no = [];
  v.unread.forEach(function (name) {
    if (notifyStaff_(a.set, findStaff_(name), '공지를 아직 안 읽었어요', v.text.slice(0, 300) + (v.text.length > 300 ? '…' : '') + '\n출퇴근 앱을 열고 [확인했어요]를 눌러주세요.')) sent++;
    else no.push(name);
  });
  var res = adminNotices(cred);
  res.done = (sent ? sent + '명에게 텔레그램으로 다시 알렸어요.' : '텔레그램으로 알릴 수 있는 사람이 없어요.') +
    (no.length ? ' 텔레그램을 안 켠 ' + no.join(', ') + ' 님에게는 직접 알려주세요.' : '');
  return res;
}

/** 직원 화면: 공지 [확인했어요]. 읽은 때가 [공지] 탭 읽음 칸에 남아요. */
function noticeRead(name, pin, id) {
  var p = person_(name);
  checkPin_(p, pin);
  var now = nowKst_();
  var lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    forgetNotices_();
    var n = null;
    noticeRows_().forEach(function (x) { if (x.id === String(id)) n = x; });
    var st = n ? noticeStores_(n.to) : null;
    if (!n || n.state === '내림' || (st && st.indexOf(p.store) < 0)) throw new Error('공지를 찾을 수 없어요. 새로고침 해주세요.');
    if (!noticeReaders_(n.reads)[p.name]) {
      var txt = (String(n.reads).trim() ? String(n.reads).trim() + ' · ' : '') + p.name + ' ' + mmdd_(now.date) + ' ' + now.time;
      book_().getSheetByName(NOTICE_TAB).getRange(n.row, 6).setNumberFormat('@').setValue(txt);
      forgetNotices_();
    }
  } finally {
    lock.releaseLock();
  }
  return noticesFor_(p, now);
}

/* ───────────── 월 마감 ───────────── */

var CLOSE_TAB = '월 마감'; // 뒤에 연도를 붙여요: '월 마감 2026'
var CLOSE_HEAD = ['월', '매장', '이름', '출근 기록(일)', '휴무', '월차 씀', '이월', '부여', '월차 남음', '지각(회)', '지각(분)', '결근', '지원(회)', '만근', '마감한 때'];

/** 마감한 달들. {'2026-10': '2026-11-03 14:20'} (스크립트 속성) */
function closedMonths_() {
  return memo_('closedMonths', function () {
    try { return JSON.parse(PropertiesService.getScriptProperties().getProperty('monthClosed') || '{}') || {}; } catch (err) { return {}; }
  });
}

function isClosed_(ym) { return !!closedMonths_()[String(ym || '').slice(0, 7)]; }

/** 그 날짜(또는 달)가 마감된 달이면 막아요. */
function needOpen_(date) {
  var ym = String(date || '').slice(0, 7);
  if (isClosed_(ym)) throw new Error(Number(ym.slice(5)) + '월은 마감한 달이라 바꿀 수 없어요. 꼭 고쳐야 하면 사장님 화면 [월별]에서 마감을 취소한 뒤 해주세요.');
}

/** 그 달의 기다리는 요청 수, 남은 '결근?' 칸 수(마감 전에 확인할 것). */
function closeCheck_(ym) {
  var pending = 0, absent = 0;
  readReqs_().forEach(function (r) { if ((r.state === '대기' || r.state === '수락') && String(r.date).slice(0, 7) === ym) pending++; });
  var g = monthGrid_(ym);
  if (g) {
    Object.keys(g.rows).forEach(function (n) {
      if (n === TEST_NAME || n === '예시직원') return;
      for (var d = 1; d <= daysIn_(ym); d++) if (String(g.rows[n].vals[g.cols.day1 + d - 1] || '').trim() === '결근?') absent++;
    });
  }
  return { pending: pending, absent: absent };
}

/** 지금 그 달을 마감할 수 있는지. 안 되면 이유(글), 되면 ''. */
function closeBlock_(ym, now) {
  if (ym >= now.ym) return '달이 끝난 뒤에 마감할 수 있어요.';
  if (!monthSheet_(ym)) return '그 달 휴무표 탭이 없어요.';
  var last = ym + '-' + pad2_(daysIn_(ym));
  if (addDays_(last, 1) === now.date && now.min < 6 * 60 && !PropertiesService.getScriptProperties().getProperty('close:' + last)) {
    return '어젯밤 하루 마감 정리가 아직 안 끝났어요. 아침 6시 뒤에 해주세요.';
  }
  return '';
}

/**
 * 월 마감(관리자만): 끝난 달을 잠가요.
 *  1) 그달 숫자(출근 기록·휴무·월차·지각·결근·지원·만근)를 '월 마감 YYYY' 탭에 사람마다 한 줄씩 적어 둬요(나중에 따질 때의 근거)
 *  2) 그달 날짜로는 정정·휴무 요청, 시간 고치기, '결근?' 정리, 예전 휴무표 다시 가져오기를 막아요
 *  3) 그달 휴무표 탭은 손으로 고치려 하면 경고가 뜨고(보호: 경고만), 탭 색이 회색이 돼요
 * 기다리는 요청이나 '결근?'이 남아 있으면 먼저 알려줘요(force = 그래도 마감). 마감 취소는 adminMonthOpen.
 */
function adminMonthClose(pin, ym, force) {
  adminAuth_(pin);
  var now = nowKst_();
  ym = validYm_(ym);
  if (!ym) throw new Error('마감할 달을 골라주세요.');
  var out;
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (isClosed_(ym)) throw new Error('이미 마감한 달이에요.');
    var block = closeBlock_(ym, now);
    if (block) throw new Error(block);
    var chk = closeCheck_(ym);
    if (chk.pending) throw new Error('그달 날짜로 기다리는 요청이 ' + chk.pending + '건 있어요. 먼저 승인하거나 거절한 뒤 마감해주세요.');
    if (chk.absent && !force) return { ym: ym, need: true, absent: chk.absent }; // 화면이 한 번 더 물어봐요
    var stamp = now.date + ' ' + now.time;
    out = closeBook_(ym, stamp);
    var map = closedMonths_();
    map[ym] = stamp;
    PropertiesService.getScriptProperties().setProperty('monthClosed', JSON.stringify(map));
    try { // 보호·탭 색은 꾸밈이라, 실패해도 마감은 된 거예요
      var sh = monthSheet_(ym);
      closeUnprotect_(sh);
      // 사장님이 따로 걸어 둔 보호가 있으면 그대로 둬요(protect()는 이미 보호된 탭이면 그 보호를 돌려줘서, 바꾸면 사장님 보호가 풀려요)
      if (!sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).length) sh.protect().setDescription(CLOSE_TAB + ' ' + stamp).setWarningOnly(true);
      sh.setTabColor('#9ca3af');
    } catch (err) {
      console.error(err);
    }
  } finally {
    lock.releaseLock();
  }
  var res = adminIssues(pin, ym);
  res.done = Number(ym.slice(5)) + '월을 마감했어요. ' + out.people + '명의 숫자를 [' + out.name + '] 탭에 적어 뒀어요.';
  res.ledgerUrl = out.url;
  return res;
}

/** 월 마감 취소: 다시 고칠 수 있게 열어요. 장부 탭의 그달 줄은 다음에 마감할 때 새로 적혀요. */
function adminMonthOpen(pin, ym) {
  adminAuth_(pin);
  ym = validYm_(ym);
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    if (!ym || !isClosed_(ym)) throw new Error('마감한 달이 아니에요.');
    var map = closedMonths_();
    delete map[ym];
    PropertiesService.getScriptProperties().setProperty('monthClosed', JSON.stringify(map));
    try {
      var sh = monthSheet_(ym);
      if (sh) { closeUnprotect_(sh); sh.setTabColor(null); }
    } catch (err) {
      console.error(err);
    }
  } finally {
    lock.releaseLock();
  }
  var res = adminIssues(pin, ym);
  res.done = Number(ym.slice(5)) + '월 마감을 취소했어요. 고친 뒤 다시 마감하면 장부도 새로 적혀요.';
  return res;
}

/** 월 마감 때 걸어 둔 보호(경고)만 풀어요. 사장님이 따로 건 보호는 그대로 둬요. */
function closeUnprotect_(sh) {
  sh.getProtections(SpreadsheetApp.ProtectionType.SHEET).forEach(function (pr) {
    if (String(pr.getDescription() || '').indexOf(CLOSE_TAB) === 0) pr.remove();
  });
}

/**
 * '월 마감 YYYY' 탭에 그달 줄을 적어요. 그달 줄이 이미 있으면(마감 취소 뒤 다시 마감) 그 줄들을 빼고 맨 아래에 새로 붙여요.
 * 탭을 통째로 지우지 않아서 사장님이 오른쪽에 붙인 칸·메모는 그 줄과 같이 남아요. 칸 위치는 머리글 이름으로 찾아요.
 */
function closeBook_(ym, stamp) {
  var year = ym.slice(0, 4), mi = Number(ym.slice(5));
  // 먼저 숫자를 다 계산해요(계산하다 오류가 나도 장부는 그대로 남게)
  var data = yearData_(year, null);
  var g = monthGrid_(ym);
  var num = function (v, c) { var x = String(v[c] == null ? '' : v[c]).trim(); return /^-?\d+(\.\d+)?$/.test(x) ? Number(x) : ''; };
  var rows = [];
  Object.keys(g.rows).sort(function (a, b) { return g.rows[a].row - g.rows[b].row; }).forEach(function (n) {
    if (n === TEST_NAME || n === '예시직원') return;
    var m = data[n] && data[n].months[mi - 1];
    if (!m) return;
    var v = g.rows[n].vals;
    rows.push([ym, m.store, n, m.days, m.off, m.monthly, num(v, g.cols.grant - 1), m.grant == null ? '' : m.grant, m.monthlyLeft == null ? '' : m.monthlyLeft,
      m.lateCount, m.lateMin, m.absent, m.sup, m.full, stamp]);
  });
  var ss = book_();
  var name = CLOSE_TAB + ' ' + year;
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, CLOSE_HEAD.length).setValues([CLOSE_HEAD]).setFontWeight('bold').setBackground('#eef2f7');
    sh.setFrozenRows(1);
    sh.setFrozenColumns(3);
  }
  var head = sh.getRange(1, 1, 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues()[0].map(function (x) { return String(x).trim(); });
  var col = CLOSE_HEAD.map(function (h) {
    var c = head.indexOf(h);
    if (c < 0) { c = head.length; head.push(h); sh.getRange(1, c + 1).setValue(h).setFontWeight('bold').setBackground('#eef2f7'); } // 지운 머리글은 끝에 다시
    return c;
  });
  var width = head.length;
  if (sh.getFilter()) sh.getFilter().remove(); // 거르기를 풀어야 줄을 빼고 붙일 수 있어요(값은 그대로)
  var last = sh.getLastRow();
  if (last >= 2) {
    // 그달 줄(이전 마감)을 아래에서부터 빼요. 이어진 줄은 한 번에
    var months = sh.getRange(2, col[0] + 1, last - 1, 1).getDisplayValues();
    for (var k = months.length - 1; k >= 0;) {
      if (String(months[k][0]).trim() !== ym) { k--; continue; }
      var end = k;
      while (k - 1 >= 0 && String(months[k - 1][0]).trim() === ym) k--;
      sh.deleteRows(k + 2, end - k + 1);
      k--;
    }
  }
  if (rows.length) {
    var start = Math.max(sh.getLastRow(), 1) + 1;
    if (start + rows.length - 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), rows.length + 20);
    var out = rows.map(function (r) {
      var line = [];
      for (var x = 0; x < width; x++) line.push('');
      r.forEach(function (val, i2) { line[col[i2]] = val; });
      return line;
    });
    [0, 1, 2, 13, 14].forEach(function (k) { sh.getRange(start, col[k] + 1, out.length, 1).setNumberFormat('@'); }); // 월·매장·이름·만근·마감한 때만 글자로
    sh.getRange(start, 1, out.length, width).setValues(out);
  }
  if (sh.getLastRow() >= 2) sh.getRange(1, 1, sh.getLastRow(), width).createFilter();
  return { name: name, url: ss.getUrl() + '#gid=' + sh.getSheetId(), people: rows.length };
}

/* ───────────── 내부 함수 ───────────── */

function book_() { return SHEET_ID ? SpreadsheetApp.openById(SHEET_ID) : SpreadsheetApp.getActiveSpreadsheet(); }

/** 따로 만든 스크립트에서 시트를 고쳤을 때 불려요 (setup이 연결). */
function sheetEdited(e) { onEdit(e); }

function sheet_(name) {
  var sh = book_().getSheetByName(name);
  if (!sh) throw new Error("'" + name + "' 시트가 없어요. 사장님이 [처음 설정]을 먼저 실행해야 해요.");
  return sh;
}

/** 머리글을 뺀 모든 줄을 화면에 보이는 글자 그대로 읽어요. */
/**
 * 작은 탭([설정]·[매장]·[직원]·[인사]·[근무변경]) 전체(머리글 포함)를 한 번에 읽어요. 이번 실행에서 한 번만(시트를 부르는 횟수를 줄여서 빨라요).
 * 그 탭에 쓰면 그 탭 기억을 잊어요(forget_가 함께 잊어요). 없는 탭이면 null.
 */
function snap_(name) {
  return memo_('snap:' + name, function () {
    var sh = book_().getSheetByName(name);
    return sh ? sh.getDataRange().getDisplayValues() : null;
  });
}

function rows_(name) {
  var v = snap_(name);
  if (!v) sheet_(name); // 없는 탭: 예전처럼 알아듣게 오류
  return v && v.length >= 2 ? v.slice(1) : [];
}

function ensureSheet_(ss, name, head, sample, fmts) {
  var sh = ss.getSheetByName(name);
  if (sh) {
    // 미리 만들어 둔 탭이면 머리글이 비었을 때만 채우고, 칸 서식을 맞춰요(기존 값은 그대로)
    if (sh.getLastRow() < 1) sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#eef2f7');
    if (name !== SHEETS.staff && name !== SHEETS.hr) colFormats_(sh, 1, fmts); // [직원]·[인사]는 칸 이름으로 맞춰요(사장님이 붙인 칸은 그대로)
    return sh;
  }
  sh = ss.insertSheet(name);
  sh.getRange(1, 1, 1, head.length).setValues([head])
    .setFontWeight('bold').setBackground('#eef2f7');
  sh.setFrozenRows(1);
  colFormats_(sh, 1, fmts);
  if (sample.length) sh.getRange(2, 1, sample.length, sample[0].length).setValues(sample);
  return sh;
}

/**
 * 2행부터 끝까지 칸 서식. fmts[i] = (first+i)번째 칸 서식(null이면 건너뜀).
 * 같은 서식이 이어진 칸은 한 번에 맞춰요(시트 작업 수를 줄여서 setup이 빨라요).
 */
function colFormats_(sh, first, fmts) {
  var rows = sh.getMaxRows() - 1;
  if (rows < 1) return;
  for (var i = 0; i < fmts.length;) {
    var j = i;
    while (j + 1 < fmts.length && fmts[j + 1] === fmts[i]) j++;
    if (fmts[i] != null) sh.getRange(2, first + i, rows, j - i + 1).setNumberFormat(fmts[i]);
    i = j + 1;
  }
}

/** (줄, 칸, 줄 수, 칸 수) → 'A5:AO5' */
function a1_(r, c, nr, nc) {
  return colA1_(c) + r + ((nr || 1) > 1 || (nc || 1) > 1 ? ':' + colA1_(c + (nc || 1) - 1) + (r + (nr || 1) - 1) : '');
}

function settings_() { return memo_('set', readSettings_); }

/** '본인 결혼 5, 자녀 결혼 1일' → [{name: '본인 결혼', days: 5}, {name: '자녀 결혼', days: 1}]. 숫자가 없는 칸은 빼요. */
function leaveRules_(text) {
  var out = [];
  String(text == null ? '' : text).split(/[,\n]/).forEach(function (x) {
    var m = /^(.*?\S)\s*(\d{1,3})\s*일?$/.exec(String(x).trim());
    if (m && Number(m[2]) > 0 && !out.some(function (o) { return o.name === m[1].trim(); })) out.push({ name: m[1].trim().slice(0, 20), days: Number(m[2]) });
  });
  return out;
}

function readSettings_() {
  var map = {};
  rows_(SHEETS.set).forEach(function (r) {
    var k = String(r[0]).trim();
    if (k) map[k] = String(r[1] == null ? '' : r[1]).trim();
  });
  function num(k, d) {
    var s = map[k];
    if (s === undefined || s === '') return d;
    var n = Number(s.replace(/[^\d.\-]/g, ''));
    return isNaN(n) ? d : n;
  }
  var mode = map[K.mode] || '필수';
  mode = /안/.test(mode) ? '안함' : /기록/.test(mode) ? '기록만' : '필수';
  return {
    store: map[K.store] || '출퇴근',
    adminPin: map[K.adminPin] || '',
    radius: num(K.radius, 100),
    mode: mode,
    device: /안/.test(map[K.device] || '') ? '안함' : '필수',
    grace: num(K.grace, 0),
    email: map[K.email] || '',
    alertMin: num(K.alertMin, 10),
    tgToken: map[K.tgToken] || '',
    tgChat: map[K.tgChat] || '',
    tgBot: String(map[K.tgBot] || '').replace(/^@/, ''),
    remind: num(K.remind, 20),
    mgrAlert: /끔|꺼|안|아니|off|^\s*[xn×]\s*$/i.test(map[K.mgrAlert] || '') ? '끔' : '켬', // 줄이 없어도(setup 전) 켬
    outCheck: /^\s*(함|켬|on|예|o|필수)\s*$/i.test(map[K.outCheck] || '') ? '함' : '안함', // 퇴근 안 찍음 알림·안내(기본 안함)
    wishWin: map[K.wishWin] === undefined ? '20-25' : map[K.wishWin],
    wishBlock: map[K.wishBlock] || '',
    holAdd: map[K.holAdd] || '',
    holDel: map[K.holDel] || '',
    subMode: /안/.test(map[K.subMode] || '') ? '안함' : /공휴/.test(map[K.subMode] || '') ? '휴무날·공휴일' : '휴무날만',
    startDate: parseDate_(map[K.start] || ''), // '' = 아직 시작 전
    alias: map[K.alias] === undefined ? OLD_ALIAS : map[K.alias],
    oldSrc: map[K.oldSrc] || '',
    backup: /끔|꺼|안|아니|off|^\s*[xn×]\s*$/i.test(map[K.backup] || '') ? '끔' : '켬', // 줄이 없어도(setup 전) 켬
    joinCode: String(map[K.joinCode] || '').replace(/\D/g, ''),
    docsIn: map[K.docsIn] === undefined ? DOCS_IN : map[K.docsIn],
    docsOut: map[K.docsOut] === undefined ? DOCS_OUT : map[K.docsOut],
    probMonths: Math.max(0, Math.min(24, Math.floor(num(K.probMonths, 3)))), // 수습 개월(0 = 안 채움)
    leaveRules: leaveRules_(map[K.leaveRule] === undefined ? LEAVE_RULE : map[K.leaveRule]), // 경조 휴가 규정 [{name, days}]
    hrMust: /안/.test(map[K.hrMust] || '') ? '안함' : '필수', // 줄이 없어도(새 버전을 붙여넣고 setup 전) 필수
  };
}

/** 그날이 앱 시작일 이후인지. 시작일이 비어 있으면 아직 시작 전이에요(미출근 알림·결근?·마감 알림을 안 해요). */
function started_(set, date) { return !!set.startDate && date >= set.startDate; }

/**
 * 앱 시작 전 날짜에 앱이 적은 '결근?'을 지워요(직원들이 아직 안 찍는데 밤 마감이 적어 버린 것).
 * 딱 '결근?'인 칸만 지우고, 사장님이 적은 '결근'·'무단'은 그대로 둬요. 지운 칸 수를 돌려줘요.
 */
function clearEarlyAbsent_(set) {
  var now = nowKst_();
  var n = 0;
  [prevYm_(now.ym), now.ym, nextYm_(now.ym)].forEach(function (ym) {
    var g = monthGrid_(ym, true);
    if (!g) return;
    var days = daysIn_(ym);
    Object.keys(g.rows).forEach(function (name) {
      var r = g.rows[name];
      var hit = false, vals = [];
      for (var d = 1; d <= days; d++) {
        var v = String(r.vals[g.cols.day1 + d - 1] || '');
        var early = !set.startDate || ym + '-' + pad2_(d) < set.startDate;
        if (early && v.trim() === '결근?') { v = ''; hit = true; n++; }
        vals.push(v);
      }
      if (hit) g.sh.getRange(r.row, g.cols.day1 + 1, 1, days).setValues([vals]);
    });
    delete GRID_[ym];
  });
  return n;
}

/**
 * 사장님 화면 [설정]: 앱 시작일 정하기. date가 비면 '시작 전'으로 되돌려요.
 * 시작일 전 날짜에 잘못 적힌 '결근?'은 같이 지워요.
 */
function adminSetStart(pin, date) {
  adminAuth_(pin);
  var raw = String(date == null ? '' : date).trim();
  var d = parseDate_(raw);
  if (raw && !d) throw new Error('날짜를 확인해주세요. (예: 2026-12-01)');
  var now = nowKst_();
  if (d && daysBetween_(now.date, d) > 366) throw new Error('시작일이 너무 먼 날짜예요. 다시 확인해주세요.');
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  var cleared = 0;
  try {
    setSetting_(K.start, d);
    cleared = clearEarlyAbsent_(settings_());
  } finally {
    lock.releaseLock();
  }
  var out = adminToday(pin);
  out.cleared = cleared;
  return out;
}

function setSetting_(key, value) {
  var sh = sheet_(SHEETS.set);
  var rows = rows_(SHEETS.set);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === key) {
      sh.getRange(i + 2, 2).setNumberFormat('@').setValue(String(value));
      forget_('set');
      forget_('hol');
      return;
    }
  }
  sh.appendRow([key, String(value), '']);
  forget_('set');
  forget_('hol');
}

/**
 * 칸 순서가 정해진 탭([요청], [출퇴근기록])에 새 버전 칸(from번째부터)을 맞춰요.
 * 그 자리에 사장님이 따로 쓰던 칸(다른 머리글이나, 머리글 없이 적힌 값)이 있으면
 * 그 칸들을 오른쪽으로 밀고 새 칸을 끼워 넣어요. 빈 머리글은 채워요.
 */
function addTailCols_(sh, head, from) {
  var extra = head.length - from;
  var rh = sh.getRange(1, 1, 1, head.length).getDisplayValues()[0];
  var clash = rh.slice(from).some(function (h, i) { h = String(h).trim(); return h && h !== head[from + i]; });
  if (!clash && !String(rh[from]).trim() && sh.getLastRow() > 1) {
    clash = sh.getRange(2, from + 1, sh.getLastRow() - 1, extra).getDisplayValues().some(function (row) {
      return row.some(function (x) { return String(x).trim(); });
    });
  }
  if (clash) {
    sh.insertColumnsBefore(from + 1, extra);
    sh.getRange(2, from + 1, sh.getMaxRows() - 1, extra).setNumberFormat('@');
    rh = sh.getRange(1, 1, 1, head.length).getDisplayValues()[0];
  }
  if (rh.some(function (h) { return !String(h).trim(); })) {
    sh.getRange(1, 1, 1, head.length).setValues([head.map(function (h, i) { return String(rh[i]).trim() || h; })])
      .setFontWeight('bold').setBackground('#eef2f7');
  }
}

/** [출퇴근기록] 색칠: 토요일 줄 파랑·일요일 줄 빨강, 지각 칸 빨간 글씨, 퇴근 안 찍은 칸 노랑. */
function logRules_(sh) {
  var n = Math.max(sh.getMaxRows() - 1, 1), w = LOG_HEAD.length;
  var all = sh.getRange(2, 1, n, w);
  var rule = function (rg) { return SpreadsheetApp.newConditionalFormatRule().setRanges([rg]); };
  sh.setConditionalFormatRules([
    rule(sh.getRange(2, C.late + 1, n, 1)).whenFormulaSatisfied('=N($H2)>0').setFontColor('#c62828').setBold(true).build(),
    rule(sh.getRange(2, C.tOut + 1, n, 1)).whenFormulaSatisfied('=AND($F2<>"",$G2="",$A2<>"",$A2<TEXT(TODAY(),"yyyy-mm-dd"))').setBackground('#fef08a').build(),
    rule(all).whenFormulaSatisfied('=$B2="토"').setBackground('#eff6ff').build(),
    rule(all).whenFormulaSatisfied('=$B2="일"').setBackground('#fef2f2').build(),
  ]);
  sh.setColumnWidth(C.memo + 1, 260);
}

/** 상태 칸(col, 1부터) 글자에 따라 칸 배경을 칠해요. pairs = [[글자, 색], …] */
function statusRules_(sh, col, pairs) {
  var rg = sh.getRange(2, col, Math.max(sh.getMaxRows() - 1, 1), 1);
  sh.setConditionalFormatRules(pairs.map(function (x) {
    return SpreadsheetApp.newConditionalFormatRule().whenTextEqualTo(x[0]).setBackground(x[1]).setRanges([rg]).build();
  }));
}

/** 머리글로 칸을 찾는 탭에서, 없는 머리글을 오른쪽 끝에 붙여요. 머리글 → 칸 번호(0부터)를 돌려줘요. */
function addHeads_(sh, heads) {
  var width = Math.max(sh.getLastColumn(), 1);
  var col = {};
  sh.getRange(1, 1, 1, width).getDisplayValues()[0].forEach(function (h, i) {
    h = String(h).trim();
    if (h && col[h] == null) col[h] = i;
  });
  heads.forEach(function (h) {
    if (col[h] != null) return;
    var c = Math.max(sh.getLastColumn(), 1) + 1;
    if (c > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), 1);
    sh.getRange(1, c).setValue(h).setFontWeight('bold').setBackground('#eef2f7');
    sh.getRange(2, c, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    col[h] = c - 1;
  });
  return col;
}

/** [직원] 머리글 → 칸 번호(0부터). */
function staffCols_() { return memo_('staffCols', readStaffCols_); }

function readStaffCols_() {
  var v = snap_(SHEETS.staff);
  if (!v) sheet_(SHEETS.staff);
  var col = {};
  if (!v || !v.length) return col;
  v[0].forEach(function (h, i) {
    h = String(h).trim();
    if (h && col[h] == null) col[h] = i;
  });
  return col;
}

function staff_() { return memo_('staff', readStaff_); }

function readStaff_() {
  var col = staffCols_();
  function get(r, k) { var i = col[k]; return i == null || r[i] == null ? '' : String(r[i]).trim(); }
  var out = [];
  rows_(SHEETS.staff).forEach(function (r, i) {
    var name = get(r, '이름');
    if (!name) return;
    out.push({
      row: i + 2,
      name: name,
      store: get(r, '매장'),
      pin: get(r, 'PIN'),
      wage: toNum_(get(r, '시급')),
      week: DOW.map(function (d) { return get(r, d); }), // 일(0) 월(1) … 토(6)
      active: !/^\s*(x|×|퇴사|아니오?|n)\s*$/i.test(get(r, '재직')),
      device: get(r, '등록폰'),
      deviceId: devId_(get(r, '등록폰')),
      deviceIds: devIds_(get(r, '등록폰')), // 등록된 폰(2대까지)
      request: get(r, '새폰요청'),
      agreed: !!get(r, '동의'),
      tg: get(r, '텔레그램'), // 텔레그램 채팅 번호(직원이 앱에서 알림을 켜면 채워져요)
    });
  });
  return out;
}

function setStaffCell_(row, key, value) {
  var sh = sheet_(SHEETS.staff);
  var i = staffCols_()[key];
  if (i == null) {
    // 새 버전에서 늘어난 칸(예: 동의)은 오른쪽 끝에 알아서 붙여요
    i = Math.max(sh.getLastColumn(), 1);
    if (i + 1 > sh.getMaxColumns()) sh.insertColumnsAfter(sh.getMaxColumns(), 1);
    sh.getRange(1, i + 1).setValue(key).setFontWeight('bold').setBackground('#eef2f7');
    forget_('staffCols');
  }
  sh.getRange(row, i + 1).setNumberFormat('@').setValue(value);
  forget_('staff');
}

/** [매장] 탭: 이름, 기본 출근·퇴근, 위치, 점장, 휴무 규칙. 칸은 머리글 이름으로 찾아요(없으면 원래 순서). */
function stores_() { return memo_('stores', readStores_); }

function readStores_() {
  var vals = snap_(SHEETS.store);
  if (!vals || vals.length < 2) return [];
  var col = {};
  vals[0].forEach(function (h, i) { h = String(h).trim(); if (h && col[h] == null) col[h] = i; });
  var at = function (k, d) { return col[k] != null ? col[k] : d; };
  var get = function (r, k, d) { var i = at(k, d); return i == null || r[i] == null ? '' : String(r[i]).trim(); };
  var out = [];
  for (var i = 1; i < vals.length; i++) {
    var r = vals[i];
    var name = get(r, '매장', 0);
    if (!name) continue;
    var lat = get(r, '위도', 3), lng = get(r, '경도', 4), max = get(r, '최대휴무');
    out.push({
      row: i + 1, name: name, open: parseTime_(get(r, '출근', 1)), close: parseTime_(get(r, '퇴근', 2)),
      lat: lat && isFinite(Number(lat)) ? Number(lat) : null,
      lng: lng && isFinite(Number(lng)) ? Number(lng) : null,
      radius: toNum_(get(r, '반경(m)', 5)) || null,
      managers: splitNames_(get(r, '점장')),
      maxOff: max === '' ? 1 : Math.max(0, Math.floor(toNum_(max))), // 0 = 제한 없음
      monthOff: Math.max(0, Math.floor(toNum_(get(r, '월휴무')))), // 0 = 제한 없음
      minStaff: get(r, '최소인원') === '' ? null : Math.max(0, Math.floor(toNum_(get(r, '최소인원')))), // null = 아무도 없을 때만 알림, 0 = 안 알림
      cLat: at('위도', 3), cLng: at('경도', 4),
    });
  }
  return out;
}

function storeOf_(name) {
  var st = null;
  stores_().forEach(function (x) { if (x.name === name) st = x; });
  return st;
}

/** 그 매장 점장 이름들(재직 중인 직원만). except 는 빼요(점장 본인 요청은 관리자에게). */
function managersOf_(store, except) {
  var st = storeOf_(store);
  if (!st) return [];
  var active = {};
  staff_().forEach(function (p) { if (p.active) active[p.name] = true; });
  return st.managers.filter(function (n) { return active[n] && n !== except; });
}

function splitNames_(s) {
  return String(s == null ? '' : s).split(/[\s,\/·]+/).map(function (x) { return x.trim(); }).filter(String);
}

/** 이름으로 직원 찾기(퇴사자 포함). 없으면 null. */
function findStaff_(name) {
  var p = null;
  staff_().forEach(function (x) { if (x.name === name && (!p || x.active || !p.active)) p = x; }); // 같은 이름이 두 줄이면 근무 중인 줄
  return p;
}

/** [직원] 탭에 근무 중인 같은 이름이 두 줄 이상인 이름들(기록이 이름으로 묶여서 섞여요. 구분 글자를 붙여야 해요). */
function dupNames_() {
  var n = {}, out = [];
  staff_().forEach(function (p) { if (p.active) n[p.name] = (n[p.name] || 0) + 1; });
  Object.keys(n).forEach(function (k) { if (n[k] > 1) out.push(k); });
  return out;
}

/** 매장 순서([매장] 탭 순서), 같은 매장은 [직원] 탭 순서. */
function sortByStore_(people, stores) {
  var order = {};
  (stores || stores_()).forEach(function (st, i) { order[st.name] = i; });
  return people.slice().sort(function (a, b) {
    var x = order[a.store] == null ? 999 : order[a.store], y = order[b.store] == null ? 999 : order[b.store];
    return x - y || a.row - b.row;
  });
}

function person_(name, list) {
  name = String(name == null ? '' : name).trim();
  list = list || staff_();
  for (var i = 0; i < list.length; i++) {
    if (list[i].name === name && list[i].active) return list[i];
  }
  throw new Error('직원 명단에 없는 이름이에요. 화면을 새로고침 해주세요.');
}

/**
 * 그날 근무시간 {start, end|null}, 쉬는 날이면 null. 정하는 순서:
 *  1) [근무변경]에 그날 줄이 있으면 그것  2) 휴무표 그날 칸에 휴무·월차·반차 등이 있으면 쉼
 *  3) [직원]의 그 요일 칸(사무실처럼 사람마다 다를 때)  4) [매장]의 기본 출근·퇴근 시간
 */
function schedFor_(p, date, ctx) {
  if (Array.isArray(ctx)) ctx = { changes: ctx };
  ctx = ctx || {};
  var changes = ctx.changes || changes_();
  var txt = null;
  changes.forEach(function (r) {
    if (parseDate_(r[0]) === date && String(r[1]).trim() === p.name) txt = r[2];
  });
  if (txt !== null) return parseSchedule_(txt);
  if (awayOn_(p.name, date)) return null; // 휴직 기간
  var mk = dayMark_(p.name, date);
  // ctx.absentOk: '무단'·'결근'으로 적힌 날은 쉬는 날이 아니라 '근무인데 안 나온 날'로 봐요(그날을 무급·월차로 바꿔 달라는 요청을 받을 때)
  if (OFF_RE.test(mk) && !(ctx.absentOk && ABSENT_RE.test(mk))) return null;
  var w = String((p.week && p.week[dowOf_(date)]) || '').trim();
  if (w) return parseSchedule_(w);
  var st = null;
  (ctx.stores || stores_()).forEach(function (x) { if (x.name === p.store) st = x; });
  return st && st.open != null ? { start: st.open, end: st.close } : null;
}

function newLogRow_(date, p, s) {
  var v = LOG_HEAD.map(function () { return ''; });
  v[C.date] = date;
  v[C.dow] = DOW[dowOf_(date)];
  v[C.name] = p.name;
  v[C.sIn] = s ? fmtTime_(s.start) : '';
  v[C.sOut] = s ? fmtTime_(s.end) : '';
  v[C.store] = p.store || '';
  return v;
}

function fmtSched_(s) {
  return s ? fmtTime_(s.start) + '-' + (s.end != null ? fmtTime_(s.end) : '') : '';
}

function isDayOffKind_(k) { return k === '대타' || k === '바꾸기' || OFF_KINDS.indexOf(k) >= 0; }

/**
 * 같은 날 다시 신청하는 걸 막을 요청인지: 기다리는 요청이거나, 승인됐고 휴무표 그날 칸이 아직 그대로인 요청.
 * (휴무 취소가 승인됐거나 사장님이 칸을 지운 날은 다시 신청할 수 있어요)
 */
function reqLive_(r) {
  if (r.state === '대기' || r.state === '수락') return true;
  if (r.state !== '승인') return false;
  var mk = dayMark_(r.name, r.date);
  if (OFF_KINDS.indexOf(r.kind) >= 0) return mk === r.kind;
  if (r.kind === '대타') return mk === '휴무';
  if (r.kind === '바꾸기') return mk === '휴무' || mk === '쉼';
  return true;
}

/** 휴무표 그날 칸에 쉬는 말을 적어요. [근무변경]에 그날 근무 시간이 있으면 그게 먼저라서, 쉬는 날이 되게 한 줄 더 적어요(마지막 줄이 이겨요). */
function setOff_(date, name, word, memo) {
  setMark_(date, name, function () { return word; });
  var last = null;
  changes_().forEach(function (c) { if (parseDate_(c[0]) === date && String(c[1]).trim() === name) last = String(c[2]); });
  if (last !== null && parseSchedule_(last)) addChange_(date, name, word, memo);
}

/** 휴무 바꾸기 요청의 '원래 쉬는 날'(그날 출근해요). 다른 요청이면 ''. */
function moveFrom_(r) { var m = r && r.kind === '바꾸기' ? /^(\d{4}-\d{2}-\d{2}) 출근/.exec(r.what) : null; return m ? m[1] : ''; }

/**
 * [출퇴근기록] 마지막 500줄. 이번 실행에서 한 번만 읽어요(기록을 쓰면 잊어요: logForget_).
 * 오늘·어제 줄은 늘 맨 아래에 붙어서 여기에 다 있어요(하루에 500줄 넘게 쓰지 않아요).
 */
function logTail_(sh) {
  return memo_('logTail', function () {
    sh = sh || sheet_(SHEETS.log);
    var last = sh.getLastRow();
    if (last < 2) return { first: 2, last: last, vals: [] };
    var first = Math.max(2, last - 499);
    return { first: first, last: last, vals: sh.getRange(first, 1, last - first + 1, LOG_HEAD.length).getDisplayValues() };
  });
}

/** 기록을 쓰거나 줄을 지웠을 때: 이번 실행에서 읽어 둔 [출퇴근기록]을 잊어요(다음에 다시 읽어요). */
function logForget_() {
  Object.keys(MEMO_).forEach(function (k) { if (k === 'logTail' || k === 'logDates' || k.indexOf('log:') === 0) delete MEMO_[k]; });
}

function findLog_(sh, date, name) {
  var tail = logTail_(sh);
  var last = tail.last;
  if (last < 2) return null;
  var first = tail.first, vals = tail.vals;
  for (var i = vals.length - 1; i >= 0; i--) {
    if (parseDate_(vals[i][C.date]) === date && String(vals[i][C.name]).trim() === name) {
      return { row: first + i, vals: vals[i] };
    }
  }
  if (first > 2 && date < nowKst_().date) {
    // 기록이 500줄 넘게 쌓여서 오래된 날짜는 앞쪽에 있어요: 날짜·이름 칸만 읽어서 찾아요(정정 승인이 같은 날 줄을 또 만들지 않게)
    var keys = sh.getRange(2, 1, first - 2, Math.max(C.date, C.name) + 1).getDisplayValues();
    for (var j = keys.length - 1; j >= 0; j--) {
      if (parseDate_(keys[j][C.date]) === date && String(keys[j][C.name]).trim() === name) {
        return { row: 2 + j, vals: sh.getRange(2 + j, 1, 1, LOG_HEAD.length).getDisplayValues()[0] };
      }
    }
  }
  return null;
}

function writeLog_(sh, row, v) {
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 200);
  var out = v.slice();
  [C.dIn, C.dOut].forEach(function (c) { out[c] = out[c] === '' ? '' : toNum_(out[c]); });
  var rg = sh.getRange(row, 1, 1, LOG_HEAD.length);
  rg.setNumberFormats([LOG_FMT]);
  rg.setValues([out]);
  logForget_(); // 읽어 둔 기록은 이제 옛것이에요
}

function todayOf_(v) {
  return {
    date: parseDate_(v[C.date]), // 화면이 '어느 날 기록인지' 알게(앱을 켜 둔 채 날짜가 바뀌었는지 확인)
    sIn: fmtTime_(parseTime_(v[C.sIn])), sOut: fmtTime_(parseTime_(v[C.sOut])),
    tIn: fmtTime_(parseTime_(v[C.tIn])), tOut: fmtTime_(parseTime_(v[C.tOut])),
  };
}

/** 기록 한 줄의 지각·조퇴·근무시간·차감액을 계산해서 그 줄에 채워요. */
function applyCalc_(v, wage, grace) {
  var r = calc_(v[C.sIn], v[C.sOut], v[C.tIn], v[C.tOut], wage, grace);
  v[C.late] = r.late || '';
  v[C.early] = r.early || '';
  v[C.work] = r.work;
  v[C.deduct] = r.deduct || '';
  return v;
}

/**
 * 지각: 예정 출근보다 (유예 시간을 넘겨) 늦게 온 분.
 * 조퇴: 예정 퇴근보다 일찍 간 분.
 * 차감액: 시급 × (지각 + 조퇴)분 ÷ 60, 원 단위 버림. 일 안 한 시간만큼만 빼요.
 */
function calc_(sIn, sOut, tIn, tOut, wage, grace) {
  var a = parseTime_(sIn), b = parseTime_(sOut), i = parseTime_(tIn), o = parseTime_(tOut);
  var late = 0, early = 0, work = '';
  if (a != null && i != null && i - a > (grace || 0)) late = i - a;
  var o2 = o != null && i != null && o < i ? o + 1440 : o; // 출근보다 이른 퇴근 시각 = 자정을 넘겨 퇴근(조퇴가 아니에요)
  if (b != null && o2 != null && b > o2) early = b - o2;
  if (i != null && o != null) work = o >= i ? o - i : o + 1440 - i;
  var deduct = Math.floor((Number(wage) || 0) * (late + early) / 60);
  return { late: late, early: early, work: work, deduct: deduct };
}

/**
 * 비밀번호 확인. 비밀번호가 아직 없는 직원은 출근·퇴근을 찍을 때(allowFirst) 넣은 번호가 비밀번호가 돼요.
 * 저장은 찍기가 성공한 뒤에 해요(p.newPin → punch 끝에서 저장).
 */
function checkPin_(p, pin, allowFirst, device) {
  if (!p.pin) {
    if (!allowFirst) throw new Error('아직 비밀번호가 없어요. 처음 화면에서 이름을 누르고 인사 정보를 넣으면서 정해주세요.');
    var first = String(pin == null ? '' : pin).trim();
    if (!/^\d{4,6}$/.test(first)) throw new Error('처음 쓰시는군요! 앞으로 쓸 비밀번호 4자리를 정해서 넣어주세요.');
    p.newPin = first;
    return;
  }
  var given = String(pin == null ? '' : pin).trim();
  if (!given) throw new Error('비밀번호를 넣어주세요.'); // 빈칸은 틀린 횟수에 안 넣어요(잠기지 않게)
  // 등록된 내 폰이면 그 폰만의 잠금을 써요: 남이 내 이름을 골라 일부러 5번 틀려도 내 폰으로는 출근을 찍을 수 있어요
  var dev = cleanDevId_(device), key = 'pin:' + p.name + (dev && hasDev_(p, dev) ? ':' + dev : '');
  guard_(key, given === p.pin, '비밀번호가 틀렸어요. 모르면 사장님께 말하면 바로 바꿔 줘요.', function (n) {
    logSuspect_(p.name, '비밀번호 틀림', n >= 5 ? '5번째, 10분 잠김' : n + '번째');
  });
}

/**
 * 사장님 화면 로그인 확인. cred:
 *  - 관리자 비밀번호(글자): 관리자. 모든 매장, 모든 기능
 *  - {name, pin}: 점장. [매장] 점장 칸에 이름이 있는 매장만, 본인 직원 비밀번호로 들어와요
 * 돌려주는 값: {set, role: 'admin'|'manager', name, stores}
 */
function auth_(cred) {
  var set = settings_();
  if (cred && typeof cred === 'object' && String(cred.name == null ? '' : cred.name).trim()) {
    var p = person_(cred.name);
    var stores = stores_().filter(function (st) { return st.managers.indexOf(p.name) >= 0; }).map(function (st) { return st.name; });
    if (!stores.length) throw new Error(p.name + ' 님은 점장으로 등록돼 있지 않아요. 시트 [매장] 탭 점장 칸을 확인해주세요.');
    if (!p.pin) throw new Error('아직 비밀번호가 없어요. 직원 화면에서 이름을 누르고 인사 정보를 넣으면서 비밀번호를 정해주세요(점장 화면은 6자리).');
    if (!String(cred.pin == null ? '' : cred.pin).trim()) throw new Error('비밀번호를 넣어주세요.');
    // 점장 화면은 직원 휴대폰 번호·대신 찍기가 있어서 6자리 비밀번호가 있어야 열려요(4자리는 맞혀 보기 쉬워요)
    if (String(p.pin).length < 6) throw new Error('점장 화면은 비밀번호 6자리가 필요해요. 직원 화면 아래 [비밀번호 바꾸기]에서 6자리로 바꾼 뒤 들어와 주세요.');
    var mdev = cleanDevId_(cred.dev), mok = String(cred.pin == null ? '' : cred.pin).trim() === p.pin;
    guardAll_('mgr:' + p.name, 10, mok, '점장 화면 비밀번호가 여러 번 틀려서 잠깐 막혔어요. 10분 뒤에 다시 해주세요.');
    guard_('mgr:' + p.name + ':' + (mdev || '-'), mok, '비밀번호가 틀렸어요.', function (n) {
      logSuspect_(p.name, '점장 화면 비밀번호 틀림', n >= 5 ? '5번째, 10분 잠김' : n + '번째');
    });
    return { set: set, role: 'manager', name: p.name, stores: stores };
  }
  var pin = cred && typeof cred === 'object' ? cred.pin : cred;
  if (!set.adminPin) throw new Error('[설정] 시트에 관리자PIN을 먼저 넣어주세요.');
  if (weakAdminPin_(set.adminPin)) {
    // 0000처럼 쉬운 번호로는 주민번호·계좌가 있는 사장님 화면을 열지 않아요(직원도 주소를 알아요)
    throw new Error('관리자 비밀번호가 너무 쉬워요(0000·123456처럼 쉽거나 6자리보다 짧아요). 시트 [설정] 탭의 관리자PIN을 6자리 이상으로 바꾼 뒤 다시 들어와 주세요.');
  }
  if (!String(pin == null ? '' : pin).trim()) throw new Error('관리자 비밀번호를 넣어주세요.');
  // 잠금은 폰마다(남이 일부러 틀려도 사장님 폰은 안 막혀요). 여러 폰으로 맞혀 보는 건 전체 상한(10분에 30번)으로 막아요
  var adev = cred && typeof cred === 'object' ? cleanDevId_(cred.dev) : '';
  var aok = String(pin == null ? '' : pin).trim() === set.adminPin;
  guardAll_('admin', 30, aok, '관리자 비밀번호를 틀린 기록이 많아서 잠깐 막혔어요. 10분 뒤에 다시 해주세요.', function () {
    try { notify_(set, '사장님 화면 비밀번호가 여러 번 틀렸어요', '10분 동안 30번 넘게 틀렸어요. 누가 맞혀 보는 중일 수 있어요. 관리자PIN을 바꾸는 걸 권해요.'); } catch (err) { console.error(err); }
  });
  guard_('admin:' + (adev || '-'), aok, '관리자 비밀번호가 틀렸어요.', function (n) {
    logSuspect_('(사장님 화면)', '관리자 비밀번호 틀림', n >= 5 ? '5번째, 10분 잠김' : n + '번째');
  });
  adminDevNew_(set, adev); // 처음 보는 폰이면 사장님께 알려요
  return { set: set, role: 'admin', name: '', stores: null };
}

/**
 * 사장님이 돌린 것인지: 10분 트리거(트리거 번호가 이 프로젝트 것) 또는 시트 메뉴·편집기(실행한 사람 = 스크립트 주인).
 * 웹 앱('모든 사용자')으로 다른 사람이 부르면 실행한 사람 메일이 비어 있어서 false예요.
 */
function ownerRun_(e) {
  try {
    if (e && e.triggerUid) {
      var uid = String(e.triggerUid);
      if (ScriptApp.getProjectTriggers().some(function (t) { return String(t.getUniqueId()) === uid; })) return true;
    }
  } catch (err) { console.error(err); }
  try {
    var me = Session.getEffectiveUser().getEmail();
    return !!me && Session.getActiveUser().getEmail() === me;
  } catch (err2) {
    return false;
  }
}

/** 관리자 비밀번호가 너무 쉬운지(6자리보다 짧거나, 같은 숫자 반복, 흔한 번호). */
function weakAdminPin_(pin) {
  pin = String(pin == null ? '' : pin).trim();
  return pin.length < 6 || /^(.)\1+$/.test(pin) || ['123456', '654321', '012345', '123123', '112233', '121212', '1234567', '12345678', '123456789'].indexOf(pin) >= 0;
}

/** 관리자만 쓰는 기능(최종 승인, 폰·비밀번호, 텔레그램, 정산, 휴무 확정). */
function adminAuth_(cred) {
  var a = auth_(cred);
  if (a.role !== 'admin') throw new Error('이 기능은 관리자(사장님)만 쓸 수 있어요.');
  return a.set;
}

/** 이 직원이 로그인한 사람 화면에 보이는지: 관리자는 전부, 점장은 자기 매장 직원만. */
function canSee_(a, p) { return a.role === 'admin' || a.stores.indexOf(p.store) >= 0; }

/** 비밀번호를 5번 틀리면 10분 동안 막아요. 틀릴 때마다 onFail(몇 번째)을 불러요. */
/**
 * 여러 폰·이름에 걸친 전체 상한: 10분 동안 limit번 넘게 틀리면 모두 잠깐 막아요(번호를 바꿔 가며 맞혀 보는 것).
 * 맞으면 아무것도 안 해요(폰마다 잠금은 guard_가 해요). onLimit: 상한에 처음 닿았을 때 한 번.
 */
function guardAll_(key, limit, ok, lockMsg, onLimit) {
  var cache = CacheService.getScriptCache(), k = 'fail:' + key + ':all';
  var n = Number(cache.get(k) || 0);
  if (n >= limit) throw new Error(lockMsg);
  if (!ok) {
    cache.put(k, String(n + 1), 600);
    if (n + 1 === limit && onLimit) onLimit();
  }
}

function guard_(key, ok, msg, onFail, lockMsg) {
  var cache = CacheService.getScriptCache();
  var k = 'fail:' + key;
  var n = Number(cache.get(k) || 0);
  if (n >= 5) {
    throw new Error(lockMsg || '비밀번호를 5번 틀려서 잠겼어요. 10분 뒤에 다시 해주세요.' +
      (key.indexOf('pin:') === 0 ? ' 급하면 사장님께 말하면 바로 풀어 줄 수 있어요(사장님 화면 [설정] → 직원 관리 → [비번]).' : ''));
  }
  if (!ok) {
    cache.put(k, String(n + 1), 600);
    if (onFail) onFail(n + 1);
    throw new Error(msg + (n + 1 >= 3 ? ' (' + (n + 1) + '/5)' : ''));
  }
  if (n) cache.remove(k);
}

/**
 * 폰 확인: 직원마다 처음 찍은 폰 1대만 등록돼요.
 *  - 등록된 폰이 없으면 지금 폰을 등록하고 통과
 *  - 다른 직원의 폰이면 거절 (동료가 대신 찍기 방지)
 *  - 등록 안 된 새 폰이면 거절하고 사장님께 승인 요청
 */
function checkDevice_(set, p, req, people) {
  if (set.device === '안함' || p.name === TEST_NAME) return; // 테스트 직원은 폰을 등록하지 않아요(사장님 폰이 묶이지 않게)
  var id = cleanDevId_(req.device);
  var label = String(req.label || '알 수 없는 폰').replace(/[#·\n]/g, ' ').slice(0, 30).trim();
  if (!id) {
    deny_(set, p.name, '폰 확인 안 됨', label,
      '이 브라우저에서는 폰 확인이 안 돼요. 시크릿(사생활 보호) 모드를 끄고 다시 열어주세요.');
  }
  people.forEach(function (x) {
    if (x.active && x.name !== p.name && hasDev_(x, id)) { // 퇴사한 사람이 쓰던 폰(물려받은 업무폰)은 막지 않아요
      deny_(set, p.name, '다른 직원 폰', x.name + ' 님 폰으로 찍으려 함 (' + label + ')',
        '이 폰은 ' + x.name + ' 님 폰으로 등록돼 있어요. 본인 폰으로 찍어주세요.', true);
    }
  });
  var now = nowKst_();
  if (!p.deviceId) {
    setStaffCell_(p.row, '등록폰', devCell_(id, label, mmdd_(now.date) + ' 등록'));
    p.deviceId = id;
    p.deviceIds = [id];
    return;
  }
  if (hasDev_(p, id)) return; // 등록된 폰(2대까지) 가운데 하나
  var first = devId_(p.request) !== id; // 같은 폰으로 다시 눌러도 메일은 처음 한 번만
  if (first) setStaffCell_(p.row, '새폰요청', devCell_(id, label, mmdd_(now.date) + ' ' + now.time + ' 요청'));
  deny_(set, p.name, '새 폰 승인 요청', label + ' (등록된 폰: ' + devParts_(p.device).map(devLabel_).join(', ') + ')',
    '등록된 폰이 아니에요. 사장님께 새 폰 승인을 요청했어요. 승인되면 다시 눌러주세요.\n' +
    '지금 시간(' + now.time + ')은 기록에 남아서 사장님이 출퇴근 시간을 맞춰줄 수 있어요.', first);
}

/** 매장 근처인지 확인하고, 매장까지 거리(m)를 돌려줘요. 확인 안 하면 ''. */
/**
 * 등록된 매장 중 가장 가까운 곳을 찾아요. 돌려주는 값: {dist: 거리(m) 또는 '', store: 찍은 매장, memo: 기록에 남길 말}
 *  - 내 매장 위치가 아직 등록 전이면: 막지 않고 '매장 위치 미등록'으로 남겨요(11개 매장을 하나씩 등록하는 동안 출근이 막히지 않게)
 *  - 다른 매장 근처에서 찍으면: 통과는 되지만(지원 근무) [의심기록]에 '다른 매장에서 찍음'을 남겨요
 *    (그날 휴무표에 '대타'가 있거나 근무변경이 잡혀 있으면 계획된 근무라 안 남겨요)
 */
function checkPlace_(set, req, p, now) {
  var none = { dist: '', store: '', memo: '' };
  if (set.mode === '안함') return none;
  if (p.name === TEST_NAME) return { dist: '', store: '', memo: '테스트(위치 확인 안 함)' };
  var name = p.name;
  var stores = stores_();
  var own = null;
  stores.forEach(function (st) { if (st.name === p.store) own = st; });
  if (own && (own.lat == null || own.lng == null)) return { dist: '', store: '', memo: '매장 위치 미등록' };
  var has = typeof req.lat === 'number' && typeof req.lng === 'number' && isFinite(req.lat) && isFinite(req.lng);
  var places = stores.filter(function (st) { return st.lat != null && st.lng != null; });
  if (!places.length) {
    if (set.mode === '필수') throw new Error('사장님이 아직 매장 위치를 등록하지 않았어요. 사장님께 말씀해주세요.');
    return none;
  }
  if (!has) {
    if (set.mode === '필수' && outsideOk_(name, now.date)) return { dist: '', store: '', memo: '외근(승인)' };
    if (set.mode === '필수') {
      deny_(set, name, '위치 없음', '위치 권한이 꺼져 있거나 GPS를 못 잡음',
        '위치를 확인하지 못했어요. 휴대폰 위치(GPS)를 켜고 다시 눌러주세요. 계속 안 되면 점장님께 [대신 찍기]를 부탁하세요.');
    }
    return none;
  }
  var best = null;
  places.forEach(function (st) {
    var d = distance_(st.lat, st.lng, req.lat, req.lng);
    if (!best || d < best.d) best = { d: d, st: st };
  });
  var acc = Math.max(Number(req.acc) || 0, 0);
  // 자기 매장 반경 안이면 항상 자기 매장으로 봐요. 매장과 사무실이 붙어 있거나 GPS가 조금 튀어서 옆 매장이 더 가깝게 잡혀도
  // '지원 근무'로 잘못 적히지 않게요(지원은 자기 매장 반경 밖, 다른 매장 반경 안일 때만)
  if (own && own.lat != null && own.lng != null && best.st.name !== own.name) {
    var dOwn = distance_(own.lat, own.lng, req.lat, req.lng);
    if (dOwn - Math.min(acc, 100) <= (own.radius || set.radius)) best = { d: dOwn, st: own };
  }
  var radius = best.st.radius || set.radius;
  if (best.d - Math.min(acc, 100) > radius) {
    var where = '가장 가까운 매장(' + best.st.name + ')에서 ' + fmtDist_(best.d) + ' (GPS 오차 ' + Math.round(acc) + 'm)';
    if (outsideOk_(name, now.date)) return { dist: best.d, store: '', memo: '외근(승인)' }; // 승인된 외근·교육 날은 어디서든 찍혀요
    if (set.mode === '필수') {
      deny_(set, name, '매장 밖', where, best.st.name + '에서 약 ' + fmtDist_(best.d) + ' 떨어져 있어요. 매장 안 창가나 문 근처에서 다시 눌러주세요.\n' +
        '두세 번 해도 안 되면 점장님께 [대신 찍기]를 부탁하거나, 나중에 [기록 정정]으로 실제 시간을 보내세요. 지금 누른 시간은 기록에 남아요.');
    }
    logSuspect_(name, '매장 밖에서 찍음', where + ', 기록만 모드라 통과');
    return { dist: best.d, store: '', memo: '' };
  }
  var memo = '';
  if (own && best.st.name !== own.name) {
    memo = '다른 매장(' + best.st.name + ')';
    // 지원 근무로 봐요: 휴무표 그날 칸에 매장 이름이 적히고, 사장님 화면 [오늘]·밤 요약·지원 근무 집계에 나와요(의심 기록에는 안 넣어요)
  }
  return { dist: best.d, store: best.st.name, memo: memo };
}

/** 그날 승인된 외근·교육 요청이 있는지(매장 밖에서 찍으려 할 때만 확인해요). */
function outsideOk_(name, date) {
  return readReqs_().some(function (q) { return q.name === name && q.date === date && q.kind === '외근' && q.state === '승인'; });
}

/** 처음 한 번: 출퇴근 확인을 위해 시간·매장까지 거리·폰 종류를 기록하는 데 동의해야 찍혀요. */
function checkAgree_(p, req) {
  if (p.agreed) return;
  if (req.agree !== true) throw new Error('처음 한 번만 동의가 필요해요. 화면의 동의 칸에 체크하고 다시 눌러주세요.');
  p.newAgree = true;
}

/** 비밀번호가 1234처럼 쉽거나, 3명 이상이 같은 번호를 쓰면 true. */
function weakPin_(p, people) {
  var pin = p.newPin || p.pin;
  if (!pin) return false;
  if (EASY_PINS.indexOf(pin) >= 0) return true;
  var same = (people || []).filter(function (x) { return x.name !== p.name && x.pin === pin; }).length;
  return same >= 2;
}

/** 거절: [의심기록]에 남기고(필요하면 사장님께 알림), 직원 화면에는 msg를 보여줘요. */
function deny_(set, name, kind, detail, msg, alert) {
  logSuspect_(name, kind, detail);
  if (alert) notify_(set, name + ' · ' + kind, detail + '\n사장님 화면 [오늘] 탭에서 확인하세요.');
  throw new Error(msg);
}

/**
 * 사장님께 알림: 텔레그램이 연결돼 있으면 텔레그램으로, 아니면(또는 실패하면) 메일로 보내요.
 * 보낸 곳('텔레그램' 또는 '메일')을 돌려줘요. 못 보냈으면 ''.
 */
function notify_(set, title, body, opts) {
  if (OUTBOX_) { OUTBOX_.push(function () { notify_(set, title, body, opts); }); return '나중에'; } // 밤 마감 중: 줄(잠금)을 푼 뒤에 보내요
  var now = nowKst_();
  var url = adminUrl_();
  var text = mmdd_(now.date) + ' ' + now.time + '\n' + body + (url ? '\n\n사장님 화면: ' + url : '');
  if (set.tgToken && set.tgChat) {
    try {
      var msg = {
        chat_id: set.tgChat, text: '[' + set.store + ' 출퇴근] ' + title + '\n' + text, disable_web_page_preview: true,
        disable_notification: !!(opts && opts.silent),
      };
      if (url) msg.reply_markup = { inline_keyboard: [[{ text: '사장님 화면 열기', url: url }]] }; // 알림에서 바로 승인 화면으로
      tgSend_(set.tgToken, msg, 'owner'); // 실패하면 사장님 화면에 빨간 띠
      return '텔레그램';
    } catch (err) { console.error(err); }
  }
  if (set.email) {
    try {
      MailApp.sendEmail(set.email, '[' + set.store + ' 출퇴근] ' + title, text + '\n시트: ' + book_().getUrl());
      return '메일';
    } catch (err) { console.error(err); }
  }
  return '';
}

/**
 * 직원 한 명에게 텔레그램 알림(직원이 앱에서 알림을 켰을 때만). 보냈으면 true.
 * 직원이 봇을 차단했거나 텔레그램이 안 되면 조용히 넘어가요.
 */
function notifyStaff_(set, p, title, body, opts) {
  if (!set.tgToken || !p || !p.tg) return false;
  if (OUTBOX_) { OUTBOX_.push(function () { notifyStaff_(set, p, title, body, opts); }); return true; }
  try {
    tgSend_(set.tgToken, {
      chat_id: p.tg, text: '[' + set.store + '] ' + title + '\n' + body, disable_web_page_preview: true,
      disable_notification: !!(opts && opts.silent),
    }, 'staff');
    return true;
  } catch (err) {
    console.error(err);
    return false;
  }
}

/* ───── 점장 알림: 우리 매장 미출근·인사 소식 ([설정] 점장알림, 기본 켬) ───── */

/**
 * 그 매장 점장들에게 텔레그램(점장이 직원 화면에서 텔레그램 알림을 켰을 때만. 안 켰으면 조용히 넘어가요).
 *  - stores: 매장 이름 하나 또는 여러 개(지점 이동은 예전 지점·새 지점). 두 매장 점장을 같이 맡은 사람에게는 한 번만 가요
 *  - except: 소식의 주인공. 본인 소식은 본인에게 안 보내요(본인에게는 따로 알려요)
 *  - msg: [제목, 내용]을 돌려주는 함수(받을 점장이 있을 때만 불러요). 글에는 이름·지점·날짜만 적어요(휴대폰·계좌·주민번호는 안 적어요)
 *  - 다른 매장 점장에게는 안 가요
 * 소리 없이 보내요(opts로 바꿀 수 있어요). [설정] 점장알림이 끔이면 아무에게도 안 보내요.
 * 보낸 점장 수를 돌려줘요. 알림이 안 돼도 오류를 내지 않아요(사장님이 하던 일은 그대로 끝나요).
 */
function mgrTell_(set, stores, except, msg, opts) {
  try {
    set = set || settings_();
    if (set.mgrAlert === '끔' || !set.tgToken || hrExempt_(except)) return 0; // 테스트·예시 직원 소식은 안 보내요
    var to = [];
    [].concat(stores || []).forEach(function (st) {
      if (st) managersOf_(st, except).forEach(function (n) { if (to.indexOf(n) < 0) to.push(n); });
    });
    if (!to.length) return 0;
    var t = msg();
    var n = 0;
    to.forEach(function (name) { if (notifyStaff_(set, findStaff_(name), t[0], t[1], opts || { silent: true })) n++; });
    return n;
  } catch (err) {
    console.error(err);
    return 0;
  }
}

/**
 * 미출근 알림을 점장에게도(10분 검사에서 사장님 알림과 같은 때, 같은 사람. 사람마다 하루 한 번, [늦어요]로 새 시간을 알렸으면 그 뒤 한 번 더).
 * 그날 그 사람이 일하는 매장(다른 매장 대타·지원이면 그 매장)의 점장에게, 점장마다 모아서 한 번에 보내요(이름·출근 예정 시간).
 * 늦은 사람이 점장이면 같은 매장의 다른 점장에게만 가요.
 * late: [{p: 직원, at: 그날 일하는 매장, start: 출근 예정(분), hint: 덧붙일 말, key: 점장 몫 표시}].
 * 끝난 표시(key) 목록을 돌려줘요: 점장 한 명에게라도 갔거나, 보낼 점장이 없을 때. 못 간 것은 다음 실행이 다시 해요.
 */
function mgrLate_(set, late, now) {
  var done = [];
  try {
    if (!late || !late.length) return done;
    if (set.mgrAlert === '끔' || !set.tgToken) return late.map(function (x) { return x.key; });
    var by = {}, order = [];
    late.forEach(function (x) {
      var st = x.at || x.p.store;
      var ms = st && !hrExempt_(x.p.name) ? managersOf_(st, x.p.name).filter(function (m) { var q = findStaff_(m); return !!(q && q.tg); }) : [];
      if (!ms.length) { done.push(x.key); return; } // 알릴 점장이 없어요(점장이 없거나 텔레그램을 안 켰어요)
      ms.forEach(function (m) {
        if (!by[m]) { by[m] = []; order.push(m); }
        by[m].push(x);
      });
    });
    order.forEach(function (m) {
      var lines = by[m].map(function (x) { return '[' + (x.at || x.p.store) + '] ' + x.p.name + ' (출근 예정 ' + fmtTime_(x.start) + (x.hint || '') + ')'; });
      if (notifyStaff_(set, findStaff_(m), '아직 출근 안 찍은 직원 ' + lines.length + '명',
        whenOf_(now.date) + ' ' + now.time + ' 기준\n' + lines.join('\n') + '\n출근했는지 확인해 주세요.')) {
        by[m].forEach(function (x) { if (done.indexOf(x.key) < 0) done.push(x.key); });
      }
    });
  } catch (err) {
    console.error(err);
  }
  return done;
}

/** 새 직원 입사(승인했을 때): 그 지점 점장에게. */
function mgrJoin_(set, name, store, start) {
  return mgrTell_(set, store, name, function () {
    return ['새 직원 입사', '[' + store + '] ' + name + ' 님이 ' + whenOf_(start) + '부터 일해요.'];
  });
}

/**
 * 지점 이동이 일어났을 때(바로 옮김·예약해 둔 날): 예전 지점·새 지점 점장 모두에게.
 * kind 'now': from → to로 옮김(date부터) / 'undo': 방금 옮긴 것(to → from)을 되돌려서 다시 to에서 일해요.
 * 예약만 해 둔 이동은 안 알려요(옮기는 날 알려요. 예약이 바뀌거나 없어져도 점장이 헷갈리지 않게).
 */
function mgrMove_(set, kind, name, from, to, date) {
  return mgrTell_(set, [from, to], name, function () {
    return kind === 'undo'
      ? ['지점 이동 취소', name + ' 님의 ' + to + ' → ' + from + ' 이동이 취소됐어요. 다시 ' + to + '에서 일해요.']
      : ['지점 이동', name + ' 님이 ' + whenOf_(date) + '부터 ' + to + '에서 일해요.' + (from ? ' (' + from + ' → ' + to + ')' : '')];
  });
}

/**
 * 퇴사: 그 지점 점장에게(마지막 근무일).
 * kind: 'plan' 퇴사 예정(날짜를 정함) / 'done' 퇴사 처리됨 / 'cancel' 퇴사 예정 취소 / 'back' 퇴사 취소(다시 근무).
 */
function mgrRetire_(set, kind, name, store, date) {
  return mgrTell_(set, store, name, function () {
    var who = (store ? '[' + store + '] ' : '') + name + ' 님';
    if (kind === 'plan') return ['퇴사 예정', who + '이 ' + whenOf_(date) + '까지 일하고 퇴사해요.'];
    if (kind === 'done') return ['퇴사', who + '이 ' + whenOf_(date) + '까지 일하고 퇴사했어요.'];
    if (kind === 'cancel') return ['퇴사 예정 취소', who + '의 ' + (date ? whenOf_(date) + ' ' : '') + '퇴사 예정이 취소됐어요. 계속 일해요.'];
    return ['퇴사 취소', who + '의 퇴사가 취소됐어요. 다시 일해요.'];
  });
}

/** 사장님 화면 [설정] '현재 설정'의 점장 알림 줄: 켬/끔, 텔레그램 알림을 안 켠 점장(근무 중인 점장만). 점장 화면에는 안 보내요. */
function mgrAlertInfo_(set, a) {
  if (a && a.role !== 'admin') return null;
  var names = [];
  stores_().forEach(function (st) {
    managersOf_(st.name).forEach(function (n) { if (names.indexOf(n) < 0) names.push(n); });
  });
  return {
    on: set.mgrAlert !== '끔', tg: !!set.tgToken, managers: names.length,
    noTg: names.filter(function (n) { var q = findStaff_(n); return q && !q.tg; }),
  };
}

var TG_WAITED_ = 0; // 이번 실행에서 텔레그램이 '잠깐 기다려'(429)라고 해서 기다린 시간(ms)
var TG_BLOCK_KEY = 'tg:until'; // 텔레그램이 '기다려'라고 한 끝 시각(ms). 그때까지는 텔레그램을 안 불러요(부르면 더 길게 막힐 수 있어요)

/** 텔레그램이 막아 둔 남은 시간(초). 안 막혔으면 0. */
function tgBlocked_() {
  try {
    var until = Number(CacheService.getScriptCache().get(TG_BLOCK_KEY) || 0);
    return until > Date.now() ? Math.ceil((until - Date.now()) / 1000) : 0;
  } catch (err) { return 0; }
}

/**
 * 텔레그램 부르기. 텔레그램이 '너무 자주 불렀어요(429)'라고 하면 말한 시간(retry_after) 동안은 아무도 다시 부르지 않고 바로 실패해요
 * (승인·요청 같은 버튼이 텔레그램을 기다리느라 느려지지 않게. 알림은 각자 다음에 다시 보내요).
 * opts.wait: 알림 연결처럼 사람이 결과를 기다리는 때만, 5초 안이면 한 번 기다렸다가 다시 해요.
 */
function tgCall_(token, method, payload, opts) {
  opts = opts || {};
  var left = tgBlocked_();
  if (left) throw new Error('텔레그램 오류: Too Many Requests: retry after ' + left);
  for (var tries = 0; ; tries++) {
    var res = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/' + method, {
      method: 'post', contentType: 'application/json', payload: JSON.stringify(payload || {}), muteHttpExceptions: true,
    });
    var body = {};
    try { body = JSON.parse(res.getContentText()); } catch (err) { /* 아래에서 처리 */ }
    if (body.ok) return body.result;
    var wait = body.error_code === 429 || res.getResponseCode() === 429 ? Math.max(1, Number((body.parameters && body.parameters.retry_after) || 3)) : 0;
    if (wait) {
      try { CacheService.getScriptCache().put(TG_BLOCK_KEY, String(Date.now() + wait * 1000), Math.min(21600, wait + 1)); } catch (err) { console.error(err); }
      if (opts.wait && tries < 1 && wait <= 5 && TG_WAITED_ + wait * 1000 <= 6000) {
        Utilities.sleep(wait * 1000 + 300);
        TG_WAITED_ += wait * 1000 + 300;
        try { CacheService.getScriptCache().remove(TG_BLOCK_KEY); } catch (err) { console.error(err); }
        continue;
      }
    }
    throw new Error('텔레그램 오류: ' + (body.description || ('HTTP ' + res.getResponseCode())));
  }
}

/** 텔레그램이 막고 있을 때(429) 화면에 보여 줄 말. */
function tgBusyText_(err, again) {
  var m = /retry after (\d+)/.exec(String(err && err.message || ''));
  var sec = m ? Number(m[1]) : 10;
  return '텔레그램 서버가 이 봇을 잠깐 막았어요(' + (sec >= 120 ? '약 ' + Math.ceil(sec / 60) + '분' : sec + '초') + ' 뒤에 풀려요). ' + again +
    ' 새로 만든 봇은 텔레그램 쪽 사정으로 몇 시간 동안 이럴 수 있어요. 출퇴근은 그대로 돼요.';
}

function adminUrl_() {
  try { var u = ScriptApp.getService().getUrl(); return u ? u + '?page=admin' : ''; } catch (err) { return ''; }
}

function logSuspect_(name, kind, detail) {
  try {
    var sh = book_().getSheetByName(SHEETS.suspect);
    if (!sh) return;
    var now = nowKst_();
    // appendRow 는 여러 명이 동시에 써도 줄이 겹치지 않아요(칸 서식은 처음 설정 때 글자로 맞춰 둠)
    sh.appendRow([now.date + ' ' + now.time, name || '', kind, detail || '']);
  } catch (err) {
    console.error(err);
  }
}

function suspectsOn_(date) {
  var sh = book_().getSheetByName(SHEETS.suspect);
  if (!sh) return [];
  var n = sh.getLastRow();
  if (n < 2) return [];
  var from = Math.max(2, n - 499); // 오늘 것은 맨 아래에 붙어요(최근 50개만 보여요)
  return sh.getRange(from, 1, n - from + 1, Math.max(sh.getLastColumn(), 1)).getDisplayValues().filter(function (r) {
    return parseDate_(r[0]) === date;
  }).map(function (r) {
    return { time: fmtTime_(parseTime_(String(r[0]).slice(10))), name: r[1], kind: r[2], detail: r[3] };
  }).reverse().slice(0, 50);
}

/* ───── 요청 시트 ───── */

function reqSheet_() {
  // 있으면 그대로(서식 맞추기는 setup 때만 해서 빨라요), 없으면 만들어요
  return book_().getSheetByName(SHEETS.req) || ensureSheet_(book_(), SHEETS.req, REQ_HEAD, [], REQ_HEAD.map(function () { return '@'; }));
}

function readReqs_() { return memo_('reqs', readReqsNow_); }

function readReqsNow_() {
  var sh = reqSheet_();
  var n = sh.getLastRow();
  if (n < 2) return [];
  return sh.getRange(2, 1, n - 1, REQ_HEAD.length).getDisplayValues().map(function (v, i) {
    return {
      row: i + 2, id: String(v[R.id]).trim(), at: v[R.at], name: String(v[R.name]).trim(), kind: String(v[R.kind]).trim(),
      date: parseDate_(v[R.date]), what: String(v[R.what]).trim(), reason: v[R.reason], state: String(v[R.state]).trim(),
      taker: String(v[R.taker] == null ? '' : v[R.taker]).trim(), done: v[R.done],
      route: String(v[R.route] == null ? '' : v[R.route]).trim() === '점장' ? '점장' : '관리자', // 예전 줄(빈칸)은 관리자
      mgr: String(v[R.mgr] == null ? '' : v[R.mgr]).trim(),
      proof: String(v[R.proof] == null ? '' : v[R.proof]).trim(),
    };
  }).filter(function (r) { return r.id; });
}

function findReq_(id) {
  id = String(id == null ? '' : id).trim();
  var all = readReqs_();
  for (var i = 0; i < all.length; i++) if (all[i].id === id) return all[i];
  return null;
}

function putReq_(sh, row, r) {
  forget_('reqs');
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 200);
  var rg = sh.getRange(row, 1, 1, REQ_HEAD.length);
  rg.setNumberFormats([REQ_HEAD.map(function () { return '@'; })]);
  rg.setValues([[r.id, r.at, r.name, r.kind, r.date, r.what, r.reason || '', r.state, r.taker || '', r.done || '',
    r.route || '관리자', r.mgr || '', r.proof || '']]);
}

function reqView_(r, withReason) {
  var p = findStaff_(r.name);
  return {
    id: r.id, name: r.name, kind: r.kind, date: r.date, dow: DOW[dowOf_(r.date)], what: r.what,
    reason: withReason ? r.reason : '', state: r.state, taker: r.taker, at: r.at,
    store: p ? p.store : '', route: r.route, mgr: withReason ? r.mgr : '',
    mark: withReason && r.kind !== '퇴사' && (r.state === '대기' || r.state === '수락') && ABSENT_RE.test(dayMark_(r.name, r.date)) ? dayMark_(r.name, r.date) : '', // 그날 휴무표 칸(결근·무단일 때만. 퇴사 신청은 칸을 안 바꿔요)
    managers: r.route === '점장' && p ? managersOf_(p.store, p.name) : [],
    from: moveFrom_(r), // 휴무 바꾸기: 원래 쉬는 날(그날 출근)
    proof: withReason ? !!r.proof : false, // 증빙 사진을 올렸는지(본인 화면). 사장님 카드는 openReqsForAdmin_이 주소로 바꿔요
  };
}

function reqsFor_(name) {
  var today = nowKst_().date;
  var all = readReqs_();
  var endV = lastDay_(name); // 퇴사 예정이면 마지막 근무일 뒤 대타는 안 보여요
  return {
    mine: all.filter(function (r) { return r.name === name || r.taker === name; })
      .slice(-20).reverse().map(function (r) { return reqView_(r, r.name === name); }),
    swaps: all.filter(function (r) {
      return r.kind === '대타' && r.state === '대기' && r.name !== name && r.date >= today && !(endV && r.date > endV);
    }).map(function (r) { return swapView_(reqView_(r, false), name); }),
  };
}

/** 관리자에게 바로 보낸 퇴사 신청은 점장에게 안 보여요(점장이 올린 것은 보여요). a: auth_ 결과 */
function quitHidden_(q, a) { return !!a && a.role !== 'admin' && q.kind === '퇴사' && q.route !== '점장' && !/^올림/.test(q.mgr || ''); }

/** 아직 끝나지 않은 요청. 점장(a.role 'manager')에게는 자기 매장 직원 것만. */
function openReqsForAdmin_(today, a) {
  var people = staff_();
  var crews = {}; // 날짜별 매장 인원(승인 카드 인원 줄을 날마다 한 번만 세요)
  return readReqs_().filter(function (r) {
    if (r.state !== '대기' && r.state !== '수락') return false;
    if (!a || a.role === 'admin') return true;
    if (quitHidden_(r, a)) return false; // 관리자에게 바로 보낸 퇴사 신청은 점장에게 안 보여요
    var p = findStaff_(r.name);
    return !!p && a.stores.indexOf(p.store) >= 0;
  }).map(function (r) {
    var v = reqView_(r, true);
    v.proof = !r.proof ? '' : !a || a.role === 'admin' ? r.proof : '있음'; // 증빙 사진: 사장님은 보기 주소, 점장은 있다는 것만(건강 서류 등)
    if (r.kind === '퇴사') v.note = quitNote_(r); // 이미 퇴사 예정이 있으면 알려요
    if ((OFF_KINDS.indexOf(r.kind) >= 0 || r.kind === '바꾸기') && r.kind !== '반차' && v.store) {
      // 그날 같은 매장에 이미 쉬는 사람
      var offs = offNames_(v.store, r.date, r.name);
      var st = storeOf_(v.store);
      if (offs.length) {
        v.note = '그날 ' + v.store + '는 이미 ' + offs.join(', ') + ' 님이 쉬어요' +
          (st && st.maxOff > 0 && offs.length >= st.maxOff ? ' (하루 최대 ' + st.maxOff + '명을 넘어요)' : '');
      }
    }
    if (r.kind === '경조') {
      // 경조 휴가 규정: 사유 맨 앞의 경조사 이름으로 찾아요
      var evr = null;
      settings_().leaveRules.forEach(function (x) { if (String(r.reason || '').indexOf(x.name) === 0) evr = x; });
      if (evr) v.note = (v.note ? v.note + ' · ' : '') + '규정: ' + evr.name + ' ' + evr.days + '일(근무일 기준)';
    }
    if (r.kind === '월차') {
      // 그달 휴무표 잔여(이월 + 부여 − 사용)
      var mg = monthGrid_(r.date.slice(0, 7)), mr = mg && mg.rows[r.name];
      var lv = mr ? String(mr.vals[mg.cols.left] || '').trim() : '';
      if (/^-?\d+(\.\d+)?$/.test(lv)) {
        var nleft = Number(lv);
        v.left = nleft; // 여러 날 묶음이면 화면이 날 수와 견줘요
        v.note = (v.note ? v.note + ' · ' : '') + (nleft >= 1 ? '남은 월차 ' + nleft + '개' : '남은 월차가 없어요(잔여 ' + nleft + ')');
      }
    }
    if (r.kind === '정정') {
      var f = findLog_(sheet_(SHEETS.log), r.date, r.name);
      var col = r.what.indexOf('퇴근') === 0 ? C.tOut : C.tIn;
      v.before = f ? fmtTime_(parseTime_(f.vals[col])) : '';
    }
    if (r.kind === '대타' && r.taker) {
      var b = null;
      people.forEach(function (x) { if (x.name === r.taker) b = x; });
      var s = b ? schedFor_(b, r.date) : null;
      if (s) v.note = swapAway_(findStaff_(r.name), b) ? takerNote_(findStaff_(r.name), b, s) : r.taker + ' 님은 그날 원래 ' + fmtTime_(s.start) + '-' + fmtTime_(s.end) + ' 근무라서 두 시간을 합쳐요';
      var tk = dayMark_(r.taker, r.date);
      if (fullOff_(tk) && tk !== '휴무') v.note = r.taker + ' 님은 그날 휴무표에 "' + tk + '"(으)로 쉬는 날이라 승인할 수 없어요. 거절해 주세요';
      var endB = lastDay_(r.taker);
      if (endB && r.date > endB) v.note = r.taker + ' 님은 ' + whenOf_(endB) + '까지 근무해요(퇴사 예정). 승인할 수 없어요. 거절해 주세요';
    }
    if ((fullOff_(r.kind) || r.kind === '대타') && r.date <= today) {
      var came = punchedIn_(r.date, r.name);
      if (came) v.note = '그날 ' + came + '에 출근했어요. 승인할 수 없어요. 거절해 주세요';
    }
    var endQ = lastDay_(r.name), lateQ = moveFrom_(r) > r.date ? moveFrom_(r) : r.date;
    if (endQ && lateQ > endQ && r.kind !== '정정' && r.kind !== '취소' && r.kind !== '퇴사') v.note = r.name + ' 님은 ' + whenOf_(endQ) + '까지 근무해요(퇴사 예정). 그 뒤 날짜라 승인할 수 없어요. 거절해 주세요';
    v.thin = thinOnCard_(r, a, crews); // 승인하면 그날 그 매장에 몇 명이 일하는지([매장] 최소인원보다 적으면 빨갛게)
    v.past = r.kind !== '정정' && r.date < today;
    return v;
  });
}

/** 승인된 요청을 기록과 근무표에 반영해요. */
function applyReq_(set, r) {
  needOpen_(r.date); // 마감한 달의 날짜는 승인할 수 없어요(거절은 돼요)
  if (r.kind === '퇴사') return quitApply_(r); // 퇴사 신청: 그날까지 근무하고 퇴사(자진 퇴사)
  var endR = lastDay_(r.name), lateDay = moveFrom_(r) > r.date ? moveFrom_(r) : r.date; // 휴무 바꾸기는 두 날 중 늦은 날
  if (endR && lateDay > endR && r.kind !== '정정' && r.kind !== '취소') throw new Error(r.name + ' 님은 ' + whenOf_(endR) + '까지 근무해요(퇴사 예정). 그 뒤 날짜라서 이 요청은 거절해 주세요.');
  var people = staff_();
  function find(n) { var p = null; people.forEach(function (x) { if (x.name === n) p = x; }); return p; }

  if (r.kind === '정정') {
    var m = /^(출근|퇴근)\s+(\d{1,2}:\d{2})/.exec(r.what);
    if (!m) throw new Error('요청 내용이 이상해요: ' + r.what);
    var p = find(r.name);
    var sh = sheet_(SHEETS.log);
    var f = findLog_(sh, r.date, r.name);
    var row, v;
    if (f) {
      row = f.row;
      v = f.vals.slice();
    } else {
      row = Math.max(sh.getLastRow(), 1) + 1;
      v = newLogRow_(r.date, p || { name: r.name }, p ? schedFor_(p, r.date) : null);
    }
    var col = m[1] === '출근' ? C.tIn : C.tOut;
    var before = fmtTime_(parseTime_(v[col]));
    v[col] = m[2];
    v[C.memo] = addMemo_(v[C.memo], '정정 승인: ' + m[1] + ' ' + m[2] + (before ? '(이전 ' + before + ')' : '') +
      (r.reason ? ' ' + r.reason : ''));
    applyCalc_(v, p ? p.wage : 0, set.grace);
    writeLog_(sh, row, v);
    if (col === C.tIn) syncLateMark_(r.date, r.name, v);
    else setMark_(r.date, r.name, function (old) { return old === '결근?' ? '' : old; }); // 나온 날이에요
    return;
  }

  if (r.kind === '바꾸기') {
    // 휴무 바꾸기: 대신 쉴 날(r.date)은 '휴무', 원래 쉬는 날(from)은 출근하는 날로(휴무 표시를 지우고, 그래도 쉬는 날이면 [근무변경]에 시간을 적어요)
    var from = moveFrom_(r), hours = parseSchedule_(String(r.what).replace(/^\S+ 출근 /, ''));
    var pm = find(r.name);
    if (!from || !pm) throw new Error('요청 내용이 이상해요: ' + r.what);
    needOpen_(from);
    var today0 = nowKst_().date, logSh = sheet_(SHEETS.log);
    if (from < today0) {
      // 원래 쉬는 날이 이미 지났어요: 그날 실제로 출근했을 때만 승인할 수 있어요(안 나왔는데 승인하면 하루를 그냥 더 쉬게 돼요)
      var fl = findLog_(logSh, from, r.name);
      if (!fl || !fl.vals[C.tIn]) throw new Error(whenOf_(from) + '(원래 쉬는 날)이 이미 지났는데 그날 출근 기록이 없어요. 이 요청은 거절해 주세요.');
    }
    if (r.date <= today0) {
      // 대신 쉴 날이 이미 지났거나 오늘인데 그날 출근했어요: 승인하면 일한 날이 휴무가 돼요
      var bl = findLog_(logSh, r.date, r.name);
      if (bl && bl.vals[C.tIn]) throw new Error(whenOf_(r.date) + '(대신 쉴 날)에 이미 출근했어요. 이 요청은 거절해 주세요.');
    }
    var nowB = schedFor_(pm, r.date);
    if (!nowB) throw new Error(whenOf_(r.date) + '은 이미 쉬는 날로 바뀌어 있어요. 이 요청은 거절해 주세요.');
    if (schedFor_(pm, from)) throw new Error(whenOf_(from) + '은 이미 근무하는 날로 바뀌어 있어요. 이 요청은 거절해 주세요.');
    readReqs_().forEach(function (q) {
      if (q.name === r.name && q.date === from && isDayOffKind_(q.kind) && q.state === '승인' && reqLive_(q)) {
        throw new Error(whenOf_(from) + '은 ' + KIND_NAME[q.kind] + ' 요청으로 받은 휴무라서 바꿀 수 없어요. 이 요청은 거절해 주세요.');
      }
    });
    // 원래 쉬는 날이 휴무표에 '휴무'로 적힌 날이면 그 '휴무'를 대신 쉴 날로 옮기고, 요일로 쉬는 날이면 '쉼'으로 적어요(그달 휴무 수가 늘지 않게)
    var markA = dayMark_(r.name, from);
    var word = /^휴무\??$/.test(markA) ? '휴무' : '쉼';
    setOff_(r.date, r.name, word, '휴무 바꾸기 승인 (' + r.id + ')');
    setMark_(from, r.name, function (old) { return /^(휴무\??|쉼)$/.test(old) ? '' : old; });
    if (!schedFor_(pm, from)) {
      // 원래 쉬는 날 근무 시간은 지금 기준(그사이 지점을 옮겼을 수 있어요): 대신 쉴 날의 지금 근무 시간 → 요청 때 시간 → 매장 시간
      var st0 = storeOf_(pm.store);
      var hrs = nowB || hours || (st0 && st0.open != null ? { start: st0.open, end: st0.close } : null);
      addChange_(from, r.name, hrs ? fmtSched_(hrs) : '출근', '휴무 바꾸기: ' + whenOf_(r.date) + ' 대신 출근 (' + r.id + ')');
    }
    // 원래 쉬는 날에 먼저 나와서 밤 마감이 '쉬는 날 출근'으로 대체휴무를 쌓았으면 되돌려요(하루를 두 번 받지 않게)
    var credited = 0;
    subRows_().forEach(function (x) { if (x.date === from && x.name === r.name && /적립/.test(x.kind)) credited += x.days; });
    if (credited > 0) addSub_(from, r.name, '적립', -credited, '휴무 바꾸기 승인으로 적립 취소 (' + r.id + ')');
    resyncLog_(set, r.date, r.name);
    resyncLog_(set, from, r.name);
    return;
  }

  if (r.kind === '조퇴' || r.kind === '외출') {
    // 조퇴: 그날 예정 퇴근을 나갈 시각으로([근무변경]에 한 줄) 바꿔서 조퇴·차감이 안 붙어요. 외출: 예정 시간은 그대로, 기록 메모만
    var pe = find(r.name);
    var se2 = pe ? schedFor_(pe, r.date) : null;
    if (!se2) throw new Error(whenOf_(r.date) + '은 이제 근무가 없는 날이에요. 이 요청은 거절해 주세요.');
    var mt = /^(\d{1,2}:\d{2})(?:~(\d{1,2}:\d{2}))?/.exec(r.what);
    var t1e = mt ? parseTime_(mt[1]) : null;
    if (t1e == null) throw new Error('요청 내용이 이상해요: ' + r.what);
    if (r.kind === '조퇴') {
      if (!(t1e > se2.start && (se2.end == null || t1e < se2.end))) throw new Error(whenOf_(r.date) + ' 근무가 ' + fmtSched_(se2) + '(으)로 바뀌어서 ' + mt[1] + ' 조퇴가 맞지 않아요. 거절하고 다시 보내 달라고 해 주세요.');
      addChange_(r.date, r.name, fmtSched_({ start: se2.start, end: t1e }), '조퇴 승인 (' + r.id + ')');
      resyncLog_(set, r.date, r.name);
    }
    var ewhy = clean_(String(r.reason || '').replace(/,/g, ' '), 40); // 기록 메모는 쉼표로 이어져요
    dayMemo_(r.date, r.name, (r.kind === '조퇴' ? '조퇴 승인 ' + mt[1] : '외출 승인 ' + mt[1] + '~' + mt[2]) + (ewhy ? '(' + ewhy + ')' : ''));
    return;
  }

  if (r.kind === '외근') {
    // 외근·교육: 휴무표 그날 칸에 '외근'(비어 있을 때만). 그날은 위치 확인 없이 찍혀요(checkPlace_가 승인된 외근을 봐요)
    setMark_(r.date, r.name, function (old) { return old || '외근'; });
    return;
  }

  if (r.kind === '취소') {
    // 승인된 휴무 취소: 그날 칸이 아직 그 휴무일 때만 비워요. 대체휴무였으면 쓴 것도 되돌려요
    var was = '';
    OFF_KINDS.forEach(function (k) { if (KIND_NAME[k] + ' 취소' === r.what) was = k; });
    var now2 = dayMark_(r.name, r.date);
    if (!was || now2 !== was) throw new Error('휴무표 그날 칸이 이미 "' + (now2 || '빈칸') + '"(으)로 바뀌어 있어요. 이 요청은 거절해 주세요.');
    setMark_(r.date, r.name, function () { return ''; });
    if (WHY_KINDS.indexOf(was) >= 0) setWhy_(r.date, r.name, '');
    if (was === '대체') addSub_(r.date, r.name, '사용', -1, '대체휴무 취소 승인 (' + r.id + ')');
    var pc = find(r.name);
    if (pc && !schedFor_(pc, r.date)) {
      // 원래 쉬는 요일(또는 [근무변경]에 쉬는 날로 적힌 날)이었어요: 그날 근무하는 날이 되게 [근무변경]에 시간을 적어요.
      // 그날 [근무변경]에 따로 정한 근무 시간이 있었으면 그 시간, 없으면 매장 시간
      var prevSched = null;
      changes_().forEach(function (c) { if (parseDate_(c[0]) === r.date && String(c[1]).trim() === r.name && parseSchedule_(String(c[2]))) prevSched = String(c[2]).trim(); });
      var stc = storeOf_(pc.store);
      var back = prevSched || (stc && stc.open != null ? fmtSched_({ start: stc.open, end: stc.close }) : '');
      if (back) addChange_(r.date, r.name, back, '휴무 취소 승인: 그날 근무 (' + r.id + ')');
    }
    resyncLog_(set, r.date, r.name);
    return;
  }

  if (OFF_KINDS.indexOf(r.kind) >= 0) {
    // 휴무·월차·반차·대체: 휴무표 그날 칸에 그대로 적어요. 대체는 [대체휴무]에 '사용'도 적어요
    if (fullOff_(r.kind)) {
      // 그날 이미 출근을 찍었으면(아침에 [오늘 못 나가요]를 보내고 나온 날 등) 승인하면 일한 날이 휴무가 되고 지각이 지워져요. 반차는 돼요
      var wt = punchedIn_(r.date, r.name);
      if (wt) throw new Error(whenOf_(r.date) + ' ' + wt + '에 이미 출근했어요. 이 요청은 거절해 주세요.');
    }
    // 사장님이 [근무표]에서 그날을 먼저 대체로 바꿨으면 장부에 그날 '사용'이 이미 있어요(두 번 빼지 않게. 다른 쉬는 말로 승인하면 되돌려요)
    var wasSub = dayMark_(r.name, r.date) === '대체', usedDay = 0;
    subRows_().forEach(function (x) { if (x.date === r.date && x.name === r.name && /사용/.test(x.kind)) usedDay += x.days; });
    setOff_(r.date, r.name, r.kind, KIND_NAME[r.kind] + ' 승인 (' + r.id + ')');
    var why = clean_(r.reason, 40);
    if (WHY_KINDS.indexOf(r.kind) >= 0 && why && why !== '(안 적음)') setWhy_(r.date, r.name, why); // 병가·기타 등은 사유를 칸 메모에
    if (r.kind === '대체' && usedDay <= 0) addSub_(r.date, r.name, '사용', 1, '대체휴무 신청 승인 (' + r.id + ')');
    else if (r.kind !== '대체' && wasSub && usedDay > 0) addSub_(r.date, r.name, '사용', -1, KIND_NAME[r.kind] + ' 승인으로 대체휴무 사용 되돌림 (' + r.id + ')');
    resyncLog_(set, r.date, r.name);
    return;
  }

  // 대타: 요청한 사람은 휴무, 대타는 그 시간을 맡아요(원래 근무가 있으면 두 시간을 합쳐요).
  var a = parseSchedule_(r.what);
  var b = find(r.taker);
  if (!a || !b) throw new Error('대타 정보가 이상해요. 시트 [요청] 탭을 확인해주세요.');
  var endB = lastDay_(b.name);
  if (endB && r.date > endB) throw new Error(b.name + ' 님은 ' + whenOf_(endB) + '까지 근무해서(퇴사 예정) ' + whenOf_(r.date) + ' 대타를 할 수 없어요. ' + b.name + ' 님이 수락을 취소하거나, 이 요청은 거절해 주세요.');
  var tk = dayMark_(r.taker, r.date); // 대타가 그날 병가·월차 같은 휴가를 받았으면 승인하지 않아요(휴가가 지워지고 그 사람이 근무로 잡혀요)
  if (fullOff_(tk) && tk !== '휴무') throw new Error(r.taker + ' 님은 그날 휴무표에 "' + tk + '"(으)로 쉬는 날이에요. 이 대타는 거절해 주세요(그래도 일하기로 했으면 그 휴가를 먼저 취소해 주세요).');
  var came = punchedIn_(r.date, r.name);
  if (came) throw new Error(r.name + ' 님이 ' + whenOf_(r.date) + ' ' + came + '에 이미 출근했어요. 이 대타는 거절해 주세요.');
  // 다른 매장 동료가 대타: 그 매장에서 요청한 시간만 일하고 자기 매장 근무는 빠져요(두 매장 시간을 합치지 않아요).
  // 휴무표에 '대타 왕십리'처럼 매장 이름을 붙여서 지원 근무·매장 인원 셈에 들어가요
  var away = swapAway_(findStaff_(r.name), b), own = away ? schedFor_(b, r.date) : null;
  var sb = away ? null : schedFor_(b, r.date);
  var start = sb ? Math.min(sb.start, a.start) : a.start;
  var end = sb && sb.end != null && a.end != null ? Math.max(sb.end, a.end) : (a.end != null ? a.end : sb ? sb.end : null);
  var had = dayMark_(r.name, r.date); // 같은 날 병가·월차 같은 휴가를 따로 받았으면([오늘 못 나가요] 뒤 대타) 그 칸을 그대로 둬요
  if (!(fullOff_(had) && had !== '휴무')) setOff_(r.date, r.name, '휴무', '대타 승인: ' + r.taker + ' 님이 대신 (' + r.id + ')');
  setMark_(r.date, r.taker, function (old) { return !old || OFF_RE.test(old) ? '대타' + (away ? ' ' + away : '') : old; });
  addChange_(r.date, r.taker, fmtSched_({ start: start, end: end }),
    r.name + ' 님 대신 대타' + (sb ? ' (원래 ' + fmtSched_(sb) + ' 근무와 합침)' : '') +
    (away ? ' (' + away + ' 근무' + (own ? ', 원래 ' + b.store + ' ' + fmtSched_(own) + ' 근무는 빠짐' : '') + ')' : ''));
  resyncLog_(set, r.date, r.name);
  resyncLog_(set, r.date, r.taker);
}

function changes_() { return memo_('change', function () { return rows_(SHEETS.change); }); }

var CHANGE_BAD_NOTE = '날짜를 못 읽었어요. 2026-11-20처럼 적어 주세요(이 줄은 지금 안 쓰여요).';
/**
 * [근무변경] 날짜 칸(A)을 손으로 적으면 '2026-11-20' 모양으로 맞춰요. '11/20', '11월 20일'처럼 연도 없이 적어도 돼요.
 * 못 읽는 날짜는 칸 메모로 알려요(그대로 두면 그 줄이 조용히 무시돼서, 평소 시간으로 미출근 알림·지각이 붙어요).
 */
function changeEdited_(sh, rg) {
  if (rg.getColumn() > 1) return;
  var r1 = Math.max(rg.getRow(), 2), n = rg.getRow() + rg.getNumRows() - r1;
  if (n <= 0 || n > 300) return;
  var cells = sh.getRange(r1, 1, n, 1);
  var vals = cells.getDisplayValues(), notes = cells.getNotes();
  vals.forEach(function (v, i) {
    var t = String(v[0]).trim(), c = sh.getRange(r1 + i, 1);
    if (!t) { if (notes[i][0] === CHANGE_BAD_NOTE) c.setNote(''); return; }
    var d = parseDate_(t) || mdGuess_(t);
    if (d) {
      if (d !== t) c.setValue(d);
      if (notes[i][0] === CHANGE_BAD_NOTE) c.setNote('');
    } else if (notes[i][0] !== CHANGE_BAD_NOTE) c.setNote(CHANGE_BAD_NOTE);
  });
  forget_('change');
}

/** [근무변경]에 한 줄 추가. */
function addChange_(date, name, text, memo) {
  forget_('change');
  var sh = sheet_(SHEETS.change);
  var row = Math.max(sh.getLastRow(), 1) + 1;
  if (row > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), 200);
  var rg = sh.getRange(row, 1, 1, CHANGE_HEAD.length);
  rg.setNumberFormats([['@', '@', '@', '@']]);
  rg.setValues([[date, name, text, memo]]);
}

/** 그날 근무 계획이 바뀌었으면, 이미 있는 출퇴근기록의 예정 시간·지각을 다시 계산해요. */
function resyncLog_(set, date, name) {
  var log = sheet_(SHEETS.log);
  var f = findLog_(log, date, name);
  if (!f) return;
  var p = null;
  staff_().forEach(function (x) { if (x.name === name) p = x; });
  var s = p ? schedFor_(p, date) : null;
  var v = f.vals.slice();
  v[C.sIn] = s ? fmtTime_(s.start) : '';
  v[C.sOut] = s ? fmtTime_(s.end) : '';
  applyCalc_(v, p ? p.wage : 0, set.grace);
  writeLog_(log, f.row, v);
  syncLateMark_(date, name, v);
}

function daysBetween_(from, to) {
  var a = from.split('-').map(Number), b = to.split('-').map(Number);
  return Math.round((Date.UTC(b[0], b[1] - 1, b[2]) - Date.UTC(a[0], a[1] - 1, a[2])) / 864e5);
}

/* 폰 칸 모양: '#a1b2c3d4e5f60718 iPhone 사파리 · 11/18 등록' */
function devCell_(id, label, note) { return '#' + id + ' ' + label + ' · ' + note; }
function devId_(s) { var m = String(s == null ? '' : s).match(/#([A-Za-z0-9_-]{8,64})/); return m ? m[1] : ''; }
/** 등록폰 칸에 적힌 폰 번호들(2대까지: '#id1 라벨 · 메모 | #id2 라벨 · 메모'). */
function devIds_(s) { return (String(s == null ? '' : s).match(/#([A-Za-z0-9_-]{8,64})/g) || []).map(function (x) { return x.slice(1); }); }
/** 그 직원에게 등록된 폰인지. */
function hasDev_(p, id) { return !!id && (p.deviceIds || []).indexOf(id) >= 0; }
/** 등록폰 칸을 폰마다 나눠요. */
function devParts_(s) { return String(s == null ? '' : s).split(/\s*[|\n]\s*/).filter(function (x) { return devId_(x); }); }
function devLabel_(s) { return String(s == null ? '' : s).replace(/^\s*#\S+\s*/, '').split(' · ')[0].trim(); }
function devText_(s) { return String(s == null ? '' : s).replace(/^\s*#\S+\s*/, '').trim(); }
function cleanDevId_(s) { s = String(s == null ? '' : s); return /^[A-Za-z0-9_-]{8,64}$/.test(s) ? s : ''; }
function mmdd_(date) { return date.slice(5, 7) + '/' + date.slice(8, 10); }

/** 사장님 화면 [설정] 탭 정보. 점장(a.role 'manager')에게는 자기 매장만, 시트 주소·텔레그램 상태는 빼요. */
function info_(set, a) {
  var appUrl = '';
  try { appUrl = ScriptApp.getService().getUrl() || ''; } catch (err) { /* 배포 전 */ }
  var admin = !a || a.role === 'admin';
  var used = {}, names = {};
  staff_().forEach(function (p) {
    if (!p.active) return;
    used[p.store] = (used[p.store] || 0) + 1;
    names[p.name] = true;
  });
  return {
    store: set.store,
    role: admin ? 'admin' : 'manager',
    stores: stores_().filter(function (st) { return admin || a.stores.indexOf(st.name) >= 0; }).map(function (st) {
      return {
        name: st.name, hasPlace: st.lat != null && st.lng != null, lat: st.lat, lng: st.lng,
        radius: st.radius || set.radius, open: fmtTime_(st.open), close: fmtTime_(st.close), staff: used[st.name] || 0,
        managers: st.managers.filter(function (n) { return names[n]; }),
        badManagers: st.managers.filter(function (n) { return !names[n]; }), // [직원]에 없는 이름(오타 등)
        maxOff: st.maxOff, monthOff: st.monthOff,
        minStaff: st.minStaff, // [매장] 최소인원(null = 비움)
      };
    }),
    radius: set.radius, mode: set.mode, device: set.device, grace: set.grace, email: set.email, alertMin: set.alertMin,
    weakPin: admin && weakAdminPin_(set.adminPin), sheetUrl: admin ? book_().getUrl() : '', appUrl: appUrl,
    tg: !admin ? '' : set.tgToken ? (set.tgChat ? '연결됨' : '토큰만') : '',
    tgBot: admin ? set.tgBot : '', remind: set.remind, wishWin: set.wishWin, subMode: set.subMode,
    mgrAlert: mgrAlertInfo_(set, a), // 점장 알림 켬/끔, 텔레그램 알림을 안 켠 점장(사장님 화면만)
    joinCode: admin ? set.joinCode : '', // 입사 코드(신입에게 알려 주는 숫자)
  };
}

/** 입사 코드 정하기(숫자 4~6자리). 비우면 코드 없이 등록할 수 있어요. */
function adminSetJoinCode(pin, code) {
  adminAuth_(pin);
  code = String(code == null ? '' : code).replace(/\D/g, '');
  if (code && !/^\d{4,6}$/.test(code)) throw new Error('입사 코드는 숫자 4~6자리로 정해주세요.');
  setSetting_(K.joinCode, code);
  CacheService.getScriptCache().remove('fail:joincode:all');
  var jp = PropertiesService.getScriptProperties();
  jp.setProperty('joinGen', String((Number(jp.getProperty('joinGen')) || 0) + 1)); // 폰마다 걸린 잠금도 풀려요
  return adminToday(pin);
}

function monthRows_(ym) { return logRows_(ym); }

/**
 * [출퇴근기록]에서 날짜가 prefix('2026-11-24', '2026-11' 또는 '2026')로 시작하는 줄. 이번 실행에서 한 번만 읽어요.
 * 탭 전체를 읽지 않아요: 오늘·어제는 마지막 500줄에서, 그 밖은 날짜 칸만 읽고 그 날짜 줄들만 골라 읽어요(기록이 쌓여도 느려지지 않게).
 */
function logRows_(prefix) {
  return memo_('log:' + prefix, function () { return logRows0_(prefix); });
}

/** prefix에 맞는 [출퇴근기록] 줄(화면 글자 그대로). */
function logPick_(prefix) {
  if (prefix.length === 10 && prefix >= addDays_(nowKst_().date, -1)) {
    return logTail_().vals.filter(function (v) { return parseDate_(v[C.date]) === prefix; });
  }
  var idx = memo_('logDates', function () {
    var sh = sheet_(SHEETS.log), n = sh.getLastRow();
    return { sh: sh, d: n < 2 ? [] : sh.getRange(2, C.date + 1, n - 1, 1).getDisplayValues().map(function (r) { return parseDate_(r[0]) || ''; }) };
  });
  // 맞는 줄들을 덩어리로 묶어서 읽어요(사이가 50줄 안이면 한 덩어리: 읽는 횟수를 줄여요)
  var runs = [], a = -1, b = -1;
  idx.d.forEach(function (d, i) {
    if (!d || d.indexOf(prefix) !== 0) return;
    if (a >= 0 && i - b <= 50) { b = i; return; }
    if (a >= 0) runs.push([a, b]);
    a = b = i;
  });
  if (a >= 0) runs.push([a, b]);
  var out = [];
  runs.forEach(function (r) { out = out.concat(idx.sh.getRange(2 + r[0], 1, r[1] - r[0] + 1, LOG_HEAD.length).getDisplayValues()); });
  return out;
}

function logRows0_(prefix) {
  var ym = prefix;
  return logPick_(prefix).map(function (v) {
    return {
      date: parseDate_(v[C.date]), dow: String(v[C.dow] || ''), name: String(v[C.name]).trim(),
      sIn: fmtTime_(parseTime_(v[C.sIn])), sOut: fmtTime_(parseTime_(v[C.sOut])),
      tIn: fmtTime_(parseTime_(v[C.tIn])), tOut: fmtTime_(parseTime_(v[C.tOut])),
      late: toNum_(v[C.late]), early: toNum_(v[C.early]), work: toNum_(v[C.work]),
      deduct: toNum_(v[C.deduct]), memo: String(v[C.memo] || ''), place: String(v[C.place] || ''),
      store: String(v[C.store] || '').trim(),
    };
  }).filter(function (r) {
    return r.date && r.date.indexOf(ym) === 0 && r.name;
  }).sort(function (a, b) {
    return a.date < b.date ? -1 : a.date > b.date ? 1 : a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

function total_(rows, today) {
  var t = { days: 0, work: 0, lateCount: 0, lateMin: 0, earlyMin: 0, deduct: 0, noOut: 0, noIn: 0 };
  rows.forEach(function (r) {
    if (r.tIn || r.tOut) t.days++;
    t.work += r.work;
    if (r.late > 0) { t.lateCount++; t.lateMin += r.late; }
    t.earlyMin += r.early;
    t.deduct += r.deduct;
    if (r.tIn && !r.tOut && r.date !== today) t.noOut++;
    if (!r.tIn && r.tOut) t.noIn++;
  });
  return t;
}

/** 월별 합계·기록. only = 이 이름들만(점장 화면). */
function monthData_(ym, only) {
  var keep = function (n) { return n !== TEST_NAME && (!only || only.indexOf(n) >= 0); }; // 테스트 직원은 월별·정산에서 빼요
  var rows = monthRows_(ym).filter(function (r) { return keep(r.name); });
  var today = nowKst_().date;
  var people = staff_().filter(function (p) { return keep(p.name); });
  var names = people.map(function (p) { return p.name; });
  rows.forEach(function (r) { if (names.indexOf(r.name) < 0) names.push(r.name); });
  var mg = monthGrid_(ym); // 그 달 휴무표에 줄이 있는 사람(그 달에 퇴사한 사람, [직원] 줄을 지운 사람 포함)
  if (mg) Object.keys(mg.rows).forEach(function (n) { if (keep(n) && n !== '예시직원' && names.indexOf(n) < 0) names.push(n); });
  var storeOf = {};
  sortByStore_(people).forEach(function (p, i) { storeOf[p.name] = { store: p.store, i: i }; });
  names.sort(function (a, b) {
    return (storeOf[a] ? storeOf[a].i : 9999) - (storeOf[b] ? storeOf[b].i : 9999);
  });
  var staff = names.map(function (n) {
    var mine = rows.filter(function (r) { return r.name === n; });
    var t = total_(mine, today);
    t.name = n;
    t.store = storeOf[n] ? storeOf[n].store : mg && mg.rows[n] ? String(mg.rows[n].vals[mg.cols.store] || '').trim() : ''; // [직원] 줄을 지운 퇴사자는 휴무표 줄의 매장
    return t;
  }).filter(function (t) {
    return t.days || t.noIn || people.some(function (p) { return p.name === t.name && p.active; }) || !!(mg && mg.rows[t.name]);
  });
  return { ym: ym, staff: staff, rows: rows };
}

function exportMonth_(ym) {
  var ss = book_();
  var name = '정산 ' + ym;
  var sh = ss.getSheetByName(name);
  if (sh) sh.clear(); else sh = ss.insertSheet(name);
  var data = monthData_(ym);

  var head = ['이름', '매장', '근무일', '근무시간', '지각(회)', '지각(분)', '조퇴(분)', '차감 참고액(확인 필요)', '퇴근 누락', '출근 누락'];
  var sum = data.staff.map(function (s) {
    return [s.name, s.store, s.days, hm_(s.work), s.lateCount, s.lateMin, s.earlyMin, s.deduct, s.noOut, s.noIn];
  });
  sh.getRange(1, 1, 1, head.length).setValues([head]).setFontWeight('bold').setBackground('#eef2f7');
  // 차감 참고액은 늦게 온 시간만 센 숫자예요: 그대로 급여에서 빼지 않게 머리글 옆에 적어 둬요
  var DEDUCT_NOTE = '차감 참고액은 늦게 온·일찍 간 시간 × 시급으로 센 참고 숫자예요. 더 일한 시간·휴게시간·사장님이 일찍 보낸 날은 빼지 않았어요. 급여에 반영하기 전에 꼭 확인하세요.';
  sh.getRange(1, 8).setNote(DEDUCT_NOTE);
  sh.getRange(1, head.length + 2).setValue(DEDUCT_NOTE).setFontColor('#b91c1c');
  if (sum.length) {
    sh.getRange(2, 1, sum.length, 2).setNumberFormat('@');
    sh.getRange(2, 1, sum.length, head.length).setValues(sum);
    sh.getRange(2, 8, sum.length, 1).setNumberFormat('#,##0');
    storeLines_(sh, 2, sum.map(function (r) { return r[1]; }), head.length);
  }

  var top = sum.length + 3;
  sh.getRange(top, 1, 1, LOG_HEAD.length).setValues([LOG_HEAD]).setFontWeight('bold').setBackground('#eef2f7');
  if (data.rows.length) {
    var storeOf = {};
    staff_().forEach(function (p) { storeOf[p.name] = p.store; });
    var detail = data.rows.map(function (r) {
      return [r.date, r.dow, r.name, r.sIn, r.sOut, r.tIn, r.tOut,
        r.late || '', r.early || '', r.work || '', r.deduct || '', '', '', r.memo, r.place, r.store || storeOf[r.name] || ''];
    });
    var rg = sh.getRange(top + 1, 1, detail.length, LOG_HEAD.length);
    rg.setNumberFormats(detail.map(function () { return LOG_FMT; }));
    rg.setValues(detail);
  }
  sh.setFrozenRows(1);
  return { name: name, url: ss.getUrl() + '#gid=' + sh.getSheetId() };
}

/* ───────────── 휴무표 (달마다 한 장: '휴무표 2026-11') ───────────── */

var GRID_ = {}; // 한 번 실행하는 동안 읽은 휴무표를 기억해요
var OUTBOX_ = null; // 밤 마감처럼 줄(잠금)을 오래 잡는 동안 보낼 알림을 모아 두는 곳(null이면 바로 보내요)
var MEMO_ = {}; // 한 번 실행하는 동안 읽은 설정·직원·매장·근무변경을 기억해요(시트 읽기 횟수를 줄여서 빨라져요)

function memo_(key, fn) {
  if (!Object.prototype.hasOwnProperty.call(MEMO_, key)) MEMO_[key] = fn();
  return MEMO_[key];
}
// 기억을 잊을 때 그 탭을 통째로 읽어 둔 것(snap_)도 같이 잊어요
var SNAP_OF_ = { staff: '직원', staffCols: '직원', set: '설정', hol: '설정', stores: '매장', storeNames: '매장', change: '근무변경', hr: '인사', hrCols: '인사', hrDates: '인사' };
function forget_(key) {
  delete MEMO_[key];
  if (SNAP_OF_[key]) delete MEMO_['snap:' + SNAP_OF_[key]];
}

/** 그 달 휴무표 탭 이름: '2026-11' → '26.11'(탭이 짧아서 다른 탭 보기가 편해요) */
function monthName_(ym) { return String(ym).slice(2, 4) + '.' + String(ym).slice(5, 7); }
function oldMonthName_(ym) { return MONTH_PREFIX + ym; }

/** 탭 이름 → 그 달('2026-11'). '26.11'과 예전 '휴무표 2026-11'을 다 읽어요. 휴무표 탭이 아니면 '' */
function tabYm_(name) {
  name = String(name == null ? '' : name).trim();
  var m = /^(\d{2})\.(\d{2})$/.exec(name);
  if (m) return Number(m[2]) >= 1 && Number(m[2]) <= 12 ? '20' + m[1] + '-' + m[2] : '';
  return name.indexOf(MONTH_PREFIX) === 0 ? validYm_(name.slice(MONTH_PREFIX.length)) : '';
}

/** 그 달 휴무표 탭(예전 이름 탭이 아직 남아 있으면 그것). 없으면 null */
function monthSheet_(ym) {
  var ss = book_();
  return ss.getSheetByName(monthName_(ym)) || ss.getSheetByName(oldMonthName_(ym));
}

/**
 * 예전 이름('휴무표 2026-11') 탭을 '26.11'로 바꿔요. 실행마다 한 번(setup·10분 검사·휴무표 만들 때).
 * 구글 시트는 탭 이름을 바꾸면 다른 탭 수식(이월·부여)이 가리키는 이름도 같이 바꿔요. 작년~내년 달만 봐요. 바꾼 수를 돌려줘요.
 */
function monthRename_() {
  if (RENAMED_) return 0;
  RENAMED_ = true;
  var ss = book_(), n = 0, y0 = Number(nowKst_().ym.slice(0, 4)) - 1;
  for (var i = 0; i < 36; i++) {
    var ym = (y0 + Math.floor(i / 12)) + '-' + pad2_(i % 12 + 1);
    var old = ss.getSheetByName(oldMonthName_(ym));
    if (!old || ss.getSheetByName(monthName_(ym))) continue;
    try { old.setName(monthName_(ym)); delete GRID_[ym]; n++; } catch (err) { console.error(err); }
  }
  return n;
}

function nextYm_(ym) {
  var y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) + 1;
  if (m > 12) { y++; m = 1; }
  return y + '-' + pad2_(m);
}

function daysIn_(ym) {
  return new Date(Date.UTC(Number(ym.slice(0, 4)), Number(ym.slice(5, 7)), 0)).getUTCDate();
}

function colA1_(c) { // 1 → A, 27 → AA
  var s = '';
  for (; c > 0; c = Math.floor((c - 1) / 26)) s = String.fromCharCode(65 + (c - 1) % 26) + s;
  return s;
}

/**
 * 그 달 휴무표 탭을 만들고(없으면), 탭에 없는 재직 직원 줄을 아래에 더해요.
 * onlyIfMissing 이면 탭이 이미 있을 땐 아무것도 안 해요.
 */
function ensureMonth_(ym, onlyIfMissing, only) { // only: 이 사람 줄만 넣어요(마지막 근무일 고치기)
  monthRename_();
  var ss = book_();
  var sh = monthSheet_(ym);
  if (sh && onlyIfMissing) return sh;
  var created = !sh;
  if (created) {
    sh = ss.insertSheet(monthName_(ym), 0);
    buildMonth_(sh, ym);
    linked_(ym, true); // 새 버전이 만든 탭: 이월·부여가 처음부터 수식이라 '숫자 → 수식' 바꾸기가 필요 없어요
  }
  if (!created && sh.getLastRow() === 0) {
    // 손으로 만든 빈 탭: 새 탭처럼 채워요
    buildMonth_(sh, ym);
    linked_(ym, true);
    created = true;
  }
  var g = monthGrid_(ym, true);
  if (g.bad) return sh; // 1행에 머리글이 없는 탭은 건드리지 않아요(10분 검사가 사장님께 알려요)
  if (g.narrow) {
    sh.insertColumnsAfter(sh.getMaxColumns(), g.cols.day1 + 32 - sh.getMaxColumns());
    g = monthGrid_(ym, true);
  }
  if (g.cols.full < 0) {
    addFullCol_(g, ym); // 예전 탭: 만근 칸 끼워 넣기
    g = monthGrid_(ym, true);
  }
  // 재직 중이고 그 달에 하루라도 다니는 사람만(입사하기 전 달, 마지막 근무일이 지난 달에는 줄을 안 만들어요)
  var hd = hrDates_();
  var leftIn = function (n) { var d = hd[n]; return !!(d && d.end && d.end.slice(0, 7) >= ym); }; // 퇴사일이 이 달이나 뒤
  var cand = staff_().filter(function (p) { return p.active || (leftIn(p.name) && findStaff_(p.name) === p); });
  hrRows_().forEach(function (h) { if (h.state === '퇴사' && leftIn(h.name) && !findStaff_(h.name)) cand.push({ name: h.name, store: h.store, row: 1e6 }); });
  var seen = {};
  var people = sortByStore_(cand.filter(function (p) { if ((only && p.name !== only) || seen[p.name] || g.rows[p.name] || !employedIn_(p.name, ym)) return false; return (seen[p.name] = true); }));
  if (people.length) {
    var have = Object.keys(g.rows).map(function (n) {
      return { row: g.rows[n].row, store: String(g.rows[n].vals[g.cols.store] || '').trim() };
    });
    if (!have.length) {
      // 새 탭: 매장 순서대로 한 번에
      var start = Math.max(sh.getLastRow(), 2) + 1;
      if (start + people.length - 1 > sh.getMaxRows()) sh.insertRowsAfter(sh.getMaxRows(), people.length + 50);
      var rows = people.map(function (p, i) { return monthRow_(start + i, p, ym, g.cols); });
      sh.getRange(start, 1, rows.length, rows[0].length).setValues(rows);
    } else {
      // 이미 쓰던 탭: 새 직원은 같은 매장(없으면 앞 순서 매장) 마지막 줄 바로 아래에 끼워 넣어요
      people.forEach(function (p) { insertMonthRow_(sh, g, have, p, ym); });
    }
  }
  delete GRID_[ym];
  if (created || people.length) {
    var g2 = monthGrid_(ym, true);
    paintMonth_(sh, ym, g2.cols);
    if (created) monthRules_(sh, g2.cols.day1, g2.cols);
  }
  // 이 탭이 새로 생겼으면, 먼저 만들어져 있던 다음 달 탭의 이월·부여 수식을 다시 이어요
  if (created && monthSheet_(nextYm_(ym))) relinkMonth_(nextYm_(ym));
  return sh;
}

/**
 * 이미 쓰던 휴무표 탭에 한 사람 줄을 같은 매장(없으면 앞 순서 매장) 마지막 줄 바로 아래에 끼워 넣어요.
 * have = [{row, store}] 지금 있는 줄들(끼워 넣으면서 줄 번호를 맞춰 줘요). 넣은 줄 번호를 돌려줘요.
 */
function insertMonthRow_(sh, g, have, p, ym) {
  var order = {};
  stores_().forEach(function (st, i) { order[st.name] = i; });
  var idx = function (st) { return order[st] == null ? 999 : order[st]; };
  var after = 2;
  have.forEach(function (h) { if (idx(h.store) <= idx(p.store) && h.row > after) after = h.row; });
  sh.insertRowsAfter(after, 1);
  have.forEach(function (h) { if (h.row > after) h.row++; });
  // 끼워 넣은 줄은 위 줄(머리글일 수도 있어요) 서식을 따라와서, 직원 줄 서식으로 맞춰요
  var w = g.cols.day1 + 32;
  sh.getRange(after + 1, 1, 1, w).setFontWeight('normal').setBackground(null);
  sh.getRange(after + 1, g.cols.store + 1, 1, 2).setNumberFormat('@');
  sh.getRange(after + 1, g.cols.day1 + 1, 1, 32).setNumberFormat('@');
  var row = monthRow_(after + 1, p, ym, g.cols);
  sh.getRange(after + 1, 1, 1, row.length).setValues([row]);
  have.push({ row: after + 1, store: p.store });
  return after + 1;
}

/**
 * 휴무표 보기 좋게 칠해요(새 탭·새 직원·setup·휴무표 만들기 때).
 *  - 날짜 머리글: 일요일·공휴일 빨강, 토요일 파랑, 공휴일 이름은 요일 칸 메모
 *  - 날짜 칸: 일요일·공휴일 옅은 빨강, 토요일 옅은 파랑 음영(맨 아래까지)
 *  - 집계 칸(휴무~지각) 옅은 회색, 매장이 바뀌는 줄 아래 굵은 선, 매장 이름은 묶음 첫 줄만 진하게
 */
function paintMonth_(sh, ym, cols) {
  var day1 = cols.day1, n = daysIn_(ym), hol = holidaysIn_(ym);
  markHolidays_(sh, ym, day1);
  var last = sh.getLastRow();
  // 직원 줄 + 여유 30줄만 칠해요(새 직원 줄은 위 줄 서식을 따라와요). 한 번에 칠해서 빨라요
  var rows = Math.max(Math.min(Math.max(last, 3) - 2 + 30, sh.getMaxRows() - 2), 1);
  var line = [];
  for (var d = 1; d <= 31; d++) {
    var date = ym + '-' + pad2_(d), dow = d <= n ? dowOf_(date) : -1;
    line.push(d > n ? '#e5e7eb' : hol[date] || dow === 0 ? '#fef2f2' : dow === 6 ? '#eff6ff' : null);
  }
  var bgs = [];
  for (var i = 0; i < rows; i++) bgs.push(line);
  sh.getRange(3, day1 + 1, rows, 31).setBackgrounds(bgs);
  if (day1 > cols.name + 1) sh.getRange(3, cols.name + 2, rows, day1 - cols.name - 1).setBackground('#f8fafc');
  if (last < 3) return;
  var width = Math.max(sh.getLastColumn(), day1 + 32);
  // No 칸(머리글이 'No'일 때만)은 줄 번호 수식으로: 줄을 끼워 넣어도 번호가 맞아요
  if (String(sh.getRange(1, 1).getDisplayValue()).trim() === 'No') sh.getRange(3, 1, last - 2, 1).setFormula('=ROW()-2');
  var stores = sh.getRange(3, cols.store + 1, last - 2, 1).getDisplayValues().map(function (r) { return String(r[0]).trim(); });
  sh.getRange(3, 1, last - 2, width).setBorder(false, false, false, false, false, false);
  storeLines_(sh, 3, stores, width);
  var colors = [], weights = [];
  stores.forEach(function (st, i) {
    var first = i === 0 || stores[i - 1] !== st;
    colors.push([first ? '#111827' : '#cbd5e1']);
    weights.push([first ? 'bold' : 'normal']);
  });
  sh.getRange(3, cols.store + 1, stores.length, 1).setFontColors(colors).setFontWeights(weights);
}

/** 매장이 바뀌는 줄 아래에 굵은 선을 그어요(같은 매장끼리 묶여 보이게). stores[i] = row+i 줄의 매장. */
function storeLines_(sh, row, stores, width) {
  var list = [];
  stores.forEach(function (st, i) {
    if (i === stores.length - 1 || stores[i + 1] !== st) list.push(a1_(row + i, 1, 1, width));
  });
  // 여러 줄을 한 번에
  if (list.length) sh.getRangeList(list).setBorder(null, null, true, null, null, null, '#475569', SpreadsheetApp.BorderStyle.SOLID_MEDIUM);
}

/** 직원 한 줄: No, 매장, 이름, 그리고 집계 수식(휴무·월차·이월·부여·잔여·지각·만근). cols = 그 탭의 칸 위치. */
function monthRow_(r, p, ym, cols) {
  cols = cols || MT;
  var d1 = cols.day1;
  var days = colA1_(d1 + 1) + r + ':' + colA1_(d1 + 31) + r;
  var prev = monthName_(prevYm_(ym));
  var row = [
    '=ROW()-2', p.store, p.name,
    '=COUNTIF(' + days + ',"*휴무*")+COUNTIF(' + days + ',"*휴가*")+0.5*COUNTIF(' + days + ',"*반차*")',
    '=COUNTIF(' + days + ',"*월차*")',
    carryFormula_(ym, prev, r),
    grantFormula_(prev, r),
    '=F' + r + '+G' + r + '-E' + r,
    '=SUMPRODUCT(--ISNUMBER(SEARCH(":",' + days + ')))',
  ];
  while (row.length < cols.full) row.push(''); // 예전 '아웃' 칸이 끼어 있는 탭
  row.push(fullFormula_(ym, r, d1));
  return row;
}

/** 이월: 지난달 잔여. 1월은 0(해를 넘겨 이월 안 돼요). */
function carryFormula_(ym, prev, r) {
  if (ym.slice(5) === '01') return 0;
  return "=IFERROR(VLOOKUP($C" + r + ",'" + prev + "'!$C:$H,6,FALSE),0)";
}

/** 부여: 전달 휴무표 '만근' 칸이 만근(만근 예정 포함)이면 1. 전달 탭이나 그 사람 줄이 없으면 0. */
function grantFormula_(prev, r) {
  var q = "'" + prev + "'";
  return '=IF(LEFT(IFERROR(INDEX(' + q + '!$A:$AZ,MATCH($C' + r + ',' + q + '!$C:$C,0),MATCH("만근",' + q + '!$1:$1,0)),""),2)="만근",1,0)';
}

/**
 * 만근 칸 수식(실제 구글 시트에서 계산 확인함):
 *  결근·무단이 있으면 '아님: 11/5 결근?, 11/12 무단결근'
 *  휴직이 낀 달은 '아님: 휴직 12일'
 *  아니면 달이 끝나기 전 '만근 예정', 끝나면 '만근'
 * 입사한 달도 입사일 뒤로 결근이 없으면 만근이에요(사장님: 월차는 넉넉하게). d1 = 첫 날짜 칸(0부터).
 */
function fullFormula_(ym, r, d1) {
  var a = colA1_(d1 + 1), b = colA1_(d1 + 31);
  var days = a + r + ':' + b + r, head = '$' + a + '$1:$' + b + '$1';
  return '=IF(SUMPRODUCT(--REGEXMATCH(' + days + '&"","' + FULL_BREAK + '")),"아님: "&IFERROR(TEXTJOIN(", ",TRUE,FILTER(TEXT(' + head + ',"m/d")&" "&' + days +
    ',REGEXMATCH(' + days + '&"","' + FULL_BREAK + '"))),"결근"),' +
    'IF(SUMPRODUCT(--REGEXMATCH(' + days + '&"","' + AWAY_MARK + '")),"아님: ' + AWAY_MARK + ' "&SUMPRODUCT(--REGEXMATCH(' + days + '&"","' + AWAY_MARK + '"))&"일",' +
    'IF(TODAY()<=DATE(' + Number(ym.slice(0, 4)) + ',' + Number(ym.slice(5, 7)) + ',' + daysIn_(ym) + '),"만근 예정","만근")))';
}

/**
 * 예전 휴무표 탭(만근 칸 없음): 첫 날짜 칸 앞에 '만근' 칸을 끼워 넣고 수식을 채워요.
 * (날짜 칸을 가리키는 수식·색칠 규칙은 시트가 알아서 한 칸씩 옮겨요)
 */
function addFullCol_(g, ym) {
  var sh = g.sh, c = g.cols.day1 + 1; // 1부터: 지금 첫 날짜 칸
  sh.insertColumnsBefore(c, 1);
  sh.getRange(1, c, 2, 1).setValues([['만근'], ['이번 달']]);
  sh.getRange(1, c).setNote(FULL_NOTE);
  sh.setColumnWidth(c, 110);
  sh.getRange(1, g.cols.grant, 1, 2).setNotes([[CARRY_NOTE, GRANT_NOTE]]);
  delete GRID_[ym];
  relinkMonth_(ym);
}

/**
 * 그 달 탭의 이월·부여·만근 수식을 앞 달 탭과 다시 이어요.
 * 구글 시트는 수식을 적을 때 없던 탭을 가리키면, 그 탭이 나중에 생겨도 저절로 이어 주지 않아요(실제 시트에서 확인).
 * 그래서 앞 달 탭이 새로 생겼을 때, setup 때, 예전 자료를 가져왔을 때 수식을 다시 적어 줘요.
 *  - 수식인 칸은 지금 수식으로 다시 적어요.
 *  - 숫자가 적힌 칸은, 앞 달 탭이 있고 앱이 넣었을 값(이월 0·빈칸, 부여 0·1·빈칸)일 때만 수식으로 바꿔요.
 *    사장님이 직접 적은 다른 숫자(이월 3, 부여 2 등)는 그대로 둬요. 그대로 둔 칸 수를 돌려줘요.
 */
function relinkMonth_(ym) {
  var g = monthGrid_(ym, true);
  if (!g || g.bad || g.cols.full < 0) return 0;
  var sh = g.sh, last = sh.getLastRow();
  if (last < 3) return 0;
  var prev = monthName_(prevYm_(ym));
  var pg = monthGrid_(prevYm_(ym));
  var hasPrev = !!pg, prevFull = !!(pg && pg.cols.full >= 0);
  var jan = ym.slice(5) === '01';
  var c0 = g.cols.grant - 1, width = g.cols.full - c0 + 1; // 이월 칸부터 만근 칸까지
  var rg = sh.getRange(3, c0 + 1, last - 2, width);
  var fx = rg.getFormulas(), vals = rg.getValues();
  var at = {};
  Object.keys(g.rows).forEach(function (n) { at[g.rows[n].row] = true; });
  var kept = 0;
  var num = function (x) { return x === '' || x == null ? '' : Number(x); };
  // 숫자 칸을 수식으로 바꾸는 건 예전 버전이 만든 탭(이월 0·부여 1을 숫자로 적어 둠)을 처음 이을 때 한 번만 해요.
  // 그 뒤로는 수식인 칸만 다시 적어서, 사장님이 직접 적은 숫자(0·1 포함)는 그대로 둬요
  var first = !linked_(ym);
  var out = vals.map(function (v, i) {
    var r = i + 3;
    var row = v.map(function (x, j) { return fx[i][j] || x; }); // 수식은 수식대로
    if (!at[r]) return row;
    var cv = fx[i][0] ? '' : num(v[0]);
    if (jan) {
      if (fx[i][0] || cv === '' || (first && cv === 0)) row[0] = 0; else if (cv !== 0) kept++;
    } else if (fx[i][0] || cv === '' || (first && hasPrev && cv === 0)) row[0] = carryFormula_(ym, prev, r);
    else kept++;
    var gv = fx[i][1] ? '' : num(v[1]);
    if (fx[i][1] || gv === '' || (first && prevFull && (gv === 0 || gv === 1))) row[1] = grantFormula_(prev, r);
    else kept++;
    var fv = v[width - 1];
    if (fx[i][width - 1] || fv === '' || fv == null) row[width - 1] = fullFormula_(ym, r, g.cols.day1);
    return row;
  });
  rg.setValues(out);
  if (prevFull) sh.getRange(2, g.cols.grant + 1).setValue('전달 만근');
  if (first && hasPrev) linked_(ym, true); // 앞 달 탭과 한 번 이었어요(이제부터 숫자는 사장님 것)
  delete GRID_[ym];
  return kept;
}

/** 그 달 탭의 이월·부여를 앞 달과 이은 적이 있는지(스크립트 속성). set=true면 표시해요. 새 버전이 만든 탭은 만들 때 표시해요. */
function linked_(ym, set) {
  var props = PropertiesService.getScriptProperties();
  if (set) { props.setProperty('linked:' + ym, '1'); return true; }
  return !!props.getProperty('linked:' + ym);
}

/** 새 달 탭의 머리글·서식·색칠 규칙. */
function buildMonth_(sh, ym) {
  var n = daysIn_(ym), m = Number(ym.slice(5, 7));
  var head1 = ['No', '매장', '이름', '휴무', '월차', '이월', '부여', '잔여', '지각', '만근'];
  var head2 = ['', '', '', '반차 0.5', '사용', '지난달', '전달 만근', '남은 월차', '회', '이번 달'];
  for (var d = 1; d <= 31; d++) {
    head1.push(d <= n ? m + '/' + d : '');
    head2.push(d <= n ? DOW[dowOf_(ym + '-' + pad2_(d))] : '');
  }
  head1.push('메모');
  head2.push('');
  var width = head1.length; // 42 (새 탭은 26칸뿐이라 늘려요)
  if (sh.getMaxColumns() < width) sh.insertColumnsAfter(sh.getMaxColumns(), width - sh.getMaxColumns());
  var rows = sh.getMaxRows();
  sh.getRange(1, 1, 2, width).setValues([head1, head2]).setFontWeight('bold').setBackground('#eef2f7').setHorizontalAlignment('center');
  sh.setFrozenRows(2);
  sh.setFrozenColumns(3);
  sh.getRange(3, 2, rows - 2, 2).setNumberFormat('@');
  sh.getRange(3, MT.day1 + 1, rows - 2, 31).setNumberFormat('@').setHorizontalAlignment('center');
  sh.getRange(3, MT.memo + 1, rows - 2, 1).setNumberFormat('@');
  sh.setColumnWidth(1, 36);
  sh.setColumnWidth(2, 80);
  sh.setColumnWidth(3, 70);
  sh.setColumnWidths(4, MT.full - 3, 52); // 집계 칸
  sh.setColumnWidth(MT.full + 1, 110); // 만근(아니면 이유)
  sh.setColumnWidths(MT.day1 + 1, 31, 46); // 날짜 칸
  sh.setColumnWidth(MT.memo + 1, 220);
  if (n < 31) sh.getRange(1, MT.day1 + n + 1, rows, 31 - n).setBackground('#e5e7eb'); // 그달에 없는 날
  sh.getRange(1, MT.day1 + 1).setNote(
    '칸에 쓰는 말: 휴무, 월차, 반차, 휴가, 무급, 명절(추석·설날), 대체(대체휴무 쓰는 날)\n' +
    '지각은 앱이 출근 시간을 11:08 처럼 자동으로 적어요(빨간 글씨).\n' +
    '대타는 앱이 "대타"라고 적어요(다른 매장 동료가 대타면 "대타 왕십리"처럼 간 매장 이름도).\n' +
    '휴무? = 직원이 앱에서 고른 다음 달 휴무(사장님 화면에서 확정하면 휴무)\n' +
    '결근? = 근무하는 날인데 출퇴근 기록이 없어서 밤에 앱이 적은 것. 확인하고 고쳐주세요\n' +
    '빨간 날짜 = 일요일·공휴일(요일 칸에 메모로 이름)\n' +
    '휴무 = 휴무 + 휴가 + 반차×0.5 / 월차 잔여 = 이월 + 부여 − 사용 / 지각 = 시간이 적힌 칸 수');
  sh.getRange(1, MT.carry + 1, 1, 5).setNotes([[CARRY_NOTE, GRANT_NOTE, '', '', FULL_NOTE]]);
}

/** 휴무표 날짜 머리글 색: 일요일·공휴일 빨강, 토요일 파랑. 공휴일은 요일 칸(2행)에 메모로 이름을 달아요. */
function markHolidays_(sh, ym, day1) {
  var n = daysIn_(ym);
  var hol = holidaysIn_(ym);
  var colors = [[], []], notes = [[]];
  for (var d = 1; d <= n; d++) {
    var date = ym + '-' + pad2_(d);
    var dow = dowOf_(date);
    var c = hol[date] || dow === 0 ? '#dc2626' : dow === 6 ? '#2563eb' : '#000000';
    colors[0].push(c);
    colors[1].push(c);
    notes[0].push(hol[date] ? whenOf_(date) + ' ' + hol[date] : '');
  }
  sh.getRange(1, day1 + 1, 2, n).setFontColors(colors);
  sh.getRange(2, day1 + 1, 1, n).setNotes(notes);
}

/** 휴무표 날짜 칸 색칠 규칙. 먼저 맞는 규칙 색이 칠해져요. */
function monthRules_(sh, day1, cols) {
  var n = Math.max(sh.getMaxRows() - 2, 1);
  var days = sh.getRange(3, day1 + 1, n, 31);
  var extra = [
    // 오늘 날짜 머리글을 노랗게
    SpreadsheetApp.newConditionalFormatRule().setRanges([sh.getRange(1, day1 + 1, 2, 31)])
      .whenFormulaSatisfied('=TEXT(' + colA1_(day1 + 1) + '$1,"M/D")=TEXT(TODAY(),"M/D")').setBackground('#fde68a').setBold(true).build(),
  ];
  if (cols && cols.full >= 0) {
    var fr = sh.getRange(3, cols.full + 1, n, 1);
    extra.push(SpreadsheetApp.newConditionalFormatRule().setRanges([fr]).whenTextStartsWith('아님').setBackground('#fee2e2').setFontColor('#b91c1c').build());
    extra.push(SpreadsheetApp.newConditionalFormatRule().setRanges([fr]).whenTextStartsWith('만근').setFontColor('#15803d').build());
  }
  if (cols && cols.left >= 0) {
    extra.push(SpreadsheetApp.newConditionalFormatRule().setRanges([sh.getRange(3, cols.left + 1, n, 1)])
      .whenNumberLessThan(0).setBackground('#fee2e2').setFontColor('#b91c1c').build());
  }
  markRules_(sh, days, colA1_(day1 + 1) + '3', extra);
}

/**
 * 그 달 휴무표를 읽어서 이름 → {row, vals} 로 정리해요. 탭이 없으면 null.
 * 칸 위치는 1행 머리글에서 찾아요: '이름', 첫 날짜('11/1'), '메모'. (예전 탭처럼 '아웃' 칸이 있어도 돼요)
 */
function monthGrid_(ym, fresh) {
  if (!fresh && GRID_[ym] !== undefined) return GRID_[ym];
  var sh = monthSheet_(ym);
  var g = null;
  if (sh) {
    var width = Math.max(sh.getLastColumn(), MT.memo + 1), maxCols = 0;
    var head;
    try {
      head = sh.getRange(1, 1, 1, width).getDisplayValues()[0];
    } catch (err) {
      // 손으로 만든 빈 탭은 칸이 26개뿐일 수 있어요: 있는 칸까지만 읽어요(평소에는 이 길로 안 와서 시트 호출이 늘지 않아요)
      maxCols = sh.getMaxColumns();
      width = maxCols;
      head = sh.getRange(1, 1, 1, width).getDisplayValues()[0];
    }
    head = head.map(function (h) { return String(h).trim(); });
    var day1 = -1;
    head.forEach(function (h, i) { if (day1 < 0 && /^\d{1,2}\/1$/.test(h)) day1 = i; });
    var cols = {
      name: head.indexOf('이름') >= 0 ? head.indexOf('이름') : MT.name,
      day1: day1 >= 0 ? day1 : MT.day1,
      left: head.indexOf('잔여') >= 0 ? head.indexOf('잔여') : MT.left,
      store: head.indexOf('매장') >= 0 ? head.indexOf('매장') : MT.store,
      grant: head.indexOf('부여') >= 0 ? head.indexOf('부여') : MT.grant,
      full: head.indexOf('만근'), // 예전 탭은 -1
    };
    cols.memo = head.indexOf('메모') > cols.day1 ? head.indexOf('메모') : cols.day1 + 31;
    g = { sh: sh, rows: {}, cols: cols };
    // 1행에 '이름'도 날짜 머리글도 없으면(위에 제목 줄을 끼웠거나 손으로 만든 탭) 칸 위치를 몰라서 읽지도 쓰지도 않아요
    g.bad = head.indexOf('이름') < 0 && day1 < 0 && sh.getLastRow() > 0;
    g.narrow = !!maxCols && maxCols < cols.day1 + 32; // 맨 오른쪽 칸(메모 등)을 지운 탭: 줄을 넣기 전에 칸을 채워요
    var last = g.bad ? 0 : sh.getLastRow();
    if (last >= 3) {
      var wide = Math.max(width, cols.day1 + 31);
      sh.getRange(3, 1, last - 2, maxCols ? Math.min(wide, maxCols) : wide).getDisplayValues().forEach(function (v, i) {
        var n = String(v[cols.name]).trim();
        if (n && !g.rows[n]) g.rows[n] = { row: i + 3, vals: v };
      });
    }
  }
  GRID_[ym] = g;
  return g;
}

/** 'YYYY-MM-DD'의 일이 그 달 안(1~말일)인지. */
function inMonth_(date) {
  var d = Number(String(date || '').slice(8, 10));
  return /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')) && d >= 1 && d <= daysIn_(date.slice(0, 7));
}

/** 휴무표 그날 칸에 적힌 말. */
function dayMark_(name, date) {
  if (!inMonth_(date)) return '';
  var g = monthGrid_(date.slice(0, 7));
  var r = g && g.rows[name];
  return r ? String(r.vals[g.cols.day1 + Number(date.slice(8)) - 1] || '').trim() : '';
}

/** 휴무표 그날 칸을 fn(지금 값) 으로 바꿔요. 탭이나 줄이 없으면 만들어요. */
function setMark_(date, name, fn) {
  if (!inMonth_(date)) return; // 날짜 칸 밖(메모 칸 등)은 절대 안 건드려요
  var ym = date.slice(0, 7);
  var g = monthGrid_(ym);
  if (!g || !g.rows[name]) {
    ensureMonth_(ym);
    g = monthGrid_(ym, true);
  }
  var r = g && g.rows[name];
  if (!r) return; // 퇴사자 등
  if (String(g.sh.getRange(r.row, g.cols.name + 1).getDisplayValue()).trim() !== name) {
    // 읽은 뒤에 줄이 바뀌었어요(새 직원 줄 끼워 넣기 등). 다시 읽어요
    g = monthGrid_(ym, true);
    r = g && g.rows[name];
    if (!r) return;
  }
  var idx = g.cols.day1 + Number(date.slice(8)) - 1;
  var old = String(r.vals[idx] || '').trim();
  var res = fn(old);
  var nv = String(res == null ? '' : res).trim();
  if (nv === old) return;
  g.sh.getRange(r.row, idx + 1).setNumberFormat('@').setValue(nv);
  r.vals[idx] = nv;
}

/**
 * 출퇴근기록 한 줄을 보고, 지각이면 휴무표에 출근 시간(11:08)을 적고 아니면 지워요. 다른 말은 안 건드려요.
 * 밤에 적힌 '결근?'도 출근 기록이 생기면(정정 승인 등) 시간으로 바뀌거나 지워져요.
 */
function syncLateMark_(date, name, v) {
  var late = toNum_(v[C.late]);
  var tIn = fmtTime_(parseTime_(v[C.tIn]));
  // 지원 근무: 출근을 소속 매장이 아닌 다른 매장에서 찍었으면 그 매장 이름을 칸에 적어요(누가 어디로 몇 번 갔는지 세는 근거)
  var place = String(v[C.place] || '').trim(), home = String(v[C.store] || '').trim();
  var sup = tIn && place && home && place !== home ? place : '';
  var names = storeNames_();
  var placeName = names[place] || place;
  setMark_(date, name, function (old) {
    // 칸에 적힌 말에서 앱이 관리하는 조각(시간, 이번에 찍은 매장 이름)을 떼고 나머지(대타, 휴무, 사장님이 적은 지원 매장 등)는 그대로 둬요
    var txt = ' ' + String(old || '') + ' ';
    if (placeName) {
      // 찍은 매장을 알아요: 칸의 매장 이름은 모두 앱 몫이라 떼고(계획이 바뀌어 다른 데서 찍었으면 예전 이름이 남지 않게) 아래에서 다시 붙여요
      Object.keys(names).forEach(function (k) { if (/\s/.test(k)) txt = txt.split(' ' + k + ' ').join(' '); }); // 띄어 쓴 매장 이름
    }
    var rest = txt.split(/\s+/).filter(function (w) {
      return w && !/^\d{1,2}:\d{2}$/.test(w) && !(placeName && names[w]) && !(w === '결근?' && tIn);
    });
    var out = rest.slice();
    if (sup && supportOf_(rest.join(' '), names) !== (names[sup] || sup)) out.push(sup);
    if (late > 0 && tIn) {
      // 쉬는 날 말(휴무 등)이 적힌 칸에는 시간을 붙이지 않아요(예전과 같게: 쉬는 날 출근은 지각이 아니에요)
      var offWord = rest.some(function (w) { return OFF_RE.test(w) && !/^대타/.test(w); });
      if (!offWord) out.push(tIn);
    }
    return out.join(' ');
  });
}

/**
 * 그날이 '쉬는 날'이라고 적혀 있는지: [근무변경] → 휴무표 칸 → [직원] 요일 칸 순서로 봐요(schedFor_와 같은 순서).
 * 반차(반나절 근무), 고른 휴무(휴무?·월차?·병가? 등, 확정 전), 근무시간이 아직 안 정해진 날은 쉬는 날이 아니에요.
 */
function offDayKnown_(p, date, changes) {
  var chg = null;
  (changes || changes_()).forEach(function (r) {
    if (parseDate_(r[0]) === date && String(r[1]).trim() === p.name) chg = String(r[2] == null ? '' : r[2]).trim();
  });
  if (chg !== null) return !parseSchedule_(chg) && (OFF_RE.test(chg) || /off/i.test(chg));
  var mark = dayMark_(p.name, date);
  if (mark) return OFF_RE.test(mark) && !/반차/.test(mark) && !WISH_RE.test(mark); // 고른 것('휴무?'·'병가?' 등)은 아직 확정 전
  var w = String(p.week[dowOf_(date)] || '').trim();
  return !!w && (OFF_RE.test(w) || /off/i.test(w));
}

/* ───────────── 사장님 화면 근무표: 보고 바로 고치기 ───────────── */

/** 사장님 화면 [근무표]에서 칸을 눌러 고를 수 있는 말. 지우기는 빈칸(''), '결근'은 결근 확정이에요. */
var GRID_MARKS = ['휴무', '월차', '반차', '무급', '대체', '휴가', '병가', '경조', '예비군', '기타', '결근'];

/**
 * 사장님 화면 [근무표]: 그 달 휴무표 탭을 매장별로 사람 × 날짜로 보여줘요(탭의 줄 순서·칸 글자 그대로).
 *  - 점장은 자기 매장만 봐요(고치기는 관리자만: adminSetMark). 테스트·예시 줄은 빼요.
 *  - 관리자는 [매장] 탭에 없는 매장 이름이 적힌 줄도 끝에 따로 묶어서 봐요(손으로 적은 줄이 숨지 않게).
 *  - 칸이 비었고 [직원] 그 요일 칸이 쉬는 날이면 reg(요일 휴무)에 넣어요. 입사 전·퇴사 뒤 날은 from~to 밖이에요.
 *  - offCount: 날마다 쉬는 사람 수(반차 빼고, 고른 '휴무?'·요일 휴무 포함). maxOff = [매장] 하루 최대 휴무(0 = 제한 없음).
 * store: 처음 보여줄 매장(비우거나 못 보는 매장이면 줄이 있는 첫 매장). 매장을 바꿀 때 다시 부르지 않게 볼 수 있는 매장을 모두 돌려줘요.
 */
function adminGrid(cred, ym, store) {
  var a = auth_(cred);
  var admin = a.role === 'admin';
  var now = nowKst_();
  ym = normYm_(ym) || now.ym;
  var n = daysIn_(ym), first = ym + '-01', last = ym + '-' + pad2_(n);
  var g = monthGrid_(ym, true);
  var ok = !!g && !g.bad;
  var groups = [], by = {};
  var group = function (name) {
    if (!by[name]) { by[name] = { name: name, rows: [] }; groups.push(by[name]); }
    return by[name];
  };
  stores_().forEach(function (st) { if (canSee_(a, { store: st.name })) group(st.name); });
  var hd = hrDates_(), subs = admin ? subTotals_() : {};
  // 병가·기타 등 사유를 남기는 칸이 있으면 칸 메모(사유)를 한 번에 읽어요
  var notes = null;
  if (ok && Object.keys(g.rows).some(function (nm) {
    for (var i = 1; i <= n; i++) if (WHY_KINDS.indexOf(String(g.rows[nm].vals[g.cols.day1 + i - 1] || '').trim().replace(/\?$/, '')) >= 0) return true;
    return false;
  })) notes = g.sh.getRange(1, g.cols.day1 + 1, g.sh.getLastRow(), n).getNotes();
  if (ok) {
    Object.keys(g.rows).sort(function (x, y) { return g.rows[x].row - g.rows[y].row; }).forEach(function (name) {
      if (name === TEST_NAME || name === '예시직원') return;
      var v = g.rows[name].vals;
      var st = String(v[g.cols.store] || '').trim() || '(매장 없음)';
      if (!by[st] && !admin) return;
      var p = findStaff_(name), d = hd[name] || {};
      var from = d.start && d.start > first ? (d.start > last ? n + 1 : Number(d.start.slice(8))) : 1;
      var to = d.end && d.end < last ? (d.end < first ? 0 : Number(d.end.slice(8))) : n;
      var cells = [], reg = [], off = 0, why = {}, nrow = notes && notes[g.rows[name].row - 1];
      for (var i = 1; i <= n; i++) {
        var t = String(v[g.cols.day1 + i - 1] || '').trim();
        var w = p ? String(p.week[dowOf_(ym + '-' + pad2_(i))] || '').trim() : '';
        cells.push(t);
        if (nrow && WHY_KINDS.indexOf(t.replace(/\?$/, '')) >= 0) { var y = noteWhy_(nrow[i - 1]); if (y) why[i] = y; }
        if (!t && i >= from && i <= to && w && (OFF_RE.test(w) || /off/i.test(w))) reg.push(i);
        off += (/휴무/.test(t) ? 1 : 0) + (/휴가/.test(t) ? 1 : 0) + (/반차/.test(t) ? 0.5 : 0); // 휴무표 '휴무' 칸 수식과 같게
      }
      var lv = String(v[g.cols.left] || '').trim();
      group(st).rows.push({
        name: name, cells: cells, from: from, to: to, reg: reg, off: off, why: why, // why = {날: 사유}(병가·기타 등)
        left: admin && /^-?\d+(\.\d+)?$/.test(lv) ? Number(lv) : null, // 남은 월차(관리자만, 칸 고르는 창에 보여요)
        sub: admin ? subs[name] || 0 : null, // 남은 대체휴무
      });
    });
  }
  var out = groups.map(function (gr) {
    var st = storeOf_(gr.name), count = [];
    for (var i = 1; i <= n; i++) {
      var c = 0;
      gr.rows.forEach(function (r) {
        var t = r.cells[i - 1];
        if (i >= r.from && i <= r.to && ((t && OFF_RE.test(t) && !/반차/.test(t)) || r.reg.indexOf(i) >= 0)) c++;
      });
      count.push(c);
    }
    return { name: gr.name, maxOff: st ? st.maxOff : 0, rows: gr.rows, offCount: count };
  });
  store = String(store == null ? '' : store).trim();
  if (!by[store]) {
    var withRows = out.filter(function (s) { return s.rows.length; })[0];
    store = withRows ? withRows.name : out.length ? out[0].name : '';
  }
  return {
    ym: ym, today: now.date, days: n, firstDow: dowOf_(first), holidays: holidaysIn_(ym),
    admin: admin, closed: isClosed_(ym), hasTab: ok, bad: !!(g && g.bad), marks: GRID_MARKS.slice(),
    store: store, stores: out,
    url: admin && g ? book_().getUrl() + '#gid=' + g.sh.getSheetId() : '',
  };
}

/**
 * 사장님 화면 [근무표]에서 칸 하나를 바꿔요(관리자만). day = 그 달 며칠, value = GRID_MARKS 중 하나 또는 ''(지우기).
 * why = 사유(병가·기타 등일 때 그 칸 메모에 '사유: …'로 남아요. 다른 말로 바꾸면 사유 줄은 지워요).
 *  - 마감한 달, 입사 전·퇴사 뒤 날, 그 달 휴무표에 줄이 없는 사람, 목록에 없는 말은 막아요.
 *  - 쉬는 말(휴무·월차·반차·무급·대체)은 요청 승인과 같게 적어요([근무변경]에 그날 근무 시간이 있으면 쉬는 날이 되게 한 줄 더).
 *    지우기·결근은 근무하는 날이라, [근무변경]의 쉬는 줄이 그날 계획을 가리면 그날 정해 둔 근무 시간(없으면 직원 요일 칸·매장 시간)을 다시 적어요.
 *  - 대체로 바꾸면 [대체휴무]에 '사용' 1일, 대체를 다른 말로 바꾸면 그날 적힌 사용을 되돌려요.
 *  - 그날 출퇴근 기록이 있으면 예정 시간·지각을 다시 계산해요(지각 시간·지원 매장 이름은 기록대로 칸에 다시 붙어요).
 *  - 그 칸 메모에 'MM/DD HH:MM 사장님: 이전 → 새'를 덧붙여요(최근 5줄). 오늘이나 앞날이면 본인에게 텔레그램으로 소리 없이 알려요.
 *  - seen(화면에서 본 그 칸 글자)을 주면, 그사이 칸이 바뀌었을 때(직원이 휴무?를 고름, 밤 마감 등) 덮어쓰지 않고 새 표만 돌려줘요(stale).
 * 바뀐 근무표(adminGrid)에 done(결과 글)과 told(본인에게 알렸는지)를 붙여 돌려줘요.
 */
function adminSetMark(cred, ym, name, day, value, seen, why) {
  var set = adminAuth_(cred);
  ym = normYm_(ym);
  if (!ym) throw new Error('달을 골라주세요.');
  day = Number(day);
  if (!(day >= 1 && day <= daysIn_(ym) && Math.floor(day) === day)) throw new Error('날짜를 다시 골라주세요.');
  var date = ym + '-' + pad2_(day);
  name = String(name == null ? '' : name).trim();
  value = String(value == null ? '' : value).trim();
  if (value && GRID_MARKS.indexOf(value) < 0) throw new Error('고를 수 있는 말은 ' + GRID_MARKS.join('·') + '·지우기예요.');
  needOpen_(date);
  var now = nowKst_(), who = name + ' ' + whenOf_(date);
  var p = findStaff_(name);
  var old = '', fin = '', store = '', subMsg = '';
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var g = monthGrid_(ym, true);
    var r = g && !g.bad && name !== TEST_NAME && name !== '예시직원' ? g.rows[name] : null;
    if (!r) throw new Error(Number(ym.slice(5)) + '월 휴무표에 ' + (name || '그 사람') + ' 님 줄이 없어요. 새로고침 해 주세요.');
    if (!employedOn_(name, date)) {
      var hd = hrDates_()[name] || {};
      throw new Error(hd.start && date < hd.start ? who + '은 입사 전이에요(입사일 ' + hd.start + ').' : who + '은 퇴사한 뒤예요(마지막 근무일 ' + (hd.end || '') + ').');
    }
    store = String(r.vals[g.cols.store] || '').trim() || '(매장 없음)';
    old = String(r.vals[g.cols.day1 + day - 1] || '').trim();
    var stale = seen != null && String(seen).trim() !== old;
    if (!stale && old !== value && !value) {
      // 칸만 지우면 안 되는 칸: 휴직 기간(10분 검사가 다시 '휴직'을 적어요), 승인된 대타 날([근무변경]의 대타 시간이 그대로 남아요)
      if (old === AWAY_MARK && awayOn_(name, date)) throw new Error(who + "은 휴직 기간이라 칸을 지워도 10분 안에 다시 '휴직'이 적혀요. 휴직을 줄이거나 끝내려면 인사 카드에서 [휴직 끝내기]를 눌러 주세요.");
      var swapHours = ''; // 그날 [근무변경] 마지막 줄이 대타 승인 줄이면 그 시간
      changes_().forEach(function (c) { if (parseDate_(c[0]) === date && String(c[1]).trim() === name) swapHours = /님 대신 대타/.test(String(c[3] || '')) ? String(c[2]).trim() : ''; });
      if (/^대타/.test(old) && swapHours) throw new Error(who + '은 승인된 대타 날이에요(' + swapHours + ' 근무). 칸만 지우면 대타 시간이 그대로 남아요. 쉬게 하려면 휴무 같은 쉬는 말을 고르고, 대타를 없애려면 시트 [근무변경] 탭에서 그날 대타 줄을 지운 뒤 칸을 지워 주세요.');
    }
    if (!stale && old !== value) {
      if (value && value !== '결근') {
        setOff_(date, name, value, '사장님이 근무표에서 ' + markRo_(value) + ' 바꿈');
      } else {
        setMark_(date, name, function () { return value; });
        if (p && !schedFor_(p, date)) {
          var hours = null; // 그날 [근무변경]에 따로 정해 둔 근무 시간(마지막 것)
          changes_().forEach(function (c) { if (parseDate_(c[0]) === date && String(c[1]).trim() === name && parseSchedule_(String(c[2]))) hours = parseSchedule_(String(c[2])); });
          hours = hours || schedFor_(p, date, { changes: [] }); // 요일로 쉬는 날·휴직이면 null(근무로 안 바꿔요)
          if (hours) addChange_(date, name, fmtSched_(hours), '사장님이 근무표에서 ' + (value ? markRo_(value) + ' 바꿈' : '칸을 지움'));
        }
      }
      if (value === '대체') {
        addSub_(date, name, '사용', 1, '사장님이 근무표에서 대체로 바꿈');
        subMsg = '대체휴무 1일을 쓴 걸로 적었어요(남은 대체휴무 ' + fmtDays_(subBalance_(name).left) + '일).';
      } else if (old === '대체') {
        var used = 0;
        subRows_().forEach(function (x) { if (x.date === date && x.name === name && /사용/.test(x.kind)) used += x.days; });
        if (used > 0) {
          addSub_(date, name, '사용', -1, '사장님이 근무표에서 대체를 ' + (value ? markRo_(value) + ' 바꿈' : '지움'));
          subMsg = '쓴 대체휴무 1일을 되돌렸어요(남은 대체휴무 ' + fmtDays_(subBalance_(name).left) + '일).';
        }
      }
      if (date <= now.date) resyncLog_(set, date, name); // 앞날은 출퇴근 기록이 없어요
      var g2 = monthGrid_(ym), r2 = g2 && g2.rows[name];
      if (r2) {
        var cell = g2.sh.getRange(r2.row, g2.cols.day1 + day);
        var prev = String(cell.getNotes()[0][0] || '').trim();
        var line = mmdd_(now.date) + ' ' + now.time + ' 사장님: ' + (old || '빈칸') + ' → ' + (value || '지움');
        var hist = prev.split('\n').filter(function (l) { return l.trim() && !/^사유: /.test(l); }).concat([line]).slice(-5).join('\n');
        // 사유: 병가·기타 등을 고르면서 적은 것. 안 적었으면 같은 종류(직원이 고른 '병가?'를 확정 등)일 때만 전에 적힌 사유를 이어 써요
        var keep = WHY_KINDS.indexOf(value) >= 0 ? clean_(why, 40) || (old.replace(/\?$/, '') === value ? noteWhy_(prev) : '') : '';
        cell.setNote(noteWithWhy_(hist, keep));
        fin = String(r2.vals[g2.cols.day1 + day - 1] || '').trim();
      }
    }
  } finally {
    lock.releaseLock();
  }
  var res;
  if (stale || old === value) {
    res = adminGrid(cred, ym, store);
    res.done = stale ? who + " 칸이 그사이 '" + (old || '빈칸') + "'(으)로 바뀌어서 그대로 뒀어요. 확인하고 다시 골라 주세요."
      : who + '은 이미 ' + (value ? markRo_(value) + ' 적혀 있어요.' : '빈칸이에요.');
    res.told = false;
    res.stale = stale;
    return res;
  }
  var told = false, tell = date >= now.date;
  if (tell && p) {
    var after = schedFor_(p, date);
    told = notifyStaff_(set, p, '근무표가 바뀌었어요',
      (value ? whenOf_(date) + ' ' + markRo_(value) + ' 바뀌었어요.' : whenOf_(date) + " '" + old + "' 표시를 지웠어요." + (after ? ' 그날은 ' + fmtSched_(after) + ' 근무예요.' : '')) +
      '\n앱 [근무표 · 휴무]에서 볼 수 있어요.', { silent: true });
  }
  var done = value ? who + ' ' + markRo_(value) + ' 바꿨어요.' : who + ' 칸을 지웠어요.';
  if (fin && fin !== value) done += " 그날 출근 기록이 있어서 칸에는 '" + fin + "'(으)로 적혀 있어요.";
  if (subMsg) done += ' ' + subMsg;
  if (told) done += ' 본인에게 텔레그램으로 알렸어요.';
  else if (tell) done += p && p.tg ? ' 본인에게 텔레그램을 못 보냈어요. 따로 알려 주세요.' : ' 본인이 텔레그램 알림을 안 켜서 따로 알려 주세요.';
  res = adminGrid(cred, ym, store);
  res.done = done;
  res.told = told;
  res.stale = false;
  return res;
}

/** 말 + '로/으로'(휴무로, 무급으로, 결근으로). 받침이 있으면 '으로', ㄹ 받침과 받침 없으면 '로'. */
function markRo_(w) {
  w = String(w == null ? '' : w);
  var c = w.charCodeAt(w.length - 1) - 0xac00;
  return w + (c >= 0 && c < 11172 && c % 28 && c % 28 !== 8 ? '으로' : '로');
}

/* ───────────── 공휴일 ───────────── */

/** 날짜 → 공휴일 이름. 앱에 든 목록 + [설정] 공휴일추가 − 공휴일제외. */
function holidays_() {
  return memo_('hol', function () {
    var set = settings_();
    var out = {};
    Object.keys(HOLIDAYS).forEach(function (d) { out[d] = HOLIDAYS[d]; });
    String(set.holAdd || '').split(/[,\n;]+/).forEach(function (t) {
      var d = parseDate_(t);
      if (!d) return;
      out[d] = String(t).replace(/^\s*\d{4}\D+\d{1,2}\D+\d{1,2}\.?\s*/, '').trim() || '휴일';
    });
    String(set.holDel || '').split(/[,\n;]+/).forEach(function (t) {
      var d = parseDate_(t);
      if (d) delete out[d];
    });
    return out;
  });
}

function holidaysIn_(ym) {
  var all = holidays_(), out = {};
  Object.keys(all).forEach(function (d) { if (d.indexOf(ym) === 0) out[d] = all[d]; });
  return out;
}

/* ───────────── 다음 달 휴무 고르기 규칙 ───────────── */

/** 지금 다음 달 휴무를 고를 수 있는지. [설정] 휴무신청기간 '20-25'(매달 20~25일), 비우면 언제든. */
function wishOpen_(set, now, name) {
  var ym = nextYm_(now.ym);
  var props = PropertiesService.getScriptProperties();
  if (props.getProperty('wishOpen:' + now.date)) {
    return { open: true, ym: ym, text: '오늘만(사장님이 열어 둠)', msg: '', forced: true };
  }
  // 새로 들어온 사람: 승인한 날부터 3일 동안은 기간이 아니어도 고를 수 있어요
  var until = name ? props.getProperty('wishFor:' + name) : '';
  if (until && until >= now.date) {
    return { open: true, ym: ym, text: mmdd_(until) + '까지, 새로 오신 분', msg: '', forced: true };
  }
  var nums = String(set.wishWin || '').match(/\d{1,2}/g); // '20-25', '20일~25일', '20일부터 25일까지'
  if (!nums) return { open: true, ym: ym, text: '언제든', msg: '' };
  var from = Number(nums[0]), to = nums[1] ? Number(nums[1]) : daysIn_(now.ym);
  var day = Number(now.date.slice(8));
  var text = Number(now.ym.slice(5)) + '/' + from + '~' + Number(now.ym.slice(5)) + '/' + to;
  return {
    open: day >= from && day <= to, ym: ym, from: from, to: to, text: text,
    msg: Number(ym.slice(5)) + '월 휴무는 ' + text + '에만 고를 수 있어요.' + (day > to ? ' 고를 기간이 지났어요. 사장님께 말씀해주세요.' : ''),
  };
}

/** [설정] 휴무금지일: '12/24'(해마다) 또는 '2026-12-24'. */
function blockedDay_(set, date) {
  return String(set.wishBlock || '').split(/[,\n;\s]+/).some(function (t) {
    t = t.trim();
    if (!t) return false;
    var full = /^\d{4}\D/.test(t) ? parseDate_(t) : '';
    if (full) return full === date;
    var m = /^(\d{1,2})\D(\d{1,2})$/.exec(t);
    return !!m && Number(m[1]) === Number(date.slice(5, 7)) && Number(m[2]) === Number(date.slice(8));
  });
}

function blockedList_(set, ym) {
  var out = [];
  for (var d = 1; d <= daysIn_(ym); d++) if (blockedDay_(set, ym + '-' + pad2_(d))) out.push(d);
  return out;
}

/**
 * 그날 그 매장에서 하루 종일 쉬는 사람(except 빼고): 휴무표에 쉬는 말(반차 빼고, '휴무?' 포함)이 있거나,
 * 휴무표 칸이 비어 있고 [직원] 그 요일 칸이 쉬는 날인 사람.
 */
function offNames_(store, date, except) {
  var out = [];
  staff_().forEach(function (q) {
    if (!q.active || q.store !== store || q.name === except) return;
    var m = dayMark_(q.name, date);
    var w = String(q.week[dowOf_(date)] || '').trim();
    var off = m ? OFF_RE.test(m) && !/반차/.test(m) : !!w && OFF_RE.test(w);
    if (off) out.push(q.name);
  });
  return out;
}

/** 그 달 휴무표에서 '휴무'(고른 '휴무?' 포함)가 적힌 날 수. */
function monthOffCount_(name, ym) {
  var g = monthGrid_(ym);
  var r = g && g.rows[name];
  var n = 0;
  if (!r) return 0;
  for (var d = 1; d <= daysIn_(ym); d++) if (/휴무/.test(String(r.vals[g.cols.day1 + d - 1] || ''))) n++;
  return n;
}

/* ───────────── 매장이 비는 날 미리 알리기 ([매장] 최소인원) ───────────── */

/** 그 매장에 그날 있어야 하는 사람 수: [매장] 최소인원. 비우면 1(아무도 없을 때만 알려요), 0이면 안 알려요. */
function needStaff_(st) { return st && st.minStaff != null ? st.minStaff : 1; }

/**
 * 그 사람이 그날 어디서 일하는지: {at: 매장 이름('' = 안 나와요), why: 안 나오는 까닭, plain: 정기 휴무(요일 칸)라서}
 * 재직 중이 아니거나 그날 다니는 사람이 아니면(입사 전·퇴사 뒤), 테스트·예시 직원이면 null.
 *  - 휴무표 그날 칸에 다른 매장 이름이 있으면('가산', '대타 가산') 그 매장에서 일해요(지원)
 *  - 칸이 쉬는 말(휴무·월차·반차 등)이면 안 나와요. 외근·교육 날도 매장 밖이라 안 세요
 *  - 그 밖에는 근무 시간이 있으면(schedFor_) 자기 매장
 */
function workAt_(p, date, ctx) {
  if (!p || !p.active || hrExempt_(p.name) || !employedOn_(p.name, date)) return null;
  var mv = hrPlan_().move[p.name];
  // 예약한 지점 이동 뒤 날짜는 새 지점(내일부터. 오늘 것은 새벽에 옮겨요. [매장]에 없는 지점이면 못 옮기니 지금 지점)
  var home = mv && mv.store && mv.date && date >= mv.date && date > nowKst_().date && storeOf_(mv.store) ? mv.store : p.store;
  var w = workAt0_(p, date, ctx || {}, home);
  w.home = home;
  return w;
}
function workAt0_(p, date, ctx, home) {
  if (awayOn_(p.name, date)) return { at: '', why: '휴직' };
  var mk = dayMark_(p.name, date);
  var sup = supportOf_(mk, storeNames_());
  if (sup && sup !== home) return { at: sup, why: '' };
  if (mk && OFF_RE.test(mk)) return { at: '', why: OFF_KINDS.indexOf(mk) >= 0 ? KIND_NAME[mk] : clean_(mk, 10) };
  if (/^외근/.test(mk)) return { at: '', why: '외근' };
  if (schedFor_(p, date, ctx)) return { at: home, why: '' };
  var chg = null;
  (ctx.changes || changes_()).forEach(function (c) { if (parseDate_(c[0]) === date && String(c[1]).trim() === p.name) chg = String(c[2] == null ? '' : c[2]).trim(); });
  if (chg !== null) return { at: '', why: clean_(chg, 10) || '쉼' }; // [근무변경]에 쉬는 날로 적힘
  var w = String((p.week && p.week[dowOf_(date)]) || '').trim();
  return { at: '', why: w && OFF_RE.test(w) ? clean_(w, 10) : '쉬는 날', plain: true }; // 요일 칸이 쉬는 날이거나 근무 시간이 없어요
}

/** 그날 다니는 직원마다 workAt_ 한 번씩(매장마다 나눠 써요). [{p, at, why, plain}] */
function crewOn_(date, ctx) {
  var out = [], seen = {};
  staff_().forEach(function (p) {
    if (!p.active || seen[p.name]) return;
    var w = workAt_(p, date, ctx);
    if (!w) return;
    seen[p.name] = true;
    w.p = p;
    out.push(w);
  });
  return out;
}

/**
 * 그날 그 매장에서 일하는 사람 수: 자기 매장 직원 중 일하는 사람 + 다른 매장에서 지원 오는 사람 − 다른 매장에 지원 가는 사람.
 * opts.except: 이 사람은 쉬는 걸로 셈(승인하면 몇 명이 남는지). opts.why: 그 사람이 쉬는 까닭(목록에 보일 말)
 * 돌려줘요: {store, date, count, need, min, below(need보다 적음), work:[이름], off:[{name, why, plain}], closed(쉬는 날로 보임)}
 */
function staffOn_(store, date, opts) {
  opts = opts || {};
  var ctx = opts.ctx || { changes: changes_(), stores: stores_() };
  var crew = opts.crew || crewOn_(date, ctx);
  var st = null;
  (ctx.stores || stores_()).forEach(function (x) { if (x.name === store) st = x; });
  var c = { store: store, date: date, count: 0, need: needStaff_(st), min: st ? st.minStaff : null, work: [], off: [] };
  crew.forEach(function (w) {
    var mine = (w.home || w.p.store) === store;
    if (opts.except && w.p.name === opts.except) {
      if (mine || w.at === store) c.off.push({ name: w.p.name, why: opts.why || '쉼' });
      return;
    }
    if (w.at === store) { c.count++; c.work.push(w.p.name); }
    else if (mine) c.off.push({ name: w.p.name, why: w.at ? w.at + ' 지원' : w.why, plain: !!w.plain });
  });
  c.below = c.count < c.need;
  // 아무도 안 나오는데 모두 정기 휴무(사무실 주말 등)이거나 직원이 없거나 공휴일이면 매장이 쉬는 날로 봐요(밤 알림을 안 보내요)
  c.closed = !c.count && (!!holidays_()[date] || c.off.every(function (x) { return x.plain; }));
  return c;
}

/** '왕십리 1명 근무(최소 2명)'. 최소인원을 비웠으면 '(최소 …)'는 빼요. */
function thinText_(c) { return c.store + ' ' + c.count + '명 근무' + (c.min ? '(최소 ' + c.min + '명)' : ''); }

/** 밤 마감 정리에 넣을 줄: 그날(보통 내일) 사람이 모자란 매장마다 '내일 왕십리 1명 근무(최소 2명) · 김민우 휴무, 박점장 월차'. */
function thinLines_(date, ctx) {
  ctx = ctx || { changes: changes_(), stores: stores_() };
  var now = nowKst_();
  var label = date === now.date ? '오늘' : date === addDays_(now.date, 1) ? '내일' : whenOf_(date);
  var crew = crewOn_(date, ctx), out = [];
  (ctx.stores || stores_()).forEach(function (st) {
    var c = staffOn_(st.name, date, { ctx: ctx, crew: crew });
    if (!c.below || c.closed) return;
    out.push(label + ' ' + thinText_(c) + (c.off.length ? ' · ' + c.off.map(function (x) { return x.name + ' ' + x.why; }).join(', ') : ''));
  });
  return out;
}

/**
 * 승인 카드에 보일 '승인하면 그날 왕십리 1명 근무(최소 2명)'. 해당 없으면 null.
 *  - 쉬는 요청(휴무·월차·반차·대체·무급·휴가·병가·경조·예비군·휴무 바꾸기)과 외근: 요청한 사람이 빠진 그 매장
 *  - 다른 매장 동료가 맡은 대타: 그날 원래 자기 매장 근무가 있으면, 대타가 빠지는 그 사람 매장
 * 점장에게는 자기 매장 것만 보여줘요. 지난 날짜는 안 세요. crews: 날짜 → crewOn_ 결과(한 화면 안에서 다시 안 세게)
 * {store, count, need, min, below, line, more(같은 날 같은 매장의 다른 쉬는 요청 수), text}
 */
function thinOnCard_(r, a, crews) {
  var off = OFF_KINDS.indexOf(r.kind) >= 0 || r.kind === '바꾸기' || r.kind === '외근';
  if ((!off && !(r.kind === '대타' && r.taker)) || !r.date || r.date < nowKst_().date) return null;
  var p = findStaff_(off ? r.name : r.taker);
  if (!p || !p.active || (!off && !swapAway_(findStaff_(r.name), p))) return null; // 같은 매장 대타는 인원이 그대로예요
  var ctx = { changes: changes_(), stores: stores_() };
  var crew = (crews && crews[r.date]) || crewOn_(r.date, ctx), me = null;
  if (crews) crews[r.date] = crew;
  crew.forEach(function (w) { if (w.p.name === p.name) me = w; });
  if (!off && !(me && me.at === (me.home || p.store))) return null; // 대타가 그날 자기 매장 근무가 없으면 그 매장 인원은 그대로
  var store = me && me.at ? me.at : p.store; // 그날 다른 매장에 지원 가는 날이면 그 매장
  if (!storeOf_(store) || (a && a.role !== 'admin' && (a.stores || []).indexOf(store) < 0)) return null;
  var c = staffOn_(store, r.date, { ctx: ctx, crew: crew, except: p.name, why: off ? KIND_NAME[r.kind] || r.kind : '대타' });
  var more = 0;
  if (off) {
    readReqs_().forEach(function (q) {
      if (q.id === r.id || q.name === p.name || q.date !== r.date || (q.state !== '대기' && q.state !== '수락')) return;
      if ((OFF_KINDS.indexOf(q.kind) >= 0 || q.kind === '바꾸기' || q.kind === '외근') && c.work.indexOf(q.name) >= 0) more++;
    });
  }
  return {
    store: store, count: c.count, need: c.need, min: c.min, below: c.below, line: thinText_(c), more: more,
    text: '승인하면 그날 ' + thinText_(c) + (r.kind === '반차' ? ' · 반차는 빼고 셌어요' : '') + (more ? ' · 같은 날 쉬겠다는 요청 ' + more + '건 더 있어요' : ''),
  };
}

/** 대타를 다른 매장 동료가 맡으면 요청한 사람의 매장 이름(그 매장에서 일해요), 같은 매장이면 ''. */
function swapAway_(asker, taker) {
  return asker && taker && asker.store && taker.store && asker.store !== taker.store ? asker.store : '';
}

/** 다른 매장 동료가 맡은 대타인데 그날 자기 매장 근무가 있을 때 승인하는 사람에게 보여줄 말. */
function takerNote_(asker, b, s) {
  return b.name + ' 님은 그날 원래 ' + b.store + ' ' + fmtSched_(s) + ' 근무예요. 승인하면 ' + b.store + ' 근무는 빠지고 ' + swapAway_(asker, b) + '에서 일해요';
}

/**
 * 직원 화면 대타 구함 목록 한 줄: 보는 사람이 다른 매장이고 그날 자기 매장 근무가 있으면 clash = {store, hours}.
 * 화면이 [제가 할게요]를 누를 때 '그날 가산 근무가 있어요. 대타를 하면 가산 근무가 빠져요'를 한 번 더 물어봐요.
 */
function swapView_(v, viewer) {
  var me = findStaff_(viewer);
  if (!me || !me.store || !v.store) return v;
  var w = workAt_(me, v.date, {});
  var home = (w && w.home) || me.store; // 그날의 내 지점(지점 이동을 예약해 뒀으면 그날부터 새 지점)
  if (home === v.store) return v;
  var s = w && w.at === home ? schedFor_(me, v.date) : null;
  if (s) v.clash = { store: home, hours: fmtSched_(s) };
  return v;
}

/**
 * 대타를 아직 아무도 안 받았으면 근무 전날 18시부터 한 번 알려요: 요청한 사람, 그 매장 점장, 사장님.
 * 밤(23시~7시)에는 기다렸다가 아침에 보내요. 방금 올린 요청은 1시간 뒤에, 그날 근무가 이미 시작됐으면 안 보내요
 * (못 구하고 안 나오면 밤 마감이 '결근?'으로 적어요). 보낸 요청 수를 돌려줘요.
 */
function swapNobody_(set, now) {
  if (now.min < 7 * 60 || now.min >= 23 * 60) return 0;
  var props = PropertiesService.getScriptProperties();
  var tomorrow = addDays_(now.date, 1), due = [];
  readReqs_().forEach(function (r) {
    if (r.kind !== '대타' || r.state !== '대기' || r.taker) return;
    if (r.date !== now.date && !(r.date === tomorrow && now.min >= 18 * 60)) return;
    var s = parseSchedule_(r.what);
    if (r.date === now.date && s && now.min >= s.start) return;
    var at = Date.parse(String(r.at || '').replace(' ', 'T') + ':00+09:00');
    if (at && Date.now() - at < 3600e3) return; // 방금 올린 요청: 동료들이 볼 시간을 줘요
    var key = 'dm:' + r.date + ':swap:' + r.id; // 날짜가 지나고 3일 뒤 저절로 지워져요
    if (props.getProperty(key)) return;
    props.setProperty(key, '1');
    due.push(r);
  });
  var lines = [];
  due.forEach(function (r) {
    var p = findStaff_(r.name) || { name: r.name, store: '' };
    var day = (r.date === now.date ? '오늘' : '내일') + '(' + mmdd_(r.date) + ')';
    var line = day + ' ' + r.name + ' 대타를 아직 아무도 안 받았어요';
    var where = (p.store ? p.store + ' ' : '') + r.what + ' 근무예요.';
    lines.push(line + '\n  ' + where);
    var asked = offAsked_(r.name, r.date); // [오늘 못 나가요]처럼 그날 쉬겠다는 요청도 보냈으면 '원래대로 출근' 안내는 빼요
    notifyStaff_(set, p, '대타를 아직 못 구했어요', day + ' ' + r.what + ' 대타를 아직 아무도 안 받았어요.\n' +
      (asked ? '' : '못 구하면 그날은 원래대로 출근해야 해요' + (started_(set, r.date) ? '(안 나오면 휴무표에 결근?으로 적혀요)' : '') + '. ') + '점장님이나 동료에게 직접 부탁해 보세요.');
    if (p.store) managersOf_(p.store, p.name).forEach(function (n) {
      notifyStaff_(set, findStaff_(n), '[' + p.store + '] 대타를 아직 못 구했어요', line + '\n' + where + ' 대신 일할 사람을 같이 찾아 주세요.');
    });
  });
  if (lines.length) notify_(set, '대타를 아직 못 구했어요' + (lines.length > 1 ? ' ' + lines.length + '건' : ''), lines.join('\n') + '\n대신 일할 동료가 직원 화면에서 [제가 할게요]를 누르면 돼요.');
  return due.length;
}

/* ───────────── 직원 근무표 ───────────── */

/**
 * 동료 근무표에 보일 말. 쉬는 날은 종류(월차·병가·출산휴가·휴직 등)를 가리고 '쉼'으로만 보여줘요.
 * 결근·무단·지각 시간은 안 보여요(징계·건강 같은 사정이 같은 매장 직원에게 퍼지지 않게).
 */
function mateMark_(m) {
  m = String(m || '').trim();
  if (!m) return '';
  if (/^대타/.test(m)) return '대타';
  if (ABSENT_RE.test(m) || !OFF_RE.test(m)) return '';
  if (/반차/.test(m)) return '반차';
  if (WISH_RE.test(m)) return '휴무?'; // 다음 달 휴무 고르기에서 겹치지 않게 보여줘요(확정 전. 월차·병가 같은 종류는 가려요)
  return '쉼';
}

/** 직원 화면 근무표 한 달치(getSchedule·wishDay가 돌려줘요). */
function schedule_(p, ym, now) {
  var set = settings_();
  var g = monthGrid_(ym);
  var n = daysIn_(ym);
  var st = storeOf_(p.store);
  var cells = function (q) {
    var r = g && g.rows[q.name], out = [];
    for (var d = 1; d <= n; d++) {
      var m = r ? String(r.vals[g.cols.day1 + d - 1] || '').trim() : '';
      // 휴무표가 비어 있으면 [직원] 요일 칸의 정기 휴무(사무실 등)
      if (!m && OFF_RE.test(String(q.week[dowOf_(ym + '-' + pad2_(d))] || ''))) m = '쉼';
      out.push(m);
    }
    return out;
  };
  var mineRaw = cells(p);
  var me = mineRaw.map(function (m) {
    if (/^\d{1,2}:\d{2}$/.test(m)) return '지각';
    if (/^대타/.test(m)) return '대타';
    return m;
  });
  // 그달에 퇴사한 동료도 그달 근무표에 보여요(퇴사 다음 날부터는 빈칸). [인사]는 그런 사람이 있을 때만 읽어요
  var hd4 = null;
  var ended = function (nm) { if (!hd4) hd4 = hrDates_(); var d = hd4[nm]; return d && d.end && d.end.slice(0, 7) >= ym ? d.end : ''; };
  var mates = staff_().filter(function (q) {
    if (q.store !== p.store || q.name === p.name) return false;
    if (q.active) return true;
    return !!(g && g.rows[q.name]) && findStaff_(q.name) === q && !!ended(q.name);
  });
  if (g) Object.keys(g.rows).forEach(function (nm) { // [직원] 줄을 지운 그달 퇴사자(휴무표 줄의 매장으로)
    if (nm === p.name || nm === TEST_NAME || nm === '예시직원' || findStaff_(nm)) return;
    if (String(g.rows[nm].vals[g.cols.store] || '').trim() === p.store && ended(nm)) mates.push({ name: nm, active: false, week: [] });
  });
  var others = mates.map(function (q) {
    var end = q.active ? '' : ended(q.name);
    return {
      name: q.name,
      days: cells(q).map(function (m, i) { return end && ym + '-' + pad2_(i + 1) > end ? '' : mateMark_(m); }), // 동료에게는 '쉼'·'반차'·'대타'·'휴무?'만(병가·무단·휴직 같은 사정은 본인과 사장님만)
    };
  });
  var count = [];
  for (var d = 0; d < n; d++) {
    var c = 0;
    [me].concat(others.map(function (o) { return o.days; })).forEach(function (days) {
      if (days[d] && OFF_RE.test(days[d]) && !/반차/.test(days[d])) c++;
    });
    count.push(c);
  }
  var offDays = 0, used = 0, wishes = 0, mwishes = 0, ewishes = 0;
  mineRaw.forEach(function (m) {
    if (/휴무|휴가/.test(m)) offDays++;
    else if (/반차/.test(m)) offDays += 0.5;
    if (/월차/.test(m)) used++;
    if (m === '휴무?') wishes++;
    else if (m === '월차?') mwishes++;
    else if (WISH_RE.test(m)) ewishes++;
  });
  var mineRow = g && g.rows[p.name];
  // 내 칸의 사유(병가·기타 등, 칸 메모 '사유: …'). 그런 칸이 있을 때만 메모를 읽어요. 본인만 봐요
  var why = mineRaw.map(function () { return ''; });
  if (mineRow && mineRaw.some(function (m) { return WHY_KINDS.indexOf(m.replace(/\?$/, '')) >= 0; })) {
    g.sh.getRange(mineRow.row, g.cols.day1 + 1, 1, n).getNotes()[0].forEach(function (nt, i) {
      if (WHY_KINDS.indexOf(mineRaw[i].replace(/\?$/, '')) >= 0) why[i] = noteWhy_(nt);
    });
  }
  var left = mineRow ? String(mineRow.vals[g.cols.left] || '').trim() : '';
  var full = mineRow && g.cols.full >= 0 ? String(mineRow.vals[g.cols.full] || '').trim() : '';
  var grant = mineRow ? String(mineRow.vals[g.cols.grant] || '').trim() : '';
  var sub = subBalance_(p.name);
  var w = wishOpen_(set, now, p.name);
  return {
    ym: ym, today: now.date, store: p.store, days: n, firstDow: dowOf_(ym + '-01'), hasTab: !!g,
    holidays: holidaysIn_(ym), me: me, why: why, others: others, count: count,
    sum: {
      off: offDays, monthly: used, monthlyLeft: /^-?\d+(\.\d+)?$/.test(left) ? Number(left) : null, wishes: wishes, mwishes: mwishes, ewishes: ewishes,
      full: /^(만근|아님)/.test(full) ? full : '', grant: /^-?\d+(\.\d+)?$/.test(grant) ? Number(grant) : null,
      sub: sub.left, subPending: sub.pending,
    },
    wish: ym === w.ym ? {
      open: w.open, text: w.text, msg: w.msg, maxOff: st ? st.maxOff : 1, monthOff: st ? st.monthOff : 0,
      blocked: blockedList_(set, ym),
    } : null,
  };
}

/* ───────────── 대체휴무 장부 ───────────── */

function subRows_() {
  return memo_('sub', function () {
    var sh = book_().getSheetByName(SHEETS.sub);
    if (!sh || sh.getLastRow() < 2) return [];
    return sh.getRange(2, 1, sh.getLastRow() - 1, SUB_HEAD.length).getDisplayValues().map(function (v) {
      return { date: parseDate_(v[0]), name: String(v[1]).trim(), kind: String(v[2]).trim(), days: toNum_(v[3]) };
    }).filter(function (r) { return r.name; });
  });
}

/** 대체휴무: 적립 − 사용 = 남은 일수(left), 아직 승인 전인 대체휴무 신청(pending). */
function subBalance_(name) {
  var got = 0, used = 0;
  subRows_().forEach(function (r) {
    if (r.name !== name) return;
    if (/적립/.test(r.kind)) got += r.days;
    else if (/사용/.test(r.kind)) used += r.days;
  });
  var pending = readReqs_().filter(function (q) {
    return q.name === name && q.kind === '대체' && (q.state === '대기' || q.state === '수락');
  }).length;
  return { got: got, used: used, left: Math.round((got - used) * 10) / 10, pending: pending };
}

/** 이름 → 남은 대체휴무 (사장님 화면 직원 관리). */
function subTotals_() {
  var out = {};
  subRows_().forEach(function (r) {
    var k = /적립/.test(r.kind) ? 1 : /사용/.test(r.kind) ? -1 : 0;
    out[r.name] = Math.round(((out[r.name] || 0) + k * r.days) * 10) / 10;
  });
  return out;
}

function addSub_(date, name, kind, days, why) {
  var sh = book_().getSheetByName(SHEETS.sub) || ensureSheet_(book_(), SHEETS.sub, SUB_HEAD, [], SUB_FMT);
  var now = nowKst_();
  sh.appendRow([date, name, kind, days, why, now.date + ' ' + now.time]);
  forget_('sub');
}

/** 그날 출근이 찍힌 매장(찍은 매장, 없으면 소속 매장) → true. */
function openedStores_(logs) {
  var out = {};
  logs.forEach(function (r) {
    if (!r.tIn) return;
    var q = findStaff_(r.name);
    out[r.place || (q ? q.store : '')] = true;
    if (q) out[q.store] = true;
  });
  return out;
}

function subCredited_(date, name) {
  return subRows_().some(function (r) { return r.date === date && r.name === name && /적립/.test(r.kind); });
}

/** 그날 그 사람 적립이 아직 없을 때만 적어요(마감 정리가 두 번 돌아도 한 번만). 적었으면 true. */
function addSubOnce_(date, name, days, why) {
  if (subCredited_(date, name)) return false;
  addSub_(date, name, '적립', days, why);
  return true;
}

function fmtDays_(n) { return String(Math.round(n * 10) / 10); }

function addDays_(date, n) {
  var p = date.split('-').map(Number);
  var d = new Date(Date.UTC(p[0], p[1] - 1, p[2] + n));
  return d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
}

/* ───────────── 시간·날짜·거리 계산 (순수 함수) ───────────── */

function pad2_(n) { return (n < 10 ? '0' : '') + n; }

/** 한국 시간 기준 지금. */
function nowKst_() {
  var d = new Date(Date.now() + 9 * 3600 * 1000);
  var date = d.getUTCFullYear() + '-' + pad2_(d.getUTCMonth() + 1) + '-' + pad2_(d.getUTCDate());
  var min = d.getUTCHours() * 60 + d.getUTCMinutes();
  return { date: date, min: min, time: fmtTime_(min), ym: date.slice(0, 7), dow: d.getUTCDay() };
}

/** '10:05', '10시 5분', '오후 6:30:00', '6:30 PM' → 분. 못 읽으면 null. */
function parseTime_(v) {
  // 시트에 숫자로 들어간 시간(하루의 몇 분의 몇, 예: 0.4166… = 10:00)
  if (typeof v === 'number' && v >= 0 && v < 1) return Math.round(v * 1440);
  var s = String(v == null ? '' : v).trim();
  if (!s) return null;
  if (/^0?\.\d{3,}$/.test(s)) return Math.round(Number(s) * 1440);
  var hm = /^(\d{1,2})(\d{2})$/.exec(s); // '1030' → 10:30, '930' → 9:30
  if (hm) return Number(hm[1]) <= 24 && Number(hm[2]) <= 59 ? Number(hm[1]) * 60 + Number(hm[2]) : null;
  var m = s.match(/(\d{1,2})(?:\s*([:시.])\s*(\d{1,2}))?/); // '10:30', '10시 30분', '10.30'
  if (!m) return null;
  var h = Number(m[1]);
  var mi = Number(m[3] || 0);
  if (m[2] === '.' && m[3] && m[3].length === 1) mi *= 10; // 숫자 칸에 10.30을 적으면 10.3으로 보여요 → 10:30
  if (/오후|pm/i.test(s) && h < 12) h += 12;
  if (/오전|am/i.test(s) && h === 12) h = 0;
  if (h > 24 || mi > 59) return null;
  return h * 60 + mi;
}

function fmtTime_(min) {
  if (min == null || min === '') return '';
  return pad2_(Math.floor(min / 60) % 24) + ':' + pad2_(min % 60);
}

/** '10:00-20:00', '10:00~20:00', '10-20', '11:00'(퇴근 미정) → {start, end|null}. 빈칸·휴무·휴가 → null. */
function parseSchedule_(v) {
  var s = String(v == null ? '' : v).trim();
  if (!s || OFF_RE.test(s) || /off/i.test(s)) return null;
  var parts = s.split(/\s*[-~–—]\s*/);
  var a = parseTime_(parts[0]);
  if (a == null || parts.length > 2) return null;
  var b = parts.length === 2 && parts[1] !== '' ? parseTime_(parts[1]) : null;
  if (parts.length === 2 && parts[1] !== '' && b == null) return null;
  return { start: a, end: b };
}

/** '2026-11-18', '2026. 11. 18', '2026/11/18' → '2026-11-18'. */
function parseDate_(v) {
  var m = String(v == null ? '' : v).match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
  if (!m) return '';
  var y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  // 없는 날짜(12/32, 2/30 등)는 날짜로 안 봐요
  if (mo < 1 || mo > 12 || d < 1 || d > new Date(Date.UTC(y, mo, 0)).getUTCDate()) return '';
  return m[1] + '-' + pad2_(mo) + '-' + pad2_(d);
}

function dowOf_(date) {
  var p = date.split('-').map(Number);
  return new Date(Date.UTC(p[0], p[1] - 1, p[2])).getUTCDay();
}

function validYm_(ym) {
  return /^\d{4}-\d{2}$/.test(String(ym || '')) ? String(ym) : '';
}

/** '2026-12', '2026.12', '2026/12', '202612' → '2026-12'. 못 읽으면 ''. */
function normYm_(v) {
  var m = /^\s*(\d{4})\s*[-.\/년]?\s*(\d{1,2})\s*월?\s*$/.exec(String(v == null ? '' : v));
  if (!m || Number(m[2]) < 1 || Number(m[2]) > 12) return '';
  return m[1] + '-' + pad2_(Number(m[2]));
}

/** a 달에서 b 달까지 몇 달인지(b가 앞이면 음수). */
function monthsBetween_(a, b) {
  return (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 + Number(b.slice(5, 7)) - Number(a.slice(5, 7));
}

function prevYm_(ym) {
  var y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) - 1;
  if (m === 0) { y--; m = 12; }
  return y + '-' + pad2_(m);
}

function toNum_(v) {
  if (typeof v === 'number') return v;
  var s = String(v == null ? '' : v).trim();
  if (!s) return 0;
  var n = Number(s.replace(/[^\d.\-]/g, ''));
  return isNaN(n) ? 0 : n;
}

function hm_(min) {
  min = Math.round(min || 0);
  var h = Math.floor(min / 60), m = min % 60;
  return h ? h + '시간' + (m ? ' ' + m + '분' : '') : m + '분';
}

function addMemo_(memo, text) {
  memo = String(memo || '');
  if (memo.indexOf(text) >= 0) return memo;
  return memo ? memo + ', ' + text : text;
}

function distance_(lat1, lng1, lat2, lng2) {
  var R = 6371000, rad = Math.PI / 180;
  var dLat = (lat2 - lat1) * rad, dLng = (lng2 - lng1) * rad;
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return Math.round(2 * R * Math.asin(Math.sqrt(a)));
}

function fmtDist_(m) {
  return m >= 1000 ? (m / 1000).toFixed(1) + 'km' : m + 'm';
}
