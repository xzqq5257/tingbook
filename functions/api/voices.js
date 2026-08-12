// Cloudflare Pages Function: 音色仓库（多音色切换库）。
// GET    /api/voices            -> 列出全部音色（含当前激活 id）
// POST   /api/voices (multipart)-> 上传新音色：file(音频) + name + 可选 refText（参考音文本）
// DELETE /api/voices?id=xxx     -> 删除指定音色
//
// 存储（Cloudflare KV 绑定 TINGBOOK_KV）：
//   voice:<id>          -> 元数据 JSON {id,name,refText,created}
//   voice:audio:<id>    -> 参考音音频（base64 字符串，避免二进制兼容问题）
//   voice:active        -> 当前激活音色 id（字符串）
//
// 写操作需管理员登录态（Cookie tb_session）。

import { readSession, json } from "../_lib/session.js";

function b64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

export async function onRequestGet({ env }) {
  const kv = env.TINGBOOK_KV;
  if (!kv) return json({ ok: false, error: "服务端未配置 KV 存储（TINGBOOK_KV）" }, 500);
  let keys = [];
  try {
    const r = await kv.list({ prefix: "voice:" });
    keys = r.keys.map((k) => k.name);
  } catch (e) {
    return json({ ok: false, error: "读取音色列表失败: " + e.message }, 500);
  }
  const ids = keys.filter(
    (n) => n.startsWith("voice:") && !n.startsWith("voice:audio:") && n !== "voice:active"
  );
  const voices = [];
  for (const key of ids) {
    const meta = await kv.get(key, "json");
    if (!meta) continue;
    voices.push({
      id: meta.id,
      name: meta.name,
      refText: meta.refText || "",
      created: meta.created,
      hasAudio: true,
    });
  }
  voices.sort((a, b) => (a.created || 0) - (b.created || 0));
  const active = await kv.get("voice:active");
  return json({ ok: true, voices, active: active || null });
}

export async function onRequestPost({ request, env }) {
  const kv = env.TINGBOOK_KV;
  if (!kv) return json({ ok: false, error: "服务端未配置 KV 存储（TINGBOOK_KV）" }, 500);
  const s = await readSession(env, request);
  if (!s) return json({ ok: false, error: "未登录" }, 401);

  let form;
  try {
    form = await request.formData();
  } catch {
    return json({ ok: false, error: "请求体应为 multipart/form-data" }, 400);
  }
  const file = form.get("file");
  const name = (form.get("name") || "").toString().trim();
  const refText = (form.get("refText") || "").toString().trim();
  if (!file) return json({ ok: false, error: "缺少音频文件" }, 400);
  if (!name) return json({ ok: false, error: "请填写音色名称" }, 400);
  if (file.size > 20 * 1024 * 1024) return json({ ok: false, error: "文件过大（>20MB），请上传更短的参考音" }, 400);
  if (!/^audio\//.test(file.type || "")) return json({ ok: false, error: "仅支持音频文件（wav/mp3/m4a 等）" }, 400);

  const id = typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : "v" + Date.now().toString(36);
  const buf = await file.arrayBuffer();
  const audioB64 = b64(buf);
  const meta = { id, name, refText, created: Date.now() };
  await kv.put(`voice:${id}`, JSON.stringify(meta));
  await kv.put(`voice:audio:${id}`, audioB64);

  // 若当前没有激活音色，自动把第一个设为激活
  const active = await kv.get("voice:active");
  if (!active) await kv.put("voice:active", id);

  return json({ ok: true, voice: meta });
}

export async function onRequestDelete({ request, env }) {
  const kv = env.TINGBOOK_KV;
  if (!kv) return json({ ok: false, error: "服务端未配置 KV 存储（TINGBOOK_KV）" }, 500);
  const s = await readSession(env, request);
  if (!s) return json({ ok: false, error: "未登录" }, 401);
  const id = new URL(request.url).searchParams.get("id");
  if (!id) return json({ ok: false, error: "缺少 id" }, 400);

  await kv.delete(`voice:${id}`);
  await kv.delete(`voice:audio:${id}`);
  const active = await kv.get("voice:active");
  if (active === id) await kv.delete("voice:active");
  return json({ ok: true });
}
