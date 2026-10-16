#!/usr/bin/env python3
"""JSON CLI for Poster Sets. Reads one JSON request from stdin or --payload."""

from __future__ import annotations

import argparse
import json
import sys
import traceback

from core import (
    apply_bulk,
    apply_url,
    import_posterdb_browser_cookies,
    list_assets,
    parse_bulk_urls,
    preview_url,
    search_catalog,
    test_connection,
    test_posterdb_login,
    warm_library_titles,
)


def write_event(event_type: str, **payload) -> None:
    sys.stdout.write(json.dumps({"type": event_type, **payload}, ensure_ascii=False) + "\n")
    sys.stdout.flush()


def progress(message: str) -> None:
    write_event("progress", message=message)


def main() -> int:
    parser = argparse.ArgumentParser(description="Poster Sets headless CLI")
    parser.add_argument("command", choices=["test", "test-tpdb", "import-tpdb-cookies", "preview", "apply", "bulk", "search", "inspect", "warm"])
    parser.add_argument("--payload", default="", help="JSON payload string (otherwise read stdin)")
    args = parser.parse_args()

    try:
        raw = args.payload.strip() if args.payload else sys.stdin.read()
        request = json.loads(raw or "{}")
    except Exception as exc:
        write_event("error", message=f"Invalid JSON payload: {exc}")
        return 1

    config = request.get("config") if isinstance(request.get("config"), dict) else {}
    try:
        if args.command == "test":
            result = test_connection(config)
            write_event("result", **result)
            return 0

        if args.command == "test-tpdb":
            result = test_posterdb_login(config)
            write_event("result", **result)
            return 0

        if args.command == "import-tpdb-cookies":
            cookies = request.get("cookies")
            if cookies is None:
                cookies = request.get("cookieText") or request.get("cookie_text") or ""
            user_agent = str(request.get("userAgent") or request.get("user_agent") or "").strip()
            import_config = {**config}
            if user_agent:
                import_config["tpdb_browser_user_agent"] = user_agent
            result = import_posterdb_browser_cookies(import_config, cookies)
            write_event("result", **result)
            return 0 if result.get("ok") else 1

        if args.command == "inspect":
            url = str(request.get("url") or "").strip()
            if not url:
                raise ValueError("url is required")
            filters = request.get("mediuxFilters") or request.get("mediux_filters")
            inspect_config = {**config}
            if isinstance(filters, list) and filters:
                inspect_config["mediux_filters"] = filters
            result = list_assets(url, inspect_config, progress=progress)
            write_event("result", **result)
            return 0

        if args.command == "preview":
            url = str(request.get("url") or "").strip()
            if not url:
                raise ValueError("url is required")
            filters = request.get("mediuxFilters") or request.get("mediux_filters")
            preview_config = {**config}
            if isinstance(filters, list) and filters:
                preview_config["mediux_filters"] = filters
            result = preview_url(url, preview_config, progress=progress)
            write_event(
                "result",
                ok=True,
                url=result.get("url"),
                movies=result.get("movies"),
                shows=result.get("shows"),
                collections=result.get("collections"),
                total=result.get("total"),
                matched=result.get("matched"),
                unmatched=result.get("unmatched"),
                matchError=result.get("matchError"),
                samples=result.get("samples"),
                assets=result.get("assets") or [],
                setMeta=result.get("setMeta"),
            )
            return 0

        if args.command == "search":
            mode = str(request.get("mode") or "title")
            raw_limit = request.get("limit")
            if raw_limit is None or raw_limit == "":
                unbounded = str(mode).strip().lower() in {
                    "creator", "user", "author", "uploader",
                    "recent", "browse", "recently_added", "recently-added",
                    "feed", "following", "following_feed", "follows",
                }
                limit = 0 if unbounded else 24
            else:
                limit = int(raw_limit)
            batch_pages = int(request.get("batchPages") or request.get("batch_pages") or 3)
            stream_batches = bool(request.get("streamBatches") if "streamBatches" in request else request.get("stream_batches", True))
            raw_max_pages = request.get("maxPages")
            if raw_max_pages in (None, ""):
                raw_max_pages = request.get("max_pages")
            try:
                max_set_pages = int(raw_max_pages) if raw_max_pages not in (None, "") else None
            except Exception:
                max_set_pages = None

            def on_batch(payload: dict) -> None:
                if stream_batches:
                    write_event("batch", **payload)

            result = search_catalog(
                str(request.get("provider") or ""),
                query=str(request.get("query") or request.get("q") or ""),
                title_url=str(request.get("titleUrl") or request.get("title_url") or ""),
                media_type=str(request.get("mediaType") or request.get("media_type") or "movie"),
                tmdb_id=request.get("tmdbId") or request.get("tmdb_id"),
                imdb_id=request.get("imdbId") or request.get("imdb_id"),
                tvdb_id=request.get("tvdbId") or request.get("tvdb_id"),
                title_hint=str(request.get("titleHint") or request.get("title_hint") or ""),
                year_hint=request.get("yearHint") or request.get("year_hint"),
                mode=mode,
                kind=str(request.get("kind") or request.get("railKind") or "posters"),
                page=int(request.get("page") or 1),
                limit=limit,
                progress=progress,
                on_batch=on_batch if stream_batches else None,
                batch_pages=batch_pages,
                config=config,
                max_set_pages=max_set_pages,
                titles_only=bool(request.get("titlesOnly") or request.get("titles_only")),
            )
            write_event("result", **result)
            return 0

        if args.command == "warm":
            items = request.get("items") if isinstance(request.get("items"), list) else []

            def on_title(payload: dict) -> None:
                write_event("batch", **payload)

            result = warm_library_titles(
                items,
                config=config,
                progress=progress,
                on_title=on_title,
            )
            write_event("result", **result)
            return 0 if result.get("ok") is not False else 1

        if args.command == "apply":
            url = str(request.get("url") or "").strip()
            if not url:
                raise ValueError("url is required")
            selected_ids = request.get("selectedIds")
            if not isinstance(selected_ids, list):
                selected_ids = None
            plex_hint = request.get("plexHint") or request.get("plex_hint")
            if not isinstance(plex_hint, dict):
                plex_hint = None
            selected_assets = request.get("selectedAssets") or request.get("selected_assets")
            if not isinstance(selected_assets, list):
                selected_assets = None
            result = apply_url(
                url,
                config,
                progress=progress,
                selected_ids=selected_ids,
                plex_hint=plex_hint,
                selected_assets=selected_assets,
            )
            write_event("result", **result)
            return 0 if result.get("ok") else 1

        if args.command == "bulk":
            urls = request.get("urls")
            if isinstance(urls, list) and urls:
                parsed = [str(item).strip() for item in urls if str(item).strip()]
            else:
                text = str(request.get("text") or "")
                parsed = parse_bulk_urls(text.splitlines())
            if not parsed:
                raise ValueError("No URLs provided for bulk apply")
            result = apply_bulk(parsed, config, progress=progress)
            write_event("result", **result)
            return 0 if result.get("ok") else 1

        write_event("error", message=f"Unknown command: {args.command}")
        return 1
    except Exception as exc:
        write_event("error", message=str(exc), detail=traceback.format_exc()[-2000:])
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
