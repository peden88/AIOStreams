import { Router, Request, Response } from 'express';
import path from 'path';
const router: Router = Router();
import { staticRateLimiter } from '../../middlewares/ratelimit.js';
import { attachSession, requireAdmin } from '../../middlewares/auth.js';
import { frontendRoot } from '../../app.js';

export default router;

// AIOtv is a centrally managed client. Only an administrator may open the
// AIOStreams configuration UI; end users authenticate solely for QR approval.
router.use(attachSession);
router.use(requireAdmin);

router.get('/', staticRateLimiter, (req: Request, res: Response) => {
  res.setHeader('Cache-Control', 'no-cache');
  res.sendFile(path.join(frontendRoot, 'index.html'));
});
