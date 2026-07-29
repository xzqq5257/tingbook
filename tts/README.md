# Listen To Your Voice — 真实语音克隆 TTS 集成

本项目已接入**真实可读的语音克隆 TTS**（基于 [F5-TTS](https://github.com/SWivid/F5-TTS)，亦可换用 GPT-SoVITS）。
声纹参考音频为仓库外的 `wuyongss.wav`（女声，中位基频 ~265Hz）。

> ⚠️ 为什么云端目前是「音色演示」而非真实克隆语音？
> 当前构建/沙箱环境**无 GPU**，且 HuggingFace / GitHub 被网络拦截，无法拉取 vocoder（`vocos-mel-24khz`）权重，
> 同时 torch/torchaudio 的 ABI 不匹配会导致推理进程崩溃。因此真实语音需在**具备 GPU 且可访问 HuggingFace 的机器**上生成。
> 下方脚本已就绪，一键即可生成全部真实可读语音并覆盖 `audio/*.mp3` 与 `listen-to-your-voice/`。

## 在本地（GPU 机器）生成真实语音

```bash
cd tts
pip install -r requirements.txt

# 1) 下载模型（F5TTS 权重从 ModelScope 拉取；vocos vocoder 首次运行会自动从 HuggingFace 下载）
python download_models.py

# 2) 单条试听：用 wuyongss 声纹克隆朗读《葬花吟》
python infer.py --ref ../path/to/wuyongss.wav --text "花谢花飞花满天，红消香断有谁怜。" --out ../listen-to-your-voice/ltyv_read_zanghuayin.wav

# 3) 一键生成全部：24 本有声书 + 葬花吟，覆盖 audio/*.mp3 与 listen-to-your-voice/
python generate_all.py --ref ../path/to/wuyongss.wav
```

生成后用任意方式推回仓库（或在本目录直接 `git push`），站点即获得**真实可读**的 wuyongss 声纹语音。

## 新增书目（重要）

**全部朗读内容都来自 `index.html` 里的 `BOOKS` 数组**——`generate_all.py` 通过 `json.loads` 解析它来批量生成真实语音。
因此「加一本新书」只需要往 `BOOKS` 加一条，真实语音会在下次 `tts-generate` 运行时自动生成并覆盖。

### 步骤（以《侠客行》为例）
1. **准备文本**：把全文写进 `BOOKS` 条目里的 `text` 字段，句子间用 `\n` 换行（会被解析器合并为逗号分隔）。
2. **在 `index.html` 的 `BOOKS` 数组末尾追加一条**（保持 JSON 格式、字段齐全）：
   ```js
   {title:"侠客行", duration:42, text:"赵客缦胡缨，吴钩霜雪明。\n银鞍照白马，飒沓如流星。", file:"audio/侠客行.mp3"},
   ```
   - `duration` 可先估算（秒），仅用于播放页进度展示，真实语音生成后不影响功能。
   - `file` 命名为 `audio/<书名>.mp3`，与 `generate_all.py` 的输出路径一致即可。
3. **（可选）先放一个试听占位**：若想马上能听（参数化音色演示，非真实语音），可用仓库里的
   `synth_wuyongss.py` 按 wuyongss 声纹画像合成一个 `audio/<书名>.mp3`；等 GPU runner 跑过一次后会被真实语音覆盖。
4. **推送**：`git push origin main` 后——GitHub Pages 与 Cloudflare Pages（`tingbook.pages.dev`）都会自动重新部署；
   若同时接了 GPU runner，真实语音生成完会再自动部署一次（见下方「自动生成」）。

> 💡 脚本 `add_xiakexing.py`（工作区根目录）就是「合成参数化试听 + 插入 BOOKS」的完整示例，新增其他书目时照抄即可。
> ⚠️ `BOOKS` 是**标准 JSON 数组**（`"title": "..."` 带引号键），不要写成老式 `title:"..."`，否则 `generate_all.py` 解析会失败、真实语音生成不出。

## 切换为 GPT-SoVITS（可选）
如需更高拟真度，可改用 GPT-SoVITS：用 `wuyongss.wav` 作为参考音频，运行其 few-shot 推理，
输出同样的文件名（`listen-to-your-voice/ltyv_read_zanghuayin.wav`、`audio/<书名>.mp3`）即可无缝替换。

## 自动生成（GitHub Actions · 自备 GPU Runner）

仓库已内置 `.github/workflows/tts-generate.yml`：在你**自备的 GPU runner** 上自动跑真实语音克隆并把生成的音频推回仓库，GitHub Pages 随即重新发布。

前置条件（一次性）：
1. 在仓库 **Settings → Actions → Runners** 添加一个 **self-hosted runner**，机器需具备 **NVIDIA GPU + CUDA + 可访问 HuggingFace / ModelScope 的网络**。
2. 把 runner 的 label 配成 `gpu`（或把 workflow 里的 `runs-on: [self-hosted, gpu]` 改成你的 label）。
3. 仓库 **Settings → Secrets → Actions** 新增 `GH_PAT`：一个有 `repo` 写权限的 Personal Access Token（用于把生成的音频推回 main）。

触发方式：
- **手动**：Actions 页面选 `TTS Generate (GPU Runner)` → Run workflow（可填 `nfe_step`）。
- **定时**：每周一 03:17 UTC 自动重生成。
- **改代码即触发**：push 改动 `tts/**` 或 `listen-to-your-voice/ltyv_reference.wav` 时自动重生成。

流程：checkout（带 GH_PAT）→ 装 CUDA torch + tts 依赖 → `download_models.py` 拉 F5TTS 权重 → `generate_all.py` 生成全部真实语音（含 BOOKS 中的 24 本有声书 + 葬花吟）→ 提交并 push `audio/` 与 `listen-to-your-voice/`。push 仅改动这俩目录、不会再次触发本 workflow（路径不匹配），且会顺带触发 Pages 部署校验。

## 关键参数
- `ref_text`：参考音频的字幕文本。若能提供 wuyongss.wav 的文字内容，克隆质量会明显更好；缺省留空也能克隆音色。
- `nfe_step`：推理步数（默认 32，越大越慢越稳）。
- `device`：自动检测 CUDA；无 GPU 时用 CPU（很慢，仅建议小样测试）。

## 从播放页彻底删除音频（后端同步删除）

播放页每张卡片的 🗑 按钮现在**不仅本地隐藏，还会真正删除服务器上的文件**：点击后前端 `POST /api/delete { file }` 调 Cloudflare Pages Function（`functions/api/delete.js`），由服务端用 GitHub token 经 Git Data API **删除音频文件并从 `index.html` 的 BOOKS/LTYV 移除条目**，提交到 `main` 后 GitHub Pages 与 Cloudflare Pages 自动重新部署，删除对所有访客生效。

需要的 Cloudflare Pages 环境变量（Dashboard → 你的 Pages 项目 → Settings → Environment variables，作用域 Production）：
- `GH_TOKEN`：有 `repo` 写权限的 GitHub Personal Access Token（用于提交删除）。
- `REPO_OWNER`：`xzqq5257`
- `REPO_NAME`：`tingbook`
- `ADMIN_KEY`：一个自定义暗号字符串。

前端 `index.html` 里也有一个 `const ADMIN_KEY = "";`，**必须把它改成和 Cloudflare 的 `ADMIN_KEY` 环境变量相同的值**，否则 `/api/delete` 会被函数拒绝（此时删除按钮仅做本地隐藏）。该暗号是基本门禁（会出现在浏览器 JS 中，非强鉴权），目的是避免被随意调用；真正的权限边界由 `GH_TOKEN` 的写范围决定。

安全/实现要点：
- 路径白名单：函数只允许删除 `audio/` 或 `listen-to-your-voice/` 下的 `.mp3`/`.wav`，并拒绝 `..` / 绝对路径，无法删除 `index.html` 等其它文件。
- 删除通过单提交（base_tree）完成，同时移除 `index.html` 条目与音频 blob；若音频已不存在则仅更新 `index.html`。
- 在 GitHub Pages（`xzqq5257.github.io/tingbook`，纯静态、无 Functions）上 `/api/delete` 不存在，删除按钮自动退化为「仅本地隐藏」，行为安全。
