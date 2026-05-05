"""Integration tests for the Google OAuth URL builder.

S9: scope MUST be calendar.freebusy ONLY.
"""
from __future__ import annotations

from urllib.parse import parse_qs, urlparse

import pytest

from app.services.google_freebusy import (
    DEFAULT_SCOPE,
    OAuthConfig,
    build_oauth_url,
    decode_state,
    encode_state,
)


@pytest.fixture()
def oauth_config() -> OAuthConfig:
    return OAuthConfig(
        client_id="client.apps.googleusercontent.com",
        client_secret="secret",
        redirect_uri="http://localhost:8000/api/auth/google/callback",
        scopes=(DEFAULT_SCOPE,),
        session_secret="x" * 32,
    )


def test_oauth_url_includes_only_freebusy_scope(oauth_config: OAuthConfig) -> None:
    url = build_oauth_url(
        meeting_slug="aB3kF9xQ",
        participant_token="t" * 32,
        config=oauth_config,
    )
    parsed = urlparse(url)
    qs = parse_qs(parsed.query)
    scope_values = qs["scope"][0]
    assert "calendar.freebusy" in scope_values
    assert "calendar.readonly" not in scope_values
    assert "calendar.events" not in scope_values
    # Exact: only the freebusy scope.
    assert set(scope_values.split()) == {DEFAULT_SCOPE}


def test_oauth_url_includes_state_with_slug_and_pt(oauth_config: OAuthConfig) -> None:
    url = build_oauth_url(
        meeting_slug="aB3kF9xQ",
        participant_token="ptokABC",
        config=oauth_config,
    )
    qs = parse_qs(urlparse(url).query)
    state = qs["state"][0]
    slug, pt = decode_state(state, oauth_config.session_secret)
    assert slug == "aB3kF9xQ"
    assert pt == "ptokABC"


def test_state_signature_rejects_tampering(oauth_config: OAuthConfig) -> None:
    state = encode_state("slug", "pt", oauth_config.session_secret)
    payload, sig = state.split(".", 1)
    tampered = payload + "x" + "." + sig

    from app.services.google_freebusy import GoogleOAuthError

    with pytest.raises(GoogleOAuthError):
        decode_state(tampered, oauth_config.session_secret)
