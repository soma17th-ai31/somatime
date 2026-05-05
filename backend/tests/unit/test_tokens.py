"""Unit tests for slug/token generation."""
from __future__ import annotations

import string

import pytest

from app.services.tokens import (
    BASE62_ALPHABET,
    generate_organizer_token,
    generate_participant_token,
    generate_slug,
)


def test_slug_is_8_chars_default() -> None:
    slug = generate_slug()
    assert len(slug) == 8


def test_slug_uses_only_base62_alphabet() -> None:
    expected = set(string.ascii_letters + string.digits)
    for _ in range(100):
        slug = generate_slug()
        assert set(slug).issubset(expected)
    assert set(BASE62_ALPHABET) == expected


def test_slug_no_collisions_in_1k_iterations() -> None:
    seen = {generate_slug() for _ in range(1000)}
    assert len(seen) == 1000


def test_slug_zero_length_rejected() -> None:
    with pytest.raises(ValueError):
        generate_slug(0)


def test_organizer_token_at_least_32_chars() -> None:
    for _ in range(50):
        token = generate_organizer_token()
        assert len(token) >= 32


def test_participant_token_at_least_32_chars() -> None:
    for _ in range(50):
        token = generate_participant_token()
        assert len(token) >= 32


def test_organizer_token_urlsafe_chars() -> None:
    allowed = set(string.ascii_letters + string.digits + "-_")
    for _ in range(50):
        assert set(generate_organizer_token()).issubset(allowed)


def test_participant_token_urlsafe_chars() -> None:
    allowed = set(string.ascii_letters + string.digits + "-_")
    for _ in range(50):
        assert set(generate_participant_token()).issubset(allowed)


def test_participant_token_no_collisions_in_1k_iterations() -> None:
    seen = {generate_participant_token() for _ in range(1000)}
    assert len(seen) == 1000


def test_organizer_token_rejects_too_few_bytes() -> None:
    with pytest.raises(ValueError):
        generate_organizer_token(num_bytes=8)
