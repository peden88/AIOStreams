import pLimit from 'p-limit';
import type { ParsedStream } from '../../db/schemas.js';
import {
  appConfig,
  constants,
  createLogger,
  getSimpleTextHash,
} from '../../utils/index.js';
import { downloadManager } from '../../utils/download-manager.js';
import { parseNzb } from '../index.js';
import { getUsenetEngineConfig, usenetEngineRegistry } from './engine.js';

const logger = createLogger('usenet/result-health-check');
type Verdict = 'healthy' | 'dead';
const verdicts = new Map<string, { verdict: Verdict; expiresAt: number }>();
const MAX_CACHE_ENTRIES = 10_000;

function cached(key: string): Verdict | undefined {
  const item = verdicts.get(key);
  if (!item) return undefined;
  if (item.expiresAt <= Date.now()) {
    verdicts.delete(key);
    return undefined;
  }
  return item.verdict;
}

function remember(key: string, verdict: Verdict): void {
  const u = appConfig.usenet;
  const ttlSeconds =
    verdict === 'healthy'
      ? u.resultHealthCheckHealthyTtl
      : u.resultHealthCheckFailedTtl;
  if (verdicts.size >= MAX_CACHE_ENTRIES) {
    const oldest = verdicts.keys().next().value as string | undefined;
    if (oldest) verdicts.delete(oldest);
  }
  verdicts.set(key, { verdict, expiresAt: Date.now() + ttlSeconds * 1000 });
}

async function check(stream: ParsedStream): Promise<Verdict | 'unknown'> {
  const nzbUrl = stream.nzbUrl;
  if (!nzbUrl) return 'unknown';
  const key = getSimpleTextHash(nzbUrl);
  const hit = cached(key);
  if (hit) return hit;

  const u = appConfig.usenet;
  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    u.resultHealthCheckTimeout * 1000
  );
  timer.unref?.();
  try {
    const raw = await downloadManager.fetchNzb(nzbUrl, {
      signal: controller.signal,
      timeoutMs: u.resultHealthCheckTimeout * 1000,
    });
    const nzb = await parseNzb(raw);
    const { providers, options } = getUsenetEngineConfig();
    if (providers.length === 0) return 'unknown';
    const engine = usenetEngineRegistry.get(providers, options);
    const healthy = await engine.sampleAvailability(
      nzb,
      u.resultHealthCheckSamples,
      controller.signal
    );
    const verdict: Verdict = healthy ? 'healthy' : 'dead';
    remember(key, verdict);
    return verdict;
  } catch (error) {
    logger.debug(
      {
        streamId: stream.id,
        error: error instanceof Error ? error.message : String(error),
      },
      'result health check inconclusive; keeping stream'
    );
    return 'unknown';
  } finally {
    clearTimeout(timer);
  }
}

/** Remove confirmed-dead native Usenet results within the configured top-N window. */
export async function filterDeadUsenetResults(
  streams: ParsedStream[]
): Promise<ParsedStream[]> {
  const u = appConfig.usenet;
  if (!u.resultHealthCheckEnabled || streams.length === 0) return streams;

  const candidates = streams
    .filter(
      (stream) =>
        stream.type === 'usenet' &&
        stream.service?.id === constants.AIOSTREAMS_SERVICE &&
        Boolean(stream.nzbUrl)
    )
    .slice(0, u.resultHealthCheckMaxResults);
  if (candidates.length === 0) return streams;

  const limit = pLimit(u.resultHealthCheckConcurrency);
  const checked = await Promise.all(
    candidates.map((stream) =>
      limit(async () => [stream.id, await check(stream)] as const)
    )
  );
  const dead = new Set(
    checked.filter(([, verdict]) => verdict === 'dead').map(([id]) => id)
  );
  logger.info(
    {
      checked: checked.length,
      healthy: checked.filter(([, v]) => v === 'healthy').length,
      dead: dead.size,
      unknown: checked.filter(([, v]) => v === 'unknown').length,
    },
    'pre-result usenet health checks complete'
  );
  return dead.size === 0
    ? streams
    : streams.filter((stream) => !dead.has(stream.id));
}
