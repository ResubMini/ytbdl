import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from yt_dlp.utils import DownloadError

from app import browsers, cookies
from app.jobs import JobManager


class EmptyJar:
    def __len__(self):
        return 0

    def __iter__(self):
        return iter(())


class FakeYDL:
    calls = 0

    def __init__(self, opts):
        self.opts = opts

    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def extract_info(self, *_args, **_kwargs):
        FakeYDL.calls += 1
        if FakeYDL.calls == 1:
            raise DownloadError("Requested format is not available")
        return {"ok": True, "format": self.opts["format"]}


class RegressionTests(unittest.TestCase):
    def test_legacy_cookie_snapshots_are_deleted(self):
        with tempfile.TemporaryDirectory() as tmp:
            old_data_dir = cookies.DATA_DIR
            cookies.DATA_DIR = Path(tmp)
            snapshot = Path(tmp) / "cookies" / "chrome.txt"
            snapshot.parent.mkdir()
            snapshot.write_text("sensitive", "utf-8")
            try:
                cookies.cleanup_legacy_snapshots()
                self.assertFalse(snapshot.exists())
            finally:
                cookies.DATA_DIR = old_data_dir

    def test_chromium_defaults_to_last_used_profile(self):
        state = {"profile": {"last_used": "Profile 2"}}
        with patch.object(browsers, "_chromium_local_state", return_value=state):
            self.assertEqual(browsers.resolve_profile("chrome", ""), "Profile 2")

    def test_empty_cookie_import_is_not_accepted(self):
        with (
            patch.object(cookies, "resolve_profile", return_value="Profile 1"),
            patch.object(cookies, "extract_cookies_from_browser", return_value=EmptyJar()) as extract,
        ):
            result = cookies.import_from_browser("chrome", "")
        self.assertFalse(result["ok"])
        extract.assert_called_once_with("chrome", profile="Profile 1")

    def test_unavailable_format_retries_best(self):
        FakeYDL.calls = 0
        with patch("app.jobs.YoutubeDL", FakeYDL):
            result = JobManager._download_with_fallback("url", {"format": "137+bestaudio/best"}, False)
        self.assertEqual(result["format"], "bv*+ba/b")


if __name__ == "__main__":
    unittest.main()
