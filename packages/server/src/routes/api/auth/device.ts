import crypto from 'node:crypto';
import { Request, Router } from 'express';
import {
  APIError,
  constants,
  config as appConfig,
  getEffectivePermissions,
  issueSession,
} from '@aiostreams/core';
import { requireSession } from '../../../middlewares/auth.js';
import { createResponse } from '../../../utils/responses.js';

const router: Router = Router();

const DEVICE_CODE_TTL_MS = 10 * 60 * 1000;
const POLL_INTERVAL_SECONDS = 3;

type DeviceGrant = {
  deviceCode: string;
  userCode: string;
  createdAt: number;
  expiresAt: number;
  status: 'pending' | 'approved' | 'consumed';
  username?: string;
};

const grants = new Map<string, DeviceGrant>();
const userCodeIndex = new Map<string, string>();

function pruneExpired(): void {
  const now = Date.now();
  for (const [deviceCode, grant] of grants) {
    if (grant.expiresAt <= now || grant.status === 'consumed') {
      grants.delete(deviceCode);
      userCodeIndex.delete(grant.userCode);
    }
  }
}

function randomDeviceCode(): string {
  return crypto.randomBytes(32).toString('base64url');
}

function randomUserCode(): string {
  // Human-readable code for the confirmation screen, e.g. A7KQ-P9T2.
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const chars = Array.from({ length: 8 }, () =>
    alphabet[crypto.randomInt(0, alphabet.length)]
  );
  return `${chars.slice(0, 4).join('')}-${chars.slice(4).join('')}`;
}

function baseUrl(req: Request): string {
  return (
    appConfig.bootstrap.baseUrl ||
    `${req.protocol}://${req.get('host')}`
  ).replace(/\/$/, '');
}

function findByUserCode(userCode: unknown): DeviceGrant | undefined {
  if (typeof userCode !== 'string') return undefined;
  const normalized = userCode.trim().toUpperCase();
  const deviceCode = userCodeIndex.get(normalized);
  return deviceCode ? grants.get(deviceCode) : undefined;
}

// POST /auth/device/start
// Called by the Android TV app. No existing login is required.
router.post('/start', (req, res) => {
  pruneExpired();

  let userCode = randomUserCode();
  while (userCodeIndex.has(userCode)) userCode = randomUserCode();

  const deviceCode = randomDeviceCode();
  const now = Date.now();
  const grant: DeviceGrant = {
    deviceCode,
    userCode,
    createdAt: now,
    expiresAt: now + DEVICE_CODE_TTL_MS,
    status: 'pending',
  };

  grants.set(deviceCode, grant);
  userCodeIndex.set(userCode, deviceCode);

  const verificationUri = `${baseUrl(req)}/api/v${constants.API_VERSION}/auth/device/verify?user_code=${encodeURIComponent(userCode)}`;

  res.status(201).json(
    createResponse({
      success: true,
      data: {
        deviceCode,
        userCode,
        verificationUri,
        expiresIn: Math.floor(DEVICE_CODE_TTL_MS / 1000),
        interval: POLL_INTERVAL_SECONDS,
      },
    })
  );
});

// GET /auth/device/verify?user_code=XXXX-XXXX
// Opened on the phone after scanning the QR. requireSession redirects an
// unauthenticated browser through the normal login/OIDC flow and back here.
router.get('/verify', requireSession, (req, res) => {
  pruneExpired();
  const grant = findByUserCode(req.query.user_code);

  if (!grant || grant.expiresAt <= Date.now()) {
    res
      .status(404)
      .type('html')
      .send('<!doctype html><title>AIO TV</title><h1>Pairing code expired</h1><p>Return to the TV and request a new QR code.</p>');
    return;
  }

  if (grant.status !== 'pending') {
    res
      .status(200)
      .type('html')
      .send('<!doctype html><title>AIO TV</title><h1>Device already approved</h1><p>You can return to the TV.</p>');
    return;
  }

  const code = grant.userCode.replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[char] ?? char);

  res.status(200).type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Approve AIO TV</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#101114;color:#fff;min-height:100vh;margin:0;display:grid;place-items:center}
main{max-width:28rem;padding:2rem;text-align:center}
code{display:block;font-size:2rem;font-weight:700;letter-spacing:.12em;margin:1.5rem 0}
button{font:inherit;font-weight:700;padding:.9rem 1.4rem;border:0;border-radius:.7rem;cursor:pointer}
p{color:#c8cbd0;line-height:1.5}
</style>
</head>
<body><main>
<h1>Connect AIO TV?</h1>
<p>Only approve this request if the code below matches the code shown on your TV.</p>
<code>${code}</code>
<form method="post" action="/api/v${constants.API_VERSION}/auth/device/approve">
<input type="hidden" name="user_code" value="${code}">
<button type="submit">Approve TV</button>
</form>
</main></body></html>`);
});

// POST /auth/device/approve
// Browser-only confirmation step, protected by the existing AIOStreams login.
router.post('/approve', requireSession, (req, res) => {
  pruneExpired();
  const grant = findByUserCode(req.body?.user_code);

  if (!grant || grant.expiresAt <= Date.now()) {
    res
      .status(404)
      .type('html')
      .send('<!doctype html><title>AIO TV</title><h1>Pairing code expired</h1><p>Return to the TV and request a new QR code.</p>');
    return;
  }

  if (!req.user) {
    throw new APIError(constants.ErrorCode.UNAUTHORIZED);
  }

  grant.status = 'approved';
  grant.username = req.user.username;

  res.status(200).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AIO TV connected</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#101114;color:#fff;min-height:100vh;margin:0;display:grid;place-items:center;text-align:center"><main><h1>TV connected</h1><p>You can close this page and return to AIO TV.</p></main></body></html>`);
});

// POST /auth/device/token
// Polled by the TV. The device code is single-use; once the token is returned,
// the pairing grant is consumed and cannot mint another session.
router.post('/token', (req, res) => {
  pruneExpired();
  const deviceCode = req.body?.deviceCode;

  if (typeof deviceCode !== 'string') {
    throw new APIError(
      constants.ErrorCode.MISSING_REQUIRED_FIELDS,
      undefined,
      'deviceCode is required'
    );
  }

  const grant = grants.get(deviceCode);
  if (!grant || grant.expiresAt <= Date.now()) {
    res.status(410).json(
      createResponse({
        success: false,
        detail: 'Device code expired',
        data: { status: 'expired' },
      })
    );
    return;
  }

  if (grant.status === 'pending') {
    res.status(202).json(
      createResponse({
        success: true,
        data: { status: 'pending', interval: POLL_INTERVAL_SECONDS },
      })
    );
    return;
  }

  if (grant.status !== 'approved' || !grant.username) {
    res.status(410).json(
      createResponse({
        success: false,
        detail: 'Device code already consumed',
        data: { status: 'consumed' },
      })
    );
    return;
  }

  const username = grant.username;
  const permissions = [...getEffectivePermissions(username)];
  const accessToken = issueSession(username, { permissions });
  grant.status = 'consumed';

  res.status(200).json(
    createResponse({
      success: true,
      data: {
        status: 'approved',
        accessToken,
        tokenType: 'Bearer',
        expiresIn: appConfig.api.sessionTtlSeconds,
        username,
        permissions,
      },
    })
  );
});

export default router;
