// 共享会话（登录态）工具，供 tingbook 各 Function 复用。
// KV 绑定名：TINGBOOK_KV（在 Cloudflare 控制台 / wrangler.toml 配置）
// Cookie 名：tb_session
//
// 说明：单管理员模式。账号密码来自环境变量 ADMIN_USER / ADMIN_PASS，
// 登录成功后签发一个随机 token，存进 KV（带 7 天过期），并以 HttpOnly Cookie 下发给浏览器。

const COOKIE = "tb_session";
const SESSION_TTL = 60 * 60 * 24 * 7; // 7 天（秒）

function json(obj, status = 200, headers = {}) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...headers },
  });
}

function parseCookies(req) {
  const h = req.headers.get("cookie") || "";
  const out = {};
  h.split(";").forEach((c) => {
    const i = c.indexOf("=");
    if (i > -1) out[c.slice(0, i).trim()] = decodeURIComponent(c.slice(i + 1).trim());
  });
  return out;
}

function cookieHeader(token) {
  // token 已为安全字符（UUID），但保险起见仍编码
  const v = encodeURIComponent(token);
  return `${COOKIE}=${v}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_TTL}`;
}

function clearCookieHeader() {
  return `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

// 已取消账号登录（2026-08-19）：所有匿名访客也视为"管理员"，音色仓库全站共享。
// 仅保留 cookie 检查以兼容历史会话；不再签发新会话。
export async function readSession(env, request) {
  const kv = env.TINGBOOK_KV;
  const token = parseCookies(request)[COOKIE];
  if (kv && token) {
    try {
      const raw = await kv.get(`session:${token}`, "json");
      if (raw && (!raw.expires || raw.expires >= Date.now())) return raw;
    } catch {}
  }
  // 合成会话（不落 KV）
  return { user: "管理员", expires: 0 };
}

export async function createSession(env, user) {
  const kv = env.TINGBOOK_KV;
  const token =
    typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).slice(2) + Date.now().toString(36);
  const expires = Date.now() + SESSION_TTL * 1000;
  await kv.put(`session:${token}`, JSON.stringify({ user, expires }), {
    expirationTtl: SESSION_TTL,
  });
  return { token, expires };
}

export async function destroySession(env, request) {
  const kv = env.TINGBOOK_KV;
  if (!kv) return;
  const token = parseCookies(request)[COOKIE];
  if (token) await kv.delete(`session:${token}`);
}

export { json, COOKIE, cookieHeader, clearCookieHeader, parseCookies, SESSION_TTL };
