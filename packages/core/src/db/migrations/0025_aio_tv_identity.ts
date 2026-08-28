import type { Migration } from './types.js';

/**
 * Bind one authenticated Pocket ID/OIDC username directly to one AIOtv policy.
 *
 * The binding is administrator-owned and intentionally does not depend on
 * Config Profiles: an end user never needs to open AIOStreams or know the
 * configuration UUID/password before pairing a TV.
 */
export const aioTvIdentity: Migration = {
  id: 25,
  name: 'aio_tv_identity',
  up: {
    sqlite: `
      ALTER TABLE aio_tv_user_policies
        ADD COLUMN identity_username TEXT
        CHECK (
          identity_username IS NULL OR
          (length(identity_username) BETWEEN 1 AND 255 AND trim(identity_username) = identity_username)
        );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_aio_tv_identity_username
        ON aio_tv_user_policies (identity_username)
        WHERE identity_username IS NOT NULL;
    `,
    postgres: `
      ALTER TABLE aio_tv_user_policies
        ADD COLUMN identity_username TEXT
        CHECK (
          identity_username IS NULL OR
          (length(identity_username) BETWEEN 1 AND 255 AND trim(identity_username) = identity_username)
        );

      CREATE UNIQUE INDEX IF NOT EXISTS idx_aio_tv_identity_username
        ON aio_tv_user_policies (identity_username)
        WHERE identity_username IS NOT NULL;
    `,
  },
};
