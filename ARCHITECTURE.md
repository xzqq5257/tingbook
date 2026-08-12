# 听我读 / 倾听你的声音 —— 整体逻辑与工具串联梳理

> 整理日期：2026-08-12
> 目标：把项目从「离线预生成音频书」到「在线实时克隆音」、再到「换声 / 删除 / 多音色切换 + 账号管理」的完整逻辑与工具依赖关系一次讲清。
> 最近一次重大重构：**前端三栏框架（阅读 / 音乐 / 我的）+ 单管理员登录（KV 会话）+ 多音色仓库（KV 存储）**，F5 后端 `/generate` 支持调用方内联 `ref_audio`。

---

## 0. 一句话定位

这是一个**静态有声书网站**（Cloudflare Pages 托管 `index.html`），有三个声音来源：

1. **预生成音频书**（`audio/*.mp3`）——离线用 TTS 引擎合成好、提交到 GitHub、部署后直接播放。
2. **实时克隆音**（听我读面板）——在线把文字发给云端 F5-TTS 服务，用「当前激活音色」的参考音实时合成并播放。
3. **我的音色仓库**（多音色切换）——管理员在「我的」标签页上传多个参考音，随时切换「当前用于克隆的音色」。

网站本体无法跑 TTS（浏览器/静态站没有 torch），所以「真正的克隆音色」必须靠一个**独立部署的 F5 推理服务**（ModelScope 创空间） + Cloudflare 函数代理来承载；而「账号」与「音色仓库」这类需要持久化的状态，则由 **Cloudflare KV** 承载。

---

## 1. 模块总览与目录

```
tingbook/
├── index.html                 # 前端单页：三栏框架（阅读 / 音乐 / 我的）+ 播放器 + 听我读 + 音色仓库
├── wrangler.toml              # Cloudflare Pages 配置：pages_build_output_dir + TINGBOOK_KV 绑定
├── functions/
│   ├── _lib/session.js        # 共享登录态工具（KV 会话 / HttpOnly Cookie tb_session）
│   └── api/
│       ├── login.js           # POST 管理员登录（校验 ADMIN_USER/ADMIN_PASS，签发 KV 会话）
│       ├── logout.js          # POST 登出（清 KV 会话 + 清 Cookie）
│       ├── me.js              # GET 当前登录态
│       ├── voices.js          # GET 列表 / POST 上传 / DELETE 删除（KV 存储，写操作需登录）
│       ├── voice-active.js    # GET 当前激活音色 / POST 设置激活
│       ├── voice-audio.js     # GET 取某音色参考音（audio/wav，需登录）
│       ├── ting-read.js       # 代理：文本 → 取激活音色 ref_audio → F5 /generate → 返回 wav
│       ├── voice-source.js    # 【遗留】一键换声：参考音上传 GitHub + 通知 F5 热刷新（x-admin-key）
│       └── delete.js          # 【遗留】删除音频：GitHub 删文件 + BOOKS 移除（x-admin-key）
├── tts/server.py              # F5 推理服务（本地开发版）
├── modelscope_space/          # F5 推理服务（云端部署版，打包成容器）
│   ├── server.py              # 端口7860、后台预热、/app/ckpts 局部权重、支持 ref_audio 内联参考音
│   ├── app.py / Dockerfile / requirements.txt
│   ├── download_ckpts.py      # 构建期下载权重到 /app/ckpts
│   └── README.md
├── audio/                     # 预生成的 mp3（离线合成产物）
├── listen-to-your-voice/      # 克隆参考音 ltyv_reference.wav（构建期也会烤入镜像 ref/）
└── ARCHITECTURE.md            # 本文件
```

外部依赖：
- **GitHub 仓库** `xzqq5257/tingbook` —— 站点源码与音频的"真源"，推送即触发 Cloudflare 重新部署。
- **ModelScope 创空间** `wuyongss-tingbook-f5` —— F5 推理服务实际运行处（服务域名 `https://wuyongss-tingbook-f5.ms.show`）。
- **Cloudflare Pages** —— 托管静态站 + 运行 Functions 代理 + 绑定 KV（TINGBOOK_KV）做账号/音色持久化。

---

## 2. 核心链路

### 链路 A：离线预生成音频书（一次性，运维动作）

```
原始文本/篇目
   │
   ├─ synth_ltyv.py   ── 用【本地 F5-TTS】克隆 wuyongss 嗓音
   │       （读 tts_models/F5TTS_Base 权重 + D:/.../wuyongss.wav 参考音）
   │       → 生成 audio/*.mp3 + 复制 listen-to-your-voice/ltyv_reference.wav
   │
   └─ synth_book.py   ── 用【字节火山 openspeech API】「纯净」音色
           （远程 API：APPID/TOKEN/SPK，无需本地 torch）
           → 生成 audio/*.mp3，并自动把条目注入 index.html 的 BOOKS 数组
   │
   ▼
git push → GitHub 仓库 xzqq5257/tingbook → Cloudflare Pages 自动重新部署 → 访客可见新音频书
```

要点：两个离线脚本用**不同的 TTS 引擎**：F5 做"真克隆"，火山做"通用优质音"。这一步的产物是静态 `mp3`，运行时零算力、零延迟。

### 链路 B：在线实时克隆音（含多音色切换）

```
用户在「听我读」面板输入文字，选 🎙 克隆音
   │
   ▼
index.html → fetch('/api/ting-read', {text})
   │
   ▼
Cloudflare Function: functions/api/ting-read.js
   │   1) 读环境变量 F5_TTS_URL，POST <F5_TTS_URL>/generate
   │   2) 若配置了 TINGBOOK_KV 且存在「激活音色」：
   │       取 voice:audio:<activeId>（参考音 base64）→ 作为 ref_audio 传给 F5
   │       → F5 用「用户选定音色」克隆，而非服务端固定参考音
   │   3) 若没有激活音色 / KV 未配置：回退 F5 默认参考音（镜像内预置 ltyv_reference.wav）
   │
   ▼
ModelScope 上的 F5 服务 (modelscope_space/server.py)
   │   ├─ 权重：/app/ckpts/F5TTS_Base/model_1200000.safetensors（构建期预置）
   │   ├─ 参考音优先级：① 请求内联 ref_audio（base64→临时 wav）→ ② 镜像内 /home/user/app/ref/ltyv_reference.wav
   │   └─ model.infer(ref_audio, gen_text) → wav
   │
   ▼
wav 沿路返回 → 浏览器用临时 Audio 播放
```

要点：
- 前端只跟同源 `/api/ting-read` 通信；F5 真实地址只在 Cloudflare 环境变量里，**不进前端代码**。
- **多音色**：`/api/ting-read` 不再依赖服务端固定参考音，而是动态取「当前激活音色」的参考音；在「我的」标签页切换激活音色后，下一次朗读即用新音色。
- F5 服务有**后台预热**：部署后数十秒加载好 1.3GB 权重，`/health` 立即返回；合成时若恰在加载中，返回 503 + `{retry:true}`，前端可稍后重试。
- 若 `F5_TTS_URL` 未配置或请求失败，前端自动降级到浏览器内置 `speechSynthesis`（🖥 系统嗓音）。

### 链路 C：管理员登录 + 我的音色仓库（KV 持久化）

```
【登录】
管理员在「我的」标签页输入 ADMIN_USER / ADMIN_PASS
   → index.html POST /api/login {user, pass}
   → Function 校验环境变量 ADMIN_USER / ADMIN_PASS（单管理员模式）
   → 签发随机 token，存 KV（session:<token>，7 天 TTL）
   → 以 HttpOnly Cookie tb_session 下发浏览器
   → 之后每次请求自动带 Cookie，/api/me 返回 {authed:true,user}

【音色仓库 CRUD】（均需登录态）
上传：POST /api/voices（multipart: file + name + 可选 refText）
      → 参考音以 base64 存 KV（voice:audio:<id>），元数据存 voice:<id>
      → 首个音色自动设为激活（voice:active）
列表：GET  /api/voices → {voices:[{id,name,refText,...}], active}
试听：GET  /api/voice-audio?id= → audio/wav
切换：POST /api/voice-active {id} → 写 voice:active（下次朗读即用此音色）
删除：DELETE /api/voices?id= → 删 voice:<id> + voice:audio:<id>，若删的是激活则清 voice:active
```

要点：
- **账号体系 = 单管理员模式**：账号密码来自 Cloudflare 环境变量（ADMIN_USER/ADMIN_PASS），不落库；登录态存 KV，浏览器只持 HttpOnly Cookie，前端拿不到明文 token。
- **音色仓库 = KV 多值存储**：参考音以 base64 字符串存 KV，规避二进制兼容问题；元数据与音频分开键，便于列表与试听。
- 未登录时，「我的」标签页只显示登录框，不暴露任何音色管理入口。

### 链路 D（遗留）：一键换声 / 删除（写回 GitHub，全站生效）

> 这是重构前的旧链路，仍保留可用，但与新的 KV 音色仓库是两套独立机制。

```
【换声】POST /api/voice-source（x-admin-key 门禁）→ Function 用 GH_TOKEN 写入 GitHub listen-to-your-voice/ltyv_reference.wav
        → 若配了 F5_TTS_URL，再 POST <F5_TTS_URL>/refresh-ref 热拉新参考音
【删除】POST /api/delete {file}（x-admin-key）→ Function 用 GH_TOKEN 删仓库 audio/xxx.mp3 并从 BOOKS 移除
```

要点：两条写操作只在 Cloudflare 服务端持有 GitHub 写权限（fine-grained PAT），靠 `x-admin-key` 做基本门禁（非强鉴权）。新需求「多音色切换」已由链路 C 的 KV 仓库取代，此旧链路可保留作兜底或后续清理。

---

## 3. 前端三栏框架（index.html）

- **三栏 Tab**：`<nav class="tabs" id="main-tabs">` 含三个按钮（📖 阅读 / 🎵 音乐 / 👤 我的），对应 `<section id="tab-reading|tab-music|tab-mine">`。Tab 选中态持久化到 localStorage。
- **阅读**：原播放器 / 听我读面板 / 书单全部保留在此栏（原有 JS 逻辑未改动）。听我读状态栏会显示「当前克隆音色：<名>」（来自 `/api/voice-active` + `/api/voices`）。
- **音乐**：占位框架（后续接入音乐相关能力）。
- **我的**：未登录显示登录框；登录后显示「我的音色仓库」——音色列表（试听 / 设为当前 / 删除）+ 上传新音色表单（name + 参考音音频 + 可选参考文本）。

---

## 4. F5 推理服务关键设计

| 项 | 说明 |
|---|---|
| 接口 | `GET /health`、`POST /generate`、`POST /refresh-ref`、`POST /prepare` |
| 端口 | 本地 8000；容器由 Dockerfile `ENV F5_PORT=7860` 覆盖（ModelScope 探测端口） |
| 权重定位优先级 | ① `F5_CKPT` 显指 → ② `/app/ckpts`（构建期预置）→ ③ 运行时从 ModelScope 下载 |
| 参考音优先级 | ① 请求内联 `ref_audio`（base64→临时 wav）→ ② 镜像内预置 `/home/user/app/ref/ltyv_reference.wav`（构建期 COPY 烤入）→ ③ GitHub `REF_URL` 拉取兜底 |
| `ref_audio` 支持 | 1.1.22 新增：调用方可内联传参考音，实现任意音色克隆（动态音色切换的核心） |
| 预热 | 启动时后台线程加载模型，`/health` 不阻塞；`do_generate` 最多等 50s |
| 国内网络 | `HF_ENDPOINT=https://hf-mirror.com`，权重走镜像；构建期 `download_ckpts.py` 多源 + 重试预置权重与 vocoder |
| 构建 Dockerfile | `RUN python download_ckpts.py`（绝不可退回旧版 `python -c "..."` 内联写法——shell 不解释 `\n`，会 SyntaxError） |

---

## 5. 必须配置的环境变量 / 绑定（Cloudflare Pages）

| 变量 / 绑定 | 用途 | 缺失后果 |
|---|---|---|
| `F5_TTS_URL` | 指向 F5 服务 `https://wuyongss-tingbook-f5.ms.show`（末尾无斜杠） | 克隆音全部降级系统嗓音 |
| `ADMIN_USER` | 管理员登录用户名 | 登录接口 500 |
| `ADMIN_PASS` | 管理员登录密码 | 登录接口 500 |
| `TINGBOOK_KV` | KV 命名空间绑定（存会话/音色）；在 Dashboard 绑定，或在 `wrangler.toml` 写 `[[kv_namespaces]] binding="TINGBOOK_KV"` | 账号/音色仓库 500；ting-read 回退 F5 默认参考音 |
| `GH_TOKEN` |（遗留链路 D）fine-grained PAT，仅授权 `xzqq5257/tingbook` Contents 读写 | 换声/删除功能 500 |
| `REPO_OWNER` |（遗留）`xzqq5257` | 换声/删除功能 500 |
| `REPO_NAME` |（遗留）`tingbook` | 换声/删除功能 500 |
| `ADMIN_KEY` |（遗留）门禁暗号，需与前端一致 | 换声/删除 401 |

> 部署前自检见 `DEPLOY_CHECKLIST.md`：需设 ADMIN_USER/ADMIN_PASS、绑定 KV 命名空间、确认 `wrangler.toml` 的 `binding="TINGBOOK_KV"` 与控制台一致、F5 后端用支持 `ref_audio` 的部署包。

---

## 6. 当前状态与待办

- ✅ ModelScope 部署包已修通（端口 7860 / 懒加载 / 权重预置 / pip 源稳定 / ref_audio 支持 / 参考音烤入镜像）。
- ✅ 前端三栏框架 + 单管理员登录（KV 会话）+ 多音色仓库（KV 存储）已实现并语法校验通过。
- ✅ `/api/ting-read` 已接入「激活音色 ref_audio → F5」链路；全部 Functions 通过 ESM 语法校验，server.py / download_ckpts.py 通过 py_compile。
- ⏳ **待验证（联调）**：本地/线上用管理员登录 → 上传一个参考音 → 设为激活 → 听我读朗读，确认音色确实切换；以及 F5 服务在 ModelScope 构建通过后实际 `/generate` 用 `ref_audio` 合成成功。
- ⏳ **待定**：音乐标签页实际能力；是否清理遗留的 voice-source.js / delete.js（GitHub 写回链路）。
- ⚠️ 风险：F5 构建集群 DNS 偶发抖动（日志中 `Name or service not known` 重试属正常），不影响最终安装；务必用「含 `download_ckpts.py` 的正确 Dockerfile」构建。
