#!/usr/bin/env python3
"""Cookie parse/apply helpers for TPDB browser-session import."""

from __future__ import annotations

import json
import sys
import tempfile
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from requests import Request, Session

from core import (
    _parse_posterdb_browser_cookies,
    _posterdb_apply_cookie_rows,
    _posterdb_can_attempt_following,
    _posterdb_cloudflare_help,
    _posterdb_following_blocked_error,
    _posterdb_has_login_cookie,
    _posterdb_http_client,
    _posterdb_load_session_file,
    _posterdb_session_cache_key,
    _posterdb_session_has_login_cookies,
)


def _cookie_header(session: Session, url: str = "https://theposterdb.com/search") -> str:
    prepared = session.prepare_request(Request("GET", url))
    return str(prepared.headers.get("Cookie") or "")


def test_netscape_httponly_and_www_domain() -> None:
    text = "\n".join([
        "# Netscape HTTP Cookie File",
        "#HttpOnly_.theposterdb.com\tTRUE\t/\tTRUE\t1999999999\tthe_poster_database_session\tabc",
        "www.theposterdb.com\tFALSE\t/\tTRUE\t1999999999\tcf_clearance\txyz",
        ".google.com\tTRUE\t/\tTRUE\t1999999999\tNID\tskip-me",
        "# HttpOnly_.theposterdb.com\tTRUE\t/\tTRUE\t1999999999\tremember_web_59ba36\ttoken",
    ])
    rows = _parse_posterdb_browser_cookies(text)
    names = {row["name"] for row in rows}
    assert "the_poster_database_session" in names
    assert "cf_clearance" in names
    assert "remember_web_59ba36" in names
    assert "NID" in names
    assert _posterdb_has_login_cookie(names)

    session = Session()
    _posterdb_apply_cookie_rows(session, rows)
    header = _cookie_header(session)
    assert "the_poster_database_session=abc" in header
    assert "cf_clearance=xyz" in header
    assert "remember_web_59ba36=token" in header
    assert "NID=" not in header
    assert _cookie_header(session, "https://www.theposterdb.com/search")  # apex cookies still apply via our normalize


def test_cookie_editor_host_field_and_bom() -> None:
    payload = [
        {
            "host": ".theposterdb.com",
            "name": "the_poster_database_session",
            "value": "sess",
            "path": "/",
            "isSecure": True,
        },
        {
            "domain": "www.theposterdb.com",
            "name": "cf_clearance",
            "value": "cf",
            "path": "/",
        },
    ]
    text = "\ufeff" + json.dumps(payload)
    rows = _parse_posterdb_browser_cookies(text)
    assert [row["name"] for row in rows] == ["the_poster_database_session", "cf_clearance"]
    session = Session()
    _posterdb_apply_cookie_rows(session, rows)
    header = _cookie_header(session)
    assert "the_poster_database_session=sess" in header
    assert "cf_clearance=cf" in header


def test_skips_expired_login_cookie() -> None:
    rows = _parse_posterdb_browser_cookies([
        {
            "name": "the_poster_database_session",
            "value": "old",
            "domain": ".theposterdb.com",
            "expires": int(time.time()) - 3600,
        },
        {
            "name": "cf_clearance",
            "value": "cf",
            "domain": ".theposterdb.com",
            "expires": int(time.time()) + 3600,
        },
    ])
    session = Session()
    _posterdb_apply_cookie_rows(session, rows)
    header = _cookie_header(session)
    assert "the_poster_database_session=" not in header
    assert "cf_clearance=cf" in header
    assert not _posterdb_has_login_cookie([])


def test_header_string_defaults_to_tpdb() -> None:
    rows = _parse_posterdb_browser_cookies(
        "the_poster_database_session=abc; cf_clearance=xyz"
    )
    names = {row["name"] for row in rows}
    assert names == {"the_poster_database_session", "cf_clearance"}
    session = Session()
    _posterdb_apply_cookie_rows(session, rows)
    header = _cookie_header(session)
    assert "the_poster_database_session=abc" in header
    assert "cf_clearance=xyz" in header


def test_session_has_login_cookies() -> None:
    session = Session()
    assert not _posterdb_session_has_login_cookies(session)
    session.cookies.set("the_poster_database_session", "abc", domain="theposterdb.com", path="/")
    assert _posterdb_session_has_login_cookies(session)


def test_load_session_file_keeps_login_cookies_when_inspect_fails() -> None:
    import core

    orig = core._posterdb_inspect_session
    core._posterdb_inspect_session = lambda *a, **k: {"ok": False, "cloudflare": True}
    try:
        with tempfile.TemporaryDirectory() as tmp:
            path = str(Path(tmp) / "tpdb-session.json")
            cache_key = _posterdb_session_cache_key("user", "pass")
            Path(path).write_text(json.dumps({
                "cacheKey": cache_key,
                "savedAt": time.time(),
                "userAgent": "UA",
                "cookies": [{
                    "name": "the_poster_database_session",
                    "value": "sess",
                    "domain": "theposterdb.com",
                    "path": "/",
                }],
            }), encoding="utf-8")
            session = _posterdb_load_session_file({"tpdb_session_path": path}, cache_key)
            assert session is not None
            assert "the_poster_database_session=sess" in _cookie_header(session)
    finally:
        core._posterdb_inspect_session = orig


def test_http_client_restores_session_during_login_cooldown() -> None:
    import core

    fake = Session()
    orig_load = core._posterdb_load_session_file
    orig_sessions = dict(core._POSTERDB_SESSIONS)
    orig_fail = dict(core._POSTERDB_LOGIN_FAILED_UNTIL)
    core._posterdb_load_session_file = lambda config, key: fake
    try:
        core._POSTERDB_SESSIONS.clear()
        key = _posterdb_session_cache_key("user", "pass")
        core._POSTERDB_LOGIN_FAILED_UNTIL[key] = time.time() + 90
        client = _posterdb_http_client({
            "tpdb_username": "user",
            "tpdb_password": "pass",
            "tpdbUseLogin": True,
        })
        assert client is fake
    finally:
        core._posterdb_load_session_file = orig_load
        core._POSTERDB_SESSIONS.clear()
        core._POSTERDB_SESSIONS.update(orig_sessions)
        core._POSTERDB_LOGIN_FAILED_UNTIL.clear()
        core._POSTERDB_LOGIN_FAILED_UNTIL.update(orig_fail)


def test_following_login_page_surfaces_cloudflare_help() -> None:
    import core
    from bs4 import BeautifulSoup

    core._POSTERDB_LOGIN_LAST_ERROR = _posterdb_cloudflare_help()
    try:
        soup = BeautifulSoup(
            '<html><form><input type="password" name="password"></form></html>',
            "html.parser",
        )
        err = _posterdb_following_blocked_error(
            {"tpdb_username": "u", "tpdb_password": "p", "tpdbUseLogin": True},
            soup,
            "https://theposterdb.com/feed",
        )
        assert err and "Cloudflare" in err
    finally:
        core._POSTERDB_LOGIN_LAST_ERROR = None


def test_following_logged_in_empty_is_not_blocked() -> None:
    import core
    from bs4 import BeautifulSoup

    core._POSTERDB_LOGIN_LAST_ERROR = _posterdb_cloudflare_help()
    try:
        soup = BeautifulSoup('<html><a href="/logout">Log out</a></html>', "html.parser")
        err = _posterdb_following_blocked_error(
            {"tpdb_username": "u", "tpdb_password": "p", "tpdbUseLogin": True},
            soup,
            "https://theposterdb.com/feed",
        )
        assert err is None
    finally:
        core._POSTERDB_LOGIN_LAST_ERROR = None


def test_can_attempt_following_needs_login_or_session() -> None:
    assert not _posterdb_can_attempt_following({})
    assert _posterdb_can_attempt_following({
        "tpdb_username": "u",
        "tpdb_password": "secret",
        "tpdbUseLogin": True,
    })
    assert not _posterdb_can_attempt_following({
        "tpdb_username": "u",
        "tpdb_password": "secret",
        "tpdbUseLogin": False,
    })


if __name__ == "__main__":
    test_netscape_httponly_and_www_domain()
    test_cookie_editor_host_field_and_bom()
    test_skips_expired_login_cookie()
    test_header_string_defaults_to_tpdb()
    test_session_has_login_cookies()
    test_load_session_file_keeps_login_cookies_when_inspect_fails()
    test_http_client_restores_session_during_login_cooldown()
    test_following_login_page_surfaces_cloudflare_help()
    test_following_logged_in_empty_is_not_blocked()
    test_can_attempt_following_needs_login_or_session()
    print("ok")
