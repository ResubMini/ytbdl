"""运行时配置。

分两类：
- 启动参数（HOST/PORT/TOKEN）：环境变量，外壳拉起时注入，不可热改。
- 用户设置（settings）：持久化到 config.json，UI 可读写。
"""
from __future__ import annotations

import json
import os
from pathlib import Path


def _env(key: str, default: str) -> str:
    return os.environ.get(key, default)


# ── 启动参数 ──
HOST: str = _env("SIDECAR_HOST", "127.0.0.1")
PORT: int = int(_env("SIDECAR_PORT", "8765"))
TOKEN: str = _env("SIDECAR_TOKEN", "dev-token-change-me")
CORS_ORIGINS: list[str] = [o for o in _env("CORS_ORIGINS", "*").split(",") if o]

# ── 数据目录 / 配置文件 ──
DATA_DIR = Path(_env("SIDECAR_DATA_DIR", str(Path.home() / ".ytbdl")))
DATA_DIR.mkdir(parents=True, exist_ok=True)
CONFIG_PATH = DATA_DIR / "config.json"

_DEFAULTS = {
    "download_dir": str(Path.home() / "Downloads" / "ytbdl"),
    "max_concurrent": 2,
    "default_format": "bv*+ba/b",
    "extract_audio": False,
    "audio_format": "mp3",
    # 登录信息（解决 YouTube 等的 bot-check）
    "cookie_source": "none",  # none | browser | file
    "cookie_browser": "",  # chrome / edge / firefox / ...
    "cookie_profile": "",  # 浏览器 profile 文件夹名，空=最近使用的
    "cookie_file": "",  # cookies.txt 的绝对路径（高级）
    "cookie_imported_at": 0,  # 快照导入时间戳（0=未导入）
    "cookie_imported_count": 0,  # 快照里 youtube 相关 cookie 数
}


class Settings:
    """用户可配置项，持久化到 config.json。"""

    def __init__(self) -> None:
        self._data: dict = dict(_DEFAULTS)
        self.load()
        # 环境变量覆盖下载目录（外壳可强制指定）
        env_dd = os.environ.get("DOWNLOAD_DIR")
        if env_dd:
            self._data["download_dir"] = env_dd
        self._ensure_dir()

    def load(self) -> None:
        if CONFIG_PATH.exists():
            try:
                self._data.update(json.loads(CONFIG_PATH.read_text("utf-8")))
            except Exception:
                pass

    def save(self) -> None:
        CONFIG_PATH.write_text(
            json.dumps(self._data, ensure_ascii=False, indent=2), "utf-8"
        )

    def _ensure_dir(self) -> None:
        try:
            Path(self._data["download_dir"]).mkdir(parents=True, exist_ok=True)
        except Exception:
            pass

    def get(self) -> dict:
        return dict(self._data)

    def update(self, **kwargs) -> dict:
        for k, v in kwargs.items():
            if k in _DEFAULTS:
                self._data[k] = v
        if "download_dir" in kwargs:
            self._ensure_dir()
        self.save()
        return self.get()

    @property
    def download_dir(self) -> str:
        return self._data["download_dir"]

    @property
    def max_concurrent(self) -> int:
        return int(self._data["max_concurrent"])

    @property
    def default_format(self) -> str:
        return self._data["default_format"]

    @property
    def extract_audio(self) -> bool:
        return bool(self._data["extract_audio"])

    @property
    def audio_format(self) -> str:
        return self._data["audio_format"]

    @property
    def cookie_source(self) -> str:
        return self._data["cookie_source"]

    @property
    def cookie_browser(self) -> str:
        return self._data["cookie_browser"]

    @property
    def cookie_profile(self) -> str:
        return self._data["cookie_profile"]

    @property
    def cookie_file(self) -> str:
        return self._data["cookie_file"]


settings = Settings()
