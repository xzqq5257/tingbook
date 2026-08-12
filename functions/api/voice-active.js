// Cloudflare Pages Function: 当前激活音色（用于克隆朗读默认使用的音色）。
// GET  /api/voice-active        -> { ok, active: id|null }
// POST /api/voice-active {id}   -> 设置激活音色（需登录）
import { readSession, json } from "../_lib/session.js";

export async function onRequestGet({ env }) {
  const kv = env.TINGBOOK_KV;
  const active = kv ? await kv.get("voice:active") : null;
  return json({ ok: true, active: active || null });
}

export async function onRequestPost({ request, env }) {
  const kv = env.TINGBOOK_KV;
  if (!kv) return json({ ok: false, error: "服务端未配置 KV 存储（TINGBOOK_KV）" }, 500);
  const s = await readSession(env, request);
  if (!s) return json({ ok: false, error: "未登录" }, 401);
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "请求体不是合法 JSON" }, 400);
  }
  const id = (body.id || "").toString().trim();
  if (!id) return json({ ok: false, error: "缺少 id" }, 400);
  const meta = await kv.get(`voice:${id}`, "json");
  if (!meta) return json({ ok: false, error: "音色不存在" }, 400);
  await kv.put("voice:active", id);
  return json({ ok: true, active: id });
}
