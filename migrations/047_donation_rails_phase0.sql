-- Фаза 0: рельсы донатов (stripe A / manual E), профиль выплат исполнителя

ALTER TABLE users
  ADD COLUMN payout_rail VARCHAR(16) NULL DEFAULT NULL COMMENT 'stripe|manual|crypto|psp' AFTER stripe_status_updated_at,
  ADD COLUMN manual_payout_details JSON NULL DEFAULT NULL AFTER payout_rail,
  ADD COLUMN manual_payout_verified_at DATETIME NULL DEFAULT NULL AFTER manual_payout_details;

ALTER TABLE donations
  ADD COLUMN provider VARCHAR(16) NOT NULL DEFAULT 'stripe' AFTER payment_intent_id,
  ADD COLUMN rail_code VARCHAR(2) NOT NULL DEFAULT 'A' AFTER provider;
