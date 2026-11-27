// 한 파일 버전 만들기: Code.gs + Index.html + Admin.html → dist/Code.gs
// Apps Script에 이 파일 하나만 붙여넣으면 돼요.
// 실행: node attendance/build.js
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// 코드 버전: 세 파일 내용으로 만든 짧은 번호(내용이 같으면 늘 같은 번호). Code.gs 의 var CODE_VER = 'dev'; 자리에 넣어요.
// 사장님 화면이 '시트에 붙여넣은 코드'와 '웹 앱(배포한 버전)'이 다른지 알아보는 데 써요.
const VER_RE = /^var CODE_VER = '[^'\n]*';/m;
function codeVersion(code, index, admin) {
  const h = crypto.createHash('sha256');
  [code.replace(VER_RE, ''), index, admin].forEach((s) => h.update(s + '\0'));
  return h.digest('hex').slice(0, 8);
}

/*
 * 붙여넣을 파일을 줄여요: 줄 맨 앞에서 시작하는 설명 주석(// …, /* … *\/)만 빼요.
 * 1MB가 넘으면 깃허브·앱 화면에서 뒷부분이 잘려서, 붙여넣을 때 '구문 오류'가 나요(2026-11-27).
 * 코드 뒤에 붙은 주석은 그대로 둬요(문자열 안의 // 와 헷갈리지 않게). @OnlyCurrentDoc 같은 Apps Script 표시는 남겨요.
 * Code.gs 는 ES5(문자열이 줄을 넘지 않아요)라서 줄 맨 앞의 // · /* 는 늘 주석이에요. 백틱(`)이 생기면 멈춰요.
 */
function slim(code) {
  if (code.indexOf('`') >= 0) throw new Error('Code.gs 에 백틱(`)이 있어요. 여러 줄 문자열이 생기면 slim()이 주석을 잘못 뺄 수 있어서 멈췄어요.');
  const KEEP = /@(OnlyCurrentDoc|NotOnlyCurrentDoc|customfunction)\b/;
  const lines = code.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const t = line.trimStart();
    if (t.startsWith('//')) {
      if (KEEP.test(t)) out.push(line);
      continue;
    }
    if (!t.startsWith('/*')) { out.push(line); continue; }
    // 줄 맨 앞에서 시작하는 블록 주석: */ 가 나오는 줄까지
    const start = i;
    let rest = t.slice(2);
    let k = rest.indexOf('*/');
    while (k < 0 && i + 1 < lines.length) { i++; rest = lines[i]; k = rest.indexOf('*/'); }
    if (k < 0) throw new Error('닫히지 않은 주석: Code.gs ' + (start + 1) + '번째 줄');
    if (KEEP.test(lines.slice(start, i + 1).join('\n'))) { out.push.apply(out, lines.slice(start, i + 1)); continue; }
    const after = rest.slice(k + 2);
    if (after.trim()) out.push(after); // */ 뒤에 코드가 있으면 남겨요
  }
  return out.join('\n');
}

/* 화면 HTML을 짧은 줄 여러 개로: 한 줄이 15만 글자면 복사·붙여넣기 중에 잘리기 쉬워요. 40줄씩 묶어서 + 로 이어요 */
function pageLit(html) {
  const lines = html.split('\n');
  const parts = [];
  for (let i = 0; i < lines.length; i += 40) {
    const chunk = lines.slice(i, i + 40).join('\n') + (i + 40 < lines.length ? '\n' : '');
    parts.push(JSON.stringify(chunk));
  }
  return parts.join(' +\n    ');
}

function bundle() {
  const dir = __dirname;
  const read = (f) => fs.readFileSync(path.join(dir, f), 'utf8');
  const head = [
    '/**',
    ' * 굳폰 출퇴근 — 한 파일 버전 (자동으로 만든 파일이에요. 고칠 땐 attendance/ 의 원본을 고치고 node attendance/build.js)',
    ' *',
    ' * 쓰는 법: 구글 시트 → 확장 프로그램 → Apps Script → 원래 있던 내용을 지우고 이 파일 전체를 붙여넣기',
    ' *        → 저장 → 위쪽에서 setup 고르고 ▶ 실행(권한 허용) → 배포 → 새 배포 → 웹 앱',
    ' *          (실행: 나 / 액세스: 모든 사용자) → 배포 → 나온 주소가 직원 화면, 주소 뒤에 ?page=admin 이 사장님 화면',
    ' */',
    '',
  ].join('\n');
  const code = read('Code.gs'), index = read('Index.html'), admin = read('Admin.html');
  if (!VER_RE.test(code)) throw new Error("Code.gs 에 var CODE_VER = 'dev'; 줄이 없어요(코드 버전을 넣을 곳)");
  const ver = codeVersion(code, index, admin);
  const stamped = slim(code).replace(VER_RE, "var CODE_VER = '" + ver + "';");
  const pages = 'var PAGES = {\n  Index:\n    ' + pageLit(index) + ',\n  Admin:\n    ' + pageLit(admin) + ',\n};\n';
  // 맨 끝 줄: 붙여넣은 뒤 이 줄이 보이면 끝까지 다 들어간 거예요
  return head + stamped + '\n/* ───────────── 화면 HTML (Index.html, Admin.html 를 그대로 담음) ───────────── */\n' + pages +
    '// ───── 여기가 끝이에요 (코드 버전 ' + ver + ') ─────\n';
}

module.exports = { bundle, codeVersion, slim };

if (require.main === module) {
  const out = path.join(__dirname, 'dist', 'Code.gs');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, bundle());
  const ver = (/^var CODE_VER = '([^']*)';/m.exec(fs.readFileSync(out, 'utf8')) || [])[1];
  console.log('만들었어요:', out, fs.statSync(out).size + ' bytes · 코드 버전 ' + ver);
}
