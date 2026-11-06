import { Router, Request, Response, NextFunction } from 'express';
import { fromUrlSafeBase64, XtreamAddon } from '@aiostreams/core';
import { z } from 'zod';
import { requireSessionIfAuthRequired } from '../../middlewares/auth.js';
import { userApiRateLimiter } from '../../middlewares/ratelimit.js';
import { rawExtras } from '../../utils/extras.js';

const router: Router = Router();

interface Params {
  encodedConfig: string;
  type: string;
  id: string;
}

const addonOf = (encodedConfig: string) =>
  new XtreamAddon(JSON.parse(fromUrlSafeBase64(encodedConfig)));

const PreviewRequest = z.object({
  server: z.string().min(1).max(2048),
  username: z.string().min(1).max(512),
  password: z.string().min(1).max(512),
  group: z.string().max(256).optional(),
  search: z.string().max(256).optional(),
  offset: z.number().int().nonnegative().optional(),
  limit: z.number().int().min(1).max(100).optional(),
});

/**
 * Browser-reachable preview for the Xtream configuration editor.
 * Credentials stay in the POST body, not in URL history, and are never
 * returned to the caller. Match the auth and rate-limit guards on /test.
 */
router.post(
  '/preview',
  requireSessionIfAuthRequired,
  userApiRateLimiter,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const options = PreviewRequest.parse(req.body ?? {});
      const { server, username, password, ...page } = options;
      const addon = new XtreamAddon({ server, username, password });
      res.json(await addon.getLineupPreview(page));
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/:encodedConfig/manifest.json',
  async (
    req: Request<Pick<Params, 'encodedConfig'>>,
    res: Response,
    next: NextFunction
  ) => {
    try {
      res.json(await addonOf(req.params.encodedConfig).getManifest());
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/:encodedConfig/catalog/:type/:id{/:extras}.json',
  async (
    req: Request<Params & { extras?: string }>,
    res: Response,
    next: NextFunction
  ) => {
    const { encodedConfig, type, id } = req.params;
    try {
      res.json(
        await addonOf(encodedConfig).getCatalog(type, id, rawExtras(req))
      );
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/:encodedConfig/meta/:type/:id.json',
  async (req: Request<Params>, res: Response, next: NextFunction) => {
    const { encodedConfig, type, id } = req.params;
    try {
      res.json({ meta: await addonOf(encodedConfig).getMeta(type, id) });
    } catch (error) {
      next(error);
    }
  }
);

router.get(
  '/:encodedConfig/stream/:type/:id.json',
  async (req: Request<Params>, res: Response, next: NextFunction) => {
    const { encodedConfig, type, id } = req.params;
    try {
      res.json({
        streams: await addonOf(encodedConfig).getStreams(type, id),
      });
    } catch (error) {
      next(error);
    }
  }
);

export default router;
