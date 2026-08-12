// Cloudflare Pages Function: 管理员登录。
// POST /api/login { user, pass } -> 校验环境变量 ADMIN_USER / ADMIN_PASS，
// 成功则签发会话 token（存 KV，HttpOnly Cookie 下发）。
//
// 需要的环境变量：
//   ADMIN_USER   管理员用户名
//   ADMIN_PASS   管理员密码
//   TINGBOOK_KV  KV 命名空间绑定（存会话）

import { createSession, json, cookieHeader } from "../_lib/session.js";

export async function onRequestPost({ request, env }) {
  const user = (env.ADMIN_USER && env.ADMIN_USER.trim()) || "";
  const pass = (env.ADMIN_PASS && env.ADMIN_PASS.trim()) || "";
  if (!user || !pass) {
    return json(
      { ok: false, error: "服务端未配置 ADMIN_USER / ADMIN_PASS，请在 Cloudflare 环境变量中设置" },
      500
    );
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "请求体不是合法 JSON" }, 400);
  }

  const u = (body.user || "").trim();
  const p = (body.pass || "").trim();
  if (u !== user || p !== pass) {
    return json({ ok: false, error: "用户名或密码错误" }, 401);
  }

  const { token } = await createSession(env, u);
  return json({ ok: true, user: u }, 200, { "Set-Cookie": cookieHeader(token) });
}
