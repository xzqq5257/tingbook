# 听我读 / 倾听你的声音 —— 整体逻辑与工具串联梳理

> 整理日期：2026-08-03
> 目标：把项目从「离线预生成音频书」到「在线实时克隆音」、再到「换声 / 删除」的完整逻辑与工具依赖关系一次讲清。

---

## 0. 一句话定位

这是一个**静态有声书网站**（Cloudflare Pages 托管 `index.html`），有两个声音来源：

1. **预生成音频书**（`audio/*.mp3`）——离线用 TTS 引擎合成好、提交到 GitHub、部署后直接播放。
2. **实时克隆音**（听我读面板）——在线把文字发给云端 F5-TTS 服务，用你的参考音实时合成并播放。

网站本体无法跑 TTS（浏览器/静态站没有 torch），所以「真正的克隆音色」必须靠一个**独立部署的 F5 推理服务**（ModelScope 创空间） + Cloudflare 函数做代理来承载。

---

## 1. 模块总览与目录

```
tingbook/
├── index.html                 # 前端单页：播放器 + 「听我读」克隆音面板
├── functions/api/
│   ├── ting-read.js           # 代理：文本 → F5 服务 → 返回 wav
│   ├── voice-source.js        # 一键换声：参考音上传到 GitHub + 通知 F5 热刷新
│   └── delete.js              # 删除音频：从 GitHub 删文件 + 从 BOOKS 移除条目
├── tts/server.py              # F5 推理服务（本地开发版）
├── modelscope_space/          # F5 推理服务（云端部署版，打包成容器）
│   ├── server.py              # 端口7860、后台预热、/app/ckpts 本地权重
│   ├── app.py / Dockerfile / requirements.txt
│   ├── download_ckpts.py      # 构建期下载权重到 /app/ckpts
│   └── README.md
├── audio/                     # 预生成的 mp3（离线合成产物）
├── listen-to-your-voice/      # 克隆参考音 ltyv_reference.wav
└── ARCHITECTURE.md            # 本文件

（上层 workspace 根目录还有离线合成脚本：synth_ltyv.py / synth_book.py / batch_resynth.py / f5_resynth.py / regen_all.py …）
```

外部依赖：
- **GitHub 仓库** `xzqq5257/tingbook` —— 站点源码与音频的"真源"，推送即触发 Cloudflare 重新部署。
- **ModelScope 创空间** `wuyongss-tingbook-f5` —— F5 推理服务实际运行处（服务域名 `https://wuyongss-tingbook-f5.ms.show`）。
- **Cloudflare Pages** —— 托管静态站 + 运行 Functions 代理。

---

## 2. 三条工具串联链路

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
git push → GitHub 仓库 xzqq5257/tingbook
   │
   ▼
Cloudflare Pages 自动重新部署 → 访客可见新音频书
```

要点：
- 两个离线脚本用**不同的 TTS 引擎**：F5 做"真克隆"，火山做"通用优质音"。
- `synth_ltyv.py` 还负责产出**克隆参考音** `ltyv_reference.wav`，这是后面在线克隆音的"音色基准"。
- 这一步的产物是静态 `mp3`，运行时零算力、零延迟。

### 链路 B：在线实时克隆音（用户每次朗读触发）

```
用户在「听我读」面板输入文字，选 🎙克隆音
   │
   ▼
index.html → fetch('/api/ting-read', {text})           同源、无密钥泄露
   │
   ▼
Cloudflare Function: functions/api/ting-read.js
   │   读环境变量 F5_TTS_URL，POST <F5_TTS_URL>/generate
   │
   ▼
ModelScope 上的 F5 服务 (modelscope_space/server.py)
   │   ├─ 权重：/app/ckpts/F5TTS_Base/model_1200000.safetensors（构建期预置）
   │   ├─ 参考音：从 GitHub 拉 listen-to-your-voice/ltyv_reference.wav（首次/热刷新）
   │   └─ model.infer(ref_audio, gen_text) → wav
   │
   ▼
wav 沿路返回 → 浏览器用临时 Audio 播放
```

要点：
- 前端只跟同源 `/api/ting-read` 通信；F5 真实地址只在 Cloudflare 环境变量里，**不进前端代码**。
- F5 服务有**后台预热**：部署后数十秒加载好 1.3GB 权重，`/health` 立即返回（绕过平台健康检查超时）。合成时若恰在加载中，返回 503 + `{retry:true}`，前端可稍后重试。
- 若 `F5_TTS_URL` 未配置或请求失败，前端自动降级到浏览器内置 `speechSynthesis`（🖥系统嗓音）。

### 链路 C：一键换声 / 删除（写回 GitHub，全站生效）

```
【换声】
用户上传新参考音 wav
   → index.html POST /api/voice-source (multipart + x-admin-key 门禁)
   → Function 用服务端 GH_TOKEN 写入 GitHub: listen-to-your-voice/ltyv_reference.wav
   → 若配了 F5_TTS_URL，再 POST <F5_TTS_URL>/refresh-ref 让 F5 热拉新参考音
   → 下次克隆音即用新音色（无需重启服务）

【删除】
用户点某篇删除
   → index.html POST /api/delete {file} (x-admin-key)
   → Function 用 GH_TOKEN 删除仓库 audio/xxx.mp3，并从 index.html 的 BOOKS 移除该条目
   → 单次 Git commit 提交 → Cloudflare 重新部署 → 删除对所有访客生效
```

要点：
- 两条写操作都**只在 Cloudflare 服务端持有 GitHub 写权限**（fine-grained PAT，仅授权该仓库 Contents 读写），前端看不到任何密钥。
- 靠 `x-admin-key` 做基本门禁（默认 `ltyv-del-2026`），非强鉴权。

---

## 3. 前端（index.html）内部逻辑

- **书单数据**：`BOOKS` 数组，每本书 `{title, duration, text, file:"audio/xxx.mp3"}`。`text` 用于字幕分句与点击定位。
- **播放器**：`<audio preload="none">` 流式播放；`playBook(b)` / `playItem(i)` 控制单篇与列表。
- **列表循环（已修复）**：`ended` 事件 + `timeupdate` 兜底双保险，配合 `advanceGuard` 防重复跳曲；
  模式 `off / 🔂 单曲循环 / 🔁 列表循环`。
- **字幕分句**：`renderSubtitle(text)` 把文本切成 `.sent` 句；`buildTimeline` 用音频时长估算每句时间轴；`highlight` 随播放进度高亮当前句。
- **续播/进度**：`timeupdate` 时把 `(file, currentTime)` 存 localStorage，下次打开从该位置续播。
- **听我读面板**：`tingCloneSpeak()` 调 `/api/ting-read`；失败降级系统嗓音。`resolveTingText()` 支持直接输篇名（如「将进酒」）自动取文本。

---

## 4. F5 推理服务关键设计

| 项 | 说明 |
|---|---|
| 接口 | `GET /health`、`POST /generate`、`POST /refresh-ref`、`POST /prepare` |
| 端口 | 本地 8000；容器由 Dockerfile `ENV F5_PORT=7860` 覆盖（ModelScope 探测端口） |
| 权重定位优先级 | ① `F5_CKPT` 显指 → ② `/app/ckpts`（构建期预置）→ ③ 运行时从 ModelScope 下载 |
| 参考音 | `REF_URL`（GitHub raw）优先用 API contents 拉取避 CDN 缓存；`/refresh-ref` 热更新 |
| 预热 | 启动时后台线程加载模型，`/health` 不阻塞；`do_generate` 最多等 50s |
| 国内网络 | `HF_ENDPOINT=https://hf-mirror.com`，权重走镜像 |

---

## 5. 必须配置的环境变量（Cloudflare Pages → Settings → Environment variables，Production + Preview 都设）

| 变量 | 用途 | 缺失后果 |
|---|---|---|
| `F5_TTS_URL` | 指向 F5 服务 `https://wuyongss-tingbook-f5.ms.show`（末尾无斜杠） | 克隆音全部降级系统嗓音 |
| `GH_TOKEN` | fine-grained PAT，仅授权 `xzqq5257/tingbook` Contents 读写 | 换声/删除功能 500 |
| `REPO_OWNER` | `xzqq5257` | 换声/删除功能 500 |
| `REPO_NAME` | `tingbook` | 换声/删除功能 500 |
| `ADMIN_KEY` | 门禁暗号（默认 `ltyv-del-2026`，需与前端一致） | 换声/删除 401 |

---

## 6. 当前状态与待办

- ✅ ModelScope 部署包已修通（端口 7860 / 懒加载 / 权重预置 / pip 源稳定）。
- ✅ 列表循环自动续播已修复（ended + timeupdate 兜底 + advanceGuard）。
- ⏳ **待验证**：`F5_TTS_URL` 接入后首次朗读是否通畅（免费 CPU 实例仍可能冷加载慢，必要时升 GPU）。
- ⏳ **待定功能**：点击某句文字"重新生成该段克隆音"（已与你确认需明确点击行为：预览试听 / 加按钮 / 替换整篇）。
- ⚠️ 风险：F5 服务参考音需连 GitHub；若实例网络受限，`/generate` 会 500，可把参考音也预置进镜像规避。
