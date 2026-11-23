-- Additive development migration. No historical values are rewritten.
ALTER TABLE soil_analysis ADD COLUMN IF NOT EXISTS nitrogen_inorganic numeric(10,2);
ALTER TABLE soil_biology
  ADD COLUMN IF NOT EXISTS lab_folio text,
  ADD COLUMN IF NOT EXISTS lab_name text,
  ADD COLUMN IF NOT EXISTS microbiology_method text,
  ADD COLUMN IF NOT EXISTS trichoderma_cfu numeric(18,2),
  ADD COLUMN IF NOT EXISTS fusarium_cfu numeric(18,2),
  ADD COLUMN IF NOT EXISTS bacillus_cfu numeric(18,2),
  ADD COLUMN IF NOT EXISTS metarhizium_cfu numeric(18,2),
  ADD COLUMN IF NOT EXISTS metarhizium_status text,
  ADD COLUMN IF NOT EXISTS beauveria_cfu numeric(18,2),
  ADD COLUMN IF NOT EXISTS beauveria_status text,
  ADD COLUMN IF NOT EXISTS nitrogen_fixers_status text;
