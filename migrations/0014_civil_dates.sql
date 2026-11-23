-- User-entered dates are civil dates, not instants. Audit timestamps stay intact.
ALTER TABLE parcels ALTER COLUMN planting_date TYPE date USING planting_date::date;
ALTER TABLE soil_analysis ALTER COLUMN analysis_date TYPE date USING analysis_date::date;
ALTER TABLE soil_biology ALTER COLUMN sample_date TYPE date USING sample_date::date;
