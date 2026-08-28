/**
 * Admin (dashboard) read/delete access to user configs. Never exposes the
 * encrypted config blob or password hash. Per-user request stats are joined
 * from analytics via `uuid_hash` (HMAC) — no raw UUID/IP leaves the server.
 */
import { getDb } from '../db.js';
import { sql, raw, join } from '../sql.js';
import { hmac } from '../../analytics/index.js';
import {
  AioTvPolicyRepository,
  type AioTvUserPolicy,
} from './aio-tv.js';

export interface AdminUserListItem {
  uuid: string;
  createdAt: string;
  updatedAt: string;
  accessedAt: string;
  requests24h: number;
  aioTvEnabled: boolean;
  aioTvAddonCount: number;
}

export interface AdminUserDetail extends AdminUserListItem {
  recentErrorStages: Array<{ stage: string; count: number }>;
  aioTv: AioTvUserPolicy;
}

const toUtcString = (v: string | Date | null | undefined): string => {
  if (!v) return '';
  if (v instanceof Date) return v.toISOString();
  return v.replace(' ', 'T') + 'Z';
};

const SORTS: Record<string, string> = {
  created_at: 'users.created_at',
  accessed_at: 'users.accessed_at',
  updated_at: 'users.updated_at',
};

function addonCount(rawValue: string | null | undefined): number {
  if (!rawValue) return 0;
  try {
    const parsed = JSON.parse(rawValue);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

export const AdminUsersRepository = {
  async list(opts: {
    page: number;
    limit: number;
    q?: string;
    sort?: string;
    dir?: 'asc' | 'desc';
  }) {
    const db = getDb();
    const limit = Math.min(Math.max(opts.limit || 25, 1), 200);
    const page = Math.max(opts.page || 1, 1);
    const offset = (page - 1) * limit;
    const sortCol = SORTS[opts.sort ?? 'created_at'] ?? 'users.created_at';
    const dir = opts.dir === 'asc' ? 'ASC' : 'DESC';
    const where = opts.q
      ? sql`WHERE users.uuid LIKE ${'%' + opts.q + '%'}`
      : sql``;

    const total = await db.count(
      sql`SELECT COUNT(*) AS count FROM users ${where}`
    );
    const rows = await db.query<{
      uuid: string;
      created_at: string | Date;
      updated_at: string | Date;
      accessed_at: string | Date;
      aio_tv_enabled: number | string | boolean | null;
      aio_tv_addons: string | null;
    }>(
      sql`SELECT users.uuid, users.created_at, users.updated_at, users.accessed_at,
                 aio_tv_user_policies.enabled AS aio_tv_enabled,
                 aio_tv_user_policies.addons AS aio_tv_addons
          FROM users
          LEFT JOIN aio_tv_user_policies
            ON aio_tv_user_policies.user_uuid = users.uuid
          ${where}
          ORDER BY ${raw(sortCol)} ${raw(dir)}
          LIMIT ${limit} OFFSET ${offset}`
    );

    const cutoff = Date.now() - 86_400_000;
    const items: AdminUserListItem[] = [];
    for (const r of rows) {
      const c = await db.query<{ c: number | string }>(
        sql`SELECT COUNT(*) AS c FROM analytics_events
            WHERE uuid_hash = ${hmac(r.uuid)} AND ts >= ${cutoff}`
      );
      items.push({
        uuid: r.uuid,
        createdAt: toUtcString(r.created_at),
        updatedAt: toUtcString(r.updated_at),
        accessedAt: toUtcString(r.accessed_at),
        requests24h: Number(c[0]?.c ?? 0),
        aioTvEnabled:
          r.aio_tv_enabled === true ||
          r.aio_tv_enabled === 1 ||
          r.aio_tv_enabled === '1',
        aioTvAddonCount: addonCount(r.aio_tv_addons),
      });
    }
    return { items, total, page, limit, pages: Math.ceil(total / limit) };
  },

  async get(uuid: string): Promise<AdminUserDetail | null> {
    const db = getDb();
    const r = await db.maybeOne<{
      uuid: string;
      created_at: string;
      updated_at: string;
      accessed_at: string;
    }>(
      sql`SELECT uuid, created_at, updated_at, accessed_at FROM users WHERE uuid = ${uuid}`
    );
    if (!r) return null;
    const h = hmac(uuid);
    const cutoff = Date.now() - 86_400_000;
    const [c, errs, aioTv] = await Promise.all([
      db.query<{ c: number | string }>(
        sql`SELECT COUNT(*) AS c FROM analytics_events
            WHERE uuid_hash = ${h} AND ts >= ${cutoff}`
      ),
      db.query<{ error_stage: string; c: number | string }>(
        sql`SELECT error_stage, COUNT(*) AS c FROM analytics_events
            WHERE uuid_hash = ${h} AND status = 'error' AND error_stage IS NOT NULL
            GROUP BY error_stage ORDER BY c DESC LIMIT 10`
      ),
      AioTvPolicyRepository.get(uuid),
    ]);
    return {
      uuid: r.uuid,
      createdAt: toUtcString(r.created_at),
      updatedAt: toUtcString(r.updated_at),
      accessedAt: toUtcString(r.accessed_at),
      requests24h: Number(c[0]?.c ?? 0),
      aioTvEnabled: aioTv.enabled,
      aioTvAddonCount: aioTv.addons.length,
      recentErrorStages: errs.map((e) => ({
        stage: e.error_stage,
        count: Number(e.c),
      })),
      aioTv,
    };
  },

  async remove(uuid: string): Promise<boolean> {
    const db = getDb();
    const res = await db.exec(sql`DELETE FROM users WHERE uuid = ${uuid}`);
    return (res.rowCount ?? 0) > 0;
  },

  /**
   * Batch delete. Supply either an explicit `uuids` array, or `allMatching=true`
   * with the same `q` filter as `list()` to delete every row matching the
   * current admin search. Returns the number of deleted rows.
   */
  async bulkRemove(opts: {
    uuids?: string[];
    allMatching?: boolean;
    q?: string;
  }): Promise<number> {
    const db = getDb();
    if (opts.allMatching) {
      const where = opts.q ? sql`WHERE uuid LIKE ${'%' + opts.q + '%'}` : sql``;
      const res = await db.exec(sql`DELETE FROM users ${where}`);
      return res.rowCount ?? 0;
    }
    const uuids = (opts.uuids ?? []).filter(
      (u) => typeof u === 'string' && u.length > 0
    );
    if (uuids.length === 0) return 0;
    let n = 0;
    // Chunk to avoid hitting parameter limits on some SQL backends.
    const CHUNK = 200;
    for (let i = 0; i < uuids.length; i += CHUNK) {
      const slice = uuids.slice(i, i + CHUNK);
      const list = join(
        slice.map((u) => sql`${u}`),
        ', '
      );
      const res = await db.exec(sql`DELETE FROM users WHERE uuid IN (${list})`);
      n += res.rowCount ?? 0;
    }
    return n;
  },
};
