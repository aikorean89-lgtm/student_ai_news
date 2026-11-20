// AI 어린이 뉴스 연구소 — 접속자 수 (Vercel Serverless Function)
//
// 좋은탴월드와 다른 게임들이 함께 쓰는 Upstash Redis 저장소에 숫자만 쌓아요.
// 필요한 설정: Vercel → 이 프로젝트 → Storage 에서 같은 Upstash 저장소를 연결 (Connect Project)
//   → KV_REST_API_URL / KV_REST_API_TOKEN (또는 UPSTASH_REDIS_REST_URL / _TOKEN) 이 자동으로 들어와요.
// 저장소가 없으면 { enabled:false } 를 돌려주고, 사이트는 접속자 탭을 숨겨요.
//
// 열쇠 (모두 한국 시간, 좋은탴월드 통합 관리의 'kids-news'가 읽어요)
//   kn:day:20261120  그날 방문한 브라우저 수 (같은 브라우저는 하루 한 번만 세요)
//   kn:total         누적 방문 수
//   kn:online        지금 접속 (최근 150초 안에 신호를 보낸 탭, 점수 = ms 시각)

const ONLINE_MS = 150 * 1000;
const P = 'kn:';

function env(...ends) {
  for (const end of ends) {
    const k = Object.keys(process.env).find((key) => key === end || key.endsWith('_' + end));
    if (k && process.env[k]) return process.env[k];
  }
  return '';
}
const URL_ = env('KV_REST_API_URL', 'UPSTASH_REDIS_REST_URL');
const TOKEN = env('KV_REST_API_TOKEN', 'UPSTASH_REDIS_REST_TOKEN');

function dayKST(offset = 0) {
  return new Date(Date.now() + 9 * 3600e3 - offset * 86400e3).toISOString().slice(0, 10).replace(/-/g, '');
}

async function pipeline(cmds) {
  const r = await fetch(URL_.replace(/\/$/, '') + '/pipeline', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + TOKEN, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmds),
  });
  if (!r.ok) throw new Error('upstash ' + r.status);
  return (await r.json()).map((x) => x.result);
}

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  if (!URL_ || !TOKEN) return res.status(200).json({ ok: true, enabled: false });

  let body = {};
  if (req.method === 'POST') {
    try { body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {}); } catch (e) { body = {}; }
  }
  const sid = String(body.sid || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 32);
  const now = Date.now();
  const today = P + 'day:' + dayKST();
  const cmds = [];
  if (req.method === 'POST' && body.visit === true) {
    cmds.push(['INCR', today], ['EXPIRE', today, String(60 * 60 * 24 * 400)], ['INCR', P + 'total']);
  }
  if (req.method === 'POST' && sid) cmds.push(['ZADD', P + 'online', String(now), sid]);
  cmds.push(['ZREMRANGEBYSCORE', P + 'online', '0', String(now - ONLINE_MS)]);
  cmds.push(['GET', today], ['GET', P + 'total'], ['ZCOUNT', P + 'online', String(now - ONLINE_MS), '+inf']);

  try {
    const out = await pipeline(cmds);
    const n = (v) => Number(v || 0) || 0;
    const [t, tot, onl] = out.slice(-3).map(n);
    return res.status(200).json({ ok: true, enabled: true, today: t, total: tot, online: Math.max(onl, sid ? 1 : 0) });
  } catch (e) {
    return res.status(200).json({ ok: false, enabled: true });
  }
};
