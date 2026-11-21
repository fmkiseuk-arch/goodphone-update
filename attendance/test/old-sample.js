// 테스트용 '예전 휴무표' 모양 만들기(가짜 이름으로). 진짜 예전 파일과 같은 칸 배치예요:
// 달마다 머리글 2줄 + 사람 줄, 사이에 빈 줄 2개. A No, B 계약서, C 달, D 이월, E 잔여, F 부여, G 매장명, H 이름, I~M 집계, N~ 1일~31일, 그 뒤 메모
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

/** people: [{store, name, days: {3: '휴무', 5: '11:8'}, memo}] */
function oldBlock(year, m, people) {
  const n = new Date(Date.UTC(year, m, 0)).getUTCDate();
  const h1 = ['', '', '', '작년', '잔여', '부여', '매장명', '이름', '휴무', '월차', '지각', '', '아웃'];
  const h2 = ['No.', '계약서', '월', '이월', '월차', '월차', '매장명', '이름', '휴무', '월차', '지각', '', '아웃'];
  for (let d = 1; d <= 31; d++) {
    h1.push(d <= n ? m + '-' + d : '');
    h2.push(d <= n ? DOW[new Date(Date.UTC(year, m - 1, d)).getUTCDay()] : '');
  }
  const rows = [h1, h2];
  people.forEach((p, i) => {
    const r = [String(i + 1), '', m + '월', '', '', '1', p.store, p.name, '', '', '', '', ''];
    for (let d = 1; d <= 31; d++) r.push((p.days && p.days[d]) || '');
    r.push(p.memo || '');
    rows.push(r);
  });
  rows.push([], []);
  return rows;
}

module.exports = { oldBlock };
