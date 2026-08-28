import crypto from 'node:crypto';
import { Request, Router } from 'express';
import {
  APIError,
  AioTvPolicyRepository,
  ConfigProfileRepository,
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

type EligibleProfile = {
  uuid: string;
  label: string;
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

async function eligibleProfiles(username: string): Promise<EligibleProfile[]> {
  const profiles = await ConfigProfileRepository.list(username);
  const checked = await Promise.all(
    profiles.map(async (profile) => ({
      profile,
      policy: await AioTvPolicyRepository.get(profile.uuid),
    }))
  );
  return checked
    .filter(({ policy }) => policy.enabled)
    .map(({ profile }) => ({ uuid: profile.uuid, label: profile.label }));
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

  const profiles = await eligibleProfiles(req.user.username);
  if (profiles.length === 0) {
    res.status(403).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AIOtv unavailable</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#101114;color:#fff;min-height:100vh;margin:0;display:grid;place-items:center;text-align:center"><main style="max-width:32rem;padding:2rem"><h1>No AIOtv account available</h1><p style="color:#c8cbd0;line-height:1.5">This signed-in account does not currently have a saved AIOStreams configuration with AIOtv enabled. Save the configuration to your account first, then have an administrator enable AIOtv for that UUID.</p></main></body></html>`);
    return;
  }

  const code = htmlEscape(grant.userCode);
  const profileInputs = profiles
    .map((profile, index) => {
      const label = htmlEscape(profile.label);
      const uuid = htmlEscape(profile.uuid);
      const shortUuid = `${uuid.slice(0, 8)}…${uuid.slice(-4)}`;
      if (profiles.length === 1) {
        return `<input type="hidden" name="config_uuid" value="${uuid}"><div class="profile selected"><strong>${label}</strong><span>${shortUuid}</span></div>`;
      }
      return `<label class="profile"><input type="radio" name="config_uuid" value="${uuid}" ${index === 0 ? 'checked' : ''}><span><strong>${label}</strong><small>${shortUuid}</small></span></label>`;
    })
    .join('');

  res.status(200).type('html').send(`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Approve AIOtv</title>
<style>
body{font-family:system-ui,-apple-system,sans-serif;background:#101114;color:#fff;min-height:100vh;margin:0;display:grid;place-items:center}
main{width:min(32rem,calc(100% - 2rem));padding:2rem;text-align:center}
code{display:block;font-size:2rem;font-weight:700;letter-spacing:.12em;margin:1.5rem 0}
button{font:inherit;color:#fff;background:#5965f2;font-weight:700;padding:.9rem 1.4rem;border:0;border-radius:.7rem;cursor:pointer;width:100%;margin-top:1rem}
p{color:#c8cbd0;line-height:1.5}
.profiles{display:grid;gap:.65rem;text-align:left;margin-top:1rem}.profile{display:flex;align-items:center;gap:.8rem;padding:.9rem;border:1px solid #34363d;border-radius:.7rem;background:#17191e}.profile span{display:flex;flex-direction:column;gap:.2rem}.profile small,.profile>span{color:#aeb2bb}.profile.selected{justify-content:center;text-align:center}.profile.selected span{font-size:.8rem}
</style>
</head>
<body><main>
<h1>Connect AIOtv?</h1>
<p>Only approve this request if the code below matches the code shown on your TV.</p>
<code>${code}</code>
<p>${profiles.length === 1 ? 'This TV will be linked to:' : 'Choose which AIOStreams configuration this TV should use:'}</p>
<form method="post" action="/api/v${constants.API_VERSION}/auth/device/approve">
<input type="hidden" name="user_code" value="${code}">
<div class="profiles">${profileInputs}</div>
<button type="submit">Approve TV</button>
</form>
</main></body></html>`);
});

// POST /auth/device/approve
// Browser-only confirmation step, protected by the existing AIOStreams login.
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

  // Re-resolve ownership and AIOtv enablement at approval time. Never trust the
  // UUID posted by the browser, even though it came from our confirmation page.
  const profiles = await eligibleProfiles(req.user.username);
  const requestedUuid =
    typeof req.body?.config_uuid === 'string' ? req.body.config_uuid : undefined;
  const selected = requestedUuid
    ? profiles.find((profile) => profile.uuid === requestedUuid)
    : profiles.length === 1
      ? profiles[0]
      : undefined;

  if (!selected) {
    res.status(403).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AIOtv not authorised</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#101114;color:#fff;min-height:100vh;margin:0;display:grid;place-items:center;text-align:center"><main style="max-width:32rem;padding:2rem"><h1>Configuration not authorised</h1><p style="color:#c8cbd0;line-height:1.5">That configuration is not linked to this signed-in account with AIOtv enabled. Return to the TV and start pairing again if the account assignment changed.</p></main></body></html>`);
    return;
  }

  grant.status = 'approved';
  grant.username = req.user.username;
  grant.configUuid = selected.uuid;

  res.status(200).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>AIOtv connected</title></head>
<body style="font-family:system-ui,-apple-system,sans-serif;background:#101114;color:#fff;min-height:100vh;margin:0;display:grid;place-items:center;text-align:center"><main><h1>TV connected</h1><p>You can close this page and return to AIOtv.</p></main></body></html>`);
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
        expiresIn: appConfig.api.sessionTtlSeconds,
        configUuid,
      },
    })
  );
});

export default router;
