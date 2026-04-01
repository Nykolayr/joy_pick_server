/**
 * При удалении заявки, созданной из earthday_cleanups: снять used_for_internal_request,
 * если больше нет других заявок с тем же earthday_cleanup_objectid.
 */
async function releaseEarthdayCleanupOnRequestDelete(pool, requestId) {
  const [rows] = await pool.execute(
    'SELECT earthday_cleanup_objectid FROM requests WHERE id = ? LIMIT 1',
    [requestId]
  );
  if (!rows || rows.length === 0) return;
  const raw = rows[0].earthday_cleanup_objectid;
  if (raw == null) return;
  const oid = Number(raw);
  if (!Number.isFinite(oid) || oid <= 0) return;

  const [cntRows] = await pool.execute(
    'SELECT COUNT(*) AS c FROM requests WHERE earthday_cleanup_objectid = ? AND id <> ?',
    [oid, requestId]
  );
  const others = cntRows[0] ? Number(cntRows[0].c) : 0;
  if (others > 0) return;

  await pool.execute(
    'UPDATE earthday_cleanups SET used_for_internal_request = 0 WHERE objectid = ?',
    [oid]
  );
}

module.exports = {
  releaseEarthdayCleanupOnRequestDelete
};
