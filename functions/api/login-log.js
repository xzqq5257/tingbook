// Cloudflare Pages Function: 登录记录（密码门解锁日志）。
// POST /api/login-log { k: <密码门密码> }  -> 记录一次解锁（时间/IP/归属地/设备）
// GET  /api/login-log?k=<密码门密码>       -> 返回最近 200 条记录（倒序）
//
// 存储：TINGBOOK_KV，key = loginlog:<16位补零毫秒时间戳>:<随机后缀>，TTL 90 天。
// 说明：k 参数与前端密码门一致，仅防随手扫接口，不是强安全边界。

const PASSWORD = "1396788686";
const TTL_SECONDS = 90 * 24 * 60 * 60; // 90 天
const PREFIX = "loginlog:";

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function pad(n) {
  let s = String(n);
  while (s.length < 16) s = "0" + s;
  return s;
}

function randSuffix() {
  return (typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2) + Date.now().toString(36)
  ).slice(0, 8);
}

function deviceOf(ua) {
  // 粗略设备识别
  const u = ua || "";
  const os = /Windows/i.test(u) ? "Windows"
    : /iPhone|iPad|iPod/i.test(u) ? "iOS"
    : /Android/i.test(u) ? "Android"
    : /Mac OS X|Macintosh/i.test(u) ? "macOS"
    : /Linux/i.test(u) ? "Linux"
    : "未知";
  const br = /Edg\//i.test(u) ? "Edge"
    : /OPR\//i.test(u) ? "Opera"
    : /Chrome\//i.test(u) ? "Chrome"
    : /Firefox\//i.test(u) ? "Firefox"
    : /Safari\//i.test(u) ? "Safari"
    : /MicroMessenger/i.test(u) ? "微信"
    : "未知";
  return os + " · " + br;
}

export async function onRequestPost({ request, env }) {
  const kv = env.TINGBOOK_KV;
  if (!kv) return json({ ok: false, error: "服务端未绑定 TINGBOOK_KV" }, 500);

  let body = {};
  try { body = await request.json(); } catch {}
  if ((body.k || "") !== PASSWORD) {
    return json({ ok: false, error: "无权限" }, 403);
  }

  const h = request.headers;
  const cf = request.cf || {};
  const now = Date.now();
  const rec = {
    t: now,
    ip: h.get("CF-Connecting-IP") || "",
    country: cf.country || "",
    city: cf.city || "",
    ua: (h.get("user-agent") || "").slice(0, 200),
    device: deviceOf(h.get("user-agent") || ""),
  };

  const key = PREFIX + pad(now) + ":" + randSuffix();
  await kv.put(key, JSON.stringify(rec), { expirationTtl: TTL_SECONDS });
  return json({ ok: true, key });
}

export async function onRequestGet({ request, env }) {
  const kv = env.TINGBOOK_KV;
  if (!kv) return json({ ok: false, error: "服务端未绑定 TINGBOOK_KV" }, 500);

  const url = new URL(request.url);
  if ((url.searchParams.get("k") || "") !== PASSWORD) {
    return json({ ok: false, error: "无权限" }, 403);
  }

  // KV key 按字典序 = 时间序，取最新的若干条
  const keys = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: PREFIX, limit: 200, cursor });
    keys.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && keys.length < 400);

  keys.sort((a, b) => (a.name < b.name ? 1 : -1)); // 新→旧
  const recent = keys.slice(0, 200);
  const records = await Promise.all(
    recent.map(async (k) => {
      try { return JSON.parse(await kv.get(k.name)); } catch { return null; }
    })
  );
  const list = records.filter(Boolean);
  return json({ ok: true, count: list.length, records: list });
}
