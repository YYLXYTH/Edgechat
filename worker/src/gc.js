const DEFAULT_MESSAGE_RETENTION_DAYS = 7;
const DEFAULT_SOFT_DELETE_RETENTION_DAYS = 60;
const DEFAULT_BATCH_SIZE = 500;
const DEFAULT_MAX_BATCHES_PER_RUN = 20;
const MAX_ERROR_LENGTH = 500;

function toPositiveInteger(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.floor(parsed);
}

function getGcConfig(env) {
  return {
    messageRetentionDays: toPositiveInteger(
      env.MESSAGE_RETENTION_DAYS,
      DEFAULT_MESSAGE_RETENTION_DAYS
    ),
    softDeleteRetentionDays: toPositiveInteger(
      env.SOFT_DELETE_RETENTION_DAYS,
      DEFAULT_SOFT_DELETE_RETENTION_DAYS
    ),
    batchSize: toPositiveInteger(env.GC_BATCH_SIZE, DEFAULT_BATCH_SIZE),
    maxBatchesPerRun: toPositiveInteger(
      env.GC_MAX_BATCHES_PER_RUN,
      DEFAULT_MAX_BATCHES_PER_RUN
    )
  };
}

function safeErrorMessage(error) {
  return String(error?.message || error || 'unknown_error').slice(0, MAX_ERROR_LENGTH);
}

function placeholders(length) {
  return Array.from({ length }, () => '?').join(', ');
}

function uniqueKeys(keys) {
  return [...new Set(
    keys
      .map((value) => String(value || '').trim())
      .filter(Boolean)
  )];
}

function createSummary() {
  return {
    expiredMessagesDeleted: 0,
    invitesDeleted: 0,
    channelsDeleted: 0,
    channelMembersDeleted: 0,
    channelMessagesDeleted: 0,
    usersDeleted: 0,
    userMessagesDeleted: 0,
    userMembershipsDeleted: 0
  };
}

async function ensureGcSchema(db) {
  // R2-related schema removed along with R2 storage
}

async function processR2CandidateKeys(env, db, keys, summary) {
  // R2 operations removed - files are no longer stored
  const unique = uniqueKeys(keys);
  for (const key of unique) {
    // Skip all R2 operations
    summary.r2SkippedReferenced = (summary.r2SkippedReferenced || 0) + 1;
  }
}

async function runExpiredMessagesStep(env, config, summary) {
  let batches = 0;

  while (batches < config.maxBatchesPerRun) {
    const { results } = await env.DB.prepare(
      `SELECT id, attachment_key
       FROM messages
       WHERE created_at < datetime('now', ?)
       ORDER BY id ASC
       LIMIT ?`
    )
      .bind(`-${config.messageRetentionDays} day`, config.batchSize)
      .all();

    if (!results.length) {
      break;
    }

    batches += 1;
    const ids = results.map((row) => Number(row.id));
    const keys = results.map((row) => row.attachment_key);
    summary.expiredMessagesDeleted += await deleteRowsByIds(
      env.DB,
      'messages',
      'id',
      ids
    );

    await processR2CandidateKeys(env, env.DB, keys, summary);

    if (results.length < config.batchSize) {
      break;
    }
  }
}

async function runHardDeleteInvitesStep(env, config, summary) {
  let batches = 0;

  while (batches < config.maxBatchesPerRun) {
    const { results } = await env.DB.prepare(
      `SELECT id
       FROM registration_invites
       WHERE deleted_at IS NOT NULL
         AND deleted_at < datetime('now', ?)
       ORDER BY id ASC
       LIMIT ?`
    )
      .bind(`-${config.softDeleteRetentionDays} day`, config.batchSize)
      .all();

    if (!results.length) {
      break;
    }

    batches += 1;
    const ids = results.map((row) => Number(row.id));
    summary.invitesDeleted += await deleteRowsByIds(
      env.DB,
      'registration_invites',
      'id',
      ids
    );

    if (results.length < config.batchSize) {
      break;
    }
  }
}

async function runHardDeleteChannelsStep(env, config, summary) {
  let batches = 0;

  while (batches < config.maxBatchesPerRun) {
    const { results } = await env.DB.prepare(
      `SELECT id, avatar_key
       FROM channels
       WHERE deleted_at IS NOT NULL
         AND deleted_at < datetime('now', ?)
       ORDER BY id ASC
       LIMIT ?`
    )
      .bind(`-${config.softDeleteRetentionDays} day`, config.batchSize)
      .all();

    if (!results.length) {
      break;
    }

    batches += 1;
    const channelIds = results.map((row) => Number(row.id));
    const avatarKeys = results.map((row) => row.avatar_key);
    const attachmentKeys = await collectMessageAttachmentsByColumn(
      env.DB,
      'channel_id',
      channelIds
    );

    summary.channelMessagesDeleted += await deleteRowsByIds(
      env.DB,
      'messages',
      'channel_id',
      channelIds
    );
    summary.channelMembersDeleted += await deleteRowsByIds(
      env.DB,
      'channel_members',
      'channel_id',
      channelIds
    );
    summary.channelsDeleted += await deleteRowsByIds(
      env.DB,
      'channels',
      'id',
      channelIds
    );

    await processR2CandidateKeys(
      env,
      env.DB,
      [...attachmentKeys, ...avatarKeys],
      summary
    );

    if (results.length < config.batchSize) {
      break;
    }
  }
}

async function clearUserReferences(env, userIds) {
  const binds = [...userIds];
  await env.DB.batch([
    env.DB.prepare(
      `UPDATE channels
       SET created_by = NULL
       WHERE created_by IN (${placeholders(userIds.length)})`
    ).bind(...binds),
    env.DB.prepare(
      `UPDATE registration_invites
       SET created_by = NULL
       WHERE created_by IN (${placeholders(userIds.length)})`
    ).bind(...binds),
    env.DB.prepare(
      `UPDATE registration_invites
       SET consumed_by_user_id = NULL
       WHERE consumed_by_user_id IN (${placeholders(userIds.length)})`
    ).bind(...binds),
    env.DB.prepare(
      `UPDATE channel_members
       SET invited_by = NULL
       WHERE invited_by IN (${placeholders(userIds.length)})`
    ).bind(...binds)
  ]);
}

async function runHardDeleteUsersStep(env, config, summary) {
  let batches = 0;

  while (batches < config.maxBatchesPerRun) {
    const { results } = await env.DB.prepare(
      `SELECT id, avatar_key
       FROM users
       WHERE deleted_at IS NOT NULL
         AND deleted_at < datetime('now', ?)
       ORDER BY id ASC
       LIMIT ?`
    )
      .bind(`-${config.softDeleteRetentionDays} day`, config.batchSize)
      .all();

    if (!results.length) {
      break;
    }

    batches += 1;
    const userIds = results.map((row) => Number(row.id));
    const avatarKeys = results.map((row) => row.avatar_key);
    const attachmentKeys = await collectMessageAttachmentsByColumn(
      env.DB,
      'sender_id',
      userIds
    );

    await clearUserReferences(env, userIds);
    summary.userMessagesDeleted += await deleteRowsByIds(
      env.DB,
      'messages',
      'sender_id',
      userIds
    );
    summary.userMembershipsDeleted += await deleteRowsByIds(
      env.DB,
      'channel_members',
      'user_id',
      userIds
    );
    summary.usersDeleted += await deleteRowsByIds(
      env.DB,
      'users',
      'id',
      userIds
    );

    await processR2CandidateKeys(
      env,
      env.DB,
      [...attachmentKeys, ...avatarKeys],
      summary
    );

    if (results.length < config.batchSize) {
      break;
    }
  }
}

export async function runScheduledGc(env) {
  const config = getGcConfig(env);
  const summary = createSummary();
  await ensureGcSchema(env.DB);

  // R2 retry queue step removed along with R2 storage
  await runExpiredMessagesStep(env, config, summary);
  await runHardDeleteInvitesStep(env, config, summary);
  await runHardDeleteChannelsStep(env, config, summary);
  await runHardDeleteUsersStep(env, config, summary);

  console.log(JSON.stringify({
    type: 'scheduled_gc_summary',
    config,
    summary
  }));

  return summary;
}
