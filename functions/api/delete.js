// Cloudflare Pages Function: 真正从仓库删除音频文件，并从 index.html 的 BOOKS/LTYV 移除对应条目。
// 部署后：前端 DELETE 按钮 -> POST /api/delete { file } -> 这里用服务端 GH_TOKEN 提交删除到 main，
// 随后 Cloudflare Pages 自动重新部署，删除对所有访客生效（不只是本地隐藏）。
//
// 本版本【仅依赖 Cloudflare 环境变量】，不含任何硬编码密钥。需要的变量
// （Dashboard -> Settings -> Environment variables，Production + Preview 都配）：
//   GH_TOKEN      有 repo 写权限的 GitHub Personal Access Token（fine-grained，仅授权 xzqq5257/tingbook 的 Contents 读写）
//   REPO_OWNER    xzqq5257
//   REPO_NAME     tingbook
//   ADMIN_KEY     自定义暗号，前端需带相同值到 header `x-admin-key`（基本门禁，非强鉴权）
//
// 若 GH_TOKEN 缺失或无效，函数会返回 500 并给出明确提示，便于排查。

const API = "https://api.github.com";

function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = "";
  bytes.forEach((b) => (bin += String.fromCharCode(b)));
  return btoa(bin);
}
function b64decode(b64) {
  const bin = atob(b64.replace(/\s/g, ""));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}

// GitHub Contents API 对路径按段编码，避免把 '/' 编成 '%2F' 导致 404
function encPath(p) {
  return p.split("/").map(encodeURIComponent).join("/");
}

function gh(token, method, path, data) {
  return fetch(API + path, {
    method,
    headers: {
      Authorization: `token ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "User-Agent": "tingbook-delete-fn",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: data ? JSON.stringify(data) : undefined,
  });
}

// 实测某个 token 是否能访问仓库 ref（提前给出明确错误，而非在深处崩溃）
async function tokenWorks(token, owner, repo) {
  if (!token) return false;
  try {
    const r = await gh(token, "GET", `/repos/${owner}/${repo}/git/ref/heads/main`);
    return r.ok;
  } catch {
    return false;
  }
}

// 在 html 中移除包含 "<target>"（音频路径，带引号）的对象字面量（BOOKS 用 "file":"..."、LTYV 用 file:"..." 均可匹配）
function removeEntryByFile(html, target) {
  const needle = `"${target}"`;
  let changed = false;
  let work = html;
  let idx;
  while ((idx = work.indexOf(needle)) !== -1) {
    // 先向右找到该对象的闭合 }（idx 位于对象内部，初始 depth=1）
    let depth = 1;
    let close = idx;
    for (let i = idx; i < work.length; i++) {
      if (work[i] === "{") depth++;
      else if (work[i] === "}") {
        depth--;
        if (depth === 0) {
          close = i;
          break;
        }
      }
    }
    // 再从闭合 } 向左找回填的 {
    depth = 0;
    let open = close;
    for (let i = close; i >= 0; i--) {
      if (work[i] === "}") depth++;
      else if (work[i] === "{") {
        depth--;
        if (depth === 0) {
          open = i;
          break;
        }
      }
    }
    // 去掉对象以及多余逗号
    let left = open;
    let right = close;
    if (work[right + 1] === ",") right++;
    else if (left - 1 >= 0 && work[left - 1] === ",") left--;
    work = work.slice(0, left) + work.slice(right + 1);
    changed = true;
  }
  // 清理因删除产生的悬空逗号（如末尾元素删除后留出的 ", ]"、首元素删除后的 "[ ,"）
  work = work.replace(/,\s*\]/g, "]").replace(/\[\s*,/g, "[");
  return { html: work, changed };
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const owner = (env.REPO_OWNER && env.REPO_OWNER.trim()) || "xzqq5257";
  const repo = (env.REPO_NAME && env.REPO_NAME.trim()) || "tingbook";
  const adminKey = (env.ADMIN_KEY && env.ADMIN_KEY.trim()) || "ltyv-del-2026";
  const token = (env.GH_TOKEN && env.GH_TOKEN.trim()) || "";

  // 仅依赖环境变量：缺失直接报错
  if (!token) {
    return new Response(
      JSON.stringify({ ok: false, error: "missing env: 请在 Cloudflare 环境变量配置 GH_TOKEN" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
  // 提前校验 token 是否对仓库有效，给出明确错误而非在深处崩溃
  if (!(await tokenWorks(token, owner, repo))) {
    return new Response(
      JSON.stringify({ ok: false, error: "GH_TOKEN 无效或无 xzqq5257/tingbook 仓库权限，请检查 Cloudflare 环境变量" }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }

  // 基本门禁
  const provided = request.headers.get("x-admin-key") || "";
  if (provided !== adminKey) {
    return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
      status: 401,
      headers: { "content-type": "application/json" },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ ok: false, error: "bad json" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }
  const file = body.file;
  // 路径白名单：仅允许 audio/ 或 listen-to-your-voice/ 下的 .mp3/.wav
  if (
    !file ||
    !/^(audio\/|listen-to-your-voice\/)/.test(file) ||
    /(\.\.)|^\//.test(file) ||
    !/\.(mp3|wav)$/i.test(file)
  ) {
    return new Response(JSON.stringify({ ok: false, error: "invalid path" }), {
      status: 400,
      headers: { "content-type": "application/json" },
    });
  }

  try {
    const branch = "main";
    // 1) 取 main 引用与基础树
    const ref = await (await gh(token, "GET", `/repos/${owner}/${repo}/git/ref/heads/${branch}`)).json();
    const commitSha = ref.object.sha;
    const commit = await (await gh(token, "GET", `/repos/${owner}/${repo}/git/commits/${commitSha}`)).json();
    const baseTree = commit.tree.sha;

    // 2) 取 index.html 并移除对应条目
    const idxRes = await gh(token, "GET", `/repos/${owner}/${repo}/contents/index.html?ref=${branch}`);
    if (!idxRes.ok) throw new Error("index.html not found");
    const idxData = await idxRes.json();
    const html0 = b64decode(idxData.content);
    const { html: html1, changed } = removeEntryByFile(html0, file);

    // 3) 创建新 index.html blob（仅当确有改动）
    const treeEntries = [];
    if (changed) {
      const blob = await (
        await gh(token, "POST", `/repos/${owner}/${repo}/git/blobs`, {
          content: b64encode(html1),
          encoding: "base64",
        })
      ).json();
      treeEntries.push({ path: "index.html", mode: "100644", type: "blob", sha: blob.sha });
    }

    // 4) 若音频文件存在，则在树中删除它（sha: null）
    const fRes = await gh(token, "GET", `/repos/${owner}/${repo}/contents/${encPath(file)}?ref=${branch}`);
    if (fRes.ok) {
      const fData = await fRes.json();
      treeEntries.push({ path: file, mode: "100644", type: "blob", sha: null });
      // fData.sha 仅用于日志
      void fData.sha;
    }

    if (treeEntries.length === 0) {
      return new Response(JSON.stringify({ ok: true, note: "nothing to delete" }), {
        headers: { "content-type": "application/json" },
      });
    }

    // 5) 构造树、提交、更新引用（单提交）
    const tree = await (
      await gh(token, "POST", `/repos/${owner}/${repo}/git/trees`, {
        base_tree: baseTree,
        tree: treeEntries,
      })
    ).json();
    const newCommit = await (
      await gh(token, "POST", `/repos/${owner}/${repo}/git/commits`, {
        message: `chore: delete ${file} via web player`,
        tree: tree.sha,
        parents: [commitSha],
      })
    ).json();
    await gh(token, "PATCH", `/repos/${owner}/${repo}/git/refs/heads/${branch}`, {
      sha: newCommit.sha,
      force: false,
    });

    return new Response(
      JSON.stringify({ ok: true, commit: newCommit.sha, removed: treeEntries.map((e) => e.path) }),
      { headers: { "content-type": "application/json" } }
    );
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: String(e && e.message ? e.message : e) }),
      { status: 500, headers: { "content-type": "application/json" } }
    );
  }
}
