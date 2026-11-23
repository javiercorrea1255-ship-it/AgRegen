import { drizzle } from "drizzle-orm/node-postgres";
import { randomUUID } from "node:crypto";
import pkg from "pg";
const { Pool } = pkg;
import { eq, and, desc, sql, ilike, or, asc, inArray, gte, lte, type SQL } from "drizzle-orm";
import * as schema from "@shared/schema";
import { mexicoDateKey } from "@shared/civil-date";
import type {
  User,
  InsertUser,
  Parcel,
  InsertParcel,
  ParcelData,
  InsertParcelData,
  Alert,
  InsertAlert,
  SoilAnalysis,
  InsertSoilAnalysis,
  WaterAnalysis,
  InsertWaterAnalysis,
  PlantTissueAnalysis,
  InsertPlantTissueAnalysis,
  TillagePractices,
  InsertTillagePractices,
  CropRotation,
  InsertCropRotation,
  AnimalIntegration,
  InsertAnimalIntegration,
  Livelihood,
  InsertLivelihood,
  ChatConversation,
  InsertChatConversation,
  ChatMessage,
  InsertChatMessage,
  SharedKnowledge,
  InsertSharedKnowledge,
  ProductionCost,
  InsertProductionCost,
  CommunityPost,
  InsertCommunityPost,
  CommunityComment,
  InsertCommunityComment,
  Conference,
  InsertConference,
  ForumThread,
  InsertForumThread,
  ForumReply,
  InsertForumReply,
  IotDevice,
  InsertIotDevice,
  IotReading,
  InsertIotReading,
  IrrigationLog,
  InsertIrrigationLog,
  DroneFlight,
  InsertDroneFlight,
  MasterVariable,
  InsertMasterVariable,
  SamplingCampaign,
  InsertSamplingCampaign,
  SamplingPoint,
  InsertSamplingPoint,
  InterpolationResult,
  InsertInterpolationResult,
  ManagementZone,
  InsertManagementZone,
  ZonePrescription,
  InsertZonePrescription,
  NutritionProgram,
  InsertNutritionProgram,
  NutritionProgramProduct,
  InsertNutritionProgramProduct,
  ZoneImport,
  InsertZoneImport,
  YieldRecord,
  InsertYieldRecord,
  PrescriptionApplication,
  InsertPrescriptionApplication,
  SoilBiology,
  InsertSoilBiology,
  ParcelSetupProgress,
  InsertParcelSetupProgress,
  CropCycleDetail,
  InsertCropCycleDetail,
  PhenologyPrompt,
  InsertPhenologyPrompt,
  ParcelStageObservation,
  InsertParcelStageObservation,
  ParcelMemory,
  WhatsappConnection,
  InsertWhatsappConnection,
  WhatsappMessageEvent,
  WhatsappOutboundMessage,
  WeatherAlertPreference,
  WeatherAlertDelivery,
  FieldLogEntry,
} from "@shared/schema";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL!,
});

pool.on("error", (err) => {
  console.error("[pg pool] idle client error — connection terminated unexpectedly:", err.message);
});

export const db = drizzle(pool, { schema });

import type { UserRole } from "@shared/schema";
const DEFAULT_WEATHER_ALERT_TYPES = ["frost", "rain", "wind", "heat"];

export interface PeerMatch {
  userId: string;
  name: string;
  avatarUrl: string | null;
  role: string;
  crop: string;
  avgNdvi: number | null;
  postId: string | null;
  postTitle: string | null;
  postExcerpt: string | null;
}

export interface FieldLogFilters {
  search?: string;
  status?: string;
  activity?: string;
  category?: string;
  cycleDetailId?: string;
  from?: Date;
  to?: Date;
  page?: number;
  limit?: number;
}

export interface FieldLogSummary {
  totalEntries: number;
  statusCounts: Record<string, number>;
  activityCounts: Record<string, number>;
  categoryCounts: Record<string, number>;
  totalsByCurrency: Record<string, number>;
  quantitiesByUnit: Record<string, number>;
}

export interface ConfirmedFieldLogContext {
  period: { from: string; to: string };
  limited: boolean;
  totalConfirmedInPeriod: number;
  events: Array<{
    citation: string;
    id: string;
    occurredAt: string;
    activityType: string;
    items: unknown[];
    observations: string | null;
    confirmedAt: string | null;
    revision: number;
    channel: "WhatsApp" | "Web";
  }>;
}

function buildFieldLogWhere(userId: string, parcelId: string, filters: FieldLogFilters): SQL {
  const conditions: SQL[] = [
    eq(schema.fieldLogEntries.userId, userId),
    eq(schema.fieldLogEntries.parcelId, parcelId),
  ];
  if (filters.status && ["draft", "pending", "confirmed", "corrected", "rejected"].includes(filters.status)) {
    conditions.push(eq(schema.fieldLogEntries.status, filters.status));
  }
  if (filters.activity) conditions.push(ilike(schema.fieldLogEntries.activityType, `%${filters.activity}%`));
  if (filters.cycleDetailId) conditions.push(eq(schema.fieldLogEntries.cycleDetailId, filters.cycleDetailId));
  if (filters.from) conditions.push(gte(schema.fieldLogEntries.occurredAt, filters.from));
  if (filters.to) conditions.push(lte(schema.fieldLogEntries.occurredAt, filters.to));
  if (filters.category) {
    conditions.push(sql`EXISTS (
      SELECT 1 FROM jsonb_array_elements(COALESCE(${schema.fieldLogEntries.structuredData}->'items', '[]'::jsonb)) item
      WHERE item->>'category' = ${filters.category}
    )`);
  }
  if (filters.search?.trim()) {
    const pattern = `%${filters.search.trim()}%`;
    conditions.push(or(
      ilike(schema.fieldLogEntries.activityType, pattern),
      ilike(schema.fieldLogEntries.originalText, pattern),
      sql`${schema.fieldLogEntries.structuredData}::text ILIKE ${pattern}`,
    )!);
  }
  return and(...conditions)!;
}

export interface IStorage {
  // User operations
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  getAllUsers(): Promise<User[]>;
  updateUserRole(id: string, role: UserRole): Promise<User | undefined>;
  updateUserActive(id: string, isActive: boolean): Promise<User | undefined>;
  updateUserAvatar(id: string, avatarUrl: string): Promise<User | undefined>;
  updateUserTechProfile(id: string, profile: { producerType?: string; hasDrones?: boolean; hasIoT?: boolean; techLevel?: string }): Promise<User | undefined>;
  updateUserPassword(id: string, passwordHash: string): Promise<User | undefined>;

  // Parcel operations
  getParcel(id: string): Promise<Parcel | undefined>;
  getParcelsByUser(userId: string): Promise<Parcel[]>;
  getPublicParcels(): Promise<Parcel[]>;
  getAllParcels(): Promise<Parcel[]>;
  createParcel(parcel: InsertParcel): Promise<Parcel>;
  updateParcel(id: string, parcel: Partial<InsertParcel>): Promise<Parcel | undefined>;
  cacheParcelSatelliteNdvi(id: string, ndvi: number, date: string): Promise<void>;
  deleteParcel(id: string): Promise<boolean>;
  updateParcelPolygon(id: string, coordinates: [number, number][], areaHa: number): Promise<Parcel | undefined>;
  deleteParcelPolygon(id: string): Promise<Parcel | undefined>;

  // Parcel Data operations
  getParcelData(parcelId: string, limit?: number): Promise<ParcelData[]>;
  createParcelData(data: InsertParcelData): Promise<ParcelData>;
  saveWhatsappSatelliteSeries(userId: string, parcelId: string, coordinates: unknown,
    observations: { date: string; ndvi: number; imageId: string }[]): Promise<void>;

  // Alert operations
  getAlertById(id: string): Promise<Alert | undefined>;
  getAlertsByParcel(parcelId: string): Promise<Alert[]>;
  getAlertsByUser(userId: string): Promise<Alert[]>;
  createAlert(alert: InsertAlert): Promise<Alert>;
  markAlertAsRead(id: string): Promise<boolean>;
  updateAlertActionStatus(id: string, actionStatus: "applied" | "dismissed"): Promise<boolean>;
  getRecentProactiveAlert(parcelId: string, eventType: string, hoursBack: number): Promise<Alert | undefined>;

  // Soil Analysis operations
  getSoilAnalysisByParcel(parcelId: string): Promise<SoilAnalysis[]>;
  getLatestSoilAnalysis(parcelId: string): Promise<SoilAnalysis | undefined>;
  createSoilAnalysis(analysis: InsertSoilAnalysis): Promise<SoilAnalysis>;
  deleteSoilAnalysis(id: string): Promise<boolean>;

  // Water Analysis operations
  getWaterAnalysisByParcel(parcelId: string): Promise<WaterAnalysis[]>;
  createWaterAnalysis(analysis: InsertWaterAnalysis): Promise<WaterAnalysis>;
  deleteWaterAnalysis(id: string, parcelId: string): Promise<boolean>;

  // Plant Tissue Analysis operations
  getPlantTissueAnalysisByParcel(parcelId: string): Promise<PlantTissueAnalysis[]>;
  createPlantTissueAnalysis(data: InsertPlantTissueAnalysis): Promise<PlantTissueAnalysis>;
  deletePlantTissueAnalysis(id: string, parcelId: string): Promise<boolean>;

  // Tillage Practices operations
  getTillagePracticesByParcel(parcelId: string): Promise<TillagePractices[]>;
  createTillagePractices(data: InsertTillagePractices): Promise<TillagePractices>;
  updateTillagePractices(id: string, data: Partial<InsertTillagePractices>): Promise<TillagePractices | undefined>;
  deleteTillagePractices(id: string): Promise<boolean>;

  // Crop Rotation operations
  getCropRotationByParcel(parcelId: string): Promise<CropRotation[]>;
  createCropRotation(data: InsertCropRotation): Promise<CropRotation>;
  updateCropRotation(id: string, data: Partial<InsertCropRotation>): Promise<CropRotation | undefined>;
  updateCropRotationByOwner(id: string, parcelId: string, data: Partial<InsertCropRotation>): Promise<CropRotation | undefined>;
  deleteCropRotation(id: string): Promise<boolean>;
  deleteCropRotationByOwner(id: string, parcelId: string): Promise<boolean>;

  // Animal Integration operations
  getAnimalIntegrationByParcel(parcelId: string): Promise<AnimalIntegration | undefined>;
  createAnimalIntegration(data: InsertAnimalIntegration): Promise<AnimalIntegration>;
  updateAnimalIntegration(id: string, data: Partial<InsertAnimalIntegration>): Promise<AnimalIntegration | undefined>;

  // Livelihood operations
  getLivelihoodByParcel(parcelId: string): Promise<Livelihood | undefined>;
  createLivelihood(data: InsertLivelihood): Promise<Livelihood>;
  updateLivelihood(id: string, data: Partial<InsertLivelihood>): Promise<Livelihood | undefined>;

  // Chat operations
  getConversationsByParcel(parcelId: string): Promise<ChatConversation[]>;
  getWhatsappConversation(userId: string, parcelId: string): Promise<ChatConversation | undefined>;
  getOrCreateWhatsappConversation(userId: string, parcelId: string): Promise<ChatConversation>;
  getConversation(id: string): Promise<ChatConversation | undefined>;
  createConversation(data: InsertChatConversation): Promise<ChatConversation>;
  updateConversationTitle(id: string, title: string): Promise<ChatConversation | undefined>;
  updateConversationProvider(id: string, aiProvider: string): Promise<ChatConversation | undefined>;
  getMessagesByConversation(conversationId: string): Promise<ChatMessage[]>;
  getRecentMessagesByConversation(conversationId: string, limit?: number): Promise<ChatMessage[]>;
  getMessagesByProviderMessage(conversationId: string, providerMessageId: string): Promise<ChatMessage[]>;
  getMessageInConversation(messageId: string, conversationId: string): Promise<ChatMessage | undefined>;
  createMessage(data: InsertChatMessage): Promise<ChatMessage>;
  updateWhatsappMapMessage(messageId: string, conversationId: string, content: string, snapshot: unknown): Promise<void>;
  getWhatsappMapArtifact(userId: string, parcelId: string, cacheKey: string): Promise<unknown | undefined>;

  // Parcel memory operations
  getParcelMemory(parcelId: string, userId: string): Promise<ParcelMemory | undefined>;
  upsertParcelMemory(parcelId: string, userId: string, summary: string): Promise<ParcelMemory>;
  saveParcelFertilizationPlan(parcelId: string, userId: string, cropKey: string, plan: unknown): Promise<void>;
  clearParcelMemory(parcelId: string, userId: string): Promise<void>;

  // WhatsApp Business operations
  getWhatsappConnectionForUser(userId: string): Promise<WhatsappConnection | undefined>;
  getWhatsappConnectionByPhone(phoneNumber: string): Promise<WhatsappConnection | undefined>;
  createWhatsappConnection(data: InsertWhatsappConnection): Promise<WhatsappConnection>;
  consumePendingWhatsappConnection(codeHash: string, phoneNumber: string): Promise<WhatsappConnection | undefined>;
  updateWhatsappConnectionParcel(userId: string, parcelId: string): Promise<WhatsappConnection | undefined>;
  revokeWhatsappConnection(userId: string): Promise<void>;
  recordWhatsappMessage(connectionId: string): Promise<void>;
  updateWhatsappExperiencePreferences(userId: string, patch: { voicePreference?: "text" | "voice"; responseMode?: "brief" | "detailed" }): Promise<WhatsappConnection | undefined>;
  getOpenInteractionState(conversationId: string, kind: "clarification" | "escalation" | "follow_up", statuses?: string[]): Promise<schema.ConversationInteractionState | undefined>;
  createInteractionState(data: schema.InsertConversationInteractionState): Promise<schema.ConversationInteractionState>;
  resolveInteractionState(id: string, userId: string, status: "resolved" | "cancelled" | "expired", payload?: unknown): Promise<schema.ConversationInteractionState | undefined>;
  updateInteractionState(id: string, userId: string, patch: { status?: string; payload?: unknown; dueAt?: Date | null }): Promise<schema.ConversationInteractionState | undefined>;
  getInteractionStateByProviderMessage(providerMessageId: string, userId: string, kind: "follow_up"): Promise<schema.ConversationInteractionState | undefined>;
  getInteractionStateForUser(id: string, userId: string, kind: "follow_up"): Promise<schema.ConversationInteractionState | undefined>;
  getInteractionStateForUserAnyStatus(id: string, userId: string): Promise<schema.ConversationInteractionState | undefined>;
  listOpenInteractionStates(conversationId: string, kind: "follow_up", statuses: string[]): Promise<schema.ConversationInteractionState[]>;
  listEscalations(status?: string): Promise<schema.ConversationInteractionState[]>;
  claimDueInteractionStates(limit?: number): Promise<schema.ConversationInteractionState[]>;
  completeInteractionState(id: string, status: "sent" | "failed", payload?: unknown): Promise<void>;
  upsertRecommendationFeedback(data: schema.InsertRecommendationFeedback): Promise<schema.RecommendationFeedback>;
  enqueueWhatsappMessage(providerMessageId: string, phoneNumber: string, messageType: string, payload: unknown): Promise<boolean>;
  enqueueWhatsappMessages(messages: Array<{ providerMessageId: string; phoneNumber: string; messageType: string; payload: unknown }>): Promise<number>;
  claimWhatsappMessages(limit?: number, leaseSeconds?: number): Promise<WhatsappMessageEvent[]>;
  takeWhatsappMessage(providerMessageId: string): Promise<WhatsappMessageEvent | undefined>;
  touchWhatsappMessage(providerMessageId: string): Promise<void>;
  getRetryableWhatsappMessages(limit?: number): Promise<WhatsappMessageEvent[]>;
  completeWhatsappMessage(providerMessageId: string, status: "processed" | "failed" | "dead", error?: string): Promise<void>;
  getWhatsappOutbound(idempotencyKey: string): Promise<WhatsappOutboundMessage | undefined>;
  claimWhatsappOutbound(data: { idempotencyKey: string; recipient: string; bodyHash: string }): Promise<{ message: WhatsappOutboundMessage; claimed: boolean }>;
  completeWhatsappOutbound(idempotencyKey: string, providerMessageId: string, status?: "sent" | "ambiguous" | "failed", error?: string): Promise<void>;
  getWeatherAlertPreferenceForUser(userId: string): Promise<WeatherAlertPreference | undefined>;
  saveWeatherAlertPreference(userId: string, data: Omit<WeatherAlertPreference, "id" | "createdAt" | "updatedAt" | "configVersion">): Promise<WeatherAlertPreference | undefined>;
  getActiveWeatherAlertPreferences(): Promise<Array<WeatherAlertPreference & { connection: WhatsappConnection; parcel: Parcel }>>;
  claimWeatherAlertDelivery(data: Pick<WeatherAlertDelivery, "connectionId" | "preferenceId" | "alertType" | "forecastDate" | "configVersion"> & { localDayStart: Date; dailyCap: number }): Promise<WeatherAlertDelivery | undefined>;
  completeWeatherAlertDelivery(id: string, status: "sent" | "failed", error?: string): Promise<void>;
  countWeatherAlertDeliveries(connectionId: string, since: Date): Promise<number>;
  recordWeatherAlertEvaluation(preferenceId: string, result: { sent?: boolean; error?: string | null }): Promise<void>;
  applyWeatherAlertCommand(providerMessageId: string, userId: string, connectionId: string, enabled: boolean): Promise<WeatherAlertPreference | undefined>;
  getPendingFieldLog(userId: string, parcelId: string): Promise<FieldLogEntry | undefined>;
  listFieldLogs(userId: string, parcelId: string, filters?: FieldLogFilters): Promise<{
    entries: FieldLogEntry[];
    total: number;
    page: number;
    limit: number;
    summary: FieldLogSummary;
  }>;
  exportFieldLogs(userId: string, parcelId: string, filters?: FieldLogFilters, limit?: number): Promise<{
    entries: FieldLogEntry[];
    total: number;
    truncated: boolean;
  }>;
  getFieldLogDetail(entryId: string, userId: string): Promise<{
    entry: FieldLogEntry;
    revisions: schema.FieldLogRevision[];
  } | undefined>;
  getActiveFieldLogs(userId: string, parcelId: string): Promise<FieldLogEntry[]>;
  saveAutomaticFieldLog(data: {
    userId: string; parcelId: string; cycleDetailId?: string | null;
    sourceProviderMessageId: string; originalText: string; transcription?: string;
    activityType: string; occurredAt: Date | null; structuredData: unknown; evidence: unknown[];
    confidence?: number | null; missingFields: string[];
  }): Promise<FieldLogEntry>;
  promoteLegacyFieldLogs(userId: string, parcelId: string): Promise<void>;
  getConfirmedFieldLogContext(
    userId: string,
    parcelId: string,
    options?: { from?: Date; to?: Date; limit?: number; query?: string },
  ): Promise<ConfirmedFieldLogContext>;
  getFieldLogBySourceMessage(providerMessageId: string): Promise<FieldLogEntry | undefined>;
  createFieldLogDraft(data: {
    userId: string; parcelId: string; cycleDetailId?: string | null;
    sourceProviderMessageId: string; originalText: string; transcription?: string;
    activityType?: string | null; occurredAt?: Date | null; structuredData: unknown;
    evidence: unknown[]; confidence?: number | null; missingFields: string[];
  }): Promise<FieldLogEntry>;
  reviseFieldLog(entryId: string, userId: string, providerMessageId: string, expectedRevision: number, data: {
    activityType?: string | null; occurredAt?: Date | null; structuredData: unknown;
    confidence?: number | null; missingFields: string[]; correctionText: string; evidence?: unknown[];
  }): Promise<FieldLogEntry>;
  confirmFieldLog(entryId: string, userId: string, providerMessageId: string, expectedRevision?: number): Promise<FieldLogEntry | undefined>;
  rejectFieldLog(entryId: string, userId: string, providerMessageId: string, expectedRevision?: number): Promise<FieldLogEntry | undefined>;

  // Production Costs operations
  getProductionCostsByParcel(parcelId: string): Promise<ProductionCost[]>;
  createProductionCost(data: InsertProductionCost): Promise<ProductionCost>;
  deleteProductionCost(id: string): Promise<boolean>;

  // Shared Knowledge operations
  getSharedKnowledgeByCrop(crop: string, limit?: number): Promise<SharedKnowledge[]>;
  createSharedKnowledge(data: InsertSharedKnowledge): Promise<SharedKnowledge>;
  incrementKnowledgeSuccess(id: string): Promise<void>;

  // Community operations
  getCommunityPosts(options: { limit?: number; offset?: number; tag?: string; type?: string; search?: string; authorId?: string }): Promise<CommunityPost[]>;
  getCommunityPost(id: string): Promise<CommunityPost | undefined>;
  createCommunityPost(data: InsertCommunityPost): Promise<CommunityPost>;
  deleteCommunityPost(id: string): Promise<boolean>;
  getCommunityComments(postId: string): Promise<CommunityComment[]>;
  createCommunityComment(data: InsertCommunityComment): Promise<CommunityComment>;
  deleteCommunityComment(id: string): Promise<boolean>;
  toggleCommunityLike(userId: string, postId?: string, commentId?: string): Promise<boolean>;
  hasUserLiked(userId: string, postId?: string, commentId?: string): Promise<boolean>;
  getUserLikedPostIds(userId: string): Promise<string[]>;
  getCommunityStats(): Promise<any>;
  getPeerMatches(crop: string, excludeUserId: string, limit?: number): Promise<PeerMatch[]>;
  getTopContributors(excludeUserId: string, limit?: number): Promise<PeerMatch[]>;

  // Conference operations
  getConferences(options: { limit?: number; offset?: number; status?: string; tag?: string; search?: string; featured?: boolean }): Promise<Conference[]>;
  getConference(id: string): Promise<Conference | undefined>;
  createConference(data: InsertConference): Promise<Conference>;
  updateConference(id: string, data: Partial<InsertConference>): Promise<Conference | undefined>;
  deleteConference(id: string): Promise<boolean>;
  incrementConferenceViews(id: string): Promise<void>;

  // Forum operations
  getForumThreads(conferenceId: string): Promise<ForumThread[]>;
  getForumThread(id: string): Promise<ForumThread | undefined>;
  createForumThread(data: InsertForumThread): Promise<ForumThread>;
  deleteForumThread(id: string): Promise<boolean>;
  toggleForumThreadClosed(id: string): Promise<ForumThread | undefined>;
  toggleForumThreadPinned(id: string): Promise<ForumThread | undefined>;
  getForumReplies(threadId: string): Promise<ForumReply[]>;
  getForumReply(id: string): Promise<ForumReply | undefined>;
  createForumReply(data: InsertForumReply): Promise<ForumReply>;
  deleteForumReply(id: string): Promise<boolean>;
  getPlatformStats(): Promise<{ users: number; parcels: number; hectares: number; posts: number; conferences: number }>;
  getConferenceThreadCounts(conferenceIds: string[]): Promise<Record<string, number>>;
  getForumParticipants(conferenceId: string): Promise<{ id: string; name: string }[]>;

  // IoT operations
  getIotDevicesByParcel(parcelId: string): Promise<IotDevice[]>;
  createIotDevice(data: InsertIotDevice): Promise<IotDevice>;
  updateIotDeviceByUser(id: string, userId: string, data: Partial<InsertIotDevice>): Promise<IotDevice | undefined>;
  deleteIotDeviceByUser(id: string, userId: string): Promise<boolean>;
  getIotReadings(deviceId: string, limit?: number): Promise<IotReading[]>;
  createIotReading(data: InsertIotReading): Promise<IotReading>;

  // Irrigation operations
  getIrrigationLogsByParcel(parcelId: string): Promise<IrrigationLog[]>;
  createIrrigationLog(data: InsertIrrigationLog): Promise<IrrigationLog>;
  deleteIrrigationLogByUser(id: string, userId: string): Promise<boolean>;

  // Drone flights operations
  getDroneFlightsByParcel(parcelId: string): Promise<DroneFlight[]>;
  createDroneFlight(data: InsertDroneFlight): Promise<DroneFlight>;
  deleteDroneFlightByUser(id: string, userId: string): Promise<boolean>;

  // Variable Management operations
  getMasterVariables(): Promise<MasterVariable[]>;
  getMasterVariable(id: string): Promise<MasterVariable | undefined>;
  getMasterVariableByCode(code: string): Promise<MasterVariable | undefined>;
  createMasterVariable(data: InsertMasterVariable): Promise<MasterVariable>;

  getSamplingCampaignsByParcel(parcelId: string): Promise<SamplingCampaign[]>;
  getSamplingCampaign(id: string): Promise<SamplingCampaign | undefined>;
  createSamplingCampaign(data: InsertSamplingCampaign): Promise<SamplingCampaign>;
  updateSamplingCampaign(id: string, data: Partial<InsertSamplingCampaign>): Promise<SamplingCampaign | undefined>;
  deleteSamplingCampaign(id: string): Promise<boolean>;

  getSamplingPointsByCampaign(campaignId: string): Promise<SamplingPoint[]>;
  getSamplingPoint(id: string): Promise<SamplingPoint | undefined>;
  createSamplingPoint(data: InsertSamplingPoint): Promise<SamplingPoint>;
  updateSamplingPoint(id: string, data: Partial<InsertSamplingPoint>): Promise<SamplingPoint | undefined>;
  bulkCreateSamplingPoints(points: InsertSamplingPoint[]): Promise<SamplingPoint[]>;
  transactionalLabImport(items: { campaign: InsertSamplingCampaign; points: Omit<InsertSamplingPoint, "campaignId">[] }[]): Promise<SamplingCampaign[]>;
  deleteSamplingPoint(id: string): Promise<boolean>;
  deleteSamplingPointsByCampaign(campaignId: string): Promise<number>;

  getInterpolationResultsByCampaign(campaignId: string): Promise<InterpolationResult[]>;
  getInterpolationResult(id: string): Promise<InterpolationResult | undefined>;
  createInterpolationResult(data: InsertInterpolationResult): Promise<InterpolationResult>;

  getManagementZonesByInterpolation(interpolationId: string): Promise<ManagementZone[]>;
  getManagementZonesByParcel(parcelId: string, source?: string): Promise<ManagementZone[]>;
  getManagementZonesByZoneSet(zoneSetId: string): Promise<ManagementZone[]>;
  getManagementZone(id: string): Promise<ManagementZone | undefined>;
  createManagementZone(data: InsertManagementZone): Promise<ManagementZone>;
  updateManagementZone(id: string, data: Partial<InsertManagementZone>): Promise<ManagementZone | undefined>;
  bulkCreateManagementZones(zones: InsertManagementZone[]): Promise<ManagementZone[]>;
  deleteManagementZonesByInterpolation(interpolationId: string): Promise<boolean>;
  deleteManagementZonesByZoneSet(zoneSetId: string): Promise<boolean>;
  replaceManagementZones(interpolationId: string, zones: InsertManagementZone[]): Promise<ManagementZone[]>;

  getZonePrescriptionById(id: string): Promise<ZonePrescription | undefined>;
  getZonePrescriptionsByZone(zoneId: string): Promise<ZonePrescription[]>;
  getZonePrescriptionsByInterpolation(interpolationId: string): Promise<ZonePrescription[]>;
  createZonePrescription(data: InsertZonePrescription): Promise<ZonePrescription>;
  replaceUnappliedZonePrescriptions(prescriptions: InsertZonePrescription[]): Promise<ZonePrescription[] | null>;
  bulkCreateZonePrescriptions(prescriptions: InsertZonePrescription[]): Promise<ZonePrescription[]>;
  deleteZonePrescriptionsByZone(zoneId: string): Promise<boolean>;

  // Nutrition Program operations
  getNutritionProgramsByParcel(parcelId: string): Promise<NutritionProgram[]>;
  getNutritionProgram(id: string): Promise<NutritionProgram | undefined>;
  createNutritionProgram(data: InsertNutritionProgram): Promise<NutritionProgram>;
  updateNutritionProgram(id: string, data: Partial<InsertNutritionProgram>): Promise<NutritionProgram | undefined>;
  deleteNutritionProgram(id: string): Promise<boolean>;
  getNutritionProgramProducts(programId: string): Promise<NutritionProgramProduct[]>;
  getNutritionProgramProduct(id: string): Promise<NutritionProgramProduct | undefined>;
  createNutritionProgramProduct(data: InsertNutritionProgramProduct): Promise<NutritionProgramProduct>;
  updateNutritionProgramProduct(id: string, data: Partial<InsertNutritionProgramProduct>): Promise<NutritionProgramProduct | undefined>;
  deleteNutritionProgramProduct(id: string): Promise<boolean>;
  replaceNutritionProgramProducts(programId: string, items: InsertNutritionProgramProduct[]): Promise<NutritionProgramProduct[]>;

  // Zone Imports (T147)
  createZoneImport(data: InsertZoneImport): Promise<ZoneImport>;
  getZoneImportsByParcel(parcelId: string): Promise<ZoneImport[]>;
  getZoneImport(id: string): Promise<ZoneImport | undefined>;

  // Yield Records (T153)
  getYieldRecordsByParcel(parcelId: string): Promise<YieldRecord[]>;
  createYieldRecord(data: InsertYieldRecord): Promise<YieldRecord>;
  deleteYieldRecord(id: string, userId: string, parcelId?: string): Promise<boolean>;

  // Prescription Applications (T155)
  getPrescriptionApplicationsByPrescription(prescriptionId: string): Promise<PrescriptionApplication[]>;
  createPrescriptionApplication(data: InsertPrescriptionApplication): Promise<PrescriptionApplication>;
  getPrescriptionApplicationsByInterpolation(interpolationId: string): Promise<PrescriptionApplication[]>;

  // Soil Biology (T172)
  getSoilBiologyByParcel(parcelId: string): Promise<SoilBiology[]>;
  getSoilBiology(id: string): Promise<SoilBiology | undefined>;
  createSoilBiology(data: InsertSoilBiology): Promise<SoilBiology>;
  deleteSoilBiology(id: string, userId: string): Promise<boolean>;
  deleteSoilBiologyById(id: string): Promise<boolean>;
  updateSoilBiologyInterpretation(id: string, interpretation: string): Promise<SoilBiology | undefined>;

  // T176: Parcel Setup Progress
  getParcelSetupProgress(parcelId: string): Promise<ParcelSetupProgress | undefined>;
  upsertParcelSetupProgress(parcelId: string, data: Partial<Omit<InsertParcelSetupProgress, "parcelId">>): Promise<ParcelSetupProgress>;

  // T176: Crop Cycle Detail
  getCropCycleDetailById(id: string): Promise<CropCycleDetail | undefined>;
  getCropCycleDetails(parcelId: string): Promise<CropCycleDetail[]>;
  getLatestCropCycleDetail(parcelId: string): Promise<CropCycleDetail | undefined>;
  createCropCycleDetail(data: InsertCropCycleDetail): Promise<CropCycleDetail>;
  upsertCropCycleDetail(data: InsertCropCycleDetail): Promise<CropCycleDetail>;
  updateCropCycleDetail(id: string, data: Partial<InsertCropCycleDetail>): Promise<CropCycleDetail | undefined>;
  deleteCropCycleDetail(id: string): Promise<boolean>;

  // T176: Phenology Prompts
  getPhenologyPrompts(parcelId: string): Promise<PhenologyPrompt[]>;
  getPhenologyPromptById(id: string): Promise<PhenologyPrompt | undefined>;
  createPhenologyPrompt(data: InsertPhenologyPrompt): Promise<PhenologyPrompt>;

  // Amendments snapshots
  upsertAmendmentsSnapshot(parcelId: string, stateJson: string): Promise<void>;
  getAmendmentsSnapshot(parcelId: string): Promise<{ stateJson: string } | null>;
  completePhenologyPrompt(id: string): Promise<PhenologyPrompt | undefined>;
  updatePhenologyPromptDueDate(id: string, dueDate: Date): Promise<PhenologyPrompt | undefined>;
  deletePhenologyPrompt(id: string): Promise<boolean>;

  // T250: Stage Observations
  getStageObservationsByParcel(parcelId: string): Promise<ParcelStageObservation[]>;
  createStageObservation(data: InsertParcelStageObservation): Promise<ParcelStageObservation>;
  deleteStageObservation(id: string, parcelId: string): Promise<boolean>;

  // Mexico Soil Samples (national dataset)
  getMexicoSoilSamples(lat: number, lng: number, radiusKm: number): Promise<schema.MexicoSoilSample[]>;
  getMexicoSoilSampleCount(): Promise<number>;
  getMexicoSoilForInterpolation(variable: string, estado?: string): Promise<{ lat: number; lng: number; value: number; municipio: string | null; estado: string | null }[]>;
  getMexicoSoilInBbox(variable: string, minLat: number, maxLat: number, minLng: number, maxLng: number): Promise<{ lat: number; lng: number; value: number; estado: string | null }[]>;
  getMexicoEstados(): Promise<string[]>;
  // Raster persistent cache
  getMexicoRasterCache(estado: string, variable: string): Promise<Record<string, unknown> | null>;
  setMexicoRasterCache(estado: string, variable: string, result: Record<string, unknown>): Promise<void>;
  getMexicoRasterCacheStatus(): Promise<{ estado: string; variable: string; cachedAt: Date }[]>;
  clearMexicoRasterCache(estado?: string, variable?: string): Promise<number>;
}

/**
 * Converts `InsertManagementZone` (Zod-inferred, which coerces `areaHa` and
 * `valueMean` to `number`) to Drizzle's native `$inferInsert` shape where
 * decimal columns are `string | null | undefined`.
 * This avoids the `as any[]` cast in bulk/transactional insert paths.
 */
const VALID_ZONE_SOURCES = new Set(["kriging", "satellite_index", "imported", "drone_index"]);

function toManagementZoneInsert(
  z: schema.InsertManagementZone,
): typeof schema.managementZones.$inferInsert {
  const source = z.source ?? "kriging";
  // Defense in depth: the DB also has a CHECK constraint, but reject early
  // with a clear message instead of relying on a Postgres error string.
  if (!VALID_ZONE_SOURCES.has(source)) {
    throw new Error(`Invalid management zone source '${source}'. Allowed: kriging | satellite_index | imported`);
  }
  return {
    interpolationId: z.interpolationId ?? null,
    parcelId: z.parcelId ?? null,
    source,
    zoneSetId: z.zoneSetId ?? null,
    sourceMetadata: z.sourceMetadata ?? null,
    zoneIndex: z.zoneIndex,
    zoneLabel: z.zoneLabel ?? null,
    category: z.category ?? null,
    areaHa: z.areaHa != null ? String(z.areaHa) : null,
    valueMean: z.valueMean != null ? String(z.valueMean) : null,
    valueStd: z.valueStd ?? null,
    valueMin: z.valueMin ?? null,
    valueMax: z.valueMax ?? null,
    polygonGeojson: z.polygonGeojson,
    colorHex: z.colorHex ?? null,
    aiInterpretation: z.aiInterpretation ?? null,
  };
}

export class DbStorage implements IStorage {
  // User operations
  async getUser(id: string): Promise<User | undefined> {
    const result = await db.query.users.findFirst({
      where: eq(schema.users.id, id),
    });
    return result;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const result = await db.query.users.findFirst({
      where: eq(schema.users.email, email),
    });
    return result;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(schema.users).values(insertUser).returning();
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    const result = await db.query.users.findMany({
      orderBy: [desc(schema.users.createdAt)],
    });
    return result;
  }

  async updateUserRole(id: string, role: UserRole): Promise<User | undefined> {
    const [user] = await db
      .update(schema.users)
      .set({ role })
      .where(eq(schema.users.id, id))
      .returning();
    return user;
  }

  async updateUserActive(id: string, isActive: boolean): Promise<User | undefined> {
    const [user] = await db
      .update(schema.users)
      .set({ isActive })
      .where(eq(schema.users.id, id))
      .returning();
    return user;
  }

  async updateUserAvatar(id: string, avatarUrl: string): Promise<User | undefined> {
    const [user] = await db
      .update(schema.users)
      .set({ avatarUrl })
      .where(eq(schema.users.id, id))
      .returning();
    return user;
  }

  async updateUserTechProfile(id: string, profile: { producerType?: string; hasDrones?: boolean; hasIoT?: boolean; techLevel?: string }): Promise<User | undefined> {
    const [user] = await db
      .update(schema.users)
      .set(profile)
      .where(eq(schema.users.id, id))
      .returning();
    return user;
  }

  async updateUserPassword(id: string, passwordHash: string): Promise<User | undefined> {
    const [user] = await db
      .update(schema.users)
      .set({ passwordHash })
      .where(eq(schema.users.id, id))
      .returning();
    return user;
  }

  // Parcel operations
  async getParcel(id: string): Promise<Parcel | undefined> {
    const result = await db.query.parcels.findFirst({
      where: eq(schema.parcels.id, id),
    });
    return result;
  }

  async getParcelsByUser(userId: string): Promise<Parcel[]> {
    const result = await db.query.parcels.findMany({
      where: eq(schema.parcels.userId, userId),
      orderBy: [desc(schema.parcels.createdAt)],
    });
    return result;
  }

  async getPublicParcels(): Promise<Parcel[]> {
    const result = await db.query.parcels.findMany({
      where: eq(schema.parcels.isPublic, true),
      orderBy: [desc(schema.parcels.createdAt)],
      limit: 50,
    });
    return result;
  }

  async getAllParcels(): Promise<Parcel[]> {
    const result = await db.query.parcels.findMany({
      orderBy: [desc(schema.parcels.createdAt)],
    });
    return result;
  }

  async getAllParcelsForAdmin(): Promise<Array<Parcel & { ownerName: string; ownerEmail: string; latestNdvi: string | null; latestEvi: string | null; latestSoilMoisture: string | null; latestDataDate: string | null }>> {
    const parcelsWithOwners = await db
      .select({
        parcel: schema.parcels,
        ownerName: schema.users.name,
        ownerEmail: schema.users.email,
      })
      .from(schema.parcels)
      .leftJoin(schema.users, eq(schema.parcels.userId, schema.users.id))
      .orderBy(desc(schema.parcels.createdAt));

    const latestDataResult = await db.execute(sql`
      SELECT DISTINCT ON (parcel_id) parcel_id, date, ndvi, evi, soil_moisture
      FROM parcel_data
      ORDER BY parcel_id, date DESC
    `);

    const latestDataMap = new Map<string, any>();
    for (const row of latestDataResult.rows) {
      latestDataMap.set(row.parcel_id as string, row);
    }

    return parcelsWithOwners.map(({ parcel, ownerName, ownerEmail }) => {
      const ld = latestDataMap.get(parcel.id);
      return {
        ...parcel,
        ownerName: ownerName || "Desconocido",
        ownerEmail: ownerEmail || "",
        latestNdvi: ld?.ndvi ?? null,
        latestEvi: ld?.evi ?? null,
        latestSoilMoisture: ld?.soil_moisture ?? null,
        latestDataDate: ld?.date ? new Date(ld.date).toISOString() : null,
      };
    });
  }

  async createParcel(insertParcel: InsertParcel): Promise<Parcel> {
    const values = {
      ...insertParcel,
      latitude: insertParcel.latitude.toString(),
      longitude: insertParcel.longitude.toString(),
      area: insertParcel.area.toString(),
    };
    const [parcel] = await db.insert(schema.parcels).values(values).returning();
    return parcel;
  }

  async updateParcel(id: string, updateData: Partial<InsertParcel>): Promise<Parcel | undefined> {
    const updates: any = { ...updateData, updatedAt: new Date() };
    if (updateData.latitude) updates.latitude = updateData.latitude.toString();
    if (updateData.longitude) updates.longitude = updateData.longitude.toString();
    if (updateData.area) updates.area = updateData.area.toString();
    
    const [parcel] = await db
      .update(schema.parcels)
      .set(updates)
      .where(eq(schema.parcels.id, id))
      .returning();
    return parcel;
  }

  async updateParcelPolygon(id: string, coordinates: [number, number][], areaHa: number): Promise<Parcel | undefined> {
    const [parcel] = await db
      .update(schema.parcels)
      .set({ polygonCoordinates: coordinates, area: areaHa.toString(), updatedAt: new Date() })
      .where(eq(schema.parcels.id, id))
      .returning();
    return parcel;
  }

  async deleteParcelPolygon(id: string): Promise<Parcel | undefined> {
    const [parcel] = await db
      .update(schema.parcels)
      .set({ polygonCoordinates: null, area: "0", updatedAt: new Date() })
      .where(eq(schema.parcels.id, id))
      .returning();
    return parcel;
  }

  async cacheParcelSatelliteNdvi(id: string, ndvi: number, date: string): Promise<void> {
    await db
      .update(schema.parcels)
      .set({ lastSatelliteNdvi: ndvi.toString(), lastSatelliteNdviDate: date })
      .where(eq(schema.parcels.id, id));
  }

  async deleteParcel(id: string): Promise<boolean> {
    return db.transaction(async tx => {
      const [parcel] = await tx.select({ id: schema.parcels.id }).from(schema.parcels).where(eq(schema.parcels.id, id)).for("update");
      if (!parcel) return false;
      const visits = await tx.select({ id: schema.soilHealthAssessments.id }).from(schema.soilHealthAssessments).where(eq(schema.soilHealthAssessments.parcelId, id)).for("update");
      for (const visit of visits) {
        const photos = await tx.select({ objectPath: schema.soilHealthEvidence.objectPath }).from(schema.soilHealthEvidence).where(eq(schema.soilHealthEvidence.assessmentId, visit.id));
        if (photos.length) await tx.insert(schema.soilHealthObjectCleanup).values(photos).onConflictDoNothing();
      }
      const result = await tx.delete(schema.parcels).where(eq(schema.parcels.id, id));
      return !!result.rowCount;
    });
  }

  // Parcel Data operations
  async getParcelData(parcelId: string, limit?: number): Promise<ParcelData[]> {
    const result = await db.query.parcelData.findMany({
      where: eq(schema.parcelData.parcelId, parcelId),
      orderBy: [desc(schema.parcelData.date)],
      ...(limit !== undefined ? { limit } : {}),
    });
    return result;
  }

  async createParcelData(insertData: InsertParcelData): Promise<ParcelData> {
    const values: any = { ...insertData };
    if (insertData.ndvi !== undefined && insertData.ndvi !== null) values.ndvi = insertData.ndvi.toString();
    if (insertData.evi !== undefined && insertData.evi !== null) values.evi = insertData.evi.toString();
    if (insertData.soilMoisture !== undefined && insertData.soilMoisture !== null) values.soilMoisture = insertData.soilMoisture.toString();
    if (insertData.temperature !== undefined && insertData.temperature !== null) values.temperature = insertData.temperature.toString();
    if (insertData.precipitation !== undefined && insertData.precipitation !== null) values.precipitation = insertData.precipitation.toString();
    
    const [data] = await db.insert(schema.parcelData).values(values).returning();
    return data;
  }

  /** Background context refresh only: no generated advice or outbound alert side effects. */
  async saveWhatsappSatelliteSeries(userId: string, parcelId: string, coordinates: unknown,
    observations: { date: string; ndvi: number; imageId: string }[]): Promise<void> {
    await db.transaction(async tx => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`wa-satellite:${parcelId}`}, 0))`);
      const [parcel] = await tx.select().from(schema.parcels).where(and(
        eq(schema.parcels.id, parcelId), eq(schema.parcels.userId, userId),
      )).for("share");
      if (!parcel || JSON.stringify(parcel.polygonCoordinates) !== JSON.stringify(coordinates)) return;
      const existing = await tx.select({ date: schema.parcelData.date }).from(schema.parcelData)
        .where(and(eq(schema.parcelData.parcelId, parcelId), sql`${schema.parcelData.ndvi} IS NOT NULL`));
      const days = new Set(existing.map(row => row.date.toISOString().slice(0, 10)));
      for (const observation of observations) {
        if (days.has(observation.date)) continue;
        await tx.insert(schema.parcelData).values({
          parcelId, date: new Date(`${observation.date}T12:00:00Z`), ndvi: String(observation.ndvi),
          metadata: { source: "sentinel-2", imageId: observation.imageId,
            cloudMasked: true, refreshOrigin: "whatsapp" },
        });
        days.add(observation.date);
      }
    });
  }

  // Alert operations
  async getAlertById(id: string): Promise<Alert | undefined> {
    const result = await db.query.alerts.findFirst({
      where: eq(schema.alerts.id, id),
    });
    return result;
  }

  async getAlertsByParcel(parcelId: string): Promise<Alert[]> {
    const result = await db.query.alerts.findMany({
      where: eq(schema.alerts.parcelId, parcelId),
      orderBy: [desc(schema.alerts.createdAt)],
    });
    return result;
  }

  async getAlertsByUser(userId: string): Promise<Alert[]> {
    // Get alerts for all parcels owned by the user
    const userParcels = await this.getParcelsByUser(userId);
    const parcelIds = userParcels.map((p) => p.id);

    if (parcelIds.length === 0) {
      return [];
    }

    const result = await db.query.alerts.findMany({
      where: inArray(schema.alerts.parcelId, parcelIds),
      orderBy: [desc(schema.alerts.createdAt)],
      limit: 50,
    });
    return result;
  }

  async createAlert(insertAlert: InsertAlert): Promise<Alert> {
    const [alert] = await db.insert(schema.alerts).values(insertAlert).returning();
    return alert;
  }

  async markAlertAsRead(id: string): Promise<boolean> {
    const result = await db
      .update(schema.alerts)
      .set({ isRead: true })
      .where(eq(schema.alerts.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async updateAlertActionStatus(id: string, actionStatus: "applied" | "dismissed"): Promise<boolean> {
    const result = await db
      .update(schema.alerts)
      .set({ actionStatus, isRead: true })
      .where(eq(schema.alerts.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async getRecentProactiveAlert(parcelId: string, eventType: string, hoursBack: number): Promise<Alert | undefined> {
    const cutoff = new Date(Date.now() - hoursBack * 3600_000);
    const [result] = await db
      .select()
      .from(schema.alerts)
      .where(
        and(
          eq(schema.alerts.parcelId, parcelId),
          eq(schema.alerts.type, "ai_proactive"),
          eq(schema.alerts.eventType, eventType),
          sql`${schema.alerts.createdAt} >= ${cutoff}`
        )
      )
      .orderBy(desc(schema.alerts.createdAt))
      .limit(1);
    return result;
  }

  // Soil Analysis operations
  async getSoilAnalysisByParcel(parcelId: string): Promise<SoilAnalysis[]> {
    const result = await db.query.soilAnalysis.findMany({
      where: eq(schema.soilAnalysis.parcelId, parcelId),
      orderBy: [desc(schema.soilAnalysis.analysisDate)],
    });
    return result;
  }

  async getLatestSoilAnalysis(parcelId: string): Promise<SoilAnalysis | undefined> {
    const result = await db.query.soilAnalysis.findFirst({
      where: eq(schema.soilAnalysis.parcelId, parcelId),
      orderBy: [desc(schema.soilAnalysis.analysisDate)],
    });
    return result;
  }

  async createSoilAnalysis(insertAnalysis: InsertSoilAnalysis): Promise<SoilAnalysis> {
    const [analysis] = await db.insert(schema.soilAnalysis).values({
      ...insertAnalysis, nitrogenTotal: insertAnalysis.nitrogenTotal == null ||
        String(insertAnalysis.nitrogenTotal).trim() === "" ? null : insertAnalysis.nitrogenTotal,
    } as any).returning();
    return analysis;
  }

  async deleteSoilAnalysis(id: string): Promise<boolean> {
    const result = await db.delete(schema.soilAnalysis).where(eq(schema.soilAnalysis.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Water Analysis operations
  async getWaterAnalysisByParcel(parcelId: string): Promise<WaterAnalysis[]> {
    const result = await db.query.waterAnalysis.findMany({
      where: eq(schema.waterAnalysis.parcelId, parcelId),
      orderBy: [desc(schema.waterAnalysis.analysisDate)],
    });
    return result;
  }

  async createWaterAnalysis(insertAnalysis: InsertWaterAnalysis): Promise<WaterAnalysis> {
    const [analysis] = await db.insert(schema.waterAnalysis).values(insertAnalysis as any).returning();
    return analysis;
  }

  async deleteWaterAnalysis(id: string, parcelId: string): Promise<boolean> {
    const result = await db.delete(schema.waterAnalysis).where(
      and(eq(schema.waterAnalysis.id, id), eq(schema.waterAnalysis.parcelId, parcelId))
    );
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Plant Tissue Analysis operations
  async getPlantTissueAnalysisByParcel(parcelId: string): Promise<PlantTissueAnalysis[]> {
    return db.select().from(schema.plantTissueAnalysis)
      .where(eq(schema.plantTissueAnalysis.parcelId, parcelId))
      .orderBy(desc(schema.plantTissueAnalysis.analysisDate));
  }

  async createPlantTissueAnalysis(data: InsertPlantTissueAnalysis): Promise<PlantTissueAnalysis> {
    const [row] = await db.insert(schema.plantTissueAnalysis).values(data as any).returning();
    return row;
  }

  async deletePlantTissueAnalysis(id: string, parcelId: string): Promise<boolean> {
    const result = await db.delete(schema.plantTissueAnalysis).where(
      and(eq(schema.plantTissueAnalysis.id, id), eq(schema.plantTissueAnalysis.parcelId, parcelId))
    );
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Tillage Practices operations
  async getTillagePracticesByParcel(parcelId: string): Promise<TillagePractices[]> {
    const result = await db.query.tillagePractices.findMany({
      where: eq(schema.tillagePractices.parcelId, parcelId),
      orderBy: [desc(schema.tillagePractices.cycleYear)],
    });
    return result;
  }

  async createTillagePractices(data: InsertTillagePractices): Promise<TillagePractices> {
    const [result] = await db.insert(schema.tillagePractices).values(data as any).returning();
    return result;
  }

  async updateTillagePractices(id: string, data: Partial<InsertTillagePractices>): Promise<TillagePractices | undefined> {
    const [result] = await db.update(schema.tillagePractices).set(data as any).where(eq(schema.tillagePractices.id, id)).returning();
    return result;
  }

  async deleteTillagePractices(id: string): Promise<boolean> {
    const result = await db.delete(schema.tillagePractices).where(eq(schema.tillagePractices.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Crop Rotation operations
  async getCropRotationByParcel(parcelId: string): Promise<CropRotation[]> {
    const result = await db.query.cropRotation.findMany({
      where: eq(schema.cropRotation.parcelId, parcelId),
      orderBy: [desc(schema.cropRotation.year)],
    });
    return result;
  }

  async createCropRotation(data: InsertCropRotation): Promise<CropRotation> {
    const [result] = await db.insert(schema.cropRotation).values(data as any).returning();
    return result;
  }

  async updateCropRotation(id: string, data: Partial<InsertCropRotation>): Promise<CropRotation | undefined> {
    const [result] = await db.update(schema.cropRotation).set(data as any).where(eq(schema.cropRotation.id, id)).returning();
    return result;
  }

  async deleteCropRotation(id: string): Promise<boolean> {
    const result = await db.delete(schema.cropRotation).where(eq(schema.cropRotation.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async updateCropRotationByOwner(id: string, parcelId: string, data: Partial<InsertCropRotation>): Promise<CropRotation | undefined> {
    // Build a strictly typed update object without unsafe casts
    const updateValues: Partial<typeof schema.cropRotation.$inferInsert> = {};
    if (data.year !== undefined) updateValues.year = data.year;
    if (data.springCrops !== undefined) updateValues.springCrops = data.springCrops;
    if (data.fallCrops !== undefined) updateValues.fallCrops = data.fallCrops;
    if (data.rotationSystem !== undefined) updateValues.rotationSystem = data.rotationSystem;
    if (data.rotationSystemDetails !== undefined) updateValues.rotationSystemDetails = data.rotationSystemDetails;
    if (data.campaignYear !== undefined) updateValues.campaignYear = data.campaignYear;
    if (data.cropSequence !== undefined) updateValues.cropSequence = data.cropSequence;
    const [result] = await db.update(schema.cropRotation)
      .set(updateValues)
      .where(and(eq(schema.cropRotation.id, id), eq(schema.cropRotation.parcelId, parcelId)))
      .returning();
    return result;
  }

  async deleteCropRotationByOwner(id: string, parcelId: string): Promise<boolean> {
    const result = await db.delete(schema.cropRotation)
      .where(and(eq(schema.cropRotation.id, id), eq(schema.cropRotation.parcelId, parcelId)));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // Animal Integration operations
  async getAnimalIntegrationByParcel(parcelId: string): Promise<AnimalIntegration | undefined> {
    const result = await db.query.animalIntegration.findFirst({
      where: eq(schema.animalIntegration.parcelId, parcelId),
    });
    return result;
  }

  async createAnimalIntegration(data: InsertAnimalIntegration): Promise<AnimalIntegration> {
    const [result] = await db.insert(schema.animalIntegration).values(data as any).returning();
    return result;
  }

  async updateAnimalIntegration(id: string, data: Partial<InsertAnimalIntegration>): Promise<AnimalIntegration | undefined> {
    const [result] = await db.update(schema.animalIntegration).set({ ...data as any, updatedAt: new Date() }).where(eq(schema.animalIntegration.id, id)).returning();
    return result;
  }

  // Livelihood operations
  async getLivelihoodByParcel(parcelId: string): Promise<Livelihood | undefined> {
    const result = await db.query.livelihood.findFirst({
      where: eq(schema.livelihood.parcelId, parcelId),
    });
    return result;
  }

  async createLivelihood(data: InsertLivelihood): Promise<Livelihood> {
    const [result] = await db.insert(schema.livelihood).values(data as any).returning();
    return result;
  }

  async updateLivelihood(id: string, data: Partial<InsertLivelihood>): Promise<Livelihood | undefined> {
    const [result] = await db.update(schema.livelihood).set({ ...data as any, updatedAt: new Date() }).where(eq(schema.livelihood.id, id)).returning();
    return result;
  }

  // Chat operations
  async getConversationsByParcel(parcelId: string): Promise<ChatConversation[]> {
    const result = await db.query.chatConversations.findMany({
      where: eq(schema.chatConversations.parcelId, parcelId),
      orderBy: [desc(schema.chatConversations.updatedAt)],
    });
    return result;
  }

  async getWhatsappConversation(userId: string, parcelId: string): Promise<ChatConversation | undefined> {
    const [result] = await db.select().from(schema.chatConversations)
      .where(and(
        eq(schema.chatConversations.userId, userId),
        eq(schema.chatConversations.parcelId, parcelId),
        eq(schema.chatConversations.channel, "whatsapp"),
      ))
      .orderBy(desc(schema.chatConversations.updatedAt))
      .limit(1);
    return result;
  }

  async getOrCreateWhatsappConversation(userId: string, parcelId: string): Promise<ChatConversation> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`${userId}:${parcelId}:whatsapp`}))`);
      const [existing] = await tx.select().from(schema.chatConversations).where(and(
        eq(schema.chatConversations.userId, userId),
        eq(schema.chatConversations.parcelId, parcelId),
        eq(schema.chatConversations.channel, "whatsapp"),
      )).orderBy(desc(schema.chatConversations.updatedAt)).limit(1);
      if (existing) return existing;
      const [created] = await tx.insert(schema.chatConversations).values({
        userId, parcelId, title: "WhatsApp — consultas del productor", aiProvider: "openai", channel: "whatsapp",
      }).returning();
      return created;
    });
  }

  async getConversation(id: string): Promise<ChatConversation | undefined> {
    const result = await db.query.chatConversations.findFirst({
      where: eq(schema.chatConversations.id, id),
    });
    return result;
  }

  async createConversation(data: InsertChatConversation): Promise<ChatConversation> {
    const [result] = await db.insert(schema.chatConversations).values(data as any).returning();
    return result;
  }

  async updateConversationTitle(id: string, title: string): Promise<ChatConversation | undefined> {
    const [result] = await db.update(schema.chatConversations).set({ title, updatedAt: new Date() }).where(eq(schema.chatConversations.id, id)).returning();
    return result;
  }

  async updateConversationProvider(id: string, aiProvider: string): Promise<ChatConversation | undefined> {
    const [result] = await db.update(schema.chatConversations).set({ aiProvider, updatedAt: new Date() }).where(eq(schema.chatConversations.id, id)).returning();
    return result;
  }

  async getMessagesByConversation(conversationId: string): Promise<ChatMessage[]> {
    const result = await db.query.chatMessages.findMany({
      where: eq(schema.chatMessages.conversationId, conversationId),
      orderBy: [schema.chatMessages.createdAt],
    });
    return result;
  }

  async getRecentMessagesByConversation(conversationId: string, limit = 12): Promise<ChatMessage[]> {
    const result = await db.query.chatMessages.findMany({
      where: eq(schema.chatMessages.conversationId, conversationId),
      orderBy: [desc(schema.chatMessages.createdAt)],
      limit: Math.min(Math.max(limit, 1), 30),
    });
    return result.reverse();
  }

  async getMessagesByProviderMessage(conversationId: string, providerMessageId: string): Promise<ChatMessage[]> {
    return db.select().from(schema.chatMessages).where(and(
      eq(schema.chatMessages.conversationId, conversationId),
      sql`${schema.chatMessages.contextSnapshot}->>'providerMessageId' = ${providerMessageId}`,
    )).orderBy(asc(schema.chatMessages.createdAt));
  }

  async getMessageInConversation(messageId: string, conversationId: string): Promise<ChatMessage | undefined> {
    const [result] = await db.select().from(schema.chatMessages).where(and(
      eq(schema.chatMessages.id, messageId),
      eq(schema.chatMessages.conversationId, conversationId),
    )).limit(1);
    return result;
  }

  async createMessage(data: InsertChatMessage): Promise<ChatMessage> {
    const [result] = await db.insert(schema.chatMessages).values(data as any).returning();
    return result;
  }

  async updateWhatsappMapMessage(messageId: string, conversationId: string, content: string, snapshot: unknown): Promise<void> {
    await db.update(schema.chatMessages).set({ content, contextSnapshot: snapshot })
      .where(and(eq(schema.chatMessages.id, messageId), eq(schema.chatMessages.conversationId, conversationId)));
  }

  async getWhatsappMapArtifact(userId: string, parcelId: string, cacheKey: string): Promise<unknown | undefined> {
    const [row] = await db.select({ snapshot: schema.chatMessages.contextSnapshot })
      .from(schema.chatMessages).innerJoin(schema.chatConversations,
        eq(schema.chatMessages.conversationId, schema.chatConversations.id)).where(and(
        eq(schema.chatConversations.userId, userId), eq(schema.chatConversations.parcelId, parcelId),
        or(sql`${schema.chatMessages.contextSnapshot}->'satelliteArtifact'->>'cacheKey' = ${cacheKey}`,
          sql`${schema.chatMessages.contextSnapshot}->'satelliteArtifact'->>'renderKey' = ${cacheKey}`),
      )).orderBy(desc(schema.chatMessages.createdAt)).limit(1);
    return (row?.snapshot as any)?.satelliteArtifact;
  }

  // Parcel memory operations
  async getParcelMemory(parcelId: string, userId: string): Promise<ParcelMemory | undefined> {
    const [result] = await db
      .select()
      .from(schema.parcelMemory)
      .where(and(eq(schema.parcelMemory.parcelId, parcelId), eq(schema.parcelMemory.userId, userId)))
      .limit(1);
    return result;
  }

  async upsertParcelMemory(parcelId: string, userId: string, summary: string): Promise<ParcelMemory> {
    const [result] = await db
      .insert(schema.parcelMemory)
      .values({ parcelId, userId, summary })
      .onConflictDoUpdate({
        target: [schema.parcelMemory.parcelId, schema.parcelMemory.userId],
        set: { summary, updatedAt: new Date() },
      })
      .returning();
    return result;
  }

  async clearParcelMemory(parcelId: string, userId: string): Promise<void> {
    await db
      .delete(schema.parcelMemory)
      .where(and(eq(schema.parcelMemory.parcelId, parcelId), eq(schema.parcelMemory.userId, userId)));
  }

  async saveParcelFertilizationPlan(parcelId: string, userId: string, cropKey: string, plan: unknown): Promise<void> {
    await db.insert(schema.parcelMemory).values({ parcelId, userId,
      fertilizationPlans: { [cropKey]: plan } }).onConflictDoUpdate({
      target: [schema.parcelMemory.parcelId, schema.parcelMemory.userId],
      set: { fertilizationPlans: sql`coalesce(${schema.parcelMemory.fertilizationPlans}, '{}'::jsonb) ||
        ${JSON.stringify({ [cropKey]: plan })}::jsonb`, updatedAt: new Date() },
    });
  }

  // WhatsApp Business operations
  async getWhatsappConnectionForUser(userId: string): Promise<WhatsappConnection | undefined> {
    const [result] = await db.select().from(schema.whatsappConnections)
      .where(eq(schema.whatsappConnections.userId, userId)).limit(1);
    return result;
  }

  async getWhatsappConnectionByPhone(phoneNumber: string): Promise<WhatsappConnection | undefined> {
    const [result] = await db.select().from(schema.whatsappConnections)
      .where(and(
        eq(schema.whatsappConnections.phoneNumber, phoneNumber),
        eq(schema.whatsappConnections.status, "verified"),
      )).limit(1);
    return result;
  }

  async createWhatsappConnection(data: InsertWhatsappConnection): Promise<WhatsappConnection> {
    return db.transaction(async (tx) => {
    const [result] = await tx.insert(schema.whatsappConnections)
      .values(data as any)
      .onConflictDoUpdate({
        target: schema.whatsappConnections.userId,
        set: {
          parcelId: data.parcelId,
          phoneNumber: null,
          status: "pending",
          verificationCodeHash: data.verificationCodeHash,
          verificationExpiresAt: data.verificationExpiresAt,
          verifiedAt: null,
          updatedAt: new Date(),
        },
      })
      .returning();
    await tx.update(schema.weatherAlertPreferences).set({
      enabled: false, configVersion: sql`${schema.weatherAlertPreferences.configVersion} + 1`, updatedAt: new Date(),
    }).where(eq(schema.weatherAlertPreferences.connectionId, result.id));
    return result;
    });
  }

  async consumePendingWhatsappConnection(codeHash: string, phoneNumber: string): Promise<WhatsappConnection | undefined> {
    return db.transaction(async (tx) => {
    const [result] = await tx.update(schema.whatsappConnections)
      .set({
        phoneNumber,
        status: "verified",
        verificationCodeHash: null,
        verificationExpiresAt: null,
        verifiedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.whatsappConnections.verificationCodeHash, codeHash),
        eq(schema.whatsappConnections.status, "pending"),
        sql`${schema.whatsappConnections.verificationExpiresAt} > NOW()`,
      ))
      .returning();
    if (result) await tx.update(schema.weatherAlertPreferences).set({
      enabled: false, configVersion: sql`${schema.weatherAlertPreferences.configVersion} + 1`, updatedAt: new Date(),
    }).where(eq(schema.weatherAlertPreferences.connectionId, result.id));
    return result;
    });
  }

  async updateWhatsappConnectionParcel(userId: string, parcelId: string): Promise<WhatsappConnection | undefined> {
    return await db.transaction(async (tx) => {
      const [result] = await tx.update(schema.whatsappConnections)
        .set({ parcelId, updatedAt: new Date() })
        .where(and(
          eq(schema.whatsappConnections.userId, userId),
          eq(schema.whatsappConnections.status, "verified"),
        ))
        .returning();
      if (result) {
        await tx.update(schema.weatherAlertPreferences).set({
          parcelId,
          enabled: false,
          configVersion: sql`${schema.weatherAlertPreferences.configVersion} + 1`,
          lastError: null,
          updatedAt: new Date(),
        }).where(eq(schema.weatherAlertPreferences.connectionId, result.id));
      }
      return result;
    });
  }

  async revokeWhatsappConnection(userId: string): Promise<void> {
    await db.transaction(async (tx) => {
    const [connection] = await tx.update(schema.whatsappConnections)
      .set({ status: "revoked", phoneNumber: null, updatedAt: new Date() })
      .where(eq(schema.whatsappConnections.userId, userId)).returning();
    if (connection) await tx.update(schema.weatherAlertPreferences).set({
      enabled: false, configVersion: sql`${schema.weatherAlertPreferences.configVersion} + 1`, updatedAt: new Date(),
    }).where(eq(schema.weatherAlertPreferences.connectionId, connection.id));
    });
  }

  async recordWhatsappMessage(connectionId: string): Promise<void> {
    await db.update(schema.whatsappConnections)
      .set({ lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.whatsappConnections.id, connectionId));
  }

  async updateWhatsappExperiencePreferences(userId: string, patch: { voicePreference?: "text" | "voice"; responseMode?: "brief" | "detailed" }): Promise<WhatsappConnection | undefined> {
    const [result] = await db.update(schema.whatsappConnections).set({ ...patch, updatedAt: new Date() })
      .where(and(eq(schema.whatsappConnections.userId, userId), eq(schema.whatsappConnections.status, "verified")))
      .returning();
    return result;
  }

  async getOpenInteractionState(conversationId: string, kind: "clarification" | "escalation" | "follow_up", statuses = ["pending", "scheduled", "sent"]): Promise<schema.ConversationInteractionState | undefined> {
    const [result] = await db.select().from(schema.conversationInteractionStates).where(and(
      eq(schema.conversationInteractionStates.conversationId, conversationId),
      eq(schema.conversationInteractionStates.kind, kind),
      inArray(schema.conversationInteractionStates.status, statuses),
      or(sql`${schema.conversationInteractionStates.expiresAt} IS NULL`, sql`${schema.conversationInteractionStates.expiresAt} > NOW()`),
    )).orderBy(desc(schema.conversationInteractionStates.createdAt)).limit(1);
    return result;
  }

  async createInteractionState(data: schema.InsertConversationInteractionState): Promise<schema.ConversationInteractionState> {
    const [result] = await db.insert(schema.conversationInteractionStates).values(data).onConflictDoNothing().returning();
    if (result) return result;
    if (data.sourceMessageId) {
      const [existing] = await db.select().from(schema.conversationInteractionStates).where(and(
        eq(schema.conversationInteractionStates.kind, data.kind),
        eq(schema.conversationInteractionStates.sourceMessageId, data.sourceMessageId),
      )).limit(1);
      if (existing) return existing;
    }
    throw new Error("No se pudo crear el estado de interacción");
  }

  async resolveInteractionState(id: string, userId: string, status: "resolved" | "cancelled" | "expired", payload?: unknown): Promise<schema.ConversationInteractionState | undefined> {
    const [result] = await db.update(schema.conversationInteractionStates).set({
      status, ...(payload === undefined ? {} : { payload }), resolvedAt: new Date(), updatedAt: new Date(),
    }).where(and(
      eq(schema.conversationInteractionStates.id, id),
      eq(schema.conversationInteractionStates.userId, userId),
      inArray(schema.conversationInteractionStates.status, ["pending", "scheduled", "sent"]),
    )).returning();
    return result;
  }

  async updateInteractionState(id: string, userId: string, patch: { status?: string; payload?: unknown; dueAt?: Date | null }): Promise<schema.ConversationInteractionState | undefined> {
    const [result] = await db.update(schema.conversationInteractionStates).set({ ...patch, updatedAt: new Date() })
      .where(and(eq(schema.conversationInteractionStates.id, id), eq(schema.conversationInteractionStates.userId, userId)))
      .returning();
    return result;
  }

  async getInteractionStateByProviderMessage(providerMessageId: string, userId: string, kind: "follow_up"): Promise<schema.ConversationInteractionState | undefined> {
    const [result] = await db.select().from(schema.conversationInteractionStates).where(and(
      eq(schema.conversationInteractionStates.userId, userId),
      eq(schema.conversationInteractionStates.kind, kind),
      sql`${schema.conversationInteractionStates.payload}->>'providerMessageId' = ${providerMessageId}`,
      inArray(schema.conversationInteractionStates.status, ["sent", "sending"]),
    )).limit(1);
    return result;
  }

  async getInteractionStateForUser(id: string, userId: string, kind: "follow_up"): Promise<schema.ConversationInteractionState | undefined> {
    const [result] = await db.select().from(schema.conversationInteractionStates).where(and(
      eq(schema.conversationInteractionStates.id, id),
      eq(schema.conversationInteractionStates.userId, userId),
      eq(schema.conversationInteractionStates.kind, kind),
      eq(schema.conversationInteractionStates.status, "sent"),
    )).limit(1);
    return result;
  }

  async getInteractionStateForUserAnyStatus(id: string, userId: string): Promise<schema.ConversationInteractionState | undefined> {
    const [result] = await db.select().from(schema.conversationInteractionStates).where(and(
      eq(schema.conversationInteractionStates.id, id),
      eq(schema.conversationInteractionStates.userId, userId),
    )).limit(1);
    return result;
  }

  async listOpenInteractionStates(conversationId: string, kind: "follow_up", statuses: string[]): Promise<schema.ConversationInteractionState[]> {
    return db.select().from(schema.conversationInteractionStates).where(and(
      eq(schema.conversationInteractionStates.conversationId, conversationId),
      eq(schema.conversationInteractionStates.kind, kind),
      inArray(schema.conversationInteractionStates.status, statuses),
    )).orderBy(desc(schema.conversationInteractionStates.updatedAt)).limit(20);
  }

  async listEscalations(status = "pending"): Promise<schema.ConversationInteractionState[]> {
    return db.select().from(schema.conversationInteractionStates).where(and(
      eq(schema.conversationInteractionStates.kind, "escalation"),
      eq(schema.conversationInteractionStates.status, status),
    )).orderBy(asc(schema.conversationInteractionStates.createdAt)).limit(200);
  }

  async claimDueInteractionStates(limit = 20): Promise<schema.ConversationInteractionState[]> {
    return db.transaction(async (tx) => {
      const locked = await tx.execute(sql`
        SELECT id FROM conversation_interaction_states
        WHERE kind = 'follow_up' AND attempts < 5 AND available_at <= NOW()
          AND (
            (status IN ('scheduled','failed') AND due_at <= NOW())
            OR (status = 'sending' AND lease_until < NOW())
          )
          AND (expires_at IS NULL OR expires_at > NOW())
        ORDER BY due_at FOR UPDATE SKIP LOCKED LIMIT ${Math.min(100, Math.max(1, limit))}
      `);
      const ids = locked.rows.map((row) => String(row.id));
      if (!ids.length) return [];
      return tx.update(schema.conversationInteractionStates).set({
        status: "sending", attempts: sql`${schema.conversationInteractionStates.attempts} + 1`,
        leaseUntil: sql`NOW() + INTERVAL '5 minutes'`, updatedAt: new Date(),
      })
        .where(inArray(schema.conversationInteractionStates.id, ids)).returning();
    });
  }

  async completeInteractionState(id: string, status: "sent" | "failed", payload?: unknown): Promise<void> {
    await db.update(schema.conversationInteractionStates).set({
      status, ...(payload === undefined ? {} : { payload }),
      leaseUntil: null,
      availableAt: status === "failed" ? sql`NOW() + INTERVAL '5 minutes'` : new Date(),
      lastError: status === "failed" && payload && typeof payload === "object" ? String((payload as any).error || "send failed") : null,
      updatedAt: new Date(),
    }).where(eq(schema.conversationInteractionStates.id, id));
  }

  async upsertRecommendationFeedback(data: schema.InsertRecommendationFeedback): Promise<schema.RecommendationFeedback> {
    const [result] = await db.insert(schema.recommendationFeedback).values(data)
      .onConflictDoUpdate({
        target: [schema.recommendationFeedback.messageId, schema.recommendationFeedback.userId],
        set: { rating: data.rating, reason: data.reason, outcome: data.outcome, updatedAt: new Date() },
      }).returning();
    return result;
  }

  async getWeatherAlertPreferenceForUser(userId: string): Promise<WeatherAlertPreference | undefined> {
    const [result] = await db.select({ preference: schema.weatherAlertPreferences })
      .from(schema.weatherAlertPreferences)
      .innerJoin(schema.whatsappConnections, eq(schema.weatherAlertPreferences.connectionId, schema.whatsappConnections.id))
      .where(eq(schema.whatsappConnections.userId, userId)).limit(1);
    return result?.preference;
  }

  async saveWeatherAlertPreference(userId: string, data: Omit<WeatherAlertPreference, "id" | "createdAt" | "updatedAt" | "configVersion">): Promise<WeatherAlertPreference | undefined> {
    const connection = await this.getWhatsappConnectionForUser(userId);
    if (!connection || connection.id !== data.connectionId || connection.parcelId !== data.parcelId) return undefined;
    const [result] = await db.insert(schema.weatherAlertPreferences).values(data as any)
      .onConflictDoUpdate({
        target: schema.weatherAlertPreferences.connectionId,
        set: {
          parcelId: data.parcelId, enabled: data.enabled, alertTypes: data.alertTypes,
          thresholds: data.thresholds, timezone: data.timezone,
          quietHoursStart: data.quietHoursStart, quietHoursEnd: data.quietHoursEnd,
          dailyCap: data.dailyCap,
          configVersion: sql`${schema.weatherAlertPreferences.configVersion} + 1`,
          updatedAt: new Date(),
        },
      }).returning();
    return result;
  }

  async getActiveWeatherAlertPreferences(): Promise<Array<WeatherAlertPreference & { connection: WhatsappConnection; parcel: Parcel }>> {
    const rows = await db.select({
      preference: schema.weatherAlertPreferences, connection: schema.whatsappConnections, parcel: schema.parcels,
    }).from(schema.weatherAlertPreferences)
      .innerJoin(schema.whatsappConnections, eq(schema.weatherAlertPreferences.connectionId, schema.whatsappConnections.id))
      .innerJoin(schema.parcels, eq(schema.weatherAlertPreferences.parcelId, schema.parcels.id))
      .where(and(eq(schema.weatherAlertPreferences.enabled, true), eq(schema.whatsappConnections.status, "verified")));
    return rows.filter((row) => row.connection.userId === row.parcel.userId)
      .map((row) => ({ ...row.preference, connection: row.connection, parcel: row.parcel }));
  }

  async claimWeatherAlertDelivery(data: Pick<WeatherAlertDelivery, "connectionId" | "preferenceId" | "alertType" | "forecastDate" | "configVersion"> & { localDayStart: Date; dailyCap: number }): Promise<WeatherAlertDelivery | undefined> {
    return db.transaction(async (tx) => {
      // Serializes every reservation for this preference across sweep replicas.
      const lock = await tx.execute(sql`
        SELECT p.id FROM weather_alert_preferences p
        JOIN whatsapp_connections c ON c.id = p.connection_id
        WHERE p.id = ${data.preferenceId} AND p.connection_id = ${data.connectionId}
          AND p.enabled = true AND p.config_version = ${data.configVersion}
          AND p.parcel_id = c.parcel_id AND c.status = 'verified' AND c.phone_number IS NOT NULL
        FOR UPDATE OF p, c`);
      if (!lock.rows.length) return undefined;
      const [candidate] = await tx.select().from(schema.weatherAlertDeliveries).where(and(
        eq(schema.weatherAlertDeliveries.connectionId, data.connectionId), eq(schema.weatherAlertDeliveries.alertType, data.alertType),
        eq(schema.weatherAlertDeliveries.forecastDate, data.forecastDate), eq(schema.weatherAlertDeliveries.configVersion, data.configVersion),
      )).limit(1);
      const reclaimable = candidate && candidate.attempts < 5 && (candidate.status === "failed" || candidate.status === "sending")
        && candidate.updatedAt <= new Date(Date.now() - 10 * 60_000);
      if (candidate && !reclaimable) return undefined; // sent is never reclaimed.
      const [active] = await tx.select({ count: sql<number>`count(*)::int` }).from(schema.weatherAlertDeliveries).where(and(
        eq(schema.weatherAlertDeliveries.connectionId, data.connectionId),
        sql`COALESCE(${schema.weatherAlertDeliveries.sentAt}, ${schema.weatherAlertDeliveries.updatedAt}) >= ${data.localDayStart}`,
        inArray(schema.weatherAlertDeliveries.status, ["sending", "sent"]),
        ...(candidate ? [sql`${schema.weatherAlertDeliveries.id} <> ${candidate.id}`] : []),
      ));
      if ((active?.count || 0) >= data.dailyCap) return undefined;
      if (reclaimable) {
        const [result] = await tx.update(schema.weatherAlertDeliveries).set({
          status: "sending", attempts: sql`${schema.weatherAlertDeliveries.attempts} + 1`, lastError: null, updatedAt: new Date(),
        }).where(eq(schema.weatherAlertDeliveries.id, candidate.id)).returning();
        return result;
      }
      const [result] = await tx.insert(schema.weatherAlertDeliveries).values({
        connectionId: data.connectionId, preferenceId: data.preferenceId, alertType: data.alertType,
        forecastDate: data.forecastDate, configVersion: data.configVersion, status: "sending", attempts: 1,
      }).returning();
      return result;
    });
  }

  async completeWeatherAlertDelivery(id: string, status: "sent" | "failed", error?: string): Promise<void> {
    await db.update(schema.weatherAlertDeliveries).set({
      status, lastError: error || null, sentAt: status === "sent" ? new Date() : null, updatedAt: new Date(),
    }).where(eq(schema.weatherAlertDeliveries.id, id));
  }

  async countWeatherAlertDeliveries(connectionId: string, since: Date): Promise<number> {
    const [result] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.weatherAlertDeliveries)
      .where(and(eq(schema.weatherAlertDeliveries.connectionId, connectionId),
        eq(schema.weatherAlertDeliveries.status, "sent"), gte(schema.weatherAlertDeliveries.sentAt, since)));
    return result?.count || 0;
  }

  async recordWeatherAlertEvaluation(preferenceId: string, result: { sent?: boolean; error?: string | null }): Promise<void> {
    await db.update(schema.weatherAlertPreferences).set({
      lastEvaluatedAt: new Date(),
      ...(result.sent ? { lastSentAt: new Date() } : {}),
      lastError: result.error ?? null,
      updatedAt: new Date(),
    }).where(eq(schema.weatherAlertPreferences.id, preferenceId));
  }

  async applyWeatherAlertCommand(providerMessageId: string, userId: string, connectionId: string, enabled: boolean): Promise<WeatherAlertPreference | undefined> {
    return db.transaction(async (tx) => {
      const [connection] = await tx.select().from(schema.whatsappConnections).where(and(
        eq(schema.whatsappConnections.id, connectionId), eq(schema.whatsappConnections.userId, userId),
        eq(schema.whatsappConnections.status, "verified"),
      )).limit(1);
      if (!connection) return undefined;
      const [effect] = await tx.update(schema.whatsappMessageEvents).set({ effectAppliedAt: new Date() })
        .where(and(eq(schema.whatsappMessageEvents.providerMessageId, providerMessageId), sql`${schema.whatsappMessageEvents.effectAppliedAt} IS NULL`))
        .returning();
      if (!effect) return undefined;
      const [current] = await tx.select().from(schema.weatherAlertPreferences)
        .where(eq(schema.weatherAlertPreferences.connectionId, connectionId)).limit(1);
      const values = {
        connectionId, parcelId: connection.parcelId, enabled,
        alertTypes: current?.alertTypes || DEFAULT_WEATHER_ALERT_TYPES, thresholds: current?.thresholds || {},
        timezone: current?.timezone || "America/Mexico_City", quietHoursStart: current?.quietHoursStart || null,
        quietHoursEnd: current?.quietHoursEnd || null, dailyCap: current?.dailyCap || 3,
      };
      const [result] = await tx.insert(schema.weatherAlertPreferences).values(values as any).onConflictDoUpdate({
        target: schema.weatherAlertPreferences.connectionId,
        set: { enabled, configVersion: sql`${schema.weatherAlertPreferences.configVersion} + 1`, updatedAt: new Date() },
      }).returning();
      return result;
    });
  }

  async enqueueWhatsappMessage(providerMessageId: string, phoneNumber: string, messageType: string, payload: unknown): Promise<boolean> {
    const [result] = await db.insert(schema.whatsappMessageEvents)
      .values({ providerMessageId, phoneNumber, messageType, payload, status: "received", availableAt: new Date(), correlationId: randomUUID() })
      .onConflictDoNothing({ target: schema.whatsappMessageEvents.providerMessageId })
      .returning({ id: schema.whatsappMessageEvents.id });
    return Boolean(result);
  }

  async enqueueWhatsappMessages(messages: Array<{ providerMessageId: string; phoneNumber: string; messageType: string; payload: unknown }>): Promise<number> {
    if (!messages.length) return 0;
    const rows = await db.insert(schema.whatsappMessageEvents).values(messages.map((m) => ({
      ...m, status: "received", availableAt: new Date(), correlationId: randomUUID(),
    }))).onConflictDoNothing({ target: schema.whatsappMessageEvents.providerMessageId }).returning({ id: schema.whatsappMessageEvents.id });
    return rows.length;
  }

  async claimWhatsappMessages(limit = 20, leaseSeconds = 300): Promise<WhatsappMessageEvent[]> {
    const bounded = Math.min(Math.max(limit, 1), 100);
    return db.transaction(async (tx) => {
      await tx.update(schema.whatsappMessageEvents).set({
        status: "dead",
        stage: "dead-letter",
        leaseUntil: null,
        lastError: "Worker lease expired after maximum attempts",
      }).where(and(
        sql`${schema.whatsappMessageEvents.attempts} >= 5`,
        sql`(
          ${schema.whatsappMessageEvents.status} = 'failed'
          OR (
            ${schema.whatsappMessageEvents.status} = 'processing'
            AND COALESCE(
              ${schema.whatsappMessageEvents.leaseUntil},
              ${schema.whatsappMessageEvents.lastAttemptAt},
              ${schema.whatsappMessageEvents.createdAt}
            ) < NOW()
          )
        )`,
      ));
      const locked = await tx.execute(sql`
        WITH candidates AS MATERIALIZED (
          SELECT e.id, e.phone_number, e.created_at,
            row_number() OVER (PARTITION BY e.phone_number ORDER BY e.created_at) AS phone_order
          FROM whatsapp_message_events e
          WHERE e.attempts < 5 AND e.available_at <= NOW()
            AND (
              e.status IN ('received','failed')
              OR (e.status = 'processing' AND COALESCE(e.lease_until, e.last_attempt_at, e.created_at) < NOW())
            )
            AND NOT EXISTS (
              SELECT 1 FROM whatsapp_message_events earlier
              WHERE earlier.phone_number = e.phone_number
                AND (earlier.created_at, earlier.id) < (e.created_at, e.id)
                AND earlier.status NOT IN ('processed','dead')
            )
        )
        SELECT e.id
        FROM whatsapp_message_events e
        JOIN candidates candidate ON candidate.id = e.id
        WHERE candidate.phone_order = 1
          AND pg_try_advisory_xact_lock(hashtext(candidate.phone_number))
        ORDER BY candidate.created_at
        FOR UPDATE OF e SKIP LOCKED
        LIMIT ${bounded}
      `);
      const ids = locked.rows.map((row) => Number(row.id)).filter(Number.isFinite);
      if (!ids.length) return [];
      return tx.update(schema.whatsappMessageEvents).set({
        status: "processing",
        attempts: sql`${schema.whatsappMessageEvents.attempts} + 1`,
        lastAttemptAt: new Date(),
        leaseUntil: sql`NOW() + (${leaseSeconds} || ' seconds')::interval`,
        stage: "processing",
      }).where(inArray(schema.whatsappMessageEvents.id, ids)).returning();
    });
  }

  async takeWhatsappMessage(providerMessageId: string): Promise<WhatsappMessageEvent | undefined> {
    const [result] = await db.update(schema.whatsappMessageEvents)
      .set({
        status: "processing",
        attempts: sql`${schema.whatsappMessageEvents.attempts} + 1`,
         lastAttemptAt: new Date(),
         leaseUntil: sql`NOW() + INTERVAL '5 minutes'`,
        lastError: null,
      })
      .where(and(
        eq(schema.whatsappMessageEvents.providerMessageId, providerMessageId),
         sql`${schema.whatsappMessageEvents.availableAt} <= NOW() AND (
          ${schema.whatsappMessageEvents.status} IN ('received', 'failed')
          OR (
            ${schema.whatsappMessageEvents.status} = 'processing'
            AND ${schema.whatsappMessageEvents.lastAttemptAt} < NOW() - INTERVAL '5 minutes'
          )
        )`,
        sql`${schema.whatsappMessageEvents.attempts} < 5`,
      ))
      .returning();
    return result;
  }

  async touchWhatsappMessage(providerMessageId: string): Promise<void> {
    await db.update(schema.whatsappMessageEvents)
      .set({ lastAttemptAt: new Date(), leaseUntil: sql`NOW() + INTERVAL '5 minutes'` })
       .where(and(
        eq(schema.whatsappMessageEvents.providerMessageId, providerMessageId),
        eq(schema.whatsappMessageEvents.status, "processing"),
      ));
  }

  async getRetryableWhatsappMessages(limit = 20): Promise<WhatsappMessageEvent[]> {
    return db.select().from(schema.whatsappMessageEvents)
      .where(and(
        sql`${schema.whatsappMessageEvents.attempts} < 5`,
        sql`(
          ${schema.whatsappMessageEvents.status} IN ('received', 'failed')
          OR (
            ${schema.whatsappMessageEvents.status} = 'processing'
            AND ${schema.whatsappMessageEvents.lastAttemptAt} < NOW() - INTERVAL '5 minutes'
          )
        )`,
      ))
      .orderBy(asc(schema.whatsappMessageEvents.createdAt))
      .limit(Math.min(Math.max(limit, 1), 100));
  }

  async completeWhatsappMessage(providerMessageId: string, status: "processed" | "failed" | "dead", error?: string): Promise<void> {
    await db.update(schema.whatsappMessageEvents)
      .set({
        status: status === "failed" ? sql`CASE WHEN attempts >= 5 THEN 'dead' ELSE 'failed' END` : status,
        processedAt: status === "processed" ? new Date() : null,
        lastError: error ? error.slice(0, 500) : null,
        availableAt: status === "failed" ? sql`NOW() + (LEAST(300, POWER(2, attempts) * 5) + FLOOR(RANDOM() * 5)) * INTERVAL '1 second'` : undefined,
        leaseUntil: null,
        stage: status === "processed" ? "complete" : status === "dead" ? "dead-letter" : "retry",
      })
      .where(eq(schema.whatsappMessageEvents.providerMessageId, providerMessageId));
  }

  async getWhatsappOutbound(idempotencyKey: string): Promise<WhatsappOutboundMessage | undefined> {
    return db.query.whatsappOutboundMessages.findFirst({ where: eq(schema.whatsappOutboundMessages.idempotencyKey, idempotencyKey) });
  }

  async claimWhatsappOutbound(data: { idempotencyKey: string; recipient: string; bodyHash: string }): Promise<{ message: WhatsappOutboundMessage; claimed: boolean }> {
    await db.update(schema.whatsappOutboundMessages)
      .set({ status: "ambiguous", lastError: "Worker lease expired before delivery confirmation" })
      .where(and(
        eq(schema.whatsappOutboundMessages.idempotencyKey, data.idempotencyKey),
        eq(schema.whatsappOutboundMessages.status, "sending"),
        sql`${schema.whatsappOutboundMessages.lastAttemptAt} < NOW() - INTERVAL '10 minutes'`,
      ));
    const [row] = await db.insert(schema.whatsappOutboundMessages).values({
      ...data,
      status: "sending",
      attempts: 1,
      lastAttemptAt: new Date(),
    })
      .onConflictDoUpdate({
        target: schema.whatsappOutboundMessages.idempotencyKey,
        set: {
          status: "sending",
          attempts: sql`${schema.whatsappOutboundMessages.attempts} + 1`,
          lastAttemptAt: new Date(),
          lastError: null,
        },
        where: eq(schema.whatsappOutboundMessages.status, "failed"),
      }).returning();
    if (row) return { message: row, claimed: true };
    return { message: (await this.getWhatsappOutbound(data.idempotencyKey))!, claimed: false };
  }

  async completeWhatsappOutbound(idempotencyKey: string, providerMessageId: string, status = "sent", error?: string): Promise<void> {
    await db.update(schema.whatsappOutboundMessages).set({
      providerMessageId, status, sentAt: status === "sent" ? new Date() : null,
      lastError: error?.slice(0, 500) || null,
    }).where(eq(schema.whatsappOutboundMessages.idempotencyKey, idempotencyKey));
  }

  async getPendingFieldLog(userId: string, parcelId: string): Promise<FieldLogEntry | undefined> {
    return db.query.fieldLogEntries.findFirst({
      where: and(
        eq(schema.fieldLogEntries.userId, userId),
        eq(schema.fieldLogEntries.parcelId, parcelId),
        inArray(schema.fieldLogEntries.status, ["draft", "pending", "corrected"]),
      ),
      orderBy: [desc(schema.fieldLogEntries.updatedAt)],
    });
  }

  async listFieldLogs(userId: string, parcelId: string, filters: FieldLogFilters = {}): Promise<{
    entries: FieldLogEntry[];
    total: number;
    page: number;
    limit: number;
    summary: FieldLogSummary;
  }> {
    const page = Math.max(1, Math.floor(filters.page || 1));
    const limit = Math.min(100, Math.max(1, Math.floor(filters.limit || 25)));
    const where = buildFieldLogWhere(userId, parcelId, filters);
    const confirmedWhere = and(where, eq(schema.fieldLogEntries.status, "confirmed"))!;
    const [entries, countRows, statusRows, activityRows, itemResult] = await Promise.all([
      db.select().from(schema.fieldLogEntries).where(where)
        .orderBy(desc(schema.fieldLogEntries.occurredAt), desc(schema.fieldLogEntries.createdAt))
        .limit(limit).offset((page - 1) * limit),
      db.select({ count: sql<number>`count(*)::int` }).from(schema.fieldLogEntries).where(where),
      db.select({
        status: schema.fieldLogEntries.status,
        count: sql<number>`count(*)::int`,
      }).from(schema.fieldLogEntries).where(where).groupBy(schema.fieldLogEntries.status),
      db.select({
        activity: schema.fieldLogEntries.activityType,
        count: sql<number>`count(*)::int`,
      }).from(schema.fieldLogEntries).where(confirmedWhere).groupBy(schema.fieldLogEntries.activityType),
      db.execute(sql`
        SELECT
          COALESCE(item->>'category', 'observation') AS category,
          NULLIF(UPPER(item->>'currency'), '') AS currency,
          NULLIF(item->>'unit', '') AS unit,
          COUNT(*)::int AS item_count,
          SUM(CASE WHEN item->>'cost' ~ '^-?[0-9]+([.][0-9]+)?$' THEN (item->>'cost')::numeric ELSE 0 END)::float8 AS cost_total,
          SUM(CASE WHEN item->>'quantity' ~ '^-?[0-9]+([.][0-9]+)?$' THEN (item->>'quantity')::numeric ELSE 0 END)::float8 AS quantity_total
        FROM ${schema.fieldLogEntries}
        CROSS JOIN LATERAL jsonb_array_elements(COALESCE(${schema.fieldLogEntries.structuredData}->'items', '[]'::jsonb)) item
        WHERE ${confirmedWhere}
        GROUP BY 1, 2, 3
      `),
    ]);

    const summary: FieldLogSummary = {
      totalEntries: Number(countRows[0]?.count || 0),
      statusCounts: {},
      activityCounts: {},
      categoryCounts: {},
      totalsByCurrency: {},
      quantitiesByUnit: {},
    };
    for (const row of statusRows) summary.statusCounts[row.status] = Number(row.count);
    for (const row of activityRows) summary.activityCounts[row.activity || "Sin clasificar"] = Number(row.count);
    for (const row of itemResult.rows as any[]) {
      summary.categoryCounts[row.category] = (summary.categoryCounts[row.category] || 0) + Number(row.item_count);
      if (row.currency) {
        summary.totalsByCurrency[row.currency] = Number(((summary.totalsByCurrency[row.currency] || 0) + Number(row.cost_total)).toFixed(2));
      }
      if (row.unit) {
        summary.quantitiesByUnit[row.unit] = Number(((summary.quantitiesByUnit[row.unit] || 0) + Number(row.quantity_total)).toFixed(3));
      }
    }
    return { entries, total: summary.totalEntries, page, limit, summary };
  }

  async exportFieldLogs(userId: string, parcelId: string, filters: FieldLogFilters = {}, limit = 5_000): Promise<{
    entries: FieldLogEntry[];
    total: number;
    truncated: boolean;
  }> {
    const safeLimit = Math.min(5_000, Math.max(1, Math.floor(limit)));
    const where = buildFieldLogWhere(userId, parcelId, filters);
    const [rows, countRows] = await Promise.all([
      db.select().from(schema.fieldLogEntries).where(where)
        .orderBy(desc(schema.fieldLogEntries.occurredAt), desc(schema.fieldLogEntries.createdAt))
        .limit(safeLimit),
      db.select({ count: sql<number>`count(*)::int` }).from(schema.fieldLogEntries).where(where),
    ]);
    const total = Number(countRows[0]?.count || 0);
    return { entries: rows, total, truncated: total > rows.length };
  }

  async getFieldLogDetail(entryId: string, userId: string): Promise<{
    entry: FieldLogEntry;
    revisions: schema.FieldLogRevision[];
  } | undefined> {
    const entry = await db.query.fieldLogEntries.findFirst({
      where: and(eq(schema.fieldLogEntries.id, entryId), eq(schema.fieldLogEntries.userId, userId)),
    });
    if (!entry) return undefined;
    const revisions = await db.select().from(schema.fieldLogRevisions)
      .where(eq(schema.fieldLogRevisions.entryId, entry.id))
      .orderBy(desc(schema.fieldLogRevisions.revision));
    return { entry, revisions };
  }

  async promoteLegacyFieldLogs(userId: string, parcelId: string): Promise<void> {
    await db.transaction(async tx => {
      const rows = await tx.select().from(schema.fieldLogEntries).where(and(
        eq(schema.fieldLogEntries.userId, userId), eq(schema.fieldLogEntries.parcelId, parcelId),
        inArray(schema.fieldLogEntries.status, ["draft", "pending", "corrected"]),
        sql`COALESCE(${schema.fieldLogEntries.structuredData}->>'registration', '') = ''`,
        sql`${schema.fieldLogEntries.occurredAt} IS NOT NULL`,
      )).for("update");
      for (const entry of rows) {
        // Never promote an extraction that cannot identify any field activity.
        const priorData = entry.structuredData as Record<string, unknown> | null;
        if (!entry.activityType?.trim() || priorData?.datePrecision === "unknown" || priorData?.lastAction === "corrected") continue;
        const data = { ...(entry.structuredData as object), registration: "automatic",
          migratedFromLegacy: true, previousMissingFields: entry.missingFields };
        const revision = entry.currentRevision + 1;
        await tx.insert(schema.fieldLogRevisions).values({
          entryId: entry.id, revision, status: "confirmed", structuredData: data,
          missingFields: [], correctionText: "Actualización al registro automático; no es confirmación expresa.",
          sourceProviderMessageId: `automatic-upgrade:${entry.id}`,
        }).onConflictDoNothing();
        await tx.update(schema.fieldLogEntries).set({
          status: "confirmed", structuredData: data, missingFields: [], currentRevision: revision,
          updatedAt: new Date(),
        }).where(eq(schema.fieldLogEntries.id, entry.id));
      }
    });
  }

  async saveAutomaticFieldLog(data: {
    userId: string; parcelId: string; cycleDetailId?: string | null;
    sourceProviderMessageId: string; originalText: string; transcription?: string;
    activityType: string; occurredAt: Date | null; structuredData: unknown; evidence: unknown[];
    confidence?: number | null; missingFields: string[];
  }): Promise<FieldLogEntry> {
    return db.transaction(async tx => {
      const structuredData = { ...(data.structuredData as object), registration: "automatic" };
      const status = data.occurredAt ? "confirmed" : "pending";
      const [entry] = await tx.insert(schema.fieldLogEntries).values({
        ...data, status, confirmedAt: null, structuredData,
        confidence: data.confidence == null ? null : String(data.confidence),
      }).onConflictDoNothing({ target: schema.fieldLogEntries.sourceProviderMessageId }).returning();
      if (!entry) {
        const prior = await tx.query.fieldLogEntries.findFirst({
          where: and(eq(schema.fieldLogEntries.sourceProviderMessageId, data.sourceProviderMessageId),
            eq(schema.fieldLogEntries.userId, data.userId), eq(schema.fieldLogEntries.parcelId, data.parcelId)),
        });
        if (!prior) throw new Error("Conflicto de origen de la bitácora");
        return prior;
      }
      await tx.insert(schema.fieldLogRevisions).values({
        entryId: entry.id, revision: 1, status, structuredData,
        missingFields: data.missingFields, sourceProviderMessageId: data.sourceProviderMessageId,
        correctionText: "Registro automático del reporte del productor; no es confirmación expresa.",
      });
      return entry;
    });
  }

  async getActiveFieldLogs(userId: string, parcelId: string): Promise<FieldLogEntry[]> {
    return db.select().from(schema.fieldLogEntries).where(and(
      eq(schema.fieldLogEntries.userId, userId),
      eq(schema.fieldLogEntries.parcelId, parcelId),
      sql`(${schema.fieldLogEntries.status} = 'confirmed' OR
        (${schema.fieldLogEntries.status} = 'corrected' AND
         ${schema.fieldLogEntries.structuredData}->>'registration' = 'automatic'))`,
    )).orderBy(desc(schema.fieldLogEntries.occurredAt), desc(schema.fieldLogEntries.createdAt));
  }

  async getConfirmedFieldLogContext(
    userId: string,
    parcelId: string,
    options: { from?: Date; to?: Date; limit?: number; query?: string } = {},
  ): Promise<ConfirmedFieldLogContext> {
    const to = options.to || new Date();
    const from = options.from || new Date(to.getTime() - 180 * 24 * 60 * 60 * 1000);
    const limit = Math.min(20, Math.max(1, options.limit || 12));
    const rows = await db.select().from(schema.fieldLogEntries).where(and(
      eq(schema.fieldLogEntries.userId, userId),
      eq(schema.fieldLogEntries.parcelId, parcelId),
      eq(schema.fieldLogEntries.status, "confirmed"),
      gte(schema.fieldLogEntries.occurredAt, from),
      lte(schema.fieldLogEntries.occurredAt, to),
    )).orderBy(desc(schema.fieldLogEntries.occurredAt)).limit(60);
    const tokens = (options.query || "").toLocaleLowerCase("es-MX")
      .split(/[^a-z0-9áéíóúüñ]+/i).filter((token) => token.length >= 4).slice(0, 12);
    const ranked = rows.map((entry, index) => {
      const data = entry.structuredData as any;
      const searchable = `${entry.activityType || ""} ${JSON.stringify(data?.items || [])} ${data?.observations || ""}`.toLocaleLowerCase("es-MX");
      return { entry, score: tokens.reduce((score, token) => score + (searchable.includes(token) ? 10 : 0), 0) - index / 100 };
    }).sort((a, b) => b.score - a.score).slice(0, limit);
    let bytes = 0;
    const events: ConfirmedFieldLogContext["events"] = [];
    for (const { entry } of ranked) {
      const data = entry.structuredData as any;
      const occurredAt = (entry.occurredAt || entry.createdAt).toISOString();
      const channel = data?.channel === "web" ? "Web" as const : "WhatsApp" as const;
      const compact = {
        citation: `FL:${entry.id.slice(0, 8)}|${data?.occurredOn || mexicoDateKey(entry.occurredAt || entry.createdAt)}|${channel}`,
        id: entry.id,
        occurredAt,
        activityType: entry.activityType || "Sin clasificar",
        items: (Array.isArray(data?.items) ? data.items : []).slice(0, 12).map((item: any) => ({
          category: item?.category, name: item?.name, quantity: item?.quantity, unit: item?.unit,
          personnel: item?.personnel, machinery: item?.machinery, cost: item?.cost, currency: item?.currency,
        })),
        observations: data?.observations ? String(data.observations).slice(0, 500) : null,
        confirmedAt: entry.confirmedAt?.toISOString() || null,
        revision: entry.currentRevision,
        channel,
      };
      const size = Buffer.byteLength(JSON.stringify(compact), "utf8");
      if (bytes + size > 8_000) break;
      bytes += size;
      events.push(compact);
    }
    return {
      period: { from: from.toISOString(), to: to.toISOString() },
      limited: rows.length > events.length,
      totalConfirmedInPeriod: rows.length,
      events,
    };
  }

  async getFieldLogBySourceMessage(providerMessageId: string): Promise<FieldLogEntry | undefined> {
    const original = await db.query.fieldLogEntries.findFirst({
      where: eq(schema.fieldLogEntries.sourceProviderMessageId, providerMessageId),
    });
    if (original) return original;
    const revision = await db.query.fieldLogRevisions.findFirst({
      where: eq(schema.fieldLogRevisions.sourceProviderMessageId, providerMessageId),
    });
    if (!revision) return undefined;
    return db.query.fieldLogEntries.findFirst({
      where: eq(schema.fieldLogEntries.id, revision.entryId),
    });
  }

  async createFieldLogDraft(data: {
    userId: string; parcelId: string; cycleDetailId?: string | null;
    sourceProviderMessageId: string; originalText: string; transcription?: string;
    activityType?: string | null; occurredAt?: Date | null; structuredData: unknown;
    evidence: unknown[]; confidence?: number | null; missingFields: string[];
  }): Promise<FieldLogEntry> {
    return db.transaction(async (tx) => {
      const status = data.missingFields.length ? "draft" : "pending";
      const [entry] = await tx.insert(schema.fieldLogEntries).values({
        ...data,
        status,
        confidence: data.confidence == null ? null : String(data.confidence),
      }).onConflictDoNothing({ target: schema.fieldLogEntries.sourceProviderMessageId }).returning();
      const resolved = entry || await tx.query.fieldLogEntries.findFirst({
        where: eq(schema.fieldLogEntries.sourceProviderMessageId, data.sourceProviderMessageId),
      });
      if (!resolved) throw new Error("No se pudo crear el borrador de bitácora");
      if (entry) {
        await tx.insert(schema.fieldLogRevisions).values({
          entryId: entry.id, revision: 1, status, structuredData: data.structuredData,
          missingFields: data.missingFields, sourceProviderMessageId: data.sourceProviderMessageId,
        });
      }
      return resolved;
    });
  }

  async reviseFieldLog(entryId: string, userId: string, providerMessageId: string, expectedRevision: number, data: {
    activityType?: string | null; occurredAt?: Date | null; structuredData: unknown;
    confidence?: number | null; missingFields: string[]; correctionText: string; evidence?: unknown[];
  }): Promise<FieldLogEntry> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM ${schema.fieldLogEntries} WHERE id = ${entryId} FOR UPDATE`);
      const priorRevision = await tx.query.fieldLogRevisions.findFirst({
        where: eq(schema.fieldLogRevisions.sourceProviderMessageId, providerMessageId),
      });
      if (priorRevision) {
        const prior = await tx.query.fieldLogEntries.findFirst({
          where: and(eq(schema.fieldLogEntries.id, priorRevision.entryId), eq(schema.fieldLogEntries.userId, userId)),
        });
        if (!prior) throw new Error("Borrador no encontrado");
        return prior;
      }
      const current = await tx.query.fieldLogEntries.findFirst({
        where: and(eq(schema.fieldLogEntries.id, entryId), eq(schema.fieldLogEntries.userId, userId)),
      });
      if (!current) throw new Error("Borrador no encontrado");
      if (!["draft", "pending", "corrected", "confirmed"].includes(current.status)) {
        throw new Error("La bitácora ya fue cerrada");
      }
      if (current.currentRevision !== expectedRevision) {
        throw new Error("La bitácora cambió; revisa el resumen más reciente");
      }
      const revision = current.currentRevision + 1;
      const automatic = (current.structuredData as any)?.registration === "automatic";
      const wasActive = current.status === "confirmed" || automatic;
      const status = wasActive && !data.occurredAt ? "pending" : wasActive ? "confirmed" : data.missingFields.length ? "draft" : "corrected";
      const structuredData = {
        ...(data.structuredData as object),
        registration: (current.structuredData as any)?.registration || "explicit",
        lastAction: "corrected",
        ...(data.evidence?.length ? { evidenceAdded: data.evidence } : {}),
      };
      await tx.insert(schema.fieldLogRevisions).values({
        entryId, revision, status, structuredData,
        missingFields: data.missingFields, correctionText: data.correctionText,
        sourceProviderMessageId: providerMessageId,
      });
      const [updated] = await tx.update(schema.fieldLogEntries).set({
        activityType: data.activityType,
        occurredAt: data.occurredAt,
        structuredData,
        evidence: [...(Array.isArray(current.evidence) ? current.evidence : []), ...(data.evidence || [])],
        missingFields: data.missingFields,
        status, currentRevision: revision, updatedAt: new Date(),
        confidence: data.confidence == null ? null : String(data.confidence),
      }).where(eq(schema.fieldLogEntries.id, entryId)).returning();
      return updated;
    });
  }

  async confirmFieldLog(entryId: string, userId: string, providerMessageId: string, expectedRevision?: number): Promise<FieldLogEntry | undefined> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM ${schema.fieldLogEntries} WHERE id = ${entryId} FOR UPDATE`);
      const prior = await tx.query.fieldLogRevisions.findFirst({
        where: eq(schema.fieldLogRevisions.sourceProviderMessageId, providerMessageId),
      });
      const current = await tx.query.fieldLogEntries.findFirst({
        where: and(eq(schema.fieldLogEntries.id, prior?.entryId || entryId), eq(schema.fieldLogEntries.userId, userId)),
      });
      if (!current) return undefined;
      if (prior) return current;
      if (expectedRevision != null && current.currentRevision !== expectedRevision) {
        throw new Error("La bitácora cambió; revisa el estado más reciente");
      }
      if (!["pending", "corrected"].includes(current.status)) return current;
      const revision = current.currentRevision + 1;
      await tx.insert(schema.fieldLogRevisions).values({
        entryId, revision, status: "confirmed", structuredData: current.structuredData,
        missingFields: [], correctionText: null, sourceProviderMessageId: providerMessageId,
      });
      const [entry] = await tx.update(schema.fieldLogEntries).set({
        status: "confirmed", confirmedAt: new Date(), updatedAt: new Date(), currentRevision: revision,
      }).where(and(eq(schema.fieldLogEntries.id, entryId), eq(schema.fieldLogEntries.userId, userId))).returning();
      return entry;
    });
  }

  async rejectFieldLog(entryId: string, userId: string, providerMessageId: string, expectedRevision?: number): Promise<FieldLogEntry | undefined> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM ${schema.fieldLogEntries} WHERE id = ${entryId} FOR UPDATE`);
      const prior = await tx.query.fieldLogRevisions.findFirst({
        where: eq(schema.fieldLogRevisions.sourceProviderMessageId, providerMessageId),
      });
      const current = await tx.query.fieldLogEntries.findFirst({
        where: and(eq(schema.fieldLogEntries.id, prior?.entryId || entryId), eq(schema.fieldLogEntries.userId, userId)),
      });
      if (!current) return undefined;
      if (prior) return current;
      if (expectedRevision != null && current.currentRevision !== expectedRevision) {
        throw new Error("La bitácora cambió; revisa el estado más reciente");
      }
      if (!["draft", "pending", "corrected", "confirmed"].includes(current.status)) return current;
      const revision = current.currentRevision + 1;
      await tx.insert(schema.fieldLogRevisions).values({
        entryId, revision, status: "rejected", structuredData: current.structuredData,
        missingFields: current.missingFields, correctionText: null, sourceProviderMessageId: providerMessageId,
      });
      const [entry] = await tx.update(schema.fieldLogEntries).set({
        status: "rejected", rejectedAt: new Date(), updatedAt: new Date(), currentRevision: revision,
      }).where(and(eq(schema.fieldLogEntries.id, entryId), eq(schema.fieldLogEntries.userId, userId))).returning();
      return entry;
    });
  }

  // Shared Knowledge operations
  async getSharedKnowledgeByCrop(crop: string, limit: number = 10): Promise<SharedKnowledge[]> {
    const result = await db.query.sharedKnowledge.findMany({
      where: eq(schema.sharedKnowledge.crop, crop),
      orderBy: [desc(schema.sharedKnowledge.successCount)],
      limit,
    });
    return result;
  }

  async createSharedKnowledge(data: InsertSharedKnowledge): Promise<SharedKnowledge> {
    const [result] = await db.insert(schema.sharedKnowledge).values(data as any).returning();
    return result;
  }

  async getProductionCostsByParcel(parcelId: string): Promise<ProductionCost[]> {
    const result = await db.query.productionCosts.findMany({
      where: eq(schema.productionCosts.parcelId, parcelId),
      orderBy: [desc(schema.productionCosts.createdAt)],
    });
    return result;
  }

  async createProductionCost(data: InsertProductionCost): Promise<ProductionCost> {
    const [result] = await db.insert(schema.productionCosts).values(data as any).returning();
    return result;
  }

  async deleteProductionCost(id: string): Promise<boolean> {
    const result = await db.delete(schema.productionCosts).where(eq(schema.productionCosts.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async incrementKnowledgeSuccess(id: string): Promise<void> {
    const sql_query = `UPDATE shared_knowledge SET success_count = success_count + 1, updated_at = NOW() WHERE id = '${id}'`;
    await pool.query(sql_query);
  }

  // Community operations
  async getCommunityPosts(options: { limit?: number; offset?: number; tag?: string; type?: string; search?: string; authorId?: string }): Promise<CommunityPost[]> {
    const { limit = 20, offset = 0, tag, type, search, authorId } = options;
    const conditions: any[] = [];

    if (type) {
      conditions.push(eq(schema.communityPosts.type, type));
    }
    if (tag) {
      conditions.push(sql`${tag} = ANY(${schema.communityPosts.tags})`);
    }
    if (search) {
      conditions.push(
        or(
          ilike(schema.communityPosts.title, `%${search}%`),
          ilike(schema.communityPosts.content, `%${search}%`)
        )
      );
    }
    if (authorId) {
      conditions.push(eq(schema.communityPosts.userId, authorId));
    }

    const result = await db.query.communityPosts.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: [desc(schema.communityPosts.createdAt)],
      limit,
      offset,
    });
    return result;
  }

  async getCommunityPost(id: string): Promise<CommunityPost | undefined> {
    const result = await db.query.communityPosts.findFirst({
      where: eq(schema.communityPosts.id, id),
    });
    return result;
  }

  async createCommunityPost(data: InsertCommunityPost): Promise<CommunityPost> {
    const [post] = await db.insert(schema.communityPosts).values(data as any).returning();
    return post;
  }

  async deleteCommunityPost(id: string): Promise<boolean> {
    const result = await db.delete(schema.communityPosts).where(eq(schema.communityPosts.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async getCommunityComments(postId: string): Promise<CommunityComment[]> {
    const result = await db.query.communityComments.findMany({
      where: eq(schema.communityComments.postId, postId),
      orderBy: [asc(schema.communityComments.createdAt)],
    });
    return result;
  }

  async createCommunityComment(data: InsertCommunityComment): Promise<CommunityComment> {
    const [comment] = await db.insert(schema.communityComments).values(data as any).returning();
    await pool.query("UPDATE community_posts SET comments_count = comments_count + 1 WHERE id = $1", [data.postId]);
    return comment;
  }

  async deleteCommunityComment(id: string): Promise<boolean> {
    const comment = await db.query.communityComments.findFirst({
      where: eq(schema.communityComments.id, id),
    });
    if (!comment) return false;
    const result = await db.delete(schema.communityComments).where(eq(schema.communityComments.id, id));
    if (result.rowCount && result.rowCount > 0) {
      await pool.query("UPDATE community_posts SET comments_count = GREATEST(comments_count - 1, 0) WHERE id = $1", [comment.postId]);
      return true;
    }
    return false;
  }

  async toggleCommunityLike(userId: string, postId?: string, commentId?: string): Promise<boolean> {
    const conditions: any[] = [eq(schema.communityLikes.userId, userId)];
    if (postId) {
      conditions.push(eq(schema.communityLikes.postId, postId));
    }
    if (commentId) {
      conditions.push(eq(schema.communityLikes.commentId, commentId));
    }

    const existing = await db.query.communityLikes.findFirst({
      where: and(...conditions),
    });

    if (existing) {
      await db.delete(schema.communityLikes).where(eq(schema.communityLikes.id, existing.id));
      if (postId) {
        await pool.query("UPDATE community_posts SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = $1", [postId]);
      }
      if (commentId) {
        await pool.query("UPDATE community_comments SET likes_count = GREATEST(likes_count - 1, 0) WHERE id = $1", [commentId]);
      }
      return false;
    } else {
      await db.insert(schema.communityLikes).values({
        userId,
        postId: postId || null,
        commentId: commentId || null,
      } as any);
      if (postId) {
        await pool.query("UPDATE community_posts SET likes_count = likes_count + 1 WHERE id = $1", [postId]);
      }
      if (commentId) {
        await pool.query("UPDATE community_comments SET likes_count = likes_count + 1 WHERE id = $1", [commentId]);
      }
      return true;
    }
  }

  async hasUserLiked(userId: string, postId?: string, commentId?: string): Promise<boolean> {
    const conditions: any[] = [eq(schema.communityLikes.userId, userId)];
    if (postId) {
      conditions.push(eq(schema.communityLikes.postId, postId));
    }
    if (commentId) {
      conditions.push(eq(schema.communityLikes.commentId, commentId));
    }

    const existing = await db.query.communityLikes.findFirst({
      where: and(...conditions),
    });
    return !!existing;
  }

  async getUserLikedPostIds(userId: string): Promise<string[]> {
    const result = await db.query.communityLikes.findMany({
      where: and(
        eq(schema.communityLikes.userId, userId),
        sql`${schema.communityLikes.postId} IS NOT NULL`
      ),
    });
    return result.map(l => l.postId!).filter(Boolean);
  }

  async getCommunityStats(): Promise<any> {
    const [usersResult] = await db.select({ count: sql<number>`count(*)` }).from(schema.users).where(eq(schema.users.isActive, true));
    const [postsResult] = await db.select({ count: sql<number>`count(*)` }).from(schema.communityPosts);
    const [commentsResult] = await db.select({ count: sql<number>`count(*)` }).from(schema.communityComments);

    const topAuthors = await db
      .select({
        userId: schema.communityPosts.userId,
        postCount: sql<number>`count(*)`,
      })
      .from(schema.communityPosts)
      .groupBy(schema.communityPosts.userId)
      .orderBy(sql`count(*) DESC`)
      .limit(5);

    const activeMembers = await Promise.all(
      topAuthors.map(async (a) => {
        const u = await this.getUser(a.userId);
        return u ? { id: u.id, name: u.name, role: u.role, postCount: Number(a.postCount) } : null;
      })
    );

    const trendingTags = await db
      .select({ tag: sql<string>`unnest(tags)` })
      .from(schema.communityPosts)
      .where(sql`tags IS NOT NULL AND array_length(tags, 1) > 0`);

    const tagCounts: Record<string, number> = {};
    trendingTags.forEach((r: any) => {
      const tag = r.tag;
      if (tag) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    });
    const sortedTags = Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([tag, count]) => ({ tag, count }));

    return {
      totalMembers: Number(usersResult.count),
      totalPosts: Number(postsResult.count),
      totalComments: Number(commentsResult.count),
      activeMembers: activeMembers.filter(Boolean),
      trendingTags: sortedTags,
    };
  }

  async getPeerMatches(crop: string, excludeUserId: string, limit: number = 5): Promise<PeerMatch[]> {
    interface PeerMatchRow {
      userId: string;
      name: string;
      avatarUrl: string | null;
      role: string;
      crop: string;
      avgNdvi: string | null;
      postId: string | null;
      postTitle: string | null;
      postExcerpt: string | null;
    }
    const result = await db.execute(sql`
      WITH user_parcels AS (
        SELECT DISTINCT ON (p.user_id)
          p.user_id,
          p.crop,
          p.id AS parcel_id
        FROM parcels p
        WHERE translate(lower(p.crop), 'áàäâãéèëêíìïîóòöôõúùüûñ', 'aaaaaeeeeiiiioooooouuuun')
              = translate(lower(${crop}), 'áàäâãéèëêíìïîóòöôõúùüûñ', 'aaaaaeeeeiiiioooooouuuun')
          AND p.user_id != ${excludeUserId}
        ORDER BY p.user_id, p.created_at DESC
      ),
      ndvi_data AS (
        SELECT
          up.user_id,
          AVG(pd.ndvi::float) AS avg_ndvi
        FROM user_parcels up
        JOIN parcel_data pd ON pd.parcel_id = up.parcel_id AND pd.ndvi IS NOT NULL
        GROUP BY up.user_id
      ),
      result_posts AS (
        SELECT DISTINCT ON (cp.user_id)
          cp.user_id,
          cp.id    AS post_id,
          cp.title AS post_title,
          SUBSTRING(cp.content, 1, 250) AS post_excerpt
        FROM community_posts cp
        WHERE cp.type = 'parcel_results'
          AND cp.user_id IN (SELECT user_id FROM user_parcels)
        ORDER BY cp.user_id, cp.created_at DESC
      )
      SELECT
        u.id             AS "userId",
        u.name,
        u.avatar_url     AS "avatarUrl",
        u.role,
        up.crop,
        nd.avg_ndvi      AS "avgNdvi",
        rp.post_id       AS "postId",
        rp.post_title    AS "postTitle",
        rp.post_excerpt  AS "postExcerpt"
      FROM user_parcels up
      LEFT JOIN ndvi_data nd ON nd.user_id = up.user_id
      LEFT JOIN result_posts rp ON rp.user_id = up.user_id
      JOIN users u ON u.id = up.user_id
      WHERE u.is_active = true
      ORDER BY
        (nd.avg_ndvi IS NOT NULL)::int DESC,
        (rp.post_id IS NOT NULL)::int DESC,
        nd.avg_ndvi DESC NULLS LAST
      LIMIT ${limit}
    `);
    return (result.rows as unknown as PeerMatchRow[]).map((r) => ({
      userId: r.userId,
      name: r.name,
      avatarUrl: r.avatarUrl ?? null,
      role: r.role,
      crop: r.crop,
      avgNdvi: r.avgNdvi != null ? parseFloat(r.avgNdvi) : null,
      postId: r.postId ?? null,
      postTitle: r.postTitle ?? null,
      postExcerpt: r.postExcerpt ?? null,
    }));
  }

  async getTopContributors(excludeUserId: string, limit: number = 5): Promise<PeerMatch[]> {
    interface PeerMatchRow {
      userId: string;
      name: string;
      avatarUrl: string | null;
      role: string;
      crop: string | null;
      avgNdvi: string | null;
      postId: string | null;
      postTitle: string | null;
      postExcerpt: string | null;
    }
    const result = await db.execute(sql`
      WITH ranked_posts AS (
        SELECT DISTINCT ON (cp.user_id)
          cp.user_id,
          cp.id    AS post_id,
          cp.title AS post_title,
          SUBSTRING(cp.content, 1, 250) AS post_excerpt
        FROM community_posts cp
        WHERE cp.type IN ('parcel_results', 'experience', 'tip')
          AND cp.user_id != ${excludeUserId}
        ORDER BY cp.user_id, cp.created_at DESC
      ),
      user_crops AS (
        SELECT DISTINCT ON (p.user_id)
          p.user_id,
          p.crop
        FROM parcels p
        WHERE p.user_id != ${excludeUserId}
        ORDER BY p.user_id, p.created_at DESC
      )
      SELECT
        u.id             AS "userId",
        u.name,
        u.avatar_url     AS "avatarUrl",
        u.role,
        uc.crop,
        NULL::float      AS "avgNdvi",
        rp.post_id       AS "postId",
        rp.post_title    AS "postTitle",
        rp.post_excerpt  AS "postExcerpt"
      FROM ranked_posts rp
      JOIN users u ON u.id = rp.user_id AND u.is_active = true
      LEFT JOIN user_crops uc ON uc.user_id = u.id
      ORDER BY rp.post_id DESC
      LIMIT ${limit}
    `);
    return (result.rows as unknown as PeerMatchRow[]).map((r) => ({
      userId: r.userId,
      name: r.name,
      avatarUrl: r.avatarUrl ?? null,
      role: r.role,
      crop: r.crop ?? "variado",
      avgNdvi: null,
      postId: r.postId ?? null,
      postTitle: r.postTitle ?? null,
      postExcerpt: r.postExcerpt ?? null,
    }));
  }

  // Conference operations
  async getConferences(options: { limit?: number; offset?: number; status?: string; tag?: string; search?: string; featured?: boolean }): Promise<Conference[]> {
    const { limit = 20, offset = 0, status, tag, search, featured } = options;
    const conditions: any[] = [];

    if (status) {
      conditions.push(eq(schema.conferences.status, status));
    }
    if (tag) {
      conditions.push(sql`${schema.conferences.tags} @> ARRAY[${tag}]::text[]`);
    }
    if (search) {
      conditions.push(ilike(schema.conferences.title, `%${search}%`));
    }
    if (featured !== undefined) {
      conditions.push(eq(schema.conferences.isFeatured, featured));
    }

    const result = await db.query.conferences.findMany({
      where: conditions.length > 0 ? and(...conditions) : undefined,
      orderBy: [desc(schema.conferences.isFeatured), desc(schema.conferences.eventDate)],
      limit,
      offset,
    });
    return result;
  }

  async getConference(id: string): Promise<Conference | undefined> {
    const result = await db.query.conferences.findFirst({
      where: eq(schema.conferences.id, id),
    });
    return result;
  }

  async createConference(data: InsertConference): Promise<Conference> {
    const [conference] = await db.insert(schema.conferences).values(data as any).returning();
    return conference;
  }

  async updateConference(id: string, data: Partial<InsertConference>): Promise<Conference | undefined> {
    const [conference] = await db.update(schema.conferences).set({ ...data as any, updatedAt: new Date() }).where(eq(schema.conferences.id, id)).returning();
    return conference;
  }

  async deleteConference(id: string): Promise<boolean> {
    const result = await db.delete(schema.conferences).where(eq(schema.conferences.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async incrementConferenceViews(id: string): Promise<void> {
    await db.update(schema.conferences).set({ viewsCount: sql`${schema.conferences.viewsCount} + 1` }).where(eq(schema.conferences.id, id));
  }

  // Forum operations
  async getForumThreads(conferenceId: string): Promise<ForumThread[]> {
    const result = await db.query.forumThreads.findMany({
      where: eq(schema.forumThreads.conferenceId, conferenceId),
      orderBy: [desc(schema.forumThreads.isPinned), desc(schema.forumThreads.createdAt)],
    });
    return result;
  }

  async getForumThread(id: string): Promise<ForumThread | undefined> {
    const result = await db.query.forumThreads.findFirst({
      where: eq(schema.forumThreads.id, id),
    });
    return result;
  }

  async createForumThread(data: InsertForumThread): Promise<ForumThread> {
    const [thread] = await db.insert(schema.forumThreads).values(data as any).returning();
    return thread;
  }

  async deleteForumThread(id: string): Promise<boolean> {
    const result = await db.delete(schema.forumThreads).where(eq(schema.forumThreads.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async toggleForumThreadClosed(id: string): Promise<ForumThread | undefined> {
    const thread = await this.getForumThread(id);
    if (!thread) return undefined;
    const [updated] = await db.update(schema.forumThreads).set({ isClosed: !thread.isClosed, updatedAt: new Date() }).where(eq(schema.forumThreads.id, id)).returning();
    return updated;
  }

  async toggleForumThreadPinned(id: string): Promise<ForumThread | undefined> {
    const thread = await this.getForumThread(id);
    if (!thread) return undefined;
    const [updated] = await db.update(schema.forumThreads).set({ isPinned: !thread.isPinned, updatedAt: new Date() }).where(eq(schema.forumThreads.id, id)).returning();
    return updated;
  }

  async getForumReply(id: string): Promise<ForumReply | undefined> {
    return await db.query.forumReplies.findFirst({
      where: eq(schema.forumReplies.id, id),
    });
  }

  async getForumReplies(threadId: string): Promise<ForumReply[]> {
    const result = await db.query.forumReplies.findMany({
      where: eq(schema.forumReplies.threadId, threadId),
      orderBy: [asc(schema.forumReplies.createdAt)],
    });
    return result;
  }

  async createForumReply(data: InsertForumReply): Promise<ForumReply> {
    const [reply] = await db.insert(schema.forumReplies).values(data as any).returning();
    await db.update(schema.forumThreads).set({ repliesCount: sql`${schema.forumThreads.repliesCount} + 1`, updatedAt: new Date() }).where(eq(schema.forumThreads.id, data.threadId));
    return reply;
  }

  async deleteForumReply(id: string): Promise<boolean> {
    const reply = await db.query.forumReplies.findFirst({
      where: eq(schema.forumReplies.id, id),
    });
    if (!reply) return false;
    const result = await db.delete(schema.forumReplies).where(eq(schema.forumReplies.id, id));
    if (result.rowCount && result.rowCount > 0) {
      await db.update(schema.forumThreads).set({ repliesCount: sql`GREATEST(${schema.forumThreads.repliesCount} - 1, 0)`, updatedAt: new Date() }).where(eq(schema.forumThreads.id, reply.threadId));
      return true;
    }
    return false;
  }

  async getConferenceThreadCounts(conferenceIds: string[]): Promise<Record<string, number>> {
    if (conferenceIds.length === 0) return {};
    const result = await db.select({
      conferenceId: schema.forumThreads.conferenceId,
      count: sql<number>`count(*)::int`,
    }).from(schema.forumThreads)
      .where(sql`${schema.forumThreads.conferenceId} IN (${sql.join(conferenceIds.map(id => sql`${id}`), sql`, `)})`)
      .groupBy(schema.forumThreads.conferenceId);
    const counts: Record<string, number> = {};
    for (const row of result) {
      counts[row.conferenceId] = row.count;
    }
    return counts;
  }

  async getForumParticipants(conferenceId: string): Promise<{ id: string; name: string }[]> {
    const threadUserIds = await db.select({ userId: schema.forumThreads.userId })
      .from(schema.forumThreads)
      .where(eq(schema.forumThreads.conferenceId, conferenceId));

    const threads = await db.select({ id: schema.forumThreads.id })
      .from(schema.forumThreads)
      .where(eq(schema.forumThreads.conferenceId, conferenceId));

    const threadIds = threads.map(t => t.id);
    let replyUserIds: { userId: string }[] = [];
    if (threadIds.length > 0) {
      replyUserIds = await db.select({ userId: schema.forumReplies.userId })
        .from(schema.forumReplies)
        .where(sql`${schema.forumReplies.threadId} IN (${sql.join(threadIds.map(id => sql`${id}`), sql`, `)})`);
    }

    const allUserIds = Array.from(new Set([...threadUserIds.map(r => r.userId), ...replyUserIds.map(r => r.userId)]));
    const participants: { id: string; name: string }[] = [];
    for (const uid of allUserIds) {
      const u = await db.query.users.findFirst({ where: eq(schema.users.id, uid), columns: { id: true, name: true } });
      if (u) participants.push({ id: u.id, name: u.name });
    }
    return participants;
  }

  async getPlatformStats(): Promise<{ users: number; parcels: number; hectares: number; posts: number; conferences: number }> {
    const [usersResult] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.users);
    const [parcelsResult] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.parcels);
    const [hectaresResult] = await db.select({ total: sql<number>`COALESCE(sum(${schema.parcels.area}), 0)::numeric` }).from(schema.parcels);
    const [postsResult] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.communityPosts);
    const [conferencesResult] = await db.select({ count: sql<number>`count(*)::int` }).from(schema.conferences).where(eq(schema.conferences.status, "published"));
    return {
      users: usersResult.count,
      parcels: parcelsResult.count,
      hectares: Math.round(Number(hectaresResult.total)),
      posts: postsResult.count,
      conferences: conferencesResult.count,
    };
  }

  // IoT operations
  async getIotDevicesByParcel(parcelId: string): Promise<IotDevice[]> {
    return await db.select().from(schema.iotDevices).where(eq(schema.iotDevices.parcelId, parcelId)).orderBy(desc(schema.iotDevices.createdAt));
  }

  async createIotDevice(data: InsertIotDevice): Promise<IotDevice> {
    const [device] = await db.insert(schema.iotDevices).values(data).returning();
    return device;
  }

  async updateIotDeviceByUser(id: string, userId: string, data: Partial<InsertIotDevice>): Promise<IotDevice | undefined> {
    const [device] = await db.update(schema.iotDevices).set(data).where(and(eq(schema.iotDevices.id, id), eq(schema.iotDevices.userId, userId))).returning();
    return device;
  }

  async deleteIotDeviceByUser(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(schema.iotDevices).where(and(eq(schema.iotDevices.id, id), eq(schema.iotDevices.userId, userId))).returning();
    return result.length > 0;
  }

  async getIotReadings(deviceId: string, limit = 100): Promise<IotReading[]> {
    return await db.select().from(schema.iotReadings).where(eq(schema.iotReadings.deviceId, deviceId)).orderBy(desc(schema.iotReadings.timestamp)).limit(limit);
  }

  async createIotReading(data: InsertIotReading): Promise<IotReading> {
    const [reading] = await db.insert(schema.iotReadings).values(data).returning();
    return reading;
  }

  // Irrigation operations
  async getIrrigationLogsByParcel(parcelId: string): Promise<IrrigationLog[]> {
    return await db.select().from(schema.irrigationLogs).where(eq(schema.irrigationLogs.parcelId, parcelId)).orderBy(desc(schema.irrigationLogs.date));
  }

  async createIrrigationLog(data: InsertIrrigationLog): Promise<IrrigationLog> {
    const [log] = await db.insert(schema.irrigationLogs).values(data as any).returning();
    return log;
  }

  async deleteIrrigationLogByUser(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(schema.irrigationLogs).where(and(eq(schema.irrigationLogs.id, id), eq(schema.irrigationLogs.userId, userId))).returning();
    return result.length > 0;
  }

  // Drone flights operations
  async getDroneFlightsByParcel(parcelId: string): Promise<DroneFlight[]> {
    return await db.select().from(schema.droneFlights).where(eq(schema.droneFlights.parcelId, parcelId)).orderBy(desc(schema.droneFlights.flightDate));
  }

  async createDroneFlight(data: InsertDroneFlight): Promise<DroneFlight> {
    const [flight] = await db.insert(schema.droneFlights).values(data).returning();
    return flight;
  }

  async deleteDroneFlightByUser(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(schema.droneFlights).where(and(eq(schema.droneFlights.id, id), eq(schema.droneFlights.userId, userId))).returning();
    return result.length > 0;
  }

  // ─── Variable Management ────────────────────────────────────────────────────

  async getMasterVariables(): Promise<MasterVariable[]> {
    return await db.select().from(schema.masterVariables).where(eq(schema.masterVariables.isActive, true)).orderBy(asc(schema.masterVariables.name));
  }

  async getMasterVariable(id: string): Promise<MasterVariable | undefined> {
    const [v] = await db.select().from(schema.masterVariables).where(eq(schema.masterVariables.id, id));
    return v;
  }

  async getMasterVariableByCode(code: string): Promise<MasterVariable | undefined> {
    const [v] = await db.select().from(schema.masterVariables).where(eq(schema.masterVariables.code, code));
    return v;
  }

  async createMasterVariable(data: InsertMasterVariable): Promise<MasterVariable> {
    const [v] = await db.insert(schema.masterVariables).values(data as any).returning();
    return v;
  }

  async getSamplingCampaignsByParcel(parcelId: string): Promise<SamplingCampaign[]> {
    return await db.select().from(schema.samplingCampaigns)
      .where(eq(schema.samplingCampaigns.parcelId, parcelId))
      .orderBy(desc(schema.samplingCampaigns.createdAt));
  }

  async getSamplingCampaign(id: string): Promise<SamplingCampaign | undefined> {
    const [c] = await db.select().from(schema.samplingCampaigns).where(eq(schema.samplingCampaigns.id, id));
    return c;
  }

  async createSamplingCampaign(data: InsertSamplingCampaign): Promise<SamplingCampaign> {
    const [c] = await db.insert(schema.samplingCampaigns).values(data as any).returning();
    return c;
  }

  async updateSamplingCampaign(id: string, data: Partial<InsertSamplingCampaign>): Promise<SamplingCampaign | undefined> {
    const [c] = await db.update(schema.samplingCampaigns)
      .set({ ...(data as any), updatedAt: new Date() })
      .where(eq(schema.samplingCampaigns.id, id))
      .returning();
    return c;
  }

  async deleteSamplingCampaign(id: string): Promise<boolean> {
    const result = await db.delete(schema.samplingCampaigns).where(eq(schema.samplingCampaigns.id, id)).returning();
    return result.length > 0;
  }

  async getSamplingPointsByCampaign(campaignId: string): Promise<SamplingPoint[]> {
    return await db.select().from(schema.samplingPoints)
      .where(eq(schema.samplingPoints.campaignId, campaignId))
      .orderBy(asc(schema.samplingPoints.pointIndex));
  }

  async getSamplingPoint(id: string): Promise<SamplingPoint | undefined> {
    const [p] = await db.select().from(schema.samplingPoints).where(eq(schema.samplingPoints.id, id));
    return p;
  }

  async createSamplingPoint(data: InsertSamplingPoint): Promise<SamplingPoint> {
    const [p] = await db.insert(schema.samplingPoints).values(data as any).returning();
    return p;
  }

  async updateSamplingPoint(id: string, data: Partial<InsertSamplingPoint>): Promise<SamplingPoint | undefined> {
    const [p] = await db.update(schema.samplingPoints).set(data as any).where(eq(schema.samplingPoints.id, id)).returning();
    return p;
  }

  async bulkCreateSamplingPoints(points: InsertSamplingPoint[]): Promise<SamplingPoint[]> {
    if (points.length === 0) return [];
    return await db.insert(schema.samplingPoints).values(points as any[]).returning();
  }

  // Atomic multi-campaign import (Modo Oficina). Either every campaign and all
  // of its points are persisted, or nothing is. Implemented with a single
  // PostgreSQL transaction so a mid-flight crash cannot leave orphans.
  async transactionalLabImport(
    items: { campaign: InsertSamplingCampaign; points: Omit<InsertSamplingPoint, "campaignId">[] }[],
  ): Promise<SamplingCampaign[]> {
    if (items.length === 0) return [];
    return await db.transaction(async (tx) => {
      const created: SamplingCampaign[] = [];
      for (const item of items) {
        const [campaign] = await tx
          .insert(schema.samplingCampaigns)
          .values(item.campaign as any)
          .returning();
        if (item.points.length > 0) {
          await tx.insert(schema.samplingPoints).values(
            item.points.map((p) => ({ ...p, campaignId: campaign.id })) as any[],
          );
        }
        created.push(campaign);
      }
      return created;
    });
  }

  async deleteSamplingPoint(id: string): Promise<boolean> {
    const result = await db.delete(schema.samplingPoints).where(eq(schema.samplingPoints.id, id)).returning();
    return result.length > 0;
  }

  async deleteSamplingPointsByCampaign(campaignId: string): Promise<number> {
    const result = await db.delete(schema.samplingPoints)
      .where(eq(schema.samplingPoints.campaignId, campaignId))
      .returning();
    return result.length;
  }

  async getInterpolationResultsByCampaign(campaignId: string): Promise<InterpolationResult[]> {
    return await db.select().from(schema.interpolationResults)
      .where(eq(schema.interpolationResults.campaignId, campaignId))
      .orderBy(desc(schema.interpolationResults.createdAt));
  }

  async getInterpolationResult(id: string): Promise<InterpolationResult | undefined> {
    const [r] = await db.select().from(schema.interpolationResults).where(eq(schema.interpolationResults.id, id));
    return r;
  }

  async createInterpolationResult(data: InsertInterpolationResult): Promise<InterpolationResult> {
    const [r] = await db.insert(schema.interpolationResults).values(data as any).returning();
    return r;
  }

  async getManagementZonesByInterpolation(interpolationId: string): Promise<ManagementZone[]> {
    return await db.select().from(schema.managementZones)
      .where(eq(schema.managementZones.interpolationId, interpolationId))
      .orderBy(asc(schema.managementZones.zoneIndex));
  }

  async getManagementZonesByParcel(parcelId: string, source?: string): Promise<ManagementZone[]> {
    const where = source
      ? and(eq(schema.managementZones.parcelId, parcelId), eq(schema.managementZones.source, source))
      : eq(schema.managementZones.parcelId, parcelId);
    return await db.select().from(schema.managementZones)
      .where(where)
      .orderBy(desc(schema.managementZones.createdAt), asc(schema.managementZones.zoneIndex));
  }

  async getManagementZonesByZoneSet(zoneSetId: string): Promise<ManagementZone[]> {
    return await db.select().from(schema.managementZones)
      .where(eq(schema.managementZones.zoneSetId, zoneSetId))
      .orderBy(asc(schema.managementZones.zoneIndex));
  }

  async deleteManagementZonesByZoneSet(zoneSetId: string): Promise<boolean> {
    const result = await db.delete(schema.managementZones)
      .where(eq(schema.managementZones.zoneSetId, zoneSetId))
      .returning();
    return result.length > 0;
  }

  async getManagementZone(id: string): Promise<ManagementZone | undefined> {
    const [z] = await db.select().from(schema.managementZones).where(eq(schema.managementZones.id, id));
    return z;
  }

  async createManagementZone(data: InsertManagementZone): Promise<ManagementZone> {
    const [z] = await db.insert(schema.managementZones).values(toManagementZoneInsert(data)).returning();
    return z;
  }

  async updateManagementZone(id: string, data: Partial<InsertManagementZone>): Promise<ManagementZone | undefined> {
    const [z] = await db.update(schema.managementZones).set(data as any).where(eq(schema.managementZones.id, id)).returning();
    return z;
  }

  async bulkCreateManagementZones(zones: InsertManagementZone[]): Promise<ManagementZone[]> {
    if (zones.length === 0) return [];
    return await db.insert(schema.managementZones).values(zones.map(toManagementZoneInsert)).returning();
  }

  async deleteManagementZonesByInterpolation(interpolationId: string): Promise<boolean> {
    const result = await db.delete(schema.managementZones)
      .where(eq(schema.managementZones.interpolationId, interpolationId))
      .returning();
    return result.length > 0;
  }

  /**
   * Atomically replace all management zones for an interpolation.
   * The delete and insert happen inside a single DB transaction so a crash
   * between the two steps can never leave the interpolation with zero zones.
   */
  async replaceManagementZones(
    interpolationId: string,
    zones: schema.InsertManagementZone[],
  ): Promise<schema.ManagementZone[]> {
    if (zones.length === 0) {
      await db.delete(schema.managementZones)
        .where(eq(schema.managementZones.interpolationId, interpolationId));
      return [];
    }
    return await db.transaction(async (tx) => {
      await tx.delete(schema.managementZones)
        .where(eq(schema.managementZones.interpolationId, interpolationId));
      return await tx.insert(schema.managementZones).values(zones.map(toManagementZoneInsert)).returning();
    });
  }

  async getZonePrescriptionById(id: string): Promise<ZonePrescription | undefined> {
    const [row] = await db.select().from(schema.zonePrescriptions).where(eq(schema.zonePrescriptions.id, id));
    return row;
  }

  async getZonePrescriptionsByZone(zoneId: string): Promise<ZonePrescription[]> {
    return await db.select().from(schema.zonePrescriptions).where(eq(schema.zonePrescriptions.zoneId, zoneId));
  }

  async getZonePrescriptionsByInterpolation(interpolationId: string): Promise<ZonePrescription[]> {
    const zones = await this.getManagementZonesByInterpolation(interpolationId);
    if (zones.length === 0) return [];
    const zoneIds = zones.map(z => z.id);
    const results: ZonePrescription[] = [];
    for (const zid of zoneIds) {
      const presc = await this.getZonePrescriptionsByZone(zid);
      results.push(...presc);
    }
    return results;
  }

  async createZonePrescription(data: InsertZonePrescription): Promise<ZonePrescription> {
    const [p] = await db.insert(schema.zonePrescriptions).values(data as any).returning();
    return p;
  }

  async replaceUnappliedZonePrescriptions(prescriptions: InsertZonePrescription[]): Promise<ZonePrescription[] | null> {
    if (!prescriptions.length) return [];
    const zoneIds = prescriptions.map(p => p.zoneId).sort();
    return db.transaction(async tx => {
      await tx.select({ id: schema.managementZones.id }).from(schema.managementZones)
        .where(inArray(schema.managementZones.id, zoneIds)).orderBy(schema.managementZones.id).for("update");
      const existing = await tx.select({ id: schema.zonePrescriptions.id }).from(schema.zonePrescriptions)
        .where(inArray(schema.zonePrescriptions.zoneId, zoneIds)).for("update");
      if (existing.length) {
        const applied = await tx.select({ id: schema.prescriptionApplications.id }).from(schema.prescriptionApplications)
          .where(inArray(schema.prescriptionApplications.prescriptionId, existing.map(p => p.id))).limit(1);
        if (applied.length) return null;
        await tx.delete(schema.zonePrescriptions).where(inArray(schema.zonePrescriptions.zoneId, zoneIds));
      }
      return tx.insert(schema.zonePrescriptions).values(prescriptions as any[]).returning();
    });
  }

  async bulkCreateZonePrescriptions(prescriptions: InsertZonePrescription[]): Promise<ZonePrescription[]> {
    if (prescriptions.length === 0) return [];
    return await db.insert(schema.zonePrescriptions).values(prescriptions as any[]).returning();
  }

  async deleteZonePrescriptionsByZone(zoneId: string): Promise<boolean> {
    const result = await db.delete(schema.zonePrescriptions)
      .where(eq(schema.zonePrescriptions.zoneId, zoneId))
      .returning();
    return result.length > 0;
  }

  // Nutrition Programs
  async getNutritionProgramsByParcel(parcelId: string): Promise<NutritionProgram[]> {
    return await db.select().from(schema.nutritionPrograms)
      .where(eq(schema.nutritionPrograms.parcelId, parcelId))
      .orderBy(desc(schema.nutritionPrograms.createdAt));
  }

  async getNutritionProgram(id: string): Promise<NutritionProgram | undefined> {
    const [p] = await db.select().from(schema.nutritionPrograms)
      .where(eq(schema.nutritionPrograms.id, id));
    return p;
  }

  async createNutritionProgram(data: InsertNutritionProgram): Promise<NutritionProgram> {
    const [p] = await db.insert(schema.nutritionPrograms).values(data as any).returning();
    return p;
  }

  async updateNutritionProgram(id: string, data: Partial<InsertNutritionProgram>): Promise<NutritionProgram | undefined> {
    const [p] = await db.update(schema.nutritionPrograms)
      .set({ ...data, updatedAt: new Date() } as any)
      .where(eq(schema.nutritionPrograms.id, id))
      .returning();
    return p;
  }

  async deleteNutritionProgram(id: string): Promise<boolean> {
    const result = await db.delete(schema.nutritionPrograms)
      .where(eq(schema.nutritionPrograms.id, id))
      .returning();
    return result.length > 0;
  }

  async getNutritionProgramProducts(programId: string): Promise<NutritionProgramProduct[]> {
    return await db.select().from(schema.nutritionProgramProducts)
      .where(eq(schema.nutritionProgramProducts.programId, programId))
      .orderBy(asc(schema.nutritionProgramProducts.sortOrder));
  }

  async getNutritionProgramProduct(id: string): Promise<NutritionProgramProduct | undefined> {
    const [p] = await db.select().from(schema.nutritionProgramProducts)
      .where(eq(schema.nutritionProgramProducts.id, id));
    return p;
  }

  async createNutritionProgramProduct(data: InsertNutritionProgramProduct): Promise<NutritionProgramProduct> {
    const [p] = await db.insert(schema.nutritionProgramProducts).values(data as any).returning();
    return p;
  }

  async updateNutritionProgramProduct(id: string, data: Partial<InsertNutritionProgramProduct>): Promise<NutritionProgramProduct | undefined> {
    const [p] = await db.update(schema.nutritionProgramProducts)
      .set(data as any)
      .where(eq(schema.nutritionProgramProducts.id, id))
      .returning();
    return p;
  }

  async deleteNutritionProgramProduct(id: string): Promise<boolean> {
    const result = await db.delete(schema.nutritionProgramProducts)
      .where(eq(schema.nutritionProgramProducts.id, id))
      .returning();
    return result.length > 0;
  }

  async replaceNutritionProgramProducts(programId: string, items: InsertNutritionProgramProduct[]): Promise<NutritionProgramProduct[]> {
    await db.delete(schema.nutritionProgramProducts)
      .where(eq(schema.nutritionProgramProducts.programId, programId));
    if (items.length === 0) return [];
    const rows: InsertNutritionProgramProduct[] = items.map((it, idx) => ({
      ...it,
      programId,
      sortOrder: it.sortOrder ?? idx,
    }));
    return await db.insert(schema.nutritionProgramProducts).values(rows as any).returning();
  }

  // ── Zone Imports (T147) ────────────────────────────────────────────────────
  async createZoneImport(data: InsertZoneImport): Promise<ZoneImport> {
    const [row] = await db.insert(schema.zoneImports).values(data).returning();
    return row;
  }

  async getZoneImportsByParcel(parcelId: string): Promise<ZoneImport[]> {
    return await db.select().from(schema.zoneImports)
      .where(eq(schema.zoneImports.parcelId, parcelId))
      .orderBy(desc(schema.zoneImports.createdAt));
  }

  async getZoneImport(id: string): Promise<ZoneImport | undefined> {
    const [row] = await db.select().from(schema.zoneImports)
      .where(eq(schema.zoneImports.id, id));
    return row;
  }

  // ── Yield Records (T153) ──────────────────────────────────────────────────
  async getYieldRecordsByParcel(parcelId: string): Promise<YieldRecord[]> {
    return await db.select().from(schema.yieldRecords)
      .where(eq(schema.yieldRecords.parcelId, parcelId))
      .orderBy(desc(schema.yieldRecords.campaignYear), desc(schema.yieldRecords.createdAt));
  }

  async createYieldRecord(data: InsertYieldRecord): Promise<YieldRecord> {
    const [row] = await db.insert(schema.yieldRecords).values(data as any).returning();
    return row;
  }

  async deleteYieldRecord(id: string, userId: string, parcelId?: string): Promise<boolean> {
    const conditions = [eq(schema.yieldRecords.id, id), eq(schema.yieldRecords.userId, userId)];
    if (parcelId) conditions.push(eq(schema.yieldRecords.parcelId, parcelId));
    const result = await db.delete(schema.yieldRecords).where(and(...conditions));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // ── Prescription Applications (T155) ──────────────────────────────────────
  async getPrescriptionApplicationsByPrescription(prescriptionId: string): Promise<PrescriptionApplication[]> {
    return await db.select().from(schema.prescriptionApplications)
      .where(eq(schema.prescriptionApplications.prescriptionId, prescriptionId))
      .orderBy(desc(schema.prescriptionApplications.applicationDate));
  }

  async createPrescriptionApplication(data: InsertPrescriptionApplication): Promise<PrescriptionApplication> {
    const [row] = await db.insert(schema.prescriptionApplications).values({
      prescriptionId: data.prescriptionId,
      appliedBy: data.appliedBy,
      applicationDate: data.applicationDate,
      actualDoseByZone: data.actualDoseByZone,
      machineUsed: data.machineUsed ?? null,
      notes: data.notes ?? null,
    }).returning();
    return row;
  }

  async getPrescriptionApplicationsByInterpolation(interpolationId: string): Promise<PrescriptionApplication[]> {
    const zones = await db.select({ id: schema.managementZones.id })
      .from(schema.managementZones)
      .where(eq(schema.managementZones.interpolationId, interpolationId));
    if (zones.length === 0) return [];
    const prescriptions = await db.select({ id: schema.zonePrescriptions.id })
      .from(schema.zonePrescriptions)
      .where(inArray(schema.zonePrescriptions.zoneId, zones.map(z => z.id)));
    if (prescriptions.length === 0) return [];
    return await db.select().from(schema.prescriptionApplications)
      .where(inArray(schema.prescriptionApplications.prescriptionId, prescriptions.map(p => p.id)))
      .orderBy(desc(schema.prescriptionApplications.applicationDate));
  }

  // ── Soil Biology (T172) ───────────────────────────────────────────────────
  async getSoilBiologyByParcel(parcelId: string): Promise<SoilBiology[]> {
    return await db.select().from(schema.soilBiology)
      .where(eq(schema.soilBiology.parcelId, parcelId))
      .orderBy(desc(schema.soilBiology.sampleDate));
  }

  async getSoilBiology(id: string): Promise<SoilBiology | undefined> {
    const [row] = await db.select().from(schema.soilBiology)
      .where(eq(schema.soilBiology.id, id))
      .limit(1);
    return row;
  }

  async createSoilBiology(data: InsertSoilBiology): Promise<SoilBiology> {
    const [row] = await db.insert(schema.soilBiology).values({
      parcelId: data.parcelId,
      userId: data.userId,
      sampleDate: data.sampleDate,
      depthCm: data.depthCm ?? 20,
      dataSource: data.dataSource ?? "lab",
      mbc: data.mbc != null ? String(data.mbc) : null,
      mr: data.mr != null ? String(data.mr) : null,
      bg: data.bg != null ? String(data.bg) : null,
      nag: data.nag != null ? String(data.nag) : null,
      dnaYield: data.dnaYield != null ? String(data.dnaYield) : null,
      labFolio: data.labFolio ?? null,
      labName: data.labName ?? null,
      microbiologyMethod: data.microbiologyMethod ?? null,
      trichodermaCfu: data.trichodermaCfu == null ? null : String(data.trichodermaCfu),
      fusariumCfu: data.fusariumCfu == null ? null : String(data.fusariumCfu),
      bacillusCfu: data.bacillusCfu == null ? null : String(data.bacillusCfu),
      metarhiziumCfu: data.metarhiziumCfu == null ? null : String(data.metarhiziumCfu),
      metarhiziumStatus: data.metarhiziumStatus ?? null,
      beauveriaCfu: data.beauveriaCfu == null ? null : String(data.beauveriaCfu),
      beauveriaStatus: data.beauveriaStatus ?? null,
      nitrogenFixersStatus: data.nitrogenFixersStatus ?? null,
      notes: data.notes ?? null,
      aiInterpretation: data.aiInterpretation ?? null,
    }).returning();
    return row;
  }

  async deleteSoilBiology(id: string, userId: string): Promise<boolean> {
    const result = await db.delete(schema.soilBiology)
      .where(and(eq(schema.soilBiology.id, id), eq(schema.soilBiology.userId, userId)));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async deleteSoilBiologyById(id: string): Promise<boolean> {
    const result = await db.delete(schema.soilBiology)
      .where(eq(schema.soilBiology.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async updateSoilBiologyInterpretation(id: string, interpretation: string): Promise<SoilBiology | undefined> {
    const [row] = await db.update(schema.soilBiology)
      .set({ aiInterpretation: interpretation })
      .where(eq(schema.soilBiology.id, id))
      .returning();
    return row;
  }

  // ── T176: Parcel Setup Progress ─────────────────────────────────────────
  async getParcelSetupProgress(parcelId: string): Promise<ParcelSetupProgress | undefined> {
    const [row] = await db.select().from(schema.parcelSetupProgress)
      .where(eq(schema.parcelSetupProgress.parcelId, parcelId));
    return row;
  }

  async upsertParcelSetupProgress(parcelId: string, data: Partial<Omit<InsertParcelSetupProgress, "parcelId">>): Promise<ParcelSetupProgress> {
    const existing = await this.getParcelSetupProgress(parcelId);
    const now = new Date();
    if (existing) {
      const updated = { ...data, updatedAt: now } as any;
      // Auto-set completedAt when all steps done
      const merged = { ...existing, ...updated };
      if (merged.stepCycle && merged.stepSoil && merged.stepEconomy && merged.stepPractices && !existing.completedAt) {
        updated.completedAt = now;
      }
      const [row] = await db.update(schema.parcelSetupProgress)
        .set(updated)
        .where(eq(schema.parcelSetupProgress.parcelId, parcelId))
        .returning();
      return row;
    } else {
      const [row] = await db.insert(schema.parcelSetupProgress)
        .values({ parcelId, stepCycle: false, stepSoil: false, stepEconomy: false, stepPractices: false, ...data })
        .returning();
      return row;
    }
  }

  // ── T176: Crop Cycle Detail ────────────────────────────────────────────
  async getCropCycleDetailById(id: string): Promise<CropCycleDetail | undefined> {
    const [row] = await db.select().from(schema.cropCycleDetail)
      .where(eq(schema.cropCycleDetail.id, id));
    return row;
  }

  async getCropCycleDetails(parcelId: string): Promise<CropCycleDetail[]> {
    return db.select().from(schema.cropCycleDetail)
      .where(eq(schema.cropCycleDetail.parcelId, parcelId))
      .orderBy(desc(schema.cropCycleDetail.cycleYear), desc(schema.cropCycleDetail.createdAt));
  }

  async getLatestCropCycleDetail(parcelId: string): Promise<CropCycleDetail | undefined> {
    const [row] = await db.select().from(schema.cropCycleDetail)
      .where(eq(schema.cropCycleDetail.parcelId, parcelId))
      .orderBy(desc(schema.cropCycleDetail.cycleYear), desc(schema.cropCycleDetail.createdAt))
      .limit(1);
    return row;
  }

  async createCropCycleDetail(data: InsertCropCycleDetail): Promise<CropCycleDetail> {
    const insertData = {
      ...data,
      expectedYieldTon: data.expectedYieldTon != null ? String(data.expectedYieldTon) : null,
      targetPricePerTon: data.targetPricePerTon != null ? String(data.targetPricePerTon) : null,
      totalPlannedCost: data.totalPlannedCost != null ? String(data.totalPlannedCost) : null,
    };
    const [row] = await db.insert(schema.cropCycleDetail).values(insertData as any).returning();
    return row;
  }

  // Upsert: find existing record for (parcelId, cycleYear, cycleSeason) and merge non-null fields;
  // create if not found. This prevents multiple partial records per cycle.
  async upsertCropCycleDetail(data: InsertCropCycleDetail): Promise<CropCycleDetail> {
    const [existing] = await db.select().from(schema.cropCycleDetail)
      .where(
        and(
          eq(schema.cropCycleDetail.parcelId, data.parcelId),
          eq(schema.cropCycleDetail.cycleYear, data.cycleYear),
          eq(schema.cropCycleDetail.cycleSeason, data.cycleSeason)
        )
      )
      .orderBy(desc(schema.cropCycleDetail.createdAt))
      .limit(1);

    if (existing) {
      // Merge: only overwrite non-null/non-undefined incoming fields
      const updateData: Record<string, unknown> = { updatedAt: new Date() };
      for (const [key, val] of Object.entries(data)) {
        if (key === "parcelId" || key === "cycleYear" || key === "cycleSeason") continue;
        if (val !== null && val !== undefined) {
          if (key === "expectedYieldTon" || key === "targetPricePerTon" || key === "totalPlannedCost" || key === "actualYieldTon" || key === "actualPricePerTon" || key === "density") {
            updateData[key.replace(/([A-Z])/g, "_$1").toLowerCase()] = String(val);
          } else {
            updateData[key.replace(/([A-Z])/g, "_$1").toLowerCase()] = val;
          }
        }
      }
      // Use ORM column names directly for update
      const mergedFields: Record<string, unknown> = { updatedAt: new Date() };
      for (const [k, v] of Object.entries(data)) {
        if (k === "parcelId" || k === "cycleYear" || k === "cycleSeason") continue;
        if (v !== null && v !== undefined) {
          const numericFields = ["expectedYieldTon", "targetPricePerTon", "totalPlannedCost", "actualYieldTon", "actualPricePerTon", "density"];
          (mergedFields as any)[k] = numericFields.includes(k) ? String(v) : v;
        }
      }
      const [updated] = await db.update(schema.cropCycleDetail)
        .set(mergedFields as any)
        .where(eq(schema.cropCycleDetail.id, existing.id))
        .returning();
      return updated;
    }

    const insertData: Record<string, unknown> = { ...data };
    const numericFields = ["expectedYieldTon", "targetPricePerTon", "totalPlannedCost", "actualYieldTon", "actualPricePerTon", "density"];
    for (const f of numericFields) {
      if ((insertData as any)[f] != null) (insertData as any)[f] = String((insertData as any)[f]);
    }
    const [row] = await db.insert(schema.cropCycleDetail).values(insertData as any).returning();
    return row;
  }

  async updateCropCycleDetail(id: string, data: Partial<InsertCropCycleDetail>): Promise<CropCycleDetail | undefined> {
    const updateData: Record<string, unknown> = { ...data, updatedAt: new Date() };
    if (data.expectedYieldTon !== undefined) updateData.expectedYieldTon = data.expectedYieldTon != null ? String(data.expectedYieldTon) : null;
    if (data.targetPricePerTon !== undefined) updateData.targetPricePerTon = data.targetPricePerTon != null ? String(data.targetPricePerTon) : null;
    if (data.totalPlannedCost !== undefined) updateData.totalPlannedCost = data.totalPlannedCost != null ? String(data.totalPlannedCost) : null;
    if (data.actualYieldTon !== undefined) updateData.actualYieldTon = data.actualYieldTon != null ? String(data.actualYieldTon) : null;
    if (data.actualPricePerTon !== undefined) updateData.actualPricePerTon = data.actualPricePerTon != null ? String(data.actualPricePerTon) : null;
    const [row] = await db.update(schema.cropCycleDetail)
      .set(updateData as any)
      .where(eq(schema.cropCycleDetail.id, id))
      .returning();
    return row;
  }

  async deleteCropCycleDetail(id: string): Promise<boolean> {
    const result = await db.delete(schema.cropCycleDetail)
      .where(eq(schema.cropCycleDetail.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  // ── T176: Phenology Prompts ──────────────────────────────────────────────
  async getPhenologyPrompts(parcelId: string): Promise<PhenologyPrompt[]> {
    return db.select().from(schema.phenologyPrompts)
      .where(eq(schema.phenologyPrompts.parcelId, parcelId))
      .orderBy(asc(schema.phenologyPrompts.createdAt));
  }

  async getPhenologyPromptById(id: string): Promise<PhenologyPrompt | undefined> {
    const [row] = await db.select().from(schema.phenologyPrompts)
      .where(eq(schema.phenologyPrompts.id, id));
    return row;
  }

  async createPhenologyPrompt(data: InsertPhenologyPrompt): Promise<PhenologyPrompt> {
    const [row] = await db.insert(schema.phenologyPrompts).values(data).returning();
    return row;
  }

  async completePhenologyPrompt(id: string): Promise<PhenologyPrompt | undefined> {
    const [row] = await db.update(schema.phenologyPrompts)
      .set({ isCompleted: true, completedAt: new Date() })
      .where(eq(schema.phenologyPrompts.id, id))
      .returning();
    return row;
  }

  async updatePhenologyPromptDueDate(id: string, dueDate: Date): Promise<PhenologyPrompt | undefined> {
    const [row] = await db.update(schema.phenologyPrompts)
      .set({ dueDate })
      .where(eq(schema.phenologyPrompts.id, id))
      .returning();
    return row;
  }

  async deletePhenologyPrompt(id: string): Promise<boolean> {
    const result = await db.delete(schema.phenologyPrompts)
      .where(eq(schema.phenologyPrompts.id, id));
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async upsertAmendmentsSnapshot(parcelId: string, stateJson: string): Promise<void> {
    await db.insert(schema.amendmentsSnapshots)
      .values({ parcelId, stateJson, updatedAt: new Date() })
      .onConflictDoUpdate({
        target: schema.amendmentsSnapshots.parcelId,
        set: { stateJson, updatedAt: new Date() },
      });
  }

  async getAmendmentsSnapshot(parcelId: string): Promise<{ stateJson: string } | null> {
    const [row] = await db.select({ stateJson: schema.amendmentsSnapshots.stateJson })
      .from(schema.amendmentsSnapshots)
      .where(eq(schema.amendmentsSnapshots.parcelId, parcelId))
      .limit(1);
    return row ?? null;
  }

  // T250: Stage Observations
  async getStageObservationsByParcel(parcelId: string): Promise<ParcelStageObservation[]> {
    return db.query.parcelStageObservations.findMany({
      where: eq(schema.parcelStageObservations.parcelId, parcelId),
      orderBy: [desc(schema.parcelStageObservations.observedAt)],
    });
  }

  async createStageObservation(data: InsertParcelStageObservation): Promise<ParcelStageObservation> {
    const values = {
      ...data,
      avgTemperature: data.avgTemperature == null ? data.avgTemperature : String(data.avgTemperature),
      precipitationMm: data.precipitationMm == null ? data.precipitationMm : String(data.precipitationMm),
      ndviObserved: data.ndviObserved == null ? data.ndviObserved : String(data.ndviObserved),
    };
    const [row] = await db.insert(schema.parcelStageObservations).values(values).returning();
    return row;
  }

  async deleteStageObservation(id: string, parcelId: string): Promise<boolean> {
    const result = await db.delete(schema.parcelStageObservations)
      .where(and(
        eq(schema.parcelStageObservations.id, id),
        eq(schema.parcelStageObservations.parcelId, parcelId),
      ));
    return ((result as any).rowCount ?? 0) > 0;
  }

  async getMexicoSoilSamples(lat: number, lng: number, radiusKm: number): Promise<schema.MexicoSoilSample[]> {
    const clampedRadius = Math.min(Math.max(radiusKm, 10), 200);
    const rows = await db.select()
      .from(schema.mexicoSoilSamples)
      .where(sql`
        6371.0 * 2.0 * ASIN(SQRT(
          POWER(SIN((RADIANS(lat::float8) - RADIANS(${lat})) / 2.0), 2) +
          COS(RADIANS(${lat})) * COS(RADIANS(lat::float8)) *
          POWER(SIN((RADIANS(lng::float8) - RADIANS(${lng})) / 2.0), 2)
        )) <= ${clampedRadius}
      `)
      .limit(500);
    return rows;
  }

  async getMexicoSoilSampleCount(): Promise<number> {
    const [row] = await db.select({ count: sql<number>`COUNT(*)::int` })
      .from(schema.mexicoSoilSamples);
    return row?.count ?? 0;
  }

  async getMexicoSoilInBbox(variable: string, minLat: number, maxLat: number, minLng: number, maxLng: number): Promise<{ lat: number; lng: number; value: number; estado: string | null }[]> {
    const COL_MAP: Record<string, string> = {
      pH: "ph", CE: "ce", MO: "mo", N: "n", P: "p", K: "k",
      Ca: "ca", Mg: "mg", Fe: "fe", Zn: "zn", Cu: "cu", Mn: "mn",
      B: "b", CIC: "cic", Na: "na",
    };
    const col = COL_MAP[variable];
    if (!col) return [];
    const rows = await db.select({
      lat: schema.mexicoSoilSamples.lat,
      lng: schema.mexicoSoilSamples.lng,
      value: sql<string>`${sql.raw(col)}`,
      estado: schema.mexicoSoilSamples.estado,
    })
      .from(schema.mexicoSoilSamples)
      .where(and(
        sql`${sql.raw(col)} IS NOT NULL`,
        sql`${schema.mexicoSoilSamples.lat}::float8 BETWEEN ${minLat} AND ${maxLat}`,
        sql`${schema.mexicoSoilSamples.lng}::float8 BETWEEN ${minLng} AND ${maxLng}`,
      ));
    return rows
      .map(r => ({
        lat: parseFloat(r.lat as string),
        lng: parseFloat(r.lng as string),
        value: parseFloat(r.value),
        estado: r.estado ?? null,
      }))
      .filter(r => isFinite(r.lat) && isFinite(r.lng) && isFinite(r.value));
  }

  async getMexicoSoilForInterpolation(variable: string, estado?: string): Promise<{ lat: number; lng: number; value: number; municipio: string | null; estado: string | null; labNumber: string | null; localidad: string | null; loteu: string | null; ph: number | null; ce: number | null; dap: number | null; mo: number | null; n: number | null; p: number | null; k: number | null; ca: number | null; mg: number | null; fe: number | null; zn: number | null; b: number | null; mn: number | null; cu: number | null; na: number | null; cic: number | null; arcilla: number | null; limo: number | null; arena: number | null; textura: string | null }[]> {
    const COL_MAP: Record<string, string> = {
      pH: "ph", CE: "ce", MO: "mo", N: "n", P: "p", K: "k",
      Ca: "ca", Mg: "mg", Fe: "fe", Zn: "zn", Cu: "cu", Mn: "mn",
      B: "b", CIC: "cic", Na: "na",
    };
    const col = COL_MAP[variable];
    if (!col) return [];
    const conditions: SQL[] = [sql`${sql.raw(col)} IS NOT NULL`];
    if (estado && estado.trim()) {
      conditions.push(sql`estado = ${estado.trim()}`);
    }
    const rows = await db.select({
      lat: schema.mexicoSoilSamples.lat,
      lng: schema.mexicoSoilSamples.lng,
      value: sql<string>`${sql.raw(col)}`,
      municipio: schema.mexicoSoilSamples.municipio,
      estado: schema.mexicoSoilSamples.estado,
      labNumber: schema.mexicoSoilSamples.labNumber,
      localidad: schema.mexicoSoilSamples.localidad,
      loteu: schema.mexicoSoilSamples.loteu,
      ph:   schema.mexicoSoilSamples.ph,
      ce:   schema.mexicoSoilSamples.ce,
      dap:  schema.mexicoSoilSamples.dap,
      mo:   schema.mexicoSoilSamples.mo,
      n:    schema.mexicoSoilSamples.n,
      p:    schema.mexicoSoilSamples.p,
      k:    schema.mexicoSoilSamples.k,
      ca:   schema.mexicoSoilSamples.ca,
      mg:   schema.mexicoSoilSamples.mg,
      fe:   schema.mexicoSoilSamples.fe,
      zn:   schema.mexicoSoilSamples.zn,
      b:    schema.mexicoSoilSamples.b,
      mn:   schema.mexicoSoilSamples.mn,
      cu:   schema.mexicoSoilSamples.cu,
      na:   schema.mexicoSoilSamples.na,
      cic:  schema.mexicoSoilSamples.cic,
      arcilla: schema.mexicoSoilSamples.arcilla,
      limo:    schema.mexicoSoilSamples.limo,
      arena:   schema.mexicoSoilSamples.arena,
      textura: schema.mexicoSoilSamples.textura,
    })
      .from(schema.mexicoSoilSamples)
      .where(and(...conditions));
    const parseDec = (v: unknown): number | null => {
      if (v == null) return null;
      const f = parseFloat(v as string);
      return isFinite(f) ? f : null;
    };
    return rows
      .map(r => ({
        lat: parseFloat(r.lat as string),
        lng: parseFloat(r.lng as string),
        value: parseFloat(r.value),
        municipio: r.municipio ?? null,
        estado: r.estado ?? null,
        labNumber: r.labNumber ?? null,
        localidad: r.localidad ?? null,
        loteu: r.loteu ?? null,
        ph: parseDec(r.ph),
        ce: parseDec(r.ce),
        dap: parseDec(r.dap),
        mo: parseDec(r.mo),
        n: parseDec(r.n),
        p: parseDec(r.p),
        k: parseDec(r.k),
        ca: parseDec(r.ca),
        mg: parseDec(r.mg),
        fe: parseDec(r.fe),
        zn: parseDec(r.zn),
        b: parseDec(r.b),
        mn: parseDec(r.mn),
        cu: parseDec(r.cu),
        na: parseDec(r.na),
        cic: parseDec(r.cic),
        arcilla: parseDec(r.arcilla),
        limo: parseDec(r.limo),
        arena: parseDec(r.arena),
        textura: r.textura ?? null,
      }))
      .filter(r => isFinite(r.lat) && isFinite(r.lng) && isFinite(r.value));
  }

  async getMexicoEstados(): Promise<string[]> {
    const rows = await db.selectDistinct({ estado: schema.mexicoSoilSamples.estado })
      .from(schema.mexicoSoilSamples)
      .where(sql`estado IS NOT NULL`)
      .orderBy(schema.mexicoSoilSamples.estado);
    return rows.map(r => r.estado!).filter(Boolean);
  }

  async getMexicoRasterCache(estado: string, variable: string): Promise<Record<string, unknown> | null> {
    const rows = await db.select()
      .from(schema.mexicoSoilRasterCache)
      .where(and(
        eq(schema.mexicoSoilRasterCache.estado, estado),
        eq(schema.mexicoSoilRasterCache.variable, variable),
      ))
      .limit(1);
    if (!rows.length) return null;
    return rows[0].result as Record<string, unknown>;
  }

  async setMexicoRasterCache(estado: string, variable: string, result: Record<string, unknown>): Promise<void> {
    await db.insert(schema.mexicoSoilRasterCache)
      .values({ estado, variable, result, cachedAt: new Date() })
      .onConflictDoUpdate({
        target: [schema.mexicoSoilRasterCache.estado, schema.mexicoSoilRasterCache.variable],
        set: { result, cachedAt: new Date() },
      });
  }

  async getMexicoRasterCacheStatus(): Promise<{ estado: string; variable: string; cachedAt: Date }[]> {
    const rows = await db.select({
      estado: schema.mexicoSoilRasterCache.estado,
      variable: schema.mexicoSoilRasterCache.variable,
      cachedAt: schema.mexicoSoilRasterCache.cachedAt,
    }).from(schema.mexicoSoilRasterCache)
      .orderBy(schema.mexicoSoilRasterCache.estado, schema.mexicoSoilRasterCache.variable);
    return rows.map(r => ({ estado: r.estado, variable: r.variable, cachedAt: r.cachedAt! }));
  }

  async clearMexicoRasterCache(estado?: string, variable?: string): Promise<number> {
    const conditions = [];
    if (estado)   conditions.push(eq(schema.mexicoSoilRasterCache.estado, estado));
    if (variable) conditions.push(eq(schema.mexicoSoilRasterCache.variable, variable));
    const result = await db.delete(schema.mexicoSoilRasterCache)
      .where(conditions.length ? and(...conditions) : undefined);
    return (result as unknown as { rowCount: number }).rowCount ?? 0;
  }
}

export const storage = new DbStorage();
