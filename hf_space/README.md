---
title: Tingbook F5-TTS Voice Server
emoji: 🎙️
colorFrom: blue
colorTo: red
sdk: docker
app_port: 8000
short_description: F5-TTS 克隆音推理服务，供 tingbook「听我读·克隆音」使用
---

# Tingbook F5-TTS Voice Server

把 `tts/server.py` 包装成可直接部署的 **HuggingFace Space**，为 tingbook 网站的
「听我读 · 🎙 克隆音」模式提供实时克隆音合成后端。

## 接口
- `GET /health` → `{"ok":true,"loaded":bool,"device":"cpu"}`
- `POST /generate` → `audio/wav`
  - body： `{"text":"要朗读的文字", "nfe_step":16, "speed":1.0}`
- `POST /refresh-ref` → 从 GitHub raw 重新拉取参考音（换声后热更新，无需重启）

## 部署步骤
1. 在 HuggingFace 新建一个 **Space**，SDK 选 **Docker**，可见性选 **Public**
   （Public 才能被 tingbook 的 Cloudflare Function 跨域访问；音频来自你的克隆音，无敏感数据）。
2. 把本目录（`server.py` / `Dockerfile` / `requirements.txt` / `README.md`）推到该 Space 仓库。
3. 等待构建完成，访问 Space 的 `/health` 确认 `loaded:true`。
4. 复制 Space 的域名 URL（形如 `https://<你的用户名>-<space名>.hf.space`）。

## 让 tingbook 用上它
在 **Cloudflare Dashboard → tingbook 项目 → Settings → Environment variables**
（Production + Preview 都配）加：

| 变量 | 值 |
|---|---|
| `F5_TTS_URL` | 上一步复制的 Space URL（末尾不带斜杠，如 `https://xxx.hf.space`） |

保存并 **Redeploy**。之后在网页「听我读」切到 🎙 克隆音，朗读即为你的克隆音色。

## 换声（修改后续朗读参考音）
1. 在 tingbook 网页用「🎙 一键换声」上传新参考音 → 该文件会写入 GitHub 仓库
   `listen-to-your-voice/ltyv_reference.wav`。
2. 调用本服务的 `POST /refresh-ref`（或重启 Space）拉取最新参考音，克隆音色即更新。

> 模型权重（F5TTS_Base 约 1.3GB）与 vocoder 在首次启动时自动下载，之后由 HF 缓存复用。
