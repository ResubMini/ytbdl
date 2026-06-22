# mp4WEB 交接文档

> 跨平台 yt-dlp 桌面客户端（Tauri 2 + React + Python sidecar）。
> 本文档是给接手开发者的完整交接，含架构、进度、已知问题、下一步。

## 1. 项目概况

- **仓库**：`git@github.com:IVENWG/ytbdl.git`（私有）
- **产品名**：mp4WEB
- **技术栈**：Tauri 2（Rust 外壳）+ React 19 + TypeScript + Tailwind + shadcn/ui + Python（FastAPI sidecar，内嵌 yt-dlp）
- **三层架构**：
  ```
  Tauri 外壳(Rust) ──拉起/守护──► Python sidecar(FastAPI) ──import──► yt-dlp
       │ localhost HTTP/WS              │ 适配层                        (Unlicense 可商用)
  React 前端 ◄──────────────────────┘
  ```
- **核心设计**：前端只认 sidecar 的 `/v1/*` 协议；yt-dlp 升级=发新包（Tauri updater），不热替换引擎。

## 2. 目录结构

```
ytbdl/
├── apps/
│   ├── desktop/                 # Tauri + React
│   │   ├── src/                 # React 前端
│   │   │   ├── App.tsx          # 主界面（含 Splash 启动画面）
│   │   │   ├── components/      # MediaPreview/JobList/SettingsDialog/UpdateSection/Splash/ContextMenuInput
│   │   │   ├── lib/             # api.ts(config.ts/desktop.ts) + utils
│   │   │   └── store.ts         # zustand 任务状态 + WS 订阅
│   │   ├── src-tauri/           # Rust 外壳
│   │   │   ├── src/lib.rs       # 拉起 sidecar + 注入配置 + 启动画面
│   │   │   ├── resources/       # ffmpeg + mp4web-sidecar（gitignored，构建产物）
│   │   │   ├── capabilities/    # 权限(opener/dialog/clipboard/updater/process)
│   │   │   └── .updater-key[.pub]  # updater 签名密钥（gitignored）
│   │   ├── scripts/
│   │   │   ├── publish.mjs      # 发布脚本（跨平台：构建+签名+latest.json）
│   │   │   └── build-windows.ps1 # Windows 本地构建脚本
│   │   └── dist-publish/        # 发布产物（gitignored）
│   └── backend/                 # Python sidecar
│       ├── app/
│       │   ├── main.py          # FastAPI 路由 + 全局异常处理（CORS 安全）
│       │   ├── jobs.py          # 下载任务管理（队列/并发/取消/重试/格式构造）
│       │   ├── extract.py       # 元数据提取
│       │   ├── cookies.py       # 浏览器 cookie 验证 + 注入
│       │   ├── browsers.py      # 浏览器/profile 探测
│       │   ├── config.py        # 持久化设置（~/.ytbdl/config.json）
│       │   ├── errors.py        # 友好错误转译
│       │   ├── hub.py           # WebSocket 事件总线
│       │   └── schemas.py       # Pydantic 模型
│       ├── build.py             # PyInstaller 打包脚本
│       └── run.py               # PyInstaller 入口
├── docs/ARCHITECTURE.md         # 架构决策存档
└── README.md
```

## 3. 开发/构建命令

### dev 运行（mac）
```bash
cd apps/desktop && pnpm tauri dev
# 同时：编译 Rust + 起 vite + 拉起 sidecar(.venv python) + 开窗
# 改前端→自动热重载；改 Rust→自动重编；改 Python→必须 Ctrl+C 重启
```

### 打包 mac .app
```bash
# 1. 重建 sidecar（Python 改动后必须）
cd apps/backend && .venv/bin/python build.py
cp dist/mp4web-sidecar ../desktop/src-tauri/resources/mp4web-sidecar
# 2. 打包（含签名 updater 包）
cd ../desktop && node scripts/publish.mjs
# 产物：dist-publish/（.dmg + .app.tar.gz + latest.json）
#       + src-tauri/target/release/bundle/macos/mp4WEB.app
```

### 打包 Windows（在 Win 机器本地跑）
```powershell
cd E:\ytb\ytbdl
powershell -ExecutionPolicy Bypass -File apps\desktop\scripts\build-windows.ps1
```

### 打包 Windows（GitHub Actions）
- 仓库：`ResubMini/ytbdl`（不是 `IVENWG/ytbdl`）
- 在仓库 Secret 中添加 `TAURI_SIGNING_PRIVATE_KEY`（内容为 `src-tauri/.updater-key`）
- Actions → Build Windows → Run workflow；完成后下载 `mp4WEB-windows` Artifact

## 4. 已完成功能

### P0-P3 ✅
- 解析/下载/进度（WebSocket 实时）/队列/并发/取消/重试/删除
- 格式选择器（预设 + 具体画质，**自动补音频 + 回退**）
- 音频提取（mp3/m4a/flac 等，需 ffmpeg）
- 多音轨语言选择（YouTube 多语言配音）
- 浏览器 Cookie 验证 + 实时读取最新值 + Profile 探测
- 设置持久化（下载目录/并发/默认格式/音频）
- 中文右键菜单（自定义 ContextMenuInput，禁用原生英文菜单）
- 深色模式、bot-check 引导横幅
- 全局 CORS 安全错误处理（裸 500 补 CORS 头）

### P2 ✅
- PyInstaller 打包 sidecar（自包含，含 yt-dlp）
- 自带 ffmpeg（mac: evermeet x86_64 静态 + Rosetta；win: BtbN win64）
- macOS .app/.dmg 出包

### P4 部分 ✅
- Tauri updater 接入（签名密钥 + 端点 update.mp4web.com + 检查更新 UI）
- 发布脚本 publish.mjs（跨平台，自动生成 latest.json）
- 启动画面（Splash：秒开窗口 + 进度条 + sidecar 并行起）

## 5. 待办（按优先级）

### 🔴 高优先级
1. **Windows 构建已打通**：`ResubMini/ytbdl` 的手动 Build Windows Action 已实测成功，产出安装包和 `latest.json` Artifact。Win 本地 PowerShell 脚本仍可作备用。
2. **Cloudflare R2 未配置**：updater 端点 `update.mp4web.com/latest.json` 还没托管。用户需建 R2 bucket + 绑定域名 + 上传 dist-publish/ 里的 latest.json + .tar.gz。

### 🟡 中优先级
4. **macOS GitHub Actions workflow 未写**：Windows workflow 已写；mac 构建和发版上传仍未自动化。
5. **代码签名/公证**：未签名 .app 双击会报「未验证」。需 Apple 开发者账号 $99/年 + `tauri build` 配 codesigning。
6. **启动慢优化**：sidecar import yt-dlp 慢（~5s dev / ~15s 打包因 PyInstaller 解包）。可改 PyInstaller onedir（免解包）或 yt-dlp 懒加载。

### 🟢 低优先级
7. 账号/收费（P4）：auth 模块 + 功能开关（前端已有 config 钩子，后端 `config.py` 预留）。
8. Linux 版本。

## 6. 关键已知问题

### YouTube Cookie 会轮换
- 普通浏览器模式在每次解析和下载时读取所选 Profile 的最新 cookie；验证为 0 条时不启用。
- 若未明确选账户，使用 Chromium `Local State.profile.last_used`，避免误读其他 Profile。
- 要获得不会被浏览器标签页轮换的固定 cookie，需按 yt-dlp 官方方法从独立无痕会话导出 `cookies.txt`，随后立即关闭且不再打开该会话。
- 新版启动时会删除旧版遗留的全浏览器 cookie 明文快照。

### Windows 必须本地构建
- SSH 非交互会话下 cargo 的 libcurl DNS 线程初始化失败（`getaddrinfo() thread failed to start`）。
- 必须用户坐在 Win 前用本地 PowerShell 跑，或用 GitHub Actions。

### pnpm 11 在 Windows 的 build-check
- pnpm 11 默认拦截 esbuild 构建脚本。Windows 构建脚本已改用 npm（`beforeBuildCommand: "npm run build"`）。
- 若换回 pnpm，需在 `pnpm-workspace.yaml` 配 `onlyBuiltDependencies: [esbuild]`。

## 7. 关键技术点备忘

- **sidecar 端口/token**：每次启动随机生成，Rust 通过 `initialization_script` 注入 `window.__SIDECAR__`（React 加载前生效，无竞态）。
- **cookie 注入**：`cookies.cookie_ydl_opts()` 解析和下载共用；browser 模式实时读取所选 Profile，file 模式使用固定 `cookies.txt`。
- **格式选择**：用户选具体画质时，后端构造 `{format_id}+bestaudio/best`（补音频 + 回退），永不报「format not available」。
- **全局错误**：`main.py` 的 `@app.exception_handler(Exception)` 在最外层（CORS 中间件之外），**必须自补 CORS 头**，否则前端只见 `load failed`。
- **updater**：公钥在 `tauri.conf.json plugins.updater.pubkey`；私钥在 `src-tauri/.updater-key`（gitignored，**丢失就再也无法推更新**，务必备份）。
- **PyInstaller**：`build.py` 用 `--onefile`；Windows 产物带 `.exe`，build.py 已兼容。

## 8. 各平台 ffmpeg 来源

- **mac**：`evermeet.cx` 的 `ffmpeg-8.1.2.zip`（x86_64 静态，Apple Silicon 走 Rosetta）。evermeet 不提供 arm64 原生。
- **windows**：`BtbN/FFmpeg-Builds` 的 `ffmpeg-master-latest-win64-gpl.zip`（x64 静态）。
- 两者都只链系统库，可移植。

## 9. 发版流程（待 R2 配好后）

1. 改 `tauri.conf.json` 的 `version`（如 1.0.1）。
2. mac：`node apps/desktop/scripts/publish.mjs` → dist-publish/ 出 mac 产物。
3. win：在 `ResubMini/ytbdl` 手动运行 Build Windows Action（或本地跑 `build-windows.ps1`）→ 下载 Artifact。
4. 把 `latest.json` + `.tar.gz`/`-setup.exe` 上传到 Cloudflare R2（`update.mp4web.com`）。
5. 用户 App 自动检测到新版本 → 下载安装。

## 10. 联系点

- 代码全部在 `IVENWG/ytbdl`（main 分支）。
- 签名私钥 `.updater-key` 只在本地，不在仓库——接手者需从前任处获取，否则无法发更新。
- 用户 GitHub：IVENWG；Cloudflare 账号已有（待配 R2 + update.mp4web.com）。
