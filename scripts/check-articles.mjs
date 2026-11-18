#!/usr/bin/env node
// 기사 데이터 검사기 — data/articles.js 가 CURATION.md 규칙을 지키는지 확인해요.
// 사용법: node scripts/check-articles.mjs        (오류가 있으면 종료 코드 1)
//        node scripts/check-articles.mjs --today 2026-11-18   (오늘 날짜를 직접 정할 때)
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const file = join(root, 'data', 'articles.js');
const errors = [], warnings = [];
const err = (id, msg) => errors.push(`[${id}] ${msg}`);
const warn = (id, msg) => warnings.push(`[${id}] ${msg}`);

// ---- 규칙 ----
// 분야: 과학·우주, IT·AI, 환경·날씨, 동물·자연, 사회, 교육, 경제, 세계, 어린이, 역사, 문화·예술, 스포츠
const CATEGORIES = ['science', 'tech', 'env', 'nature', 'society', 'school', 'economy', 'world', 'kids', 'history', 'culture', 'sports'];
const LEVELS = ['1-6', '3-6', '5-6'];
const MAX_ARTICLES = 60;
const FIRST_BATCH = '2026-11-17'; // 처음 한꺼번에 실은 기사들은 '3일 안' 규칙에서 빼요
// 어린이 기사에 절대 나오면 안 되는 낱말 (나오면 오류)
const BANNED = ['살인', '살해', '시신', '사망자', '숨진', '숨졌', '자살', '극단적 선택', '자해', '성폭행', '성추행', '성범죄', '성착취', '음란',
  '마약', '도박', '음주운전', '흉기', '총격', '총기', '폭탄', '테러', '참수', '고문', '학살', '유괴', '납치', '스토킹'];
// 나오면 검토 메모(review.note)에 까닭을 꼭 적어야 하는 낱말 (경고)
const CAREFUL = ['학대', '폭행', '폭력', '전쟁', '사고', '부상', '범죄', '체포', '구속', '재판', '선거', '탄핵', '정당', '음주', /(^|[^가-힣])술(?=[을이은도과\s,.]|$)/, '담배', '사기', '재난', '지진', '화재', '피해'];

// ---- 읽기 ----
let data;
try {
  const ctx = { window: {} };
  vm.createContext(ctx);
  vm.runInContext(readFileSync(file, 'utf8'), ctx, { filename: 'data/articles.js' });
  data = ctx.window.NEWS_DATA;
} catch (e) {
  console.error('data/articles.js 를 읽지 못했어요:', e.message);
  process.exit(1);
}
if (!data || !Array.isArray(data.articles)) { console.error('window.NEWS_DATA.articles 배열이 없어요.'); process.exit(1); }

const argToday = process.argv.indexOf('--today');
const today = argToday > -1 ? process.argv[argToday + 1]
  : new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10); // 한국 시간 기준 오늘
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(s || '') && !Number.isNaN(Date.parse(s + 'T00:00:00Z'));
const days = (a, b) => Math.round((Date.parse(a + 'T00:00:00Z') - Date.parse(b + 'T00:00:00Z')) / 86400e3);

// 문장 나누기 (사이트와 같은 규칙: 따옴표 안의 문장부호는 문장 끝으로 보지 않음)
function sentences(text) {
  const out = [];
  String(text || '').split(/\n+/).forEach(line => {
    line = line.trim(); if (!line) return;
    let buf = '', q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i]; buf += ch;
      if (ch === '"' || ch === '“' || ch === '”') q = ch === '“' ? true : ch === '”' ? false : !q;
      if (!q && '.?!'.includes(ch) && (i === line.length - 1 || line[i + 1] === ' ')) { out.push(buf.trim()); buf = ''; }
    }
    if (buf.trim()) out.push(buf.trim());
  });
  return out;
}

if (!isDate(data.updated)) err('전체', `updated 날짜 형식이 틀렸어요: ${data.updated}`);
if (data.articles.length > MAX_ARTICLES) err('전체', `기사가 ${data.articles.length}개예요. 오래된 기사를 지워 ${MAX_ARTICLES}개 이하로 맞춰 주세요.`);

const ids = new Set(), urls = new Set(), titles = new Set();
for (const a of data.articles) {
  const id = a.id || '(id 없음)';
  if (!/^r\d{4}-[a-z0-9-]+$/.test(a.id || '')) err(id, 'id는 r월일-영문 꼴이어야 해요. 예: r1118-moon');
  if (ids.has(a.id)) err(id, 'id가 겹쳐요.'); ids.add(a.id);
  if (!CATEGORIES.includes(a.category)) err(id, `분야(category)가 틀렸어요: ${a.category}`);
  if (!LEVELS.includes(a.level)) err(id, `추천 학년(level)은 ${LEVELS.join(', ')} 중 하나예요.`);
  for (const k of ['source', 'origTitle', 'title', 'excerpt', 'body', 'think']) if (!String(a[k] || '').trim()) err(id, `${k}가 비어 있어요.`);
  if (!/^https:\/\//.test(a.url || '')) err(id, '원문 주소(url)는 https:// 로 시작해야 해요.');
  if (urls.has(a.url)) err(id, '같은 원문 기사가 두 번 들어 있어요.'); urls.add(a.url);
  if (titles.has(a.title)) err(id, '제목이 겹쳐요.'); titles.add(a.title);
  if (!isDate(a.date)) err(id, `보도 날짜(date) 형식이 틀렸어요: ${a.date}`);
  else if (days(a.date, today) > 0) err(id, `보도 날짜가 오늘(${today})보다 뒤예요.`);
  if (!isDate(a.added)) err(id, `실은 날짜(added) 형식이 틀렸어요: ${a.added}`);
  else if (isDate(a.date) && a.added > FIRST_BATCH && days(a.added, a.date) > 3) err(id, '새로 싣는 기사는 보도된 지 3일 안의 기사여야 해요.');

  // 글 길이와 문장
  if ((a.title || '').length > 34) err(id, `제목이 너무 길어요 (${a.title.length}자, 34자 이하).`);
  if ((a.excerpt || '').length > 70) err(id, `요약(excerpt)이 너무 길어요 (${a.excerpt.length}자, 70자 이하).`);
  const sents = sentences(a.body);
  const len = (a.body || '').replace(/\s/g, '').length;
  if (sents.length < 5 || sents.length > 13) err(id, `본문 문장이 ${sents.length}개예요 (5~13개).`);
  if (len > 700) err(id, `본문이 너무 길어요 (공백 빼고 ${len}자, 700자 이하).`);
  const paras = (a.body || '').split(/\n\n+/).length;
  if (paras < 2 || paras > 4) err(id, `본문 문단이 ${paras}개예요 (2~4개).`);
  const longSent = sents.find(s => s.length > 120);
  if (longSent) warn(id, `아주 긴 문장이 있어요: ${longSent.slice(0, 40)}…`);

  // 어린이에게 알맞은지
  const allText = [a.title, a.excerpt, a.body, ...(a.fo || []).map(f => f.text), ...(a.quiz || []).map(q => q.question + ' ' + (q.options || []).join(' '))].join(' ');
  for (const w of BANNED) if (allText.includes(w)) err(id, `어린이 기사에 쓰면 안 되는 낱말이 있어요: "${w}"`);
  const careful = CAREFUL.filter(w => (w instanceof RegExp ? w.test(allText) : allText.includes(w))).map(w => (w instanceof RegExp ? '술' : w));
  if (careful.length && !(a.review && a.review.note && a.review.note.length > 10)) err(id, `조심할 낱말(${careful.join(', ')})이 있어요. review.note에 실어도 되는 까닭을 적어 주세요.`);
  else if (careful.length) warn(id, `조심할 낱말이 있어요: ${careful.join(', ')} → 검토 메모: ${a.review.note}`);

  // 낱말
  if (!Array.isArray(a.words) || a.words.length < 3 || a.words.length > 5) err(id, '핵심 낱말(words)은 3~5개예요.');
  for (const w of a.words || []) {
    if (!w.word || !w.meaning) err(id, '낱말에 word와 meaning이 모두 있어야 해요.');
    else if (!(a.body || '').includes(w.word)) err(id, `낱말 "${w.word}"이(가) 본문에 그대로 나오지 않아요.`);
    if (w.meaning && !/요\.$/.test(w.meaning.trim())) warn(id, `낱말 뜻은 '~요.'로 끝내 주세요: ${w.word}`);
  }
  // 사실과 의견
  const fo = a.fo || [];
  if (fo.length < 4 || fo.length > 6) err(id, '사실·의견 문장(fo)은 4~6개예요.');
  if (fo.filter(f => f.type === 'fact').length < 2) err(id, '사실 문장이 2개 이상 있어야 해요.');
  if (fo.filter(f => f.type === 'opinion').length < 1) err(id, '의견 문장이 1개 이상 있어야 해요.');
  for (const f of fo) {
    if (!['fact', 'opinion'].includes(f.type)) err(id, `fo.type은 fact 또는 opinion이에요: ${f.type}`);
    if (!f.text || !f.reason) err(id, 'fo 문장에 text와 reason이 모두 있어야 해요.');
  }
  // 퀴즈
  if (!Array.isArray(a.quiz) || a.quiz.length !== 3) err(id, '내용 퀴즈(quiz)는 정확히 3문제예요.');
  for (const q of a.quiz || []) {
    if (!q.question || !Array.isArray(q.options) || q.options.length !== 4) err(id, '퀴즈마다 질문과 보기 4개가 있어야 해요.');
    if (!(Number.isInteger(q.answer) && q.answer >= 0 && q.answer <= 3)) err(id, '퀴즈 answer는 0~3이에요.');
    if (new Set(q.options || []).size !== (q.options || []).length) err(id, `퀴즈 보기가 겹쳐요: ${q.question}`);
    if (!q.explanation) err(id, '퀴즈 해설(explanation)이 없어요.');
  }
  // 검토 기록
  if (!a.review || a.review.ok !== true || !isDate(a.review.date) || !String(a.review.note || '').trim()) err(id, 'review {date, ok:true, by, note} 검토 기록이 필요해요.');
}

const newest = data.articles.reduce((m, a) => (a.added > m ? a.added : m), '');
if (newest && data.updated !== newest) warn('전체', `updated(${data.updated})가 가장 최근에 실은 날짜(${newest})와 달라요.`);
const cats = {};
data.articles.forEach(a => { cats[a.category] = (cats[a.category] || 0) + 1; });

console.log(`기사 ${data.articles.length}개 · 분야별 ${JSON.stringify(cats)} · 최근 업데이트 ${data.updated} · 오늘 ${today}`);
if (warnings.length) console.log('\n경고 ' + warnings.length + '개\n- ' + warnings.join('\n- '));
if (errors.length) { console.log('\n오류 ' + errors.length + '개\n- ' + errors.join('\n- ')); process.exit(1); }
console.log('\n검사 통과');
