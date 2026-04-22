const { generateId } = require('../utils/uuid');
const { createGroupChatForRequest } = require('../utils/chatHelpers');
const { initializeParticipantCompletion } = require('../utils/participantCompletions');
const { sendRequestCreatedNotification } = require('./pushNotification');
const { formatDateTimeForMySql } = require('../utils/requestPayloadParsers');

/**
 * Создание заявки category=event с from_external_source=1 (логика как POST /api/requests для JSON).
 * @param {import('mysql2/promise').Pool} pool
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.name
 * @param {string|null} [opts.description]
 * @param {string|null} [opts.start_date] ISO UTC
 * @param {number|string|null} [opts.latitude]
 * @param {number|string|null} [opts.longitude]
 * @param {string|null} [opts.city]
 * @param {string[]} opts.photosBeforeUrls — URL из нашей галереи или абсолютные ссылки
 * @param {number|null} [opts.earthdayCleanupObjectid] — earthday_cleanups.objectid для сброса флага при удалении заявки
 * @returns {Promise<string>} request id
 */
async function createEventRequestFromExternalSource(pool, opts) {
  const {
    userId,
    name,
    description,
    start_date,
    latitude,
    longitude,
    city,
    photosBeforeUrls,
    earthdayCleanupObjectid: rawEarthdayOid
  } = opts;

  let earthdayCleanupObjectid = null;
  if (rawEarthdayOid != null && rawEarthdayOid !== '') {
    const n = Number(rawEarthdayOid);
    if (Number.isInteger(n) && n > 0) earthdayCleanupObjectid = n;
  }

  const category = 'event';
  const defaultStatus = 'inProgress';
  const registeredParticipants = JSON.stringify([userId]);
  const privateChats = JSON.stringify([]);
  const finalPhotosBefore = Array.isArray(photosBeforeUrls)
    ? [...new Set(photosBeforeUrls.filter((u) => typeof u === 'string' && u.trim() !== '').map((u) => u.trim()))]
    : [];
  const startDateForDb = formatDateTimeForMySql(start_date);

  const requestId = generateId();
  const only_foot = false;
  const possible_by_car = false;
  const plant_tree = false;
  const trash_pickup_only = false;
  const priority = 'medium';

  await pool.execute(
    `INSERT INTO requests (
      id, user_id, category, name, description, latitude, longitude, city,
      garbage_size, only_foot, possible_by_car, reward_amount, is_open,
      start_date, end_date, status, priority, assigned_to, notes, created_by,
      taken_by, total_contributed, target_amount, joined_user_id, join_date,
      completion_comment, plant_tree, trash_pickup_only,
      created_at, updated_at, rejection_reason, rejection_message, actual_participants,
      photos_before, photos_after, registered_participants, waste_types, expires_at,
      extended_count, participant_completions, group_chat_id, private_chats, from_external_source,
      earthday_cleanup_objectid, work_duration_minutes
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      requestId,
      userId,
      category,
      name,
      description || null,
      latitude != null && latitude !== '' ? latitude : null,
      longitude != null && longitude !== '' ? longitude : null,
      city || null,
      null,
      only_foot,
      possible_by_car,
      null,
      true,
      startDateForDb,
      null,
      defaultStatus,
      priority,
      null,
      null,
      userId,
      null,
      null,
      null,
      null,
      null,
      null,
      plant_tree,
      trash_pickup_only,
      null,
      null,
      null,
      finalPhotosBefore.length > 0 ? JSON.stringify(finalPhotosBefore) : null,
      null,
      registeredParticipants,
      null,
      null,
      0,
      null,
      null,
      privateChats,
      1,
      earthdayCleanupObjectid,
      null
    ]
  );

  let groupChatId = null;
  try {
    groupChatId = await createGroupChatForRequest(requestId, userId, category);
    await pool.execute(
      'UPDATE requests SET group_chat_id = ? WHERE id = ?',
      [groupChatId, requestId]
    );
  } catch (chatErr) {
    await pool.execute('DELETE FROM requests WHERE id = ?', [requestId]);
    throw chatErr;
  }

  try {
    await initializeParticipantCompletion(requestId, userId, true);
  } catch (completionErr) {
    throw completionErr;
  }

  if (latitude && longitude) {
    sendRequestCreatedNotification({
      id: requestId,
      category,
      name,
      created_by: userId,
      latitude: parseFloat(latitude),
      longitude: parseFloat(longitude),
      photos: finalPhotosBefore
    }).catch(() => {});
  }

  return requestId;
}

module.exports = {
  createEventRequestFromExternalSource
};
