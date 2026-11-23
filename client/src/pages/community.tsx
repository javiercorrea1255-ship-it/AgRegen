import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link, useLocation } from "wouter";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n-context";
import {
  MessageSquare, ThumbsUp, Search, Plus, Image as ImageIcon, Video,
  MapPin, Leaf, Send, ArrowLeft, Trash2, X, Upload, Clock, BarChart3,
  ChevronLeft, ChevronRight, Reply, Link2, Eye, Share2, Users, TrendingUp,
  FileText, Sparkles, Camera, Smile, Hash, Languages, Loader2
} from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { CommunityAdvisor } from "@/components/community-advisor";

interface Author {
  id: string;
  name: string;
  role: string;
  avatarUrl?: string | null;
}

interface PostParcel {
  id: string;
  name: string;
  crop: string;
  area: string;
  location: string;
}

interface CommunityPost {
  id: string;
  userId: string;
  type: string;
  title: string;
  content: string;
  mediaUrls: string[];
  parcelId: string | null;
  tags: string[];
  likesCount: number;
  commentsCount: number;
  createdAt: string;
  author: Author | null;
  parcel: PostParcel | null;
  userLiked: boolean;
}

interface CommunityComment {
  id: string;
  postId: string;
  userId: string;
  content: string;
  parentId: string | null;
  likesCount: number;
  createdAt: string;
  author: Author | null;
  userLiked: boolean;
}

function timeAgo(dateStr: string, t: (k: string) => string): string {
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60000);
  const diffH = Math.floor(diffMs / 3600000);
  const diffD = Math.floor(diffMs / 86400000);

  if (diffMin < 1) return t("community.justNow");
  if (diffMin < 60) return `${diffMin} ${t("community.minutesAgo")}`;
  if (diffH < 24) return `${diffH} ${t("community.hoursAgo")}`;
  return `${diffD} ${t("community.daysAgo")}`;
}

const POST_TYPE_COLORS: Record<string, string> = {
  experience: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/40 dark:text-emerald-300",
  parcel_results: "bg-blue-100 text-blue-800 dark:bg-blue-900/40 dark:text-blue-300",
  question: "bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300",
  tip: "bg-purple-100 text-purple-800 dark:bg-purple-900/40 dark:text-purple-300",
};

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

const COMMUNITY_TAGS = [
  "tagSoil", "tagCrops", "tagIrrigation", "tagOrganic",
  "tagRegeneration", "tagTech", "tagClimate", "tagCompost"
];

function PostTypeLabel({ type, t }: { type: string; t: (k: string) => string }) {
  const labels: Record<string, string> = {
    experience: t("community.experience"),
    parcel_results: t("community.parcelResults"),
    question: t("community.question"),
    tip: t("community.tip"),
  };
  return (
    <Badge className={`text-xs font-medium ${POST_TYPE_COLORS[type] || ""}`} data-testid={`badge-type-${type}`}>
      {labels[type] || type}
    </Badge>
  );
}

function RoleLabel({ role }: { role: string }) {
  const colors: Record<string, string> = {
    admin: "text-red-600 bg-red-50 border-red-200",
    farmer: "text-green-700 bg-green-50 border-green-200",
    researcher: "text-blue-600 bg-blue-50 border-blue-200",
  };
  const labels: Record<string, string> = {
    admin: "Admin",
    farmer: "Productor",
    researcher: "Investigador",
  };
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium border ${colors[role] || "text-gray-600 bg-gray-50 border-gray-200"}`}>
      {labels[role] || role}
    </span>
  );
}

function ImageLightbox({
  urls,
  initialIndex,
  onClose,
  t,
}: {
  urls: string[];
  initialIndex: number;
  onClose: () => void;
  t: (k: string) => string;
}) {
  const [currentIndex, setCurrentIndex] = useState(initialIndex);

  const handlePrev = () => setCurrentIndex((prev) => (prev > 0 ? prev - 1 : urls.length - 1));
  const handleNext = () => setCurrentIndex((prev) => (prev < urls.length - 1 ? prev + 1 : 0));

  return (
    <div
      className="fixed inset-0 z-50 bg-black/90 flex items-center justify-center"
      onClick={onClose}
      data-testid="lightbox-overlay"
    >
      <button
        className="absolute top-4 right-4 text-white hover:text-gray-300 z-50 bg-black/50 rounded-full p-2 transition-colors"
        onClick={(e) => { e.stopPropagation(); onClose(); }}
        data-testid="btn-lightbox-close"
      >
        <X className="h-6 w-6" />
      </button>

      <div className="absolute top-4 left-1/2 -translate-x-1/2 text-white text-sm bg-black/50 px-3 py-1 rounded-full">
        {currentIndex + 1} / {urls.length}
      </div>

      {urls.length > 1 && (
        <>
          <button
            className="absolute left-4 text-white hover:text-gray-300 bg-black/50 rounded-full p-2 transition-colors z-50"
            onClick={(e) => { e.stopPropagation(); handlePrev(); }}
            data-testid="btn-lightbox-prev"
          >
            <ChevronLeft className="h-8 w-8" />
          </button>
          <button
            className="absolute right-4 text-white hover:text-gray-300 bg-black/50 rounded-full p-2 transition-colors z-50"
            onClick={(e) => { e.stopPropagation(); handleNext(); }}
            data-testid="btn-lightbox-next"
          >
            <ChevronRight className="h-8 w-8" />
          </button>
        </>
      )}

      <img
        src={urls[currentIndex]}
        alt=""
        className="max-h-[90vh] max-w-[90vw] object-contain rounded-lg"
        onClick={(e) => e.stopPropagation()}
        data-testid="lightbox-image"
      />
    </div>
  );
}

function MediaGallery({ urls, t }: { urls: string[]; t: (k: string) => string }) {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (!urls || urls.length === 0) return null;

  const isVideo = (url: string) => /\.(mp4|webm|mov)$/i.test(url);
  const imageUrls = urls.filter((u) => !isVideo(u));
  const maxShow = 4;

  const handleImageClick = (e: React.MouseEvent, url: string) => {
    e.stopPropagation();
    const idx = imageUrls.indexOf(url);
    if (idx >= 0) setLightboxIndex(idx);
  };

  if (urls.length === 1) {
    const url = urls[0];
    return (
      <>
        <div className="mt-3 rounded-xl overflow-hidden border">
          {isVideo(url) ? (
            <video src={url} controls className="w-full max-h-[400px] object-cover" data-testid="media-video" />
          ) : (
            <img
              src={url}
              alt=""
              className="w-full max-h-[400px] object-cover cursor-pointer hover:opacity-95 transition-opacity"
              loading="lazy"
              data-testid="media-image"
              onClick={(e) => handleImageClick(e, url)}
            />
          )}
        </div>
        {lightboxIndex !== null && (
          <ImageLightbox urls={imageUrls} initialIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} t={t} />
        )}
      </>
    );
  }

  if (urls.length === 2) {
    return (
      <>
        <div className="mt-3 grid grid-cols-2 gap-1.5 rounded-xl overflow-hidden">
          {urls.map((url, i) => (
            <div key={i} className="aspect-square overflow-hidden">
              {isVideo(url) ? (
                <video src={url} controls className="w-full h-full object-cover" data-testid={`media-video-${i}`} />
              ) : (
                <img
                  src={url}
                  alt=""
                  className="w-full h-full object-cover cursor-pointer hover:opacity-95 transition-opacity"
                  loading="lazy"
                  data-testid={`media-image-${i}`}
                  onClick={(e) => handleImageClick(e, url)}
                />
              )}
            </div>
          ))}
        </div>
        {lightboxIndex !== null && (
          <ImageLightbox urls={imageUrls} initialIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} t={t} />
        )}
      </>
    );
  }

  const displayUrls = urls.slice(0, maxShow);
  const remaining = urls.length - maxShow;

  return (
    <>
      <div className={`mt-3 grid gap-1.5 rounded-xl overflow-hidden ${urls.length === 3 ? 'grid-cols-3' : 'grid-cols-2'}`}>
        {displayUrls.map((url, i) => (
          <div key={i} className={`relative aspect-square overflow-hidden ${i === 0 && urls.length >= 3 ? 'row-span-1' : ''}`}>
            {isVideo(url) ? (
              <video src={url} controls className="w-full h-full object-cover" data-testid={`media-video-${i}`} />
            ) : (
              <img
                src={url}
                alt=""
                className="w-full h-full object-cover cursor-pointer hover:opacity-95 transition-opacity"
                loading="lazy"
                data-testid={`media-image-${i}`}
                onClick={(e) => handleImageClick(e, url)}
              />
            )}
            {i === maxShow - 1 && remaining > 0 && (
              <div
                className="absolute inset-0 bg-black/50 flex items-center justify-center cursor-pointer"
                onClick={(e) => handleImageClick(e, url)}
              >
                <span className="text-white text-2xl font-bold">+{remaining} {t("community.moreImages")}</span>
              </div>
            )}
          </div>
        ))}
      </div>
      {lightboxIndex !== null && (
        <ImageLightbox urls={imageUrls} initialIndex={lightboxIndex} onClose={() => setLightboxIndex(null)} t={t} />
      )}
    </>
  );
}

function ParcelCard({ parcel, t }: { parcel: PostParcel; t: (k: string) => string }) {
  const [, navigate] = useLocation();

  return (
    <div className="mt-3 p-4 rounded-xl bg-gradient-to-br from-emerald-50 via-teal-50 to-green-50 dark:from-emerald-950/40 dark:via-teal-950/30 dark:to-green-950/30 border border-emerald-200/80 dark:border-emerald-800/60" data-testid="parcel-info-card">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="p-1.5 bg-emerald-100 dark:bg-emerald-900/60 rounded-lg">
            <Leaf className="h-4 w-4 text-emerald-600" />
          </div>
          <span className="text-sm font-semibold text-emerald-800 dark:text-emerald-300">{t("community.parcelInfo")}</span>
        </div>
        <Button
          size="sm"
          variant="default"
          className="gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs h-8"
          onClick={(e) => {
            e.stopPropagation();
            navigate(`/parcel/${parcel.id}/indices`);
          }}
          data-testid="btn-view-indicators"
        >
          <Eye className="h-3.5 w-3.5" />
          {t("community.viewIndicators")}
        </Button>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
        <div>
          <span className="text-muted-foreground text-xs block mb-0.5">{t("community.crop")}</span>
          <p className="font-medium flex items-center gap-1">
            <Leaf className="h-3 w-3 text-emerald-500" />
            {parcel.crop}
          </p>
        </div>
        <div>
          <span className="text-muted-foreground text-xs block mb-0.5">{t("community.area")}</span>
          <p className="font-medium">{parcel.area} ha</p>
        </div>
        <div>
          <span className="text-muted-foreground text-xs block mb-0.5">{t("community.location")}</span>
          <p className="font-medium flex items-center gap-1 truncate"><MapPin className="h-3 w-3 shrink-0" /> {parcel.location}</p>
        </div>
      </div>
    </div>
  );
}

function PostCard({
  post,
  onLike,
  onNavigate,
  t,
  user,
  locale,
}: {
  post: CommunityPost;
  onLike: (id: string) => void;
  onNavigate: (id: string) => void;
  t: (k: string) => string;
  user: any;
  locale: string;
}) {
  const { toast } = useToast();
  const [likeAnimating, setLikeAnimating] = useState(false);
  const [translated, setTranslated] = useState<{ title: string; content: string } | null>(null);
  const [translating, setTranslating] = useState(false);
  const [showTranslated, setShowTranslated] = useState(false);

  const handleLike = (e: React.MouseEvent) => {
    e.stopPropagation();
    setLikeAnimating(true);
    setTimeout(() => setLikeAnimating(false), 300);
    onLike(post.id);
  };

  const handleShare = (e: React.MouseEvent) => {
    e.stopPropagation();
    const url = `${window.location.origin}/community?post=${post.id}`;
    navigator.clipboard.writeText(url).then(() => {
      toast({ title: t("community.linkCopied") });
    });
  };

  const handleTranslate = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (showTranslated) {
      setShowTranslated(false);
      return;
    }
    if (translated) {
      setShowTranslated(true);
      return;
    }
    setTranslating(true);
    try {
      const res = await fetch("/api/community/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: [post.title, post.content], targetLang: locale }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setTranslated({ title: data.translations[0], content: data.translations[1] });
      setShowTranslated(true);
    } catch {
      toast({ title: t("community.translateError"), variant: "destructive" });
    } finally {
      setTranslating(false);
    }
  };

  const avatarColor = getAvatarColor(post.author?.name || "");
  const displayTitle = showTranslated && translated ? translated.title : post.title;
  const displayContent = showTranslated && translated ? translated.content : post.content;

  return (
    <div
      className="bg-white rounded-2xl border border-gray-100 shadow-sm hover:shadow-md transition-all duration-300 group overflow-hidden"
      data-testid={`post-card-${post.id}`}
    >
      {/* Colored top accent bar by post type */}
      <div className={`h-0.5 w-full ${post.type === 'experience' ? 'bg-gradient-to-r from-emerald-400 to-teal-400' : post.type === 'parcel_results' ? 'bg-gradient-to-r from-blue-400 to-cyan-400' : post.type === 'question' ? 'bg-gradient-to-r from-amber-400 to-orange-400' : 'bg-gradient-to-r from-purple-400 to-pink-400'}`} />

      <div className="p-4 pb-2 cursor-pointer" onClick={() => onNavigate(post.id)}>
        <div className="flex items-start gap-3">
          <Avatar className="h-11 w-11 shrink-0 ring-2 ring-emerald-50 shadow-sm">
            {post.author?.avatarUrl && <AvatarImage src={post.author.avatarUrl} alt={post.author.name} />}
            <AvatarFallback className={`${avatarColor} text-white font-bold text-sm`}>
              {post.author?.name?.charAt(0)?.toUpperCase() || "?"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <span className="font-semibold text-sm text-gray-900 hover:text-emerald-700 cursor-pointer">{post.author?.name || "Anónimo"}</span>
            <div className="flex items-center gap-1.5 mt-0.5 flex-wrap">
              {post.author?.role && <RoleLabel role={post.author.role} />}
              <span className="text-[10px] text-gray-400 flex items-center gap-0.5">
                <Clock className="h-2.5 w-2.5" /> {timeAgo(post.createdAt, t)}
              </span>
            </div>
          </div>
          <PostTypeLabel type={post.type} t={t} />
        </div>

        <div className="mt-3">
          <h3 className="text-[15px] font-semibold text-gray-900 leading-snug mb-1.5 group-hover:text-emerald-800 transition-colors" data-testid={`post-title-${post.id}`}>
            {displayTitle}
          </h3>
          <p className="text-sm text-gray-500 leading-relaxed line-clamp-3">
            {displayContent}
          </p>
          {showTranslated && (
            <p className="text-[11px] text-gray-400 mt-1 italic">{t("community.translate")} • AI</p>
          )}
        </div>

        {post.tags && post.tags.length > 0 && (
          <div className="flex items-center gap-1.5 mt-2.5 flex-wrap">
            {post.tags.map((tag) => (
              <span key={tag} className="text-[11px] px-2 py-0.5 rounded-full bg-emerald-50 text-emerald-700 font-medium border border-emerald-100 hover:bg-emerald-100 cursor-pointer transition-colors" data-testid={`tag-${tag}`}>
                #{tag}
              </span>
            ))}
          </div>
        )}

        {post.parcel && <ParcelCard parcel={post.parcel} t={t} />}
        <MediaGallery urls={post.mediaUrls || []} t={t} />
      </div>

      {(post.likesCount > 0 || post.commentsCount > 0) && (
        <div className="px-4 py-1.5 flex items-center justify-between text-xs text-gray-400 border-t border-gray-50">
          {post.likesCount > 0 && (
            <div className="flex items-center gap-1">
              <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-gradient-to-br from-emerald-400 to-teal-500">
                <ThumbsUp className="w-2 h-2 text-white fill-white" />
              </span>
              <span className="font-medium text-gray-500">{post.likesCount}</span>
            </div>
          )}
          {post.commentsCount > 0 && (
            <span className="hover:text-emerald-600 cursor-pointer transition-colors" onClick={() => onNavigate(post.id)}>
              {post.commentsCount} {t("community.replies")}
            </span>
          )}
        </div>
      )}

      <div className="border-t border-gray-50">
        <div className="flex items-center px-1 py-0.5">
          <button
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all duration-200 flex-1 justify-center ${post.userLiked ? 'text-emerald-700 bg-emerald-50' : 'text-gray-500 hover:bg-gray-50 hover:text-emerald-700'} ${likeAnimating ? 'scale-110' : 'scale-100'}`}
            onClick={handleLike}
            data-testid={`btn-like-${post.id}`}
          >
            <ThumbsUp className={`w-4 h-4 ${post.userLiked ? 'fill-emerald-700' : ''}`} />
            <span className="hidden sm:inline">{t("community.likes")}</span>
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-blue-600 transition-all flex-1 justify-center"
            onClick={() => onNavigate(post.id)}
            data-testid={`btn-comments-${post.id}`}
          >
            <MessageSquare className="w-4 h-4" />
            <span className="hidden sm:inline">{t("community.comments")}</span>
          </button>
          <button
            className={`flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium transition-all flex-1 justify-center ${showTranslated ? 'text-blue-600 bg-blue-50' : 'text-gray-500 hover:bg-gray-50 hover:text-blue-600'}`}
            onClick={handleTranslate}
            disabled={translating}
            data-testid={`btn-translate-${post.id}`}
          >
            {translating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Languages className="w-4 h-4" />}
            <span className="hidden sm:inline">{translating ? t("community.translating") : showTranslated ? t("community.showOriginal") : t("community.translate")}</span>
          </button>
          <button
            className="flex items-center gap-1.5 px-3 py-2 rounded-xl text-xs font-medium text-gray-500 hover:bg-gray-50 hover:text-purple-600 transition-all flex-1 justify-center"
            onClick={handleShare}
            data-testid={`btn-share-${post.id}`}
          >
            <Share2 className="w-4 h-4" />
            <span className="hidden sm:inline">{t("community.sharePost")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function WelcomePostDialog({
  open,
  onOpenChange,
  user,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: any;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const firstName = user?.name?.split(" ")[0] || "";
  const farming = (user?.farmingTypes ?? []).filter(Boolean);

  const defaultContent = farming.length > 0
    ? `¡Hola a todos! Soy ${firstName} y me dedico a ${farming.join(", ")}. Me alegra ser parte de esta comunidad. Estoy aquí para aprender y compartir experiencias sobre agricultura regenerativa. ¡Espero conectar con productores que tengan metas similares!`
    : `¡Hola a todos! Soy ${firstName} y me alegra ser parte de esta comunidad. Estoy aquí para aprender y compartir experiencias sobre agricultura regenerativa. ¡Espero conectar con productores que tengan metas similares!`;

  const [content, setContent] = useState(defaultContent);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!content.trim()) return;
    setLoading(true);
    try {
      const res = await fetch("/api/community/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          title: `¡Hola comunidad! Soy ${firstName}`,
          content: content.trim(),
          type: "experience",
          tags: ["bienvenida", "presentación"],
          mediaUrls: [],
        }),
      });
      if (!res.ok) throw new Error("Error al publicar");
      queryClient.invalidateQueries({ queryKey: ["community-posts"] });
      toast({ title: "¡Publicación enviada!", description: "Tu mensaje de bienvenida ya está en el foro." });
      onOpenChange(false);
    } catch {
      toast({ title: "Error", description: "No se pudo publicar. Intenta de nuevo.", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md p-0 gap-0 overflow-hidden rounded-2xl">
        <div className="bg-gradient-to-br from-emerald-600 to-green-700 px-6 py-5 text-white">
          <div className="flex items-center gap-3 mb-1">
            <span className="text-3xl">🌱</span>
            <div>
              <DialogTitle className="text-lg font-bold text-white">
                ¡Bienvenido/a, {firstName}!
              </DialogTitle>
              <p className="text-emerald-100 text-sm">Ya eres parte de AgRegen</p>
            </div>
          </div>
        </div>

        <div className="px-6 py-4">
          <p className="text-sm text-gray-600 mb-3">
            Preséntate a la comunidad. Puedes editar el texto como quieras antes de publicar:
          </p>
          <div className="relative">
            <textarea
              className="w-full min-h-[130px] text-sm border border-gray-200 rounded-lg p-3 resize-none focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:border-transparent leading-relaxed"
              value={content}
              onChange={(e) => setContent(e.target.value)}
              maxLength={1000}
              data-testid="textarea-welcome-message"
            />
            <span className="absolute bottom-2 right-3 text-xs text-gray-400">
              {content.length}/1000
            </span>
          </div>
        </div>

        <div className="flex gap-2 px-6 pb-5">
          <Button
            variant="outline"
            className="flex-1 text-sm"
            onClick={() => onOpenChange(false)}
            data-testid="btn-welcome-skip"
          >
            Hacerlo después
          </Button>
          <Button
            className="flex-1 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold"
            onClick={handleSubmit}
            disabled={!content.trim() || loading}
            data-testid="btn-welcome-submit"
          >
            {loading ? "Publicando..." : "Publicar presentación"}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

const TYPE_META: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  experience:     { icon: <Leaf className="h-3.5 w-3.5" />,         color: "text-emerald-700", bg: "bg-emerald-100 hover:bg-emerald-200" },
  parcel_results: { icon: <BarChart3 className="h-3.5 w-3.5" />,    color: "text-blue-700",    bg: "bg-blue-100 hover:bg-blue-200" },
  question:       { icon: <MessageSquare className="h-3.5 w-3.5" />, color: "text-amber-700",   bg: "bg-amber-100 hover:bg-amber-200" },
  tip:            { icon: <Sparkles className="h-3.5 w-3.5" />,      color: "text-purple-700",  bg: "bg-purple-100 hover:bg-purple-200" },
};

function CreatePostDialog({
  open,
  onOpenChange,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  t: (k: string) => string;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [content, setContent] = useState("");
  const [type, setType] = useState("experience");
  const [parcelId, setParcelId] = useState<string>("");
  const [showParcel, setShowParcel] = useState(false);
  const [tags, setTags] = useState("");
  const [showTags, setShowTags] = useState(false);
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [mediaPreviews, setMediaPreviews] = useState<string[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  const firstName = user?.name?.split(" ")[0] || "";

  const { data: userParcels } = useQuery<any[]>({
    queryKey: ["community-user-parcels"],
    queryFn: async () => {
      const res = await fetch("/api/community/user-parcels", { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const createPostMutation = useMutation({
    mutationFn: async (postData: any) => {
      const res = await fetch("/api/community/posts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(postData),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Error");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["community-posts"] });
      toast({ title: t("community.postCreated"), description: t("community.postCreatedDesc") });
      resetForm();
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({ title: t("community.error"), description: err.message, variant: "destructive" });
    },
  });

  const resetForm = () => {
    setContent("");
    setType("experience");
    setParcelId("");
    setShowParcel(false);
    setTags("");
    setShowTags(false);
    setMediaFiles([]);
    setMediaPreviews([]);
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    if (mediaFiles.length + files.length > 5) {
      toast({ title: t("community.error"), description: t("community.maxFiles"), variant: "destructive" });
      return;
    }
    setMediaFiles(prev => [...prev, ...files]);
    files.forEach(f => {
      const reader = new FileReader();
      reader.onload = (ev) => setMediaPreviews(prev => [...prev, ev.target?.result as string]);
      reader.readAsDataURL(f);
    });
    if (e.target) e.target.value = "";
  };

  const removeMedia = (index: number) => {
    setMediaFiles(prev => prev.filter((_, i) => i !== index));
    setMediaPreviews(prev => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    if (!content.trim()) return;
    setIsUploading(true);

    let mediaUrls: string[] = [];
    if (mediaFiles.length > 0) {
      const formData = new FormData();
      mediaFiles.forEach(f => formData.append("files", f));
      try {
        const uploadRes = await fetch("/api/community/upload", {
          method: "POST",
          credentials: "include",
          body: formData,
        });
        if (uploadRes.ok) {
          const data = await uploadRes.json();
          mediaUrls = data.urls;
        } else {
          const errData = await uploadRes.json().catch(() => ({}));
          toast({ title: t("community.error"), description: errData.message || t("community.uploadError"), variant: "destructive" });
          setIsUploading(false);
          return;
        }
      } catch (err) {
        console.error("Upload error:", err);
        toast({ title: t("community.error"), description: t("community.uploadError"), variant: "destructive" });
        setIsUploading(false);
        return;
      }
    }

    const autoTitle = content.trim().replace(/\n+/g, " ").slice(0, 70);
    const tagList = tags.split(",").map(s => s.trim()).filter(Boolean);

    createPostMutation.mutate(
      { title: autoTitle, content: content.trim(), type, parcelId: showParcel && parcelId ? parcelId : null, tags: tagList, mediaUrls },
      { onSettled: () => setIsUploading(false) },
    );
  };

  const isVideo = (file: File) => file.type.startsWith("video/");
  const typeMeta = TYPE_META[type] ?? TYPE_META.experience;
  const linkedParcel = showParcel && parcelId ? userParcels?.find((p: any) => p.id === parcelId) : null;

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) resetForm(); onOpenChange(v); }}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden rounded-xl">
        {/* Header */}
        <div className="relative flex items-center justify-center py-4 px-4 border-b border-gray-200">
          <DialogTitle className="font-bold text-lg">{t("community.createPost")}</DialogTitle>
        </div>

        <div className="overflow-y-auto max-h-[70vh]">
          {/* User identity + type selector */}
          <div className="flex items-center gap-3 px-4 pt-4 pb-2">
            <Avatar className="h-11 w-11 ring-2 ring-white shadow-sm flex-shrink-0">
              {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.name} />}
              <AvatarFallback className={`${getAvatarColor(user?.name || "")} text-white font-bold`}>
                {user?.name?.charAt(0)?.toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="flex flex-col gap-1">
              <span className="font-semibold text-sm leading-tight">{user?.name}</span>
              <Select value={type} onValueChange={setType}>
                <SelectTrigger
                  className={`h-6 text-xs font-semibold border-none shadow-none px-2 py-0 rounded-md w-auto gap-1 ${typeMeta.bg} ${typeMeta.color}`}
                  data-testid="select-post-type"
                >
                  {typeMeta.icon}
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="experience">
                    <span className="flex items-center gap-2"><Leaf className="h-3.5 w-3.5 text-emerald-600" />{t("community.experience")}</span>
                  </SelectItem>
                  <SelectItem value="parcel_results">
                    <span className="flex items-center gap-2"><BarChart3 className="h-3.5 w-3.5 text-blue-600" />{t("community.parcelResults")}</span>
                  </SelectItem>
                  <SelectItem value="question">
                    <span className="flex items-center gap-2"><MessageSquare className="h-3.5 w-3.5 text-amber-600" />{t("community.question")}</span>
                  </SelectItem>
                  <SelectItem value="tip">
                    <span className="flex items-center gap-2"><Sparkles className="h-3.5 w-3.5 text-purple-600" />{t("community.tip")}</span>
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          {/* Main textarea */}
          <div className="px-4 pb-2">
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={firstName ? `¿Qué estás pensando, ${firstName}?` : t("community.whatsOnMind")}
              className="border-none shadow-none resize-none focus-visible:ring-0 text-base placeholder:text-gray-400 min-h-[120px] p-0"
              data-testid="input-post-content"
            />
          </div>

          {/* Media previews */}
          {mediaPreviews.length > 0 && (
            <div className={`px-4 pb-3 grid gap-2 ${mediaPreviews.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
              {mediaPreviews.map((preview, i) => (
                <div key={i} className="relative rounded-xl overflow-hidden border border-gray-200 aspect-square group/media">
                  {mediaFiles[i] && isVideo(mediaFiles[i]) ? (
                    <video src={preview} className="w-full h-full object-cover" />
                  ) : (
                    <img src={preview} alt="" className="w-full h-full object-cover" />
                  )}
                  <button
                    onClick={() => removeMedia(i)}
                    className="absolute top-2 right-2 bg-black/60 text-white rounded-full p-1.5 opacity-0 group-hover/media:opacity-100 transition-opacity"
                    data-testid={`btn-remove-media-${i}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* Tags panel */}
          {showTags && (
            <div className="px-4 pb-3">
              <div className="flex items-center gap-2 bg-gray-50 rounded-xl px-3 py-2 border border-gray-200">
                <Hash className="h-4 w-4 text-amber-500 flex-shrink-0" />
                <input
                  type="text"
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  placeholder={t("community.tagsPlaceholder")}
                  className="flex-1 bg-transparent text-sm outline-none placeholder:text-gray-400"
                  data-testid="input-tags"
                />
                {tags && (
                  <button onClick={() => setTags("")} className="text-gray-400 hover:text-gray-600">
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>
              {tags && (
                <div className="flex flex-wrap gap-1 mt-2 px-1">
                  {tags.split(",").map(s => s.trim()).filter(Boolean).map((tag, i) => (
                    <span key={i} className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full">#{tag}</span>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Parcel panel */}
          {showParcel && (
            <div className="px-4 pb-3">
              {userParcels && userParcels.length > 0 ? (
                <Select value={parcelId} onValueChange={setParcelId}>
                  <SelectTrigger className="bg-gray-50 border-gray-200 rounded-xl" data-testid="select-parcel">
                    <span className="flex items-center gap-2 text-sm">
                      <Leaf className="h-4 w-4 text-emerald-600" />
                      <SelectValue placeholder={t("community.selectParcel")} />
                    </span>
                  </SelectTrigger>
                  <SelectContent>
                    {userParcels.map((p: any) => (
                      <SelectItem key={p.id} value={p.id}>
                        <span className="flex items-center gap-2">
                          <Leaf className="h-3.5 w-3.5 text-emerald-600" />
                          {p.name} — {p.crop} ({p.area} ha)
                        </span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground italic px-1">{t("community.noPublicParcels")}</p>
              )}
              {linkedParcel && (
                <div className="mt-2 flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-xl px-3 py-2">
                  <Leaf className="h-4 w-4 text-emerald-600 flex-shrink-0" />
                  <span className="text-xs font-medium text-emerald-800">{linkedParcel.name} · {linkedParcel.crop} · {linkedParcel.area} ha</span>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Bottom toolbar */}
        <div className="px-4 pb-2">
          <div className="flex items-center justify-between border border-gray-200 rounded-xl px-4 py-2.5">
            <span className="text-sm font-medium text-gray-600">{t("community.addToPost")}</span>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                title={t("community.uploadMedia")}
                className="p-2 rounded-full hover:bg-green-50 transition-colors group"
                data-testid="btn-add-photo"
              >
                <ImageIcon className="h-5 w-5 text-green-500 group-hover:text-green-600" />
              </button>
              <button
                type="button"
                onClick={() => setShowTags(v => !v)}
                title={t("community.addTags")}
                className={`p-2 rounded-full transition-colors group ${showTags ? "bg-amber-100" : "hover:bg-amber-50"}`}
                data-testid="btn-add-tags"
              >
                <Hash className={`h-5 w-5 ${showTags ? "text-amber-600" : "text-amber-400 group-hover:text-amber-500"}`} />
              </button>
              <button
                type="button"
                onClick={() => { setShowParcel(v => !v); if (showParcel) setParcelId(""); }}
                title={t("community.linkParcel")}
                className={`p-2 rounded-full transition-colors group ${showParcel ? "bg-emerald-100" : "hover:bg-emerald-50"}`}
                data-testid="btn-link-parcel"
              >
                <Leaf className={`h-5 w-5 ${showParcel ? "text-emerald-600" : "text-emerald-400 group-hover:text-emerald-500"}`} />
              </button>
            </div>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,video/*"
            className="hidden"
            onChange={handleFileSelect}
          />
        </div>

        {/* Publish button */}
        <div className="px-4 pb-4 pt-1">
          <Button
            onClick={handleSubmit}
            disabled={!content.trim() || createPostMutation.isPending || isUploading}
            className="w-full rounded-xl font-semibold"
            data-testid="btn-publish-post"
          >
            {createPostMutation.isPending || isUploading
              ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />{t("community.publishing")}</>
              : t("community.publish")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PostDetailView({
  postId,
  onBack,
  t,
  user,
  locale,
}: {
  postId: string;
  onBack: () => void;
  t: (k: string) => string;
  user: any;
  locale: string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [commentText, setCommentText] = useState("");
  const [replyTo, setReplyTo] = useState<{ id: string; name: string } | null>(null);
  const [translatedComments, setTranslatedComments] = useState<Record<string, string>>({});
  const [translatingComments, setTranslatingComments] = useState<Record<string, boolean>>({});
  const [showTranslatedComments, setShowTranslatedComments] = useState<Record<string, boolean>>({});
  const [translatedPost, setTranslatedPost] = useState<{ title: string; content: string } | null>(null);
  const [translatingPost, setTranslatingPost] = useState(false);
  const [showTranslatedPost, setShowTranslatedPost] = useState(false);

  const handleTranslatePost = async () => {
    if (showTranslatedPost) { setShowTranslatedPost(false); return; }
    if (translatedPost) { setShowTranslatedPost(true); return; }
    setTranslatingPost(true);
    try {
      const res = await fetch("/api/community/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: [postDetail?.title || "", postDetail?.content || ""], targetLang: locale }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setTranslatedPost({ title: data.translations[0], content: data.translations[1] });
      setShowTranslatedPost(true);
    } catch {
      toast({ title: t("community.translateError"), variant: "destructive" });
    } finally {
      setTranslatingPost(false);
    }
  };

  const handleTranslateComment = async (commentId: string, content: string) => {
    if (showTranslatedComments[commentId]) {
      setShowTranslatedComments(prev => ({ ...prev, [commentId]: false }));
      return;
    }
    if (translatedComments[commentId]) {
      setShowTranslatedComments(prev => ({ ...prev, [commentId]: true }));
      return;
    }
    setTranslatingComments(prev => ({ ...prev, [commentId]: true }));
    try {
      const res = await fetch("/api/community/translate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts: [content], targetLang: locale }),
      });
      if (!res.ok) throw new Error();
      const data = await res.json();
      setTranslatedComments(prev => ({ ...prev, [commentId]: data.translations[0] }));
      setShowTranslatedComments(prev => ({ ...prev, [commentId]: true }));
    } catch {
      toast({ title: t("community.translateError"), variant: "destructive" });
    } finally {
      setTranslatingComments(prev => ({ ...prev, [commentId]: false }));
    }
  };

  const { data: postDetail, isLoading } = useQuery<CommunityPost & { comments: CommunityComment[] }>({
    queryKey: ["community-post", postId],
    queryFn: async () => {
      const res = await fetch(`/api/community/posts/${postId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
  });

  const likeMutation = useMutation({
    mutationFn: async (targetId: string) => {
      const res = await fetch(`/api/community/posts/${targetId}/like`, {
        method: "POST",
        credentials: "include",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["community-post", postId] });
      queryClient.invalidateQueries({ queryKey: ["community-posts"] });
    },
  });

  const commentLikeMutation = useMutation({
    mutationFn: async (commentId: string) => {
      const res = await fetch(`/api/community/comments/${commentId}/like`, {
        method: "POST",
        credentials: "include",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["community-post", postId] });
    },
  });

  const commentMutation = useMutation({
    mutationFn: async ({ content, parentId }: { content: string; parentId?: string | null }) => {
      const res = await fetch(`/api/community/posts/${postId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content, parentId: parentId || null }),
      });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    onSuccess: () => {
      setCommentText("");
      setReplyTo(null);
      queryClient.invalidateQueries({ queryKey: ["community-post", postId] });
      queryClient.invalidateQueries({ queryKey: ["community-posts"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/community/posts/${postId}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    onSuccess: () => {
      toast({ title: t("community.postDeleted") });
      queryClient.invalidateQueries({ queryKey: ["community-posts"] });
      onBack();
    },
  });

  const [detailLikeAnimating, setDetailLikeAnimating] = useState(false);

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="h-8 bg-muted rounded animate-pulse w-1/3" />
        <div className="h-40 bg-muted rounded animate-pulse" />
      </div>
    );
  }

  if (!postDetail) return null;

  const isOwner = user?.id === postDetail.userId;
  const isAdmin = user?.role === "admin";

  const topLevelComments = (postDetail.comments || []).filter((c) => !c.parentId);
  const repliesMap: Record<string, CommunityComment[]> = {};
  (postDetail.comments || []).forEach((c) => {
    if (c.parentId) {
      if (!repliesMap[c.parentId]) repliesMap[c.parentId] = [];
      repliesMap[c.parentId].push(c);
    }
  });

  const avatarColor = getAvatarColor(postDetail.author?.name || "");

  const renderComment = (comment: CommunityComment, isReply = false) => (
    <div key={comment.id} className={`flex gap-3 ${isReply ? 'ml-8 pl-4 border-l-2 border-muted' : ''}`} data-testid={`comment-${comment.id}`}>
      <Avatar className="h-8 w-8 shrink-0">
        {comment.author?.avatarUrl && <AvatarImage src={comment.author.avatarUrl} alt={comment.author.name} />}
        <AvatarFallback className={`${getAvatarColor(comment.author?.name || "")} text-white text-xs font-semibold`}>
          {comment.author?.name?.charAt(0)?.toUpperCase() || "?"}
        </AvatarFallback>
      </Avatar>
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-semibold">{comment.author?.name || "Anónimo"}</span>
          {comment.author?.role && <RoleLabel role={comment.author.role} />}
          <span className="text-xs text-muted-foreground">{timeAgo(comment.createdAt, t)}</span>
        </div>
        <p className="text-sm text-foreground">
          {showTranslatedComments[comment.id] && translatedComments[comment.id]
            ? translatedComments[comment.id]
            : comment.content}
        </p>
        {showTranslatedComments[comment.id] && (
          <p className="text-[10px] text-gray-400 mt-0.5 italic">{t("community.translate")} • AI</p>
        )}
        <div className="flex items-center gap-1 mt-1">
          <Button
            variant="ghost"
            size="sm"
            className={`gap-1 text-xs h-6 px-2 ${comment.userLiked ? 'text-primary' : 'text-muted-foreground'}`}
            onClick={() => {
              if (!user) { toast({ title: t("community.loginToLike"), variant: "destructive" }); return; }
              commentLikeMutation.mutate(comment.id);
            }}
            data-testid={`btn-like-comment-${comment.id}`}
          >
            <ThumbsUp className={`w-3 h-3 ${comment.userLiked ? 'fill-primary' : ''}`} />
            {comment.likesCount}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className={`gap-1 text-xs h-6 px-2 ${showTranslatedComments[comment.id] ? 'text-blue-600' : 'text-muted-foreground'} hover:text-blue-600`}
            onClick={() => handleTranslateComment(comment.id, comment.content)}
            disabled={translatingComments[comment.id]}
            data-testid={`btn-translate-comment-${comment.id}`}
          >
            {translatingComments[comment.id] ? <Loader2 className="w-3 h-3 animate-spin" /> : <Languages className="w-3 h-3" />}
            {translatingComments[comment.id] ? t("community.translating") : showTranslatedComments[comment.id] ? t("community.showOriginal") : t("community.translate")}
          </Button>
          {user && !isReply && (
            <Button
              variant="ghost"
              size="sm"
              className="gap-1 text-xs h-6 px-2 text-muted-foreground hover:text-primary"
              onClick={() => setReplyTo({ id: comment.id, name: comment.author?.name || "Anónimo" })}
              data-testid={`btn-reply-comment-${comment.id}`}
            >
              <Reply className="w-3 h-3" />
              {t("community.reply")}
            </Button>
          )}
        </div>
        {repliesMap[comment.id] && repliesMap[comment.id].length > 0 && (
          <div className="mt-3 space-y-3">
            {repliesMap[comment.id].map((reply) => renderComment(reply, true))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-4" data-testid="post-detail-view">
      <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 -ml-2" data-testid="btn-back-to-feed">
        <ArrowLeft className="h-4 w-4" /> {t("community.backToFeed")}
      </Button>

      <Card>
        <CardContent className="pt-6">
          <div className="flex items-start gap-3">
            <Avatar className="h-12 w-12 shrink-0 ring-2 ring-background shadow-sm">
              {postDetail.author?.avatarUrl && <AvatarImage src={postDetail.author.avatarUrl} alt={postDetail.author.name} />}
              <AvatarFallback className={`${avatarColor} text-white font-bold`}>
                {postDetail.author?.name?.charAt(0)?.toUpperCase() || "?"}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1">
              <div className="flex items-center gap-2 flex-wrap mb-1">
                <span className="font-semibold">{postDetail.author?.name}</span>
                {postDetail.author?.role && <RoleLabel role={postDetail.author.role} />}
                <span className="text-xs text-muted-foreground flex items-center gap-1">
                  <Clock className="h-3 w-3" /> {timeAgo(postDetail.createdAt, t)}
                </span>
              </div>
              <div className="flex items-center gap-2 mb-3">
                <PostTypeLabel type={postDetail.type} t={t} />
                {postDetail.tags?.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs">#{tag}</Badge>
                ))}
              </div>
              <h1 className="text-xl font-bold mb-3" data-testid="post-detail-title">
                {showTranslatedPost && translatedPost ? translatedPost.title : postDetail.title}
              </h1>
              <div className="prose prose-sm max-w-none text-foreground whitespace-pre-wrap" data-testid="post-detail-content">
                {showTranslatedPost && translatedPost ? translatedPost.content : postDetail.content}
              </div>
              {showTranslatedPost && (
                <p className="text-[11px] text-gray-400 mt-1 italic">{t("community.translate")} • AI</p>
              )}
              {postDetail.parcel && <ParcelCard parcel={postDetail.parcel} t={t} />}
              <MediaGallery urls={postDetail.mediaUrls || []} t={t} />
            </div>
          </div>
        </CardContent>
        <CardFooter className="py-3 px-5 border-t bg-muted/20 flex items-center gap-4">
          <Button
            variant="ghost"
            size="sm"
            className={`gap-1.5 transition-all duration-200 ${postDetail.userLiked ? 'text-primary font-semibold' : 'text-muted-foreground'} ${detailLikeAnimating ? 'scale-125' : 'scale-100'}`}
            onClick={() => {
              if (!user) { toast({ title: t("community.loginToLike"), variant: "destructive" }); return; }
              setDetailLikeAnimating(true);
              setTimeout(() => setDetailLikeAnimating(false), 300);
              likeMutation.mutate(postDetail.id);
            }}
            data-testid="btn-like-detail"
          >
            <ThumbsUp className={`w-4 h-4 ${postDetail.userLiked ? 'fill-primary' : ''}`} />
            {postDetail.likesCount} {t("community.likes")}
          </Button>
          <span className="text-sm text-muted-foreground flex items-center gap-1.5">
            <MessageSquare className="w-4 h-4" />
            {postDetail.commentsCount} {t("community.comments")}
          </span>
          <Button
            variant="ghost"
            size="sm"
            className={`gap-1.5 ${showTranslatedPost ? 'text-blue-600 font-semibold' : 'text-muted-foreground'} hover:text-blue-600`}
            onClick={handleTranslatePost}
            disabled={translatingPost}
            data-testid="btn-translate-detail"
          >
            {translatingPost ? <Loader2 className="w-4 h-4 animate-spin" /> : <Languages className="w-4 h-4" />}
            {translatingPost ? t("community.translating") : showTranslatedPost ? t("community.showOriginal") : t("community.translate")}
          </Button>
          {(isOwner || isAdmin) && (
            <Button
              variant="ghost"
              size="sm"
              className="text-destructive hover:text-destructive ml-auto gap-1.5"
              onClick={() => {
                if (confirm(t("community.confirmDelete"))) {
                  deleteMutation.mutate();
                }
              }}
              data-testid="btn-delete-post"
            >
              <Trash2 className="w-4 h-4" />
              {t("community.delete")}
            </Button>
          )}
        </CardFooter>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">{t("community.comments")} ({postDetail.comments?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {user ? (
            <div className="space-y-2">
              {replyTo && (
                <div className="flex items-center gap-2 text-sm bg-muted/50 px-3 py-1.5 rounded-lg">
                  <Reply className="h-3.5 w-3.5 text-primary" />
                  <span className="text-muted-foreground">{t("community.replyTo")}</span>
                  <span className="font-medium">{replyTo.name}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1.5 text-xs text-muted-foreground hover:text-destructive ml-auto"
                    onClick={() => setReplyTo(null)}
                    data-testid="btn-cancel-reply"
                  >
                    <X className="h-3 w-3 mr-0.5" />
                    {t("community.cancelReply")}
                  </Button>
                </div>
              )}
              <div className="flex gap-3">
                <Avatar className="h-8 w-8 shrink-0">
                  {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.name} />}
                  <AvatarFallback className={`${getAvatarColor(user.name || "")} text-white text-xs font-semibold`}>
                    {user.name?.charAt(0)?.toUpperCase()}
                  </AvatarFallback>
                </Avatar>
                <div className="flex-1 flex gap-2">
                  <Input
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder={replyTo ? `${t("community.replyTo")} ${replyTo.name}...` : t("community.writeComment")}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && commentText.trim()) {
                        commentMutation.mutate({ content: commentText.trim(), parentId: replyTo?.id || null });
                      }
                    }}
                    data-testid="input-comment"
                  />
                  <Button
                    size="icon"
                    disabled={!commentText.trim() || commentMutation.isPending}
                    onClick={() => commentMutation.mutate({ content: commentText.trim(), parentId: replyTo?.id || null })}
                    data-testid="btn-send-comment"
                  >
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground italic text-center py-2">{t("community.loginToComment")}</p>
          )}

          <Separator />

          {topLevelComments.length > 0 ? (
            <div className="space-y-4">
              {topLevelComments.map((comment) => renderComment(comment))}
            </div>
          ) : (
            <div className="text-center py-8">
              <MessageSquare className="h-10 w-10 mx-auto text-muted-foreground/30 mb-2" />
              <p className="text-sm text-muted-foreground">{t("community.noPostsYet")}</p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface CommunityStats {
  totalMembers: number;
  totalPosts: number;
  totalComments: number;
  activeMembers: { id: string; name: string; role: string; postCount: number }[];
  trendingTags: { tag: string; count: number }[];
}

function CreatePostPrompt({ user, onClick, t }: { user: any; onClick: () => void; t: (k: string) => string }) {
  if (!user) return null;
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm mb-4 overflow-hidden" data-testid="create-post-prompt">
      <div className="p-4 pb-3">
        <div className="flex items-center gap-3">
          <Avatar className="h-10 w-10 ring-2 ring-emerald-50 shadow-sm shrink-0">
            {user.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.name} />}
            <AvatarFallback className="bg-gradient-to-br from-emerald-500 to-teal-600 text-white font-bold text-sm">
              {user.name?.charAt(0)}
            </AvatarFallback>
          </Avatar>
          <div
            className="flex-1 bg-gray-50 hover:bg-emerald-50 border border-gray-200 hover:border-emerald-200 rounded-full px-4 py-2.5 cursor-pointer transition-all text-gray-400 text-sm hover:text-emerald-600"
            onClick={onClick}
            data-testid="btn-whats-on-mind"
          >
            {t("community.whatsOnMind")}
          </div>
        </div>
      </div>
      <div className="border-t border-gray-50 px-2 py-1">
        <div className="flex items-center justify-around">
          <button className="flex items-center gap-1.5 px-3 py-2 rounded-xl hover:bg-emerald-50 transition-colors flex-1 justify-center group" onClick={onClick} data-testid="btn-share-experience">
            <Leaf className="h-4 w-4 text-emerald-500 group-hover:scale-110 transition-transform" />
            <span className="text-xs font-medium text-gray-500 group-hover:text-emerald-700">{t("community.experience")}</span>
          </button>
          <button className="flex items-center gap-1.5 px-3 py-2 rounded-xl hover:bg-blue-50 transition-colors flex-1 justify-center group" onClick={onClick} data-testid="btn-share-photo">
            <Camera className="h-4 w-4 text-blue-500 group-hover:scale-110 transition-transform" />
            <span className="text-xs font-medium text-gray-500 group-hover:text-blue-700">{t("community.photo")}</span>
          </button>
          <button className="flex items-center gap-1.5 px-3 py-2 rounded-xl hover:bg-amber-50 transition-colors flex-1 justify-center group" onClick={onClick} data-testid="btn-ask-question">
            <MessageSquare className="h-4 w-4 text-amber-500 group-hover:scale-110 transition-transform" />
            <span className="text-xs font-medium text-gray-500 group-hover:text-amber-700">{t("community.question")}</span>
          </button>
        </div>
      </div>
    </div>
  );
}

function ProfileSidebar({ user, stats, t }: { user: any; stats: CommunityStats | undefined; t: (k: string) => string }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      {/* Gradient cover */}
      <div className="h-20 bg-gradient-to-br from-emerald-500 via-teal-500 to-cyan-500 relative">
        <div className="absolute inset-0 opacity-20" style={{ backgroundImage: "radial-gradient(circle at 20% 50%, white 1px, transparent 1px), radial-gradient(circle at 80% 20%, white 1px, transparent 1px)", backgroundSize: "24px 24px" }} />
      </div>
      <div className="px-4 pb-4 -mt-9">
        <Avatar className="h-16 w-16 ring-4 ring-white shadow-lg mb-2">
          {user?.avatarUrl && <AvatarImage src={user.avatarUrl} alt={user.name} />}
          <AvatarFallback className="bg-gradient-to-br from-emerald-600 to-teal-700 text-white text-xl font-bold">
            {user?.name?.charAt(0) || "?"}
          </AvatarFallback>
        </Avatar>
        {user ? (
          <>
            <h3 className="font-bold text-gray-900 text-sm leading-tight">{user.name}</h3>
            <p className="text-[11px] text-gray-400 mb-3 truncate">{user.email}</p>
            <div className="flex items-center justify-between bg-gray-50 rounded-xl p-3">
              <div className="text-center">
                <p className="text-base font-bold text-emerald-700">{stats?.totalMembers || 0}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{t("community.members")}</p>
              </div>
              <div className="w-px h-8 bg-gray-200" />
              <div className="text-center">
                <p className="text-base font-bold text-blue-600">{stats?.totalPosts || 0}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{t("community.posts")}</p>
              </div>
              <div className="w-px h-8 bg-gray-200" />
              <div className="text-center">
                <p className="text-base font-bold text-amber-600">{stats?.totalComments || 0}</p>
                <p className="text-[10px] text-gray-400 mt-0.5">{t("community.comments")}</p>
              </div>
            </div>
          </>
        ) : (
          <div className="mt-2 text-center py-2">
            <p className="text-sm text-gray-600 mb-2 leading-snug">{t("community.startSharing")}</p>
            <a href="/auth" className="inline-flex items-center gap-1 text-xs font-semibold text-white bg-gradient-to-r from-emerald-600 to-teal-600 px-4 py-1.5 rounded-full hover:opacity-90 transition-opacity">{t("community.loginToPost")}</a>
          </div>
        )}
      </div>
    </div>
  );
}

function StatsSidebar({ stats, activeTag, onTagClick, t, user, onOpenAdvisor }: {
  stats: CommunityStats | undefined;
  activeTag: string | null;
  onTagClick: (tag: string | null) => void;
  t: (k: string) => string;
  user: any;
  onOpenAdvisor?: () => void;
}) {
  return (
    <div className="space-y-3">
      <ProfileSidebar user={user} stats={stats} t={t} />

      {user && onOpenAdvisor && (
        <div className="rounded-2xl border border-emerald-200 shadow-sm p-4 overflow-hidden relative" style={{ background: "linear-gradient(135deg, #ecfdf5 0%, #f0fdfa 100%)" }}>
          <div className="absolute top-0 right-0 w-20 h-20 bg-emerald-400/10 rounded-full -translate-y-4 translate-x-4" />
          <div className="flex items-center gap-2 mb-2">
            <div className="p-1.5 bg-emerald-100 rounded-xl">
              <Users className="h-4 w-4 text-emerald-600" />
            </div>
            <h3 className="font-semibold text-sm text-emerald-900">Conectar con pares</h3>
          </div>
          <p className="text-xs text-gray-500 mb-3 leading-relaxed">
            Encuentra agricultores con tu mismo cultivo que han documentado resultados exitosos.
          </p>
          <Button
            size="sm"
            className="w-full gap-1.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-full shadow-sm"
            onClick={onOpenAdvisor}
            data-testid="btn-open-advisor"
          >
            <Sparkles className="h-3.5 w-3.5" />
            Conectar con pares
          </Button>
        </div>
      )}

      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm">
        <div className="p-4 pb-3">
          <h3 className="font-semibold text-xs uppercase tracking-wider text-gray-400 mb-3">{t("community.filterByTag")}</h3>
          <div className="space-y-0.5">
            <button
              className={`w-full text-left text-xs px-3 py-1.5 rounded-lg transition-all ${activeTag === null ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'}`}
              onClick={() => onTagClick(null)}
              data-testid="btn-tag-all"
            >
              {t("community.allTopics")}
            </button>
            {COMMUNITY_TAGS.map((tagKey) => {
              const tagLabel = t(`community.${tagKey}`);
              return (
                <button
                  key={tagKey}
                  className={`w-full text-left text-xs px-3 py-1.5 rounded-lg transition-all flex items-center gap-1.5 ${activeTag === tagLabel ? 'bg-emerald-50 text-emerald-700 font-semibold' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-700'}`}
                  onClick={() => onTagClick(activeTag === tagLabel ? null : tagLabel)}
                  data-testid={`btn-filter-${tagKey}`}
                >
                  <span className="text-emerald-400 font-medium">#</span>{tagLabel}
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Community() {
  const { t, locale } = useI18n();
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState("recent");
  const [createOpen, setCreateOpen] = useState(false);
  const [isNewUser] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("welcome") === "1";
  });
  const [advisorOpen, setAdvisorOpen] = useState(false);
  const [welcomePostOpen, setWelcomePostOpen] = useState(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("welcome") === "1";
  });

  // Clean up ?welcome=1 from URL after it's been consumed
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("welcome") === "1") {
      params.delete("welcome");
      const newUrl = params.toString() ? `${window.location.pathname}?${params.toString()}` : window.location.pathname;
      window.history.replaceState({}, "", newUrl);
    }
  }, []);

  const [filterAuthorId, setFilterAuthorId] = useState<string | null>(null);
  const [filterAuthorName, setFilterAuthorName] = useState<string | null>(null);
  const [selectedPostId, setSelectedPostId] = useState<string | null>(() => {
    const params = new URLSearchParams(window.location.search);
    return params.get("post") || null;
  });

  const { data: posts = [], isLoading } = useQuery<CommunityPost[]>({
    queryKey: ["community-posts", searchQuery, activeTag, sortBy, filterAuthorId],
    queryFn: async () => {
      const params = new URLSearchParams();
      if (searchQuery) params.set("search", searchQuery);
      if (activeTag) params.set("tag", activeTag);
      if (filterAuthorId) params.set("authorId", filterAuthorId);
      const res = await fetch(`/api/community/posts?${params.toString()}`, { credentials: "include" });
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: stats } = useQuery<CommunityStats>({
    queryKey: ["community-stats"],
    queryFn: async () => {
      const res = await fetch("/api/community/stats");
      if (!res.ok) return null;
      return res.json();
    },
    staleTime: 60000,
  });

  const sortedPosts = sortBy === "popular"
    ? [...posts].sort((a, b) => b.likesCount - a.likesCount)
    : posts;

  const likeMutation = useMutation({
    mutationFn: async (postId: string) => {
      if (!user) { toast({ title: t("community.loginToLike"), variant: "destructive" }); throw new Error("not logged in"); }
      const res = await fetch(`/api/community/posts/${postId}/like`, {
        method: "POST",
        credentials: "include",
      });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["community-posts"] });
    },
  });

  if (selectedPostId) {
    return (
      <div className="container mx-auto px-4 py-6 max-w-4xl">
        <PostDetailView
          postId={selectedPostId}
          onBack={() => setSelectedPostId(null)}
          t={t}
          user={user}
          locale={locale}
        />
      </div>
    );
  }

  return (
    <div className="min-h-screen" style={{ background: "linear-gradient(135deg, #f0fdf4 0%, #f8fafc 40%, #f0f9ff 100%)" }}>
      {/* Decorative top band */}
      <div className="h-1 w-full bg-gradient-to-r from-emerald-500 via-teal-400 to-green-500" />

      <div className="container mx-auto px-4 py-5 max-w-6xl">
        {/* Search + controls bar */}
        <div className="flex flex-col sm:flex-row gap-3 mb-5 items-center bg-white/80 backdrop-blur-sm rounded-2xl px-4 py-3 shadow-sm border border-white">
          <div className="relative flex-1 w-full">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-emerald-400" />
            <Input
              placeholder={t("community.searchPlaceholder")}
              className="pl-10 bg-transparent border-0 focus-visible:ring-0 text-sm placeholder:text-gray-400"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              data-testid="input-search-posts"
            />
          </div>
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <Tabs value={sortBy} onValueChange={setSortBy} className="flex-1 sm:flex-none">
              <TabsList className="bg-gray-100 border-0 rounded-xl">
                <TabsTrigger value="recent" className="text-xs rounded-lg data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm" data-testid="tab-recent">{t("community.recent")}</TabsTrigger>
                <TabsTrigger value="popular" className="text-xs rounded-lg data-[state=active]:bg-white data-[state=active]:text-emerald-700 data-[state=active]:shadow-sm" data-testid="tab-popular">{t("community.popular")}</TabsTrigger>
              </TabsList>
            </Tabs>
            <Button
              onClick={() => {
                if (!user) { toast({ title: t("community.loginToPost"), variant: "destructive" }); return; }
                setCreateOpen(true);
              }}
              size="sm"
              className="gap-1.5 shrink-0 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-700 hover:to-teal-700 text-white rounded-full px-5 shadow-md shadow-emerald-200 hover:shadow-lg transition-all"
              data-testid="btn-new-post"
            >
              <Plus className="h-4 w-4" />
              <span className="hidden sm:inline">{t("community.newPost")}</span>
            </Button>
          </div>
        </div>

        <div className="lg:hidden mb-4">
          <div className="flex items-center gap-2 overflow-x-auto pb-1 scrollbar-thin">
            <button
              className={`shrink-0 text-xs px-3.5 py-1.5 rounded-full font-medium transition-all ${activeTag === null ? 'bg-emerald-600 text-white shadow-md shadow-emerald-200' : 'bg-white text-gray-500 border border-gray-200 hover:border-emerald-300 hover:text-emerald-700'}`}
              onClick={() => setActiveTag(null)}
              data-testid="btn-tag-all-mobile"
            >
              {t("community.allTopics")}
            </button>
            {COMMUNITY_TAGS.map((tagKey) => {
              const tagLabel = t(`community.${tagKey}`);
              return (
                <button
                  key={tagKey}
                  className={`shrink-0 text-xs px-3.5 py-1.5 rounded-full font-medium transition-all ${activeTag === tagLabel ? 'bg-emerald-600 text-white shadow-md shadow-emerald-200' : 'bg-white text-gray-500 border border-gray-200 hover:border-emerald-300 hover:text-emerald-700'}`}
                  onClick={() => setActiveTag(activeTag === tagLabel ? null : tagLabel)}
                  data-testid={`btn-filter-mobile-${tagKey}`}
                >
                  #{tagLabel}
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
          <div className="hidden lg:block lg:col-span-3">
            <div className="sticky top-24">
              <StatsSidebar
                stats={stats}
                activeTag={activeTag}
                onTagClick={setActiveTag}
                t={t}
                user={user}
                onOpenAdvisor={user ? () => setAdvisorOpen(true) : undefined}
              />
            </div>
          </div>

          <div className="lg:col-span-6 space-y-3">
            {filterAuthorId && filterAuthorName && (
              <div className="flex items-center gap-2 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">
                <Users className="h-4 w-4 text-emerald-600 shrink-0" />
                <span className="text-sm text-emerald-800 flex-1">
                  Publicaciones de <strong>{filterAuthorName}</strong>
                </span>
                <button
                  onClick={() => { setFilterAuthorId(null); setFilterAuthorName(null); }}
                  className="text-emerald-600 hover:text-emerald-800 text-xs underline"
                  data-testid="btn-clear-author-filter"
                >
                  Ver todo
                </button>
              </div>
            )}
            <CreatePostPrompt
              user={user}
              onClick={() => {
                if (!user) { toast({ title: t("community.loginToPost"), variant: "destructive" }); return; }
                setCreateOpen(true);
              }}
              t={t}
            />

            {isLoading ? (
              <div className="space-y-3">
                {[1, 2, 3].map(i => (
                  <div key={i} className="bg-white rounded-2xl border border-gray-100 animate-pulse overflow-hidden">
                    <div className="h-0.5 bg-gradient-to-r from-gray-200 to-gray-100" />
                    <div className="p-4">
                      <div className="flex gap-3">
                        <div className="h-11 w-11 rounded-full bg-gray-100 shrink-0" />
                        <div className="flex-1 space-y-2">
                          <div className="h-3.5 bg-gray-100 rounded-full w-1/3" />
                          <div className="h-2.5 bg-gray-100 rounded-full w-1/4" />
                          <div className="h-4 bg-gray-100 rounded-full w-3/4 mt-3" />
                          <div className="h-3 bg-gray-100 rounded-full w-full" />
                          <div className="h-3 bg-gray-100 rounded-full w-2/3" />
                        </div>
                      </div>
                      <div className="flex gap-2 mt-4">
                        <div className="h-5 bg-gray-100 rounded-full w-16" />
                        <div className="h-5 bg-gray-100 rounded-full w-14" />
                      </div>
                    </div>
                    <div className="border-t border-gray-50 flex px-4 py-2 gap-2">
                      {[1,2,3,4].map(j => <div key={j} className="flex-1 h-7 bg-gray-50 rounded-xl" />)}
                    </div>
                  </div>
                ))}
              </div>
            ) : sortedPosts.length === 0 ? (
              <div className="bg-white rounded-2xl border border-gray-100 text-center py-16 shadow-sm">
                <div className="p-5 bg-gradient-to-br from-emerald-50 to-teal-50 rounded-full w-fit mx-auto mb-5">
                  <Users className="h-12 w-12 text-emerald-500" />
                </div>
                <h3 className="text-lg font-bold text-gray-900 mb-2">{t("community.noPostsYet")}</h3>
                <p className="text-sm text-gray-400 mb-6 max-w-sm mx-auto">{t("community.beFirst")}</p>
                {user && (
                  <Button onClick={() => setCreateOpen(true)} className="gap-2 bg-gradient-to-r from-emerald-600 to-teal-600 hover:opacity-90 rounded-full px-6 shadow-md shadow-emerald-200" data-testid="btn-first-post">
                    <Sparkles className="h-4 w-4" />
                    {t("community.newPost")}
                  </Button>
                )}
              </div>
            ) : (
              sortedPosts.map((post) => (
                <PostCard
                  key={post.id}
                  post={post}
                  onLike={(id) => likeMutation.mutate(id)}
                  onNavigate={(id) => setSelectedPostId(id)}
                  t={t}
                  user={user}
                  locale={locale}
                />
              ))
            )}
          </div>

          <div className="hidden lg:block lg:col-span-3">
            <div className="sticky top-24 space-y-3">
              {/* Trending tags card */}
              <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                <h3 className="font-semibold text-xs uppercase tracking-wider text-gray-400 flex items-center gap-1.5 mb-3">
                  <TrendingUp className="h-3.5 w-3.5 text-emerald-500" />
                  {t("community.trending")}
                </h3>
                {stats && stats.trendingTags.length > 0 ? (
                  <div className="space-y-1">
                    {stats.trendingTags.slice(0, 8).map(({ tag, count }, i) => (
                      <div
                        key={tag}
                        className={`cursor-pointer rounded-xl px-3 py-2 transition-all group ${activeTag === tag ? 'bg-emerald-50 border border-emerald-100' : 'hover:bg-gray-50 border border-transparent'}`}
                        onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                        data-testid={`trend-tag-${tag}`}
                      >
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-2 min-w-0">
                            <span className={`text-[10px] font-bold w-5 h-5 rounded-full flex items-center justify-center shrink-0 ${i === 0 ? 'bg-amber-100 text-amber-700' : i === 1 ? 'bg-gray-100 text-gray-600' : i === 2 ? 'bg-orange-100 text-orange-700' : 'bg-gray-50 text-gray-400'}`}>{i + 1}</span>
                            <p className={`text-sm font-semibold truncate ${activeTag === tag ? 'text-emerald-700' : 'text-gray-800 group-hover:text-emerald-700'} transition-colors`}>#{tag}</p>
                          </div>
                          <span className="text-[10px] text-gray-400 shrink-0 ml-1">{count}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-gray-400 text-center py-2">{t("community.noPostsYet")}</p>
                )}
              </div>

              {/* Top contributors */}
              {stats && stats.activeMembers.length > 0 && (
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-4">
                  <h3 className="font-semibold text-xs uppercase tracking-wider text-gray-400 mb-3">{t("community.topContributors")}</h3>
                  <div className="space-y-2.5">
                    {stats.activeMembers.slice(0, 5).map((member, i) => (
                      <div key={member.id} className="flex items-center gap-2.5 group" data-testid={`right-member-${i}`}>
                        <div className="relative shrink-0">
                          <Avatar className="h-8 w-8 ring-1 ring-emerald-50">
                            <AvatarFallback className={`text-xs font-bold text-white ${AVATAR_COLORS[i % AVATAR_COLORS.length]}`}>
                              {member.name?.charAt(0)}
                            </AvatarFallback>
                          </Avatar>
                          {i < 3 && (
                            <span className={`absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full text-[8px] font-bold flex items-center justify-center ${i === 0 ? 'bg-amber-400 text-white' : i === 1 ? 'bg-gray-300 text-gray-700' : 'bg-orange-300 text-white'}`}>
                              {i + 1}
                            </span>
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-semibold text-gray-900 truncate group-hover:text-emerald-700 transition-colors">{member.name}</p>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <RoleLabel role={member.role} />
                            <span className="text-[9px] text-gray-400">{member.postCount} posts</span>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      <CreatePostDialog open={createOpen} onOpenChange={setCreateOpen} t={t} />

      {user && (
        <WelcomePostDialog
          open={welcomePostOpen}
          onOpenChange={setWelcomePostOpen}
          user={user}
        />
      )}

      <CommunityAdvisor
        open={advisorOpen}
        onOpenChange={setAdvisorOpen}
        user={user}
        isNewUser={isNewUser}
        onFilterByUser={(userId, userName) => {
          setFilterAuthorId(userId);
          setFilterAuthorName(userName);
        }}
      />

      {user && (
        <button
          onClick={() => setAdvisorOpen(true)}
          className="lg:hidden fixed bottom-20 right-4 z-30 flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white px-4 py-2.5 rounded-full shadow-lg text-sm font-semibold transition-colors"
          data-testid="btn-open-advisor-mobile"
        >
          <Users className="h-4 w-4" />
          Conectar con pares
        </button>
      )}
    </div>
  );
}
