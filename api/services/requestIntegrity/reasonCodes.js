/** Коды и ключи локализации (ARB в joy_pick: integrity_<code lower>) */
const REASON = {
  MISSING_NAME: 'MISSING_NAME',
  MISSING_DESCRIPTION: 'MISSING_DESCRIPTION',
  GIBBERISH_NAME: 'GIBBERISH_NAME',
  GIBBERISH_DESCRIPTION: 'GIBBERISH_DESCRIPTION',
  MISSING_COORDS: 'MISSING_COORDS',
  INVALID_COORDS: 'INVALID_COORDS',
  GEO_NOT_LAND: 'GEO_NOT_LAND',
  GEO_CHECK_SKIPPED: 'GEO_CHECK_SKIPPED',
  MISSING_PHOTOS_BEFORE: 'MISSING_PHOTOS_BEFORE',
  MISSING_PHOTOS_AFTER: 'MISSING_PHOTOS_AFTER',
  PHOTOS_BEFORE_AFTER_SAME: 'PHOTOS_BEFORE_AFTER_SAME',
  INDOOR_PHOTO: 'INDOOR_PHOTO',
  PHOTO_CHECK_SKIPPED: 'PHOTO_CHECK_SKIPPED',
  WORK_TOO_SHORT_WASTE: 'WORK_TOO_SHORT_WASTE',
  WORK_TOO_SHORT_SPEED: 'WORK_TOO_SHORT_SPEED',
  TIME_CHECK_SKIPPED: 'TIME_CHECK_SKIPPED',
  EXECUTOR_COORDS_MISSING: 'EXECUTOR_COORDS_MISSING',
  EXECUTOR_TOO_FAR: 'EXECUTOR_TOO_FAR',
  PARTICIPANT_NOT_COMPLETED: 'PARTICIPANT_NOT_COMPLETED',
};

const MESSAGE_KEYS = {
  [REASON.MISSING_NAME]: 'integrity_missing_name',
  [REASON.MISSING_DESCRIPTION]: 'integrity_missing_description',
  [REASON.GIBBERISH_NAME]: 'integrity_gibberish_name',
  [REASON.GIBBERISH_DESCRIPTION]: 'integrity_gibberish_description',
  [REASON.MISSING_COORDS]: 'integrity_missing_coords',
  [REASON.INVALID_COORDS]: 'integrity_invalid_coords',
  [REASON.GEO_NOT_LAND]: 'integrity_geo_not_land',
  [REASON.MISSING_PHOTOS_BEFORE]: 'integrity_missing_photos_before',
  [REASON.MISSING_PHOTOS_AFTER]: 'integrity_missing_photos_after',
  [REASON.PHOTOS_BEFORE_AFTER_SAME]: 'integrity_photos_same',
  [REASON.INDOOR_PHOTO]: 'integrity_indoor_photo',
  [REASON.WORK_TOO_SHORT_WASTE]: 'integrity_work_too_short_waste',
  [REASON.WORK_TOO_SHORT_SPEED]: 'integrity_work_too_short_speed',
  [REASON.EXECUTOR_COORDS_MISSING]: 'integrity_executor_coords_missing',
  [REASON.EXECUTOR_TOO_FAR]: 'integrity_executor_too_far',
  [REASON.PARTICIPANT_NOT_COMPLETED]: 'integrity_participant_not_completed',
};

/** Канонические тексты (EN) для перевода на locale клиента */
const MESSAGE_EN = {
  [REASON.MISSING_NAME]: 'Please enter a clear request title.',
  [REASON.MISSING_DESCRIPTION]: 'Please describe the cleanup or event.',
  [REASON.GIBBERISH_NAME]: 'The title looks like random characters. Use a real title.',
  [REASON.GIBBERISH_DESCRIPTION]: 'The description must explain the request in normal words.',
  [REASON.MISSING_COORDS]: 'Set a location on the map.',
  [REASON.INVALID_COORDS]: 'The map location is invalid. Choose another point.',
  [REASON.GEO_NOT_LAND]: 'The location appears to be in water or an invalid area. Pick a point on land.',
  [REASON.MISSING_PHOTOS_BEFORE]: 'Add at least one “before” photo of the place.',
  [REASON.MISSING_PHOTOS_AFTER]: 'Add at least one “after” photo.',
  [REASON.PHOTOS_BEFORE_AFTER_SAME]: 'Before and after photos look identical. Submit real cleanup photos.',
  [REASON.INDOOR_PHOTO]: 'Photos look like an indoor room, not an outdoor cleanup spot.',
  [REASON.WORK_TOO_SHORT_WASTE]: 'Cleanup time is too short (minimum 15 minutes).',
  [REASON.WORK_TOO_SHORT_SPEED]: 'Work duration is too short (minimum 15 minutes).',
  [REASON.EXECUTOR_COORDS_MISSING]: 'Turn on location and submit your position at the cleanup spot.',
  [REASON.EXECUTOR_TOO_FAR]: 'You are too far from the request location. Move closer and try again.',
  [REASON.PARTICIPANT_NOT_COMPLETED]: 'Not all participants have submitted photos and location.',
};

const SUMMARY_EN = 'Request did not pass verification. Fix the issues below and try again.';
const SUMMARY_CLOSE_EN = 'Could not submit work for review. Fix the issues below and try again.';

function messageKeyForCode(code) {
  return MESSAGE_KEYS[code] || `integrity_${String(code || 'unknown').toLowerCase()}`;
}

function messageEnForCode(code) {
  return MESSAGE_EN[code] || 'Request verification failed.';
}

module.exports = {
  REASON,
  MESSAGE_KEYS,
  MESSAGE_EN,
  SUMMARY_EN,
  SUMMARY_CLOSE_EN,
  messageKeyForCode,
  messageEnForCode,
};
