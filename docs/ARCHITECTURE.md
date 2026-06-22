# 架构方案 (Architecture)

> 跨平台 yt-dlp 桌面客户端。状态：P0 实现中。本文件是所有架构决策的**单一事实来源**。

## 1. 目标与硬约束

| # | 要求 | 说明 |
|---|---|---|
| G1 | 跨平台桌面软件 | Windows / macOS / Linux，每台机器装一份，原生窗口体验 |
| G2 | 后端（yt-dlp 引擎）可随时热更新，不影响前端 | 核心诉求 |
| G3 | 漂亮的 UI | 消费级精致感 |
| G4 | 预留登录/收费 | 现在不实现，留好钩子，后期接云端 |
| G5 | 可商用 | 许可证必须允许闭源商业分发 |

## 2. 关键许可证事实（决定了技术选型）

- **yt-dlp 引擎 = The Unlicense（公共领域）** —— LICENSE 原文明确允许 commercial / sell / 任意用途。**可商用，无传染性。**
- 第三方项目 `marcopiovanello/yt-dlp-web-ui` = **GPL-3.0** —— 衍生作品须开源，与 G4/G5 冲突。**故后端自研，不复用该项目。**

## 3. 三层解耦模型

```
┌─────────────────────────────────────────────────────────────┐
│ ① 桌面外壳  Tauri 2 (Rust)                                   │
│    拉起/守护 sidecar、托盘、原生对话框、通知、单实例          │
│    内置 Updater（App 自更新 = 热更新 B）                      │
│    auth 模块（登录钩子，前期 no-op）+ 功能开关                 │
└───────────────────────┬─────────────────────────────────────┘
                        │ localhost HTTP + WebSocket (token)
┌───────────────────────▼─────────────────────────────────────┐
│ ② 协议层  Python sidecar (FastAPI + uvicorn, PyInstaller)    │
│    /v1/* REST + WebSocket /v1/events                         │
│    下载队列 / 并发 / 任务历史(SQLite)                         │
│    适配层：yt-dlp 字段 ⇄ 我们的 /v1/* 协议（吸收上游变更）    │
└───────────────────────┬─────────────────────────────────────┘
                        │ import（可热替换到 engines/）
┌───────────────────────▼─────────────────────────────────────┐
│ ③ 引擎  yt-dlp (Unlicense) + ffmpeg                          │
│    真正干活；放在 engines/，随时换版本，①② 不动               │
└─────────────────────────────────────────────────────────────┘
```

**解耦原理**：前端只认 ② 的 `/v1/*` 协议版本。yt-dlp（③）任何字段/行为变更，都由 ② 的适配层吸收，前端无感。

## 4. 技术栈（锁定）

| 层 | 选型 | 备注 |
|---|---|---|
| 外壳 | **Tauri 2** | ~15MB、安全、Rust 管 sidecar。前端代码可 100% 平移到 Electron，低后悔 |
| 前端 | **React + TS + Vite** | 主流、生态大 |
| UI | **Tailwind CSS + shadcn/ui + lucide** | 消费级精致感的最快路径 |
| 状态/数据 | Zustand + 原生 WS | 轻量 |
| 后端服务 | **Python + FastAPI + uvicorn** | yt-dlp 是 Python 生态 |
| 后端打包 | **PyInstaller**（单文件 sidecar，每平台一份） | 免装 Python |
| 协议定义 | **OpenAPI**（packages/protocol，单一事实来源） | TS 类型 + Pydantic 双向生成 |
| DB | SQLite | 任务历史/队列 |

## 5. 后端协议契约 `/v1/*`

Sidecar 绑 `127.0.0.1:<随机端口>`，启动带 `token`，所有请求 `Authorization: Bearer <token>`。

**REST**
```
GET    /v1/health              → { ok, engine:{version,channel,path}, sidecar_version }
GET    /v1/extract?url=        → 元数据（标题/时长/缩略图/formats[]），simulate 模式
POST   /v1/download            → 入队 {url,format,outtmpl,...} → { job_id }
GET    /v1/jobs                → 任务列表
GET    /v1/jobs/{id}           → 单任务状态
DELETE /v1/jobs/{id}           → 取消
POST   /v1/cookies/import      → 导入 cookies
GET    /v1/config              → 读写偏好（未来接云下发功能开关）
POST   /v1/engine/update       → 换 engines/ 下 yt-dlp（热更新 A）
```

**WebSocket `/v1/events`**
```jsonc
{ "type": "job.progress",  "job_id":"...", "status":"downloading",
  "downloaded_bytes":123, "total_bytes":987, "speed":524288, "eta":8.6,
  "fragment_index":12, "fragment_count":100 }
{ "type": "job.postprocess","job_id":"...", "status":"processing", "postprocessor":"FFmpegExtractAudio" }
{ "type": "job.finished",   "job_id":"...", "filename":"/path/file.mp4" }
{ "type": "job.log",        "job_id":"...", "level":"warning", "message":"..." }
{ "type": "engine.updated", "version":"2026.07.01" }
```

## 6. 热更新（A + B）

- **A 引擎热更新**：`engines/` 放 yt-dlp，`POST /v1/engine/update` 下载新版→校验→备份旧版(.bak)→替换→重启。失败回滚 `.bak` 并 WS 上报。
- **B App 自更新**：Tauri 内置 Updater，签名更新包，后台拉新版重启。

## 7. 登录/收费（预留）

- `auth` 模块 + 功能开关（feature flags）。
- 现状：flag 来源写死本地，登录入口禁用/隐藏。
- 后期：接云端账号服务器，按订阅等级下发 flag 解锁高级功能（多并发/播放列表/直播/特定站点）。
- 收费模式待定；按「免费基础 + 等级解锁」预留最通用。

## 8. 仓库结构

```
ytbdl/
├── apps/
│   ├── desktop/          # Tauri + React 前端 + Rust 外壳
│   │   ├── src/          # React 前端
│   │   └── src-tauri/    # Rust 外壳
│   └── backend/          # Python sidecar
│       ├── app/
│       └── build.py      # PyInstaller 打包
├── packages/
│   └── protocol/         # OpenAPI（单一事实来源）→ 生成 TS / Pydantic
├── docs/ARCHITECTURE.md  # 本文件
└── README.md
```

## 9. 路线图

| 阶段 | 目标 |
|---|---|
| **P0** | 端到端最小闭环：壳拉起 sidecar → 粘贴链接 → extract → 下载 → WebSocket 进度 |
| **P1** | 格式选择器、下载队列/并发、目录/outtmpl、停止/重试、shadcn 精修 UI |
| **P2** | 引擎热替换 UX + 回滚、打包 yt-dlp/ffmpeg |
| **P3** | 托盘/通知/单实例、App 自更新、Cookie/代理/字幕/封面/音频提取 |
| **P4** | 三平台安装包 + 签名；云端账号/授权接入（收费） |
