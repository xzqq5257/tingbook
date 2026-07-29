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

# 3) 一键生成全部：23 本有声书 + 葬花吟，覆盖 audio/*.mp3 与 listen-to-your-voice/
python generate_all.py --ref ../path/to/wuyongss.wav
```

生成后用任意方式推回仓库（或在本目录直接 `git push`），站点即获得**真实可读**的 wuyongss 声纹语音。

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

流程：checkout（带 GH_PAT）→ 装 CUDA torch + tts 依赖 → `download_models.py` 拉 F5TTS 权重 → `generate_all.py` 生成全部真实语音 → 提交并 push `audio/` 与 `listen-to-your-voice/`。push 仅改动这俩目录、不会再次触发本 workflow（路径不匹配），且会顺带触发 Pages 部署校验。

## 关键参数
- `ref_text`：参考音频的字幕文本。若能提供 wuyongss.wav 的文字内容，克隆质量会明显更好；缺省留空也能克隆音色。
- `nfe_step`：推理步数（默认 32，越大越慢越稳）。
- `device`：自动检测 CUDA；无 GPU 时用 CPU（很慢，仅建议小样测试）。
