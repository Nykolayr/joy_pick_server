-- Адрес и координаты теперь только у филиалов (partner_branches). У партнёра этих полей больше нет.

ALTER TABLE partners
  DROP COLUMN address,
  DROP COLUMN latitude,
  DROP COLUMN longitude;
