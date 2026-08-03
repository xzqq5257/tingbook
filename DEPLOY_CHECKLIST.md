# Tingbook 部署检查清单（Cloudflare 环境变量 + 各功能开关）

> 用途：把站点所有「需在 Cloudflare Dashboard 配置」的项集中成一张表，逐项核对即可。
> 位置：**Cloudflare Dashboard → Workers & Pages → tingbook → Settings → Environment variables**
> 重要：**Production 和 Preview 两个环境都要配**（否则预览/生产有一处功能失效）。
> 改完环境变量需 **Redeploy**（Deployments → 选最新部署 → Redeploy）才生效。

---

## 一、必须配置（删除 / 换声 / 克隆音都依赖）

| 变量名 | 值 | 说明 |
|---|---|---|
| `GH_TOKEN` | 一个 **有效** 的 GitHub PAT（fine-grained，仅授权 `xzqq5257/tingbook` 的 **Contents: Read and write**） | 删除按钮真正删 GitHub 文件；换声上传参考音；**切勿用旧 `ghp_stW…`（已撤销）** |
| `REPO_OWNER` | `xzqq5257` | 仓库归属账号 |
| `REPO_NAME` | `tingbook` | 仓库名 |
| `ADMIN_KEY` | `ltyv-del-2026` | 前端上传/删除接口门禁暗号，**须与前端 `index.html` 一致** |

## 二、可选但推荐（听我读·克隆音 生效所需）

| 变量名 | 值 | 说明 |
|---|---|---|
| `F5_TTS_URL` | 你的 HuggingFace Space 地址，如 `https://xxx-xxx.hf.space`（**末尾不带斜杠**） | 配置了才走「🎙 克隆音」实时合成；未配置则「听我读」回退到浏览器系统嗓音 |

> 不配 `F5_TTS_URL` 时，网站其余功能（播放、删除、换声上传、浏览器 TTS 朗读）全部正常，仅克隆音合成不可用。

---

## 三、逐项自检（勾选）

- [ ] `GH_TOKEN` 是**新建的 fine-grained PAT**（非旧 `ghp_stW…`），且在 GitHub 上仍有效
- [ ] PAT 权限 = `xzqq5257/tingbook` 的 Contents **Read and write**
- [ ] `REPO_OWNER` / `REPO_NAME` / `ADMIN_KEY` 三个值无误
- [ ] Production **和** Preview **都**配了上面 4 个变量
- [ ] 改完做了 **Redeploy**
- [ ] 「听我读·克隆音」要用：已部署 HF Space 并把地址填进 `F5_TTS_URL`（两个环境都配），且 Redeploy
- [ ] 删除按钮自测：点某篇删除 → 前端卡片消失 → GitHub 仓库对应 `audio/xxx.mp3` 也消失（404）
- [ ] 换声自测：上传参考音 → 提示成功 → （若配了 `F5_TTS_URL`）HF 服务自动刷新，`hfRefreshed:true`

---

## 四、HuggingFace Space（克隆音后端）部署速查

1. HuggingFace 新建 **Space**，SDK 选 **Docker**，可见性 **Public**。
2. 把仓库 `hf_space/` 下 4 个文件（`server.py` / `Dockerfile` / `requirements.txt` / `README.md`）推到该 Space。
3. 等构建完成，访问 `<Space URL>/health` 看到 `{"ok":true,"loaded":true}`。
4. 复制 Space 域名填进上面的 `F5_TTS_URL`。
5. （可选）Space 硬件改成 GPU 提速。

---

## 五、本地离线重生成全部 28 篇（换声后想整站换音色时）

```bash
# 在能跑 torch 的机器（GPU runner / 本地 GPU）执行：
python tts/generate_all.py --ref listen-to-your-voice/ltyv_reference.wav
# 生成后推回 GitHub（站点会自动重新部署）
git add audio && git commit -m "regen with new voice" && git push
```

> 说明：网页「🎙 一键换声」上传参考音会**实时**更新线上克隆音（经 HF 服务）；
> 「本地重生成」是另一种路径——把整站 28 篇的音色一次性换掉并写死进 `audio/*.mp3`。
