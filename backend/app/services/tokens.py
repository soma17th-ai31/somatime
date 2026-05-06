"""Slug and token generation.

- slug: 8-character base62, public.
- participant_token: urlsafe random, length >= 32, set as cookie.

v3.2 (Path B): organizer_token concept retired. The share URL alone now
authorizes calculate / recommend / confirm.
"""
from __future__ import annotations

import secrets
import string

BASE62_ALPHABET = string.ascii_letters + string.digits  # 62 chars


def generate_slug(length: int = 8) -> str:
    """Cryptographically random base62 slug."""
    if length < 1:
        raise ValueError("slug length must be >= 1")
    return "".join(secrets.choice(BASE62_ALPHABET) for _ in range(length))


def generate_participant_token(num_bytes: int = 24) -> str:
    if num_bytes < 24:
        raise ValueError("num_bytes must be >= 24 to satisfy 32+ char output")
    return secrets.token_urlsafe(num_bytes)
