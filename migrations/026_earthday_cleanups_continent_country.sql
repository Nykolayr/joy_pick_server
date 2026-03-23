-- Континент / страна по lat/lng (англ. названия, bbox), строка для UI — см. api/utils/geoContinentCountry.js

ALTER TABLE earthday_cleanups
  ADD COLUMN continent VARCHAR(64) DEFAULT NULL COMMENT 'Continent (English), from lat/lng rules' AFTER lng,
  ADD COLUMN country VARCHAR(128) DEFAULT NULL COMMENT 'Country (English), first matching bbox or NULL' AFTER continent,
  ADD COLUMN location_hint TEXT DEFAULT NULL COMMENT 'continent · approx: country · GeoCodedAddress' AFTER country;
