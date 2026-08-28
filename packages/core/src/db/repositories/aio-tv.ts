import { getDb } from '../db.js';
import { sql } from '../sql.js';

export interface AioTvAddonAssignment {
  name: string;
  manifestUrl: string;
}

export interface AioTvUserPolicy {
  enabled: boolean;
  identityUsername: string | null;
  addons: AioTvAddonAssignment[];
  revision: number;
  updatedAt: number;
  updatedBy: string | null;
}

export interface AioTvIdentityBinding {
  uuid: string;
  policy: AioTvUserPolicy;
}

interface AioTvPolicyRow {
  identity_username: string | null;
  enabled: number | string | boolean;
  addons: string;
  revision: number | string;
  updated_at: number | string;
  updated_by: string | null;
  [k: string]: unknown;
}

interface AioTvBoundPolicyRow extends AioTvPolicyRow {
  user_uuid: string;
}

const EMPTY_POLICY: AioTvUserPolicy = {
  enabled: false,
  identityUsername: null,
  addons: [],
  revision: 0,
  updatedAt: 0,
  updatedBy: null,
};

function parseAddons(raw: string): AioTvAddonAssignment[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (v): v is AioTvAddonAssignment =>
          !!v &&
          typeof v === 'object' &&
          typeof v.manifestUrl === 'string' &&
          typeof v.name === 'string'
      )
      .map((v) => ({ name: v.name, manifestUrl: v.manifestUrl }));
  } catch {
    return [];
  }
}

function toPolicy(row: AioTvPolicyRow | null): AioTvUserPolicy {
  if (!row) return { ...EMPTY_POLICY };
  const enabled =
    row.enabled === true || row.enabled === 1 || row.enabled === '1';
  return {
    enabled,
    identityUsername: row.identity_username ?? null,
    addons: parseAddons(row.addons),
    revision: Number(row.revision) || 0,
    updatedAt: Number(row.updated_at) || 0,
    updatedBy: row.updated_by ?? null,
  };
}

const POLICY_COLUMNS =
  'identity_username, enabled, addons, revision, updated_at, updated_by';

export class AioTvPolicyRepository {
  static async get(userUuid: string): Promise<AioTvUserPolicy> {
    const row = await getDb().maybeOne<AioTvPolicyRow>(
      sql`SELECT identity_username, enabled, addons, revision, updated_at, updated_by
          FROM aio_tv_user_policies
          WHERE user_uuid = ${userUuid}`
    );
    return toPolicy(row);
  }

  /** Resolve the administrator-owned Pocket ID/OIDC identity binding. */
  static async getByIdentity(
    identityUsername: string
  ): Promise<AioTvIdentityBinding | null> {
    const row = await getDb().maybeOne<AioTvBoundPolicyRow>(
      sql`SELECT user_uuid, identity_username, enabled, addons, revision, updated_at, updated_by
          FROM aio_tv_user_policies
          WHERE identity_username = ${identityUsername}`
    );
    if (!row) return null;
    return { uuid: row.user_uuid, policy: toPolicy(row) };
  }

  static async set(
    userUuid: string,
    input: {
      enabled: boolean;
      identityUsername: string | null;
      addons: AioTvAddonAssignment[];
    },
    updatedBy: string
  ): Promise<AioTvUserPolicy> {
    const db = getDb();
    const current = await db.maybeOne<{ revision: number | string; [k: string]: unknown }>(
      sql`SELECT revision FROM aio_tv_user_policies WHERE user_uuid = ${userUuid}`
    );
    const now = Date.now();
    const addons = JSON.stringify(input.addons);

    if (current) {
      await db.exec(
        sql`UPDATE aio_tv_user_policies
            SET identity_username = ${input.identityUsername},
                enabled = ${input.enabled ? 1 : 0},
                addons = ${addons},
                revision = ${Number(current.revision) + 1},
                updated_at = ${now},
                updated_by = ${updatedBy}
            WHERE user_uuid = ${userUuid}`
      );
    } else {
      await db.exec(
        sql`INSERT INTO aio_tv_user_policies
              (user_uuid, identity_username, enabled, addons, revision, updated_at, updated_by)
            VALUES
              (${userUuid}, ${input.identityUsername}, ${input.enabled ? 1 : 0}, ${addons}, 1, ${now}, ${updatedBy})`
      );
    }

    return this.get(userUuid);
  }
}
