// AI 어린이 뉴스 연구소 — AI 요청을 대신 보내 주는 서버 함수 (Vercel Serverless Function)
//
// 왜 필요한가요?
//   브라우저에서 바로 Anthropic API를 부르면 API 키가 학생 컴퓨터에 노출되고, 키가 없으면 아예 작동하지 않아요.
//   이 함수가 서버에서 키를 안전하게 들고 대신 요청을 보내 줍니다.
//
// 필요한 설정 (Vercel 프로젝트 → Settings → Environment Variables)
//   ANTHROPIC_API_KEY  (필수)  platform.claude.com에서 발급한 키
//   AI_MODEL           (선택)  기본값 claude-haiku-5-5
//   KV_REST_API_URL / KV_REST_API_TOKEN  또는  UPSTASH_REDIS_REST_URL / UPSTASH_REDIS_REST_TOKEN
//                      (선택)  연결해 두면 같은 기사·같은 학년의 결과를 저장해 두고 모든 학생이 함께 씀 → 비용·대기시간 절약

const crypto = require('crypto');

const PROMPT_VERSION = 'v3';
const DEFAULT_MODEL = 'claude-haiku-5-5';
const MAX_TITLE = 200;
const MAX_BODY = 4000;
const CACHE_TTL_SEC = 60 * 60 * 24 * 180; // 180일

const LEVELS = {
  '1-2': '초등학교 1~2학년 (한글을 막 뗀 수준: 아주 쉬운 낱말, 한 문장에 한 가지 내용만, 문장은 15자 안팎)',
  '3-4': '초등학교 3~4학년 (일상 낱말은 알아요. 어려운 개념은 생활 속 예를 들어 풀어 주기)',
  '5-6': '초등학교 5~6학년 (조금 더 다양한 낱말 가능, 배경지식을 한 문장 정도 덧붙여도 좋아요)'
};

const JSON_RULE = '반드시 순수 JSON 하나만 출력해. 설명 문장, 마크다운, 코드블록 기호(```)는 절대 넣지 마.';

const SYSTEM = {
  easy:
    '너는 초등학생을 위한 어린이 신문 편집자야. 주어진 기사를 지정된 학년 눈높이로 쉽게 다시 써 줘.\n' +
    '규칙:\n1) 어려운 낱말은 쉬운 말로 바꾸기\n2) 문장은 짧게, 한 문장에 한 가지 내용\n3) 모든 문장은 "~요"로 끝나는 친절한 말투\n' +
    '4) 기사에 없는 내용은 절대 지어내지 않기\n5) 숫자·이름 같은 사실은 기사와 똑같이 쓰기\n' +
    JSON_RULE + '\n' +
    '형식: {"simplified":["문장1","문장2",...],"vocabulary":[{"word":"낱말","meaning":"쉬운 뜻 한 문장"}],"question":"생각해 볼 질문 한 문장"}\n' +
    'simplified는 4~6문장, vocabulary는 기사에 나온 어려운 낱말 2~4개.',
  facts:
    '너는 어린이에게 사실과 의견을 구별하는 법을 가르치는 뉴스 문해력 선생님이야.\n' +
    '사실: 숫자, 날짜, 실제로 일어난 일처럼 확인할 수 있는 내용.\n' +
    '의견: 누군가의 생각, 판단, 걱정, 주장, 앞으로의 예상.\n' +
    '기사에 없는 내용은 지어내지 마. 각 문장은 초등학생이 읽기 쉬운 한 문장으로 써.\n' +
    JSON_RULE + '\n' +
    '형식: {"facts":[{"content":"사실 한 문장","reason":"사실이라고 볼 수 있는 까닭 한 문장"}],' +
    '"opinions":[{"content":"의견 한 문장","reason":"의견이라고 볼 수 있는 까닭 한 문장"}],' +
    '"question":"사실과 의견을 비교하며 생각해 볼 질문 한 문장"}\n' +
    'facts는 3~5개, opinions는 2~4개.',
  quiz:
    '너는 초등학생을 위한 뉴스 퀴즈를 만드는 선생님이야. 주어진 기사만 읽으면 풀 수 있는 객관식 문제 3개를 만들어.\n' +
    '보기는 4개, 정답은 하나뿐이어야 하고, 정답 위치는 문제마다 골고루 섞어.\n' +
    JSON_RULE + '\n' +
    '형식: {"quiz":[{"question":"문제","options":["보기1","보기2","보기3","보기4"],"answerIndex":0,"explanation":"정답인 까닭 한 문장"}]}\n' +
    'quiz 배열 길이는 정확히 3.'
};

// ---------- 간단한 메모리 캐시·속도 제한 (서버 인스턴스마다 따로 동작) ----------
const memCache = new Map();
const MEM_CACHE_MAX = 300;
const hits = new Map();
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_MAX = 120; // 학교는 학생 모두가 같은 공인 IP를 쓰는 경우가 많아 넉넉하게

function memGet(key) {
  const v = memCache.get(key);
  if (!v) return null;
  memCache.delete(key);
  memCache.set(key, v);
  return v;
}
function memSet(key, value) {
  memCache.set(key, value);
  if (memCache.size > MEM_CACHE_MAX) memCache.delete(memCache.keys().next().value);
}

function rateLimited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS);
  if (list.length >= RATE_MAX) {
    hits.set(ip, list);
    return true;
  }
  list.push(now);
  hits.set(ip, list);
  if (hits.size > 5000) hits.clear();
  return false;
}

// ---------- 선택: Upstash Redis 공용 캐시 ----------
function redisConfig() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url: url.replace(/\/$/, ''), token } : null;
}
async function redisCmd(cmd) {
  const cfg = redisConfig();
  if (!cfg) return null;
  try {
    const r = await fetch(cfg.url, {
      method: 'POST',
      headers: { Authorization: 'Bearer ' + cfg.token, 'Content-Type': 'application/json' },
      body: JSON.stringify(cmd)
    });
    if (!r.ok) return null;
    const j = await r.json();
    return j && 'result' in j ? j.result : null;
  } catch (e) {
    return null;
  }
}

// ---------- 결과 모양 검사 ----------
function isStr(s, max) {
  return typeof s === 'string' && s.trim().length > 0 && s.length <= (max || 400);
}
function validate(type, d) {
  if (!d || typeof d !== 'object') return null;
  if (type === 'easy') {
    let s = d.simplified;
    if (typeof s === 'string') s = s.split(/\n+/);
    if (!Array.isArray(s)) return null;
    s = s.filter((x) => isStr(x)).slice(0, 8);
    if (s.length < 2) return null;
    const vocab = (Array.isArray(d.vocabulary) ? d.vocabulary : [])
      .filter((v) => v && isStr(v.word, 40) && isStr(v.meaning, 200))
      .slice(0, 4);
    return { simplified: s, vocabulary: vocab, question: isStr(d.question) ? d.question : '' };
  }
  if (type === 'facts') {
    const pick = (arr) =>
      (Array.isArray(arr) ? arr : []).filter((x) => x && isStr(x.content) && isStr(x.reason)).slice(0, 6);
    const facts = pick(d.facts);
    const opinions = pick(d.opinions);
    if (!facts.length || !opinions.length) return null;
    return { facts, opinions, question: isStr(d.question) ? d.question : '' };
  }
  if (type === 'quiz') {
    const q = (Array.isArray(d.quiz) ? d.quiz : []).filter(
      (x) =>
        x &&
        isStr(x.question) &&
        Array.isArray(x.options) &&
        x.options.length === 4 &&
        x.options.every((o) => isStr(o, 200)) &&
        Number.isInteger(x.answerIndex) &&
        x.answerIndex >= 0 &&
        x.answerIndex <= 3
    );
    if (q.length < 3) return null;
    return {
      quiz: q.slice(0, 3).map((x) => ({
        question: x.question,
        options: x.options,
        answerIndex: x.answerIndex,
        explanation: isStr(x.explanation) ? x.explanation : ''
      }))
    };
  }
  return null;
}

function parseJson(text) {
  const clean = String(text || '').replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(clean);
  } catch (e) {
    const m = clean.match(/\{[\s\S]*\}/);
    if (m) {
      try {
        return JSON.parse(m[0]);
      } catch (e2) {}
    }
  }
  return null;
}

async function askClaude(type, title, body, level) {
  const user =
    '[기사 제목] ' + title + '\n[기사 본문]\n' + body +
    (type === 'easy' ? '\n\n위 기사를 ' + LEVELS[level] + ' 눈높이에 맞게 다시 써 줘.' : '');
  const r = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: process.env.AI_MODEL || DEFAULT_MODEL,
      max_tokens: 1500,
      system: SYSTEM[type],
      messages: [{ role: 'user', content: user }]
    })
  });
  if (!r.ok) {
    let detail = '';
    try {
      detail = (await r.text()).slice(0, 300);
    } catch (e) {}
    const err = new Error('Anthropic API ' + r.status + ' ' + detail);
    err.status = r.status;
    throw err;
  }
  const data = await r.json();
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('\n');
  return validate(type, parseJson(text));
}

function send(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

async function readBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try {
      return JSON.parse(req.body);
    } catch (e) {
      return null;
    }
  }
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => {
      raw += c;
      if (raw.length > 20000) req.destroy();
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw));
      } catch (e) {
        resolve(null);
      }
    });
    req.on('error', () => resolve(null));
  });
}

module.exports = async function handler(req, res) {
  if (req.method === 'GET') {
    // 상태 확인용: 키가 설정되어 있는지만 알려 줌 (키 값은 절대 내보내지 않음)
    return send(res, 200, { ok: true, ready: !!process.env.ANTHROPIC_API_KEY, sharedCache: !!redisConfig() });
  }
  if (req.method !== 'POST') return send(res, 405, { ok: false, code: 'METHOD' });

  // 다른 사이트에서 이 서버를 마음대로 쓰지 못하게 같은 주소에서 온 요청만 받기
  const origin = req.headers.origin;
  if (origin) {
    let originHost = '';
    try {
      originHost = new URL(origin).host;
    } catch (e) {}
    if (originHost !== req.headers.host) return send(res, 403, { ok: false, code: 'FORBIDDEN' });
  }

  const b = await readBody(req);
  const type = b && b.type;
  const level = b && b.level;
  const title = b && typeof b.title === 'string' ? b.title.trim() : '';
  const body = b && typeof b.body === 'string' ? b.body.trim() : '';
  if (!SYSTEM[type] || !title || !body || title.length > MAX_TITLE || body.length > MAX_BODY) {
    return send(res, 400, { ok: false, code: 'BAD_REQUEST' });
  }
  if (type === 'easy' && !LEVELS[level]) return send(res, 400, { ok: false, code: 'BAD_REQUEST' });

  const key =
    'kidsnews:' + PROMPT_VERSION + ':' +
    crypto.createHash('sha256').update([type, type === 'easy' ? level : '', title, body].join('\u0001')).digest('hex');

  const mem = memGet(key);
  if (mem) return send(res, 200, { ok: true, data: mem, cached: true });
  const shared = await redisCmd(['GET', key]);
  if (shared) {
    try {
      const d = JSON.parse(shared);
      memSet(key, d);
      return send(res, 200, { ok: true, data: d, cached: true });
    } catch (e) {}
  }

  if (!process.env.ANTHROPIC_API_KEY) return send(res, 503, { ok: false, code: 'NO_KEY' });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (rateLimited(ip)) return send(res, 429, { ok: false, code: 'RATE_LIMIT' });

  try {
    let data = await askClaude(type, title, body, level);
    if (!data) data = await askClaude(type, title, body, level); // 모양이 어긋나면 한 번 더
    if (!data) return send(res, 502, { ok: false, code: 'BAD_OUTPUT' });
    memSet(key, data);
    await redisCmd(['SET', key, JSON.stringify(data), 'EX', CACHE_TTL_SEC]);
    return send(res, 200, { ok: true, data, cached: false });
  } catch (e) {
    console.error('[api/ai]', e && e.message);
    const code = e && (e.status === 401 || e.status === 403) ? 'BAD_KEY' : e && e.status === 429 ? 'BUSY' : 'UPSTREAM';
    return send(res, 502, { ok: false, code });
  }
};
