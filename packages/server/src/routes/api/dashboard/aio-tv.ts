import { Router } from 'express';
import {
  AdminUsersRepository,
  AioTvPolicyRepository,
  createLogger,
  type AioTvAddonAssignment,
} from '@aiostreams/core';
import { requireAdmin } from '../../../middlewares/auth.js';
import { createResponse } from '../../../utils/responses.js';

const router: Router = Router();
const logger = createLogger('dashboard-aio-tv');
const MAX_ASSIGNED_ADDONS = 50;

router.use(requireAdmin);

function parseAssignments(value: unknown):
  | { ok: true; addons: AioTvAddonAssignment[] }
  | { ok: false; message: string } {
  if (!Array.isArray(value)) {
    return { ok: false, message: 'addons must be an array' };
  }
  if (value.length > MAX_ASSIGNED_ADDONS) {
    return {
      ok: false,
      message: `A maximum of ${MAX_ASSIGNED_ADDONS} addons may be assigned to one AIOtv account`,
    };
  }

  const addons: AioTvAddonAssignment[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < value.length; i++) {
    const raw = value[i];
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
      return { ok: false, message: `addons[${i}] must be an object` };
    }
    const item = raw as Record<string, unknown>;
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    const manifestUrl =
      typeof item.manifestUrl === 'string' ? item.manifestUrl.trim() : '';

    if (!manifestUrl) {
      return { ok: false, message: `addons[${i}].manifestUrl is required` };
    }
    if (name.length > 120) {
      return { ok: false, message: `addons[${i}].name is too long` };
    }
    if (manifestUrl.length > 4096) {
      return { ok: false, message: `addons[${i}].manifestUrl is too long` };
    }

    let parsed: URL;
    try {
      parsed = new URL(manifestUrl);
    } catch {
      return { ok: false, message: `addons[${i}].manifestUrl is not a valid URL` };
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return {
        ok: false,
        message: `addons[${i}].manifestUrl must use http or https`,
      };
    }

    if (seen.has(manifestUrl)) continue;
    seen.add(manifestUrl);
    addons.push({ name, manifestUrl });
  }

  return { ok: true, addons };
}

function parseIdentityUsername(value: unknown):
  | { ok: true; identityUsername: string | null }
  | { ok: false; message: string } {
  if (value === null || value === undefined || value === '') {
    return { ok: true, identityUsername: null };
  }
  if (typeof value !== 'string') {
    return { ok: false, message: 'identityUsername must be a string or null' };
  }
  const identityUsername = value.trim();
  if (!identityUsername) {
    return { ok: true, identityUsername: null };
  }
  if (identityUsername.length > 255) {
    return { ok: false, message: 'identityUsername is too long' };
  }
  return { ok: true, identityUsername };
}

// GET /dashboard/users/:uuid/aio-tv
router.get('/users/:uuid/aio-tv', async (req, res) => {
  const user = await AdminUsersRepository.get(req.params.uuid);
  if (!user) {
    return res.status(404).json(
      createResponse({
        success: false,
        error: { code: 'NOT_FOUND', message: 'User not found' },
      })
    );
  }

  res.status(200).json(
    createResponse({ success: true, data: await AioTvPolicyRepository.get(req.params.uuid) })
  );
});

// PUT /dashboard/users/:uuid/aio-tv
router.put('/users/:uuid/aio-tv', async (req, res) => {
  const user = await AdminUsersRepository.get(req.params.uuid);
  if (!user) {
    return res.status(404).json(
      createResponse({
        success: false,
        error: { code: 'NOT_FOUND', message: 'User not found' },
      })
    );
  }

  const body = (req.body ?? {}) as Record<string, unknown>;
  if (typeof body.enabled !== 'boolean') {
    return res.status(400).json(
      createResponse({
        success: false,
        error: { code: 'BAD_REQUEST', message: 'enabled must be a boolean' },
      })
    );
  }

  const identity = parseIdentityUsername(body.identityUsername);
  if (!identity.ok) {
    return res.status(400).json(
      createResponse({
        success: false,
        error: { code: 'BAD_REQUEST', message: identity.message },
      })
    );
  }

  if (identity.identityUsername) {
    const existing = await AioTvPolicyRepository.getByIdentity(
      identity.identityUsername
    );
    if (existing && existing.uuid !== req.params.uuid) {
      return res.status(409).json(
        createResponse({
          success: false,
          error: {
            code: 'IDENTITY_ALREADY_ASSIGNED',
            message: `Pocket ID identity "${identity.identityUsername}" is already assigned to another AIOStreams profile`,
          },
        })
      );
    }
  }

  const parsed = parseAssignments(body.addons);
  if (!parsed.ok) {
    return res.status(400).json(
      createResponse({
        success: false,
        error: { code: 'BAD_REQUEST', message: parsed.message },
      })
    );
  }

  const username =
    (req as { user?: { username?: string } }).user?.username ?? 'admin';
  const policy = await AioTvPolicyRepository.set(
    req.params.uuid,
    {
      enabled: body.enabled,
      identityUsername: identity.identityUsername,
      addons: parsed.addons,
    },
    username
  );

  logger.info(
    {
      uuid: req.params.uuid,
      enabled: policy.enabled,
      identityAssigned: !!policy.identityUsername,
      addonCount: policy.addons.length,
      revision: policy.revision,
      username,
    },
    'AIOtv user policy updated'
  );

  res.status(200).json(createResponse({ success: true, data: policy }));
});

export default router;
