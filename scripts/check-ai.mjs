#!/usr/bin/env node
// 미리 만든 AI 읽기 도우미 자료 검사기 — data/ai/<기사 id>.json
// 사용법: node scripts/check-ai.mjs            (모든 기사)
//        node scripts/check-ai.mjs r1120-moon  (몇 개만)
// 'AI 쉽게 읽기'(학년 3단계)와 'AI 문장 분석'을 기사마다 미리 만들어 두면 API 키 없이도 바로 보여 줘요.
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const ctx = { window: {} }; vm.createContext(ctx);
vm.runInContext(readFileSync(join(root, 'data', 'articles.js'), 'utf8'), ctx);
const articles = ctx.window.NEWS_DATA.articles;
const only = process.argv.slice(2);
const list = only.length ? articles.filter(a => only.includes(a.id)) : articles;
const errors = [], missing = [];
const err = (id, m) => errors.push(`[${id}] ${m}`);
const BANNED = ['폭력', '폭행', '범죄', '학대', '체포', '구속', '재판', '징역', '처벌', '부정행위', '전쟁', '살인', '사망', '자살', '마약', '도박', '선정적'];
const str = v => typeof v === 'string' && v.trim().length > 0;
const nums = t => (String(t).match(/\d[\d,.]*/g) || []).map(n => n.replace(/[,.]$/, '').replace(/,/g, ''));

for (const a of list) {
  const f = join(root, 'data', 'ai', a.id + '.json');
  if (!existsSync(f)) { missing.push(a.id); continue; }
  let d; try { d = JSON.parse(readFileSync(f, 'utf8')); } catch (e) { err(a.id, 'JSON 형식이 틀렸어요: ' + e.message); continue; }
  const src = [a.title, a.body, a.origTitle].join(' ').replace(/,/g, '');
  const texts = [];
  if (!d.easy) err(a.id, 'easy가 없어요.');
  for (const lv of ['1-2', '3-4', '5-6']) {
    const e = d.easy && d.easy[lv];
    if (!e) { err(a.id, `easy["${lv}"]가 없어요.`); continue; }
    if (!Array.isArray(e.simplified) || e.simplified.length < 4 || e.simplified.length > 7) err(a.id, `easy ${lv}: simplified는 4~7문장이에요.`);
    for (const s of e.simplified || []) { if (!str(s) || !/요[.!?]?$/.test(s.trim())) err(a.id, `easy ${lv}: 문장은 '~요.'로 끝내요: ${s}`); texts.push(s); }
    if (!Array.isArray(e.vocabulary) || e.vocabulary.length < 2 || e.vocabulary.length > 4) err(a.id, `easy ${lv}: vocabulary는 2~4개예요.`);
    for (const v of e.vocabulary || []) { if (!str(v.word) || !str(v.meaning)) err(a.id, `easy ${lv}: 낱말에 word·meaning이 필요해요.`); else texts.push(v.meaning); }
    if (!str(e.question)) err(a.id, `easy ${lv}: question이 없어요.`); else texts.push(e.question);
  }
  const fc = d.facts;
  if (!fc) err(a.id, 'facts가 없어요.');
  else {
    if (!Array.isArray(fc.facts) || fc.facts.length < 3 || fc.facts.length > 6) err(a.id, 'facts.facts는 3~6개예요.');
    if (!Array.isArray(fc.opinions) || fc.opinions.length > 4) err(a.id, 'facts.opinions는 0~4개예요 (본문에 의견이 없으면 빈 배열).');
    for (const it of [...(fc.facts || []), ...(fc.opinions || [])]) { if (!str(it.content) || !str(it.reason)) err(a.id, 'facts 항목에 content·reason이 필요해요.'); else texts.push(it.content); }
    if (!str(fc.question)) err(a.id, 'facts.question이 없어요.');
  }
  // 기사에 없는 숫자를 지어내지 않았는지
  for (const t of texts) for (const n of nums(t)) if (n.length >= 2 && !src.includes(n)) err(a.id, `기사 본문에 없는 숫자 "${n}": ${t}`);
  for (const t of texts) for (const w of BANNED) if (t.includes(w)) err(a.id, `쓰면 안 되는 낱말 "${w}": ${t}`);
}
console.log(`검사한 기사 ${list.length}개 · 자료 있음 ${list.length - missing.length}개 · 없음 ${missing.length}개`);
if (missing.length) console.log('자료 없는 기사(기사의 사실·의견 문장으로 대신 보여 줘요): ' + missing.join(', '));
if (errors.length) { console.log('\n오류 ' + errors.length + '개\n- ' + errors.join('\n- ')); process.exit(1); }
console.log('\n검사 통과');
