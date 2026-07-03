#!/usr/bin/env node
/**
 * Unit-тесты social share (без БД / OpenRouter).
 */
const assert = require('assert');
const {
  resolveSharePhotos,
  hasCompletionSharePhotos,
  resolveExecutorUserIds,
  normalizeSocialSharePublicUrl,
  buildSharePageUrl,
} = require('../api/services/requestSocialShareService');
const { applyShareTemplate, resolveShareLocale } = require('../api/utils/socialShareCopy');

const BASE = 'https://joypick.world';

function row(overrides) {
  return {
    category: 'speedCleanup',
    status: 'approved',
    created_by: 'creator-1',
    joined_user_id: 'exec-1',
    photos_before: JSON.stringify([`${BASE}/uploads/photos/before.jpg`]),
    photos_after: JSON.stringify([`${BASE}/uploads/photos/after.jpg`]),
    participant_completions: '{}',
    ...overrides,
  };
}

let failed = 0;

function ok(name, fn) {
  try {
    fn();
    console.log('OK', name);
  } catch (e) {
    failed += 1;
    console.error('FAIL', name, e.message);
  }
}

ok('resolveSharePhotos before/after', () => {
  const p = resolveSharePhotos(row({}));
  assert.strictEqual(p.before?.includes('before.jpg'), true);
  assert.strictEqual(p.after?.includes('after.jpg'), true);
});

ok('after from participant_completions', () => {
  const p = resolveSharePhotos(
    row({
      photos_after: '[]',
      participant_completions: JSON.stringify({
        u1: { status: 'approved', photos_after: [`${BASE}/uploads/photos/pc-after.jpg`] },
      }),
    })
  );
  assert.strictEqual(p.after?.includes('pc-after.jpg'), true);
});

ok('hasCompletionSharePhotos', () => {
  assert.strictEqual(hasCompletionSharePhotos(row({})), true);
  assert.strictEqual(
    hasCompletionSharePhotos(row({ photos_after: '[]', participant_completions: '{}' })),
    false
  );
});

ok('event executors — submitted parts', () => {
  const ids = resolveExecutorUserIds(
    row({
      category: 'event',
      participant_completions: JSON.stringify({
        'vol-1': { status: 'pending', photos_after: ['/uploads/photos/a.jpg'] },
        'vol-2': { status: 'inProgress', photos_after: [] },
        'creator-1': { status: 'approved', photos_after: ['/uploads/photos/c.jpg'] },
      }),
    })
  );
  assert.deepStrictEqual(ids, ['vol-1']);
});

ok('speed single executor', () => {
  const ids = resolveExecutorUserIds(row({ category: 'speedCleanup', joined_user_id: 'exec-1' }));
  assert.deepStrictEqual(ids, ['exec-1']);
});

ok('locale ru from Accept-Language', () => {
  assert.strictEqual(resolveShareLocale({ acceptLanguage: 'pt-BR, ru;q=0.9' }), 'ru');
  assert.strictEqual(resolveShareLocale({ locale: 'de' }), 'en');
});

ok('normalizeSocialSharePublicUrl — joypick legacy', () => {
  const id = '84d11da2-b3f7-4137-83a7-30f5f2c79a80';
  const canonical = buildSharePageUrl(id);
  const legacy = `joypick://request/speed_cleanup/${id}`;
  const r = normalizeSocialSharePublicUrl(id, legacy);
  assert.strictEqual(r.canonical, canonical);
  assert.strictEqual(r.needsRepair, true);
  assert.ok(r.canonical.startsWith('https://'));
  assert.ok(r.canonical.includes('/social/'));
});

ok('normalizeSocialSharePublicUrl — already canonical', () => {
  const id = 'test-id';
  const canonical = buildSharePageUrl(id);
  const r = normalizeSocialSharePublicUrl(id, canonical);
  assert.strictEqual(r.canonical, canonical);
  assert.strictEqual(r.needsRepair, false);
});

ok('applyShareTemplate placeholders', () => {
  const text = applyShareTemplate({
    locale: 'ru',
    requestName: 'Пляж',
    organizerName: 'Anna',
    executorNames: ['Bob', 'Carol'],
  });
  assert.ok(text.includes('"Пляж"'));
  assert.ok(text.includes('Anna'));
  assert.ok(text.includes('Bob'));
  assert.ok(text.includes('Carol'));
});

if (failed) {
  console.error(`\n${failed} failed`);
  process.exit(1);
}
console.log('\nAll social share unit tests passed.');
process.exit(0);
