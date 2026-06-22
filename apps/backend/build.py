"""把 sidecar 打成单文件可执行。

用法：.venv/bin/python build.py
产物：dist/mp4web-sidecar（macOS 上无扩展名）

打完手动验证（不依赖 venv）：
  dist/mp4web-sidecar  （默认端口 8765，dev token）
"""
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def main() -> None:
    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--onefile",
        "--name",
        "mp4web-sidecar",
        "--paths",
        str(ROOT),
        # yt-dlp：收集全部（含数百个 extractor + 自带的 PyInstaller hook）
        "--collect-all",
        "yt_dlp",
        "--collect-all",
        "yt_dlp_ejs",
        # 本地 app 包：确保所有子模块入包
        "--collect-submodules",
        "app",
        # uvicorn[standard] 的 C 扩展/隐藏导入
        "--collect-all",
        "uvicorn",
        "--hidden-import",
        "uvloop",
        "--hidden-import",
        "httptools",
        "--hidden-import",
        "websockets",
        "--hidden-import",
        "watchfiles",
        "--clean",
        "--noconfirm",
        "run.py",
    ]
    print("[build] running PyInstaller...")
    subprocess.check_call(cmd, cwd=ROOT)
    # Windows: PyInstaller 产物带 .exe
    for name in ("mp4web-sidecar", "mp4web-sidecar.exe"):
        p = ROOT / "dist" / name
        if p.exists():
            size_mb = p.stat().st_size / 1024 / 1024
            print(f"[build] OK: {p}  ({size_mb:.1f} MB)")
            break


if __name__ == "__main__":
    main()
