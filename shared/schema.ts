import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, serial, decimal, timestamp, boolean, jsonb, uniqueIndex, check, date, primaryKey, index, foreignKey } from "drizzle-orm/pg-core";
import { createInsertSchema, createSelectSchema } from "drizzle-zod";
import { z } from "zod";
import type { SoilHealthAnswers, SoilHealthIndicatorId } from "./soil-health";

export const userRoles = ["admin", "farmer", "researcher"] as const;
export type UserRole = typeof userRoles[number];

export const producerTypes = ["pequeno", "mediano", "grande"] as const;
export type ProducerType = typeof producerTypes[number];

export const techLevels = ["basico", "intermedio", "avanzado"] as const;
export type TechLevel = typeof techLevels[number];

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role").notNull().default("farmer"),
  isActive: boolean("is_active").default(true).notNull(),
  phone: text("phone"),
  age: integer("age"),
  gender: text("gender"),
  schoolingYears: integer("schooling_years"),
  farmingExperienceYears: integer("farming_experience_years"),
  state: text("state"),
  municipality: text("municipality"),
  locality: text("locality"),
  avatarUrl: text("avatar_url"),
  producerType: text("producer_type"),
  hasDrones: boolean("has_drones"),
  hasIoT: boolean("has_iot"),
  techLevel: text("tech_level"),
  farmingTypes: text("farming_types").array(),
  currentPractices: text("current_practices").array(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertUserSchema = createInsertSchema(users, {
  email: z.string().email(),
  role: z.enum(userRoles),
  age: z.coerce.number().min(15).max(100).optional().nullable(),
  schoolingYears: z.coerce.number().min(0).max(40).optional().nullable(),
  farmingExperienceYears: z.coerce.number().min(0).max(80).optional().nullable(),
  gender: z.enum(["masculino", "femenino", "otro", "prefiero_no_decir"]).optional().nullable(),
  producerType: z.enum(producerTypes).optional().nullable(),
  techLevel: z.enum(techLevels).optional().nullable(),
  hasDrones: z.boolean().optional().nullable(),
  hasIoT: z.boolean().optional().nullable(),
  farmingTypes: z.array(z.string()).optional().nullable(),
  currentPractices: z.array(z.string()).optional().nullable(),
}).omit({ id: true, createdAt: true, isActive: true });

export const selectUserSchema = createSelectSchema(users).omit({ passwordHash: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

export const phenologicalStages = ["siembra", "germinacion", "crecimiento", "floracion", "fructificacion", "cosecha"] as const;
export type PhenologicalStage = typeof phenologicalStages[number];

export const soilTypes = ["arcilloso", "arenoso", "limoso", "franco", "franco-arcilloso", "franco-arenoso"] as const;
export type SoilType = typeof soilTypes[number];

export const irrigationSystems = ["temporal", "goteo", "aspersion", "gravedad", "pivote", "ninguno"] as const;
export type IrrigationSystem = typeof irrigationSystems[number];

export const parcels = pgTable("parcels", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  location: text("location").notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 7 }).notNull(),
  longitude: decimal("longitude", { precision: 10, scale: 7 }).notNull(),
  area: decimal("area", { precision: 10, scale: 2 }).notNull(),
  crop: text("crop").notNull(),
  phenologicalStage: text("phenological_stage").default("siembra"),
  soilType: text("soil_type").default("franco"),
  irrigationSystem: text("irrigation_system").default("temporal"),
  plantingDate: date("planting_date", { mode: "date" }),
  polygonCoordinates: jsonb("polygon_coordinates"), // Array of [lat, lng] pairs
  status: text("status").notNull().default("active"),
  isPublic: boolean("is_public").default(false).notNull(),
  lastSatelliteNdvi: decimal("last_satellite_ndvi", { precision: 5, scale: 4 }),       // cached from Sentinel-2
  lastSatelliteNdviDate: text("last_satellite_ndvi_date"),                              // ISO date of last EE fetch
  proactiveAlertFrequencyHours: integer("proactive_alert_frequency_hours").default(24).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertParcelSchema = createInsertSchema(parcels, {
  latitude: z.coerce.number().min(-90).max(90),
  longitude: z.coerce.number().min(-180).max(180),
  area: z.coerce.number().positive(),
  status: z.enum(["active", "warning", "inactive"]).optional(),
  phenologicalStage: z.enum(phenologicalStages).optional(),
  soilType: z.enum(soilTypes).optional(),
  irrigationSystem: z.enum(irrigationSystems).optional(),
  plantingDate: z.coerce.date().optional().nullable(),
  polygonCoordinates: z.array(z.tuple([z.number(), z.number()])).optional().nullable(),
  proactiveAlertFrequencyHours: z.coerce.number().int().min(1).max(720).optional(),
}).omit({ id: true, createdAt: true, updatedAt: true });

export const selectParcelSchema = createSelectSchema(parcels);
export type InsertParcel = z.infer<typeof insertParcelSchema>;
export type Parcel = typeof parcels.$inferSelect;

// Time-series monitoring data for each parcel
export const parcelData = pgTable("parcel_data", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parcelId: varchar("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  date: timestamp("date").notNull(),
  ndvi: decimal("ndvi", { precision: 4, scale: 3 }), // Vegetation index
  evi: decimal("evi", { precision: 4, scale: 3 }), // Enhanced vegetation index
  soilMoisture: decimal("soil_moisture", { precision: 5, scale: 2 }), // Percentage
  temperature: decimal("temperature", { precision: 4, scale: 1 }), // Celsius
  precipitation: decimal("precipitation", { precision: 6, scale: 2 }), // mm
  metadata: jsonb("metadata"), // Additional flexible data
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertParcelDataSchema = createInsertSchema(parcelData, {
  ndvi: z.coerce.number().min(0).max(1).optional(),
  evi: z.coerce.number().min(0).max(1).optional(),
  soilMoisture: z.coerce.number().min(0).max(100).optional(),
}).omit({ id: true, createdAt: true });

export const selectParcelDataSchema = createSelectSchema(parcelData);
export type InsertParcelData = z.infer<typeof insertParcelDataSchema>;
export type ParcelData = typeof parcelData.$inferSelect;

// Alerts and insights for parcels
export const alerts = pgTable("alerts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parcelId: varchar("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  severity: text("severity").notNull(), // high, medium, low
  title: text("title").notNull(),
  description: text("description").notNull(),
  isRead: boolean("is_read").default(false).notNull(),
  type: text("type").default("standard").notNull(), // standard | ai_proactive
  actionStatus: text("action_status"), // null | 'applied' | 'dismissed'
  reasoningBullets: jsonb("reasoning_bullets"), // string[] — short bullets from AI reasoning
  eventType: text("event_type"), // 'ndvi_drop' | 'frost' | 'drought' | 'excess_water'
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertAlertSchema = createInsertSchema(alerts, {
  severity: z.enum(["high", "medium", "low"]),
  type: z.enum(["standard", "ai_proactive"]).optional(),
  actionStatus: z.enum(["applied", "dismissed"]).nullable().optional(),
  eventType: z.string().optional().nullable(),
}).omit({ id: true, createdAt: true });

export const selectAlertSchema = createSelectSchema(alerts);
export type InsertAlert = z.infer<typeof insertAlertSchema>;
export type Alert = typeof alerts.$inferSelect;

// Soil analysis data from laboratory tests
export const soilHealthAssessments = pgTable("soil_health_assessments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parcelId: varchar("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  authorId: varchar("author_id").notNull().references(() => users.id),
  catalogueVersion: text("catalogue_version").notNull().default("1"),
  assessmentDate: date("assessment_date").notNull(),
  responsible: text("responsible").notNull(),
  crop: text("crop").notNull().default(""),
  stage: text("stage").notNull().default(""),
  area: text("area").notNull().default(""),
  moisture: text("moisture").notNull().default(""),
  recentWater: text("recent_water").notNull().default(""),
  answers: jsonb("answers").$type<SoilHealthAnswers>().notNull().default({}),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, t => [index("soil_health_parcel_date_idx").on(t.parcelId, t.assessmentDate)]);

export const soilHealthEvidence = pgTable("soil_health_evidence", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  assessmentId: varchar("assessment_id").notNull().references(() => soilHealthAssessments.id, { onDelete: "cascade" }),
  indicatorId: text("indicator_id").$type<SoilHealthIndicatorId>().notNull(),
  objectPath: text("object_path").notNull(),
  filename: text("filename").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, t => [index("soil_health_evidence_assessment_idx").on(t.assessmentId)]);

// Independent of parcels: survive cascading deletes until physical cleanup succeeds.
export const soilHealthObjectCleanup = pgTable("soil_health_object_cleanup", {
  objectPath: text("object_path").primaryKey(),
  notBefore: timestamp("not_before").defaultNow().notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const soilAnalysis = pgTable("soil_analysis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parcelId: varchar("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  analysisDate: date("analysis_date", { mode: "date" }).notNull(),
  labName: text("lab_name"),
  // Organic matter and carbon
  organicMatter: decimal("organic_matter", { precision: 5, scale: 2 }), // Percentage
  totalCarbon: decimal("total_carbon", { precision: 5, scale: 2 }), // Percentage
  // Macronutrients
  nitrogenTotal: decimal("nitrogen_total", { precision: 10, scale: 3 }), // Percentage; never inorganic N
  nitrogenInorganic: decimal("nitrogen_inorganic", { precision: 10, scale: 2 }), // mg/kg
  phosphorus: decimal("phosphorus", { precision: 10, scale: 2 }), // ppm (Bray, Olsen)
  potassium: decimal("potassium", { precision: 10, scale: 2 }), // ppm or meq/100g
  calcium: decimal("calcium", { precision: 10, scale: 2 }), // ppm or meq/100g
  magnesium: decimal("magnesium", { precision: 10, scale: 2 }), // ppm or meq/100g
  sulfur: decimal("sulfur", { precision: 10, scale: 2 }), // ppm
  // Micronutrients
  iron: decimal("iron", { precision: 10, scale: 2 }), // ppm
  zinc: decimal("zinc", { precision: 10, scale: 2 }), // ppm
  manganese: decimal("manganese", { precision: 10, scale: 2 }), // ppm
  copper: decimal("copper", { precision: 10, scale: 2 }), // ppm
  boron: decimal("boron", { precision: 10, scale: 2 }), // ppm
  // Physical properties
  ph: decimal("ph", { precision: 4, scale: 2 }), // 0-14 scale
  electricConductivity: decimal("electric_conductivity", { precision: 10, scale: 2 }), // dS/m
  cec: decimal("cec", { precision: 10, scale: 2 }), // Cation Exchange Capacity meq/100g
  // Texture
  sand: decimal("sand", { precision: 5, scale: 2 }), // Percentage
  silt: decimal("silt", { precision: 5, scale: 2 }), // Percentage
  clay: decimal("clay", { precision: 5, scale: 2 }), // Percentage
  // Metadata
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSoilAnalysisSchema = createInsertSchema(soilAnalysis, {
  analysisDate: z.coerce.date(),
  organicMatter: z.coerce.number().min(0).max(100).optional().nullable(),
  totalCarbon: z.coerce.number().min(0).max(100).optional().nullable(),
  nitrogenTotal: z.preprocess(v => typeof v === "string" && !v.trim() ? null : v, z.coerce.number().finite().min(0).optional().nullable()),
  nitrogenInorganic: z.preprocess(v => typeof v === "string" && !v.trim() ? null : v, z.coerce.number().finite().min(0).optional().nullable()),
  phosphorus: z.coerce.number().min(0).optional().nullable(),
  potassium: z.coerce.number().min(0).optional().nullable(),
  calcium: z.coerce.number().min(0).optional().nullable(),
  magnesium: z.coerce.number().min(0).optional().nullable(),
  sulfur: z.coerce.number().min(0).optional().nullable(),
  iron: z.coerce.number().min(0).optional().nullable(),
  zinc: z.coerce.number().min(0).optional().nullable(),
  manganese: z.coerce.number().min(0).optional().nullable(),
  copper: z.coerce.number().min(0).optional().nullable(),
  boron: z.coerce.number().min(0).optional().nullable(),
  ph: z.coerce.number().min(0).max(14).optional().nullable(),
  electricConductivity: z.coerce.number().min(0).optional().nullable(),
  cec: z.coerce.number().min(0).optional().nullable(),
  sand: z.coerce.number().min(0).max(100).optional().nullable(),
  silt: z.coerce.number().min(0).max(100).optional().nullable(),
  clay: z.coerce.number().min(0).max(100).optional().nullable(),
}).omit({ id: true, createdAt: true });

export const selectSoilAnalysisSchema = createSelectSchema(soilAnalysis);
export type InsertSoilAnalysis = z.infer<typeof insertSoilAnalysisSchema>;
export type SoilAnalysis = typeof soilAnalysis.$inferSelect;

// Water analysis for irrigation water quality
export const waterAnalysis = pgTable("water_analysis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parcelId: varchar("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  analysisDate: timestamp("analysis_date").notNull(),
  source: text("source"), // pozo, río, canal, red
  labName: text("lab_name"),
  // General parameters
  ph: decimal("ph", { precision: 4, scale: 2 }), // 0-14
  electricConductivity: decimal("electric_conductivity", { precision: 6, scale: 2 }), // dS/m
  tds: decimal("tds", { precision: 8, scale: 2 }), // mg/L (Total Dissolved Solids)
  hardness: decimal("hardness", { precision: 7, scale: 2 }), // mg/L as CaCO3
  // Sodium Adsorption Ratio & Residual Sodium Carbonate
  sar: decimal("sar", { precision: 6, scale: 2 }), // Sodium Adsorption Ratio (dimensionless)
  rsc: decimal("rsc", { precision: 6, scale: 2 }), // Residual Sodium Carbonate meq/L
  // Major cations (meq/L or mg/L)
  sodium: decimal("sodium", { precision: 7, scale: 2 }), // Na mg/L
  calcium: decimal("calcium", { precision: 7, scale: 2 }), // Ca mg/L
  magnesium: decimal("magnesium", { precision: 7, scale: 2 }), // Mg mg/L
  // Major anions (meq/L or mg/L)
  bicarbonates: decimal("bicarbonates", { precision: 7, scale: 2 }), // HCO3 mg/L
  carbonates: decimal("carbonates", { precision: 7, scale: 2 }), // CO3 mg/L
  chlorides: decimal("chlorides", { precision: 7, scale: 2 }), // Cl mg/L
  sulfates: decimal("sulfates", { precision: 7, scale: 2 }), // SO4 mg/L
  // Trace elements
  boron: decimal("boron", { precision: 6, scale: 3 }), // B mg/L
  nitrates: decimal("nitrates", { precision: 7, scale: 2 }), // NO3 mg/L
  // Metadata
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertWaterAnalysisSchema = createInsertSchema(waterAnalysis, {
  analysisDate: z.coerce.date(),
  ph: z.coerce.number().min(0).max(14).optional().nullable(),
  electricConductivity: z.coerce.number().min(0).optional().nullable(),
  tds: z.coerce.number().min(0).optional().nullable(),
  hardness: z.coerce.number().min(0).optional().nullable(),
  sar: z.coerce.number().min(0).optional().nullable(),
  rsc: z.coerce.number().optional().nullable(),
  sodium: z.coerce.number().min(0).optional().nullable(),
  calcium: z.coerce.number().min(0).optional().nullable(),
  magnesium: z.coerce.number().min(0).optional().nullable(),
  bicarbonates: z.coerce.number().min(0).optional().nullable(),
  carbonates: z.coerce.number().min(0).optional().nullable(),
  chlorides: z.coerce.number().min(0).optional().nullable(),
  sulfates: z.coerce.number().min(0).optional().nullable(),
  boron: z.coerce.number().min(0).optional().nullable(),
  nitrates: z.coerce.number().min(0).optional().nullable(),
}).omit({ id: true, createdAt: true });

export const selectWaterAnalysisSchema = createSelectSchema(waterAnalysis);
export type InsertWaterAnalysis = z.infer<typeof insertWaterAnalysisSchema>;
export type WaterAnalysis = typeof waterAnalysis.$inferSelect;

// Plant Tissue Analysis — nutrición en tejido vegetal (hoja, tallo, grano)
export const plantTissueAnalysis = pgTable("plant_tissue_analysis", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parcelId: varchar("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  analysisDate: timestamp("analysis_date").notNull(),
  labName: text("lab_name"),
  samplePart: text("sample_part"),       // hoja, tallo, raiz, grano, peciolo
  phenologicalStage: text("phenological_stage"),
  // Macronutrients (%)
  nitrogen: decimal("nitrogen", { precision: 6, scale: 3 }),
  phosphorus: decimal("phosphorus", { precision: 6, scale: 3 }),
  potassium: decimal("potassium", { precision: 6, scale: 3 }),
  calcium: decimal("calcium", { precision: 6, scale: 3 }),
  magnesium: decimal("magnesium", { precision: 6, scale: 3 }),
  sulfur: decimal("sulfur", { precision: 6, scale: 3 }),
  // Micronutrients (ppm)
  iron: decimal("iron", { precision: 8, scale: 2 }),
  zinc: decimal("zinc", { precision: 8, scale: 2 }),
  manganese: decimal("manganese", { precision: 8, scale: 2 }),
  copper: decimal("copper", { precision: 8, scale: 2 }),
  boron: decimal("boron", { precision: 8, scale: 3 }),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPlantTissueAnalysisSchema = createInsertSchema(plantTissueAnalysis, {
  analysisDate: z.coerce.date(),
  nitrogen:   z.coerce.number().min(0).optional().nullable(),
  phosphorus: z.coerce.number().min(0).optional().nullable(),
  potassium:  z.coerce.number().min(0).optional().nullable(),
  calcium:    z.coerce.number().min(0).optional().nullable(),
  magnesium:  z.coerce.number().min(0).optional().nullable(),
  sulfur:     z.coerce.number().min(0).optional().nullable(),
  iron:       z.coerce.number().min(0).optional().nullable(),
  zinc:       z.coerce.number().min(0).optional().nullable(),
  manganese:  z.coerce.number().min(0).optional().nullable(),
  copper:     z.coerce.number().min(0).optional().nullable(),
  boron:      z.coerce.number().min(0).optional().nullable(),
}).omit({ id: true, createdAt: true });

export type InsertPlantTissueAnalysis = z.infer<typeof insertPlantTissueAnalysisSchema>;
export type PlantTissueAnalysis = typeof plantTissueAnalysis.$inferSelect;

// Tillage practices for parcels
export const tillagePractices = pgTable("tillage_practices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parcelId: varchar("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  cycleYear: integer("cycle_year").notNull(),
  cycleSeason: text("cycle_season").notNull(), // primavera-verano, otono-invierno
  // Mechanized activities (number of passes)
  desvaradora: integer("desvaradora").default(0),
  barbecho: integer("barbecho").default(0),
  aradoSubsolado: integer("arado_subsolado").default(0),
  rastra: integer("rastra").default(0),
  nivelacion: integer("nivelacion").default(0),
  aplicacionAbonos: integer("aplicacion_abonos").default(0),
  siembra: integer("siembra").default(0),
  fertilizantesQuimicos: integer("fertilizantes_quimicos").default(0),
  escarda: integer("escarda").default(0),
  aplicacionAgroquimicos: integer("aplicacion_agroquimicos").default(0),
  cosechadora: integer("cosechadora").default(0),
  recoleccion: integer("recoleccion").default(0),
  recoleccionRastrojo: integer("recoleccion_rastrojo").default(0),
  // Costs per hectare
  costoDesvaradora: decimal("costo_desvaradora", { precision: 10, scale: 2 }),
  costoBarbecho: decimal("costo_barbecho", { precision: 10, scale: 2 }),
  costoAradoSubsolado: decimal("costo_arado_subsolado", { precision: 10, scale: 2 }),
  costoRastra: decimal("costo_rastra", { precision: 10, scale: 2 }),
  costoNivelacion: decimal("costo_nivelacion", { precision: 10, scale: 2 }),
  costoAplicacionAbonos: decimal("costo_aplicacion_abonos", { precision: 10, scale: 2 }),
  costoSiembra: decimal("costo_siembra", { precision: 10, scale: 2 }),
  costoFertilizantesQuimicos: decimal("costo_fertilizantes_quimicos", { precision: 10, scale: 2 }),
  costoEscarda: decimal("costo_escarda", { precision: 10, scale: 2 }),
  costoAplicacionAgroquimicos: decimal("costo_aplicacion_agroquimicos", { precision: 10, scale: 2 }),
  costoCosechadora: decimal("costo_cosechadora", { precision: 10, scale: 2 }),
  costoRecoleccion: decimal("costo_recoleccion", { precision: 10, scale: 2 }),
  costoRecoleccionRastrojo: decimal("costo_recoleccion_rastrojo", { precision: 10, scale: 2 }),
  // Reduced tillage info
  yearsReducingTillage: integer("years_reducing_tillage"),
  // Residue management
  burnsResidues: boolean("burns_residues").default(false),
  residuePercentLeft: integer("residue_percent_left"), // 0, 33, 50, 100
  residueUse: text("residue_use").array(), // pastoreo, alimento_corral, composta, venta
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertTillagePracticesSchema = createInsertSchema(tillagePractices, {
  cycleYear: z.coerce.number().min(2000).max(2100),
  cycleSeason: z.enum(["primavera-verano", "otono-invierno"]),
  residuePercentLeft: z.coerce.number().min(0).max(100).optional().nullable(),
}).omit({ id: true, createdAt: true });

export type InsertTillagePractices = z.infer<typeof insertTillagePracticesSchema>;
export type TillagePractices = typeof tillagePractices.$inferSelect;

// Crop sequence entry stored inside cropRotation.cropSequence jsonb
// Generalized form per task-154: {year, crop, notes}
// season is optional for backward compat with pv/oi UI display
export const cropSequenceEntrySchema = z.object({
  year: z.number().int().min(2000).max(2100).optional(),
  crop: z.string().min(1),
  season: z.enum(["pv", "oi"]).optional(), // primavera-verano | otoño-invierno
  notes: z.string().optional(),
});
export type CropSequenceEntry = z.infer<typeof cropSequenceEntrySchema>;

// Crop rotation history
export const cropRotation = pgTable("crop_rotation", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parcelId: varchar("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  year: integer("year").notNull(), // legacy campaign year (kept for compat)
  campaignYear: integer("campaign_year"), // T154: canonical campaign year for the visual planner
  springCrops: text("spring_crops"), // cultivos primavera-verano (legacy text field)
  fallCrops: text("fall_crops"), // cultivos otono-invierno (legacy text field)
  rotationSystem: text("rotation_system"), // rotacion_descanso, agroforestal, otro
  rotationSystemDetails: text("rotation_system_details"),
  // T154: structured crop sequence entries for visual planner: [{year, crop, notes, season?}]
  cropSequence: jsonb("crop_sequence"), // CropSequenceEntry[]
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCropRotationSchema = createInsertSchema(cropRotation, {
  year: z.coerce.number().min(2000).max(2100),
  campaignYear: z.coerce.number().min(2000).max(2100).optional().nullable(),
  cropSequence: z.array(cropSequenceEntrySchema).optional().nullable(),
}).omit({ id: true, createdAt: true });

export type InsertCropRotation = z.infer<typeof insertCropRotationSchema>;
export type CropRotation = typeof cropRotation.$inferSelect;

// Animal integration
export const animalIntegration = pgTable("animal_integration", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parcelId: varchar("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  // Animal inventory
  hasBovinos: boolean("has_bovinos").default(false),
  bovinosCount: integer("bovinos_count"),
  hasOvinos: boolean("has_ovinos").default(false),
  ovinosCount: integer("ovinos_count"),
  hasCaprinos: boolean("has_caprinos").default(false),
  caprinosCount: integer("caprinos_count"),
  hasAves: boolean("has_aves").default(false),
  avesCount: integer("aves_count"),
  hasPorcinos: boolean("has_porcinos").default(false),
  porcinosCount: integer("porcinos_count"),
  hasEquinos: boolean("has_equinos").default(false),
  equinosCount: integer("equinos_count"),
  otherAnimals: text("other_animals"),
  otherAnimalsCount: integer("other_animals_count"),
  // Grazing system
  grazingSystem: text("grazing_system"), // corral, pastoreo_continuo, pastoreo_rotacional, combinado
  grazingSystemDetails: text("grazing_system_details"),
  allowsPostHarvestGrazing: text("allows_post_harvest_grazing"), // siempre, a_veces, no
  postHarvestGrazingConditions: text("post_harvest_grazing_conditions").array(),
  // Manure management
  manureUse: text("manure_use").array(), // sin_uso, crudo, composta, venta
  manureApplicationFrequency: text("manure_application_frequency"),
  manureQuantityTons: decimal("manure_quantity_tons", { precision: 8, scale: 2 }),
  // Composting
  compostType: text("compost_type").array(), // pilas, fosa, contenedor, lombricomposta, termico
  compostMaterials: text("compost_materials").array(), // rastrojos, cocina, podas, tierra_cal, agua
  // Rotational grazing details
  lotRotationFrequency: text("lot_rotation_frequency"),
  numberOfLots: integer("number_of_lots"),
  averageLotSize: text("average_lot_size"),
  rotatedSpecies: text("rotated_species"),
  restDays: integer("rest_days"),
  animalLoadPerHa: decimal("animal_load_per_ha", { precision: 8, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertAnimalIntegrationSchema = createInsertSchema(animalIntegration).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertAnimalIntegration = z.infer<typeof insertAnimalIntegrationSchema>;
export type AnimalIntegration = typeof animalIntegration.$inferSelect;

// Livelihood and commercialization
export const livelihood = pgTable("livelihood", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parcelId: varchar("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  // Income distribution
  incomeAgricultural: integer("income_agricultural"), // percentage
  incomeAnimal: integer("income_animal"),
  incomeNonAgricultural: integer("income_non_agricultural"),
  incomeRemittances: integer("income_remittances"),
  incomeOther: integer("income_other"),
  incomeOtherDetails: text("income_other_details"),
  // Income perception
  incomePerception: text("income_perception"), // creciendo, estable, consolidando, disminuyendo, en_riesgo
  // Commercialization channels
  sellsToConsumers: boolean("sells_to_consumers").default(false),
  sellsToIntermediaries: boolean("sells_to_intermediaries").default(false),
  sellsToCompanies: boolean("sells_to_companies").default(false),
  sellsToCooperatives: boolean("sells_to_cooperatives").default(false),
  sellsToGovernment: boolean("sells_to_government").default(false),
  sellsOther: text("sells_other"),
  // Sales process
  salesProcess: text("sales_process").array(), // desde_parcela, transporte_personal, contrato, adelantos, pago_mismo_dia
  // Sustainable premium
  receivesSustainablePremium: boolean("receives_sustainable_premium").default(false),
  sustainableBenefits: text("sustainable_benefits").array(), // sobreprecio, preferencia_compra, mercados_especiales, apoyo_tecnico, certificacion, acceso_tiendas, subsidios
  // Perceived benefits
  perceivedBenefits: jsonb("perceived_benefits"), // JSON with benefit types and values
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertLivelihoodSchema = createInsertSchema(livelihood).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertLivelihood = z.infer<typeof insertLivelihoodSchema>;
export type Livelihood = typeof livelihood.$inferSelect;

export const costCategories = [
  "semillas", "fertilizantes", "herbicidas", "insecticidas", "fungicidas", "otros_insumos",
  "mano_obra_siembra", "mano_obra_cosecha", "mano_obra_riego", "mano_obra_fumigacion", "mano_obra_otros",
  "maquinaria_renta", "maquinaria_combustible", "maquinaria_mantenimiento",
  "riego_agua", "riego_energia", "riego_mantenimiento",
  "transporte", "almacenamiento", "empaque",
  "renta_tierra", "seguro_agricola", "asistencia_tecnica", "credito_intereses", "otros_gastos"
] as const;
export type CostCategory = typeof costCategories[number];

export const productionCosts = pgTable("production_costs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parcelId: varchar("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  cycleYear: integer("cycle_year").notNull(),
  cycleSeason: text("cycle_season").notNull(),
  category: text("category").notNull(),
  concept: text("concept").notNull(),
  unit: text("unit"),
  quantity: decimal("quantity", { precision: 10, scale: 2 }),
  unitCost: decimal("unit_cost", { precision: 10, scale: 2 }),
  totalCost: decimal("total_cost", { precision: 10, scale: 2 }).notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertProductionCostSchema = createInsertSchema(productionCosts, {
  cycleYear: z.coerce.number().min(2000).max(2100),
  cycleSeason: z.enum(["primavera-verano", "otono-invierno"]),
  category: z.enum(costCategories),
  totalCost: z.coerce.number().min(0),
  quantity: z.coerce.number().min(0).optional().nullable(),
  unitCost: z.coerce.number().min(0).optional().nullable(),
}).omit({ id: true, createdAt: true });

export type InsertProductionCost = z.infer<typeof insertProductionCostSchema>;
export type ProductionCost = typeof productionCosts.$inferSelect;

// AI Provider options for multi-model support
export const aiProviders = ["openai"] as const;
export type AIProvider = typeof aiProviders[number];

// AI Chat conversations for regenerative recommendations
export const chatConversations = pgTable("chat_conversations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parcelId: varchar("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title"), // Auto-generated from first message
  aiProvider: text("ai_provider").default("openai").notNull(), // openai or sinong
  channel: text("channel").default("web").notNull(), // web | whatsapp
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertChatConversationSchema = createInsertSchema(chatConversations).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertChatConversation = z.infer<typeof insertChatConversationSchema>;
export type ChatConversation = typeof chatConversations.$inferSelect;

// Chat messages within conversations
export const chatMessages = pgTable("chat_messages", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => chatConversations.id, { onDelete: "cascade" }),
  role: text("role").notNull(), // "user" | "assistant"
  content: text("content").notNull(),
  imageUrl: text("image_url"), // Optional attached image (GPT-4 Vision)
  contextSnapshot: jsonb("context_snapshot"), // Snapshot of parcel data when message was sent
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertChatMessageSchema = createInsertSchema(chatMessages).omit({ id: true, createdAt: true });
export type InsertChatMessage = z.infer<typeof insertChatMessageSchema>;
export type ChatMessage = typeof chatMessages.$inferSelect;

// Persistent AI memory per (parcel, user) — compressed summary of past advice
export const parcelMemory = pgTable("parcel_memory", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parcelId: varchar("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  summary: text("summary").notNull().default(""),
  fertilizationPlans: jsonb("fertilization_plans").notNull().default({}),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  parcelUserUnique: uniqueIndex("parcel_memory_parcel_user_unique").on(t.parcelId, t.userId),
}));

export const insertParcelMemorySchema = createInsertSchema(parcelMemory).omit({ id: true, updatedAt: true });
export type InsertParcelMemory = z.infer<typeof insertParcelMemorySchema>;
export type ParcelMemory = typeof parcelMemory.$inferSelect;

// WhatsApp Business links a producer phone to one active AgRegen parcel.
export const whatsappConnections = pgTable("whatsapp_connections", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  parcelId: varchar("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  phoneNumber: text("phone_number").unique(),
  status: text("status").notNull().default("pending"), // pending | verified | revoked
  verificationCodeHash: text("verification_code_hash"),
  verificationExpiresAt: timestamp("verification_expires_at"),
  verifiedAt: timestamp("verified_at"),
  lastMessageAt: timestamp("last_message_at"),
  voicePreference: text("voice_preference").notNull().default("text"), // text | voice
  responseMode: text("response_mode").notNull().default("brief"), // brief | detailed
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  userUnique: uniqueIndex("whatsapp_connections_user_unique").on(t.userId),
}));

export const insertWhatsappConnectionSchema = createInsertSchema(whatsappConnections).omit({
  id: true, createdAt: true, updatedAt: true,
});
export type InsertWhatsappConnection = z.infer<typeof insertWhatsappConnectionSchema>;
export type WhatsappConnection = typeof whatsappConnections.$inferSelect;

// Idempotency ledger for inbound Meta webhook message IDs.
export const whatsappMessageEvents = pgTable("whatsapp_message_events", {
  id: serial("id").primaryKey(),
  providerMessageId: text("provider_message_id").notNull().unique(),
  phoneNumber: text("phone_number").notNull(),
  messageType: text("message_type").notNull(),
  payload: jsonb("payload").notNull(),
  status: text("status").notNull().default("received"), // received | processing | processed | failed
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  lastAttemptAt: timestamp("last_attempt_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  processedAt: timestamp("processed_at"),
  // Side effects (such as ALERTAS SI/NO) are applied at most once even when
  // Meta retries after the response itself could not be delivered.
  effectAppliedAt: timestamp("effect_applied_at"),
  availableAt: timestamp("available_at").defaultNow().notNull(),
  leaseUntil: timestamp("lease_until"),
  stage: text("stage").notNull().default("queued"),
  correlationId: text("correlation_id"),
});

export const insertWhatsappMessageEventSchema = createInsertSchema(whatsappMessageEvents).omit({
  id: true, createdAt: true,
});
export type InsertWhatsappMessageEvent = z.infer<typeof insertWhatsappMessageEventSchema>;
export type WhatsappMessageEvent = typeof whatsappMessageEvents.$inferSelect;

// Outbound ledger.  The deterministic key is retained across retries so a
// worker never intentionally submits the same response twice.
export const whatsappOutboundMessages = pgTable("whatsapp_outbound_messages", {
  id: serial("id").primaryKey(),
  idempotencyKey: text("idempotency_key").notNull().unique(),
  recipient: text("recipient").notNull(),
  bodyHash: text("body_hash").notNull(),
  providerMessageId: text("provider_message_id"),
  status: text("status").notNull().default("pending"), // pending | sent | ambiguous | failed
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  lastAttemptAt: timestamp("last_attempt_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  sentAt: timestamp("sent_at"),
});
export type WhatsappOutboundMessage = typeof whatsappOutboundMessages.$inferSelect;

export const conversationInteractionStates = pgTable("conversation_interaction_states", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => chatConversations.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  parcelId: varchar("parcel_id").references(() => parcels.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // clarification | escalation | follow_up
  status: text("status").notNull().default("pending"),
  sourceMessageId: varchar("source_message_id").references(() => chatMessages.id, { onDelete: "set null" }),
  prompt: text("prompt"),
  payload: jsonb("payload").notNull().default(sql`'{}'::jsonb`),
  dueAt: timestamp("due_at"),
  availableAt: timestamp("available_at").defaultNow().notNull(),
  leaseUntil: timestamp("lease_until"),
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  expiresAt: timestamp("expires_at"),
  resolvedAt: timestamp("resolved_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  dueIdx: index("conversation_interaction_states_due_idx").on(t.status, t.dueAt),
  conversationIdx: index("conversation_interaction_states_conversation_idx").on(t.conversationId, t.status),
  sourceKindUnique: uniqueIndex("conversation_interaction_states_source_kind_unique").on(t.kind, t.sourceMessageId),
}));
export type ConversationInteractionState = typeof conversationInteractionStates.$inferSelect;
export type InsertConversationInteractionState = typeof conversationInteractionStates.$inferInsert;

export const recommendationFeedback = pgTable("recommendation_feedback", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conversationId: varchar("conversation_id").notNull().references(() => chatConversations.id, { onDelete: "cascade" }),
  messageId: varchar("message_id").notNull().references(() => chatMessages.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  parcelId: varchar("parcel_id").references(() => parcels.id, { onDelete: "set null" }),
  rating: text("rating").notNull(), // helpful | not_helpful
  reason: text("reason"),
  outcome: text("outcome"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  messageUserUnique: uniqueIndex("recommendation_feedback_message_user_unique").on(t.messageId, t.userId),
}));
export type RecommendationFeedback = typeof recommendationFeedback.$inferSelect;
export type InsertRecommendationFeedback = typeof recommendationFeedback.$inferInsert;

// Explicit, connection-scoped opt-in for proactive forecast notifications.
// Thresholds are configuration, not observations; delivered alerts always retain
// the forecast date/configuration that caused them.
export const weatherAlertPreferences = pgTable("weather_alert_preferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  connectionId: varchar("connection_id").notNull().references(() => whatsappConnections.id, { onDelete: "cascade" }),
  parcelId: varchar("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  enabled: boolean("enabled").notNull().default(false),
  alertTypes: text("alert_types").array().notNull().default(sql`ARRAY[]::text[]`),
  thresholds: jsonb("thresholds").notNull().default(sql`'{}'::jsonb`),
  timezone: text("timezone").notNull().default("America/Mexico_City"),
  quietHoursStart: text("quiet_hours_start"),
  quietHoursEnd: text("quiet_hours_end"),
  dailyCap: integer("daily_cap").notNull().default(3),
  configVersion: integer("config_version").notNull().default(1),
  lastEvaluatedAt: timestamp("last_evaluated_at"),
  lastSentAt: timestamp("last_sent_at"),
  lastError: text("last_error"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  connectionUnique: uniqueIndex("weather_alert_preferences_connection_unique").on(t.connectionId),
  enabledCheck: check("weather_alert_preferences_daily_cap_check", sql`${t.dailyCap} BETWEEN 1 AND 20`),
}));
export type WeatherAlertPreference = typeof weatherAlertPreferences.$inferSelect;

export const weatherAlertDeliveries = pgTable("weather_alert_deliveries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  connectionId: varchar("connection_id").notNull().references(() => whatsappConnections.id, { onDelete: "cascade" }),
  preferenceId: varchar("preference_id").notNull().references(() => weatherAlertPreferences.id, { onDelete: "cascade" }),
  alertType: text("alert_type").notNull(),
  forecastDate: date("forecast_date").notNull(),
  configVersion: integer("config_version").notNull(),
  status: text("status").notNull().default("pending"), // pending | sending | sent | failed
  attempts: integer("attempts").notNull().default(0),
  lastError: text("last_error"),
  sentAt: timestamp("sent_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  idempotencyUnique: uniqueIndex("weather_alert_deliveries_idempotency_unique")
    .on(t.connectionId, t.alertType, t.forecastDate, t.configVersion),
  statusIdx: index("weather_alert_deliveries_status_idx").on(t.status, t.createdAt),
}));
export type WeatherAlertDelivery = typeof weatherAlertDeliveries.$inferSelect;

// Auditable operational field log. Extracted drafts never become operational
// truth until the producer explicitly confirms them.
export const fieldLogEntries = pgTable("field_log_entries", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  parcelId: varchar("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  cycleDetailId: varchar("cycle_detail_id"),
  sourceProviderMessageId: text("source_provider_message_id").notNull().unique(),
  status: text("status").notNull().default("draft"), // draft | pending | confirmed | corrected | rejected
  originalText: text("original_text").notNull(),
  transcription: text("transcription"),
  activityType: text("activity_type"),
  occurredAt: timestamp("occurred_at"),
  structuredData: jsonb("structured_data").notNull(),
  evidence: jsonb("evidence").notNull().default(sql`'[]'::jsonb`),
  confidence: decimal("confidence", { precision: 4, scale: 3 }),
  missingFields: text("missing_fields").array().notNull().default(sql`ARRAY[]::text[]`),
  currentRevision: integer("current_revision").notNull().default(1),
  confirmedAt: timestamp("confirmed_at"),
  rejectedAt: timestamp("rejected_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
}, (t) => ({
  parcelStatusIdx: index("field_log_entries_parcel_status_idx").on(t.parcelId, t.status),
  statusCheck: check("field_log_entries_status_check", sql`${t.status} IN ('draft','pending','confirmed','corrected','rejected')`),
  cycleDetailFk: foreignKey({
    columns: [t.cycleDetailId],
    foreignColumns: [cropCycleDetail.id],
    name: "field_log_entries_cycle_detail_id_fkey",
  }).onDelete("set null"),
}));

export const fieldLogRevisions = pgTable("field_log_revisions", {
  id: serial("id").primaryKey(),
  entryId: varchar("entry_id").notNull().references(() => fieldLogEntries.id, { onDelete: "cascade" }),
  revision: integer("revision").notNull(),
  status: text("status").notNull(),
  structuredData: jsonb("structured_data").notNull(),
  missingFields: text("missing_fields").array().notNull().default(sql`ARRAY[]::text[]`),
  correctionText: text("correction_text"),
  sourceProviderMessageId: text("source_provider_message_id").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => ({
  entryRevisionUnique: uniqueIndex("field_log_revisions_entry_revision_unique").on(t.entryId, t.revision),
  sourceMessageUnique: uniqueIndex("field_log_revisions_source_message_unique").on(t.sourceProviderMessageId),
  statusCheck: check("field_log_revisions_status_check", sql`${t.status} IN ('draft','pending','confirmed','corrected','rejected')`),
}));

export type FieldLogEntry = typeof fieldLogEntries.$inferSelect;
export type FieldLogRevision = typeof fieldLogRevisions.$inferSelect;

// Shared knowledge base - successful recommendations by crop
export const sharedKnowledge = pgTable("shared_knowledge", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  crop: text("crop").notNull(),
  problemType: text("problem_type").notNull(), // degradacion_suelo, deficiencia_nutrientes, estres_hidrico, etc.
  recommendation: text("recommendation").notNull(),
  successCount: integer("success_count").default(0).notNull(), // How many users found this helpful
  soilContext: jsonb("soil_context"), // Typical soil conditions where this works
  climateContext: jsonb("climate_context"), // Typical climate conditions
  sourceParcelId: varchar("source_parcel_id").references(() => parcels.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSharedKnowledgeSchema = createInsertSchema(sharedKnowledge).omit({ id: true, createdAt: true, updatedAt: true, successCount: true });
export type InsertSharedKnowledge = z.infer<typeof insertSharedKnowledgeSchema>;
export type SharedKnowledge = typeof sharedKnowledge.$inferSelect;

// Community posts
export const postTypes = ["experience", "parcel_results", "question", "tip"] as const;
export type PostType = typeof postTypes[number];

export const communityPosts = pgTable("community_posts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  type: text("type").notNull().default("experience"),
  title: text("title").notNull(),
  content: text("content").notNull(),
  mediaUrls: text("media_urls").array().default([]),
  parcelId: varchar("parcel_id").references(() => parcels.id, { onDelete: "set null" }),
  tags: text("tags").array().default([]),
  likesCount: integer("likes_count").default(0).notNull(),
  commentsCount: integer("comments_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCommunityPostSchema = createInsertSchema(communityPosts, {
  type: z.enum(postTypes).optional(),
  title: z.string().min(3).max(200),
  content: z.string().min(1),
  mediaUrls: z.array(z.string()).optional(),
  tags: z.array(z.string()).optional(),
}).omit({ id: true, createdAt: true, updatedAt: true, likesCount: true, commentsCount: true });
export type InsertCommunityPost = z.infer<typeof insertCommunityPostSchema>;
export type CommunityPost = typeof communityPosts.$inferSelect;

// Community comments
export const communityComments = pgTable("community_comments", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  postId: varchar("post_id").notNull().references(() => communityPosts.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  parentId: varchar("parent_id"),
  likesCount: integer("likes_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertCommunityCommentSchema = createInsertSchema(communityComments, {
  content: z.string().min(1).max(2000),
}).omit({ id: true, createdAt: true, likesCount: true });
export type InsertCommunityComment = z.infer<typeof insertCommunityCommentSchema>;
export type CommunityComment = typeof communityComments.$inferSelect;

// Community likes
export const communityLikes = pgTable("community_likes", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  postId: varchar("post_id").references(() => communityPosts.id, { onDelete: "cascade" }),
  commentId: varchar("comment_id").references(() => communityComments.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// Conferences module
export const conferenceStatuses = ["draft", "published", "archived"] as const;
export type ConferenceStatus = typeof conferenceStatuses[number];

export const conferences = pgTable("conferences", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  title: text("title").notNull(),
  description: text("description").notNull(),
  videoUrl: text("video_url"),
  thumbnailUrl: text("thumbnail_url"),
  speaker: text("speaker"),
  speakerBio: text("speaker_bio"),
  eventDate: timestamp("event_date"),
  tags: text("tags").array().default([]),
  isFeatured: boolean("is_featured").default(false).notNull(),
  status: text("status").notNull().default("draft"),
  viewsCount: integer("views_count").default(0).notNull(),
  createdBy: varchar("created_by").notNull().references(() => users.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertConferenceSchema = createInsertSchema(conferences, {
  title: z.string().min(3).max(300),
  description: z.string().min(10),
  videoUrl: z.string().url().optional().nullable(),
  thumbnailUrl: z.string().optional().nullable(),
  speaker: z.string().optional().nullable(),
  speakerBio: z.string().optional().nullable(),
  eventDate: z.coerce.date().optional().nullable(),
  tags: z.array(z.string()).optional(),
  status: z.enum(conferenceStatuses).optional(),
}).omit({ id: true, createdAt: true, updatedAt: true, viewsCount: true });

export type InsertConference = z.infer<typeof insertConferenceSchema>;
export type Conference = typeof conferences.$inferSelect;

// Forum threads for conference discussions
export const forumThreads = pgTable("forum_threads", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  conferenceId: varchar("conference_id").notNull().references(() => conferences.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  content: text("content").notNull(),
  isPinned: boolean("is_pinned").default(false).notNull(),
  isClosed: boolean("is_closed").default(false).notNull(),
  repliesCount: integer("replies_count").default(0).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertForumThreadSchema = createInsertSchema(forumThreads, {
  title: z.string().min(3).max(300),
  content: z.string().min(1),
}).omit({ id: true, createdAt: true, updatedAt: true, isPinned: true, isClosed: true, repliesCount: true });

export type InsertForumThread = z.infer<typeof insertForumThreadSchema>;
export type ForumThread = typeof forumThreads.$inferSelect;

// Forum replies
export const forumReplies = pgTable("forum_replies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  threadId: varchar("thread_id").notNull().references(() => forumThreads.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  content: text("content").notNull(),
  parentId: varchar("parent_id"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertForumReplySchema = createInsertSchema(forumReplies, {
  content: z.string().min(1).max(5000),
}).omit({ id: true, createdAt: true });

export type InsertForumReply = z.infer<typeof insertForumReplySchema>;
export type ForumReply = typeof forumReplies.$inferSelect;

export const sensorTypes = ["soil_moisture", "temperature", "humidity", "soil_temperature", "ec", "ph", "light", "wind", "rain"] as const;
export type SensorType = typeof sensorTypes[number];

export const iotDevices = pgTable("iot_devices", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parcelId: varchar("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  sensorType: text("sensor_type").notNull(),
  latitude: decimal("latitude", { precision: 10, scale: 7 }),
  longitude: decimal("longitude", { precision: 10, scale: 7 }),
  unit: text("unit"),
  isActive: boolean("is_active").default(true).notNull(),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertIotDeviceSchema = createInsertSchema(iotDevices, {
  name: z.string().min(1).max(100),
  sensorType: z.enum(sensorTypes),
}).omit({ id: true, createdAt: true });

export type InsertIotDevice = z.infer<typeof insertIotDeviceSchema>;
export type IotDevice = typeof iotDevices.$inferSelect;

export const iotReadings = pgTable("iot_readings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  deviceId: varchar("device_id").notNull().references(() => iotDevices.id, { onDelete: "cascade" }),
  value: decimal("value", { precision: 10, scale: 3 }).notNull(),
  timestamp: timestamp("timestamp").defaultNow().notNull(),
});

export const insertIotReadingSchema = createInsertSchema(iotReadings).omit({ id: true });

export type InsertIotReading = z.infer<typeof insertIotReadingSchema>;
export type IotReading = typeof iotReadings.$inferSelect;

export const irrigationLogs = pgTable("irrigation_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parcelId: varchar("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  date: timestamp("date").notNull(),
  volumeLiters: decimal("volume_liters", { precision: 10, scale: 2 }),
  durationMinutes: integer("duration_minutes"),
  method: text("method"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertIrrigationLogSchema = createInsertSchema(irrigationLogs, {
  volumeLiters: z.coerce.number().min(0).optional().nullable(),
  durationMinutes: z.coerce.number().min(0).optional().nullable(),
}).omit({ id: true, createdAt: true });

export type InsertIrrigationLog = z.infer<typeof insertIrrigationLogSchema>;
export type IrrigationLog = typeof irrigationLogs.$inferSelect;

export const droneFlights = pgTable("drone_flights", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parcelId: varchar("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  flightDate: timestamp("flight_date").notNull(),
  indexType: text("index_type"),
  imageUrl: text("image_url"),
  resolution: decimal("resolution_cm", { precision: 6, scale: 2 }),
  notes: text("notes"),
  metadata: jsonb("metadata"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertDroneFlightSchema = createInsertSchema(droneFlights, {
  indexType: z.string().optional().nullable(),
}).omit({ id: true, createdAt: true });

export type InsertDroneFlight = z.infer<typeof insertDroneFlightSchema>;
export type DroneFlight = typeof droneFlights.$inferSelect;

// ─── Manejo Variable por Zonas ──────────────────────────────────────────────

export const masterVariables = pgTable("master_variables", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  code: varchar("code", { length: 20 }).notNull().unique(),
  name: text("name").notNull(),
  unit: text("unit").notNull(),
  minValue: decimal("min_value", { precision: 10, scale: 4 }).notNull(),
  maxValue: decimal("max_value", { precision: 10, scale: 4 }).notNull(),
  optimalMin: decimal("optimal_min", { precision: 10, scale: 4 }),
  optimalMax: decimal("optimal_max", { precision: 10, scale: 4 }),
  defaultCv: decimal("default_cv", { precision: 5, scale: 2 }).default("15.0"),
  description: text("description"),
  protocol: text("protocol"),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertMasterVariableSchema = createInsertSchema(masterVariables, {
  minValue: z.coerce.number(),
  maxValue: z.coerce.number(),
  optimalMin: z.coerce.number().optional().nullable(),
  optimalMax: z.coerce.number().optional().nullable(),
  defaultCv: z.coerce.number().optional().nullable(),
}).omit({ id: true, createdAt: true });

export type InsertMasterVariable = z.infer<typeof insertMasterVariableSchema>;
export type MasterVariable = typeof masterVariables.$inferSelect;

export const samplingCampaignStatuses = ["designing", "active", "completed", "interpolated"] as const;
export type SamplingCampaignStatus = typeof samplingCampaignStatuses[number];

export const gridTypes = ["regular", "hexagonal", "stratified"] as const;
export type GridType = typeof gridTypes[number];

export const samplingCampaigns = pgTable("sampling_campaigns", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parcelId: varchar("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  variableId: varchar("variable_id").notNull().references(() => masterVariables.id),
  name: text("name").notNull(),
  status: text("status").default("designing").notNull(),
  gridType: text("grid_type").default("regular"),
  nPointsPlanned: integer("n_points_planned").notNull(),
  nPointsDone: integer("n_points_done").default(0).notNull(),
  methodUsed: text("method_used"),
  gridGeojson: jsonb("grid_geojson"),
  samplingDepth: decimal("sampling_depth", { precision: 5, scale: 2 }).default("20.0"),
  notes: text("notes"),
  aiInstructions: text("ai_instructions"),
  startedAt: timestamp("started_at"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertSamplingCampaignSchema = createInsertSchema(samplingCampaigns, {
  nPointsPlanned: z.coerce.number().min(3),
  samplingDepth: z.coerce.number().min(1).max(100).optional().nullable(),
  gridType: z.enum(gridTypes).optional(),
  status: z.enum(samplingCampaignStatuses).optional(),
}).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertSamplingCampaign = z.infer<typeof insertSamplingCampaignSchema>;
export type SamplingCampaign = typeof samplingCampaigns.$inferSelect;

export const samplingPoints = pgTable("sampling_points", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  campaignId: varchar("campaign_id").notNull().references(() => samplingCampaigns.id, { onDelete: "cascade" }),
  pointIndex: integer("point_index").notNull(),
  latPlanned: decimal("lat_planned", { precision: 10, scale: 7 }).notNull(),
  lonPlanned: decimal("lon_planned", { precision: 10, scale: 7 }).notNull(),
  latActual: decimal("lat_actual", { precision: 10, scale: 7 }),
  lonActual: decimal("lon_actual", { precision: 10, scale: 7 }),
  value: decimal("value", { precision: 12, scale: 4 }),
  temperatureC: decimal("temperature_c", { precision: 5, scale: 2 }),
  nSubsamples: integer("n_subsamples").default(1),
  soilCondition: text("soil_condition"),
  photoUrl: text("photo_url"),
  notes: text("notes"),
  isOutlier: boolean("is_outlier").default(false),
  capturedAt: timestamp("captured_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertSamplingPointSchema = createInsertSchema(samplingPoints, {
  latPlanned: z.coerce.number(),
  lonPlanned: z.coerce.number(),
  latActual: z.coerce.number().optional().nullable(),
  lonActual: z.coerce.number().optional().nullable(),
  value: z.coerce.number().optional().nullable(),
  temperatureC: z.coerce.number().optional().nullable(),
  nSubsamples: z.coerce.number().min(1).max(20).optional().nullable(),
}).omit({ id: true, createdAt: true });

export type InsertSamplingPoint = z.infer<typeof insertSamplingPointSchema>;
export type SamplingPoint = typeof samplingPoints.$inferSelect;

export const interpolationMethods = ["idw", "kriging", "rbf", "rfk", "cokriging"] as const;
export type InterpolationMethod = typeof interpolationMethods[number];

export const interpolationResults = pgTable("interpolation_results", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  campaignId: varchar("campaign_id").notNull().references(() => samplingCampaigns.id, { onDelete: "cascade" }),
  method: text("method").notNull(),
  rmseCv: decimal("rmse_cv", { precision: 10, scale: 4 }),
  maeCv: decimal("mae_cv", { precision: 10, scale: 4 }),
  r2Cv: decimal("r2_cv", { precision: 6, scale: 4 }),
  variogramModel: text("variogram_model"),
  variogramRange: decimal("variogram_range", { precision: 10, scale: 4 }),
  variogramSill: decimal("variogram_sill", { precision: 10, scale: 4 }),
  variogramNugget: decimal("variogram_nugget", { precision: 10, scale: 4 }),
  variogramLags: jsonb("variogram_lags"),
  rasterUrl: text("raster_url"),
  geojsonUrl: text("geojson_url"),
  paramsJson: jsonb("params_json"),
  gridValues: jsonb("grid_values"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertInterpolationResultSchema = createInsertSchema(interpolationResults, {
  rmseCv: z.coerce.number().optional().nullable(),
  maeCv: z.coerce.number().optional().nullable(),
  r2Cv: z.coerce.number().optional().nullable(),
}).omit({ id: true, createdAt: true });

export type InsertInterpolationResult = z.infer<typeof insertInterpolationResultSchema>;
export type InterpolationResult = typeof interpolationResults.$inferSelect;

export const managementZones = pgTable("management_zones", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // interpolationId is nullable: kriging-derived zones reference the interpolation
  // result that produced them; satellite-derived zones (source='satellite_index')
  // and imported zones (source='imported') link only to the parcel.
  interpolationId: varchar("interpolation_id").references(() => interpolationResults.id, { onDelete: "cascade" }),
  parcelId: varchar("parcel_id").references(() => parcels.id, { onDelete: "cascade" }),
  source: text("source").notNull().default("kriging"), // kriging | satellite_index | imported | drone_index
  zoneSetId: varchar("zone_set_id"), // groups zones generated together (e.g. one satellite run)
  sourceMetadata: jsonb("source_metadata"), // { indexType, imageDate, scaleM, vmin, vmax, method, autoK, ... }
  zoneIndex: integer("zone_index").notNull(),
  zoneLabel: text("zone_label"),
  category: text("category"),
  areaHa: decimal("area_ha", { precision: 10, scale: 4 }),
  valueMean: decimal("value_mean", { precision: 12, scale: 4 }),
  valueStd: decimal("value_std", { precision: 12, scale: 4 }),
  valueMin: decimal("value_min", { precision: 12, scale: 4 }),
  valueMax: decimal("value_max", { precision: 12, scale: 4 }),
  polygonGeojson: jsonb("polygon_geojson").notNull(),
  colorHex: text("color_hex"),
  aiInterpretation: text("ai_interpretation"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (table) => ({
  // Enforce the source domain at the DB level so callers cannot persist
  // arbitrary strings (the storage layer also rejects unknown sources).
  sourceCheck: check("management_zones_source_check",
    sql`${table.source} IN ('kriging', 'satellite_index', 'imported', 'drone_index')`),
  // Each (parcel, zoneSet, zoneIndex) triplet is unique so duplicate
  // satellite runs cannot collide. NULL zone_set_id (legacy kriging rows) is
  // excluded — partial indexes don't allow NULLs in unique scope.
  zoneSetUnique: uniqueIndex("management_zones_zoneset_unique_idx")
    .on(table.parcelId, table.zoneSetId, table.zoneIndex)
    .where(sql`${table.zoneSetId} IS NOT NULL`),
}));

export const insertManagementZoneSchema = createInsertSchema(managementZones, {
  areaHa: z.coerce.number().optional().nullable(),
  valueMean: z.coerce.number().optional().nullable(),
}).omit({ id: true, createdAt: true });

export type InsertManagementZone = z.infer<typeof insertManagementZoneSchema>;
export type ManagementZone = typeof managementZones.$inferSelect;

export const zonePrescriptions = pgTable("zone_prescriptions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  zoneId: varchar("zone_id").notNull().references(() => managementZones.id, { onDelete: "cascade" }),
  amendment: text("amendment").notNull(),
  dosePerHa: decimal("dose_per_ha", { precision: 12, scale: 4 }),
  doseUnit: text("dose_unit"),
  totalDose: decimal("total_dose", { precision: 12, scale: 4 }),
  applicationMethod: text("application_method"),
  timing: text("timing"),
  aiRationale: text("ai_rationale"),
  estimatedCost: decimal("estimated_cost", { precision: 12, scale: 2 }),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertZonePrescriptionSchema = createInsertSchema(zonePrescriptions, {
  dosePerHa: z.coerce.number().optional().nullable(),
  totalDose: z.coerce.number().optional().nullable(),
  estimatedCost: z.coerce.number().optional().nullable(),
}).omit({ id: true, createdAt: true });

export type InsertZonePrescription = z.infer<typeof insertZonePrescriptionSchema>;
export type ZonePrescription = typeof zonePrescriptions.$inferSelect;

// Nutrition & Bioestimulation Calculator
export const productionSystems = ["riego_rodado", "fertirriego"] as const;
export type ProductionSystem = typeof productionSystems[number];

export const nutritionPrograms = pgTable("nutrition_programs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parcelId: varchar("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  name: text("name").notNull(),
  cropName: text("crop_name").notNull(),
  variety: text("variety"),
  productionSystem: text("production_system").notNull().default("riego_rodado"),
  rendimientoMeta: decimal("rendimiento_meta", { precision: 8, scale: 2 }).notNull(),
  superficieHas: decimal("superficie_has", { precision: 8, scale: 2 }).notNull(),
  moo: decimal("moo", { precision: 8, scale: 2 }).default("0"),
  // Snapshots of input data (full JSONB blobs so we can recompute / display history)
  soilData: jsonb("soil_data").notNull(),
  waterData: jsonb("water_data"),
  // Snapshot of computed results (formula, distribution, alerts)
  results: jsonb("results"),
  status: text("status").notNull().default("draft"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertNutritionProgramSchema = createInsertSchema(nutritionPrograms, {
  productionSystem: z.enum(productionSystems),
  rendimientoMeta: z.coerce.number().positive(),
  superficieHas: z.coerce.number().positive(),
  moo: z.coerce.number().min(0).optional().nullable(),
  soilData: z.record(z.any()),
  waterData: z.record(z.any()).optional().nullable(),
  results: z.record(z.any()).optional().nullable(),
}).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertNutritionProgram = z.infer<typeof insertNutritionProgramSchema>;
export type NutritionProgram = typeof nutritionPrograms.$inferSelect;

export const nutritionProgramProducts = pgTable("nutrition_program_products", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  programId: varchar("program_id").notNull().references(() => nutritionPrograms.id, { onDelete: "cascade" }),
  productName: text("product_name").notNull(),
  unit: text("unit").default("kg"),
  totalKgLHa: decimal("total_kg_l_ha", { precision: 10, scale: 3 }).default("0"),
  e1Kg: decimal("e1_kg", { precision: 10, scale: 3 }).default("0"),
  e2Kg: decimal("e2_kg", { precision: 10, scale: 3 }).default("0"),
  e3Kg: decimal("e3_kg", { precision: 10, scale: 3 }).default("0"),
  e4Kg: decimal("e4_kg", { precision: 10, scale: 3 }).default("0"),
  priceUnit: decimal("price_unit", { precision: 10, scale: 2 }).default("0"),
  costHa: decimal("cost_ha", { precision: 12, scale: 2 }).default("0"),
  sortOrder: integer("sort_order").default(0),
});

export const insertNutritionProgramProductSchema = createInsertSchema(nutritionProgramProducts, {
  totalKgLHa: z.coerce.number().min(0).optional().nullable(),
  e1Kg: z.coerce.number().min(0).optional().nullable(),
  e2Kg: z.coerce.number().min(0).optional().nullable(),
  e3Kg: z.coerce.number().min(0).optional().nullable(),
  e4Kg: z.coerce.number().min(0).optional().nullable(),
  priceUnit: z.coerce.number().min(0).optional().nullable(),
  costHa: z.coerce.number().min(0).optional().nullable(),
  sortOrder: z.coerce.number().int().optional().nullable(),
}).omit({ id: true });

export type InsertNutritionProgramProduct = z.infer<typeof insertNutritionProgramProductSchema>;
export type NutritionProgramProduct = typeof nutritionProgramProducts.$inferSelect;

// ── Zone imports (T147): traceability of geometry imports for VRA ────────────
// Each row records one user-uploaded file (KML/KMZ/GeoJSON/CSV/SHP-zip) that was
// turned into management zones. The zoneSetId links back to the resulting
// managementZones rows so we can show "this zone-set came from file X".
export const zoneImports = pgTable("zone_imports", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parcelId: varchar("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  zoneSetId: varchar("zone_set_id"),
  // Para mode = "samples": el id de la SamplingCampaign (nueva o existente) a la
  // que se anexaron los puntos importados, para que el usuario los retome desde
  // el flujo normal de campañas.
  campaignId: varchar("campaign_id"),
  originalFileName: text("original_file_name").notNull(),
  format: text("format").notNull(), // kml | kmz | geojson | csv | shapefile
  mode: text("mode").notNull().default("polygons"), // polygons | voronoi | idw | samples | reference
  featureCount: integer("feature_count").notNull().default(0),
  geometryTypes: text("geometry_types").array(),
  // Para mode = "reference": el FeatureCollection completo (líneas/polígonos)
  // queda guardado como capa visual de referencia consultable desde el mapa.
  referenceGeojson: jsonb("reference_geojson"),
  warnings: jsonb("warnings"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertZoneImportSchema = createInsertSchema(zoneImports).omit({ id: true, createdAt: true });
export type InsertZoneImport = z.infer<typeof insertZoneImportSchema>;
export type ZoneImport = typeof zoneImports.$inferSelect;

// ── Rendimiento y Cosecha por Zona (T153) ────────────────────────────────────
export const yieldRecords = pgTable("yield_records", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parcelId: varchar("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  campaignYear: integer("campaign_year").notNull(),
  crop: text("crop").notNull(),
  harvestDate: timestamp("harvest_date").notNull(),
  yieldTotalTon: decimal("yield_total_ton", { precision: 10, scale: 3 }),
  yieldAvgTonHa: decimal("yield_avg_ton_ha", { precision: 10, scale: 4 }).notNull(),
  yieldByZone: jsonb("yield_by_zone"),
  zoneSetId: varchar("zone_set_id"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertYieldRecordSchema = createInsertSchema(yieldRecords, {
  campaignYear: z.coerce.number().int().min(2000).max(2100),
  crop: z.string().min(1).max(100),
  harvestDate: z.coerce.date(),
  yieldTotalTon: z.coerce.number().min(0).optional().nullable(),
  yieldAvgTonHa: z.coerce.number().min(0),
  yieldByZone: z.record(z.number()).optional().nullable(),
}).omit({ id: true, createdAt: true });

export type InsertYieldRecord = z.infer<typeof insertYieldRecordSchema>;
export type YieldRecord = typeof yieldRecords.$inferSelect;

// ── Aplicaciones de prescripciones (T155) ─────────────────────────────────
// Registra lo que realmente se aplicó vs lo prescrito por zona.
export const prescriptionApplications = pgTable("prescription_applications", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  prescriptionId: varchar("prescription_id").notNull().references(() => zonePrescriptions.id, { onDelete: "cascade" }),
  appliedBy: varchar("applied_by").notNull().references(() => users.id),
  applicationDate: timestamp("application_date").notNull(),
  actualDoseByZone: jsonb("actual_dose_by_zone").notNull(),
  machineUsed: text("machine_used"),
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPrescriptionApplicationSchema = createInsertSchema(prescriptionApplications, {
  applicationDate: z.coerce.date(),
  actualDoseByZone: z.record(z.number()),
  machineUsed: z.string().max(200).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
}).omit({ id: true, createdAt: true });

export type InsertPrescriptionApplication = z.infer<typeof insertPrescriptionApplicationSchema>;
export type PrescriptionApplication = typeof prescriptionApplications.$inferSelect;

// ── Biología del Suelo (T172) ─────────────────────────────────────────────
// Registra propiedades microbianas del suelo: biomasa microbiana de carbono (MBC),
// respiración microbiana (MR), enzimas hidrolíticas (BG, NAG) y ADN metagenómico.
// Basado en metodología espectroscópica (Irving et al. 2026) y análisis de laboratorio.
export const soilBiology = pgTable("soil_biology", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parcelId: varchar("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  userId: varchar("user_id").notNull().references(() => users.id),
  sampleDate: date("sample_date", { mode: "date" }).notNull(),
  depthCm: integer("depth_cm").notNull().default(20),
  dataSource: text("data_source").notNull().default("lab"), // lab | nir | mir | estimated | satellite
  mbc: decimal("mbc", { precision: 10, scale: 2 }),           // μg C g⁻¹ suelo
  mr: decimal("mr", { precision: 10, scale: 3 }),             // μg C g⁻¹ d⁻¹
  bg: decimal("bg", { precision: 10, scale: 2 }),             // nmol g⁻¹ h⁻¹ (β-glucosidasa)
  nag: decimal("nag", { precision: 10, scale: 2 }),           // nmol g⁻¹ h⁻¹ (N-acetil-glucosaminidasa)
  dnaYield: decimal("dna_yield", { precision: 10, scale: 3 }), // μg ADN g⁻¹
  labFolio: text("lab_folio"),
  labName: text("lab_name"),
  microbiologyMethod: text("microbiology_method"),
  trichodermaCfu: decimal("trichoderma_cfu", { precision: 18, scale: 2 }),
  fusariumCfu: decimal("fusarium_cfu", { precision: 18, scale: 2 }),
  bacillusCfu: decimal("bacillus_cfu", { precision: 18, scale: 2 }),
  metarhiziumCfu: decimal("metarhizium_cfu", { precision: 18, scale: 2 }),
  metarhiziumStatus: text("metarhizium_status"),
  beauveriaCfu: decimal("beauveria_cfu", { precision: 18, scale: 2 }),
  beauveriaStatus: text("beauveria_status"),
  nitrogenFixersStatus: text("nitrogen_fixers_status"),
  notes: text("notes"),
  aiInterpretation: text("ai_interpretation"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

const emptyBiologyValue = (value: unknown) => typeof value === "string" && !value.trim() ? null : value;
const optionalBiologyNumber = z.preprocess(emptyBiologyValue, z.coerce.number().finite().min(0).optional().nullable());
export const insertSoilBiologySchema = createInsertSchema(soilBiology, {
  sampleDate: z.coerce.date(),
  depthCm: z.coerce.number().int().min(1).max(200).default(20),
  dataSource: z.enum(["lab", "nir", "mir", "estimated", "satellite"]).default("lab"),
  mbc: optionalBiologyNumber,
  mr: optionalBiologyNumber,
  bg: optionalBiologyNumber,
  nag: optionalBiologyNumber,
  dnaYield: optionalBiologyNumber,
  labFolio: z.string().trim().max(160).optional().nullable(),
  labName: z.string().trim().max(200).optional().nullable(),
  microbiologyMethod: z.string().trim().max(500).optional().nullable(),
  trichodermaCfu: z.preprocess(emptyBiologyValue, z.coerce.number().finite().min(0).max(999999999999999).optional().nullable()),
  fusariumCfu: z.preprocess(emptyBiologyValue, z.coerce.number().finite().min(0).max(999999999999999).optional().nullable()),
  bacillusCfu: z.preprocess(emptyBiologyValue, z.coerce.number().finite().min(0).max(999999999999999).optional().nullable()),
  metarhiziumCfu: z.preprocess(emptyBiologyValue, z.coerce.number().finite().min(0).max(999999999999999).optional().nullable()),
  beauveriaCfu: z.preprocess(emptyBiologyValue, z.coerce.number().finite().min(0).max(999999999999999).optional().nullable()),
  metarhiziumStatus: z.enum(["counted", "not_detected", "not_analyzed"]).optional().nullable(),
  beauveriaStatus: z.enum(["counted", "not_detected", "not_analyzed"]).optional().nullable(),
  nitrogenFixersStatus: z.enum(["detected", "not_detected", "not_analyzed"]).optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
  aiInterpretation: z.string().optional().nullable(),
}).omit({ id: true, createdAt: true }).superRefine((data, ctx) => {
  for (const name of ["metarhizium", "beauveria"] as const) {
    const count = data[`${name}Cfu`], status = data[`${name}Status`];
    if (status === "counted" && count == null)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [`${name}Cfu`], message: "Indica el conteo en UFC/g" });
    if (status && status !== "counted" && count != null)
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [`${name}Cfu`], message: "No detectado/no analizado no equivale a un conteo" });
  }
  if (data.dataSource !== "lab" && [data.trichodermaCfu, data.fusariumCfu, data.bacillusCfu,
      data.metarhiziumCfu, data.beauveriaCfu, data.metarhiziumStatus, data.beauveriaStatus,
      data.nitrogenFixersStatus].some(v => v != null))
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["dataSource"], message: "Los conteos cultivables requieren fuente laboratorio" });
});

export type InsertSoilBiology = z.infer<typeof insertSoilBiologySchema>;
export type SoilBiology = typeof soilBiology.$inferSelect;

// ── Sistema de Seguimiento Integrado (T176) ────────────────────────────────
// Wizard de configuración post-creación, detalle de ciclo económico y
// prompts fenológicos.

// Progreso del wizard de configuración de la parcela (4 pasos)
export const parcelSetupProgress = pgTable("parcel_setup_progress", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parcelId: varchar("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }).unique(),
  stepCycle: boolean("step_cycle").default(false).notNull(),      // Paso 1: ciclo y cultivo
  stepSoil: boolean("step_soil").default(false).notNull(),        // Paso 2: suelo y análisis
  stepEconomy: boolean("step_economy").default(false).notNull(),  // Paso 3: costos y precio objetivo
  stepPractices: boolean("step_practices").default(false).notNull(), // Paso 4: prácticas regenerativas
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertParcelSetupProgressSchema = createInsertSchema(parcelSetupProgress).omit({
  id: true, createdAt: true, updatedAt: true, completedAt: true,
});
export type InsertParcelSetupProgress = z.infer<typeof insertParcelSetupProgressSchema>;
export type ParcelSetupProgress = typeof parcelSetupProgress.$inferSelect;

// Detalle económico del ciclo de cultivo
export const cropCycleDetail = pgTable("crop_cycle_detail", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parcelId: varchar("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  cycleYear: integer("cycle_year").notNull(),
  cycleSeason: text("cycle_season").notNull(), // "primavera-verano" | "otono-invierno"
  variety: text("variety"),                    // variedad/híbrido sembrado
  density: decimal("density", { precision: 8, scale: 2 }),  // kg semilla/ha
  cycleDurationDays: integer("cycle_duration_days"),         // duración estimada del ciclo en días
  estimatedHarvestDate: date("estimated_harvest_date"),      // fecha estimada de cosecha
  expectedYieldTon: decimal("expected_yield_ton", { precision: 10, scale: 2 }),   // tn/ha esperadas
  targetPricePerTon: decimal("target_price_per_ton", { precision: 10, scale: 2 }), // $/tn objetivo
  actualYieldTon: decimal("actual_yield_ton", { precision: 10, scale: 2 }),        // tn/ha reales al cierre
  actualPricePerTon: decimal("actual_price_per_ton", { precision: 10, scale: 2 }), // $/tn real obtenido
  totalPlannedCost: decimal("total_planned_cost", { precision: 12, scale: 2 }),    // $ total planeado
  saleChannel: text("sale_channel"),           // canal de comercialización
  financingType: text("financing_type"),        // tipo de financiamiento
  practicesJson: text("practices_json"),        // JSON array de claves de prácticas regenerativas
  notes: text("notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertCropCycleDetailSchema = createInsertSchema(cropCycleDetail, {
  cycleYear: z.coerce.number().int().min(2000).max(2100),
  cycleSeason: z.enum(["primavera-verano", "otono-invierno"]),
  variety: z.string().max(200).optional().nullable(),
  density: z.coerce.number().min(0).optional().nullable(),
  cycleDurationDays: z.coerce.number().int().min(1).max(730).optional().nullable(),
  estimatedHarvestDate: z.string().optional().nullable(),
  expectedYieldTon: z.coerce.number().min(0).optional().nullable(),
  targetPricePerTon: z.coerce.number().min(0).optional().nullable(),
  actualYieldTon: z.coerce.number().min(0).optional().nullable(),
  actualPricePerTon: z.coerce.number().min(0).optional().nullable(),
  totalPlannedCost: z.coerce.number().min(0).optional().nullable(),
  saleChannel: z.string().max(100).optional().nullable(),
  financingType: z.string().max(100).optional().nullable(),
  practicesJson: z.string().optional().nullable(),
  notes: z.string().max(1000).optional().nullable(),
}).omit({ id: true, createdAt: true, updatedAt: true });

export type InsertCropCycleDetail = z.infer<typeof insertCropCycleDetailSchema>;
export type CropCycleDetail = typeof cropCycleDetail.$inferSelect;

// Prompts fenológicos: tareas sugeridas por etapa
// Amendments calculator snapshot — persists the local calculator state server-side
// so it survives device changes and survives localStorage clears. One row per parcel.
export const amendmentsSnapshots = pgTable("amendments_snapshots", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parcelId: varchar("parcel_id").notNull().unique().references(() => parcels.id, { onDelete: "cascade" }),
  stateJson: text("state_json").notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
export type AmendmentsSnapshot = typeof amendmentsSnapshots.$inferSelect;

export const phenologyPrompts = pgTable("phenology_prompts", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parcelId: varchar("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(),        // etapa fenológica
  promptText: text("prompt_text").notNull(),
  isCompleted: boolean("is_completed").default(false).notNull(),
  dueDate: timestamp("due_date"),
  completedAt: timestamp("completed_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

export const insertPhenologyPromptSchema = createInsertSchema(phenologyPrompts, {
  stage: z.string().min(1),
  promptText: z.string().min(1),
  dueDate: z.coerce.date().optional().nullable(),
}).omit({ id: true, createdAt: true, completedAt: true });

export type InsertPhenologyPrompt = z.infer<typeof insertPhenologyPromptSchema>;
export type PhenologyPrompt = typeof phenologyPrompts.$inferSelect;

// ── Parcel Stage Observations (T250) ──────────────────────────────────────────
// Structured field observations per phenological stage. One record per observation
// session; a stage can have multiple observations over time.
export const parcelStageObservations = pgTable("parcel_stage_observations", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  parcelId: varchar("parcel_id").notNull().references(() => parcels.id, { onDelete: "cascade" }),
  stage: text("stage").notNull(), // one of phenologicalStages values
  observedAt: timestamp("observed_at").notNull().defaultNow(),
  notes: text("notes"),
  avgTemperature: decimal("avg_temperature", { precision: 5, scale: 1 }),  // °C
  precipitationMm: decimal("precipitation_mm", { precision: 7, scale: 2 }), // mm
  ndviObserved: decimal("ndvi_observed", { precision: 5, scale: 4 }),       // 0-1
  photoUrl: text("photo_url"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
}, (t) => [
  index("pso_parcel_id_idx").on(t.parcelId),
  index("pso_stage_idx").on(t.stage),
  index("pso_observed_at_idx").on(t.observedAt),
]);

export const insertParcelStageObservationSchema = createInsertSchema(parcelStageObservations, {
  stage: z.enum(phenologicalStages),
  observedAt: z.coerce.date().optional(),
  avgTemperature: z.coerce.number().min(-60).max(80).optional().nullable(),
  precipitationMm: z.coerce.number().min(0).optional().nullable(),
  ndviObserved: z.coerce.number().min(-1).max(1).optional().nullable(),
}).omit({ id: true, createdAt: true });

export type InsertParcelStageObservation = z.infer<typeof insertParcelStageObservationSchema>;
export type ParcelStageObservation = typeof parcelStageObservations.$inferSelect;

// ── Mexico National Soil Analysis Dataset (INIFAP/SADER) ─────────────────────
// 14,943 geo-referenced soil sampling points covering all Mexican states.
// Source: ESTADOS_ANALISIS_DE_SUELO shapefile (UTM Zone 14N → WGS84 on import).
export const mexicoSoilSamples = pgTable("mexico_soil_samples", {
  id: serial("id").primaryKey(),
  labNumber: text("lab_number"),
  estado: text("estado"),
  municipio: text("municipio"),
  localidad: text("localidad"),
  loteu: text("loteu"),
  lat: decimal("lat", { precision: 12, scale: 8 }).notNull(),
  lng: decimal("lng", { precision: 12, scale: 8 }).notNull(),
  // Chemical parameters
  ph:    decimal("ph",    { precision: 5, scale: 2 }),
  ce:    decimal("ce",    { precision: 8, scale: 4 }),
  dap:   decimal("dap",  { precision: 5, scale: 3 }),
  mo:    decimal("mo",   { precision: 6, scale: 3 }),
  n:     decimal("n",    { precision: 7, scale: 4 }),
  metP:  text("met_p"),
  p:     decimal("p",    { precision: 8, scale: 3 }),
  k:     decimal("k",    { precision: 8, scale: 3 }),
  ca:    decimal("ca",   { precision: 8, scale: 3 }),
  mg:    decimal("mg",   { precision: 8, scale: 3 }),
  fe:    decimal("fe",   { precision: 8, scale: 3 }),
  zn:    decimal("zn",   { precision: 8, scale: 3 }),
  b:     decimal("b",    { precision: 8, scale: 4 }),
  mn:    decimal("mn",   { precision: 8, scale: 3 }),
  cu:    decimal("cu",   { precision: 8, scale: 3 }),
  arcilla: decimal("arcilla", { precision: 5, scale: 2 }),
  limo:    decimal("limo",    { precision: 5, scale: 2 }),
  arena:   decimal("arena",   { precision: 5, scale: 2 }),
  na:    decimal("na",   { precision: 8, scale: 3 }),
  cic:   decimal("cic",  { precision: 8, scale: 3 }),
  textura: text("textura"),
});

export type MexicoSoilSample = typeof mexicoSoilSamples.$inferSelect;

// ── Mexico soil raster persistent cache ───────────────────────────────────────
// Stores the RF+Kriging raster result (PNG + stats) for each (estado, variable)
// pair so it survives server restarts and doesn't need recomputing each time.
export const mexicoSoilRasterCache = pgTable("mexico_soil_raster_cache", {
  estado:   text("estado").notNull(),
  variable: text("variable").notNull(),
  cachedAt: timestamp("cached_at", { withTimezone: true }).notNull().defaultNow(),
  result:   jsonb("result").notNull(),
}, (t) => ({
  pk: primaryKey({ columns: [t.estado, t.variable] }),
}));
