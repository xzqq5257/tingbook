# 倾听你的声音（听我读 tingbook）

用**克隆人声**朗读古典诗文的听书 Web App —— 有声书 + 电子书阅读器 + 相册 + 实时声音克隆，一条龙。

- **线上地址**：<https://tingbook.pages.dev/>
- **部署平台**：Cloudflare Pages（静态资源 + Pages Functions + KV）
- **代码仓库**：`xzqq5257/tingbook`（main 分支即生产，push 自动触发部署）

## 功能一览

| 模块 | 说明 |
|---|---|
| 📚 有声书 | **40 本**古典诗文 MP3（`audio/`），按需流式加载、断点续播（localStorage + IndexedDB 双后端）、倍速、定时关闭、同步字幕 |
| 📖 电子书阅读器 | Canvas 逐字排版引擎（`js-reader.js`），字号/行距/边距/主题可调，诗词整本居中、散文首行缩进 |
| 🖼 相册 | 26 张照片（`photos/` + `manifest.json` 清单），CF 边缘**静态直出** `/photos/*`（immutable 缓存 1 年），支持上传/删除 |
| 🎙 声音克隆 | 阿里云百炼 CosyVoice（`cosyvoice-v3.5-plus`）：上传参考音频 → 注册音色 → 实时合成「听我读」；「一键换声」直接改仓库参考音并清缓存 |
| 👤 账号系统 | 登录/登出/会话（`functions/_lib/session.js`），密码门（siteGate）保护站点，登录日志 |
| 🎨 界面 | 阅读 / 音乐 / 相册 / 我的 多栏布局，背景相册随机轮换（5 分钟交叉淡入） |

## 目录结构

```
index.html              # 入口页（~20KB，资源外置后）
assets/                 # CSS/JS/图片（immutable 缓存 1 年，改后须更新 index.html 的 ?v= 令牌）
audio/                  # 40 本有声书 MP3（缓存 7 天，支持 Range）
photos/                 # 相册图片 + manifest.json 清单（静态直出）
functions/              # Cloudflare Pages Functions
  api/                  #   13 个接口：login/logout/me/login-log/voices/voice-active/
                        #   voice-audio/voice-source/ting-read/album-list/album-upload/
                        #   album-delete/delete
  _lib/session.js       #   会话工具
tts/                    # TTS 合成脚本（ModelScope 容器内用）
hf_space/               # Hugging Face Space（F5-TTS）
modelscope_space/       # ModelScope 创空间 wuyongss/tingbook-f5（F5-TTS 语音克隆服务）
listen-to-your-voice/   # 配套资料
.github/workflows/      # cloudflare-pages-deploy.yml（wrangler 部署）
                        # pages-validate.yml（构建校验）
                        # tts-generate.yml（TTS 生成）
wrangler.toml           # pages_build_output_dir = "."（Pages 根 = repo 根）
_headers                # 缓存策略：/assets/* 与 /photos/* immutable 1 年；/audio/* 7 天；HTML 不缓存
ARCHITECTURE.md         # 架构文档
DEPLOY_CHECKLIST.md     # 部署检查清单
```

## 关键外部依赖

| 服务 | 用途 | 所需凭据（CF 环境变量） |
|---|---|---|
| 阿里云百炼 | CosyVoice 音色注册 + 语音合成 | `ALIYUN_BAILIAN_API_KEY`、`ALIYUN_WORKSPACE_ID` |
| Cloudflare KV | 会话 + 音色 ID 缓存（`TINGBOOK_KV`，音色缓存 TTL 1 年） | 绑定 `TINGBOOK_KV` |
| GitHub API | 「一键换声」回写仓库参考音（`/api/voice-source`） | `GH_TOKEN`（GitHub classic PAT，**勿填 CF token**） |
| ModelScope 创空间 | F5-TTS 克隆音服务 | — |

## 部署流程

push 到 `main` 后三套并行，全部 success 才算真上线：

1. **GitHub Actions `cloudflare-pages-deploy.yml`**：`npx wrangler pages deploy . --project-name=tingbook --branch=main`
2. **GitHub Actions `pages-validate.yml`**：构建校验
3. **Pages 内置 Git 集成**：自动构建（被 wrangler 抢活时显示 cancelled 属正常）

验证只看裸域 `https://tingbook.pages.dev/`（HTTP 200）；hash 子域被 Access 挡，不能用来判活。

## 本地开发 / 维护速查

```bash
# 增删相册图片后：更新 photos/ 目录，再重新生成 photos/manifest.json 并 push
# 改 assets/ 下 css/js 后：同步更新 index.html 的 ?v= 令牌（否则用户拿到的还是一年缓存）
# 改 functions/ 后：push 即生效（Functions 随 Pages 原子发布）
```

更多细节见 [ARCHITECTURE.md](ARCHITECTURE.md) 与 [DEPLOY_CHECKLIST.md](DEPLOY_CHECKLIST.md)。
