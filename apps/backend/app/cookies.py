"""cookie 管理：一键从浏览器导入「快照」，下载时用快照文件。

为什么用快照而不实时读浏览器：
YouTube 会频繁轮换「打开着的浏览器」里的 cookie 作为安全措施，
导致「实时读浏览器」第一次成功、之后失效。把 cookie 在导入这一刻
抽成文件快照，之后只用文件 —— 快照不受浏览器轮换影响，稳定得多。
（快照仍会随账号 cookie 自然过期，过期后用户再点一次「导入」刷新。）
"""
from __future__ import annotations

from pathlib import Path

from yt_dlp.cookies import extract_cookies_from_browser

from .config import DATA_DIR, settings

COOKIE_DIR = DATA_DIR / "cookies"


def _snapshot_path(browser: str) -> Path:
    COOKIE_DIR.mkdir(parents=True, exist_ok=True)
    return COOKIE_DIR / f"{browser}.txt"


def import_from_browser(browser: str, profile: str | None) -> dict:
    """抽取浏览器 cookie 存成快照文件。返回结果供 UI 展示。

    注意：macOS 读 Chromium 系加密 cookie 会触发一次钥匙串授权。
    """
    try:
        jar = extract_cookies_from_browser(browser, profile=profile or None)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)[:300], "count": 0, "youtube_count": 0}

    path = _snapshot_path(browser)
    try:
        jar.save(str(path), ignore_discard=True, ignore_expires=True)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": f"保存失败：{e}"[:300], "count": 0, "youtube_count": 0}

    count = len(jar)
    youtube_count = sum(1 for c in jar if "youtube" in (c.domain or ""))
    return {
        "ok": True,
        "error": None,
        "count": count,
        "youtube_count": youtube_count,
        "path": str(path),
    }


def cookie_ydl_opts() -> dict:
    """返回 cookie 相关的 yt-dlp 参数（解析与下载共用）。

    browser 模式：优先用导入的快照文件；快照不存在则回退实时读浏览器。
    file 模式：用用户指定的 cookies.txt（高级选项）。
    """
    if settings.cookie_source == "browser" and settings.cookie_browser:
        snap = _snapshot_path(settings.cookie_browser)
        if snap.exists():
            return {"cookiefile": str(snap)}
        # 没导入过快照：回退实时读浏览器（可能遇轮换问题）
        profile = settings.cookie_profile or None
        return {"cookiesfrombrowser": (settings.cookie_browser, profile)}
    if settings.cookie_source == "file" and settings.cookie_file:
        return {"cookiefile": settings.cookie_file}
    return {}
