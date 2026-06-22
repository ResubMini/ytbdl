import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from yt_dlp.utils import DownloadError

from app import cookies
from app.extract import _display_video_formats
from app.jobs import JobManager, _format_plan
from app.schemas import DownloadRequest, FormatInfo


class EmptyJar:
    def __len__(self):
        return 0

    def __iter__(self):
        return iter(())


class CookieJar(list):
    pass


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
    def test_video_formats_are_deduplicated(self):
        formats = [
            FormatInfo(format_id="a", ext="mp4", resolution="1920x1080", vcodec="avc1", fps=25),
            FormatInfo(format_id="b", ext="mp4", resolution="1920x1080", vcodec="avc1", fps=25, filesize=10),
            FormatInfo(format_id="sb", ext="mp4", resolution="1920x1080", vcodec="images", fps=25),
        ]
        self.assertEqual([f.format_id for f in _display_video_formats(formats)], ["b"])

    def test_mp4_selection_never_falls_back_to_webm(self):
        req = DownloadRequest(url="test", format="137", container="mp4", format_has_audio=False)
        selected, fallback, merge = _format_plan(req)
        self.assertEqual(merge, "mp4")
        self.assertNotIn("webm", selected + fallback)

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

    def test_empty_cookie_import_is_not_accepted(self):
        with (
            patch.object(cookies, "profiles", return_value=[{"folder": "Profile 1"}]),
            patch.object(cookies, "extract_cookies_from_browser", return_value=EmptyJar()) as extract,
        ):
            result = cookies.import_from_browser("chrome", "")
        self.assertFalse(result["ok"])
        extract.assert_called_once_with("chrome", profile="Profile 1")

    def test_auto_profile_uses_account_with_youtube_cookies(self):
        empty = CookieJar([SimpleNamespace(domain=".google.com")])
        logged_in = CookieJar([SimpleNamespace(domain=".youtube.com") for _ in range(3)])
        with (
            patch.object(cookies, "profiles", return_value=[{"folder": "A"}, {"folder": "B"}]),
            patch.object(cookies, "extract_cookies_from_browser", side_effect=[empty, logged_in]),
        ):
            result = cookies.import_from_browser("chrome", "")
        self.assertTrue(result["ok"])
        self.assertEqual(result["resolved_profile"], "B")

    def test_unavailable_format_retries_best(self):
        FakeYDL.calls = 0
        with patch("app.jobs.YoutubeDL", FakeYDL):
            result = JobManager._download_with_fallback("url", {"format": "137+bestaudio/best"}, False)
        self.assertEqual(result["format"], "bv*+ba/b")


if __name__ == "__main__":
    unittest.main()
