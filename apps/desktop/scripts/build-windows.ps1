# Windows 构建脚本 —— 在 Windows 机器上本地跑（PowerShell）。
# 产 mp4WEB 的 Windows 安装包 + updater 签名包 + latest.json（windows 条目）。
#
# 用法（仓库根目录，如 E:\ytb）：
#   cd E:\ytb ; powershell -ExecutionPolicy Bypass -File apps\desktop\scripts\build-windows.ps1
#
# 前置（脚本会检查，缺了会告诉你怎么装）：
#   Python 3.10+、Node 18+、Rust(cargo)、Git
#
# 注意：签名私钥 src-tauri/.updater-key 不会随 git 过来（gitignored）。
# 必须从 mac 把同名文件复制到 Windows 的 apps\desktop\src-tauri\.updater-key
# （否则签名出来的包和 mac 的公钥对不上，更新会失败）。

$ErrorActionPreference = "Stop"
$root = (Get-Location).Path
$backend = Join-Path $root "apps\backend"
$desktop = Join-Path $root "apps\desktop"
$srcTauri = Join-Path $desktop "src-tauri"
$resources = Join-Path $srcTauri "resources"

function Assert-Cmd($name) {
    $c = Get-Command $name -ErrorAction SilentlyContinue
    if (-not $c) { Write-Host "✗ 缺少 $name。请先安装。" -ForegroundColor Red; exit 1 }
}

Write-Host "=== 检查工具链 ===" -ForegroundColor Cyan
foreach ($t in @("python", "node", "cargo", "git")) { Assert-Cmd $t }
# pnpm 没装就 corepack enable
if (-not (Get-Command pnpm -ErrorAction SilentlyContinue)) {
    Write-Host "  启用 pnpm…" ; corepack enable 2>$null ; Assert-Cmd pnpm
}

Write-Host "=== 检查签名私钥 ===" -ForegroundColor Cyan
$key = Join-Path $srcTauri ".updater-key"
if (-not (Test-Path $key)) {
    Write-Host "✗ 缺少 $key 。从 mac 复制 apps/desktop/src-tauri/.updater-key 到这里再跑。" -ForegroundColor Red
    exit 1
}

Write-Host "=== 后端：venv + PyInstaller ===" -ForegroundColor Cyan
Push-Location $backend
python -m venv .venv
.\.venv\Scripts\python.exe -m pip install -q --upgrade pip
.\.venv\Scripts\pip.exe install -q -r requirements.txt pyinstaller
.\.venv\Scripts\python.exe build.py
if (-not (Test-Path "dist\mp4web-sidecar.exe")) { Write-Host "✗ sidecar 打包失败" -ForegroundColor Red; exit 1 }
Pop-Location

Write-Host "=== 下载 Windows 静态 ffmpeg ===" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $resources | Out-Null
$ffZip = Join-Path $env:TEMP "ffmpeg-win.zip"
Invoke-WebRequest "https://github.com/BtbN/FFmpeg-Builds/releases/download/latest/ffmpeg-master-latest-win64-gpl.zip" -OutFile $ffZip
$ffEx = Join-Path $env:TEMP "ffmpeg-win"
Expand-Archive $ffZip -DestinationPath $ffEx -Force
$ffExe = Get-ChildItem -Recurse -Filter "ffmpeg.exe" $ffEx | Select-Object -First 1
Copy-Item $ffExe.FullName (Join-Path $resources "ffmpeg.exe") -Force
Write-Host "  ffmpeg → $(Join-Path $resources 'ffmpeg.exe')"

Write-Host "=== 拷 sidecar 到 resources ===" -ForegroundColor Cyan
Copy-Item (Join-Path $backend "dist\mp4web-sidecar.exe") (Join-Path $resources "mp4web-sidecar.exe") -Force

Write-Host "=== 前端：pnpm install + publish（含 tauri build + 签名 + latest.json）===" -ForegroundColor Cyan
Push-Location $desktop
pnpm install
node scripts\publish.mjs
Pop-Location

Write-Host "`n✓ 完成。产物在 apps\desktop\dist-publish\" -ForegroundColor Green
Write-Host "上传到 R2（update.mp4web.com 根目录）：update 包 + latest.json"
