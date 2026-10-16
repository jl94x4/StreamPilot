"""Poster download uses plex session + thumb fallbacks (not bare requests)."""

from __future__ import annotations

import io
import sys
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

from PIL import Image

_APP = Path(__file__).resolve().parent
if str(_APP) not in sys.path:
    sys.path.insert(0, str(_APP))

from core import (  # noqa: E402
    _download_poster,
    _item_poster_image,
    _plex_image_url,
    _thumb_path_fallbacks,
)


def _png_bytes(color=(200, 40, 40, 255), size=(20, 30)) -> bytes:
    buf = io.BytesIO()
    Image.new("RGBA", size, color).save(buf, format="PNG")
    return buf.getvalue()


class DownloadPosterTests(unittest.TestCase):
    def test_thumb_fallbacks_strip_timestamp(self):
        paths = _thumb_path_fallbacks("/library/metadata/42/thumb/1730000000", "42")
        self.assertEqual(
            paths,
            [
                "/library/metadata/42/thumb/1730000000",
                "/library/metadata/42/thumb",
            ],
        )

    def test_plex_image_url_uses_plex_url_helper(self):
        plex = MagicMock()
        plex._token = "tok"
        plex._baseurl = "https://example.plex.direct:32400"
        plex.url = MagicMock(return_value="https://example.plex.direct:32400/library/metadata/1/thumb?X-Plex-Token=tok")
        url = _plex_image_url(plex, "/library/metadata/1/thumb")
        plex.url.assert_called_once_with("/library/metadata/1/thumb", includeToken=True)
        self.assertIn("X-Plex-Token=tok", url)

    def test_download_poster_uses_plex_session_not_requests_get(self):
        plex = MagicMock()
        plex._token = "tok"
        plex._baseurl = "http://plex:32400"
        plex.url = MagicMock(side_effect=lambda path, includeToken=True: f"http://plex:32400{path}?X-Plex-Token=tok")
        response = MagicMock()
        response.status_code = 200
        response.content = _png_bytes()
        response.headers = {"Content-Type": "image/png"}
        plex._session.get = MagicMock(return_value=response)

        with patch("core.requests.get") as bare_get:
            img = _download_poster(plex, "/library/metadata/9/thumb/1")
            bare_get.assert_not_called()
        self.assertIsNotNone(img)
        plex._session.get.assert_called_once()
        kwargs = plex._session.get.call_args.kwargs
        self.assertIn("headers", kwargs)
        self.assertEqual(kwargs["headers"].get("X-Plex-Token"), "tok")

    def test_item_poster_image_falls_back_to_unversioned_thumb(self):
        plex = MagicMock()
        plex._token = "tok"
        plex._baseurl = "http://plex:32400"
        plex.url = MagicMock(side_effect=lambda path, includeToken=True: f"http://plex:32400{path}?X-Plex-Token=tok")

        miss = MagicMock()
        miss.status_code = 404
        miss.content = b""
        miss.headers = {}
        hit = MagicMock()
        hit.status_code = 200
        hit.content = _png_bytes((10, 220, 10, 255))
        hit.headers = {"Content-Type": "image/png"}

        def session_get(url, timeout=60, headers=None):
            if url.endswith("/thumb?X-Plex-Token=tok") or "/thumb?" in url and "/thumb/" not in url.split("?")[0]:
                return hit
            return miss

        plex._session.get = MagicMock(side_effect=session_get)

        item = MagicMock()
        item.thumb = "/library/metadata/7/thumb/999"
        item.ratingKey = "7"
        item.reload = MagicMock(side_effect=Exception("skip reload"))
        item.posters = MagicMock(return_value=[])

        img = _item_poster_image(plex, item)
        self.assertIsNotNone(img)
        self.assertEqual(img.getpixel((0, 0))[:3], (10, 220, 10))


if __name__ == "__main__":
    unittest.main()
