const { REASON, messageKeyForCode, messageEnForCode } = require('./reasonCodes');
const { checkExecutorAtRequestSite } = require('./executorGeoCheck');
const { checkPhotos } = require('./photoCheck');

function issue(code, field, extra = {}) {
  return {
    code,
    field,
    severity: 'reject',
    source: 'rules',
    message_key: messageKeyForCode(code),
    message_en: messageEnForCode(code),
    ...extra,
  };
}

function parseParticipants(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) return raw.filter(Boolean);
  if (typeof raw === 'string') {
    try {
      const p = JSON.parse(raw);
      return Array.isArray(p) ? p.filter(Boolean) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/**
 * Перед close-by-creator: у всех участников (registered) и создателя — фото «после» и гео в радиусе.
 */
async function checkEventParticipantsForClose({ request, participantCompletions }) {
  const issues = [];
  const completions = participantCompletions || {};
  const registered = parseParticipants(request.registered_participants);
  const createdBy = request.created_by;
  const userIds = [...new Set([...registered, createdBy].filter(Boolean))];

  for (const uid of userIds) {
    const c = completions[uid];
    const isCreator = uid === createdBy;
    const label = isCreator ? 'creator' : 'participant';

    if (!c) {
      issues.push(issue(REASON.PARTICIPANT_NOT_COMPLETED, 'participants', { user_id: uid, role: label }));
      continue;
    }

    const st = String(c.status || '').toLowerCase();
    if (!isCreator && st === 'inprogress') {
      issues.push(issue(REASON.PARTICIPANT_NOT_COMPLETED, 'participants', { user_id: uid, role: label }));
      continue;
    }

    const photosAfter = Array.isArray(c.photos_after) ? c.photos_after : [];
    const photoIssues = await checkPhotos({
      category: 'event',
      phase: 'close',
      photosBefore: [],
      photosAfter,
      photoFilesAfter: [],
      onlyAfterForUser: true,
    });
    photoIssues.forEach((pi) => {
      issues.push({ ...pi, user_id: uid, role: label });
    });

    const geoIssues = checkExecutorAtRequestSite({
      requestLatitude: request.latitude,
      requestLongitude: request.longitude,
      completionLatitude: c.completion_latitude,
      completionLongitude: c.completion_longitude,
      field: isCreator ? 'creator_location' : 'location',
    });
    geoIssues.forEach((gi) => {
      issues.push({ ...gi, user_id: uid, role: label });
    });
  }

  return issues;
}

module.exports = { checkEventParticipantsForClose };
