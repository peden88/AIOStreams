import crypto from 'node:crypto';
import { Request, Router } from 'express';
import {
  AIO_TV_DEVICE_SESSION_TTL_SECONDS,
  APIError,
  AioTvPolicyRepository,
  constants,
  config as appConfig,
  issueAioTvDeviceSession,
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
  configUuid?: string;
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

function htmlEscape(value: string): string {
  return value.replace(/[&<>"']/g, (char) =>
    ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    })[char] ?? char
  );
}

async function assignedAccount(username: string) {
  const binding = await AioTvPolicyRepository.getByIdentity(username);
  return binding?.policy.enabled ? binding : null;
}

// POST /auth/device/start
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
// Pocket ID/OIDC authenticates the browser. The administrator-owned binding
// then resolves that identity directly to one AIOStreams UUID.
router.get('/verify', requireSession, async (req, res) => {
  pruneExpired();
  const grant = findByUserCode(req.query.user_code);

  if (!grant || grant.expiresAt <= Date.now()) {
    res
      .status(404)
      .type('html')
      .send('<!doctype html><title>AIOtv</title><h1>Pairing code expired</h1><p>Return to the TV and request a new QR code.</p>');
    return;
  }

  if (grant.status !== 'pending') {
    res
      .status(200)
      .type('html')
      .send('<!doctype html><title>AIOtv</title><h1>Device already approved</h1><p>You can return to the TV.</p>');
    return;
  }

  if (!req.user) {
    throw new APIError(constants.ErrorCode.UNAUTHORIZED);
  }

  const account = await assignedAccount(req.user.username);
  if (!account) {
    res.status(403).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AIOtv unavailable</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#070707;color:#fff;min-height:100vh;margin:0;display:grid;place-items:center;text-align:center"><main style="max-width:32rem;padding:2rem"><h1>No AIOtv account assigned</h1><p style="color:#b3b3b3;line-height:1.5">This Pocket ID account has not been assigned an enabled AIOtv profile by the administrator.</p></main></body></html>`);
    return;
  }

  const code = htmlEscape(grant.userCode);
  res.status(200).type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Approve AIOtv</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#070707;color:#fff;min-height:100vh;margin:0;display:grid;place-items:center}
main{width:min(32rem,calc(100% - 2rem));padding:2rem;text-align:center}
code{display:block;font-size:2rem;font-weight:700;letter-spacing:.12em;margin:1.5rem 0;color:#d4d0ff}
button{font:inherit;color:#fff;background:#6152df;font-weight:700;padding:.9rem 1.4rem;border:0;border-radius:.7rem;cursor:pointer;width:100%;margin-top:1rem}
p{color:#b3b3b3;line-height:1.5}.assigned{padding:1rem;border:1px solid #3f2eb2;border-radius:.7rem;background:#101010;margin:1rem 0;color:#d4d0ff}
</style>
</head>
<body><main>
<h1>Connect AIOtv?</h1>
<p>Only approve this request if the code below matches the code shown on your TV.</p>
<code>${code}</code>
<div class="assigned">Your administrator-assigned AIOtv profile will be used automatically.</div>
<form method="post" action="/api/v${constants.API_VERSION}/auth/device/approve">
<input type="hidden" name="user_code" value="${code}">
<button type="submit">Approve TV</button>
</form>
</main></body></html>`);
});

// POST /auth/device/approve
router.post('/approve', requireSession, async (req, res) => {
  pruneExpired();
  const grant = findByUserCode(req.body?.user_code);

  if (!grant || grant.expiresAt <= Date.now()) {
    res
      .status(404)
      .type('html')
      .send('<!doctype html><title>AIOtv</title><h1>Pairing code expired</h1><p>Return to the TV and request a new QR code.</p>');
    return;
  }

  if (grant.status !== 'pending') {
    res
      .status(409)
      .type('html')
      .send('<!doctype html><title>AIOtv</title><h1>Pairing request already used</h1><p>Return to the TV if you need to start another pairing request.</p>');
    return;
  }

  if (!req.user) {
    throw new APIError(constants.ErrorCode.UNAUTHORIZED);
  }

  // Re-resolve the administrator assignment at approval time. This means an
  // identity rebind/disable performed while the QR page is open takes effect
  // immediately and no UUID is ever trusted from browser form data.
  const account = await assignedAccount(req.user.username);
  if (!account) {
    res.status(403).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AIOtv not authorised</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#070707;color:#fff;min-height:100vh;margin:0;display:grid;place-items:center;text-align:center"><main style="max-width:32rem;padding:2rem"><h1>AIOtv account unavailable</h1><p style="color:#b3b3b3;line-height:1.5">Your administrator assignment changed or AIOtv was disabled. Return to the TV and start pairing again after the assignment is corrected.</p></main></body></html>`);
    return;
  }

  grant.status = 'approved';
  grant.username = req.user.username;
  grant.configUuid = account.uuid;

  res.status(200).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AIOtv connected</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#070707;color:#fff;min-height:100vh;margin:0;display:grid;place-items:center;text-align:center"><main><h1>TV connected</h1><p style="color:#b3b3b3">You can close this page and return to AIOtv.</p></main></body></html>`);
});

// POST /auth/device/token
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

  if (
    grant.status !== 'approved' ||
    !grant.username ||
    !grant.configUuid
  ) {
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
  const configUuid = grant.configUuid;
  const accessToken = issueAioTvDeviceSession(username, configUuid);
  grant.status = 'consumed';

  res.status(200).json(
    createResponse({
      success: true,
      data: {
        status: 'approved',
        accessToken,
        tokenType: 'Bearer',
        expiresIn: AIO_TV_DEVICE_SESSION_TTL_SECONDS,
        configUuid,
      },
    })
  );
});

export default router;
