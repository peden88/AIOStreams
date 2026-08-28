import { Router } from 'express';
import { attachSession } from '../../middlewares/auth.js';
import { denyManagedAioTvIdentity } from '../../middlewares/aio-tv-access.js';
import profilesApi from './profiles.js';

const router: Router = Router();

router.use(attachSession);
router.use(denyManagedAioTvIdentity);
router.use(profilesApi);

export default router;
