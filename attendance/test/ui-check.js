// 화면 확인용: 진짜 브라우저(아이폰 크기)에서 직원 화면·사장님 화면을 눌러보고 캡처해요.
// 서버 쪽은 gas-mock 으로 Code.gs 를 그대로 돌려요.
// 실행: node attendance/test/ui-check.js [캡처 저장 폴더]
const path = require('path');
const fs = require('fs');
const assert = require('node:assert/strict');
const { chromium, devices } = require('playwright');
const { createGas } = require('./gas-mock');
const { oldBlock } = require('./old-sample');

const OUT = process.argv[2] || path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });
const STORE = { latitude: 37.5665, longitude: 126.978 };
// 1×1 PNG(증빙 사진 올리기 확인용)
const PNG1 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';
const PHONE = { 김민우: 'a1a1a1a1a1a1a1a1', 이지은: 'b2b2b2b2b2b2b2b2', 박준호: 'c3c3c3c3c3c3c3c3', 최유나: 'd4d4d4d4d4d4d4d4', 신입: 'e5e5e5e5e5e5e5e5' };

function seed() {
  const g = createGas({ now: Date.parse('2026-11-18T09:00:00+09:00') }); // 수요일
  g.gs.setup();
  g.sheet('매장').getRange(2, 1, 3, 7).setValues([
    ['왕십리', '10:00', '20:00', '', '', '', ''],
    ['가산', '12:00', '21:00', '', '', '', ''],
    ['사무실', '', '', '', '', '', ''],
  ]);
  //   이름 매장 PIN 시급 월 화 수 목 금 토 일 재직 등록폰 새폰요청
  const W = (t) => [t, t, t, t, t];
  g.sheet('직원').getRange(2, 1, 5, 14).setValues([
    ['김민우', '왕십리', '0123', 12000, ...W(''), '휴무', '휴무', '', '', ''],
    ['박준호', '왕십리', '432198', 10320, ...W('10:00-19:00'), '', '', '', '', ''],
    ['이지은', '가산', '5678', 10320, '', '', '', '휴무', '', '', '휴무', '', '', ''], // 목·일 휴무
    ['신입', '가산', '', 10320, '', '', '', '', '', '', '', '', '', ''],
    ['최유나', '사무실', '5555', 10320, ...W('휴무'), '11:00-20:00', '11:00-20:00', '', '', ''],
  ]);
  g.sheet('매장').getRange(2, 8).setValue('박준호'); // 왕십리 점장
  g.gs.setSetting_('관리자PIN', '582941');
  g.gs.setSetting_('앱시작일', '2026-11-01');
  g.gs.setSetting_('알림이메일', 'owner@example.com');
  g.gs.adminSetPlace('582941', '왕십리', STORE.latitude, STORE.longitude);
  g.gs.adminSetPlace('582941', '사무실', STORE.latitude, STORE.longitude + 0.0005);
  g.gs.adminSetPlace('582941', '가산', 37.58, 126.978);
  let seq = 0;
  for (const n of ['김민우', '박준호', '이지은', '최유나']) {
    g.gs.MEMO_ = {};
    if (!g.gs.hrFind_(n)) g.gs.syncHr_();
    const h = g.gs.hrFind_(n);
    seq++;
    const rrn = '8001' + String(10 + seq).padStart(2, '0') + '1' + String(100000 + seq).slice(-6);
    g.gs.hrWrite_(h.row, { rrn: g.gs.rrnMask_(rrn), enc: g.gs.rrnEncrypt_(rrn), phone: '010-1000-' + (1000 + seq), addr: '서울 성동구', bank: '국민',
      account: '123456-78-' + (900000 + seq), emergency: '010-9999-8888 가족', start: '2020-01-01' });
  }
  g.gs.MEMO_ = {};
  const near = { lat: 37.5666, lng: 126.978, acc: 15 };
  const at = { 이지은: { lat: 37.58, lng: 126.978, acc: 15 } }; // 이지은은 자기 매장(가산)에서 찍어요
  const p = (when, name, pin, type) => {
    g.setKst(when);
    g.gs.punch({ name, pin, type, ...(at[name] || near), device: PHONE[name], label: 'iPhone 사파리(홈화면)', agree: true });
  };
  // 이번 달 기록 조금
  p('2026-11-16 09:57', '김민우', '0123', 'in'); p('2026-11-16 20:02', '김민우', '0123', 'out');
  p('2026-11-17 10:12', '김민우', '0123', 'in'); p('2026-11-17 20:00', '김민우', '0123', 'out');
  p('2026-11-16 12:00', '이지은', '5678', 'in'); p('2026-11-16 21:00', '이지은', '5678', 'out');
  p('2026-11-17 11:58', '이지은', '5678', 'in'); p('2026-11-17 20:30', '이지은', '5678', 'out');
  p('2026-11-16 09:59', '박준호', '432198', 'in'); p('2026-11-16 19:00', '박준호', '432198', 'out');
  p('2026-11-17 10:05', '박준호', '432198', 'in');
  p('2026-11-18 10:04', '박준호', '432198', 'in');
  p('2026-11-14 11:00', '최유나', '5555', 'in'); p('2026-11-14 20:00', '최유나', '5555', 'out');
  g.setKst('2026-11-18 10:07');
  g.gs.checkMissing(); // 10분 자동 실행이 한 번 돈 것처럼(사장님 화면의 '자동 실행이 멈췄어요' 띠가 안 뜨게)
  return g;
}

const BRIDGE = () => {
  function make(ok, no) {
    return new Proxy({}, {
      get(_, prop) {
        if (prop === 'withSuccessHandler') return (f) => make(f, no);
        if (prop === 'withFailureHandler') return (f) => make(ok, f);
        return (...args) => {
          // 새로고침 직후엔 __gas 연결이 늦게 붙을 수 있어서 기다려요 (진짜 구글에선 google.script.run 이 항상 있어요)
          const ready = new Promise((res) => { const t = () => (typeof window.__gas === 'function' ? res() : setTimeout(t, 10)); t(); });
          // 느린 서버 흉내: localStorage '__slow:함수이름'(ms)만큼 더 기다려요(먼저 보여 주기 확인용)
          const slow = Number(localStorage.getItem('__slow:' + prop) || 0);
          ready.then(() => window.__gas(prop, args)).then((r) => setTimeout(() => {
            // 진짜 구글(V8)처럼 오류 글 앞에 'Error: '를 붙여서 줘요(화면이 떼는지 확인)
            if (r.err) { if (no) no(new Error('Error: ' + r.err)); } else if (ok) ok(r.ok);
          }, 120 + slow));
        };
      },
    });
  }
  // 주소 끝에 붙은 값(?join=지점&code=1234)을 읽는 것도 흉내 내요
  const url = { getLocation: (cb) => cb({ parameter: Object.fromEntries(new URLSearchParams(location.search)) }) };
  window.google = { script: { run: make(null, null), url } };
};

// 화면 파일은 작은 로컬 웹서버로 열어요. file:// 로 열면 크롬이 새로고침 때 저장값(localStorage)을
// 가끔(약 8%) 통째로 잃어서 '이름 기억' 같은 확인이 들쭉날쭉해져요. 진짜 폰은 https 주소라 그런 일이 없어요.
let BASE = '';
function serve() {
  const http = require('http');
  const srv = http.createServer((req, res) => {
    const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\//, '');
    if (!/^(Index|Admin)\.html$/.test(name)) { res.statusCode = 404; return res.end(); }
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.end(fs.readFileSync(path.join(__dirname, '..', name)));
  });
  return new Promise((ok) => srv.listen(0, '127.0.0.1', () => { BASE = 'http://127.0.0.1:' + srv.address().port + '/'; ok(srv); }));
}

const OPENED = [];
/** 서버 시계를 옮기고, 열려 있는 폰 화면들의 시계도 같이 맞춰요. */
async function setClock(g, when) {
  g.setKst(when);
  for (const ctx of OPENED) await ctx.clock.setFixedTime(new Date(g.gs.Date.now()));
}

async function open(browser, file, g, opts = {}) {
  const ctx = await browser.newContext({
    ...(opts.device_ || devices['iPhone 13']),
    geolocation: opts.geo || { ...STORE, accuracy: 12 },
    permissions: ['geolocation'],
    locale: 'ko-KR',
    timezoneId: 'Asia/Seoul',
    colorScheme: opts.dark ? 'dark' : 'light',
    ...(opts.ua ? { userAgent: opts.ua } : {}),
  });
  // 폰 시계를 가짜 서버 시계와 같게 고정해요. 진짜 오늘 날짜를 쓰면 날짜 칸의 '오늘부터' 제한 때문에
  // 며칠 지나서 돌릴 때 확인이 틀어져요(타이머는 그대로 가요)
  await ctx.clock.setFixedTime(new Date(g.gs.Date.now()));
  const page = await ctx.newPage();
  const errors = [];
  OPENED.push(ctx);
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', (d) => (d.type() === 'prompt' ? d.accept(opts.prompt || '') : d.accept()));
  await page.exposeFunction('__gas', (fn, args) => {
    try { return { ok: JSON.parse(JSON.stringify(g.gs[fn](...args))) }; } catch (e) { return { err: e.message }; }
  });
  await page.addInitScript(BRIDGE);
  // 진짜 폰처럼 위치를 잡은 시각(timestamp)을 화면 시계(가짜 시계)에 맞춰요.
  // window.__geoStale = {lat, lng, acc, age} 이면 위치를 물을 때 먼저 'age초 전에 잡아 둔 위치'를 한 번 줘요(아이폰이 그래요)
  await page.addInitScript(() => {
    const geo = navigator.geolocation;
    if (!geo) return;
    const now = (p) => ({ coords: p.coords, timestamp: Date.now() });
    const stale = (ok) => {
      const st = window.__geoStale;
      if (st) setTimeout(() => ok({ coords: { latitude: st.lat, longitude: st.lng, accuracy: st.acc }, timestamp: Date.now() - st.age * 1000 }), 0);
    };
    const gcp = geo.getCurrentPosition.bind(geo), wp = geo.watchPosition.bind(geo);
    geo.getCurrentPosition = (ok, no, o) => gcp((p) => ok(now(p)), no, o);
    geo.watchPosition = (ok, no, o) => { stale(ok); return wp((p) => ok(now(p)), no, o); };
  });
  if (opts.device) await page.addInitScript((id) => localStorage.setItem('att:device', id), opts.device);
  await page.goto(BASE + file);
  return { page, ctx, errors };
}

// 기다리다 실패하면 그때 화면 상태(보이는 글자, 저장값, 브라우저 오류)를 같이 보여줘요
async function seen(x, sel) {
  try {
    await x.page.locator(sel).first().waitFor();
  } catch (e) {
    const state = await x.page.evaluate(() => Array.from(document.querySelectorAll('section, .notice, #note'))
      .filter((el) => !el.hidden).map((el) => (el.id || el.className) + ': ' + el.textContent.replace(/\s+/g, ' ').slice(0, 160))
      .concat(['저장된 값: ' + JSON.stringify(Object.assign({}, localStorage))]));
    console.error('기다린 것: ' + sel + '\n화면:\n  ' + state.join('\n  ') + '\n브라우저 오류: ' + (x.errors.join(' | ') || '없음'));
    throw e;
  }
}

(async () => {
  const srv = await serve();
  const browser = await chromium.launch();
  const g = seed();

  // ── 직원 화면 ──
  const s = await open(browser, 'Index.html', g, { device: PHONE['김민우'] });
  await s.page.getByRole('button', { name: '김민우' }).waitFor();
  assert.deepEqual(await s.page.locator('#names .group').allTextContents(), ['왕십리', '가산', '사무실'], '이름을 매장별로 묶어요');
  await s.page.screenshot({ path: path.join(OUT, '1-이름선택.png'), fullPage: true });
  // 처음 화면: [기존 직원이에요] / [새로 입사했어요]
  assert.deepEqual(await s.page.locator('#pickMode button').allTextContents(), ['기존 직원이에요', '새로 입사했어요']);
  const pm = await open(browser, 'Index.html', g, { device: 'b9b9b9b9b9b9b9b9' });
  await pm.page.locator('#pickMode [data-pm=new]').click();
  await seen(pm, '#joinCard:not([hidden])');
  assert.equal(await pm.page.isChecked('input[name=jkind][value=new]'), true, '새로 입사했어요 → 신규 입사');
  assert.match(await pm.page.textContent('#jStartNote'), /처음 출근하는 날/);
  await pm.page.click('#joinBack');
  await pm.page.click('#joinBtn'); // 명단에 내 이름이 없어요
  await seen(pm, '#joinCard:not([hidden])');
  assert.equal(await pm.page.isChecked('input[name=jkind][value=old]'), true, '명단에 없으면 기존 직원으로');
  await pm.page.close();
  await s.page.getByRole('button', { name: '김민우' }).click();
  await s.page.getByText('오늘 근무').waitFor();
  await s.page.fill('#pin', '0123');
  // 매장 오기 전 길에서 잡아 둔 위치(40초 전, 매장에서 약 230m)가 먼저 와도 안 쓰고, 새로 잡은 위치(매장 안)로 찍혀요
  await s.page.evaluate((st) => { window.__geoStale = { lat: st.latitude + 0.0021, lng: st.longitude, acc: 14, age: 40 }; }, STORE);
  await s.page.click('#btnIn');
  await s.page.getByText('출근 완료').waitFor();
  await s.page.evaluate(() => { window.__geoStale = null; });
  // 위치 줄: 찍힌 매장까지 거리와 GPS 오차(직원이 매장 위치가 틀렸는지 바로 알 수 있게)
  assert.match(await s.page.textContent('#gpsLine'), /^위치왕십리까지 \d+m · 오차 ±12m$/);
  const res = await s.page.textContent('#result');
  assert.match(res, /출근 완료 · 10:07/);
  assert.match(res, /7분 지각/);
  assert.equal(await s.page.isDisabled('#btnIn'), true, '출근 버튼은 한 번 찍으면 꺼져요');
  await s.page.click('#mineBtn');
  await s.page.locator('#mine table').waitFor();
  await s.page.screenshot({ path: path.join(OUT, '2-직원-출근완료.png'), fullPage: true });

  // 이름 기억: 새로고침해도 바로 내 화면
  await s.page.reload();
  await seen(s, 'text=출근 10:07');
  assert.equal(await s.page.inputValue('#pin'), '0123');

  // 앱을 켜 둔 채 다음 날이 되면: 어제 기록 때문에 출근 버튼이 잠기지 않고, 화면으로 돌아오면 오늘 기록을 다시 불러와요
  await setClock(g, '2026-11-19 09:50');
  await s.page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await s.page.waitForFunction(() => /오늘 근무/.test(document.getElementById('today').textContent) && !/출근 10:07/.test(document.getElementById('today').textContent));
  assert.equal(await s.page.isDisabled('#btnIn'), false, '다음 날에는 출근 버튼이 풀려요');
  assert.equal(await s.page.isVisible('#result'), false, '어제 찍은 결과 띠는 접어요');
  await setClock(g, '2026-11-18 10:07');
  await s.page.reload();
  await seen(s, 'text=출근 10:07');
  // 사장님이 비밀번호를 바꿔 줬는데 폰에 옛 번호가 기억돼 있으면: 한 번만 틀린 걸로 세고, 기억을 지워서 열 때마다 쌓이지 않아요
  g.gs.adminSetPin('582941', '김민우', '8642');
  await s.page.reload();
  await seen(s, 'text=이 폰에 기억된 비밀번호가 지금 비밀번호와 달라요');
  assert.equal(await s.page.inputValue('#pin'), '');
  assert.equal(await s.page.evaluate(() => localStorage.getItem('att:pin:김민우')), null);
  await s.page.reload();
  await s.page.getByText('오늘 근무').waitFor();
  assert.equal(g.cache.get('fail:pin:김민우'), '1', '다시 열어도 틀린 횟수가 더 쌓이지 않아요');
  g.gs.adminSetPin('582941', '김민우', '0123');
  await s.page.evaluate(() => localStorage.setItem('att:pin:김민우', '0123'));
  await s.page.reload();
  await seen(s, 'text=출근 10:07');
  assert.equal(await s.page.inputValue('#pin'), '0123');

  // 휴무표에 '결근?'이 적힌 날: 첫 화면 띠 → [못 나왔어요] → 날짜가 채워진 휴무 신청(무급) → 보내면 띠가 사라져요
  g.gs.setMark_('2026-11-13', '김민우', () => '결근?');
  g.gs.setMark_('2026-11-25', '김민우', () => '월차');
  await s.page.reload();
  await seen(s, '#absBar:not([hidden])');
  assert.match(await s.page.textContent('#absBar'), /11\/13\(금\)이 휴무표에 '결근\?'으로 적혔어요/);
  await s.page.screenshot({ path: path.join(OUT, '34-직원-결근띠.png'), fullPage: true });
  await s.page.click('[data-abs-off="2026-11-13"]');
  await seen(s, '#reqForm:not([hidden])');
  assert.equal(await s.page.inputValue('#fDate'), '2026-11-13');
  assert.equal(await s.page.isChecked('input[name=foff][value="무급"]'), true);
  // 휴무 종류: 자주 쓰는 5개 + '다른 휴가 ▾', 고르면 한 줄 설명
  assert.match(await s.page.textContent('#offDesc'), /월급이 빠지는 쉬는 날/);
  assert.equal(await s.page.isVisible('input[name=foff][value="병가"]'), false, '병가·경조 같은 건 접어 둬요');
  await s.page.click('#offMoreBtn');
  await s.page.check('input[name=foff][value="경조"]');
  assert.match(await s.page.textContent('#offDesc'), /경조사/);
  // 경조사 고르기([설정] 경조휴가 규정): 고르면 쉴 수 있는 날 수가 나오고 마지막 날이 채워져요
  assert.equal(await s.page.isVisible('#wEvent'), true, '경조사 고르기');
  assert.match(await s.page.textContent('#fEvent'), /본인 결혼 \(5일\)[\s\S]*배우자 출산 \(20일\)/);
  await s.page.selectOption('#fEvent', '본인 결혼');
  assert.match(await s.page.textContent('#eventHint'), /근무하는 날 기준 5일까지/);
  assert.equal(await s.page.inputValue('#fDateTo'), '2026-11-17');
  await s.page.locator('#reqCard').screenshot({ path: path.join(OUT, '44-직원-휴무종류.png') });
  await s.page.check('input[name=foff][value="무급"]');
  assert.equal(await s.page.inputValue('#fDateTo'), '', '다른 종류로 바꾸면 경조사로 채운 마지막 날은 지워요');
  assert.equal(await s.page.isVisible('#wEvent'), false);
  await s.page.fill('#fReason', '몸이 안 좋았어요');
  await s.page.click('#fSend');
  await s.page.getByText('요청을 보냈어요').waitFor();
  assert.equal(await s.page.isVisible('#absBar'), false);
  // 근무표: 지난달 단추, 내 월차 내역, 승인된 휴무 취소 요청
  await s.page.click('#schedBtn');
  await seen(s, '#cal .d');
  assert.deepEqual(await s.page.locator('#ymSeg button').allTextContents(), ['10월', '11월', '12월']);
  await s.page.click('#leaveBtn');
  await seen(s, '#leaveBox table');
  assert.match(await s.page.textContent('#leaveBox'), /2026년 월차[\s\S]*11월[\s\S]*11\/25/);
  await s.page.locator('#schedCard').screenshot({ path: path.join(OUT, '35-직원-월차내역.png') });
  await s.page.click('#cal [data-d="25"]');
  await s.page.click('[data-cancel-off="2026-11-25"]');
  await s.page.getByText('휴무 취소 요청을 보냈어요').waitFor();
  assert.ok(g.gs.readReqsNow_().some((q) => q.name === '김민우' && q.kind === '취소' && q.date === '2026-11-25'));
  // 휴무 바꾸기: 11/21(토) 쉬는 날에 출근하고 대신 11/24(화)에 쉬기
  await s.page.click('[data-kind=move]');
  await seen(s, '#wDateFrom:not([hidden])');
  assert.equal(await s.page.textContent('#fDateLabel'), '쉴 날 (원래 일하는 날)');
  await s.page.click('#fSend');
  await s.page.getByText('출근할 날과 쉴 날을 둘 다 골라주세요.').waitFor();
  await s.page.fill('#fDateFrom', '2026-11-21');
  await s.page.fill('#fDate', '2026-11-24');
  await s.page.fill('#fReason', '가족 모임이 화요일로 바뀜');
  await s.page.click('#fSend');
  await s.page.locator('#myReqs .item', { hasText: '휴무 바꾸기' }).waitFor();
  assert.match(await s.page.textContent('#myReqs'), /휴무 바꾸기 11\/24\(화\) 쉬고 11\/21\(토\) 출근/);
  await s.page.locator('#reqCard').screenshot({ path: path.join(OUT, '41-직원-휴무바꾸기.png') });
  // 조퇴·외출: 오늘 16:00 조퇴 + 증빙 사진(요청을 보낸 뒤 사진은 뒤에서 올라가요)
  await s.page.click('[data-kind=early]');
  await seen(s, '#wEarly:not([hidden])');
  assert.equal(await s.page.textContent('#fTimeLabel'), '나갈 시각');
  assert.equal(await s.page.isVisible('#wTime2'), false);
  await s.page.check('input[name=fearly][value="외출"]');
  assert.equal(await s.page.isVisible('#wTime2'), true, '외출은 돌아올 시각도');
  await s.page.check('input[name=fearly][value="조퇴"]');
  await s.page.click('#fSend');
  await s.page.getByText('나갈 시각을 넣어주세요.').waitFor();
  await s.page.fill('#fTime', '16:00');
  await s.page.fill('#fReason', '병원');
  await s.page.setInputFiles('#fProof', { name: 'doc.png', mimeType: 'image/png', buffer: Buffer.from(PNG1, 'base64') });
  await s.page.click('#fSend');
  await s.page.getByText('증빙 사진을 올렸어요. 사장님만 볼 수 있어요.').waitFor();
  assert.match(await s.page.textContent('#myReqs'), /조퇴 11\/18\(수\) 16:00에 퇴근 \(원래 10:00-20:00\)/);
  assert.match(await s.page.textContent('#myReqs'), /증빙 ✓/);
  const early = g.gs.readReqsNow_().find((q) => q.name === '김민우' && q.kind === '조퇴');
  assert.match(early.proof, /^https:\/\/drive\.google\.com\/file\/d\//);
  assert.ok(g.drive.files.some((f) => f.mime === 'image/jpeg' && /김민우 조퇴/.test(f.name)), '줄인 JPEG로 저장');
  // 목록의 [증빙 바꾸기]로 다시 올리기
  const [chooser] = await Promise.all([s.page.waitForEvent('filechooser'), s.page.click('#myReqs [data-proof="' + early.id + '"]')]);
  await chooser.setFiles({ name: 'doc2.png', mimeType: 'image/png', buffer: Buffer.from(PNG1, 'base64') });
  await s.page.getByText('증빙 사진을 올렸어요. 사장님만 볼 수 있어요.').waitFor();
  assert.notEqual(g.gs.readReqsNow_().find((q) => q.id === early.id).proof, early.proof, '새 사진으로 바뀌어요');
  await s.page.locator('#reqCard').screenshot({ path: path.join(OUT, '47-직원-조퇴증빙.png') });
  // 정리(뒤쪽 확인이 이 요청들에 걸리지 않게)
  g.gs.readReqsNow_().filter((q) => q.name === '김민우').forEach((q) => g.gs.cancelRequest('김민우', '0123', q.id));
  g.gs.setMark_('2026-11-13', '김민우', () => '');
  g.gs.setMark_('2026-11-25', '김민우', () => '');
  await s.page.reload();
  await seen(s, 'text=출근 10:07');

  // 내 전용 주소: 저장 정보가 지워진 새 브라우저에서도 이 주소로 열면 같은 폰·같은 이름으로 알아봐요
  await s.page.click('#myLinkBtn');
  await seen(s, '#myLinkUrl');
  const myUrl = await s.page.inputValue('#myLinkUrl');
  assert.match(myUrl, /\?d=a1a1a1a1a1a1a1a1&n=%EA%B9%80%EB%AF%BC%EC%9A%B0$/);
  const wiped = await open(browser, 'Index.html' + myUrl.slice(myUrl.indexOf('?')), g, {}); // 저장된 것이 하나도 없는 브라우저
  await wiped.page.getByText('오늘 근무').waitFor(); // 이름을 다시 고르지 않아도 내 화면
  assert.equal(await wiped.page.evaluate(() => localStorage.getItem('att:device')), null);
  await wiped.page.fill('#pin', '0123');
  await wiped.page.click('#myInfoBtn'); // 등록된 폰에서만 열리는 화면: '새 폰'으로 막히지 않아요
  await seen(wiped, '#joinCard:not([hidden])');
  await wiped.page.waitForFunction(() => document.getElementById('joinMsg').hidden);
  assert.ok(!/등록된 폰/.test(await wiped.page.textContent('#joinCard')));
  await wiped.page.close();

  // 멀리서 찍으면 거절
  const far = await open(browser, 'Index.html', g, { device: PHONE['이지은'], geo: { latitude: 37.6, longitude: 126.978, accuracy: 10 } });
  await far.page.getByRole('button', { name: '이지은' }).click();
  await far.page.getByText('오늘 근무').waitFor();
  await far.page.fill('#pin', '5678');
  await far.page.click('#btnIn');
  await far.page.locator('#result.bad').waitFor();
  assert.equal(await far.page.textContent('#rt'), '가산에서 약 2.2km 떨어져 있어요.'); // 큰 글씨는 짧게
  assert.match(await far.page.textContent('#rs'), /^\(허용 반경 100m · GPS 오차 ±10m\) 매장 안 창가나 문 근처에서 다시 눌러주세요\./);
  assert.match(await far.page.textContent('#result'), /매장 위치가 잘못 등록된 거예요/);
  assert.match(await far.page.textContent('#gpsLine'), /가산까지 2\.\dkm · 오차 ±10m · 허용 100m 밖/);
  assert.match(await far.page.getAttribute('#gpsLine', 'class'), /bad/);
  await far.page.screenshot({ path: path.join(OUT, '3-직원-멀리서.png') });
  // 정확한 위치가 꺼진 폰(오차 1000m): 창가로 가라고 하지 않고 켜는 곳을 줄 바꿔서 알려줘요
  await far.ctx.setGeolocation({ latitude: 37.6, longitude: 126.978, accuracy: 1000 });
  await far.page.click('#btnIn');
  await far.page.waitForFunction(() => /정확한 위치/.test(document.getElementById('result').textContent));
  const coarse = await far.page.evaluate(() => document.getElementById('rs').innerText);
  assert.match(coarse, /\n· 아이폰: 설정 → 개인정보 보호 및 보안 → 위치 서비스 → 카카오톡 → '정확한 위치' 켜기\n· 갤럭시: /);
  assert.ok(!/창가/.test(coarse), '정확한 위치가 꺼진 거면 창가로 가도 소용없어요');
  await far.page.screenshot({ path: path.join(OUT, '3b-직원-정확한위치꺼짐.png') });
  await far.ctx.setGeolocation({ latitude: 37.6, longitude: 126.978, accuracy: 10 });

  // 이지은: 11/20(금) 대타 구하기
  await far.page.locator('#pin').dispatchEvent('change');
  await far.page.getByText('아직 보낸 요청이 없어요').waitFor();
  await far.page.click('[data-kind=swap]');
  await far.page.fill('#fDate', '2026-11-20');
  await far.page.fill('#fReason', '집안 행사');
  await far.page.click('#fSend');
  await seen(far, 'text=대타 구함을 올렸어요');
  assert.match(await far.page.textContent('#myReqs'), /대타 11\/20\(금\) 12:00-21:00 대타.*대타 구하는 중/);

  // 김민우: 어제(11/17) 퇴근 정정 요청
  await s.page.click('[data-kind=fix]');
  await s.page.selectOption('#fDateFix', '2026-11-17');
  await s.page.fill('#fTime', '20:05');
  await s.page.fill('#fReason', '마감하다 늦게 찍음');
  assert.equal(await s.page.textContent('#toMgr'), '박준호 점장에게', '우리 매장 점장에게 먼저 보내요');
  await s.page.click('#fSend');
  await s.page.getByText('요청을 보냈어요. 점장이 확인하고 관리자에게 올리면 승인해요.').waitFor();
  assert.match(await s.page.textContent('#myReqs'), /점장 확인 중/);
  assert.match(await s.page.textContent('#swaps'), /11\/20\(금\) 12:00-21:00이지은 님 대신/, '동료의 대타 구함이 보여요');
  await s.page.screenshot({ path: path.join(OUT, '9-직원-요청.png'), fullPage: true });

  // 근무표: 이번 달 달력, 내 지각·정기 휴무, 날짜를 누르면 누가 쉬는지
  const kimNov = () => g.gs.monthGrid_('2026-11', true).rows['김민우'].row;
  g.sheet('26.11').getRange(kimNov(), 10).setValue('만근 예정'); // 시트가 계산한 만근 값처럼
  await s.page.click('#schedBtn');
  await s.page.locator('#cal [data-d="30"]').waitFor();
  assert.match(await s.page.textContent('#fullLine'), /이 달 만근 예정 → 다음 달 월차 1개/);
  assert.equal(await s.page.locator('#cal [data-d]').count(), 30);
  assert.match(await s.page.textContent('#cal [data-d="17"]'), /지각/);
  assert.match(await s.page.getAttribute('#cal [data-d="18"]', 'class'), /\bnow\b/, '오늘 표시');
  const tops = await s.page.evaluate(() => [15, 16, 17, 18, 19, 20, 21].map((d) => document.querySelector('#cal [data-d="' + d + '"]').getBoundingClientRect().top));
  assert.equal(new Set(tops).size, 1, '한 주의 칸이 같은 높이에 있어요: ' + tops);
  assert.match(await s.page.textContent('#cal [data-d="21"]'), /쉼/);
  await s.page.click('#cal [data-d="21"]');
  assert.match(await s.page.textContent('#dayInfo'), /11\/21\(토\).*나: 쉼/);
  await s.page.locator('#schedCard').screenshot({ path: path.join(OUT, '14-직원-근무표.png') });
  await s.page.click('#schedBtn');

  // 박준호: 어제(11/17) 퇴근을 안 찍었어요. [설정] 퇴근확인이 기본(안함)이면 안내가 안 떠요
  const pj = await open(browser, 'Index.html', g, { device: PHONE['박준호'] });
  await pj.page.addInitScript(() => localStorage.setItem('att:pin:박준호', '432198'));
  await pj.page.reload();
  await pj.page.getByRole('button', { name: '박준호' }).click();
  await pj.page.locator('#myReqs').waitFor({ state: 'attached' });
  await pj.page.waitForTimeout(300);
  assert.equal(await pj.page.isVisible('#missOut'), false, '퇴근확인 안함: 퇴근 누락 안내 없음');
  // 퇴근확인을 켜면 안내가 떠요 → 버튼을 누르면 정정 양식이 채워져요
  g.gs.setSetting_('퇴근확인', '함');
  g.gs.MEMO_ = {};
  await pj.page.reload(); // 고른 이름은 기억해서 바로 내 화면이 열려요
  await pj.page.locator('#missOut:not([hidden])').waitFor();
  assert.match(await pj.page.textContent('#missOut'), /11\/17\(화\) 퇴근을 안 찍었어요/);
  await pj.page.screenshot({ path: path.join(OUT, '12-직원-퇴근누락.png'), fullPage: true });
  await pj.page.click('#missGo');
  assert.equal(await pj.page.inputValue('#fDateFix'), '2026-11-17');
  assert.equal(await pj.page.isChecked('input[name=ftype][value=out]'), true);
  await pj.page.click('[data-kind=fix]'); // 양식 닫기
  await pj.page.locator('[data-take]').click();
  await pj.page.getByText('대타를 수락했어요').waitFor();
  assert.match(await pj.page.textContent('#myReqs'), /내가 대타 · 승인 대기/);
  assert.equal(await pj.page.isVisible('#wTo'), false, '점장 본인 요청은 관리자에게 바로(고르는 칸 없음)');

  // ── 점장 화면: 박준호(왕십리 점장)가 이름 + 내 비밀번호로 들어가서 관리자에게 올려요 ──
  const m = await open(browser, 'Admin.html', g, { prompt: '퇴근 20:05 맞아요' });
  await m.page.click('#loginMode');
  await m.page.locator('#mgrName option').first().waitFor({ state: 'attached' });
  assert.deepEqual(await m.page.locator('#mgrName option').allTextContents(), ['박준호']);
  await m.page.fill('#apin', '432198');
  await m.page.click('#loginForm button');
  await m.page.locator('#people .person').first().waitFor();
  assert.match(await m.page.textContent('#roleTag'), /왕십리 점장 · 박준호/);
  const mp = await m.page.textContent('#people');
  assert.match(mp, /김민우/);
  assert.doesNotMatch(mp, /이지은/, '점장은 자기 매장만');
  assert.match(await m.page.textContent('#reqs'), /김민우.*퇴근 20:05로 고쳐주세요.*점장 확인 전/);
  await m.page.screenshot({ path: path.join(OUT, '16-점장-오늘.png'), fullPage: true });
  // 점장 [직원] 탭: 우리 매장 직원 이름·휴대폰만(인사 카드는 못 열어요)
  await m.page.click('[data-tab=hr]');
  await seen(m, '#hrList .hrp');
  assert.match(await m.page.textContent('#hrIntro'), /우리 매장 직원 이름과 휴대폰/);
  assert.equal(await m.page.locator('#hrList [data-hr]').count(), 0);
  assert.match(await m.page.textContent('#hrList'), /김민우/);
  assert.ok(!/이지은/.test(await m.page.textContent('#hrList')), '다른 매장 직원은 안 보여요');
  await m.page.click('[data-tab=today]');
  await m.page.click('[data-fwd]');
  await m.page.getByText('관리자에게 올렸어요').waitFor();
  assert.match(await m.page.textContent('#reqs'), /관리자 승인을 기다리는 중/);
  await m.page.click('[data-tab=set]');
  assert.equal(await m.page.isVisible('#tgStatus'), false, '점장은 텔레그램 설정 안 보여요');
  assert.equal(await m.page.isVisible('#devices'), false, '직원 관리도 안 보여요');
  assert.match(await m.page.textContent('#stores'), /왕십리.*점장 박준호/);
  assert.doesNotMatch(await m.page.textContent('#stores'), /가산/);
  await m.page.click('[data-tab=month]');
  await m.page.locator('#sumTable [data-who]').first().waitFor();
  assert.doesNotMatch(await m.page.textContent('#sumTable'), /차감액|원/, '점장 화면엔 차감액이 없어요');
  assert.equal(await m.page.isVisible('#export'), false);
  // 로그아웃하면 다시 로그인 화면
  await m.page.click('[data-tab=set]');
  await m.page.click('#logout');
  await seen(m, '#login:not([hidden])');
  assert.equal(await m.page.evaluate(() => localStorage.getItem('att:admin') || sessionStorage.getItem('att:admin')), null);

  // 신입: 비밀번호·인사 정보가 아직 없어요 → 출근 버튼 대신 [시작하기] → 인사 정보를 넣으면서 비밀번호를 정하고 그다음 출근
  const nw = await open(browser, 'Index.html', g, { device: PHONE['신입'], geo: { latitude: 37.58, longitude: 126.978, accuracy: 10 } });
  await nw.page.getByRole('button', { name: '신입' }).click();
  await seen(nw, '#hrGate:not([hidden])');
  assert.equal(await nw.page.isVisible('#btnIn'), false, '출근 버튼 대신 안내가 보여요');
  assert.equal(await nw.page.isVisible('#pinBox'), false, '비밀번호는 양식에서 정해요');
  assert.match(await nw.page.textContent('#hrGate'), /처음이에요! 출근하기 전에 인사 정보를 한 번 넣어주세요/);
  await nw.page.screenshot({ path: path.join(OUT, '11-직원-처음-인사정보.png'), fullPage: true });
  await nw.page.click('#hrGateGo');
  await seen(nw, '#joinCard:not([hidden])');
  assert.equal(await nw.page.textContent('#jTitle'), '처음 시작하기 · 인사 정보');
  assert.equal(await nw.page.isVisible('#wjPin'), true, '비밀번호 칸');
  assert.equal(await nw.page.isVisible('#jAgreeJoin'), true, '출퇴근 확인 동의도 여기서');
  assert.equal(await nw.page.isVisible('#wjName'), false);
  await nw.page.fill('#jRrn1', '960303');
  await nw.page.fill('#jRrn2', '2345678');
  await nw.page.fill('#jPhone', '010-4444-5555');
  await nw.page.fill('#jAddr', '서울 금천구 가산로 9');
  await nw.page.fill('#jBank', '국민');
  await nw.page.fill('#jAccount', '123456-78-111111');
  await nw.page.fill('#jStart', '2026-11-10');
  await nw.page.fill('#jPin', '2468');
  await nw.page.fill('#jPin2', '2468');
  await nw.page.check('#jAgree');
  await nw.page.check('#jAgreeLoc');
  await nw.page.click('#jSend');
  await nw.page.getByText('비상연락처(가족 등 급할 때 연락할 사람의 전화번호)를 넣어주세요.').waitFor();
  await nw.page.fill('#jEmergency', '010-9999-8888 어머니');
  await nw.page.click('#jSend'); // '신입 님 맞아요?' 확인 창은 [확인]
  await seen(nw, '#me:not([hidden])');
  await nw.page.getByText('비밀번호가 정해졌어요').waitFor();
  await nw.page.waitForFunction(() => document.getElementById('hrGate').hidden);
  assert.equal(await nw.page.isVisible('#agreeBox'), false, '동의는 양식에서 했어요');
  assert.equal(g.gs.staff_().find((x) => x.name === '신입').pin, '2468');
  await nw.page.click('#btnIn');
  await nw.page.getByText('출근 완료').waitFor();

  // 최유나가 새 폰(등록 안 된 폰)으로 찍으려 함 → 거절 + 승인 요청 (사무실, 수요일 휴무)
  const np = await open(browser, 'Index.html', g);
  await np.page.getByRole('button', { name: '최유나' }).click();
  await np.page.getByText('오늘은 쉬는 날이에요').waitFor();
  await np.page.fill('#pin', '5555');
  await np.page.click('#btnIn');
  await np.page.locator('#result.bad').waitFor();
  assert.match(await np.page.textContent('#result'), /등록된 폰이 아니에요/);
  await np.page.screenshot({ path: path.join(OUT, '8-직원-새폰.png') });

  // 카톡 안에서 열면 안내가 떠요
  // 카톡 안에서 열면(기본): '다른 브라우저로 열기'를 누르지 말라고 한 번 알려요([알겠어요]를 누르면 다시 안 떠요)
  const kakao = await open(browser, 'Index.html', g, { ua: devices['iPhone 13'].userAgent + ' KAKAOTALK 10.4.5' });
  await kakao.page.locator('#inapp:not([hidden])').waitFor();
  assert.equal(await s.page.isVisible('#inapp'), false, '이름을 고른 사파리에서는 안 떠요');
  assert.match(await kakao.page.textContent('#inapp'), /카톡 안에서 그대로 쓰세요[\s\S]*"다른 브라우저로 열기"는 누르지 마세요/);
  await kakao.page.locator('#inapp').screenshot({ path: path.join(OUT, '49-직원-카톡안내.png') });
  await kakao.page.click('#inappOk');
  assert.equal(await kakao.page.isVisible('#inapp'), false);
  await kakao.page.reload();
  await kakao.page.getByRole('button', { name: '김민우' }).waitFor();
  assert.equal(await kakao.page.isVisible('#inapp'), false, '한 번 [알겠어요]를 누르면 다시 안 떠요');
  // 카톡에서 입사 등록: 다른 브라우저 경고 없음
  const kjoin = await open(browser, 'Index.html?join=' + encodeURIComponent('가산'), g, { ua: devices['Pixel 7'].userAgent + ' KAKAOTALK 10.4.5' });
  await seen(kjoin, '#joinCard:not([hidden])');
  assert.equal(await kjoin.page.isVisible('#jInapp'), false);
  await kjoin.page.close();
  // 카톡 밖(사파리 등) 폰에서 처음 열면: 카톡 링크로 열라고. 입사 등록 화면에도
  const safari = await open(browser, 'Index.html', g, { device: 'c1c1c1c1c1c1c1c1' });
  await safari.page.locator('#inapp:not([hidden])').waitFor();
  assert.match(await safari.page.textContent('#inapp'), /카카오톡에서 받은 링크로 열어 주세요/);
  await safari.page.locator('#inapp').screenshot({ path: path.join(OUT, '49b-직원-다른브라우저경고.png') });
  await safari.page.locator('#pickMode [data-pm=new]').click();
  await seen(safari, '#jInapp:not([hidden])');
  assert.match(await safari.page.textContent('#jInapp'), /카카오톡에서 받은 링크로 열어서 등록해 주세요/);
  await safari.page.close();
  // 사장님 화면은 카톡 안에서 열어도 안내가 없어요
  const kadmin = await open(browser, 'Admin.html', g, { ua: devices['iPhone 13'].userAgent + ' KAKAOTALK 10.4.5' });
  await kadmin.page.locator('#loginForm').waitFor();
  assert.equal(await kadmin.page.locator('#inapp').count(), 0);
  await kadmin.page.close();

  // ── 사장님 화면 ── (비번 정하기 창에는 7351 을 넣어요)
  const a = await open(browser, 'Admin.html', g, { prompt: '7351' });
  await a.page.fill('#apin', '1111');
  await a.page.click('#loginForm button');
  await a.page.getByText('관리자 비밀번호가 틀렸어요').waitFor();
  g.cache.clear();
  await a.page.fill('#apin', '582941');
  await a.page.click('#loginForm button');
  await a.page.locator('#people .person').first().waitFor();
  const people = await a.page.textContent('#people');
  assert.match(people, /김민우.*지각/);
  assert.match(people, /최유나.*휴무/);
  assert.equal(await a.page.isVisible('#pendingCard'), true, '새 폰 승인 요청이 보여요');
  assert.match(await a.page.textContent('#suspects'), /최유나 · 새 폰 승인 요청/);
  assert.match(await a.page.textContent('#suspects'), /이지은 · 매장 밖/);
  // 매장 필터
  await a.page.click('#storeChips [data-store="가산"]');
  const onlyGasan = await a.page.textContent('#people');
  assert.match(onlyGasan, /이지은/);
  assert.doesNotMatch(onlyGasan, /김민우/);
  await a.page.click('#storeChips [data-store=""]');
  await a.page.screenshot({ path: path.join(OUT, '4-사장님-오늘.png'), fullPage: true });
  await a.page.click('[data-approve="최유나"]');
  await a.page.getByText('승인했어요').waitFor();
  assert.equal(await a.page.isVisible('#pendingCard'), false);
  // 승인 뒤에는 새 폰으로 찍혀요
  await np.page.click('#btnIn');
  await np.page.getByText('출근 완료').waitFor();
  // 최유나 비밀번호 5555는 쉬운 번호 → 바꾸라는 안내 → 바꾸기
  await np.page.locator('#weakPin:not([hidden])').waitFor();
  await np.page.click('#weakGo');
  await np.page.fill('#newPin', '8642');
  await np.page.fill('#newPin2', '8642');
  await np.page.click('#pinChangeSend');
  await np.page.getByText('바꿨어요').waitFor();
  assert.equal(g.gs.staff_().find((x) => x.name === '최유나').pin, '8642');

  // 직원 요청 2건(김민우 정정, 이지은→박준호 대타) 승인
  await a.page.click('#refresh');
  await a.page.locator('#reqCard:not([hidden])').waitFor();
  const reqText = await a.page.textContent('#reqs');
  assert.match(reqText, /김민우.*11\/17\(화\) 퇴근 20:05로 고쳐주세요.*지금 기록 20:00.*사유: 마감하다 늦게 찍음/);
  assert.match(reqText, /이지은.*11\/20\(금\) 12:00-21:00 → 박준호 님이 대신 근무/);
  assert.match(reqText, /점장 박준호 확인 퇴근 20:05 맞아요/, '점장이 올린 요청과 한마디');
  await a.page.locator('#reqCard').screenshot({ path: path.join(OUT, '10-사장님-요청.png') });
  await a.page.locator('[data-rq-ok]').first().click();
  await a.page.getByText('승인했어요. 기록과 근무표에 반영됐어요.').waitFor();
  await a.page.locator('[data-rq-ok]').first().click();
  await a.page.waitForFunction(() => document.getElementById('reqCard').hidden);
  const fixed = g.sheet('출퇴근기록');
  let found17 = false;
  for (let r = 2; r <= fixed.getLastRow(); r++) {
    const v = fixed.rowDisplay(r);
    if (v[0] === '2026-11-17' && v[2] === '김민우') { found17 = true; assert.equal(v[6], '20:05'); }
  }
  assert.ok(found17);
  assert.equal(g.sheet('근무변경').getLastRow(), 2, '대타 승인 → 대타 시간만 근무변경에 1줄');
  g.gs.GRID_ = {};
  assert.equal(g.gs.dayMark_('이지은', '2026-11-20'), '휴무', '휴무표: 요청한 사람 휴무');
  assert.equal(g.gs.dayMark_('박준호', '2026-11-20'), '대타 가산', '휴무표: 다른 매장(가산) 대타는 대타 + 매장 이름');
  assert.equal(g.gs.dayMark_('김민우', '2026-11-18'), '10:07', '휴무표: 오늘 지각 시간이 자동으로');

  await a.page.click('[data-tab=month]');
  await a.page.locator('#sumTable [data-who]').first().waitFor();
  await a.page.click('#sumTable [data-who="김민우"]');
  await a.page.getByText('김민우 날짜별 기록').waitFor();
  const sum = await a.page.textContent('#sumTable');
  assert.match(sum, /김민우.*2회19분.*3,800원/);
  assert.match(sum, /이지은가산조퇴 30분/);
  const cut = await a.page.evaluate(() => Array.from(document.querySelectorAll('.scroll')).map((el) => el.scrollWidth - el.clientWidth));
  assert.ok(cut.every((x) => x <= 0), '휴대폰에서 표가 잘려요: ' + cut);
  await a.page.screenshot({ path: path.join(OUT, '5-사장님-월별.png'), fullPage: true });
  // 확인할 것: '결근?'을 체크해서 한 번에 무급으로 → 월차 현황 보기
  g.gs.setMark_('2026-11-13', '이지은', () => '결근?');
  await a.page.click('#next');
  await a.page.click('#prev');
  await seen(a, '#issueList [data-abs]');
  assert.match(await a.page.textContent('#issueList'), /이지은[\s\S]*11\/13\(금\)/);
  await a.page.locator('#issueCard').screenshot({ path: path.join(OUT, '36-사장님-확인할것.png') });
  await a.page.check('#issueList [data-abs="0"]');
  await a.page.click('#issueActs [data-fix="무급"]');
  await a.page.getByText('1건을 바꿨어요.').waitFor();
  g.gs.GRID_ = {};
  assert.equal(g.gs.dayMark_('이지은', '2026-11-13'), '무급');
  g.gs.setMark_('2026-11-13', '이지은', () => '');
  // 지원 근무: 누가 어디로 몇 번
  g.gs.setMark_('2026-11-12', '이지은', () => '왕십리');
  g.gs.setMark_('2026-11-11', '이지은', () => '왕십리 10:20');
  await a.page.click('#supMonth');
  await a.page.getByText('11월 · 모두 3번').waitFor(); // 이지은 2번 + 위에서 승인한 박준호의 가산 대타(11/20, '대타 가산') 1번
  assert.match(await a.page.textContent('#supList'), /이지은[\s\S]*2번[\s\S]*→ 왕십리 2번 \(11\/11, 11\/12\)/);
  await a.page.locator('#supCard').screenshot({ path: path.join(OUT, '38-사장님-지원근무.png') });
  g.gs.setMark_('2026-11-12', '이지은', () => '');
  g.gs.setMark_('2026-11-11', '이지은', () => '');
  await a.page.click('#leaveShow');
  await seen(a, '#leaveTable tbody tr');
  assert.match(await a.page.textContent('#leaveTable'), /김민우/);
  // 받음(부여)은 사장님이 정해요: 1개로 → 자동으로
  await a.page.selectOption('#leaveTable [data-grant="김민우"]', '1');
  await a.page.getByText(/김민우 님 11월 받은 월차를 1개로 정했어요/).waitFor();
  assert.match(await a.page.textContent('#leaveTable'), /사장님이 정함/);
  assert.equal(g.sheet('26.11').cells.get(kimNov() + ',7'), 1);
  await a.page.locator('#leaveCard').screenshot({ path: path.join(OUT, '37-사장님-월차현황.png') });
  await a.page.selectOption('#leaveTable [data-grant="김민우"]', 'auto');
  await a.page.getByText(/김민우 님 11월 받은 월차를 자동으로 정했어요/).waitFor();
  await a.page.click('#export');
  await a.page.getByText("'정산 2026-11' 시트를 만들었어요").waitFor();
  // 직원 1년 보기: 김민우 12달(11월까지) + 합계, 1년 요약 시트
  assert.equal(await a.page.inputValue('#yrName'), '김민우', '위 표에서 누른 사람이 골라져요');
  g.sheet('26.11').getRange(kimNov(), 10).setValue('아님: 11/17 결근?');
  await a.page.click('#yrGo');
  await seen(a, '#yrTable tbody tr');
  assert.match(await a.page.textContent('#yrFull'), /만근 아님: 11월 11\/17 결근\?/);
  const yr = await a.page.textContent('#yrTable');
  assert.match(yr, /11월.*\d+일.*2회.*합계/);
  assert.match(yr, /1월기록 없음/);
  await a.page.locator('#yearCard').screenshot({ path: path.join(OUT, '21-사장님-1년보기.png') });
  await a.page.click('#yrExport');
  await a.page.getByText("'연간 2026' 시트를 만들었어요").waitFor();
  assert.ok(g.sheet('연간 2026'));
  const yearOver = await a.page.evaluate(() => { const el = document.querySelector('#yearCard .scroll'); return el.scrollWidth - el.clientWidth; });
  assert.ok(yearOver <= 0, '1년 표가 휴대폰에서 잘려요: ' + yearOver);

  await a.page.click('[data-tab=set]');
  assert.match(await a.page.textContent('#stores'), /왕십리.*위치 등록됨.*가산.*위치 등록됨.*사무실.*직원별 시간/);
  // 정확한 위치가 꺼진 폰(오차 500m)으로는 매장 위치를 등록하지 않아요
  await a.ctx.setGeolocation({ ...STORE, accuracy: 500 });
  await a.page.click('[data-place="왕십리"]');
  await a.page.locator('#placeMsg.bad').waitFor({ timeout: 20000 });
  assert.match(await a.page.textContent('#placeMsg'), /오차가 500m나 돼서 매장 위치로 쓸 수 없어요.*정확한 위치/);
  await a.ctx.setGeolocation({ ...STORE, accuracy: 12 });
  // 시트에 손으로 적은 좌표(앱으로 등록한 기록과 다름)는 [다시 등록]을 권해요
  g.sheet('매장').getRange(3, 4, 1, 2).setValues([['37.58001', '126.97801']]); // 가산
  g.gs.MEMO_ = {};
  await a.page.click('#refresh');
  await a.page.click('[data-tab=set]');
  await a.page.waitForFunction(() => /가산.*앱으로 등록한 기록이 없는 좌표/.test(document.getElementById('stores').textContent));
  await a.page.click('[data-place="왕십리"]');
  await a.page.getByText('왕십리 위치를 등록했어요').waitFor();
  assert.match(await a.page.textContent('#stores'), /왕십리.*위치 등록됨 · 반경 \d+m · 앱으로 등록 · \d\d\/\d\d \d\d:\d\d · 오차 12m/);
  await a.page.locator('#stores').screenshot({ path: path.join(OUT, '21b-사장님-매장위치.png') });
  assert.equal(await a.page.inputValue('#appUrl'), 'https://script.google.com/macros/s/TEST/exec');
  // 텔레그램 연결
  await a.page.fill('#tgToken', '123456789:' + 'A'.repeat(35));
  await a.page.click('#tgSave');
  await a.page.getByText('저장했어요 (@goodphone_test_bot)').waitFor();
  await seen(a, '#tgCodeBox:not([hidden])');
  const ownerCode = (await a.page.textContent('#tgCode')).trim();
  assert.match(ownerCode, /^\/start \d{6}$/);
  assert.match(await a.page.getAttribute('#tgOwnerOpen', 'href'), /^https:\/\/t\.me\/goodphone_test_bot\?start=own\d{6}$/);
  await a.page.click('#tgLink');
  await a.page.getByText('봇에게 온 연결 코드가 없어요').waitFor();
  g.tg.updates.push({ update_id: 1, message: { chat: { id: 4242, type: 'private' }, text: ownerCode } });
  await a.page.click('#tgLink');
  await a.page.getByText('연결됐어요!').waitFor();
  assert.match(await a.page.textContent('#tgStatus'), /연결됨/);
  assert.equal(await a.page.isVisible('#tgSetup'), false);
  // 직원 관리: 사장님이 이지은 비밀번호를 미리 정해줘요
  await a.page.click('[data-setpin="이지은"]');
  await a.page.getByText('이지은 님 비밀번호를 정했어요').waitFor();
  assert.equal(g.gs.staff_().find((x) => x.name === '이지은').pin, '7351');
  assert.match(g.tg.sent.at(-1).text, /알림이 연결됐어요/);
  await a.page.screenshot({ path: path.join(OUT, '6-사장님-설정.png'), fullPage: true });

  // ── 테스트 도구: 알림 시험, 마감 정리 미리 보기, 테스트 직원 ──
  await a.page.click('#notifyTest');
  await a.page.getByText('텔레그램(으)로 시험 알림을 보냈어요').waitFor();
  assert.match(g.tg.sent.at(-1).text, /시험 알림/);
  const sheetBefore = g.sheet('출퇴근기록').getLastRow();
  await a.page.click('[data-close="today"]');
  await seen(a, '#closeOut:not([hidden])');
  assert.match(await a.page.textContent('#closeOut'), /11\/18\(수\) · 출근 \d+명/);
  assert.equal(g.sheet('출퇴근기록').getLastRow(), sheetBefore, '미리 보기는 아무것도 안 바꿔요');
  await a.page.selectOption('#testStore', '왕십리');
  await a.page.click('#testMake');
  await a.page.getByText('테스트 직원을 왕십리에 만들었어요').waitFor();
  await a.page.locator('#testCard').screenshot({ path: path.join(OUT, '19-사장님-테스트.png') });
  // 사장님 폰(아무 폰)으로, 매장에서 먼 곳에서도 테스트 직원으로 찍혀요
  const tt = await open(browser, 'Index.html', g, { geo: { latitude: 35.1, longitude: 129.0, accuracy: 30 }, device: PHONE['김민우'] });
  await tt.page.getByRole('button', { name: '테스트' }).click();
  await seen(tt, '#testNote:not([hidden])');
  await tt.page.fill('#pin', '9753');
  await tt.page.check('#agree');
  await tt.page.click('#btnIn');
  await tt.page.getByText('출근 완료').waitFor();
  assert.match(await tt.page.textContent('#result'), /테스트라 위치는 안 봤어요/);
  assert.equal(g.gs.staff_().find((x) => x.name === '김민우').deviceId, PHONE['김민우'], '김민우 폰 등록은 그대로');
  await a.page.click('#testClear');
  await a.page.getByText(/테스트 기록 \d+줄을 지웠어요/).waitFor();
  assert.ok(!g.gs.staff_().some((x) => x.name === '테스트'), '테스트 직원이 지워져요');
  assert.equal(g.sheet('출퇴근기록').getLastRow(), sheetBefore, '테스트 출근 기록도 지워져요');

  // 작은 폰(아이폰 SE, 폭 320)에서도 가로로 안 넘쳐요
  const se = await open(browser, 'Index.html', g, { device: PHONE['신입'], device_: devices['iPhone SE'] });
  await se.page.getByRole('button', { name: '신입' }).click();
  await se.page.getByText('오늘 근무').waitFor();
  await se.page.fill('#pin', '2468');
  // 비밀번호를 넣으면 첫 화면 안내를 다시 불러와요(위쪽에 띠가 생겨 단추 자리가 움직여요). 다 불러온 뒤에 눌러요
  await se.page.locator('#pin').dispatchEvent('change');
  await se.page.waitForFunction(() => !/불러오는 중/.test(document.getElementById('today').textContent));
  await se.page.click('#schedBtn');
  await se.page.locator('#cal [data-d="30"]').waitFor();
  const seOver = await se.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(seOver <= 0, '작은 폰 가로 스크롤 ' + seOver + 'px');
  const ase = await open(browser, 'Admin.html', g, { device_: devices['iPhone SE'] });
  await ase.page.fill('#apin', '582941');
  await ase.page.click('#loginForm button');
  await ase.page.locator('#people .person').first().waitFor();
  await ase.page.click('[data-tab=set]');
  const aseOver = await ase.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(aseOver <= 0, '작은 폰 사장님 화면 가로 스크롤 ' + aseOver + 'px');
  await ase.page.screenshot({ path: path.join(OUT, '13-사장님-직원관리-SE.png'), fullPage: true });

  // 다크 모드 한 장
  const d = await open(browser, 'Index.html', g, { dark: true, device: PHONE['박준호'] });
  await d.page.getByRole('button', { name: '박준호' }).click();
  await d.page.getByText('오늘 근무').waitFor();
  assert.ok(!/출근 10:04/.test(await d.page.textContent('#today')), '비밀번호 없이는 출근 시각이 안 보여요');
  await d.page.fill('#pin', '432198');
  await d.page.locator('#pin').dispatchEvent('change');
  await d.page.getByText('출근 10:04').waitFor();
  await d.page.screenshot({ path: path.join(OUT, '7-직원-다크모드.png') });

  // ── 직원 텔레그램 알림 켜기 (사장님이 봇을 연결한 뒤) ──
  await s.page.reload();
  await seen(s, '#tgCard:not([hidden])');
  assert.equal(await s.page.textContent('#tgState'), '꺼짐');
  await s.page.click('#tgStart');
  await s.page.locator('#tgStep:not([hidden])').waitFor();
  const href = await s.page.getAttribute('#tgOpen', 'href');
  assert.match(href, /^https:\/\/t\.me\/goodphone_test_bot\?start=g[0-9a-f]{15}$/);
  await s.page.click('#tgCheck');
  await s.page.getByText('아직 연결 전이에요').waitFor();
  g.tg.updates.push({ update_id: 2, message: { chat: { id: 7001, type: 'private' }, text: '/start ' + href.split('start=')[1] } });
  await s.page.click('#tgCheck');
  await s.page.getByText('연결됐어요!').waitFor();
  assert.equal(await s.page.textContent('#tgState'), '켜짐');
  // [시험 알림 받기]: 바로 텔레그램으로
  assert.equal(await s.page.isVisible('#tgTest'), true);
  await s.page.click('#tgTest');
  await s.page.getByText('텔레그램으로 시험 알림을 보냈어요').waitFor();
  assert.ok(g.tg.sent.some((m) => String(m.chat_id) === '7001' && /시험 알림/.test(m.text)));
  // 다시 열면 오늘 출근 전 알림 안내(오늘은 이미 출근을 찍었어요)
  await s.page.reload();
  await seen(s, '#tgPre:not([hidden])');
  assert.match(await s.page.textContent('#tgPre'), /오늘은 알림 전에 출근을 찍어서/);
  await s.page.locator('#tgCard').screenshot({ path: path.join(OUT, '18-직원-텔레그램.png') });

  // ── 다음 달 휴무 고르기 (11/20~11/25) ──
  await setClock(g, '2026-11-20 10:00');
  await s.page.reload();
  await seen(s, '#wishBar:not([hidden])');
  assert.match(await s.page.textContent('#wishBar'), /12월 휴무 고르는 기간이에요/);
  await s.page.click('#wishGo');
  await s.page.locator('#cal [data-d="8"]').waitFor();
  assert.match(await s.page.getAttribute('#cal [data-d="25"]', 'class'), /hol/, '성탄절은 빨간 날');
  // 날짜를 누르면 화면에서만 바로 바뀌어요(서버를 안 불러요). 휴무·월차를 고르고 [저장]을 한 번 눌러요
  await s.page.click('#cal [data-d="8"]');
  await s.page.getByText('12/8(화) 휴무?를 골랐어요').waitFor();
  assert.match(await s.page.textContent('#cal [data-d="8"]'), /휴무\?/);
  assert.match(await s.page.getAttribute('#cal [data-d="8"]', 'class'), /pend/, '저장 전 표시');
  await s.page.click('#wishMode [data-mode="월차"]');
  await s.page.click('#cal [data-d="9"]');
  await s.page.getByText('12/9(수) 월차?를 골랐어요').waitFor();
  await s.page.click('#cal [data-d="10"]');
  await s.page.click('#cal [data-d="10"]'); // 한 번 더 누르면 빠져요
  assert.doesNotMatch(await s.page.textContent('#cal [data-d="10"]'), /월차/);
  assert.match(await s.page.textContent('#wishSaveText'), /휴무 1일 · 월차 1일/);
  // 기타: 종류(병가·경조사 등)와 이유를 정하고 날짜를 눌러요. 기타는 이유를 꼭
  await s.page.click('#wishMode [data-mode="기타"]');
  await s.page.locator('#wishKinds').waitFor();
  await s.page.fill('#wishWhy', '치과 수술');
  await s.page.click('#cal [data-d="15"]');
  await s.page.getByText('12/15(화) 병가?를 골랐어요(이유: 치과 수술)').waitFor();
  await s.page.click('#wishKinds [data-ekind="기타"]');
  assert.equal(await s.page.inputValue('#wishWhy'), '', '종류를 바꾸면 이유 칸이 비어요');
  await s.page.click('#cal [data-d="16"]');
  await s.page.getByText('기타는 이유를 먼저 적어주세요').waitFor();
  await s.page.fill('#wishWhy', '이사');
  await s.page.click('#cal [data-d="16"]');
  await s.page.getByText('12/16(수) 기타?를 골랐어요(이유: 이사)').waitFor();
  assert.match(await s.page.textContent('#wishSaveText'), /휴무 1일 · 월차 1일 · 병가 1일 · 기타 1일/);
  assert.match(await s.page.getAttribute('#cal [data-d="15"] .m', 'class'), /wishe/);
  assert.equal(g.gs.dayMark_('김민우', '2026-12-08'), '', '[저장] 전에는 휴무표에 안 들어가요');
  await s.page.locator('#schedCard').screenshot({ path: path.join(OUT, '15-직원-휴무고르기.png') });
  await s.page.click('#wishSaveGo');
  await s.page.getByText(/저장했어요: 12\/8\(화\) 휴무\?, 12\/9\(수\) 월차\?, 12\/15\(화\) 병가\?, 12\/16\(수\) 기타\?/).waitFor();
  assert.equal(await s.page.isVisible('#wishSave'), false);
  assert.match(await s.page.textContent('#schedSum'), /고른 휴무 1일.*고른 월차 1일.*고른 기타 2일/);
  g.gs.GRID_ = {};
  assert.equal(g.gs.dayMark_('김민우', '2026-12-08'), '휴무?');
  assert.equal(g.gs.dayMark_('김민우', '2026-12-09'), '월차?');
  assert.equal(g.gs.dayMark_('김민우', '2026-12-15'), '병가?');
  // 저장한 뒤 그 날을 누르면 내 이유가 보여요
  await s.page.click('#cal [data-d="15"]');
  await s.page.getByText('나: 병가? (사유: 치과 수술)').waitFor();
  // 같은 매장 박준호가 같은 날을 고르면 막혀요(하루 최대 1명)
  await pj.page.reload();
  await seen(pj, '#wishBar:not([hidden])');
  await pj.page.click('#wishGo');
  await pj.page.locator('#cal [data-d="8"]').waitFor();
  assert.match(await pj.page.textContent('#cal [data-d="8"]'), /1명/, '그날 쉬는 동료 수');
  await pj.page.click('#cal [data-d="8"]');
  await pj.page.getByText('12/8(화)은 이미 1명이 쉬어요(하루 최대 1명).').waitFor();
  // 사장님 화면 [휴무] 탭에서 확정
  await a.page.click('[data-tab=off]');
  await a.page.locator('#offStores .offrow').first().waitFor();
  assert.match(await a.page.textContent('#offStores'), /왕십리.*4건 확정.*김민우.*고름 8.*월차 고름 9.*기타 고름 15\(병가: 치과 수술\), 16\(기타: 이사\)/);
  await a.page.screenshot({ path: path.join(OUT, '17-사장님-휴무.png'), fullPage: true });
  assert.equal(await a.page.isVisible('#wishToday'), false, '고르는 기간에는 [오늘만 열기]가 안 보여요');
  await a.page.click('[data-confirm="왕십리"]');
  await a.page.getByText('왕십리 고른 날 4건을 확정했어요.').waitFor();
  g.gs.GRID_ = {};
  assert.equal(g.gs.dayMark_('김민우', '2026-12-15'), '병가');
  // 사장님 [근무표]: 칸을 눌러 사유와 같이 병가로 바꾸면, 밑줄과 함께 칸을 누를 때 사유가 보여요
  await a.page.click('[data-tab=grid]');
  const cell = a.page.locator('#gTable tr', { hasText: '김민우' }).locator('td[data-d="25"]');
  await cell.waitFor();
  await cell.click();
  await a.page.locator('#gPick:not([hidden])').waitFor();
  await a.page.fill('#gPickWhy', '독감');
  await a.page.click('#gPickBtns [data-mark="병가"]');
  await a.page.getByText(/병가로 바꿨어요/).waitFor();
  assert.equal(await cell.getAttribute('title'), '사유: 독감');
  assert.match(await cell.getAttribute('class'), /k-etc.*why|why/);
  await cell.click();
  await a.page.getByText(/지금: '병가' · 사유: 독감/).waitFor();
  assert.equal(await a.page.inputValue('#gPickWhy'), '독감');
  await a.page.click('#gPickClose');
  // 증빙 사진이 붙은 요청: 사장님 카드에 [증빙 보기] 링크
  g.gs.makeRequest({ name: '박준호', pin: '432198', kind: 'off', offType: '예비군', date: '2026-11-27', reason: '예비군 훈련', to: 'admin', device: PHONE['박준호'] });
  const pjReq = g.gs.readReqsNow_().find((q) => q.name === '박준호' && q.kind === '예비군');
  g.gs.reqProof('박준호', '432198', [pjReq.id], 'data:image/jpeg;base64,' + PNG1, PHONE['박준호']);
  await a.page.click('[data-tab=today]');
  await a.page.click('#refresh');
  const pjCard = a.page.locator('#reqs .rq', { hasText: '예비군 훈련' });
  await pjCard.waitFor();
  assert.match(await pjCard.locator('a', { hasText: '증빙 보기' }).getAttribute('href'), /^https:\/\/drive\.google\.com\/file\/d\//);
  await pjCard.screenshot({ path: path.join(OUT, '48-사장님-증빙카드.png') });
  g.gs.cancelRequest('박준호', '432198', pjReq.id);
  await a.page.click('[data-tab=off]');
  // 휴무표 만들기: 원하는 달을 바로
  await a.page.fill('#mkYm', '2027-01');
  await a.page.click('#mkMonth');
  await a.page.getByText("'27.01' 탭을 만들었어요").waitFor();
  assert.ok(g.sheet('27.01'));
  await a.page.screenshot({ path: path.join(OUT, '20-사장님-휴무표만들기.png'), fullPage: true });
  g.gs.GRID_ = {};
  assert.equal(g.gs.dayMark_('김민우', '2026-12-08'), '휴무');
  assert.equal(g.gs.dayMark_('김민우', '2026-12-09'), '월차', '고른 월차도 확정돼요');

  // ── 입사 등록: 점장이 보낸 링크(?join=왕십리&code=…)로 신입이 새 폰에서 직접 입력 → 사장님 [오늘]에서 승인 → 신입 폰에서 바로 출근 ──
  g.gs.adminSetJoinCode('582941', '4821');
  const jn = await open(browser, 'Index.html?join=' + encodeURIComponent('왕십리') + '&code=4821', g, { device: 'f6f6f6f6f6f6f6f6' });
  await seen(jn, '#joinCard:not([hidden])'); // 링크로 오면 양식이 바로 열려요
  assert.equal(await jn.page.inputValue('#jStore'), '왕십리', '링크의 지점이 골라져 있어요');
  assert.equal(await jn.page.inputValue('#jCode'), '4821', '링크의 입사 코드가 채워져 있어요');
  // 빈 채로 보내면 틀린 칸을 한꺼번에 알려줘요
  await jn.page.click('#jSend');
  await jn.page.getByText(/고칠 칸이 \d+개 있어요/).waitFor();
  assert.ok(await jn.page.locator('#joinForm .ferr').count() >= 6);
  assert.match(await jn.page.textContent('#joinForm'), /앞자리는 생년월일 6자리예요/);
  await jn.page.fill('#jName', '한신입');
  await jn.page.fill('#jRrn1', '950101');
  await jn.page.fill('#jRrn2', '1928374');
  await jn.page.click('#jRrnShow');
  assert.equal(await jn.page.getAttribute('#jRrn2', 'type'), 'text', '[보기]를 누르면 뒤 7자리가 잠깐 보여요');
  await jn.page.fill('#jPhone', '010-1234-5678');
  // 휴대폰이 두 개인 사람: 번호 추가(2개까지), 지우기
  await jn.page.click('#jPhoneAdd');
  await jn.page.click('#jPhoneAdd');
  assert.equal(await jn.page.isVisible('#jPhoneAdd'), false, '2개까지만');
  await jn.page.locator('#jPhones .xdel').nth(1).click();
  assert.equal(await jn.page.locator('#jPhones .xph').count(), 1);
  await jn.page.fill('#jPhones .xnum', '010-1111-2222');
  await jn.page.fill('#jPhones .xmemo', '업무용');
  await jn.page.fill('#jAddr', '서울 성동구 왕십리로 1');
  // 쓰던 내용 임시 저장: 새로고침해도(전화가 와서 앱이 닫혀도) 남아 있어요. 주민번호·비밀번호는 저장하지 않아요
  await jn.page.reload();
  await seen(jn, '#jDraft:not([hidden])');
  assert.equal(await jn.page.inputValue('#jAddr'), '서울 성동구 왕십리로 1');
  assert.equal(await jn.page.inputValue('#jRrn1'), '');
  assert.ok(!JSON.stringify(await jn.page.evaluate(() => Object.assign({}, localStorage))).includes('950101'), '주민번호는 폰에 저장하지 않아요');
  await jn.page.fill('#jRrn1', '950101');
  await jn.page.fill('#jRrn2', '1928374');
  await jn.page.fill('#jBank', '국민');
  await jn.page.fill('#jAccount', '123456-78-901234');
  await jn.page.fill('#jPin', '4826');
  await jn.page.fill('#jPin2', '4826');
  await jn.page.fill('#jEmergency', '010-9999-8888 어머니');
  await jn.page.click('#jSend');
  await jn.page.getByText('동의에 체크해야 보낼 수 있어요.').waitFor();
  assert.equal(await jn.page.locator('#joinForm .ferr').count(), 1, '남은 건 동의 하나');
  await jn.page.check('#jAgree');
  await jn.page.screenshot({ path: path.join(OUT, '24-입사등록.png'), fullPage: true });
  await jn.page.click('#jSend'); // 보내기 전 요약 확인 창은 [확인]
  await seen(jn, '#waitCard:not([hidden])');
  assert.equal(await jn.page.inputValue('#jRrn2'), '', '보낸 뒤 주민번호를 화면에서 지워요');
  assert.match(g.gs.hrFind_('한신입', '승인 대기').rrn, /^950101-1\*{6}$/);
  assert.equal(g.gs.hrFind_('한신입', '승인 대기').phone2, '010-1111-2222 업무용');
  await jn.page.reload();
  await seen(jn, '#waitCard:not([hidden])'); // 새로고침해도 기다리는 화면
  await a.page.click('[data-tab=today]');
  await a.page.click('#refresh');
  await seen(a, '#joinCard:not([hidden])');
  assert.match(await a.page.textContent('#joins'), /한신입 95년생/);
  // 자세히 보고 고치기: 쉬는 요일을 고르고 승인
  await a.page.click('#joins details summary');
  assert.match(await a.page.textContent('#joins .kvs'), /국민 끝자리 1234/);
  await a.page.check('#joins [data-joff="일"]');
  assert.equal(await a.page.isChecked('#joins [data-jfirst]'), false, '등록 시각을 출근으로 적기는 사장님이 골라야 해요');
  await a.page.locator('#joins').screenshot({ path: path.join(OUT, '32-사장님-입사승인-자세히.png') });
  await a.page.click('#refresh'); // 새로고침해도 고르던 칸이 그대로
  await a.page.waitForTimeout(400);
  assert.equal(await a.page.isChecked('#joins [data-joff="일"]'), true);
  await a.page.click('[data-join-ok="한신입"]');
  await a.page.getByText('한신입 님을 승인했어요').waitFor();
  assert.equal(g.gs.findStaff_('한신입').week[0], '휴무', '일요일 휴무로 정해졌어요');
  // 신입 폰: 기다리는 화면을 켜 두면 저절로 넘어가요(다른 앱에 갔다 오면 바로 확인)
  await jn.page.evaluate(() => document.dispatchEvent(new Event('visibilitychange')));
  await seen(jn, '#me:not([hidden])');
  await jn.page.getByText('승인됐어요!').waitFor();
  assert.equal(await jn.page.inputValue('#pin'), '4826', '정한 비밀번호를 기억해요');
  assert.equal(await jn.page.evaluate(() => localStorage.getItem('att:draft')), null, '승인되면 쓰던 내용은 지워요');
  // 입사 등록 때 출퇴근 확인(위치) 동의는 따로라서, 안 했으면 첫 출근 때 물어봐요
  assert.equal(await jn.page.isVisible('#agreeBox'), true, '위치 동의를 안 했으면 첫 출근 때 동의 칸이 보여요');
  await jn.page.click('#btnIn');
  await jn.page.getByText('아래 동의 칸에 체크해주세요').waitFor();
  await jn.page.check('#agree');
  await jn.page.click('#btnIn');
  await jn.page.getByText('출근 완료').waitFor();
  // 사장님 [설정]: 신입 안내 글에 주소·지점·입사 코드가 들어가요
  await a.page.click('[data-tab=set]');
  await a.page.selectOption('#jlStore', '가산');
  const guide = await a.page.inputValue('#jlText');
  assert.match(guide, /join=%EA%B0%80%EC%82%B0&code=4821/);
  assert.match(guide, /입사 코드: 4821/);
  await a.page.locator('#joinLinkCard').screenshot({ path: path.join(OUT, '33-사장님-신입안내글.png') });
  // 반려하면 신입 폰에 이유가 보여요
  const jr = await open(browser, 'Index.html?join=' + encodeURIComponent('가산') + '&code=4821', g, { device: 'a7a7a7a7a7a7a7a7' });
  await seen(jr, '#joinCard:not([hidden])');
  await jr.page.fill('#jName', '두신입');
  await jr.page.fill('#jRrn1', '960202');
  await jr.page.fill('#jRrn2', '2345678');
  await jr.page.fill('#jPhone', '010-7777-6666');
  await jr.page.fill('#jAddr', '서울 금천구 가산로 2');
  // 기존 직원(명단에 없어요) + 계좌가 없어요(현금, 언제까지)
  await jr.page.check('input[name=jkind][value=old]');
  assert.match(await jr.page.textContent('#jStartNote'), /처음 입사한 날/);
  await jr.page.check('#jCash');
  assert.equal(await jr.page.isDisabled('#jAccount'), true);
  assert.equal(await jr.page.isVisible('#wjCashUntil'), true, '언제까지 칸');
  await jr.page.click('#jSend');
  await jr.page.getByText('언제까지 현금으로 받는지(계좌를 만들어 알려줄 날) 골라주세요.').waitFor();
  await jr.page.fill('#jCashUntil', '2026-12-31');
  await jr.page.fill('#jPin', '5937');
  await jr.page.fill('#jPin2', '5937');
  await jr.page.fill('#jEmergency', '010-9999-8888 아버지');
  await jr.page.check('#jAgree');
  await jr.page.click('#jSend');
  await seen(jr, '#waitCard:not([hidden])');
  g.gs.MEMO_ = {};
  assert.equal(g.gs.hrFind_('두신입', '승인 대기').bank, '현금');
  assert.equal(g.gs.hrFind_('두신입', '승인 대기').cashUntil, '2026-12-31');
  // 사장님 [오늘] 입사 카드: 기존 직원·현금 표시
  await a.page.click('[data-tab=today]');
  await a.page.click('#refresh');
  const jcard = a.page.locator('#joins [data-jcard="두신입"]');
  await jcard.waitFor();
  assert.match(await jcard.textContent(), /기존 직원[\s\S]*현금 12\/31까지/);
  await jcard.screenshot({ path: path.join(OUT, '50-사장님-입사카드-현금.png') });
  g.gs.adminJoin('582941', '두신입', false, { reason: '이름을 주민등록증과 같게 적어주세요' });
  await jr.page.click('#waitCheck');
  await jr.page.getByText('입사 등록이 반려됐어요. 이유: 이름을 주민등록증과 같게 적어주세요').waitFor();
  assert.equal(await jr.page.inputValue('#jAddr'), '서울 금천구 가산로 2', '쓰던 내용으로 다시 보낼 수 있어요');
  await a.page.click('[data-tab=today]');

  // ── 이미 일하는 직원: 인사 정보 칸이 빠지면 출근 버튼 대신 안내 → 채우면 다시 출근 버튼 ──
  g.gs.MEMO_ = {};
  g.gs.hrWrite_(g.gs.hrFind_('김민우').row, { addr: '', emergency: '' });
  g.gs.MEMO_ = {};
  await s.page.reload();
  await seen(s, '#hrGate:not([hidden])');
  assert.match(await s.page.textContent('#hrGate'), /출근 전에 인사 정보를 다 넣어주세요[\s\S]*아직: 주소, 비상연락처[\s\S]*\[출근\]을 먼저 눌러 두세요/);
  assert.equal(await s.page.isVisible('#btnIn'), true, '비밀번호가 있는 직원은 [출근]을 눌러 둘 수 있어요(막히지만 처음 누른 시각을 기억해요)');
  assert.equal(await s.page.isVisible('#btnOut'), true, '퇴근 버튼은 그대로(그날 출근 기록을 닫을 때만 찍혀요)');
  await s.page.click('#hrGateGo');
  await seen(s, '#joinCard:not([hidden])');
  assert.equal(await s.page.isVisible('#wjName'), false, '이름·지점·비밀번호 칸은 숨겨요');
  await s.page.waitForFunction(() => document.getElementById('jPhone').value !== ''); // 있던 칸은 불러와요
  assert.equal(await s.page.getAttribute('#jStart', 'readonly'), '', '사장님이 정한 입사일은 못 고쳐요');
  await s.page.fill('#jRrn1', '900202');
  await s.page.fill('#jRrn2', '1357924');
  await s.page.fill('#jPhone', '01022223333');
  await s.page.fill('#jAddr', '서울 성동구');
  await s.page.fill('#jBank', '신한');
  await s.page.fill('#jAccount', '110-123-456789');
  await s.page.fill('#jEmergency', '010-8888-7777 형');
  await s.page.check('#jAgree');
  await s.page.click('#jSend');
  await seen(s, 'text=인사 정보를 저장했어요');
  await seen(s, '#me:not([hidden])');
  await s.page.waitForFunction(() => document.getElementById('hrGate').hidden && !document.getElementById('btnIn').hidden);

  // ── 사장님 [직원] 탭: 인사 카드 → 주민번호 전체 보기, 비고 저장, 연락처 저장, 지점 이동 ──
  await a.page.click('[data-tab=hr]');
  await seen(a, '#hrList .hrp');
  assert.match(await a.page.textContent('#hrList'), /한신입\s*95년생/);
  await a.page.screenshot({ path: path.join(OUT, '25-사장님-직원목록.png'), fullPage: true });
  await a.page.click('[data-hr="김민우"]');
  await seen(a, '#hrCard:not([hidden])');
  assert.equal(await a.page.inputValue('#hRrn'), '900202-1******');
  await a.page.fill('#hPhone2', '010-5555-6666 개인');
  await a.page.click('#hRrnShow');
  await a.page.waitForFunction(() => document.getElementById('hRrn').value === '900202-1357924');
  await a.page.fill('#hMemo', '보건증 2027-01 만료');
  await a.page.fill('#hProb', '2026-12-31'); // 수습 끝
  await a.page.click('#hSave');
  await a.page.getByText('저장했어요.').waitFor();
  assert.equal(g.gs.hrFind_('김민우').memo, '보건증 2027-01 만료');
  assert.equal(g.gs.hrFind_('김민우').probEnd, '2026-12-31');
  assert.match(await a.page.textContent('#hrMeta'), /수습 끝 2026-12-31/);
  assert.equal(await a.page.inputValue('#hProb'), '2026-12-31');
  assert.equal(g.gs.hrFind_('김민우').phone2, '010-5555-6666 개인');
  await a.page.click('#hContact');
  await seen(a, '#hContactOut a.btn');
  assert.match(await a.page.getAttribute('#hContactOut a', 'href'), /\?vcf=[0-9a-f-]{36}$/, '아이폰은 바로 여는 주소');
  assert.match(await a.page.textContent('#hContactOut'), /김민우 900202/);
  await a.page.screenshot({ path: path.join(OUT, '26-사장님-인사카드.png'), fullPage: true });
  await a.page.selectOption('#hMoveStore', '가산');
  await a.page.click('#hMove');
  await seen(a, 'text=가산(으)로 옮겼어요');
  assert.equal(g.gs.findStaff_('김민우').store, '가산');
  assert.match(await a.page.textContent('#hrMeta'), /왕십리→가산/);
  // 퇴사 예정(마지막 근무일이 앞날) → 취소 → 지난 날짜로 바로 퇴사 → 이번 달 퇴사자는 목록에 그대로 → 퇴사 취소
  const today = await a.page.inputValue('#hRetireDate');
  const later = today.slice(0, 8) + '28';
  await a.page.fill('#hRetireDate', later);
  await a.page.selectOption('#hRetireWhy', '자진 퇴사'); // 퇴사 사유는 꼭 골라요
  await a.page.click('#hRetire');
  await seen(a, '#hLeaving:not([hidden])');
  assert.match(await a.page.textContent('#hMsg'), /까지 근무하고 다음 날 자동으로 퇴사 처리돼요/);
  assert.match(await a.page.textContent('#hrMeta'), new RegExp('퇴사 예정: ' + later + '까지 근무'));
  assert.equal(g.gs.findStaff_('김민우').active, true);
  await a.page.screenshot({ path: path.join(OUT, '30-사장님-퇴사예정.png'), fullPage: true });
  await a.page.click('#hLeaveCancel');
  await a.page.getByText('퇴사 예정을 취소했어요.').waitFor();
  await a.page.fill('#hRetireDate', today.slice(0, 8) + '10');
  await a.page.selectOption('#hRetireWhy', '자진 퇴사');
  await a.page.click('#hRetire');
  await a.page.getByText(/퇴사 처리했어요\(마지막 근무일 11\/10/).waitFor();
  assert.equal(g.gs.findStaff_('김민우').active, false);
  assert.equal(await a.page.isVisible('#hGone'), true);
  await a.page.click('#hrBack');
  await a.page.locator('#hrList .grp', { hasText: '이번 달 퇴사' }).waitFor();
  assert.match(await a.page.textContent('#hrList'), /이번 달 퇴사[\s\S]*김민우/, '이번 달 퇴사자는 목록에 그대로 보여요');
  await a.page.screenshot({ path: path.join(OUT, '31-사장님-이번달퇴사.png'), fullPage: true });
  await a.page.click('[data-hr="김민우"]');
  await seen(a, '#hGone:not([hidden])');
  await a.page.click('#hUnretire');
  await a.page.getByText('퇴사를 취소했어요. 다시 앱 명단에 나와요.').waitFor();
  assert.equal(g.gs.findStaff_('김민우').active, true);
  // 입사 서류 체크 → 저장, 지점 이동 예약 → 취소, 휴직 넣기 → 취소
  await a.page.check('#hDocs input[value="근로계약서"]');
  await a.page.click('#hSave');
  await a.page.getByText('저장했어요.').waitFor();
  assert.equal(g.gs.hrFind_('김민우').docs, '근로계약서');
  assert.equal(await a.page.isChecked('#hDocs input[value="근로계약서"]'), true);
  await a.page.selectOption('#hMoveStore', '왕십리');
  await a.page.fill('#hMoveDate', later);
  await a.page.click('#hMove');
  await seen(a, '#hMoveDue:not([hidden])');
  assert.match(await a.page.textContent('#hrMeta'), new RegExp('이동 예정: ' + later + '부터 왕십리'));
  assert.equal(g.gs.findStaff_('김민우').store, '가산', '예약만 하고 아직 안 옮겼어요');
  await a.page.fill('#hAwayFrom', today.slice(0, 8) + '22');
  await a.page.fill('#hAwayTo', today.slice(0, 8) + '25');
  await a.page.fill('#hAwayWhy', '병가');
  await a.page.click('#hAway');
  await seen(a, '#hAwayNow:not([hidden])');
  assert.match(await a.page.textContent('#hrMeta'), /휴직 예정: 2026-11-22 ~ 2026-11-25 \(병가\)/);
  assert.equal(g.gs.dayMark_('김민우', '2026-11-23'), '휴직');
  await a.page.screenshot({ path: path.join(OUT, '39-사장님-이동예약-휴직.png'), fullPage: true });
  await a.page.click('#hAwayEnd');
  await a.page.getByText('휴직을 취소했어요.').waitFor();
  await a.page.click('#hMoveCancel');
  await a.page.getByText(/지점 이동 예약\(.*왕십리\)을 취소했어요/).waitFor();
  assert.equal(await a.page.isVisible('#hMoveDue'), false);
  await ase.page.click('[data-tab=hr]');
  await seen(ase, '#hrList .hrp');
  const hrOver = await ase.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  assert.ok(hrOver <= 0, '작은 폰 [직원] 탭 가로 스크롤 ' + hrOver + 'px');

  // ── 앱 시작일: 시작 전으로 되돌리면 맨 위에 안내가 뜨고, 오늘부터로 하면 사라져요 ──
  await a.page.click('[data-tab=set]');
  assert.match(await a.page.textContent('#startState'), /2026-11-01부터 시작했어요/);
  await a.page.click('#startClear');
  await a.page.getByText('시작 전으로 되돌렸어요').waitFor();
  assert.equal(await a.page.isVisible('#notStarted'), true);
  assert.match(await a.page.textContent('#notStarted'), /아직 앱 시작 전이에요/);
  assert.equal(g.gs.settings_().startDate, '');
  await a.page.screenshot({ path: path.join(OUT, '27-사장님-앱시작일.png'), fullPage: true });
  // ── 예전 휴무표 가져오기(시작 전): 주소 붙여넣기 → 미리 보기 → 가져오기 → 퇴사자 1년 보기 ──
  const OLD_ID = 'OLDFILE_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  g.addBook(OLD_ID, { 휴무표: [].concat(
    oldBlock(2026, 9, [
      { store: '왕십리', name: '김민우', days: { 2: '휴무', 7: '11:8', 15: '8월차', 24: '추석' } },
      { store: '왕십리', name: '옛직원', days: { 3: '휴무', 20: '가산', 28: '퇴사' } },
      { store: '아라', name: '이지은', days: { 9: '휴무' } },
    ]),
    oldBlock(2026, 10, [
      { store: '왕십리', name: '김민우', days: { 6: '휴무', 14: '9월차' } },
      { store: '가산', name: '이지은', days: { 8: '휴뮤', 21: '무급' } },
    ]),
    oldBlock(2026, 11, [{ store: '왕십리', name: '김민우', days: { 28: '휴무' } }]),
  ) }, '예전 굳폰 파일');
  await a.page.fill('#impSrc', 'https://docs.google.com/spreadsheets/d/' + OLD_ID + '/edit#gid=0');
  await a.page.click('#impPreview');
  await a.page.getByText('미리 보기예요').waitFor();
  const impText = await a.page.textContent('#impView');
  assert.match(impText, /예전 굳폰 파일/);
  assert.match(impText, /새 탭/);
  assert.match(impText, /올해 거쳐 간 사람 3명/);
  assert.match(impText, /아라→검단/);
  assert.ok(!g.sheet('26.10'), '미리 보기는 탭을 안 만들어요');
  await a.page.locator('#importCard').screenshot({ path: path.join(OUT, '28-사장님-예전휴무표-미리보기.png') });
  await a.page.click('#impRun');
  await a.page.getByText('다 가져왔어요').waitFor();
  assert.ok(g.sheet('26.09') && g.sheet('26.10'));
  assert.match(await a.page.textContent('#impView'), /가져오기 끝!/);
  assert.match(await a.page.textContent('#impLast'), /마지막으로 가져온 때/);
  await a.page.locator('#importCard').screenshot({ path: path.join(OUT, '29-사장님-예전휴무표-끝.png') });
  // 퇴사자(예전 휴무표에만 있는 사람)도 1년 보기에서 골라 볼 수 있어요
  await a.page.click('[data-tab=month]');
  await a.page.selectOption('#yrName', '옛직원');
  await a.page.click('#yrGo');
  await a.page.getByText(/옛직원 \(왕십리, 퇴사\) 2026년 · 지원 1번\(가산 1\)/).waitFor();
  await a.page.click('[data-tab=set]');

  await a.page.click('#startToday');
  await a.page.getByText(/시작일을 2026-11-\d\d로 정했어요/).waitFor();
  assert.equal(await a.page.isVisible('#notStarted'), false);

  // 월 마감: (가져오기로 생긴) 지난달 10월로 가서 마감 → 마감 취소. '결근?'이 남아 있으면 한 번 더 물어보는데, 화면 확인은 모두 '확인'을 눌러요
  await a.page.click('[data-tab=month]');
  await a.page.click('#prev');
  await seen(a, '#closeBtn:not([hidden])');
  assert.match(await a.page.textContent('#closeBtn'), /10월 마감하기/);
  await a.page.click('#closeBtn');
  await a.page.getByText(/10월을 마감했어요/).waitFor();
  assert.equal(g.gs.isClosed_('2026-10'), true);
  assert.equal(await a.page.isVisible('#closeBadge'), true);
  assert.equal(await a.page.isVisible('#issueActs'), false, '마감한 달은 결근? 정리 단추가 안 보여요');
  assert.ok(g.sheet('월 마감 2026'), '장부 탭이 생겨요');
  await a.page.locator('#issueCard').screenshot({ path: path.join(OUT, '40-사장님-월마감.png') });
  await a.page.click('#openBtn');
  await a.page.getByText(/10월 마감을 취소했어요/).waitFor();
  assert.equal(g.gs.isClosed_('2026-10'), false);
  await a.page.click('#next');

  // 휴무 바꾸기 요청 카드(사장님 화면) → 거절
  g.gs.makeRequest({ name: '김민우', pin: '0123', kind: 'move', dateFrom: '2026-11-28', date: '2026-11-24', reason: '가족 모임', to: 'admin' });
  await a.page.click('[data-tab=today]');
  await a.page.click('#refresh');
  await a.page.locator('#reqCard:not([hidden])').waitFor();
  assert.match(await a.page.textContent('#reqs'), /휴무 바꾸기[\s\S]*김민우[\s\S]*11\/24\(화\) [\d:-]+ 근무를 쉬고, 대신 11\/28 쉬는 날에 출근하고 싶어요/);
  await a.page.locator('[data-rq-no]').first().click();
  await a.page.waitForFunction(() => document.getElementById('reqCard').hidden);

  // 공지: 사장님이 올리면 직원 화면 맨 위에 보이고, [확인했어요]를 누르면 누가 읽었는지 남아요
  await a.page.fill('#nText', '토요일은 재고 조사라\n30분 일찍 출근해 주세요.');
  await a.page.click('#nSend');
  await a.page.getByText(/공지를 올렸어요\(전체\)/).waitFor();
  assert.match(await a.page.textContent('#nList'), /읽음 0\/\d+/);
  await s.page.reload();
  await seen(s, '#noticeBar:not([hidden])');
  assert.match(await s.page.textContent('#noticeBar'), /토요일은 재고 조사라/);
  await s.page.screenshot({ path: path.join(OUT, '42-직원-공지.png') });
  await s.page.click('[data-nread]');
  await s.page.locator('#noticeBar details').waitFor();
  assert.match(g.sheet('공지').rowDisplay(2)[5], /^김민우 \d\d\/\d\d \d\d:\d\d$/);
  await a.page.click('#refresh');
  await a.page.locator('#nList', { hasText: '읽음 1/' }).waitFor();
  await a.page.locator('#noticeCard').screenshot({ path: path.join(OUT, '43-사장님-공지.png') });

  // 일찍 보냄(조퇴 아님): 근무 중인 직원 줄의 버튼 → 오늘 예정 퇴근이 지금 시각이 돼요(점장 화면에는 없어요)
  const tl = JSON.parse(JSON.stringify(g.gs.adminToday('582941'))).list;
  let wk = tl.find((p) => p.status === '근무중');
  if (!wk) { wk = tl.find((p) => !p.tIn && p.sIn && p.status !== '휴무'); g.gs.proxyPunch('582941', wk.name, 'in', '화면 확인'); }
  const nowT = g.gs.nowKst_().time;
  await a.page.click('[data-tab=today]');
  await a.page.click('#refresh');
  await a.page.locator(`[data-early="${wk.name}"]`).waitFor();
  await a.page.click(`[data-early="${wk.name}"]`);
  await a.page.locator('#people', { hasText: '~' + nowT }).waitFor();
  assert.equal(await m.page.locator('[data-early]').count(), 0, '점장 화면에는 일찍 보냄 단추가 없어요');

  // ── 빠르게 열기 ──
  // 사장님 화면: '이 폰에서 기억하기'를 켠 폰은 다시 열 때 마지막 [오늘]을 먼저 보여 주고(누르는 건 잠깐 막아요), 최신 내용이 오면 바꿔요
  const fa = await open(browser, 'Admin.html', g);
  await fa.page.check('#aremember');
  await fa.page.fill('#apin', '582941');
  await fa.page.click('#loginForm button');
  await fa.page.locator('#people .person').first().waitFor();
  assert.match(await fa.page.textContent('#perfLine'), /불러오는 데 \d+\.\d초 \(서버 \d+\.\d초\)/, '걸린 시간이 보여요');
  assert.ok(await fa.page.evaluate(() => !!localStorage.getItem('att:admToday')), '[오늘]을 기억해 둬요');
  await fa.page.evaluate(() => localStorage.setItem('__slow:adminToday', '2500'));
  await fa.page.reload();
  await fa.page.locator('#staleBar:not([hidden])').waitFor({ timeout: 2000 });
  assert.ok((await fa.page.locator('#people .person').count()) > 0, '서버가 답하기 전에 마지막 내용이 보여요');
  assert.equal(await fa.page.evaluate(() => document.body.classList.contains('stale')), true, '그동안 누르는 건 막아요');
  await fa.page.locator('#staleBar').waitFor({ state: 'hidden', timeout: 8000 });
  assert.equal(await fa.page.evaluate(() => document.body.classList.contains('stale')), false, '최신 내용이 오면 풀려요');
  await fa.page.evaluate(() => localStorage.removeItem('__slow:adminToday'));
  // 직원 화면: 지난번에 받은 이름 목록으로 바로 내 화면을 열고, 내 오늘 기록과 이름 목록을 동시에 받아요
  const fs2 = await open(browser, 'Index.html', g, { device: PHONE['김민우'] });
  await fs2.page.getByRole('button', { name: '김민우' }).click();
  await fs2.page.locator('#me:not([hidden])').waitFor();
  await fs2.page.evaluate(() => localStorage.setItem('__slow:getStaffList', '3000'));
  await fs2.page.reload();
  await fs2.page.locator('#me:not([hidden])').waitFor({ timeout: 2500 });
  assert.match(await fs2.page.textContent('#who'), /김민우/, '이름 목록을 다시 받기 전에 내 화면이 열려요');
  await fs2.page.evaluate(() => localStorage.removeItem('__slow:getStaffList'));

  // ── 직원 코드: 정하면 링크만으로는 이름 목록이 안 보여요(등록된 폰은 바로) ──
  await fa.page.click('[data-tab=today]');
  await fa.page.click('#refresh');
  await fa.page.locator('#noStaffCode:not([hidden])').waitFor();
  await fa.page.click('[data-tab=set]');
  await fa.page.fill('#scCode', '7392');
  await fa.page.click('#scSave');
  await fa.page.getByText('직원 코드를 7392(으)로 정했어요').waitFor();
  assert.equal(await fa.page.isVisible('#noStaffCode'), false);
  // 모르는 폰: 이름 목록 대신 코드 넣기
  const lk = await open(browser, 'Index.html', g, { device: 'e9e9e9e9e9e9e9e9' });
  await seen(lk, '#lockCard:not([hidden])');
  assert.equal(await lk.page.isVisible('#pick'), false);
  assert.equal(await lk.page.locator('#names button').count(), 0, '이름이 화면에 없어요');
  await lk.page.screenshot({ path: path.join(OUT, '51-직원-직원코드.png'), fullPage: true });
  await lk.page.fill('#scode', '1111');
  await lk.page.click('#scodeGo');
  await lk.page.getByText('직원 코드가 달라요').waitFor();
  await lk.page.fill('#scode', '7392');
  await lk.page.click('#scodeGo');
  await lk.page.getByRole('button', { name: '김민우' }).waitFor();
  await lk.page.reload();
  await lk.page.getByRole('button', { name: '김민우' }).waitFor(); // 한 번 넣으면 이 폰은 기억해요
  assert.equal(await lk.page.isVisible('#lockCard'), false);
  await lk.page.close();
  // 등록된 폰(김민우): 코드 없이 바로 내 화면
  const reg = await open(browser, 'Index.html', g, { device: PHONE['김민우'] });
  await reg.page.locator('#me:not([hidden])').waitFor();
  assert.match(await reg.page.textContent('#who'), /김민우/);
  await reg.page.close();
  // 코드가 없는 폰에서도 [새로 입사했어요]로 입사 등록은 돼요(입사 코드가 따로 있어요)
  const lj = await open(browser, 'Index.html', g, { device: 'e8e8e8e8e8e8e8e8' });
  await seen(lj, '#lockCard:not([hidden])');
  await lj.page.click('#lockJoin');
  await seen(lj, '#joinCard:not([hidden])');
  await lj.page.close();

  // 가로 스크롤이 생기면 안 돼요
  for (const x of [s, far, pj, a, d, m, jn, jr]) {
    const overflow = await x.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    assert.ok(overflow <= 0, '가로 스크롤 ' + overflow + 'px');
  }
  const errs = [s, far, pj, nw, np, kakao, a, se, ase, d, m, tt, jn, jr, fa, fs2].flatMap((x) => x.errors);
  assert.deepEqual(errs, [], '브라우저 오류: ' + errs.join('\n'));

  await browser.close();
  srv.close();
  console.log('화면 확인 통과. 캡처:', OUT);
})().catch((e) => { console.error(e); process.exit(1); });
