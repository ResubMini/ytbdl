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
if ($LASTEXITCODE -ne 0) { throw "sidecar 构建失败" }
if (-not (Test-Path "dist\mp4web-sidecar.exe")) { Write-Host "✗ sidecar 打包失败" -ForegroundColor Red; exit 1 }

Write-Host "=== 验证 sidecar 可启动 ===" -ForegroundColor Cyan
$env:SIDECAR_HOST = "127.0.0.1"
$env:SIDECAR_PORT = "18765"
$env:SIDECAR_TOKEN = "build-smoke-test"
$sidecarOut = Join-Path $env:TEMP "mp4web-sidecar.out.log"
$sidecarErr = Join-Path $env:TEMP "mp4web-sidecar.err.log"
$sidecar = Start-Process "dist\mp4web-sidecar.exe" -PassThru -WindowStyle Hidden -RedirectStandardOutput $sidecarOut -RedirectStandardError $sidecarErr
try {
    $ready = $false
    foreach ($i in 1..120) {
        if ($sidecar.HasExited) { throw "sidecar 提前退出，exit code: $($sidecar.ExitCode)" }
        try {
            Invoke-RestMethod "http://127.0.0.1:18765/v1/health" -Headers @{ Authorization = "Bearer build-smoke-test" } | Out-Null
            $ready = $true
            break
        } catch { Start-Sleep -Milliseconds 500 }
    }
    if (-not $ready) {
        Get-Content $sidecarOut, $sidecarErr -ErrorAction SilentlyContinue
        throw "sidecar 60 秒内未就绪"
    }
} finally {
    Stop-Process -Id $sidecar.Id -Force -ErrorAction SilentlyContinue
    Remove-Item Env:SIDECAR_HOST, Env:SIDECAR_PORT, Env:SIDECAR_TOKEN -ErrorAction SilentlyContinue
}
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

Write-Host "=== 下载 Deno（YouTube JS challenge） ===" -ForegroundColor Cyan
$denoZip = Join-Path $env:TEMP "deno-win.zip"
$denoEx = Join-Path $env:TEMP "deno-win"
Invoke-WebRequest "https://github.com/denoland/deno/releases/latest/download/deno-x86_64-pc-windows-msvc.zip" -OutFile $denoZip
Expand-Archive $denoZip -DestinationPath $denoEx -Force
Copy-Item (Join-Path $denoEx "deno.exe") (Join-Path $resources "deno.exe") -Force

Write-Host "=== 拷 sidecar 到 resources ===" -ForegroundColor Cyan
Copy-Item (Join-Path $backend "dist\mp4web-sidecar.exe") (Join-Path $resources "mp4web-sidecar.exe") -Force

Write-Host "=== 前端：pnpm install + publish（含 tauri build + 签名 + latest.json）===" -ForegroundColor Cyan
Push-Location $desktop
pnpm install
node scripts\publish.mjs

Write-Host "=== 生成绿色版 ZIP ===" -ForegroundColor Cyan
$version = (Get-Content "src-tauri\tauri.conf.json" | ConvertFrom-Json).version
$portable = Join-Path "dist-publish" "mp4WEB-portable"
Remove-Item $portable -Recurse -Force -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force -Path (Join-Path $portable "resources") | Out-Null
Copy-Item "src-tauri\target\release\desktop.exe" (Join-Path $portable "mp4WEB.exe")
Copy-Item "src-tauri\resources\ffmpeg.exe" (Join-Path $portable "resources\ffmpeg.exe")
Copy-Item "src-tauri\resources\deno.exe" (Join-Path $portable "resources\deno.exe")
Copy-Item "src-tauri\resources\mp4web-sidecar.exe" (Join-Path $portable "resources\mp4web-sidecar.exe")

Write-Host "=== 验证绿色版能拉起后台服务 ===" -ForegroundColor Cyan
Get-Process "mp4web-sidecar" -ErrorAction SilentlyContinue | Stop-Process -Force
$portableApp = Start-Process (Join-Path $portable "mp4WEB.exe") -PassThru -WindowStyle Hidden
try {
    $listening = $false
    foreach ($i in 1..120) {
        $sidecars = Get-Process "mp4web-sidecar" -ErrorAction SilentlyContinue
        foreach ($process in $sidecars) {
            if (Get-NetTCPConnection -OwningProcess $process.Id -State Listen -ErrorAction SilentlyContinue) {
                $listening = $true
                break
            }
        }
        if ($listening) { break }
        if ($portableApp.HasExited) { throw "绿色版主程序提前退出，exit code: $($portableApp.ExitCode)" }
        Start-Sleep -Milliseconds 500
    }
    if (-not $listening) { throw "绿色版 60 秒内未拉起后台服务" }
} finally {
    Stop-Process -Id $portableApp.Id -Force -ErrorAction SilentlyContinue
    Get-Process "mp4web-sidecar" -ErrorAction SilentlyContinue | Stop-Process -Force
}

$portableZip = Join-Path "dist-publish" "mp4WEB_${version}_x64_portable.zip"
Remove-Item $portableZip -Force -ErrorAction SilentlyContinue
Compress-Archive -Path "$portable\*" -DestinationPath $portableZip
Remove-Item $portable -Recurse -Force
Pop-Location

Write-Host "`n✓ 完成。产物在 apps\desktop\dist-publish\" -ForegroundColor Green
Write-Host "上传到 R2（update.mp4web.com 根目录）：update 包 + latest.json"
