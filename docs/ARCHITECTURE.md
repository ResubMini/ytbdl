# 架构方案 (Architecture)

> **mp4WEB** —— 跨平台 yt-dlp 桌面客户端（Tauri 2 + React + Python sidecar）。
> 本文件是架构决策的**单一事实来源**。当前进度见末尾路线图（✅ 标记已完成）。
> 交接详情见 [`HANDOVER.md`](./HANDOVER.md)。

## 1. 目标与硬约束

| # | 要求 | 状态 |
|---|---|---|
| G1 | 跨平台桌面软件（Win / macOS / Linux），原生窗口 | macOS ✅ / Windows 待 / Linux 未做 |
| G2 | 更新后端(yt-dlp)不影响前端 | ✅ 靠协议层隔离 + **整包更新**（见 §6） |
| G3 | 漂亮的 UI（消费级精致感） | ✅ |
| G4 | 预留登录/收费（后期接云端） | 钩子已留，未实现 |
| G5 | 可商用（许可证允许闭源分发） | ✅ yt-dlp = Unlicense（公共领域） |

## 2. 关键许可证事实

- **yt-dlp = The Unlicense（公共领域）**：允许 commercial / sell / 任意用途，**无传染性**，可闭源分发。
- 第三方 `marcopiovanello/yt-dlp-web-ui` = **GPL-3.0**（衍生须开源）→ 与 G4/G5 冲突 → **后端自研，不复用**。

## 3. 三层解耦模型

```
┌─────────────────────────────────────────────────────────────┐
│ ① 桌面外壳  Tauri 2 (Rust)                                   │
│    拉起/守护 sidecar（随机端口 + token）                      │
│    启动画面（窗口秒开，sidecar 后台并行起）                    │
│    Tauri Updater（App 整包自更新）                            │
│    插件：opener / dialog / clipboard / updater / process     │
└───────────────────────┬─────────────────────────────────────┘
                        │ localhost HTTP + WebSocket (Bearer token)
┌───────────────────────▼─────────────────────────────────────┐
│ ② 协议层  Python sidecar (FastAPI + uvicorn, PyInstaller)    │
│    /v1/* REST + WebSocket /v1/events                         │
│    下载队列 / 并发 / cookie 快照 / 友好错误                   │
│    适配层：yt-dlp 字段 ⇄ /v1/* 协议（吸收上游变更）           │
└───────────────────────┬─────────────────────────────────────┘
                        │ import（随包分发，无 engines/ 热替换）
┌───────────────────────▼─────────────────────────────────────┐
│ ③ 引擎  yt-dlp (Unlicense) + ffmpeg                          │
│    真正干活；打在 PyInstaller sidecar 里，随 App 整包更新      │
└─────────────────────────────────────────────────────────────┘
```

**解耦原理**：前端只认 ② 的 `/v1/*` 协议。yt-dlp（③）任何字段/行为变更，由 ② 适配层吸收，前端无感。

## 4. 技术栈

| 层 | 选型 |
|---|---|
| 外壳 | Tauri 2（Rust） |
| 前端 | React 19 + TypeScript + Vite |
| UI | Tailwind CSS + shadcn/ui + lucide |
| 状态 | Zustand + 原生 WebSocket |
| 后端 | Python + FastAPI + uvicorn |
| 后端打包 | PyInstaller（`--onefile`，每平台一份） |
| 引擎 | yt-dlp（Unlicense）+ ffmpeg（静态二进制） |

## 5. 后端协议契约 `/v1/*`

Sidecar 绑 `127.0.0.1:<随机端口>`，启动带随机 `token`，所有请求 `Authorization: Bearer <token>`。

**REST**
```
GET    /v1/health              → { ok, engine:{version,...}, sidecar_version }
GET    /v1/extract?url=        → 元数据（标题/时长/缩略图/formats[]/audio_languages[]）
POST   /v1/download            → 入队 {url,format,extract_audio,language,...} → { job_id }
GET    /v1/jobs                → 任务列表
GET    /v1/jobs/{id}           → 单任务状态
DELETE /v1/jobs/{id}           → 取消
POST   /v1/jobs/{id}/retry     → 重试
POST   /v1/jobs/{id}/remove    → 从列表移除
GET    /v1/config              → 读取设置
PUT    /v1/config              → 更新设置（下载目录/并发/格式/cookie）
GET    /v1/cookies/browsers    → 探测已装浏览器
GET    /v1/cookies/profiles    → 枚举浏览器 profile
POST   /v1/cookies/import      → 一键导入浏览器 cookie 快照
```

**WebSocket `/v1/events`**
```jsonc
{ "type": "job.created",    "job_id":"..." }
{ "type": "job.progress",   "job_id":"...", "status":"downloading", "speed":..., "eta":... }
{ "type": "job.postprocess","job_id":"...", "status":"processing", "postprocessor":"FFmpegExtractAudio" }
{ "type": "job.finished",   "job_id":"...", "filename":"/path/file.mp4" }
{ "type": "job.error",      "job_id":"...", "error":"友好中文消息" }
{ "type": "job.cancelled",  "job_id":"..." }
{ "type": "job.removed",    "job_id":"..." }
```

**全局异常处理**：`main.py` 的 `@app.exception_handler(Exception)` 在最外层（CORS 中间件之外），**必须自补 CORS 头**，否则裸 500 缺 CORS → 前端只见 `load failed`。

## 6. 更新策略（重要变更：不做引擎热替换）

**决策**：砍掉「运行时热替换 yt-dlp 引擎」方案（原 A 方案）。理由：PyInstaller 冻结后引擎焊死，热替换需破坏自包含、且维护两套更新逻辑=给自己挖坑。

**改为整包更新**（Tauri Updater）：
```
更新 yt-dlp → 发新版 App 包 → Tauri Updater 推送
           → 用户后台下载签名包 → 重启生效
           → 协议层不变，前端无感
```

- Tauri updater 签名密钥：私钥 `src-tauri/.updater-key`（gitignored，**丢失则无法再推更新**），公钥烙在 `tauri.conf.json`。
- 端点：`https://update.mp4web.com/latest.json`（Cloudflare R2 托管，待配置）。
- 发布脚本 `scripts/publish.mjs`：自动构建 + 签名 + 生成 `latest.json`（多平台条目合并）。

## 7. Cookie 方案（解决 YouTube bot-check）

**快照导入**（用户友好）：
- 设置 → 登录信息 → 选浏览器 + profile → 点「导入登录信息」
- 后端抽浏览器 cookie 存成快照文件（`~/.ytbdl/cookies/<browser>.txt`）
- 下载时用快照（不实时读浏览器），避开 YouTube 对打开标签页的 cookie 轮换

**已知限制**：快照会过期（YouTube cookie 寿命数天到数周）。
- 解法：设置里「重新导入」刷新。
- 待实现：sidecar 启动时自动刷新快照（钥匙串已「始终允许」，静默）。

## 8. 仓库结构

```
ytbdl/
├── apps/
│   ├── desktop/              # Tauri + React
│   │   ├── src/              # 前端（App/Components/lib/store）
│   │   ├── src-tauri/        # Rust 外壳 + resources/(ffmpeg+sidecar) + .updater-key
│   │   └── scripts/          # publish.mjs（发布）+ build-windows.ps1
│   └── backend/              # Python sidecar（FastAPI + PyInstaller）
│       ├── app/              # main/jobs/extract/cookies/browsers/config/errors/hub/schemas
│       ├── build.py          # PyInstaller 打包
│       └── run.py            # PyInstaller 入口
├── docs/
│   ├── ARCHITECTURE.md       # 本文件
│   └── HANDOVER.md           # 交接文档
└── README.md
```

> 注：原计划的 `packages/protocol/`（OpenAPI 生成）未实现，前后端类型目前手动对齐。

## 9. 路线图与进度

| 阶段 | 目标 | 状态 |
|---|---|---|
| **P0** | 端到端闭环：壳拉起 sidecar → 解析 → 下载 → WebSocket 进度 | ✅ |
| **P1** | 格式选择器、队列/并发、设置、停止/重试/删除、音频提取、UI 精修 | ✅ |
| **P2** | PyInstaller 打包 sidecar + 自带 ffmpeg + macOS .app 出包 | ✅ |
| **P3** | Cookie 一键导入（快照）+ 多音轨 + 中文右键 + 全局错误 + 启动画面 | ✅ |
| **P4a** | Tauri Updater 接入 + 发布脚本 + 检查更新 UI | ✅ |
| **P4b** | Cloudflare R2 托管 + 实测自动更新 | ⬜ 待配置 |
| **P4c** | Windows 构建（本地脚本 / GitHub Actions） | ⬜ 待完成 |
| **P4d** | 代码签名/公证（Apple $99/年） | ⬜ 待 |
| **P4e** | 账号/收费（云端 auth + 功能开关） | ⬜ 待 |

## 10. 关键技术备忘

- **sidecar 注入**：Rust 生成随机 port+token，通过 `initialization_script` 设 `window.__SIDECAR__`（React 加载前生效）。
- **启动画面**：Rust 不再 `wait_ready`，窗口秒开显示 Splash，前端轮询 `health` 就绪后切主界面。
- **cookie 注入**：`cookies.cookie_ydl_opts()` 解析+下载共用；browser 模式优先快照文件，无快照回退实时读浏览器。
- **格式选择**：具体画质构造 `{format_id}+bestaudio/best`（补音频 + 回退），永不报「format not available」。
- **ffmpeg**：mac 用 evermeet x86_64 静态（Rosetta），win 用 BtbN win64 静态。均只链系统库，可移植。
- **Windows 构建限制**：SSH 非交互会话下 cargo 的 libcurl DNS 线程失败，必须本地 PowerShell 跑或用 GitHub Actions。
