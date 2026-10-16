"""
Stable Plex client identity for Poster Sets.

Without this, plexapi defaults X-Plex-Device-Name to the machine hostname
(Docker container name/ID) and X-Plex-Device to the OS, which produces Plex
"New Device" alerts like "server-manager-portal (Linux)" on every restart.

Prefer env CLIENT_ID / PLEXAPI_HEADER_IDENTIFIER from the portal so all
workers share one durable device entry.
"""
from __future__ import annotations

import logging
import os
import uuid

PRODUCT = "Server Manager Portal"
DEVICE = "Server"
DEVICE_NAME = "Server Manager Portal"
PLATFORM = "Server Manager Portal"

_configured = False
_client_id = None


def _persist_path() -> str:
    data_root = (os.environ.get("POSTER_SETS_DATA_DIR") or os.environ.get("COLLEXIONS_DATA_DIR") or "").strip()
    if not data_root:
        data_root = os.path.dirname(os.path.abspath(__file__))
    cfg_dir = os.path.join(data_root, "config")
    os.makedirs(cfg_dir, exist_ok=True)
    return os.path.join(cfg_dir, "plex_client_id")


def get_client_id() -> str:
    global _client_id
    if _client_id:
        return _client_id

    for key in (
        "PLEX_CLIENT_IDENTIFIER",
        "PLEXAPI_HEADER_IDENTIFIER",
        "CLIENT_ID",
        "POSTER_SETS_PLEX_CLIENT_ID",
    ):
        val = (os.environ.get(key) or "").strip()
        if val:
            _client_id = val
            return _client_id

    path = _persist_path()
    try:
        if os.path.isfile(path):
            stored = open(path, "r", encoding="utf-8").read().strip()
            if stored:
                _client_id = stored
                return _client_id
    except OSError:
        pass

    _client_id = str(uuid.uuid4())
    try:
        with open(path, "w", encoding="utf-8") as fh:
            fh.write(_client_id)
    except OSError as exc:
        logging.warning("Could not persist Poster Sets plex client id: %s", exc)
    return _client_id


def _apply_env_defaults(client_id: str) -> None:
    os.environ["PLEXAPI_HEADER_IDENTIFIER"] = client_id
    os.environ["PLEXAPI_HEADER_PRODUCT"] = PRODUCT
    os.environ["PLEXAPI_HEADER_DEVICE"] = DEVICE
    os.environ["PLEXAPI_HEADER_DEVICE_NAME"] = DEVICE_NAME
    os.environ["PLEXAPI_HEADER_PLATFORM"] = PLATFORM
    os.environ.setdefault("PLEX_CLIENT_IDENTIFIER", client_id)
    os.environ.setdefault("CLIENT_ID", client_id)


def _sync_base_headers(plexapi, new_headers) -> None:
    if not isinstance(getattr(plexapi, "BASE_HEADERS", None), dict):
        plexapi.BASE_HEADERS = new_headers
    else:
        plexapi.BASE_HEADERS.clear()
        plexapi.BASE_HEADERS.update(new_headers)

    for mod_name in ("plexapi.server", "plexapi.myplex"):
        try:
            mod = __import__(mod_name, fromlist=["BASE_HEADERS"])
            alias = getattr(mod, "BASE_HEADERS", None)
            if isinstance(alias, dict) and alias is not plexapi.BASE_HEADERS:
                alias.clear()
                alias.update(new_headers)
        except Exception:
            pass


def configure_plex_identity(force: bool = False) -> str:
    """Patch plexapi globals so every PlexServer() call uses our identity."""
    global _configured
    client_id = get_client_id()
    _apply_env_defaults(client_id)
    if _configured and not force:
        return client_id

    try:
        import plexapi

        plexapi.X_PLEX_PRODUCT = PRODUCT
        plexapi.X_PLEX_DEVICE = DEVICE
        plexapi.X_PLEX_DEVICE_NAME = DEVICE_NAME
        plexapi.X_PLEX_PLATFORM = PLATFORM
        plexapi.X_PLEX_IDENTIFIER = client_id
        _sync_base_headers(plexapi, plexapi.reset_base_headers())
        _configured = True
        logging.info(
            "Poster Sets plex identity: product=%s deviceName=%s clientId=%s…",
            PRODUCT,
            DEVICE_NAME,
            client_id[:8],
        )
    except Exception as exc:
        logging.warning("Could not configure Poster Sets plexapi identity: %s", exc)

    return client_id
