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
 * The binding itself is authoritative. We do not exempt a session merely
 * because its OIDC permission set happens to contain admin; a managed identity
 * must never regain configuration access through an overly broad group mapping.
 */
export async function denyManagedAioTvIdentity(
  req: Request,
  _res: Response,
  next: NextFunction
): Promise<void> {
  if (!req.user) {
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
