import type { NextFunction, Request, Response } from 'express';
import {
  AioTvPolicyRepository,
  APIError,
  constants,
} from '@aiostreams/core';

/**
 * A Pocket ID/OIDC identity that the administrator has bound to an AIOtv
 * profile is a managed end-user identity, not a configuration owner.
 *
 * Admins are deliberately exempt so the instance owner can bind a test profile
 * to their own identity without locking themselves out of management screens.
 */
export async function denyManagedAioTvIdentity(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user || req.user.isAdmin) {
    next();
    return;
  }

  try {
    const binding = await AioTvPolicyRepository.getByIdentity(req.user.username);
    if (!binding) {
      next();
      return;
    }

    next(
      new APIError(
        constants.ErrorCode.FORBIDDEN,
        undefined,
        'This account is managed by the AIOtv administrator and cannot access AIOStreams configuration pages.'
      )
    );
  } catch (error) {
    next(error);
  }
}
