# Tingbook 部署检查清单（Cloudflare 环境变量 + KV + 各功能开关）

> 用途：把站点所有「需在 Cloudflare Dashboard 配置」的项集中成一张表，逐项核对即可。
> 位置：**Cloudflare Dashboard → Workers & Pages → tingbook → Settings → Environment variables / Functions**
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

## 二、账号体系（「我的」登录所需）

| 变量名 | 值 | 说明 |
|---|---|---|
| `ADMIN_USER` | 管理员用户名（自定，如 `admin`） | 登录「我的」Tab 用的账号 |
| `ADMIN_PASS` | 管理员密码（自定，建议强密码） | 登录密码 |

> 单管理员模式：账号密码在服务端环境变量，登录后签发会话存 KV，浏览器持 HttpOnly Cookie。无 ADMIN_USER/ADMIN_PASS 时 /api/login 返回 500 提示。

## 三、KV 命名空间绑定（音色仓库 + 会话存储）

1. Cloudflare Dashboard → **Workers & Pages → KV**（或 **Storage → KV**）→ 新建命名空间，命名如 `tingbook-kv`，记下其 **Namespace ID**。
2. 进入 **Pages → tingbook → Settings → Functions → KV namespace bindings** → 添加绑定：
   - 变量名 / Binding name：**`TINGBOOK_KV`**（必须与代码一致）
   - 选择刚建的命名空间。
3. Production 和 Preview 都绑（或绑定对两个环境生效）。
4. 本地开发：`wrangler.toml` 已配置 `[[kv_namespaces]] binding="TINGBOOK_KV"`，把 id 填成上面那个 ID 即可 `wrangler pages dev` 联调。

> KV 中存储：`session:<token>`（登录会话）、`voice:<id>`（音色元数据）、`voice:audio:<id>`（参考音 base64）、`voice:active`（当前激活音色 id）。

## 四、可选但推荐（听我读·克隆音 生效所需）

| 变量名 | 值 | 说明 |
|---|---|---|
| `F5_TTS_URL` | ModelScope 创空间地址，如 `https://wuyongss-tingbook-f5.ms.show`（**末尾不带斜杠**） | 配置了才走「🎙 克隆音」实时合成；未配置则「听我读」回退到浏览器系统嗓音。需使用已支持 `ref_audio` 的部署包（见下） |

> 不配 `F5_TTS_URL` 时，网站其余功能（播放、删除、浏览器 TTS 朗读、音色仓库 CRUD）全部正常，仅克隆音合成不可用。

---

## 五、逐项自检（勾选）

- [ ] `GH_TOKEN` 是**新建的 fine-grained PAT**（非旧 `ghp_stW…`），且在 GitHub 上仍有效
- [ ] PAT 权限 = `xzqq5257/tingbook` 的 Contents **Read and write**
- [ ] `REPO_OWNER` / `REPO_NAME` / `ADMIN_KEY` 三个值无误
- [ ] `ADMIN_USER` / `ADMIN_PASS` 已设置（「我的」登录用）
- [ ] KV 命名空间已创建，且以绑定名 **`TINGBOOK_KV`** 绑到 Pages 项目（两个环境都绑）
- [ ] Production **和** Preview **都**配了上述变量
- [ ] 改完做了 **Redeploy**
- [ ] 「听我读·克隆音」要用：已部署支持 `ref_audio` 的 F5 服务（最新 `modelscope_space_deploy.zip`）并把地址填进 `F5_TTS_URL`，且 Redeploy
- [ ] 删除按钮自测：点某篇删除 → 前端卡片消失 → GitHub 仓库对应 `audio/xxx.mp3` 也消失（404）
- [ ] 换声自测：上传参考音 → 提示成功 → （若配了 `F5_TTS_URL`）HF 服务自动刷新
- [ ] 账号自测：访问「我的」→ 登录 → 上传一个音色 → 设为默认 → 「听我读」克隆朗读即使用该音色

---

## 六、F5 克隆音后端（ModelScope 创空间）部署速查

1. 下载最新 `modelscope_space_deploy.zip`（已支持 `ref_audio` 自定义参考音、ThreadingHTTPServer、权重/vocoder/参考音烤入镜像）。
2. 把压缩包内 **7 个文件**（server.py / app.py / Dockerfile / requirements.txt / README.md / download_ckpts.py / ref/ltyv_reference.wav）覆盖上传到 ModelScope 创空间，重新部署。
3. 部署后访问 `<服务地址>/health` 看到 `{"ok":true,"loaded":true,"device":"cpu"}`。
4. 复制服务域名填进 Cloudflare 的 `F5_TTS_URL`。
5. 「我的」里上传的音色会经 `/api/ting-read` 作为 `ref_audio` 传给 F5，实现「用户选定音色」克隆。

---

## 七、本地离线重生成全部篇目（换声后想整站换音色时）

```bash
# 在能跑 torch 的机器（GPU runner / 本地 GPU）执行：
python tts/generate_all.py --ref listen-to-your-voice/ltyv_reference.wav
# 生成后推回 GitHub（站点会自动重新部署）
git add audio && git commit -m "regen with new voice" && git push
```

> 说明：网页「🎙 一键换声」上传参考音会**实时**更新线上克隆音（经 F5 服务）；
> 「本地重生成」是另一种路径——把整站篇目的音色一次性换掉并写死进 `audio/*.mp3`。
