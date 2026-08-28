import { Request, Router } from 'express';
import {
  AioTvPolicyRepository,
  verifyAioTvDeviceSession,
} from '@aiostreams/core';
import { createResponse } from '../../utils/responses.js';

const router: Router = Router();

function readBearer(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (!header) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match?.[1]?.trim() || undefined;
}

/**
 * GET /aio-tv/bootstrap
 *
 * The only endpoint an AIOtv device token needs initially. The token is scoped
 * to one UUID and is intentionally not a normal AIOStreams session, so it
 * cannot authenticate against dashboard/config APIs.
 */
router.get('/bootstrap', async (req, res) => {
  const device = verifyAioTvDeviceSession(readBearer(req));
  if (!device) {
    res.status(401).json(
      createResponse({
        success: false,
        error: {
          code: 'AIO_TV_UNAUTHORIZED',
          message: 'A valid AIOtv device bearer token is required',
        },
      })
    );
    return;
  }

  const policy = await AioTvPolicyRepository.get(device.uuid);

  // A missing policy and a disabled policy intentionally look the same to the
  // device. This also handles a deleted parent user because the policy FK
  // cascades away with it.
  if (!policy.enabled) {
    res.status(403).json(
      createResponse({
        success: false,
        error: {
          code: 'AIO_TV_DISABLED',
          message: 'AIOtv is no longer enabled for this account',
        },
      })
    );
    return;
  }

  const etag = `"aio-tv-${device.uuid}-r${policy.revision}"`;
  res.setHeader('Cache-Control', 'private, no-cache');
  res.setHeader('ETag', etag);
  if (req.headers['if-none-match'] === etag) {
    res.status(304).end();
    return;
  }

  res.status(200).json(
    createResponse({
      success: true,
      data: {
        account: {
          uuid: device.uuid,
        },
        policy: {
          revision: policy.revision,
          updatedAt: policy.updatedAt,
          addons: policy.addons,
        },
        management: {
          addonMembership: 'server-authoritative',
          catalogOrder: 'device-local',
        },
      },
    })
  );
});

export default router;
