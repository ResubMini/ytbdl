"""cookie 管理：验证浏览器登录状态，使用时读取浏览器最新 cookie。"""
from __future__ import annotations

from yt_dlp.cookies import extract_cookies_from_browser

from .browsers import resolve_profile
from .config import DATA_DIR, settings


def cleanup_legacy_snapshots() -> None:
    """旧版曾把全部浏览器 cookie 明文落盘；升级后立即删除。"""
    legacy_dir = DATA_DIR / "cookies"
    if legacy_dir.exists():
        for path in legacy_dir.glob("*.txt"):
            path.unlink(missing_ok=True)


def import_from_browser(browser: str, profile: str | None) -> dict:
    """验证浏览器/Profile 中可读取到 YouTube cookie。

    注意：macOS 读 Chromium 系加密 cookie 会触发一次钥匙串授权。
    """
    try:
        profile = resolve_profile(browser, profile)
        jar = extract_cookies_from_browser(browser, profile=profile or None)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)[:300], "count": 0, "youtube_count": 0}

    count = len(jar)
    youtube_count = sum(1 for c in jar if "youtube" in (c.domain or "").lower())
    if youtube_count == 0:
        return {
            "ok": False,
            "error": "未读取到 YouTube 登录信息，请确认所选浏览器/Profile 已登录后重试。",
            "count": count,
            "youtube_count": 0,
        }

    return {
        "ok": True,
        "error": None,
        "count": count,
        "youtube_count": youtube_count,
        "profile": profile,
    }


def cookie_ydl_opts() -> dict:
    """返回 cookie 相关的 yt-dlp 参数（解析与下载共用）。

    browser 模式：每次读取浏览器最新 cookie，跟上 YouTube 的 cookie 轮换。
    file 模式：用用户指定的 cookies.txt（高级选项）。
    """
    if settings.cookie_source == "browser" and settings.cookie_browser:
        profile = resolve_profile(settings.cookie_browser, settings.cookie_profile) or None
        return {"cookiesfrombrowser": (settings.cookie_browser, profile)}
    if settings.cookie_source == "file" and settings.cookie_file:
        return {"cookiefile": settings.cookie_file}
    return {}
