// Cloudflare Pages Function: 「给她的话」云端信笺。
// GET    /api/notes?k=<密码门密码>            -> { ok, count, records:[{id,t,text}] }（新→旧，最多 500 条）
// POST   /api/notes { k, text }               -> { ok, id } 新增一条
// DELETE /api/notes { k, id }                 -> { ok } 删除一条（id 为 KV key 名）
//
// 存储：TINGBOOK_KV，key = note:<16位补零毫秒时间戳>:<随机后缀>。
// k 参数与前端密码门一致，仅防随手扫接口，不是强安全边界。

const PASSWORD = "1396788686";
const PREFIX = "note:";
const MAX_NOTES = 500;
const MAX_TEXT = 5000;

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

function checkK(url, body) {
  const k = body ? body.k : (url ? url.searchParams.get("k") : "");
  return k === PASSWORD;
}

export async function onRequestGet({ request, env }) {
  const kv = env.TINGBOOK_KV;
  if (!kv) return json({ ok: false, error: "服务端未绑定 TINGBOOK_KV" }, 500);
  if (!checkK(new URL(request.url), null)) return json({ ok: false, error: "无权限" }, 403);

  const keys = [];
  let cursor;
  do {
    const page = await kv.list({ prefix: PREFIX, limit: 200, cursor });
    keys.push(...page.keys);
    cursor = page.list_complete ? undefined : page.cursor;
  } while (cursor && keys.length < MAX_NOTES);

  keys.sort((a, b) => (a.name < b.name ? 1 : -1)); // 新→旧
  const recent = keys.slice(0, MAX_NOTES);
  const records = await Promise.all(
    recent.map(async (k) => {
      const name = k.name;   // ⚠️ kv.list 返回的是 {name,...} 对象，get/delete 必须传 .name 字符串
      try {
        const rec = JSON.parse(await kv.get(name));
        return rec && typeof rec.text === "string" ? { id: name, t: rec.t || 0, text: rec.text } : null;
      } catch { return null; }
    })
  );
  const list = records.filter(Boolean);
  return json({ ok: true, count: list.length, records: list });
}

export async function onRequestPost({ request, env }) {
  const kv = env.TINGBOOK_KV;
  if (!kv) return json({ ok: false, error: "服务端未绑定 TINGBOOK_KV" }, 500);

  let body = {};
  try { body = await request.json(); } catch {}
  if (!checkK(null, body)) return json({ ok: false, error: "无权限" }, 403);

  const text = String(body.text || "").trim().slice(0, MAX_TEXT);
  if (!text) return json({ ok: false, error: "内容不能为空" }, 400);

  const now = Date.now();
  const key = PREFIX + pad(now) + ":" + randSuffix();
  await kv.put(key, JSON.stringify({ t: now, text }), { expirationTtl: 10 * 365 * 24 * 60 * 60 });
  return json({ ok: true, id: key, t: now });
}

export async function onRequestDelete({ request, env }) {
  const kv = env.TINGBOOK_KV;
  if (!kv) return json({ ok: false, error: "服务端未绑定 TINGBOOK_KV" }, 500);

  let body = {};
  try { body = await request.json(); } catch {}
  if (!checkK(null, body)) return json({ ok: false, error: "无权限" }, 403);

  const id = String(body.id || "");
  if (!id.startsWith(PREFIX)) return json({ ok: false, error: "无效 id" }, 400);
  await kv.delete(id);
  return json({ ok: true });
}
