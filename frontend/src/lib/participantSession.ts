const PARTICIPANT_NICKNAME_LS_KEY = (slug: string) => `somameet_pt_local_${slug}`
const PARTICIPANT_TOKEN_LS_KEY = (slug: string) => `somameet_pt_token_${slug}`

function readLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeLocalStorage(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value)
  } catch {
    /* ignore */
  }
}

function removeLocalStorage(key: string) {
  try {
    window.localStorage.removeItem(key)
  } catch {
    /* ignore */
  }
}

export function readParticipantNickname(slug: string): string | null {
  return readLocalStorage(PARTICIPANT_NICKNAME_LS_KEY(slug))
}

export function readParticipantToken(slug: string): string | null {
  return readLocalStorage(PARTICIPANT_TOKEN_LS_KEY(slug))
}

export function writeParticipantSession(slug: string, nickname: string, token?: string) {
  writeLocalStorage(PARTICIPANT_NICKNAME_LS_KEY(slug), nickname)
  if (token) writeLocalStorage(PARTICIPANT_TOKEN_LS_KEY(slug), token)
}

export function clearParticipantSession(slug: string) {
  removeLocalStorage(PARTICIPANT_NICKNAME_LS_KEY(slug))
  removeLocalStorage(PARTICIPANT_TOKEN_LS_KEY(slug))
}
