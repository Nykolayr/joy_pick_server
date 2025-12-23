/**
 * Скрипт для исправления типов чатов в базе данных
 * Проверяет все чаты и исправляет несоответствия типов
 */

const pool = require('../config/database');
const {
  validateChatType,
  getParticipantsCount,
  validateAndFixChatType
} = require('../utils/chatValidation');

async function fixAllChatTypes() {
  try {
    console.log('🔍 Начинаем проверку и исправление типов чатов...');

    // Получаем все чаты
    const [chats] = await pool.execute('SELECT * FROM chats ORDER BY created_at');

    console.log(`📊 Найдено чатов: ${chats.length}`);

    let fixedCount = 0;
    let errorCount = 0;
    const errors = [];

    for (const chat of chats) {
      try {
        const participantsCount = await getParticipantsCount(chat.id);
        const validation = validateChatType({ ...chat, participants_count: participantsCount });

        if (!validation.isValid) {
          console.log(`\n⚠️ Чат ${chat.id}:`);
          console.log(`   Тип: ${chat.type}`);
          console.log(`   request_id: ${chat.request_id}`);
          console.log(`   user_id: ${chat.user_id}`);
          console.log(`   Участников: ${participantsCount}`);
          console.log(`   Ошибки:`, validation.errors);

          // Исправляем тип, если он неверный
          if (validation.expectedType && validation.expectedType !== validation.actualType) {
            await pool.execute(
              'UPDATE chats SET type = ? WHERE id = ?',
              [validation.expectedType, chat.id]
            );
            console.log(`   ✅ Исправлено: ${validation.actualType} → ${validation.expectedType}`);
            fixedCount++;
          } else {
            console.log(`   ⚠️ Несоответствие, но тип не требует исправления`);
          }
        }
      } catch (err) {
        console.error(`❌ Ошибка при обработке чата ${chat.id}:`, err.message);
        errorCount++;
        errors.push({ chatId: chat.id, error: err.message });
      }
    }

    console.log(`\n📈 Результаты:`);
    console.log(`   ✅ Исправлено: ${fixedCount}`);
    console.log(`   ⚠️ Ошибок: ${errorCount}`);

    if (errors.length > 0) {
      console.log(`\n❌ Ошибки:`);
      errors.forEach(({ chatId, error }) => {
        console.log(`   Чат ${chatId}: ${error}`);
      });
    }

    // Проверяем дубликаты
    console.log(`\n🔍 Проверка дубликатов...`);

    // Дубликаты support чатов
    const [supportDuplicates] = await pool.execute(
      `SELECT user_id, COUNT(*) as count 
       FROM chats 
       WHERE type = 'support' 
       GROUP BY user_id 
       HAVING count > 1`
    );

    if (supportDuplicates.length > 0) {
      console.log(`⚠️ Найдено дубликатов support чатов: ${supportDuplicates.length}`);
      for (const dup of supportDuplicates) {
        const [chats] = await pool.execute(
          `SELECT id, created_at FROM chats WHERE type = 'support' AND user_id = ? ORDER BY created_at`,
          [dup.user_id]
        );
        console.log(`   Пользователь ${dup.user_id}: ${chats.length} чатов`);
        // Оставляем самый старый, остальные помечаем для удаления
        for (let i = 1; i < chats.length; i++) {
          console.log(`   ⚠️ Дубликат: ${chats[i].id} (создан ${chats[i].created_at})`);
        }
      }
    }

    // Дубликаты group чатов
    const [groupDuplicates] = await pool.execute(
      `SELECT request_id, COUNT(*) as count 
       FROM chats 
       WHERE type = 'group' 
       GROUP BY request_id 
       HAVING count > 1`
    );

    if (groupDuplicates.length > 0) {
      console.log(`⚠️ Найдено дубликатов group чатов: ${groupDuplicates.length}`);
      for (const dup of groupDuplicates) {
        const [chats] = await pool.execute(
          `SELECT id, created_at FROM chats WHERE type = 'group' AND request_id = ? ORDER BY created_at`,
          [dup.request_id]
        );
        console.log(`   Заявка ${dup.request_id}: ${chats.length} чатов`);
        // Оставляем самый старый, остальные помечаем для удаления
        for (let i = 1; i < chats.length; i++) {
          console.log(`   ⚠️ Дубликат: ${chats[i].id} (создан ${chats[i].created_at})`);
        }
      }
    }

    // Дубликаты private чатов
    const [privateDuplicates] = await pool.execute(
      `SELECT request_id, user_id, COUNT(*) as count 
       FROM chats 
       WHERE type = 'private' 
       GROUP BY request_id, user_id 
       HAVING count > 1`
    );

    if (privateDuplicates.length > 0) {
      console.log(`⚠️ Найдено дубликатов private чатов: ${privateDuplicates.length}`);
      for (const dup of privateDuplicates) {
        const [chats] = await pool.execute(
          `SELECT id, created_at FROM chats WHERE type = 'private' AND request_id = ? AND user_id = ? ORDER BY created_at`,
          [dup.request_id, dup.user_id]
        );
        console.log(`   Заявка ${dup.request_id}, пользователь ${dup.user_id}: ${chats.length} чатов`);
        // Оставляем самый старый, остальные помечаем для удаления
        for (let i = 1; i < chats.length; i++) {
          console.log(`   ⚠️ Дубликат: ${chats[i].id} (создан ${chats[i].created_at})`);
        }
      }
    }

    console.log(`\n✅ Проверка завершена!`);
  } catch (error) {
    console.error('❌ Критическая ошибка:', error);
    process.exit(1);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

// Запускаем скрипт
if (require.main === module) {
  fixAllChatTypes();
}

module.exports = { fixAllChatTypes };

