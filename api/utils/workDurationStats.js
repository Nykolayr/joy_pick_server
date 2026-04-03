const MAX_WORK_DURATION_MINUTES = 10080; // 7 суток — защита от мусора

/**
 * Парсит целые минуты с клиента. Пустое значение → null (сброс/отсутствие).
 * @param {*} raw
 * @returns {number|null}
 */
function parseWorkDurationMinutesInput(raw) {
  if (raw === undefined || raw === null || raw === '') return null;
  const n = typeof raw === 'string' ? parseInt(raw, 10) : Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > MAX_WORK_DURATION_MINUTES) {
    const err = new Error('INVALID_WORK_DURATION');
    err.code = 'INVALID_WORK_DURATION';
    throw err;
  }
  return n;
}

function normalizeRequestRowWorkDuration(target) {
  if (target.work_duration_minutes != null && target.work_duration_minutes !== '') {
    const w = Number(target.work_duration_minutes);
    target.work_duration_minutes =
      Number.isFinite(w) && w >= 0 ? Math.min(Math.floor(w), MAX_WORK_DURATION_MINUTES) : null;
  } else {
    target.work_duration_minutes = null;
  }
}

function parseParticipantCompletionMinutes(value) {
  if (value === undefined || value === null || value === '') return NaN;
  const n = typeof value === 'string' ? parseInt(value, 10) : Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > MAX_WORK_DURATION_MINUTES) return NaN;
  return n;
}

/**
 * Засчитанное время по правилам бэка:
 * - speedCleanup: заявка approved/archived, поле work_duration_minutes на строке заявки, пользователь создатель или joined.
 * - wasteLocation: исполнитель, заявка approved/archived, минуты в participant_completions[uid].
 * - event: заявка approved/archived, пользователь в участниках, participant_completions[uid].status === approved, есть минуты.
 */
async function getCreditedWorkDurationItemsForUser(pool, userId) {
  const items = [];
  const uid = String(userId);

  const [speedRows] = await pool.execute(
    `SELECT id, category, status, name, work_duration_minutes, updated_at, start_date, end_date
     FROM requests
     WHERE category = 'speedCleanup'
       AND status IN ('approved', 'archived')
       AND (created_by = ? OR joined_user_id = ?)
       AND work_duration_minutes IS NOT NULL`,
    [uid, uid]
  );
  for (const row of speedRows) {
    const m = Number(row.work_duration_minutes);
    if (!Number.isFinite(m) || m < 0) continue;
    items.push({
      request_id: row.id,
      category: row.category,
      status: row.status,
      name: row.name,
      work_duration_minutes: Math.floor(m),
      start_date: row.start_date,
      end_date: row.end_date,
      updated_at: row.updated_at,
      source: 'request'
    });
  }

  const [wasteRows] = await pool.execute(
    `SELECT id, category, status, name, participant_completions, joined_user_id, updated_at, start_date, end_date
     FROM requests
     WHERE category = 'wasteLocation'
       AND status IN ('approved', 'archived')
       AND joined_user_id = ?`,
    [uid]
  );
  for (const row of wasteRows) {
    let pc = row.participant_completions;
    if (typeof pc === 'string') {
      try {
        pc = JSON.parse(pc);
      } catch (e) {
        pc = {};
      }
    }
    const entry = pc && pc[uid];
    const num = parseParticipantCompletionMinutes(entry && entry.work_duration_minutes);
    if (!Number.isFinite(num)) continue;
    items.push({
      request_id: row.id,
      category: row.category,
      status: row.status,
      name: row.name,
      work_duration_minutes: num,
      start_date: row.start_date,
      end_date: row.end_date,
      updated_at: row.updated_at,
      source: 'participant_completion'
    });
  }

  const likePat = `%"${uid}"%`;
  const [eventRows] = await pool.execute(
    `SELECT id, category, status, name, participant_completions, registered_participants, created_by, updated_at, start_date, end_date
     FROM requests
     WHERE category = 'event'
       AND status IN ('approved', 'archived')
       AND (created_by = ? OR COALESCE(registered_participants, '') LIKE ?)`,
    [uid, likePat]
  );
  for (const row of eventRows) {
    let reg = row.registered_participants;
    if (typeof reg === 'string') {
      try {
        reg = JSON.parse(reg);
      } catch (e) {
        reg = [];
      }
    }
    if (!Array.isArray(reg)) reg = [];
    const inEvent =
      String(row.created_by) === uid || reg.some((x) => String(x) === uid);
    if (!inEvent) continue;

    let pc = row.participant_completions;
    if (typeof pc === 'string') {
      try {
        pc = JSON.parse(pc);
      } catch (e) {
        pc = {};
      }
    }
    const entry = pc && pc[uid];
    if (!entry || entry.status !== 'approved') continue;
    const num = parseParticipantCompletionMinutes(entry.work_duration_minutes);
    if (!Number.isFinite(num)) continue;
    items.push({
      request_id: row.id,
      category: row.category,
      status: row.status,
      name: row.name,
      work_duration_minutes: num,
      start_date: row.start_date,
      end_date: row.end_date,
      updated_at: row.updated_at,
      source: 'participant_completion'
    });
  }

  items.sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));
  return items;
}

module.exports = {
  MAX_WORK_DURATION_MINUTES,
  parseWorkDurationMinutesInput,
  normalizeRequestRowWorkDuration,
  getCreditedWorkDurationItemsForUser
};
