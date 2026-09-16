// Cloudflare Pages Function: 批量接收用户上传的照片 / 视频，合并成「一个 GitHub commit」写入
// xzqq5257/tingbook 的 photos/ 目录。相比单张上传（每文件一次 Contents API PUT + 一次提交），
// 批量上传把 N 张照片压成 ~N/CHUNK 次提交，显著降低 GitHub API 调用次数与限流概率。
//
// 流程（每批）：
//   1. 解析 multipart 里所有 'file'
//   2. 逐个校验大小 / mime，客户端预压缩后已变小，这里再按 SHA1 短码命名
//   3. 并发创建 blobs（/git/blobs）
//   4. 用 base_tree 建 tree（/git/trees）
//   5. 建 commit（/git/commits）
//   6. 更新 main ref（PATCH /git/refs/heads/main）
//
// 注意：函数体上限 ~50MB（CF 免费层）。前端按 UP_CHUNK=10 分块，单批通常 < 30MB。
// 环境变量：GH_TOKEN（需 Contents 写权限）；可选 REPO_OWNER / REPO_NAME。

const API = "https://api.github.com";
const OWNER = "xzqq5257";
const REPO = "tingbook";
const PREFIX = "photos/";

const MAX_PHOTO = 15 * 1024 * 1024; // 15 MB
const MAX_VIDEO = 50 * 1024 * 1024; // 50 MB

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}
function bad(error, status = 400) {
  return json({ ok: false, error }, status);
}
function auth(token) {
  return {
    Authorization: `token ${token}`,
    Accept: "application/vnd.github+json",
    "Content-Type": "application/json",
    "User-Agent": "tingbook-album",
    "X-GitHub-Api-Version": "2022-11-28",
  };
}
function b64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
function sha1Hex(bytes) {
  return crypto.subtle.digest("SHA-1", bytes).then((d) => {
    const a = new Uint8Array(d);
    let s = "";
    for (let i = 0; i < 8; i++) s += a[i].toString(16).padStart(2, "0");
    return s;
  });
}
function ymd() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}
function extOf(name) {
  const m = /\.([^.]+)$/.exec(name || "");
  return m ? m[1].toLowerCase() : "bin";
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const owner = (env.REPO_OWNER && env.REPO_OWNER.trim()) || OWNER;
  const repo = (env.REPO_NAME && env.REPO_NAME.trim()) || REPO;
  const token = (env.GH_TOKEN && env.GH_TOKEN.trim()) || "";
  if (!token) return bad("missing env: GH_TOKEN", 500);

  let form;
  try {
    form = await request.formData();
  } catch (e) {
    return bad("bad form data", 400);
  }
  const files = [];
  for (const [k, v] of form.entries()) {
    if (k === "file" && v && typeof v !== "string") files.push(v);
  }
  if (!files.length) return bad("no file", 400);

  // 拉取当前 main 作为 base
  let baseSha, baseTree;
  try {
    const refR = await fetch(`${API}/repos/${owner}/${repo}/git/ref/heads/main`, { headers: auth(token) });
    if (!refR.ok) return bad("ref fetch fail: " + refR.status, 502);
    baseSha = (await refR.json()).object.sha;
    const cmR = await fetch(`${API}/repos/${owner}/${repo}/git/commits/${baseSha}`, { headers: auth(token) });
    if (!cmR.ok) return bad("commit fetch fail: " + cmR.status, 502);
    baseTree = (await cmR.json()).tree.sha;
  } catch (e) {
    return bad("base fetch error: " + e.message, 502);
  }

  const entries = [];
  const results = [];
  const failed = [];

  // 并发创建 blobs
  await Promise.all(files.map(async (file) => {
    const type = file.type || "";
    const isImg = type.startsWith("image/");
    const isVid = type.startsWith("video/");
    const clientName = file.name || "media";
    if (!isImg && !isVid) { failed.push({ clientName, name: clientName, error: "仅支持图片/视频" }); return; }
    const limit = isImg ? MAX_PHOTO : MAX_VIDEO;
    if (file.size > limit) { failed.push({ clientName, name: clientName, error: "超过 " + (isImg ? "15MB" : "50MB") }); return; }

    let buf;
    try { buf = await file.arrayBuffer(); } catch (e) { failed.push({ clientName, name: clientName, error: "读取失败" }); return; }
    const hash4 = await sha1Hex(buf);
    const ext = extOf(file.name) || (isImg ? "jpg" : "mp4");
    const base = (file.name || "photo")
      .replace(/\.[^.]+$/, "")
      .replace(/[^\w\-一-龥_.]/g, "_")
      .slice(0, 32) || "photo";
    const filename = `${PREFIX}${ymd()}-${base}-${hash4}.${ext}`;
    const content = b64(buf);

    try {
      const br = await fetch(`${API}/repos/${owner}/${repo}/git/blobs`, {
        method: "POST",
        headers: auth(token),
        body: JSON.stringify({ content, encoding: "base64" }),
      });
      if (!br.ok) { failed.push({ clientName, name: clientName, error: "blob fail " + br.status }); return; }
      const bsha = (await br.json()).sha;
      entries.push({ path: filename, mode: "100644", type: "blob", sha: bsha });
      results.push({
        clientName,
        name: filename.slice(PREFIX.length),
        path: filename,
        size: file.size,
        type: isImg ? "image" : "video",
        rawUrl: `https://raw.githubusercontent.com/${owner}/${repo}/main/${filename}`,
        proxyUrl: `/photos/${filename.slice(PREFIX.length)}`,
      });
    } catch (e) {
      failed.push({ clientName, name: clientName, error: "blob error " + e.message });
    }
  }));

  // 同步更新 photos/manifest.json（相册列表的权威数据源），与图片同一 commit 一起提交
  // 注意：CF Workers 的 fetch 不支持 cache/cf 选项，只能用 _headers + 查询串炸弹控制缓存
  let manifest = [];
  let manifestState = "unknown"; // fresh(首次无清单) | loaded(已读取) | error(读取失败，勿覆盖)
  try {
    const mr = await fetch(`${API}/repos/${owner}/${repo}/contents/photos/manifest.json`, { headers: auth(token) });
    if (mr.ok) {
      const mj = await mr.json();
      if (mj && mj.content) {
        const bin = atob(mj.content);
        const mbytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) mbytes[i] = bin.charCodeAt(i);
        const mtxt = new TextDecoder().decode(mbytes);
        try { const arr = JSON.parse(mtxt); if (Array.isArray(arr)) { manifest = arr; manifestState = "loaded"; } } catch (_) { manifestState = "error"; }
      } else {
        manifestState = "error";
      }
    } else if (mr.status === 404) {
      manifestState = "fresh";
    } else {
      manifestState = "error";
    }
  } catch (_) { manifestState = "error"; }
  const have = new Set(manifest.map((m) => m.name));
  for (const fl of results) {
    if (!have.has(fl.name)) {
      manifest.push({ name: fl.name, path: fl.path, size: fl.size, type: fl.type });
      have.add(fl.name);
    }
  }
  if (results.length && manifestState !== "error") {
    const mContent = JSON.stringify(manifest, null, 2);
    try {
      const mbr = await fetch(`${API}/repos/${owner}/${repo}/git/blobs`, {
        method: "POST", headers: auth(token),
        body: JSON.stringify({ content: b64(new TextEncoder().encode(mContent)), encoding: "base64" }),
      });
      if (mbr.ok) {
        const mbsha = (await mbr.json()).sha;
        entries.push({ path: PREFIX + "manifest.json", mode: "100644", type: "blob", sha: mbsha });
      }
    } catch (_) {}
  }

  if (entries.length) {
    try {
      const tr = await fetch(`${API}/repos/${owner}/${repo}/git/trees`, {
        method: "POST",
        headers: auth(token),
        body: JSON.stringify({ base_tree: baseTree, tree: entries }),
      });
      if (!tr.ok) return bad("tree fail " + tr.status, 502);
      const treeSha = (await tr.json()).sha;
      const cm = await fetch(`${API}/repos/${owner}/${repo}/git/commits`, {
        method: "POST",
        headers: auth(token),
        body: JSON.stringify({ message: `album: batch upload ${results.length} media (+manifest)`, tree: treeSha, parents: [baseSha] }),
      });
      if (!cm.ok) return bad("commit fail " + cm.status, 502);
      const commitSha = (await cm.json()).sha;
      const ur = await fetch(`${API}/repos/${owner}/${repo}/git/refs/heads/main`, {
        method: "PATCH",
        headers: auth(token),
        body: JSON.stringify({ sha: commitSha, force: false }),
      });
      if (!ur.ok) return bad("ref update fail " + ur.status, 502);
    } catch (e) {
      return bad("commit error: " + e.message, 502);
    }
  }

  return json({ ok: true, count: results.length, failedCount: failed.length, files: results, failed });
}
