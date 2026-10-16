#!/usr/bin/env python3
"""
Headless JSONL CLI for Edition Manager (SMP wrapper).

Reads a JSON payload from --payload or stdin with:
  { "action": "...", "config": { ... }, "ratingKey"?: "...", "query"?: "...", "backupFile"?: "..." }

Writes newline-delimited JSON events to stdout:
  {"type":"log","level":"info","message":"..."}
  {"type":"progress","message":"...","percent":12}
  {"type":"result", ...}
  {"type":"error","message":"..."}
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import sys
from configparser import ConfigParser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
CONFIG_PATH = Path(os.environ.get("EDITIONS_CONFIG_INI") or (ROOT / "config" / "config.ini"))

ALL_MODULES = [
    "AudioChannels",
    "AudioCodec",
    "Bitrate",
    "ContentRating",
    "Country",
    "Cut",
    "Director",
    "Duration",
    "DynamicRange",
    "FrameRate",
    "Genre",
    "Language",
    "Rating",
    "Release",
    "Resolution",
    "ShortFilm",
    "Size",
    "Source",
    "SpecialFeatures",
    "Studio",
    "VideoCodec",
    "Writer",
]


def emit(event_type: str, **payload) -> None:
    sys.stdout.write(json.dumps({"type": event_type, **payload}, ensure_ascii=False) + "\n")
    sys.stdout.flush()


class JsonlLogHandler(logging.Handler):
    def emit(self, record: logging.LogRecord) -> None:
        try:
            msg = self.format(record)
            emit("log", level=record.levelname.lower(), message=msg)
            # Heuristic progress from common logger lines.
            lower = msg.lower()
            if "processing" in lower or "batch" in lower or "%" in msg:
                emit("progress", message=msg)
        except Exception:
            pass


def write_config_ini(cfg: dict) -> None:
    CONFIG_PATH.parent.mkdir(parents=True, exist_ok=True)
    parser = ConfigParser(interpolation=None)

    server = cfg.get("server") if isinstance(cfg.get("server"), dict) else {}
    modules = cfg.get("modules") if isinstance(cfg.get("modules"), dict) else {}
    language = cfg.get("language") if isinstance(cfg.get("language"), dict) else {}
    rating = cfg.get("rating") if isinstance(cfg.get("rating"), dict) else {}
    performance = cfg.get("performance") if isinstance(cfg.get("performance"), dict) else {}
    template = cfg.get("template") if isinstance(cfg.get("template"), dict) else {}
    tmdb_language = cfg.get("tmdbLanguage") if isinstance(cfg.get("tmdbLanguage"), dict) else {}

    order = modules.get("order")
    if isinstance(order, list):
        order_str = ";".join(str(x).strip() for x in order if str(x).strip())
    else:
        order_str = str(order or ";".join(ALL_MODULES))

    skip = server.get("skipLibraries") or server.get("skip_libraries") or []
    if isinstance(skip, list):
        skip_str = ";".join(str(x).strip() for x in skip if str(x).strip())
    else:
        skip_str = str(skip or "")

    excluded = language.get("excludedLanguages") or language.get("excluded_languages") or []
    if isinstance(excluded, list):
        excluded_str = ", ".join(str(x).strip() for x in excluded if str(x).strip())
    else:
        excluded_str = str(excluded or "")

    parser["server"] = {
        "address": str(server.get("address") or ""),
        "token": str(server.get("token") or ""),
        "skip_libraries": skip_str,
    }
    parser["modules"] = {"order": order_str}
    parser["language"] = {
        "excluded_languages": excluded_str,
        "skip_multiple_audio_tracks": "yes" if language.get("skipMultipleAudioTracks", language.get("skip_multiple_audio_tracks", False)) else "no",
    }
    parser["TMDB_language"] = {
        "hide_when_english": "yes" if tmdb_language.get("hideWhenEnglish", tmdb_language.get("hide_when_english", True)) else "no",
    }
    parser["rating"] = {
        "source": str(rating.get("source") or "imdb"),
        "rotten_tomatoes_type": str(rating.get("rottenTomatoesType") or rating.get("rotten_tomatoes_type") or "critic"),
        "tmdb_api_key": str(rating.get("tmdbApiKey") or rating.get("tmdb_api_key") or ""),
    }
    parser["performance"] = {
        "max_workers": str(int(performance.get("maxWorkers") or performance.get("max_workers") or 8)),
        "batch_size": str(int(performance.get("batchSize") or performance.get("batch_size") or 20)),
        "metadata_batch_size": str(int(performance.get("metadataBatchSize") or performance.get("metadata_batch_size") or 50)),
    }
    parser["template"] = {
        "format": str(template.get("format") or "auto"),
        "separator": str(template.get("separator") or " • "),
        "max_length": str(int(template.get("maxLength") or template.get("max_length") or 0)),
    }
    parser["webhook"] = {"enabled": "no"}
    parser["appearance"] = {"primary_color": "#e5a00d", "dark_mode": "yes"}
    parser["scheduler"] = {"enabled": "no", "cron": "0 3 * * *", "last_run": ""}

    with CONFIG_PATH.open("w", encoding="utf-8") as fh:
        parser.write(fh)


def setup_logging() -> None:
    root = logging.getLogger()
    root.handlers.clear()
    root.setLevel(logging.INFO)
    handler = JsonlLogHandler()
    handler.setFormatter(logging.Formatter("%(message)s"))
    root.addHandler(handler)


def main() -> int:
    parser = argparse.ArgumentParser(description="Edition Manager SMP CLI")
    parser.add_argument("--payload", default="", help="JSON payload (else read stdin)")
    args = parser.parse_args()

    try:
        raw = args.payload.strip() if args.payload else sys.stdin.read()
        request = json.loads(raw or "{}")
    except Exception as exc:
        emit("error", message=f"Invalid JSON payload: {exc}")
        return 1

    action = str(request.get("action") or "").strip().lower()
    cfg = request.get("config") if isinstance(request.get("config"), dict) else {}

    setup_logging()

    try:
        write_config_ini(cfg)
    except Exception as exc:
        emit("error", message=f"Failed to write config.ini: {exc}")
        return 1

    # Import after config write so modules that read config.ini at call-time see it.
    import edition_manager as em

    try:
        if action == "test":
            (
                server,
                token,
                skip_libraries,
                modules,
                *_rest,
            ) = em.initialize_settings()
            headers = {"X-Plex-Token": token, "Accept": "application/json"}
            response = em.make_request(f"{server}/library/sections", headers)
            libs = response.get("MediaContainer", {}).get("Directory", []) or []
            movie_libs = [
                {"id": str(d.get("key")), "title": d.get("title"), "type": d.get("type")}
                for d in libs
                if str(d.get("type") or "").lower() == "movie"
            ]
            emit(
                "result",
                ok=True,
                serverName=response.get("MediaContainer", {}).get("friendlyName") or server,
                libraries=movie_libs,
                modules=modules,
                skipLibraries=sorted(skip_libraries),
            )
            return 0

        if action == "search":
            (
                server,
                token,
                *_rest,
            ) = em.initialize_settings()
            query = str(request.get("query") or "").strip()
            if not query:
                raise ValueError("query is required")
            matches = em.find_movies_by_title(server, token, query)
            emit("result", ok=True, matches=matches or [])
            return 0

        if action == "process-all":
            (
                server,
                token,
                skip_libraries,
                modules,
                excluded_languages,
                skip_multiple_audio_tracks,
                tmdb_api_key,
                max_workers,
                batch_size,
                metadata_batch_size,
            ) = em.initialize_settings()
            emit("progress", message="Creating undo snapshot before processing…")
            em.create_undo_snapshot(server, token)
            em.process_movies(
                server,
                token,
                skip_libraries,
                modules,
                excluded_languages,
                skip_multiple_audio_tracks,
                tmdb_api_key,
                max_workers,
                batch_size,
                metadata_batch_size,
            )
            emit("result", ok=True, action=action)
            return 0

        if action == "process-one":
            (
                server,
                token,
                _skip,
                modules,
                excluded_languages,
                skip_multiple_audio_tracks,
                tmdb_api_key,
                *_rest,
            ) = em.initialize_settings()
            rating_key = str(request.get("ratingKey") or "").strip()
            if not rating_key:
                raise ValueError("ratingKey is required")
            ok = em.process_movie_by_rating_key(
                server,
                token,
                rating_key,
                modules,
                excluded_languages,
                skip_multiple_audio_tracks,
                tmdb_api_key,
            )
            emit("result", ok=bool(ok), action=action, ratingKey=rating_key)
            return 0 if ok else 1

        if action == "reset":
            (
                server,
                token,
                skip_libraries,
                _modules,
                _excl,
                _skip_multi,
                _tmdb,
                max_workers,
                batch_size,
                *_rest,
            ) = em.initialize_settings()
            emit("progress", message="Creating undo snapshot before reset…")
            em.create_undo_snapshot(server, token)
            em.reset_movies(server, token, skip_libraries, max_workers, batch_size)
            emit("result", ok=True, action=action)
            return 0

        if action == "backup":
            server, token, *_rest = em.initialize_settings()
            path = em.backup_metadata(server, token, None)
            emit("result", ok=True, action=action, backupFile=str(path) if path else None)
            return 0

        if action == "restore":
            server, token, *_rest = em.initialize_settings()
            backup_file = request.get("backupFile") or None
            em.restore_metadata(server, token, backup_file)
            emit("result", ok=True, action=action, backupFile=backup_file)
            return 0

        if action == "list-backups":
            files = em.list_backups()
            emit(
                "result",
                ok=True,
                backups=[
                    {
                        "name": p.name,
                        "path": str(p),
                        "mtime": p.stat().st_mtime,
                        "size": p.stat().st_size,
                    }
                    for p in files
                ],
            )
            return 0

        if action == "undo":
            server, token, *_rest = em.initialize_settings()
            ok = em.restore_undo_snapshot(server, token)
            emit("result", ok=bool(ok), action=action)
            return 0 if ok else 1

        if action == "modules":
            emit("result", ok=True, modules=ALL_MODULES)
            return 0

        raise ValueError(f"Unknown action: {action or '(empty)'}")
    except SystemExit as exc:
        code = int(exc.code) if isinstance(exc.code, int) else 1
        emit("error", message="Edition Manager exited early (check Plex connection).")
        return code or 1
    except Exception as exc:
        emit("error", message=str(exc) or "Edition Manager command failed")
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
