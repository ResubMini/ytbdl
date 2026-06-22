"""跨平台探测已安装的浏览器，供「借用浏览器 Cookie」用。

yt-dlp 的 cookiesfrombrowser 接受这些小写名：
chrome / edge / firefox / brave / chromium / opera / vivaldi / safari
"""
from __future__ import annotations

import json
import os
import platform
import shutil
from pathlib import Path

DISPLAY = {
    "chrome": "Chrome",
    "edge": "Edge",
    "firefox": "Firefox",
    "brave": "Brave",
    "chromium": "Chromium",
    "opera": "Opera",
    "vivaldi": "Vivaldi",
    "safari": "Safari",
}
# Safari 受 macOS 隐私保护影响，读取常失败
UNRELIABLE = {"safari"}

_ORDER = ["chrome", "edge", "firefox", "brave", "chromium", "opera", "vivaldi", "safari"]


# Chromium 系各浏览器的「用户数据目录」相对路径（按平台）
_CHROMIUM_DIRS = {
    "chrome": {
        "mac": "Google/Chrome",
        "win": r"Google\Chrome\User Data",
        "linux": "google-chrome",
    },
    "edge": {
        "mac": "Microsoft Edge",
        "win": r"Microsoft\Edge\User Data",
        "linux": "microsoft-edge",
    },
    "brave": {
        "mac": "BraveSoftware/Brave-Browser",
        "win": r"BraveSoftware\Brave-Browser\User Data",
        "linux": "BraveSoftware/Brave-Browser",
    },
    "chromium": {
        "mac": "Chromium",
        "win": r"Chromium\User Data",
        "linux": "chromium",
    },
    "vivaldi": {
        "mac": "Vivaldi",
        "win": r"Vivaldi\User Data",
        "linux": "vivaldi",
    },
}

_PLATFORM_KEY = {"Darwin": "mac", "Windows": "win"}


def _platform_root() -> Path:
    s = platform.system()
    if s == "Darwin":
        return Path.home() / "Library" / "Application Support"
    if s == "Windows":
        return Path(os.environ.get("LOCALAPPDATA", str(Path.home() / "AppData" / "Local")))
    return Path.home() / ".config"


def profiles(browser: str) -> list[dict]:
    """枚举某浏览器的 profile 列表，供用户选择登录账户。

    返回 [{folder, name, email}]。folder 是传给 yt-dlp 的 profile 标识。
    """
    if browser in _CHROMIUM_DIRS:
        return _chromium_profiles(browser)
    if browser == "firefox":
        return _firefox_profiles()
    return []  # safari/opera：无多 profile


def _chromium_local_state(browser: str) -> dict:
    key = _PLATFORM_KEY.get(platform.system(), "linux")
    rel = _CHROMIUM_DIRS.get(browser, {}).get(key)
    if not rel:
        return {}
    path = _platform_root() / rel / "Local State"
    if not path.exists():
        return {}
    try:
        return json.loads(path.read_text("utf-8"))
    except Exception:
        return {}


def _chromium_profiles(browser: str) -> list[dict]:
    data = _chromium_local_state(browser)
    cache = data.get("profile", {}).get("info_cache", {}) or {}
    last_used = data.get("profile", {}).get("last_used", "")
    out = [
        {
            "folder": folder,
            "name": (info.get("name") or folder),
            "email": info.get("user_name") or "",
        }
        for folder, info in cache.items()
    ]
    out.sort(key=lambda x: (x["folder"] != last_used, x["folder"] != "Default", x["folder"]))
    return out


def _firefox_profiles() -> list[dict]:
    import configparser

    s = platform.system()
    if s == "Darwin":
        base = Path.home() / "Library" / "Application Support" / "Firefox"
    elif s == "Windows":
        base = Path(os.environ.get("APPDATA", "")) / "Mozilla" / "Firefox"
    else:
        base = Path.home() / ".mozilla" / "firefox"
    ini = base / "profiles.ini"
    if not ini.exists():
        return []
    cp = configparser.ConfigParser()
    try:
        cp.read(ini, "utf-8")
    except Exception:
        return []
    out = []
    for section in cp.sections():
        if not section.lower().startswith("profile"):
            continue
        name = cp.get(section, "Name", fallback="")
        path = cp.get(section, "Path", fallback="")
        is_default = cp.getboolean(section, "Default", fallback=False)
        if name:
            out.append({"folder": name, "name": name, "email": "", "is_default": is_default})
    out.sort(key=lambda x: not x["is_default"])
    for item in out:
        item.pop("is_default")
    return out

def _installed_macos() -> list[str]:
    apps = {
        "chrome": "Google Chrome.app",
        "edge": "Microsoft Edge.app",
        "firefox": "Firefox.app",
        "brave": "Brave Browser.app",
        "chromium": "Chromium.app",
        "opera": "Opera.app",
        "vivaldi": "Vivaldi.app",
        "safari": "Safari.app",
    }
    out = []
    for key in _ORDER:
        if (Path("/Applications") / apps[key]).exists():
            out.append(key)
    return out


def _installed_linux() -> list[str]:
    bins = {
        "chrome": ["google-chrome", "google-chrome-stable"],
        "chromium": ["chromium", "chromium-browser"],
        "edge": ["microsoft-edge"],
        "firefox": ["firefox"],
        "brave": ["brave", "brave-browser"],
        "opera": ["opera"],
        "vivaldi": ["vivaldi"],
    }
    out = []
    for key in _ORDER:
        if key in bins and any(shutil.which(b) for b in bins[key]):
            out.append(key)
    return out


def _installed_windows() -> list[str]:
    pf = [
        os.environ.get("PROGRAMFILES", r"C:\Program Files"),
        os.environ.get("PROGRAMFILES(X86)", r"C:\Program Files (x86)"),
    ]
    local = os.environ.get("LOCALAPPDATA", "")
    candidates = {
        "chrome": [
            r"Google\Chrome\Application\chrome.exe",
            r"Google\Chrome\Application\chrome.exe",
        ],
        "edge": [r"Microsoft\Edge\Application\msedge.exe"],
        "firefox": [r"Mozilla Firefox\firefox.exe"],
        "brave": [r"BraveSoftware\Brave-Browser\Application\brave.exe"],
        "chromium": [r"Chromium\Application\chrome.exe"],
        "opera": [r"Opera\opera.exe"],
        "vivaldi": [r"Vivaldi\Application\vivaldi.exe"],
    }
    out = []
    for key in _ORDER:
        paths = candidates.get(key, [])
        found = False
        for base in pf:
            for rel in paths:
                if (Path(base) / rel).exists():
                    found = True
                    break
            if found:
                break
        if not found and local:
            for rel in paths:
                if (Path(local) / rel).exists():
                    found = True
                    break
        if found:
            out.append(key)
    return out


def detect() -> list[dict]:
    sysname = platform.system()
    if sysname == "Darwin":
        keys = _installed_macos()
    elif sysname == "Windows":
        keys = _installed_windows()
    else:
        keys = _installed_linux()
    return [
        {"id": k, "name": DISPLAY.get(k, k), "unreliable": k in UNRELIABLE}
        for k in keys
    ]
