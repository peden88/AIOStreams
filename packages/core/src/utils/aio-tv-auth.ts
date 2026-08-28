import { config as appConfig } from '../config/index.js';
import { decodeSignedPayload, encodeSignedPayload } from './auth.js';

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
    exp: Math.floor(Date.now() / 1000) + appConfig.api.sessionTtlSeconds,
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
