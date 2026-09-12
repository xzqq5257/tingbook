// Cloudflare Pages Function: 图片代理
// 把相册图片从 raw.githubusercontent.com 转由本站（Cloudflare CDN）出图，
// 解决国内直连 GitHub raw 极慢 / 超时 / 断连的问题。
// 缓存策略：GitHub blob sha 做 cache key，内容不可变 → 长缓存（1 年 immutable）。

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

// 逐个字节校验 UTF-8 路径（拒绝 %00、非 UTF-8 序列等）
function isValidPath(path) {
  try {
    decodeURIComponent(encodeURIComponent(path));
  } catch (e) {
    return false;
  }
  return !/[\u0000-\u001f]/.test(path);
}

export async function onRequestGet(context) {
  const { request, params } = context;

  // /api/img/photos/xxx.jpg  → params.path 为数组
  let path = Array.isArray(params.path) ? params.path.join("/") : params.path;

  if (!path) {
    const u = new URL(request.url);
    path = u.searchParams.get("path") || "";
  }

  if (!isSafePath(path) || !isValidPath(path)) {
    return bad("invalid path", 400);
  }

  const upstream = `https://raw.githubusercontent.com/${OWNER}/${REPO}/${BRANCH}/${path}`;

  // 允许浏览器/Cloudflare 缓存复用；用 ETag 做协商缓存
  const inm = request.headers.get("if-none-match");

  const cacheUrl = new URL(request.url);
  cacheUrl.search = "";
  const cache = caches.default;
  const cacheKey = new Request(cacheUrl.toString(), { method: "GET" });

  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  let r;
  try {
    r = await fetch(upstream, {
      headers: {
        "User-Agent": "tingbook-img-proxy",
        // 若客户端带了协商缓存标识，透传给 GitHub，可能直接 304
        ...(inm ? { "If-None-Match": inm } : {}),
      },
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
  const len = r.headers.get("content-length");
  if (len) headers.set("content-length", len);

  const resp = new Response(r.body, { status: 200, headers });

  // 写入 Cloudflare 边缘缓存
  try {
    context.waitUntil(cache.put(cacheKey, resp.clone()));
  } catch (e) {}

  return resp;
}
