"""Slug and token generation.

- slug: 8-character base62, public.
- organizer_token: urlsafe random, length >= 32, secret.
- participant_token: urlsafe random, length >= 32, set as cookie.
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


def generate_organizer_token(num_bytes: int = 24) -> str:
    """secrets.token_urlsafe(24) yields 32 chars; spec requires >= 32."""
    if num_bytes < 24:
        raise ValueError("num_bytes must be >= 24 to satisfy 32+ char output")
    return secrets.token_urlsafe(num_bytes)


def generate_participant_token(num_bytes: int = 24) -> str:
    if num_bytes < 24:
        raise ValueError("num_bytes must be >= 24 to satisfy 32+ char output")
    return secrets.token_urlsafe(num_bytes)
