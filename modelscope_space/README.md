# Tingbook F5-TTS 服务（ModelScope 创空间版）

「听我读 · 克隆音」的运行时推理后端。纯 HTTP 服务，默认监听 8000（可用 `F5_PORT` 覆盖）。

## 接口
- `GET  /health`  → `{"ok":true,"loaded":bool,"device":"cpu"}`
- `POST /generate` → `audio/wav`
  - body(JSON): `{"text":"要合成的文本","ref":"ltyv_reference.wav","nfe_step":16,"speed":1.0}`
- `POST /refresh-ref` → 从 `REF_URL` 重新拉取参考音（换声后无需重启）

## 部署（ModelScope Docker 创空间）
1. modelscope.cn 登录 → 新建**创空间**，类型选 **Docker / 自定义**，可见性 **Public**（需先绑定阿里云账号+实名）。
2. 把本目录 5 个文件推到创空间仓库根目录。
3. 等构建完成，访问 `<空间地址>/health` 看到 `loaded:true` 即成功。
4. 复制空间地址，填到 Cloudflare 环境变量 `F5_TTS_URL`（末尾不带 `/`），保存并 Redeploy。

## 说明
- 权重按 `model_type=F5TTS_Base` 在**首次启动**时自动下载（已配置 HF 镜像源 `hf-mirror.com`）。
- 参考音默认从 GitHub raw 拉取 `listen-to-your-voice/ltyv_reference.wav`，可用 `REF_URL` 环境变量覆盖。
- 端口：若平台要求固定端口（如 7860），在创空间环境变量设 `F5_PORT=7860` 即可。
