import { Router, Request, Response } from 'express';
import path from 'path';
const router: Router = Router();
import { staticRateLimiter } from '../../middlewares/ratelimit.js';
import { attachSession } from '../../middlewares/auth.js';
import { denyManagedAioTvIdentity } from '../../middlewares/aio-tv-access.js';
import { frontendRoot } from '../../app.js';

export default router;

router.use(attachSession);
router.use(denyManagedAioTvIdentity);

router.get('/', staticRateLimiter, (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(frontendRoot, 'index.html'));
});
