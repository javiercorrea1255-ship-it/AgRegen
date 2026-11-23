import { useState, useRef, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { apiRequest } from "@/lib/queryClient";
import { Link } from "wouter";
import { Bot, Send, User, Loader2, MessageSquare, Plus, ThumbsUp, Sparkles, Cpu, FlaskConical, ChevronDown, ChevronRight, BookOpen, TrendingUp, TrendingDown, Minus, FileDown, Camera, X, Brain, Trash2, Search, CheckCircle2, Microscope, Phone, Link2, Copy, Unlink, BellRing, CloudRain, Wind, ThermometerSun, Clock3, AlertTriangle } from "lucide-react";
import { exportReportPDF, type PaperRef } from "@/lib/export-pdf";
import { format } from "date-fns";
import { es } from "date-fns/locale";
import { useI18n } from "@/lib/i18n-context";
import ReactMarkdown from "react-markdown";

interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageUrl?: string | null;
  createdAt: string;
  contextSnapshot?: {
    reasoningSteps?: ReasoningStep[];
    [key: string]: unknown;
  } | null;
}

interface Conversation {
  id: string;
  title: string | null;
  aiProvider: string;
  createdAt: string;
  updatedAt: string;
}

interface AIProvider {
  id: "openai";
  name: string;
  description: string;
  available: boolean;
  message?: string;
}

interface AIChatProps {
  parcelId: string;
  parcelName: string;
  crop: string;
}

interface WhatsappStatus {
  configured: boolean;
  phoneNumberConfigured: boolean;
  accessTokenConfigured: boolean;
  appSecretConfigured: boolean;
  alertTemplateConfigured: boolean;
  connection: {
    id: string;
    status: "pending" | "verified" | "revoked";
    phoneNumber: string | null;
    parcelId: string;
    verifiedAt: string | null;
    lastMessageAt: string | null;
  } | null;
}

interface WhatsappAlertsPreference {
  enabled: boolean;
  alertTypes: string[];
  thresholds: { frost: number; rain: number; wind: number; heat: number };
  timezone: string;
  quietHoursStart: string;
  quietHoursEnd: string;
  dailyCap: number;
  lastEvaluatedAt?: string | null;
  lastSentAt?: string | null;
  lastError?: string | null;
}

interface WhatsappAlertsResponse {
  preference: WhatsappAlertsPreference | null;
  connection: { id: string; status: string; parcelId: string } | null;
}

const alertDefinitions = [
  { id: "frost", label: "Helada", description: "Temperatura mínima bajo el umbral", unit: "°C", Icon: ThermometerSun },
  { id: "rain", label: "Lluvia", description: "Precipitación prevista sobre el umbral", unit: "mm", Icon: CloudRain },
  { id: "wind", label: "Viento", description: "Velocidad máxima prevista sobre el umbral", unit: "km/h", Icon: Wind },
  { id: "heat", label: "Calor", description: "Temperatura máxima sobre el umbral", unit: "°C", Icon: ThermometerSun },
] as const;

const defaultAlertPreference: WhatsappAlertsPreference = {
  enabled: false,
  alertTypes: ["frost", "rain", "wind", "heat"],
  thresholds: { frost: 2, rain: 20, wind: 45, heat: 35 },
  timezone: "America/Mexico_City",
  quietHoursStart: "22:00",
  quietHoursEnd: "07:00",
  dailyCap: 3,
};

interface ScientificPaper {
  title: string;
  abstract: string | null;
  authors: string;
  year: number | null;
  doi: string | null;
  url: string;
  citationCount: number;
}

interface ReasoningStep {
  tool: string;
  label: string;
  input: Record<string, unknown>;
  output: unknown;
  kind?: "search" | "index" | "trend" | "regional";
}

interface IndiceInterpretacion {
  indice: string;
  valor: number;
  cultivo: string;
  etapa: string;
  nivel: string;
  rangoEsperado: string;
  interpretacion: string;
  accion: string;
}

interface HistorialTendencia {
  indice: string;
  puntos: number;
  ultimoValor: number | null;
  valorBase: number | null;
  cambioRelativoPct: number | null;
  tendencia: string;
  observacion: string;
}

interface RegionalComparacion {
  variable: string;
  estado: string | null;
  valor: number;
  percentil: number;
  media: number;
  mediana: number;
  n: number;
  observacion: string;
}

export function AIChat({ parcelId, parcelName, crop }: AIChatProps) {
  const [selectedConversationId, setSelectedConversationId] = useState<string | null>(null);
  const [inputMessage, setInputMessage] = useState("");
  const [deepMode, setDeepMode] = useState(false);
  const [reasoningStepsMap, setReasoningStepsMap] = useState<Record<string, ReasoningStep[]>>({});
  const [expandedReasoning, setExpandedReasoning] = useState<Set<string>>(new Set());
  const [selectedImage, setSelectedImage] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [diagnosisMode, setDiagnosisMode] = useState(false);
  const [showWhatsapp, setShowWhatsapp] = useState(false);
  const [whatsappCode, setWhatsappCode] = useState<string | null>(null);
  const [whatsappExpiresAt, setWhatsappExpiresAt] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();
  const { t } = useI18n();

  const { data: aiProviders = [] } = useQuery<AIProvider[]>({
    queryKey: ["/api/ai-providers"],
  });

  const { data: conversations = [], isLoading: loadingConversations } = useQuery<Conversation[]>({
    queryKey: [`/api/parcels/${parcelId}/conversations`],
  });

  const { data: messages = [], isLoading: loadingMessages } = useQuery<ChatMessage[]>({
    queryKey: [`/api/conversations/${selectedConversationId}/messages`],
    enabled: !!selectedConversationId,
  });

  const selectedConversation = conversations.find(c => c.id === selectedConversationId);

  const { data: whatsappStatus } = useQuery<WhatsappStatus>({
    queryKey: ["/api/whatsapp/status"],
    staleTime: 15_000,
  });

  const whatsappIsUsable =
    whatsappStatus?.connection?.status === "verified" &&
    whatsappStatus.connection.parcelId === parcelId;
  const { data: whatsappAlerts, isLoading: loadingWhatsappAlerts, isError: whatsappAlertsError } =
    useQuery<WhatsappAlertsResponse>({
      queryKey: ["/api/whatsapp/alerts"],
      enabled: whatsappIsUsable,
      staleTime: 30_000,
    });
  const [alertPreference, setAlertPreference] = useState<WhatsappAlertsPreference>(defaultAlertPreference);
  const [alertsInitialized, setAlertsInitialized] = useState(false);

  useEffect(() => {
    if (whatsappAlerts?.preference && !alertsInitialized) {
      setAlertPreference({
        ...defaultAlertPreference,
        ...whatsappAlerts.preference,
        thresholds: { ...defaultAlertPreference.thresholds, ...whatsappAlerts.preference.thresholds },
      });
      setAlertsInitialized(true);
    }
  }, [whatsappAlerts, alertsInitialized]);

  useEffect(() => {
    if (!whatsappIsUsable) {
      setAlertsInitialized(false);
      setAlertPreference(defaultAlertPreference);
    }
  }, [whatsappIsUsable]);

  const saveWhatsappAlertsMutation = useMutation({
    mutationFn: async (preference: WhatsappAlertsPreference) => {
      const res = await apiRequest("PATCH", "/api/whatsapp/alerts", {
        enabled: preference.enabled,
        alertTypes: preference.alertTypes,
        thresholds: preference.thresholds,
        timezone: preference.timezone,
        quietHoursStart: preference.quietHoursStart,
        quietHoursEnd: preference.quietHoursEnd,
        dailyCap: preference.dailyCap,
      });
      return res.json() as Promise<{ preference: WhatsappAlertsPreference }>;
    },
    onSuccess: (data) => {
      setAlertPreference(current => ({ ...current, ...data.preference, thresholds: { ...current.thresholds, ...data.preference.thresholds } }));
      queryClient.setQueryData<WhatsappAlertsResponse>(["/api/whatsapp/alerts"], current =>
        current ? { ...current, preference: data.preference } : current,
      );
    },
  });

  const startWhatsappLinkMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/whatsapp/link/start", { parcelId });
      return res.json();
    },
    onSuccess: (data) => {
      setWhatsappCode(data.code);
      setWhatsappExpiresAt(data.expiresAt);
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/status"] });
    },
  });

  const selectWhatsappParcelMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", "/api/whatsapp/connection/parcel", { parcelId });
      return res.json();
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/status"] }),
  });

  const unlinkWhatsappMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/whatsapp/connection", { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("No se pudo desvincular WhatsApp");
      return res.json();
    },
    onSuccess: () => {
      setWhatsappCode(null);
      queryClient.invalidateQueries({ queryKey: ["/api/whatsapp/status"] });
    },
  });

  const createConversationMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", `/api/parcels/${parcelId}/conversations`, { aiProvider: "openai" });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [`/api/parcels/${parcelId}/conversations`] });
      setSelectedConversationId(data.id);
    },
  });

  const pendingWebRequest = useRef<{ key: string; id: string } | null>(null);
  const sendMessageMutation = useMutation({
    mutationFn: async ({ message, imageUrl, requestId }: { message: string; imageUrl?: string; requestId: string }) => {
      const res = await apiRequest("POST", `/api/conversations/${selectedConversationId}/messages`, {
        message,
        deepMode,
        diagnosisMode: diagnosisMode && !!imageUrl,
        imageUrl,
        requestId,
      });
      return res.json();
    },
    onSuccess: (data) => {
      pendingWebRequest.current = null;
      queryClient.invalidateQueries({ queryKey: ["/api/parcels", parcelId, "field-logs"] });
      queryClient.invalidateQueries({ predicate: query => query.queryKey.some(key => typeof key === "string" && /field-logs|production-costs/.test(key)) });
      if (data.reasoningSteps?.length > 0 && data.assistantMessage?.id) {
        setReasoningStepsMap(prev => ({
          ...prev,
          [data.assistantMessage.id]: data.reasoningSteps,
        }));
      }
      queryClient.invalidateQueries({ queryKey: [`/api/conversations/${selectedConversationId}/messages`] });
      queryClient.invalidateQueries({ queryKey: [`/api/parcels/${parcelId}/conversations`] });
      setInputMessage("");
      setSelectedImage(null);
      setImagePreviewUrl(null);
      setDiagnosisMode(false);
    },
  });

  const handleImageSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setSelectedImage(file);
    const url = URL.createObjectURL(file);
    setImagePreviewUrl(url);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const clearImage = () => {
    setSelectedImage(null);
    if (imagePreviewUrl) URL.revokeObjectURL(imagePreviewUrl);
    setImagePreviewUrl(null);
    setDiagnosisMode(false);
  };

  const { data: memoryData, refetch: refetchMemory } = useQuery<{ summary: string; updatedAt: string | null }>({
    queryKey: [`/api/parcels/${parcelId}/memory`],
    staleTime: 30_000,
  });

  const clearMemoryMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/parcels/${parcelId}/memory`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Error al borrar memoria");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/parcels/${parcelId}/memory`] });
    },
  });

  const markHelpfulMutation = useMutation({
    mutationFn: async ({ messageId, recommendation }: { messageId: string; recommendation: string }) => {
      const res = await apiRequest("POST", `/api/conversations/${selectedConversationId}/helpful`, {
        messageId,
        recommendation: recommendation.slice(0, 500),
      });
      return res.json();
    },
  });

  // Restore reasoning steps from contextSnapshot when messages load from the server
  // so the panel survives page reloads.
  useEffect(() => {
    if (!messages || messages.length === 0) return;
    setReasoningStepsMap(prev => {
      const updates: Record<string, ReasoningStep[]> = {};
      for (const msg of messages) {
        if (
          msg.role === "assistant" &&
          msg.contextSnapshot?.reasoningSteps &&
          msg.contextSnapshot.reasoningSteps.length > 0 &&
          !prev[msg.id]
        ) {
          updates[msg.id] = msg.contextSnapshot.reasoningSteps;
        }
      }
      if (Object.keys(updates).length === 0) return prev;
      return { ...prev, ...updates };
    });
  }, [messages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const compressImageToBase64 = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const MAX = 1024;
        let { width, height } = img;
        if (width > MAX || height > MAX) {
          const ratio = Math.min(MAX / width, MAX / height);
          width = Math.round(width * ratio);
          height = Math.round(height * ratio);
        }
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        canvas.getContext("2d")!.drawImage(img, 0, 0, width, height);
        resolve(canvas.toDataURL("image/jpeg", 0.85));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("No se pudo leer la imagen")); };
      img.src = url;
    });

  const handleSend = async () => {
    if ((!inputMessage.trim() && !selectedImage) || !selectedConversationId) return;
    let imageUrl: string | undefined;
    if (selectedImage) {
      setIsUploadingImage(true);
      try {
        imageUrl = await compressImageToBase64(selectedImage);
      } catch (err) {
        console.error("Image compression failed:", err);
      } finally {
        setIsUploadingImage(false);
      }
    }
    const key = JSON.stringify([selectedConversationId, inputMessage, imageUrl, deepMode, diagnosisMode]);
    if (pendingWebRequest.current?.key !== key) pendingWebRequest.current = { key, id: crypto.randomUUID() };
    sendMessageMutation.mutate({ message: inputMessage, imageUrl, requestId: pendingWebRequest.current!.id });
  };

  const handleNewConversation = () => {
    createConversationMutation.mutate();
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const toggleReasoning = (msgId: string) => {
    setExpandedReasoning(prev => {
      const next = new Set(prev);
      if (next.has(msgId)) next.delete(msgId);
      else next.add(msgId);
      return next;
    });
  };

  const nivelColor: Record<string, string> = {
    crítico: "text-red-600",
    bajo: "text-orange-500",
    normal: "text-yellow-600",
    bueno: "text-green-600",
    óptimo: "text-emerald-600",
  };

  const tendenciaIcon = (t: string) => {
    if (t === "mejorando") return <TrendingUp className="h-3 w-3 text-green-600" />;
    if (t === "deteriorando") return <TrendingDown className="h-3 w-3 text-red-500" />;
    return <Minus className="h-3 w-3 text-yellow-500" />;
  };

  const [showSidebar, setShowSidebar] = useState(false);
  const [showMemory, setShowMemory] = useState(false);

  return (
    <div className="relative flex flex-col h-[400px] md:h-[600px] bg-background rounded-lg border overflow-hidden">
      <div className="flex flex-1 min-h-0">
        {showSidebar && (
          <div
            className="md:hidden fixed inset-0 bg-black/50 z-30"
            onClick={() => setShowSidebar(false)}
          />
        )}

        <div className={`${showSidebar ? 'absolute inset-y-0 left-0 z-40 w-64 bg-background shadow-lg' : 'hidden'} md:block md:relative md:w-48 lg:w-64 border-r flex flex-col overflow-y-auto`}>
          <div className="flex items-center justify-between p-3 border-b">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              {t("aiChat.conversations")}
            </h3>
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10"
                onClick={() => handleNewConversation()}
                disabled={createConversationMutation.isPending}
                data-testid="btn-new-conversation"
              >
                <Plus className="h-5 w-5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-10 w-10 md:hidden"
                onClick={() => setShowSidebar(false)}
              >
                ✕
              </Button>
            </div>
          </div>
          {/* WhatsApp connection */}
          <div className="border-b">
            <button
              className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-muted/50 transition-colors"
              onClick={() => setShowWhatsapp(v => !v)}
              data-testid="btn-toggle-whatsapp"
            >
              <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
                <Phone className="h-3.5 w-3.5 text-green-600" />
                WhatsApp
                {whatsappStatus?.connection?.status === "verified" && (
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500" />
                )}
              </span>
              {showWhatsapp ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
            {showWhatsapp && (
              <div className="px-3 pb-3 space-y-2 text-[11px]">
                {!whatsappStatus?.configured && (
                  <div className="rounded-md border border-amber-200 bg-amber-50 p-2 text-amber-800">
                    Falta autorizar WhatsApp Business en Replit y configurar el número de Meta.
                  </div>
                )}
                {whatsappStatus?.connection?.status === "verified" ? (
                  <>
                    <div className="rounded-md border border-green-200 bg-green-50 p-2 text-green-800">
                      <p className="font-semibold flex items-center gap-1">
                        <CheckCircle2 className="h-3 w-3" /> Vinculado {whatsappStatus.connection.phoneNumber}
                      </p>
                      <p className="mt-0.5">
                        {whatsappStatus.connection.parcelId === parcelId
                          ? `Contexto activo: ${parcelName}`
                          : "Está usando otra parcela como contexto."}
                      </p>
                    </div>
                    {whatsappStatus.connection.parcelId !== parcelId && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-8 w-full text-xs"
                        onClick={() => selectWhatsappParcelMutation.mutate()}
                        disabled={selectWhatsappParcelMutation.isPending}
                        data-testid="btn-whatsapp-use-parcel"
                      >
                        {selectWhatsappParcelMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Link2 className="h-3 w-3 mr-1" />}
                        Usar {parcelName}
                      </Button>
                    )}
                    {whatsappIsUsable && (
                      <div className="mt-2 rounded-lg border border-emerald-200/80 bg-emerald-50/60 p-2.5 text-[11px] text-emerald-950">
                        <div className="flex items-start justify-between gap-2">
                          <div>
                            <p className="flex items-center gap-1.5 font-semibold text-emerald-900">
                              <BellRing className="h-3.5 w-3.5" /> Avisos preventivos del campo
                            </p>
                            <p className="mt-1 leading-relaxed text-emerald-800/80">
                              Recibe una señal cuando el pronóstico anticipe condiciones que merecen revisar en {parcelName}.
                              Son estimaciones preventivas, no confirmaciones de lo que ocurre en el lote.
                            </p>
                          </div>
                          <Switch
                            checked={alertPreference.enabled}
                            onCheckedChange={enabled => setAlertPreference(current => ({ ...current, enabled }))}
                            disabled={loadingWhatsappAlerts || saveWhatsappAlertsMutation.isPending}
                            aria-label="Activar avisos preventivos"
                            data-testid="switch-whatsapp-alerts"
                          />
                        </div>
                        {!whatsappStatus.alertTemplateConfigured && (
                          <div className="mt-2 rounded border border-amber-200 bg-amber-50 p-2 text-amber-800">
                            Falta aprobar y configurar la plantilla de Meta para enviar estas alertas fuera de una conversación activa.
                          </div>
                        )}
                        {loadingWhatsappAlerts ? (
                          <div className="mt-3 space-y-2">
                            <div className="h-3 w-2/3 animate-pulse rounded bg-emerald-200/70" />
                            <div className="h-8 w-full animate-pulse rounded bg-emerald-200/50" />
                            <div className="h-8 w-full animate-pulse rounded bg-emerald-200/50" />
                          </div>
                        ) : whatsappAlertsError ? (
                          <div className="mt-3 flex items-center gap-1.5 rounded border border-red-200 bg-red-50 p-2 text-red-800">
                            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
                            No se pudieron cargar los criterios. Cierra y vuelve a abrir esta sección para reintentar.
                          </div>
                        ) : (
                          <>
                            <div className="mt-3 space-y-1.5">
                              <p className="font-semibold uppercase tracking-[0.08em] text-[9px] text-emerald-900/70">Condiciones a vigilar</p>
                              {alertDefinitions.map(({ id, label, description, unit, Icon }) => {
                                const active = alertPreference.alertTypes.includes(id);
                                return (
                                  <div key={id} className={`rounded-md border p-2 transition-colors ${active ? "border-emerald-200 bg-background/70" : "border-transparent bg-emerald-100/40"}`}>
                                    <div className="flex items-center gap-2">
                                      <Icon className="h-3.5 w-3.5 shrink-0 text-emerald-700" />
                                      <button
                                        type="button"
                                        className="min-w-0 flex-1 text-left"
                                        onClick={() => setAlertPreference(current => ({
                                          ...current,
                                          alertTypes: active ? current.alertTypes.filter(type => type !== id) : [...current.alertTypes, id],
                                        }))}
                                        data-testid={`toggle-alert-${id}`}
                                      >
                                        <span className="block font-medium">{label}</span>
                                        <span className="block text-[10px] text-muted-foreground">{description}</span>
                                      </button>
                                      <Switch
                                        checked={active}
                                        onCheckedChange={checked => setAlertPreference(current => ({
                                          ...current,
                                          alertTypes: checked ? [...current.alertTypes, id] : current.alertTypes.filter(type => type !== id),
                                        }))}
                                        disabled={saveWhatsappAlertsMutation.isPending}
                                        aria-label={`Avisos de ${label.toLowerCase()}`}
                                      />
                                    </div>
                                    {active && (
                                      <div className="mt-2 flex items-center gap-2 pl-5">
                                        <Label htmlFor={`threshold-${id}`} className="text-[10px] text-muted-foreground">Umbral</Label>
                                        <Input
                                          id={`threshold-${id}`}
                                          type="number"
                                          step="0.5"
                                          value={alertPreference.thresholds[id]}
                                          onChange={event => setAlertPreference(current => ({
                                            ...current,
                                            thresholds: { ...current.thresholds, [id]: Number(event.target.value) },
                                          }))}
                                          className="h-7 w-20 bg-background px-2 text-[11px]"
                                          aria-label={`Umbral de ${label.toLowerCase()}`}
                                        />
                                        <span className="text-[10px] text-muted-foreground">{unit}</span>
                                      </div>
                                    )}
                                  </div>
                                );
                              })}
                            </div>
                            <div className="mt-3 grid grid-cols-2 gap-2">
                              <div className="space-y-1">
                                <Label htmlFor="whatsapp-timezone" className="text-[10px] text-muted-foreground">Zona horaria</Label>
                                <select
                                  id="whatsapp-timezone"
                                  value={alertPreference.timezone}
                                  onChange={event => setAlertPreference(current => ({ ...current, timezone: event.target.value }))}
                                  className="h-8 w-full rounded-md border border-input bg-background px-2 text-[10px] outline-none focus:ring-1 focus:ring-ring"
                                >
                                  <option value="America/Argentina/Buenos_Aires">Argentina (Buenos Aires)</option>
                                  <option value="America/Sao_Paulo">Brasil (São Paulo)</option>
                                  <option value="America/Mexico_City">México (Ciudad de México)</option>
                                  <option value="America/Santiago">Chile (Santiago)</option>
                                  <option value="Europe/Madrid">España (Madrid)</option>
                                </select>
                              </div>
                              <div className="space-y-1">
                                <Label htmlFor="whatsapp-daily-cap" className="text-[10px] text-muted-foreground">Máximo diario</Label>
                                <Input
                                  id="whatsapp-daily-cap"
                                  type="number"
                                  min={1}
                                  max={20}
                                  value={alertPreference.dailyCap}
                                  onChange={event => setAlertPreference(current => ({ ...current, dailyCap: Math.max(1, Number(event.target.value)) }))}
                                  className="h-8 bg-background px-2 text-[10px]"
                                />
                              </div>
                            </div>
                            <div className="mt-2 rounded-md border border-emerald-100 bg-background/60 p-2">
                              <div className="mb-1 flex items-center gap-1 font-semibold text-emerald-900">
                                <Clock3 className="h-3 w-3" /> Horario de descanso
                              </div>
                              <p className="mb-2 text-[10px] leading-relaxed text-muted-foreground">No enviaremos avisos dentro de este tramo.</p>
                              <div className="grid grid-cols-2 gap-2">
                                <Input
                                  type="time"
                                  value={alertPreference.quietHoursStart}
                                  onChange={event => setAlertPreference(current => ({ ...current, quietHoursStart: event.target.value }))}
                                  className="h-8 bg-background px-2 text-[10px]"
                                  aria-label="Inicio del horario de descanso"
                                />
                                <Input
                                  type="time"
                                  value={alertPreference.quietHoursEnd}
                                  onChange={event => setAlertPreference(current => ({ ...current, quietHoursEnd: event.target.value }))}
                                  className="h-8 bg-background px-2 text-[10px]"
                                  aria-label="Fin del horario de descanso"
                                />
                              </div>
                            </div>
                            <Button
                              size="sm"
                              className="mt-2 h-8 w-full text-xs"
                              onClick={() => saveWhatsappAlertsMutation.mutate(alertPreference)}
                              disabled={saveWhatsappAlertsMutation.isPending}
                              data-testid="btn-save-whatsapp-alerts"
                            >
                              {saveWhatsappAlertsMutation.isPending && <Loader2 className="mr-1 h-3 w-3 animate-spin" />}
                              {saveWhatsappAlertsMutation.isPending ? "Guardando criterios..." : "Guardar criterios"}
                            </Button>
                            {saveWhatsappAlertsMutation.isSuccess && (
                              <p className="mt-1 text-center text-[10px] font-medium text-emerald-700">Criterios guardados para esta parcela.</p>
                            )}
                            {saveWhatsappAlertsMutation.isError && (
                              <p className="mt-1 text-center text-[10px] text-destructive">No se pudieron guardar los criterios. Intenta de nuevo.</p>
                            )}
                            {(whatsappAlerts?.preference?.lastEvaluatedAt || whatsappAlerts?.preference?.lastSentAt || whatsappAlerts?.preference?.lastError) && (
                              <div className="mt-2 border-t border-emerald-200/70 pt-2 text-[10px] leading-relaxed text-muted-foreground">
                                {whatsappAlerts.preference.lastEvaluatedAt && <p>Última revisión: {format(new Date(whatsappAlerts.preference.lastEvaluatedAt), "dd/MM HH:mm", { locale: es })}</p>}
                                {whatsappAlerts.preference.lastSentAt && <p>Último aviso enviado: {format(new Date(whatsappAlerts.preference.lastSentAt), "dd/MM HH:mm", { locale: es })}</p>}
                                {whatsappAlerts.preference.lastError && <p className="mt-1 text-red-700">Último error: {whatsappAlerts.preference.lastError}</p>}
                              </div>
                            )}
                          </>
                        )}
                      </div>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 w-full justify-start px-1 text-xs text-destructive hover:text-destructive"
                      onClick={() => unlinkWhatsappMutation.mutate()}
                      disabled={unlinkWhatsappMutation.isPending}
                      data-testid="btn-whatsapp-unlink"
                    >
                      <Unlink className="h-3 w-3 mr-1" /> Desvincular número
                    </Button>
                  </>
                ) : whatsappCode ? (
                  <div className="rounded-md border bg-muted/40 p-2 space-y-2">
                    <p>Envía este mensaje al WhatsApp de AgRegen:</p>
                    <button
                      className="w-full flex items-center justify-center gap-1 rounded bg-background border px-2 py-2 font-mono font-bold text-sm"
                      onClick={() => navigator.clipboard?.writeText(`VINCULAR ${whatsappCode}`)}
                      data-testid="btn-copy-whatsapp-code"
                    >
                      VINCULAR {whatsappCode} <Copy className="h-3 w-3" />
                    </button>
                    <p className="text-muted-foreground">
                      Vence {whatsappExpiresAt ? format(new Date(whatsappExpiresAt), "HH:mm", { locale: es }) : "en 15 minutos"}.
                    </p>
                  </div>
                ) : (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-8 w-full text-xs"
                    onClick={() => startWhatsappLinkMutation.mutate()}
                    disabled={startWhatsappLinkMutation.isPending}
                    data-testid="btn-whatsapp-link"
                  >
                    {startWhatsappLinkMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin mr-1" /> : <Link2 className="h-3 w-3 mr-1" />}
                    Vincular esta parcela
                  </Button>
                )}
                {(startWhatsappLinkMutation.isError || selectWhatsappParcelMutation.isError || unlinkWhatsappMutation.isError) && (
                  <p className="text-destructive">No se pudo completar la acción. Intenta de nuevo.</p>
                )}
              </div>
            )}
          </div>
          <div className="border-b bg-muted/20 px-3 py-2.5">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Fuentes del agente</p>
            <div className="mt-1.5 space-y-1 text-[11px] leading-relaxed text-muted-foreground">
              <p><a href={`/parcel/${parcelId}/field-log`} className="font-medium text-primary hover:underline">Bitácora confirmada</a>: hechos operativos citables.</p>
              <p>Notas permanentes: datos indicados por ti para conservar.</p>
              <p>Memoria del chat: contexto conversacional, no verificado.</p>
            </div>
          </div>
          {/* Memory panel */}
          {memoryData?.summary && (
            <div className="border-b">
              <button
                className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-muted/50 transition-colors"
                onClick={() => setShowMemory(v => !v)}
                data-testid="btn-toggle-memory"
              >
                <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
                  <Brain className="h-3.5 w-3.5 text-primary" />
                  Memoria de la parcela
                </span>
                {showMemory ? <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" /> : <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" />}
              </button>
              {showMemory && (
                <div className="px-3 pb-3 space-y-2">
                  <p className="text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap" data-testid="text-memory-summary">
                    {memoryData.summary}
                  </p>
                  {memoryData.updatedAt && (
                    <p className="text-[10px] text-muted-foreground/60">
                      Actualizada {format(new Date(memoryData.updatedAt), "d MMM HH:mm", { locale: es })}
                    </p>
                  )}
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 text-xs text-destructive hover:text-destructive w-full justify-start px-1"
                    onClick={() => clearMemoryMutation.mutate()}
                    disabled={clearMemoryMutation.isPending}
                    data-testid="btn-clear-memory"
                  >
                    {clearMemoryMutation.isPending ? (
                      <Loader2 className="h-3 w-3 animate-spin mr-1" />
                    ) : (
                      <Trash2 className="h-3 w-3 mr-1" />
                    )}
                    Borrar memoria
                  </Button>
                </div>
              )}
            </div>
          )}
          <ScrollArea className="flex-1 p-2">
            {loadingConversations ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="text-center py-6 text-muted-foreground text-sm">
                <MessageSquare className="h-8 w-8 mx-auto mb-2 opacity-50" />
                <p>{t("aiChat.noConversations")}</p>
                <Button
                  variant="link"
                  size="sm"
                  onClick={() => { handleNewConversation(); setShowSidebar(false); }}
                  className="mt-2 h-10 text-sm"
                  data-testid="btn-start-conversation"
                >
                  {t("aiChat.startNew")}
                </Button>
              </div>
            ) : (
              <div className="space-y-1">
                {conversations.map((conv) => (
                  <button
                    key={conv.id}
                    onClick={() => { setSelectedConversationId(conv.id); setShowSidebar(false); }}
                    className={`w-full text-left px-3 py-3 rounded-md text-sm transition-colors min-h-[44px] ${
                      selectedConversationId === conv.id
                        ? "bg-primary/10 text-primary"
                        : "hover:bg-muted"
                    }`}
                    data-testid={`conversation-${conv.id}`}
                  >
                    <p className="font-medium truncate">
                      {conv.title || t("aiChat.newConversation")}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {format(new Date(conv.updatedAt), "d MMM, HH:mm", { locale: es })}
                    </p>
                  </button>
                ))}
              </div>
            )}
          </ScrollArea>
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="p-2 md:p-3 border-b bg-muted/30">
            <div className="flex items-center gap-2">
              <Button
                variant="ghost"
                size="icon"
                className="md:hidden h-10 w-10 flex-shrink-0"
                onClick={() => setShowSidebar(true)}
              >
                <MessageSquare className="h-5 w-5" />
              </Button>
              <Bot className="h-5 w-5 text-primary flex-shrink-0" />
              <div className="min-w-0 flex-1">
                <h3 className="font-semibold text-sm truncate">{t("aiChat.assistantTitle")}</h3>
                <p className="text-xs text-muted-foreground truncate">
                  {crop} - {parcelName}
                </p>
              </div>
              {/* Deep Mode toggle */}
              {selectedConversationId && (
                <button
                  onClick={() => setDeepMode(d => !d)}
                  data-testid="btn-deep-mode"
                  title={deepMode ? "Desactivar Análisis Profundo" : "Activar Análisis Profundo: busca literatura científica e interpreta índices automáticamente"}
                  className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs border transition-all flex-shrink-0 ${
                    deepMode
                      ? "bg-purple-100 border-purple-400 text-purple-700 font-semibold shadow-sm"
                      : "border-border text-muted-foreground hover:bg-muted"
                  }`}
                >
                  <FlaskConical className="h-3 w-3" />
                  <span className="hidden sm:inline">Análisis Profundo</span>
                </button>
              )}
              {selectedConversation && (
                <Badge variant="outline" className="text-xs flex items-center gap-1 flex-shrink-0">
                  <Cpu className="h-3 w-3" />
                  Agente IA
                </Badge>
              )}
              {selectedConversationId && (
                <Link
                  href={`/parcel/${parcelId}/field-log?conversationId=${encodeURIComponent(selectedConversationId)}`}
                  className="inline-flex min-h-9 flex-shrink-0 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-xs font-medium text-primary hover:bg-muted"
                  data-testid="link-chat-to-field-log"
                >
                  <BookOpen className="h-3.5 w-3.5" /><span className="hidden sm:inline">Bitácora</span>
                </Link>
              )}
            </div>
          </div>

          <ScrollArea className="flex-1 p-2 md:p-4" ref={scrollRef}>
            {!selectedConversationId ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-2">
                <Bot className="h-10 w-10 md:h-16 md:w-16 text-primary/30 mb-3 md:mb-4" />
                <h3 className="font-semibold text-sm md:text-lg mb-2">
                  {t("aiChat.regenAssistant")}
                </h3>
                <p className="text-muted-foreground text-xs md:text-sm max-w-md mb-3 md:mb-4">
                  {t("aiChat.assistantDesc")}
                </p>
                <div className="flex flex-wrap gap-1.5 md:gap-2 justify-center text-[10px] md:text-xs">
                  <span className="px-2 py-1 bg-muted rounded-full">{t("aiChat.soil")}</span>
                  <span className="px-2 py-1 bg-muted rounded-full">{t("aiChat.rotation")}</span>
                  <span className="px-2 py-1 bg-muted rounded-full">{t("aiChat.cover")}</span>
                  <span className="px-2 py-1 bg-muted rounded-full">{t("aiChat.compost")}</span>
                </div>

                <div className="mt-4 md:mt-6 w-full max-w-xs space-y-3">
                  <div className="flex items-center gap-2 px-3 py-2 bg-primary/5 border border-primary/20 rounded-lg">
                    <Cpu className="h-4 w-4 text-primary flex-shrink-0" />
                    <div className="text-left">
                      <p className="text-xs font-semibold text-primary">AgRegen IA</p>
                      <p className="text-[10px] text-muted-foreground">Razonamiento profundo · Literatura científica · Contexto geográfico</p>
                    </div>
                  </div>

                  <Button
                    className="w-full h-11 md:h-10 text-sm"
                    onClick={() => handleNewConversation()}
                    disabled={createConversationMutation.isPending}
                    data-testid="btn-start-chat"
                  >
                    {createConversationMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin mr-2" />
                    ) : (
                      <MessageSquare className="h-4 w-4 mr-2" />
                    )}
                    {t("aiChat.startConsultation")}
                  </Button>
                </div>
              </div>
            ) : loadingMessages ? (
              <div className="flex justify-center py-8">
                <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
              </div>
            ) : messages.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full text-center px-2">
                <Bot className="h-10 w-10 md:h-12 md:w-12 text-primary/50 mb-3 md:mb-4" />
                <p className="text-muted-foreground text-xs md:text-sm">
                  {t("aiChat.greeting")}
                  <br />
                  {t("aiChat.howCanHelp")}
                </p>
                <div className="mt-3 md:mt-4 space-y-2 w-full max-w-sm">
                  <button
                    onClick={() => setInputMessage(t("aiChat.suggestion1"))}
                    className="block w-full text-left px-4 py-3 text-xs md:text-sm bg-muted/50 hover:bg-muted rounded-lg transition-colors min-h-[44px]"
                  >
                    {t("aiChat.suggestion1")}
                  </button>
                  <button
                    onClick={() => setInputMessage(t("aiChat.suggestion2"))}
                    className="block w-full text-left px-4 py-3 text-xs md:text-sm bg-muted/50 hover:bg-muted rounded-lg transition-colors min-h-[44px]"
                  >
                    {t("aiChat.suggestion2")}
                  </button>
                  <button
                    onClick={() => setInputMessage(t("aiChat.suggestion3"))}
                    className="block w-full text-left px-4 py-3 text-xs md:text-sm bg-muted/50 hover:bg-muted rounded-lg transition-colors min-h-[44px]"
                  >
                    {t("aiChat.suggestion3")}
                  </button>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                {messages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`flex gap-3 ${msg.role === "user" ? "justify-end" : ""}`}
                  >
                    {msg.role === "assistant" && (
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                        <Bot className="h-4 w-4 text-primary" />
                      </div>
                    )}
                    <div
                      className={`max-w-[80%] rounded-lg px-4 py-2 ${
                        msg.role === "user"
                          ? "bg-primary text-primary-foreground"
                          : "bg-muted"
                      }`}
                    >
                      {msg.role === "user" ? (
                        <div className="space-y-2">
                          {msg.imageUrl && (
                            <a href={msg.imageUrl} target="_blank" rel="noopener noreferrer">
                              <img
                                src={msg.imageUrl}
                                alt="Imagen adjunta"
                                className="max-h-48 max-w-full rounded-md object-cover border border-white/20"
                                data-testid={`img-message-${msg.id}`}
                              />
                            </a>
                          )}
                          {msg.content && msg.content !== "📷 Imagen adjunta" && (
                            <div className="whitespace-pre-wrap text-sm">{msg.content}</div>
                          )}
                        </div>
                      ) : (
                        <div className="text-sm">
                          <ReactMarkdown
                            components={{
                              h1: ({ children }) => <h1 className="text-base font-bold mt-3 mb-1 text-foreground">{children}</h1>,
                              h2: ({ children }) => <h2 className="text-sm font-semibold mt-3 mb-1 text-foreground border-b border-border pb-1">{children}</h2>,
                              h3: ({ children }) => <h3 className="text-sm font-semibold mt-2 mb-0.5 text-foreground">{children}</h3>,
                              p: ({ children }) => <p className="mb-2 leading-relaxed last:mb-0">{children}</p>,
                              strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
                              em: ({ children }) => <em className="italic">{children}</em>,
                              ul: ({ children }) => <ul className="mb-2 ml-4 space-y-0.5 list-disc">{children}</ul>,
                              ol: ({ children }) => <ol className="mb-2 ml-4 space-y-0.5 list-decimal">{children}</ol>,
                              li: ({ children }) => <li className="leading-relaxed">{children}</li>,
                              a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer" className="text-primary underline-offset-2 hover:underline">{children}</a>,
                              hr: () => <hr className="my-3 border-border" />,
                              blockquote: ({ children }) => <blockquote className="border-l-2 border-primary/40 pl-3 italic text-muted-foreground my-2">{children}</blockquote>,
                              code: ({ children }) => <code className="bg-background/80 text-primary rounded px-1 py-0.5 text-xs font-mono">{children}</code>,
                              pre: ({ children }) => <pre className="bg-background/80 rounded p-2 overflow-x-auto text-xs font-mono my-2">{children}</pre>,
                              table: ({ children }) => <div className="overflow-x-auto my-2"><table className="text-xs border-collapse w-full">{children}</table></div>,
                              th: ({ children }) => <th className="border border-border px-2 py-1 bg-muted font-semibold text-left">{children}</th>,
                              td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
                            }}
                          >{msg.content}</ReactMarkdown>
                          <Link
                            href={`/parcel/${parcelId}/field-log?conversationId=${encodeURIComponent(selectedConversationId || "")}`}
                            className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-border bg-background/70 px-2.5 py-1.5 text-xs font-medium text-primary hover:bg-background"
                            data-testid={`link-import-chat-${msg.id}`}
                          >
                            <BookOpen className="h-3.5 w-3.5" />Llevar esta conversación a Bitácora
                          </Link>
                        </div>
                      )}

                      {/* Dedicated "Fuentes científicas" section — always visible when papers found */}
                      {msg.role === "assistant" && (() => {
                        const allPapers = (reasoningStepsMap[msg.id] || [])
                          .filter(s => s.tool === "buscarLiteratura" && Array.isArray(s.output) && (s.output as ScientificPaper[]).length > 0)
                          .flatMap(s => (s.output as ScientificPaper[]).slice(0, 4));
                        const uniquePapers = allPapers.filter((p, i, arr) => arr.findIndex(x => x.url === p.url) === i).slice(0, 6);
                        if (uniquePapers.length === 0) return null;
                        return (
                          <div className="mt-2 pt-2 border-t border-border/40">
                            <p className="text-xs font-semibold text-foreground flex items-center gap-1 mb-1.5">
                              <BookOpen className="h-3 w-3 text-blue-500" />
                              Fuentes científicas
                            </p>
                            <div className="space-y-1">
                              {uniquePapers.map((paper, j) => (
                                <a
                                  key={j}
                                  href={paper.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="flex items-start gap-1.5 text-xs text-blue-600 hover:underline leading-tight"
                                  data-testid={`paper-source-${msg.id}-${j}`}
                                >
                                  <span className="flex-shrink-0 text-muted-foreground font-medium">[{j + 1}]</span>
                                  <span>
                                    {paper.authors && `${paper.authors}${paper.year ? ` (${paper.year})` : ""}. `}
                                    <em>{paper.title.slice(0, 100)}{paper.title.length > 100 ? "…" : ""}</em>
                                    {paper.citationCount > 0 && (
                                      <span className="text-muted-foreground ml-1">· {paper.citationCount} citas</span>
                                    )}
                                  </span>
                                </a>
                              ))}
                            </div>
                          </div>
                        );
                      })()}

                      {/* Reasoning steps panel (only for assistant messages that have them) */}
                      {msg.role === "assistant" && reasoningStepsMap[msg.id] && reasoningStepsMap[msg.id].length > 0 && (
                        <div className="mt-3 border-t border-border/40 pt-2">
                          <button
                            onClick={() => toggleReasoning(msg.id)}
                            data-testid={`btn-reasoning-${msg.id}`}
                            className="flex items-center gap-1.5 text-xs text-purple-700 hover:text-purple-900 font-medium transition-colors"
                          >
                            {expandedReasoning.has(msg.id)
                              ? <ChevronDown className="h-3.5 w-3.5" />
                              : <ChevronRight className="h-3.5 w-3.5" />
                            }
                            <FlaskConical className="h-3 w-3" />
                            Ver razonamiento ({reasoningStepsMap[msg.id].length} pasos)
                          </button>

                          {expandedReasoning.has(msg.id) && (
                            <div className="mt-2 space-y-2">
                              {reasoningStepsMap[msg.id].map((step, i) => (
                                <div
                                  key={i}
                                  className="text-xs bg-background/80 rounded-md border border-border/50 px-3 py-2"
                                  data-testid={`reasoning-step-${msg.id}-${i}`}
                                >
                                  <p className="font-semibold text-foreground mb-1">{step.label}</p>

                                  {/* Literature search results — kind:"search" */}
                                  {step.tool === "buscarLiteratura" ? (
                                    <div className="mt-1.5">
                                      {/* Header: query + result-count badge */}
                                      <div className="flex items-center gap-2 mb-1.5">
                                        <Search className="h-3 w-3 text-purple-500 flex-shrink-0" />
                                        <span className="text-[11px] text-muted-foreground italic truncate flex-1">
                                          {(step.input as { query?: string }).query ?? ""}
                                        </span>
                                        {Array.isArray(step.output) && (
                                          <span className={`text-[10px] font-semibold px-1.5 py-0.5 rounded-full ${
                                            (step.output as ScientificPaper[]).length > 0
                                              ? "bg-green-100 text-green-700"
                                              : "bg-muted text-muted-foreground"
                                          }`}>
                                            {(step.output as ScientificPaper[]).length > 0
                                              ? `${(step.output as ScientificPaper[]).length} fuentes`
                                              : "sin resultados"}
                                          </span>
                                        )}
                                      </div>
                                      {/* Paper list */}
                                      {Array.isArray(step.output) && (step.output as ScientificPaper[]).length > 0 && (
                                        <div className="space-y-1">
                                          {(step.output as ScientificPaper[]).slice(0, 4).map((paper, j) => (
                                            <a
                                              key={j}
                                              href={paper.url}
                                              target="_blank"
                                              rel="noopener noreferrer"
                                              className="flex items-start gap-1.5 group hover:bg-muted/60 rounded px-1 py-0.5 transition-colors"
                                              data-testid={`paper-link-${msg.id}-${i}-${j}`}
                                            >
                                              <BookOpen className="h-3 w-3 text-blue-500 flex-shrink-0 mt-0.5" />
                                              <span className="text-blue-600 group-hover:underline leading-tight text-[11px]">
                                                [{j + 1}] {paper.authors} ({paper.year ?? "s.f."}). <em>{paper.title.slice(0, 90)}{paper.title.length > 90 ? "…" : ""}</em>
                                                {paper.citationCount > 0 && (
                                                  <span className="text-muted-foreground ml-1">· {paper.citationCount} citas</span>
                                                )}
                                              </span>
                                            </a>
                                          ))}
                                        </div>
                                      )}
                                      {Array.isArray(step.output) && (step.output as ScientificPaper[]).length === 0 && (
                                        <p className="text-muted-foreground italic text-[11px]">Sin resultados — filtros relajados automáticamente.</p>
                                      )}
                                    </div>
                                  ) : null}

                                  {/* Index interpretation */}
                                  {step.tool === "interpretarIndice" && step.output != null ? (
                                    <div className="mt-1 space-y-0.5">
                                      <p className="text-muted-foreground">
                                        Nivel: <span className={`font-semibold ${nivelColor[(step.output as IndiceInterpretacion).nivel] || "text-foreground"}`}>
                                          {(step.output as IndiceInterpretacion).nivel.toUpperCase()}
                                        </span>
                                        {" · "} Rango esperado: {(step.output as IndiceInterpretacion).rangoEsperado}
                                      </p>
                                      <p className="text-muted-foreground">{(step.output as IndiceInterpretacion).interpretacion}</p>
                                    </div>
                                  ) : null}

                                  {/* Historical comparison */}
                                  {step.tool === "compararHistorico" && step.output != null ? (
                                    <div className="mt-1 flex items-center gap-1.5">
                                      {tendenciaIcon((step.output as HistorialTendencia).tendencia)}
                                      <span className="text-muted-foreground">
                                        {(step.output as HistorialTendencia).observacion}
                                      </span>
                                    </div>
                                  ) : null}

                                  {/* Regional comparison */}
                                  {step.tool === "compararRegional" && step.output != null ? (() => {
                                    const r = step.output as RegionalComparacion;
                                    if (r.n === 0) return (
                                      <p className="mt-1 text-xs text-muted-foreground">{r.observacion}</p>
                                    );
                                    const pct = r.percentil;
                                    const barColor = pct >= 75 ? "bg-green-500" : pct >= 50 ? "bg-yellow-400" : pct >= 25 ? "bg-orange-400" : "bg-red-500";
                                    return (
                                      <div className="mt-1 space-y-0.5">
                                        <div className="flex items-center gap-2">
                                          <div className="flex-1 bg-muted rounded-full h-1.5 overflow-hidden">
                                            <div className={`${barColor} h-1.5 rounded-full`} style={{ width: `${pct}%` }} />
                                          </div>
                                          <span className="text-xs font-medium text-foreground">P{pct}</span>
                                        </div>
                                        <p className="text-xs text-muted-foreground">{r.observacion}</p>
                                      </div>
                                    );
                                  })() : null}
                                </div>
                              ))}
                            </div>
                          )}
                        </div>
                      )}

                      {msg.role === "assistant" && (
                        <div className="mt-2 flex items-center gap-2 pt-2 border-t border-border/50 flex-wrap">
                          <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 text-xs"
                            onClick={() =>
                              markHelpfulMutation.mutate({
                                messageId: msg.id,
                                recommendation: msg.content,
                              })
                            }
                            disabled={markHelpfulMutation.isPending}
                            data-testid={`btn-helpful-${msg.id}`}
                          >
                            <ThumbsUp className="h-3 w-3 mr-1" />
                            {t("aiChat.helpful")}
                          </Button>
                          {msg.content.length > 300 && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 text-xs text-emerald-700 hover:text-emerald-800 hover:bg-emerald-50"
                              data-testid={`btn-export-pdf-${msg.id}`}
                              onClick={async () => {
                                const allPapers: PaperRef[] = (reasoningStepsMap[msg.id] || [])
                                  .filter(s => s.tool === "buscarLiteratura" && Array.isArray(s.output))
                                  .flatMap(s => (s.output as PaperRef[]))
                                  .filter((p, i, arr) => arr.findIndex(x => x.url === p.url) === i)
                                  .slice(0, 10);
                                await exportReportPDF({
                                  parcelName,
                                  crop,
                                  content: msg.content,
                                  papers: allPapers,
                                });
                              }}
                            >
                              <FileDown className="h-3 w-3 mr-1" />
                              Exportar PDF
                            </Button>
                          )}
                        </div>
                      )}
                    </div>
                    {msg.role === "user" && (
                      <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary flex items-center justify-center">
                        <User className="h-4 w-4 text-primary-foreground" />
                      </div>
                    )}
                  </div>
                ))}
                {sendMessageMutation.isPending && (
                  <div className="flex gap-3">
                    <div className="flex-shrink-0 w-8 h-8 rounded-full bg-primary/10 flex items-center justify-center">
                      <Bot className="h-4 w-4 text-primary" />
                    </div>
                    <div className={`rounded-lg px-4 py-3 ${deepMode ? "bg-purple-50 border border-purple-200" : "bg-muted"}`}>
                      <div className="flex items-center gap-2">
                        <Loader2 className="h-4 w-4 animate-spin" />
                        <span className="text-sm text-muted-foreground">
                          {deepMode ? "Consultando OpenAlex y razonando…" : t("aiChat.analyzing")}
                        </span>
                      </div>
                      {deepMode && (
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {[
                            { icon: <Search className="h-2.5 w-2.5" />, text: "Buscando literatura" },
                            { icon: <Brain className="h-2.5 w-2.5" />, text: "Interpretando índices" },
                            { icon: <TrendingUp className="h-2.5 w-2.5" />, text: "Analizando tendencias" },
                          ].map(({ icon, text }) => (
                            <span key={text} className="inline-flex items-center gap-1 text-[11px] text-purple-700 bg-purple-100 rounded-full px-2 py-0.5">
                              {icon}{text}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </ScrollArea>

          {selectedConversationId && (
            <div className="p-2 md:p-3 border-t">
              {deepMode && (
                <div className="flex items-center gap-1.5 mb-2 px-1">
                  <FlaskConical className="h-3 w-3 text-purple-600" />
                  <span className="text-xs text-purple-700 font-medium">
                    Modo Análisis Profundo activo · La respuesta incluirá literatura científica
                  </span>
                </div>
              )}
              {diagnosisMode && selectedImage && (
                <div className="flex items-center gap-1.5 mb-2 px-1">
                  <Microscope className="h-3 w-3 text-emerald-600" />
                  <span className="text-xs text-emerald-700 font-medium">
                    Diagnóstico fitosanitario activo · El IA analizará la foto para identificar enfermedades, plagas o deficiencias
                  </span>
                </div>
              )}
              {/* Image preview */}
              {imagePreviewUrl && (
                <div className="mb-2 relative inline-block">
                  <img
                    src={imagePreviewUrl}
                    alt="Vista previa"
                    className="h-20 w-20 object-cover rounded-lg border border-border"
                    data-testid="img-chat-preview"
                  />
                  <button
                    onClick={clearImage}
                    className="absolute -top-1.5 -right-1.5 bg-destructive text-destructive-foreground rounded-full h-5 w-5 flex items-center justify-center shadow"
                    data-testid="btn-clear-image"
                    title="Quitar imagen"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )}
              <div className="flex gap-2">
                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  capture="environment"
                  className="hidden"
                  onChange={handleImageSelect}
                  data-testid="input-chat-image"
                />
                {/* Camera button */}
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  className={`h-11 w-11 flex-shrink-0 ${imagePreviewUrl ? "border-primary text-primary" : ""}`}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={sendMessageMutation.isPending || isUploadingImage}
                  title="Adjuntar foto del campo"
                  data-testid="btn-attach-image"
                >
                  <Camera className="h-5 w-5" />
                </Button>
                {/* Diagnosis mode button — only visible when an image is selected */}
                {selectedImage && (
                  <Button
                    type="button"
                    variant={diagnosisMode ? "default" : "outline"}
                    size="icon"
                    className={`h-11 w-11 flex-shrink-0 transition-colors ${diagnosisMode ? "bg-emerald-600 hover:bg-emerald-700 border-emerald-600 text-white" : "border-emerald-500 text-emerald-600 hover:bg-emerald-50"}`}
                    onClick={() => setDiagnosisMode(d => !d)}
                    disabled={sendMessageMutation.isPending || isUploadingImage}
                    title={diagnosisMode ? "Modo Diagnóstico activo — clic para desactivar" : "Activar diagnóstico de enfermedades / plagas"}
                    data-testid="btn-diagnosis-mode"
                  >
                    <Microscope className="h-5 w-5" />
                  </Button>
                )}
                <Input
                  value={inputMessage}
                  onChange={(e) => setInputMessage(e.target.value)}
                  onKeyPress={handleKeyPress}
                  placeholder={selectedImage ? "Describe el problema o envía solo la foto…" : t("aiChat.yourQuestion")}
                  disabled={sendMessageMutation.isPending || isUploadingImage}
                  className="flex-1 h-11 text-sm"
                  data-testid="input-chat-message"
                />
                <Button
                  onClick={handleSend}
                  disabled={(!inputMessage.trim() && !selectedImage) || sendMessageMutation.isPending || isUploadingImage}
                  className={`h-11 w-11 p-0 ${deepMode ? "bg-purple-600 hover:bg-purple-700" : ""}`}
                  data-testid="btn-send-message"
                >
                  {sendMessageMutation.isPending || isUploadingImage ? (
                    <Loader2 className="h-5 w-5 animate-spin" />
                  ) : (
                    <Send className="h-5 w-5" />
                  )}
                </Button>
              </div>
              {sendMessageMutation.isError && (
                <p className="text-destructive text-xs mt-2" data-testid="text-chat-error">
                  {(sendMessageMutation.error as any)?.message ||
                    t("aiChat.sendError")}
                </p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
