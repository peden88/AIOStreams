import { decodeSignedPayload, encodeSignedPayload } from './auth.js';

/**
 * AIOtv is a household device session, not a browser session. Keep it long-lived
 * so users are not asked to repeat Pocket ID login on the web-session cadence.
 * The token remains revocable on every bootstrap because the current admin
 * identity→UUID assignment and policy are revalidated server-side.
 */
export const AIO_TV_DEVICE_SESSION_TTL_SECONDS = 180 * 24 * 60 * 60;

interface AioTvDevicePayload {
  /** Token discriminator. Deliberately differs from normal session payloads. */
  kind: 'aio-tv';
  /** Authenticated AIOStreams/Pocket ID identity. */
  username: string;
  /** The single configuration this TV is authorised to bootstrap. */
  uuid: string;
  exp: number;
}

export interface AioTvDeviceSession {
  username: string;
  uuid: string;
  expiresAt: number;
}

/**
 * Issue a stateless bearer token scoped to one AIOStreams configuration UUID.
 *
 * The payload intentionally does not contain the normal session `u` field, so
 * verifySession() will never accept an AIOtv token as a browser/API session.
 * This keeps the native client out of unrelated authenticated endpoints.
 */
export function issueAioTvDeviceSession(
  username: string,
  uuid: string
): string {
  const payload: AioTvDevicePayload = {
    kind: 'aio-tv',
    username,
    uuid,
    exp:
      Math.floor(Date.now() / 1000) + AIO_TV_DEVICE_SESSION_TTL_SECONDS,
  };
  return encodeSignedPayload(payload);
}

/** Verify an AIOtv-only device bearer token. */
export function verifyAioTvDeviceSession(
  token: string | undefined
): AioTvDeviceSession | null {
  const payload = decodeSignedPayload<AioTvDevicePayload>(token);
  if (!payload) return null;
  if (
    payload.kind !== 'aio-tv' ||
    typeof payload.username !== 'string' ||
    payload.username.length === 0 ||
    typeof payload.uuid !== 'string' ||
    payload.uuid.length === 0 ||
    typeof payload.exp !== 'number' ||
    payload.exp < Math.floor(Date.now() / 1000)
  ) {
    return null;
  }

  return {
    username: payload.username,
    uuid: payload.uuid,
    expiresAt: payload.exp,
  };
}
