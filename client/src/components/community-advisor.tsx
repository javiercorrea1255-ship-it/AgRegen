import { useState, useRef, useEffect } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

import {
  Bot, Send, Loader2, Users, Leaf, BarChart3, FileText, Sparkles, X,
} from "lucide-react";

interface PeerMatch {
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

interface AdvisorMessage {
  role: "user" | "assistant";
  content: string;
  matches?: PeerMatch[];
  isWelcome?: boolean;
}

export interface AdvisorUser {
  name: string;
  farmingTypes?: string[] | null;
  currentPractices?: string[] | null;
}

interface CommunityAdvisorProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onFilterByUser?: (userId: string, userName: string) => void;
  user?: AdvisorUser | null;
  isNewUser?: boolean;
}

const FARMING_TYPE_LABELS: Record<string, string> = {
  granos: "granos",
  hortalizas: "hortalizas",
  frutales: "frutales",
  ganaderia: "ganadería",
  silvopastoril: "silvopastoril",
  mixto: "producción mixta",
  otro: "otro sistema productivo",
};

const PRACTICE_LABELS: Record<string, string> = {
  cobertura_vegetal: "cobertura vegetal permanente",
  rotacion_cultivos: "rotación de cultivos",
  labranza_minima: "labranza mínima o cero",
  compostaje: "compostaje",
  bioinsumos: "bioinsumos",
  integracion_animal: "integración animal",
  agroforesteria: "agroforestería",
};

function buildWelcomeMessage(user: AdvisorUser | null, isNewUser = false): string {
  if (!user) {
    return "¡Bienvenido/a a RegenConnect! Soy tu conector comunitario. Cuéntame con qué cultivo o práctica quieres empezar y te presento con productores que han documentado resultados similares.";
  }

  const firstName = user.name.split(" ")[0];
  const parts: string[] = [];
  const farming = (user.farmingTypes ?? []).filter(Boolean);
  const practices = (user.currentPractices ?? []).filter((p) => p !== "ninguna");

  if (isNewUser) {
    parts.push(`¡Bienvenido/a a AgRegen, ${firstName}! 🌱 Ya eres parte de nuestra comunidad regenerativa.`);
    if (farming.length > 0) {
      const farmingStr = farming.map((f) => FARMING_TYPE_LABELS[f] ?? f).join(", ");
      parts.push(`Vi que trabajas con ${farmingStr} — hay productores aquí con experiencia en eso.`);
    }
    parts.push("Te presento a algunos miembros activos para que puedas dar tu primer saludo. ¿Quieres que te conecte con alguien?");
  } else {
    parts.push(`¡Hola, ${firstName}!`);
    if (farming.length > 0) {
      const farmingStr = farming.map((f) => FARMING_TYPE_LABELS[f] ?? f).join(", ");
      parts.push(`Veo que tu sistema productivo incluye ${farmingStr}.`);
    }
    if (practices.length > 0) {
      const practStr = practices.map((p) => PRACTICE_LABELS[p] ?? p).join(", ");
      parts.push(
        practices.length > 1
          ? `Ya estás aplicando ${practStr} — ¡excelentes prácticas regenerativas!`
          : `Ya estás aplicando ${practStr}.`
      );
    } else if (farming.length > 0) {
      parts.push("Puedo conectarte con productores que ya están aplicando prácticas regenerativas en sistemas similares al tuyo.");
    }
    parts.push("¿Con quién te gustaría conectar hoy?");
  }

  return parts.join(" ");
}

const AVATAR_COLORS = [
  "bg-rose-500", "bg-blue-500", "bg-emerald-500", "bg-amber-500",
  "bg-purple-500", "bg-cyan-500", "bg-pink-500", "bg-indigo-500",
];

function getAvatarColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < (name || "").length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  return AVATAR_COLORS[Math.abs(hash) % AVATAR_COLORS.length];
}

function ndviBadge(ndvi: number | null): { label: string; className: string } | null {
  if (ndvi == null) return null;
  if (ndvi >= 0.6) return { label: `NDVI ${ndvi.toFixed(2)} · Excelente`, className: "bg-emerald-100 text-emerald-800 border-emerald-200" };
  if (ndvi >= 0.4) return { label: `NDVI ${ndvi.toFixed(2)} · Bueno`, className: "bg-blue-100 text-blue-800 border-blue-200" };
  return { label: `NDVI ${ndvi.toFixed(2)} · En desarrollo`, className: "bg-amber-100 text-amber-800 border-amber-200" };
}

function PeerCard({ peer, onFilter }: { peer: PeerMatch; onFilter?: (userId: string, name: string) => void }) {
  const color = getAvatarColor(peer.name);
  const ndvi = ndviBadge(peer.avgNdvi);
  const roleLabel =
    peer.role === "farmer" ? "Productor" :
    peer.role === "researcher" ? "Investigador" : "Admin";

  return (
    <div
      className={`bg-white border border-gray-200 rounded-xl p-3 space-y-2 transition-shadow ${onFilter ? "cursor-pointer hover:shadow-md hover:border-emerald-200" : "hover:shadow-md"}`}
      data-testid={`peer-card-${peer.userId}`}
      onClick={() => onFilter?.(peer.userId, peer.name)}
      role={onFilter ? "button" : undefined}
    >
      <div className="flex items-center gap-2.5">
        <Avatar className="h-9 w-9 shrink-0">
          {peer.avatarUrl && <AvatarImage src={peer.avatarUrl} alt={peer.name} />}
          <AvatarFallback className={`${color} text-white text-xs font-bold`}>
            {peer.name.charAt(0).toUpperCase()}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold text-gray-900 truncate">{peer.name}</p>
          <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 text-gray-600 border border-gray-200">
              {roleLabel}
            </span>
            <span className="text-[10px] text-gray-500 flex items-center gap-0.5">
              <Leaf className="h-2.5 w-2.5 text-emerald-500" />
              {peer.crop}
            </span>
          </div>
        </div>
      </div>

      {ndvi && (
        <div className="flex items-center gap-1">
          <BarChart3 className="h-3 w-3 text-gray-400 shrink-0" />
          <span className={`text-[10px] px-2 py-0.5 rounded-full border font-medium ${ndvi.className}`}>
            {ndvi.label}
          </span>
        </div>
      )}

      {peer.postTitle && peer.postId && (
        <a
          href={`/community?post=${peer.postId}`}
          className="w-full text-left flex items-start gap-1 group rounded-lg hover:bg-emerald-50 transition-colors -mx-1 px-1 py-0.5"
          data-testid={`btn-view-post-${peer.userId}`}
          title="Ver publicación de éxito"
          onClick={(e) => e.stopPropagation()}
        >
          <FileText className="h-3 w-3 text-emerald-500 shrink-0 mt-0.5" />
          <div>
            <p className="text-[11px] font-medium text-emerald-700 group-hover:underline line-clamp-1">{peer.postTitle}</p>
            {peer.postExcerpt && (
              <p className="text-[10px] text-gray-500 line-clamp-2 mt-0.5">{peer.postExcerpt}</p>
            )}
          </div>
        </a>
      )}

      {onFilter && (
        <Button
          size="sm"
          variant="outline"
          className="w-full h-7 text-xs gap-1 border-emerald-200 text-emerald-700 hover:bg-emerald-50"
          onClick={(e) => { e.stopPropagation(); onFilter(peer.userId, peer.name); }}
          data-testid={`btn-view-peer-${peer.userId}`}
        >
          Ver sus publicaciones
        </Button>
      )}
    </div>
  );
}

const QUICK_PROMPTS = [
  "¿Quién cultiva lo mismo que yo con buenos resultados?",
  "Busca productores con NDVI alto en mi cultivo",
  "¿Hay alguien en la comunidad con experiencia en agricultura regenerativa?",
];

const SESSION_STORAGE_KEY = "agregen-advisor-chat";

function loadMessagesFromSession(): AdvisorMessage[] {
  try {
    const raw = sessionStorage.getItem(SESSION_STORAGE_KEY);
    return raw ? (JSON.parse(raw) as AdvisorMessage[]) : [];
  } catch {
    return [];
  }
}

export function CommunityAdvisor({ open, onOpenChange, onFilterByUser, user, isNewUser = false }: CommunityAdvisorProps) {
  const [messages, setMessages] = useState<AdvisorMessage[]>(() => {
    // New users always start fresh — ignore any saved session chat
    if (isNewUser) {
      return [{ role: "assistant", content: buildWelcomeMessage(user ?? null, true), isWelcome: true }];
    }
    const saved = loadMessagesFromSession();
    if (saved.length === 0) {
      return [{ role: "assistant", content: buildWelcomeMessage(user ?? null, false), isWelcome: true }];
    }
    return saved;
  });
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [activeCrop, setActiveCrop] = useState<string | undefined>();
  const scrollRef = useRef<HTMLDivElement>(null);

  const hasRealHistory = messages.some((m) => !m.isWelcome);

  useEffect(() => {
    try {
      const toSave = messages.filter((m) => !m.isWelcome);
      sessionStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(toSave));
    } catch {
      // sessionStorage not available (private mode, etc.) — fail silently
    }
  }, [messages]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages, loading]);


  const sendMessage = async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;

    const userMsg: AdvisorMessage = { role: "user", content: msg };
    const updatedMessages = [...messages, userMsg];
    setMessages(updatedMessages);
    setInput("");
    setLoading(true);

    try {
      const historyForApi = updatedMessages
        .slice(-10)
        .map(({ role, content }) => ({ role, content }));

      const res = await fetch("/api/community/advisor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: msg,
          chatHistory: historyForApi.slice(0, -1),
          crop: activeCrop,
        }),
      });

      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.message || "Error al conectar con el asesor");
      }

      const data = await res.json();

      if (data.userCrops?.length > 0 && !activeCrop) {
        setActiveCrop(data.userCrops[0]);
      }

      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: data.response, matches: data.matches ?? [] },
      ]);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : "Error desconocido";
      setMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Lo siento, ocurrió un error: ${errMsg}` },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMessage();
    }
  };

  const handleFilterByUser = (userId: string, name: string) => {
    onFilterByUser?.(userId, name);
    onOpenChange(false);
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent
        side="right"
        className="w-full sm:w-[440px] p-0 flex flex-col gap-0"
        data-testid="community-advisor-panel"
      >
        <SheetHeader className="px-4 pt-4 pb-3 border-b bg-gradient-to-r from-emerald-50 to-teal-50">
          <SheetTitle className="flex items-center gap-2 text-emerald-900">
            <div className="p-1.5 bg-emerald-100 rounded-lg">
              <Users className="h-4 w-4 text-emerald-600" />
            </div>
            Conectar con pares
          </SheetTitle>
          <p className="text-xs text-gray-500 mt-0.5">
            Encuentra productores con tu mismo cultivo y resultados documentados
          </p>
        </SheetHeader>

        <div className="flex-1 overflow-y-auto px-4 py-3" ref={scrollRef}>
          <div className="space-y-4 pb-2">
            {messages.map((msg, i) => (
              <div key={i} className={`flex gap-2 ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                {msg.role === "assistant" && (
                  <div className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center mt-0.5">
                    <Bot className="h-3.5 w-3.5 text-emerald-600" />
                  </div>
                )}
                <div className={`max-w-[85%] space-y-2 ${msg.role === "user" ? "items-end" : "items-start"} flex flex-col`}>
                  <div
                    className={`rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
                      msg.role === "user"
                        ? "bg-emerald-600 text-white rounded-tr-sm"
                        : "bg-gray-100 text-gray-800 rounded-tl-sm"
                    }`}
                    data-testid={`advisor-msg-${i}`}
                  >
                    {msg.content}
                  </div>
                  {msg.role === "assistant" && msg.matches && msg.matches.length > 0 && (
                    <div className="space-y-2 w-full">
                      {msg.matches.map((peer) => (
                        <PeerCard
                          key={peer.userId}
                          peer={peer}
                          onFilter={onFilterByUser ? handleFilterByUser : undefined}
                        />
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}

            {!hasRealHistory && (
              <div className="space-y-2 pt-1">
                {QUICK_PROMPTS.map((p) => (
                  <button
                    key={p}
                    onClick={() => sendMessage(p)}
                    className="w-full text-left text-sm px-4 py-3 rounded-lg bg-gray-50 hover:bg-emerald-50 hover:text-emerald-800 border border-gray-200 hover:border-emerald-200 transition-colors"
                    data-testid="btn-quick-prompt"
                  >
                    {p}
                  </button>
                ))}
              </div>
            )}

            {loading && (
              <div className="flex gap-2 items-start">
                <div className="flex-shrink-0 w-7 h-7 rounded-full bg-emerald-100 flex items-center justify-center">
                  <Bot className="h-3.5 w-3.5 text-emerald-600" />
                </div>
                <div className="bg-gray-100 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-2">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-gray-400" />
                  <span className="text-sm text-gray-500">Buscando pares...</span>
                </div>
              </div>
            )}
          </div>
        </div>

        <div className="px-4 pb-4 pt-2 border-t bg-white">
          <div className="flex gap-2">
            <Input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Pregunta sobre productores con tu cultivo..."
              disabled={loading}
              className="flex-1 h-10 text-sm"
              data-testid="input-advisor-message"
            />
            <Button
              onClick={() => sendMessage()}
              disabled={!input.trim() || loading}
              className="h-10 w-10 p-0 bg-emerald-600 hover:bg-emerald-700"
              data-testid="btn-advisor-send"
            >
              {loading ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <Send className="h-4 w-4" />
              )}
            </Button>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}
