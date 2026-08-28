import type { Migration } from './types.js';

/**
 * Administrator-owned AIOtv policy. This intentionally lives outside the
 * encrypted user configuration blob: AIOtv policy is server-side account
 * administration state and must be readable by the device bootstrap service
 * without decrypting or mutating the user's AIOStreams configuration.
 */
export const aioTvPolicies: Migration = {
  id: 24,
  name: 'aio_tv_policies',
  up: {
    sqlite: `
      CREATE TABLE IF NOT EXISTS aio_tv_user_policies (
        user_uuid TEXT PRIMARY KEY,
        enabled INTEGER NOT NULL DEFAULT 0,
        addons TEXT NOT NULL DEFAULT '[]',
        revision BIGINT NOT NULL DEFAULT 1,
        updated_at BIGINT NOT NULL DEFAULT 0,
        updated_by TEXT,
        FOREIGN KEY (user_uuid) REFERENCES users(uuid) ON DELETE CASCADE
      );
    `,
    postgres: `
      CREATE TABLE IF NOT EXISTS aio_tv_user_policies (
        user_uuid TEXT PRIMARY KEY REFERENCES users(uuid) ON DELETE CASCADE,
        enabled BOOLEAN NOT NULL DEFAULT FALSE,
        addons TEXT NOT NULL DEFAULT '[]',
        revision BIGINT NOT NULL DEFAULT 1,
        updated_at BIGINT NOT NULL DEFAULT 0,
        updated_by TEXT
      );
    `,
  },
};
