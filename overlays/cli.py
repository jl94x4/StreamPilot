#!/usr/bin/env python3
"""JSON CLI for Overlays (New Season). Reads one JSON request from stdin or --payload."""

from __future__ import annotations

import argparse
import json
import sys
import traceback
from pathlib import Path

# Ensure sibling modules (core, tmdb_dates, modes_extra) resolve even when cwd differs.
_APP_DIR = str(Path(__file__).resolve().parent)
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)

from core import (
    generate_overlay_samples,
    list_status,
    list_tv_sections,
    promote_preview_to_live,
    reconcile,
    reset_all,
    reset_one,
    run_overlays,
    scan_library,
    search_sample_candidates,
)


def write_event(event_type: str, **payload) -> None:
    def _default(value):
        if isinstance(value, (set, frozenset)):
            return list(value)
        if isinstance(value, Path):
            return str(value)
        raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")

    sys.stdout.write(json.dumps({"type": event_type, **payload}, ensure_ascii=False, default=_default) + "\n")
    sys.stdout.flush()


def progress(message: str) -> None:
    write_event("progress", message=message)


def main() -> int:
    parser = argparse.ArgumentParser(description="Overlays New Season CLI")
    parser.add_argument(
        "command",
        choices=[
            "status",
            "scan",
            "run",
            "preview",
            "run-recently",
            "preview-recently",
            "run-kometa",
            "preview-kometa",
            "run-collections",
            "preview-collections",
            "cleanup",
            "reconcile",
            "reset-one",
            "reset-all",
            "revert-kometa",
            "drop-kometa-family",
            "promote",
            "sections",
            "sample",
            "sample-candidates",
        ],
    )
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
        # sections / sample-candidates are UI helpers — don't spam Activity.
        if args.command not in {"sections", "sample-candidates", "status"}:
            progress(f"Worker received `{args.command}`")
        if args.command == "status":
            write_event("result", **list_status(config))
            return 0

        if args.command == "sections":
            write_event("result", **list_tv_sections(config))
            return 0

        if args.command == "sample":
            show_key = str(request.get("showRatingKey") or request.get("show_rating_key") or "").strip() or None
            ep_key = str(request.get("episodeRatingKey") or request.get("episode_rating_key") or "").strip() or None
            write_event(
                "result",
                **generate_overlay_samples(
                    config,
                    progress=progress,
                    show_rating_key=show_key,
                    episode_rating_key=ep_key,
                ),
            )
            return 0

        if args.command == "sample-candidates":
            query = str(request.get("query") or request.get("q") or "")
            write_event("result", **search_sample_candidates(config, query=query, progress=None))
            return 0

        if args.command == "scan":
            write_event("result", **scan_library(config, progress=progress))
            return 0

        if args.command == "reconcile":
            write_event("result", **reconcile(config, progress=progress))
            return 0

        if args.command == "reset-one":
            key = str(request.get("ratingKey") or request.get("rating_key") or "").strip()
            kind = str(request.get("kind") or "").strip() or None
            write_event("result", **reset_one(config, key, progress=progress, kind=kind))
            return 0

        if args.command == "reset-all":
            scope = str(request.get("scope") or request.get("kind") or "all").strip() or "all"
            write_event("result", **reset_all(config, progress=progress, scope=scope))
            return 0

        if args.command == "revert-kometa":
            from kometa_engine import revert_kometa
            key = str(request.get("ratingKey") or request.get("rating_key") or "").strip() or None
            write_event("result", **revert_kometa(config, rating_key=key, progress=progress))
            return 0

        if args.command == "drop-kometa-family":
            from kometa_engine import drop_kometa_family
            family = str(request.get("family") or "").strip()
            rule_id = str(request.get("ruleId") or request.get("rule_id") or "").strip() or None
            raw_keys = request.get("ratingKeys") or request.get("rating_keys") or []
            rating_keys = [
                str(key or "").strip()
                for key in (raw_keys if isinstance(raw_keys, list) else [raw_keys])
                if str(key or "").strip()
            ]
            write_event(
                "result",
                **drop_kometa_family(
                    config,
                    family,
                    rule_id=rule_id,
                    rating_keys=rating_keys or None,
                    progress=progress,
                ),
            )
            return 0

        if args.command == "promote":
            write_event("result", **promote_preview_to_live(config, progress=progress))
            return 0

        if args.command in {
            "run",
            "preview",
            "cleanup",
            "run-recently",
            "preview-recently",
            "run-kometa",
            "preview-kometa",
            "run-collections",
            "preview-collections",
        }:
            preview_override = True if args.command.startswith("preview") else None
            if args.command == "cleanup":
                # cleanup uses same runner; removals happen when not eligible
                preview_override = False if config.get("previewMode") is not True else True
            bundle = None
            if "recently" in args.command:
                bundle = "recently"
            elif "collections" in args.command:
                bundle = "collections"
                config["kometaScope"] = "collections"
            elif "kometa" in args.command:
                bundle = "kometa"
                # Media / Layer runs stay scoped unless caller set an explicit scope.
                if not str(config.get("kometaScope") or config.get("kometa_scope") or "").strip():
                    config["kometaScope"] = "media"
            elif args.command in {"run", "preview", "cleanup"}:
                # Main Preview/Run stays on the fast core path unless caller sets runBundle.
                bundle = str(config.get("runBundle") or config.get("run_bundle") or "core")
            write_event(
                "result",
                **run_overlays(
                    config,
                    progress=progress,
                    preview_override=preview_override,
                    bundle=bundle,
                ),
            )
            return 0

        write_event("error", message=f"Unknown command: {args.command}")
        return 1
    except Exception as exc:
        write_event("error", message=str(exc), detail=traceback.format_exc())
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
