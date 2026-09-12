// Cloudflare Pages Function: 图片代理
// 把相册图片从 raw.githubusercontent.com 转由本站（Cloudflare CDN）出图，
// 解决国内直连 GitHub raw 极慢 / 超时 / 断连的问题。
//
// 用法：GET /api/img?path=photos/xxx.jpg
// 注意：刻意不使用 functions/api/img/[[...path]].js 这种带方括号的文件名——
//       方括号是 glob 元字符，会让 wrangler pages deploy 上传失败。
//
// 缓存策略：内容不可变 → 边缘缓存 1 年 immutable。

const OWNER = "xzqq5257";
const REPO = "tingbook";
const BRANCH = "main";

// 只允许代理 photos/ 与 assets/ 下的图片，避免变成开放代理
const ALLOWED_PREFIXES = ["photos/", "assets/"];
const ALLOWED_EXT = /\.(jpe?g|png|webp|gif|bmp|avif)$/i;

function bad(error, status = 400) {
  return new Response(JSON.stringify({ ok: false, error }), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

function isSafePath(path) {
  if (!path || path.includes("..") || path.includes("//")) return false;
  if (path.startsWith("/")) return false;
  if (!ALLOWED_PREFIXES.some((p) => path.startsWith(p))) return false;
  if (!ALLOWED_EXT.test(path)) return false;
  return true;
}

function isValidPath(path) {
  // 拒绝控制字符
  return !/[\u0000-\u001f\u007f]/.test(path);
}

export async function onRequestGet(context) {
  const { request } = context;
  const u = new URL(request.url);
  const path = u.searchParams.get("path") || "";

  if (!isSafePath(path) || !isValidPath(path)) {
    return bad("invalid path", 400);
  }

  const cacheUrl = new URL(request.url);
  cacheUrl.search = "";
  cacheUrl.pathname = `/api/img/_cache/${encodeURIComponent(path)}`;
  const cache = caches.default;
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });

  const hit = await cache.match(cacheKey);
  if (hit) return hit;

  const upstream = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${path}`;

  let r;
  try {
    r = await fetch(upstream, {
      headers: { "User-Agent": "tingbook-img-proxy" },
      cf: { cacheEverything: true, cacheTtl: 31536000 },
    });
  } catch (e) {
    return bad("upstream fetch failed: " + String(e.message || e), 502);
  }

  if (!r.ok) {
    return bad(`upstream ${r.status}`, r.status === 404 ? 404 : 502);
  }

  const headers = new Headers();
  headers.set("content-type", r.headers.get("content-type") || "image/jpeg");
  headers.set("cache-control", "public, max-age=31536000, immutable");
  headers.set("access-control-allow-origin", "*");
  headers.set("x-content-type-options", "nosniff");
  const etag = r.headers.get("etag");
  if (etag) headers.set("etag", etag);

  const resp = new Response(r.body, { status: 200, headers });

  try {
    context.waitUntil(cache.put(cacheKey, resp.clone()));
  } catch (e) {}

  return resp;
}
