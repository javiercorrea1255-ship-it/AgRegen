import { useState, useEffect, useCallback } from "react";
import { useRoute, useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth-context";
import { useI18n } from "@/lib/i18n-context";
import { format } from "date-fns";
import {
  GraduationCap, Play, Eye, Pin, Lock, Unlock, ArrowLeft, ArrowRight,
  MessageSquare, Send, Trash2, Search, Plus, Calendar, User, ChevronLeft, ChevronRight, Users,
  Clock, Hash, Star, BookOpen
} from "lucide-react";
import logoAgregen from "@/assets/logo-agregen.png";

interface Conference {
  id: string;
  title: string;
  description: string;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  speaker: string | null;
  speakerBio: string | null;
  eventDate: string | null;
  tags: string[];
  isFeatured: boolean;
  status: string;
  viewsCount: number;
  createdAt: string;
  threadsCount?: number;
}

interface ForumThread {
  id: string;
  conferenceId: string;
  userId: string;
  title: string;
  content: string;
  isPinned: boolean;
  isClosed: boolean;
  repliesCount: number;
  createdAt: string;
  author?: { id: string; name: string; role: string };
}

interface ForumReply {
  id: string;
  threadId: string;
  userId: string;
  content: string;
  parentId: string | null;
  createdAt: string;
  author?: { id: string; name: string; role: string };
}

interface ConferenceNav {
  id: string;
  title: string;
}

interface ForumParticipant {
  id: string;
  name: string;
}

function getEmbedUrl(url: string): { type: 'youtube' | 'vimeo' | 'facebook' | 'direct'; embedUrl: string } | null {
  if (!url) return null;
  const ytMatch = url.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  if (ytMatch) return { type: 'youtube', embedUrl: `https://www.youtube.com/embed/${ytMatch[1]}` };
  const vimeoMatch = url.match(/vimeo\.com\/(?:video\/)?(\d+)/);
  if (vimeoMatch) return { type: 'vimeo', embedUrl: `https://player.vimeo.com/video/${vimeoMatch[1]}` };
  const fbMatch = url.match(/facebook\.com\/.+\/videos\/\d+/);
  if (fbMatch) {
    const normalizedUrl = url.replace(/^https?:\/\/(www\.)?facebook\.com/, 'https://web.facebook.com');
    const fbEmbed = `https://www.facebook.com/plugins/video.php?href=${encodeURIComponent(normalizedUrl)}&show_text=false&width=560&t=0`;
    return { type: 'facebook', embedUrl: fbEmbed };
  }
  return { type: 'direct', embedUrl: url };
}

function getYouTubeThumbnail(url: string): string | null {
  const match = url?.match(/(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([a-zA-Z0-9_-]{11})/);
  return match ? `https://img.youtube.com/vi/${match[1]}/maxresdefault.jpg` : null;
}

const CONFERENCE_TAGS = [
  "agricultura", "sustentabilidad", "tecnología", "riego",
  "suelos", "orgánico", "regenerativo", "clima"
];

function RoleLabel({ role }: { role: string }) {
  const colors: Record<string, string> = {
    admin: "text-red-600 bg-red-50",
    farmer: "text-green-700 bg-green-50",
    researcher: "text-blue-600 bg-blue-50",
  };
  const labels: Record<string, string> = {
    admin: "Admin",
    farmer: "Técnico",
    researcher: "Investigador",
  };
  return (
    <Badge variant="outline" className={`text-[10px] py-0 h-4 ${colors[role] || ""}`}>
      {labels[role] || role}
    </Badge>
  );
}

function ConferenceCard({
  conference,
  onNavigate,
  t,
  featured = false,
}: {
  conference: Conference;
  onNavigate: (id: string) => void;
  t: (k: string) => string;
  featured?: boolean;
}) {
  const thumbnailUrl = conference.thumbnailUrl || (conference.videoUrl ? getYouTubeThumbnail(conference.videoUrl) : null);

  if (featured) {
    return (
      <Card
        className="hover:shadow-xl transition-all duration-300 cursor-pointer group overflow-hidden border-primary/20 bg-gradient-to-br from-primary/5 to-transparent"
        onClick={() => onNavigate(conference.id)}
        data-testid={`conference-card-featured-${conference.id}`}
      >
        <div className="flex flex-col md:flex-row">
          <div className="relative md:w-1/2 aspect-video bg-gradient-to-br from-emerald-600 to-teal-700 overflow-hidden">
            {thumbnailUrl ? (
              <img
                src={thumbnailUrl}
                alt={conference.title}
                className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-500"
                loading="lazy"
              />
            ) : (
              <div className="w-full h-full flex flex-col items-center justify-center gap-3">
                <img src={logoAgregen} alt="AgRegen" className="h-14 w-auto opacity-50 object-contain" />
                <GraduationCap className="h-8 w-8 text-white/20" />
              </div>
            )}
            <div className="absolute inset-0 bg-black/20 group-hover:bg-black/30 transition-colors flex items-center justify-center">
              <div className="w-16 h-16 rounded-full bg-white/90 flex items-center justify-center shadow-lg group-hover:scale-110 transition-transform">
                <Play className="h-8 w-8 text-primary ml-1" />
              </div>
            </div>
            <Badge className="absolute top-3 left-3 bg-amber-500 text-white border-0 shadow-md" data-testid={`badge-featured-${conference.id}`}>
              {t("conferences.featured")}
            </Badge>
          </div>
          <div className="md:w-1/2 p-6 flex flex-col justify-between">
            <div>
              <h3 className="text-xl md:text-2xl font-bold leading-tight group-hover:text-primary transition-colors mb-3" data-testid={`title-${conference.id}`}>
                {conference.title}
              </h3>
              {conference.speaker && (
                <div className="flex items-center gap-2 mb-2">
                  <Avatar className="h-8 w-8">
                    <AvatarFallback className="bg-primary/10 text-primary text-sm font-semibold">
                      {conference.speaker.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <p className="text-sm font-medium">{conference.speaker}</p>
                    {conference.speakerBio && (
                      <p className="text-xs text-muted-foreground line-clamp-1">{conference.speakerBio}</p>
                    )}
                  </div>
                </div>
              )}
              <p className="text-sm text-muted-foreground line-clamp-3 mb-4">{conference.description}</p>
              <div className="flex flex-wrap gap-1.5 mb-3">
                {conference.tags?.map((tag) => (
                  <Badge key={tag} variant="secondary" className="text-xs font-normal">#{tag}</Badge>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-4 text-xs text-muted-foreground">
              {conference.eventDate && (
                <span className="flex items-center gap-1">
                  <Calendar className="h-3.5 w-3.5" /> {format(new Date(conference.eventDate), "dd/MM/yyyy")}
                </span>
              )}
              <span className="flex items-center gap-1">
                <Eye className="h-3.5 w-3.5" /> {conference.viewsCount} {t("conferences.views")}
              </span>
              {conference.threadsCount !== undefined && (
                <span className="flex items-center gap-1">
                  <MessageSquare className="h-3.5 w-3.5" /> {conference.threadsCount} {t("conferences.threads")}
                </span>
              )}
            </div>
          </div>
        </div>
      </Card>
    );
  }

  return (
    <Card
      className="hover:shadow-lg transition-all duration-200 cursor-pointer group overflow-hidden"
      onClick={() => onNavigate(conference.id)}
      data-testid={`conference-card-${conference.id}`}
    >
      <div className="relative aspect-video bg-gradient-to-br from-emerald-600 to-teal-700 overflow-hidden">
        {thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={conference.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
            data-testid={`thumbnail-${conference.id}`}
          />
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center gap-2">
            <img src={logoAgregen} alt="AgRegen" className="h-10 w-auto opacity-50 object-contain" />
            <GraduationCap className="h-6 w-6 text-white/20" />
          </div>
        )}
        <div className="absolute inset-0 bg-black/10 group-hover:bg-black/30 transition-colors flex items-center justify-center">
          <div className="w-14 h-14 rounded-full bg-white/90 flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition-all group-hover:scale-110">
            <Play className="h-7 w-7 text-primary ml-1" />
          </div>
        </div>
        {conference.isFeatured && (
          <Badge className="absolute top-2 left-2 bg-amber-500 text-white border-0" data-testid={`badge-featured-${conference.id}`}>
            {t("conferences.featured")}
          </Badge>
        )}
      </div>
      <CardContent className="pt-4 pb-3">
        <h3 className="text-base font-semibold leading-snug group-hover:text-primary transition-colors mb-1.5 line-clamp-2" data-testid={`title-${conference.id}`}>
          {conference.title}
        </h3>
        {conference.speaker && (
          <p className="text-sm text-muted-foreground flex items-center gap-1.5 mb-1">
            <User className="h-3.5 w-3.5 shrink-0" /> {conference.speaker}
          </p>
        )}
        {conference.eventDate && (
          <p className="text-xs text-muted-foreground flex items-center gap-1 mb-2">
            <Calendar className="h-3 w-3" /> {format(new Date(conference.eventDate), "dd/MM/yyyy")}
          </p>
        )}
        <p className="text-sm text-muted-foreground line-clamp-2 mb-3">{conference.description}</p>
        <div className="flex flex-wrap gap-1 mb-2">
          {conference.tags?.slice(0, 3).map((tag) => (
            <Badge key={tag} variant="secondary" className="text-xs font-normal" data-testid={`tag-${tag}-${conference.id}`}>
              #{tag}
            </Badge>
          ))}
        </div>
      </CardContent>
      <CardFooter className="py-2.5 px-5 border-t bg-muted/30 flex gap-4">
        <span className="text-xs text-muted-foreground flex items-center gap-1">
          <Eye className="h-3.5 w-3.5" /> {conference.viewsCount} {t("conferences.views")}
        </span>
        {conference.threadsCount !== undefined && conference.threadsCount > 0 && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <MessageSquare className="h-3.5 w-3.5" /> {conference.threadsCount} {t("conferences.threads")}
          </span>
        )}
      </CardFooter>
    </Card>
  );
}

function CreateThreadDialog({
  open,
  onOpenChange,
  conferenceId,
  t,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  conferenceId: string;
  t: (k: string) => string;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");

  const createMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/conferences/${conferenceId}/threads`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ title: title.trim(), content: content.trim() }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || "Error");
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conference-detail", conferenceId] });
      toast({ title: t("conferences.createThread") });
      setTitle("");
      setContent("");
      onOpenChange(false);
    },
    onError: (err: any) => {
      toast({ title: "Error", description: err.message, variant: "destructive" });
    },
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-bold flex items-center gap-2">
            <Plus className="h-5 w-5 text-primary" />
            {t("conferences.newThread")}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 mt-2">
          <div>
            <label className="text-sm font-medium mb-1.5 block">{t("conferences.threadTitle")}</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={t("conferences.threadTitle")}
              data-testid="input-thread-title"
            />
          </div>
          <div>
            <label className="text-sm font-medium mb-1.5 block">{t("conferences.threadContent")}</label>
            <Textarea
              value={content}
              onChange={(e) => setContent(e.target.value)}
              placeholder={t("conferences.threadContent")}
              rows={5}
              data-testid="input-thread-content"
            />
          </div>
          <Button
            onClick={() => createMutation.mutate()}
            disabled={!title.trim() || !content.trim() || createMutation.isPending}
            className="w-full"
            data-testid="btn-create-thread"
          >
            {createMutation.isPending ? "..." : t("conferences.createThread")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ThreadDetail({
  thread,
  conferenceId,
  t,
  user,
  isAdmin,
}: {
  thread: ForumThread;
  conferenceId: string;
  t: (k: string) => string;
  user: any;
  isAdmin: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [replyText, setReplyText] = useState("");
  const [expanded, setExpanded] = useState(false);

  const { data: threadDetail } = useQuery<{ replies: ForumReply[]; authors: Record<string, any> }>({
    queryKey: ["conference-thread", thread.id],
    queryFn: async () => {
      const res = await fetch(`/api/conferences/threads/${thread.id}`, { credentials: "include" });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    enabled: expanded,
  });

  const replyMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/conferences/threads/${thread.id}/replies`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ content: replyText.trim() }),
      });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    onSuccess: () => {
      setReplyText("");
      queryClient.invalidateQueries({ queryKey: ["conference-thread", thread.id] });
      queryClient.invalidateQueries({ queryKey: ["conference-detail", conferenceId] });
    },
  });

  const pinMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/conferences/threads/${thread.id}/pin`, { method: "PUT", credentials: "include" });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["conference-detail", conferenceId] }); },
  });

  const closeMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/conferences/threads/${thread.id}/close`, { method: "PUT", credentials: "include" });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["conference-detail", conferenceId] }); },
  });

  const deleteThreadMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/conferences/threads/${thread.id}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["conference-detail", conferenceId] });
      toast({ title: "Deleted" });
    },
  });

  const deleteReplyMutation = useMutation({
    mutationFn: async (replyId: string) => {
      const res = await fetch(`/api/conferences/replies/${replyId}`, { method: "DELETE", credentials: "include" });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ["conference-thread", thread.id] }); },
  });

  return (
    <div className="border rounded-lg overflow-hidden" data-testid={`thread-${thread.id}`}>
      <div
        className="p-4 cursor-pointer hover:bg-muted/50 transition-colors"
        onClick={() => setExpanded(!expanded)}
        data-testid={`btn-toggle-thread-${thread.id}`}
      >
        <div className="flex items-start gap-3">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className="bg-primary/10 text-primary text-xs font-semibold">
              {thread.author?.name?.charAt(0) || "?"}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              {thread.isPinned && (
                <Badge variant="outline" className="text-xs text-amber-600 border-amber-300 bg-amber-50 gap-1">
                  <Pin className="h-3 w-3" /> {t("conferences.pinned")}
                </Badge>
              )}
              {thread.isClosed && (
                <Badge variant="outline" className="text-xs text-red-600 border-red-300 bg-red-50 gap-1">
                  <Lock className="h-3 w-3" /> {t("conferences.closed")}
                </Badge>
              )}
            </div>
            <h4 className="font-semibold text-sm mt-1" data-testid={`thread-title-${thread.id}`}>{thread.title}</h4>
            <div className="flex items-center gap-2 mt-1 text-xs text-muted-foreground flex-wrap">
              <span>{thread.author?.name}</span>
              {thread.author?.role && <RoleLabel role={thread.author.role} />}
              <span>{format(new Date(thread.createdAt), "dd/MM/yyyy HH:mm")}</span>
              <span className="flex items-center gap-1">
                <MessageSquare className="h-3 w-3" /> {thread.repliesCount} {t("conferences.replies")}
              </span>
            </div>
          </div>
          <ChevronRight className={`h-4 w-4 text-muted-foreground shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} />
        </div>
      </div>

      {expanded && (
        <div className="border-t px-4 py-3 bg-muted/20">
          <p className="text-sm mb-4 whitespace-pre-wrap">{thread.content}</p>

          {isAdmin && (
            <div className="flex gap-2 mb-4 flex-wrap">
              <Button variant="outline" size="sm" onClick={() => pinMutation.mutate()} data-testid={`btn-pin-${thread.id}`}>
                <Pin className="h-3.5 w-3.5 mr-1" />
                {thread.isPinned ? t("conferences.unpin") : t("conferences.pin")}
              </Button>
              <Button variant="outline" size="sm" onClick={() => closeMutation.mutate()} data-testid={`btn-close-${thread.id}`}>
                {thread.isClosed ? <Unlock className="h-3.5 w-3.5 mr-1" /> : <Lock className="h-3.5 w-3.5 mr-1" />}
                {thread.isClosed ? t("conferences.open") : t("conferences.close")}
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="text-red-600 hover:text-red-700"
                onClick={() => { if (confirm(t("conferences.deleteConfirm"))) deleteThreadMutation.mutate(); }}
                data-testid={`btn-delete-thread-${thread.id}`}
              >
                <Trash2 className="h-3.5 w-3.5 mr-1" />
              </Button>
            </div>
          )}

          <Separator className="my-3" />

          {threadDetail?.replies && threadDetail.replies.length > 0 && (
            <div className="space-y-3 mb-4">
              {threadDetail.replies.map((reply) => (
                <div key={reply.id} className="flex items-start gap-2 p-3 rounded-lg bg-background border" data-testid={`reply-${reply.id}`}>
                  <Avatar className="h-7 w-7 shrink-0">
                    <AvatarFallback className="bg-primary/10 text-primary text-xs">
                      {reply.author?.name?.charAt(0) || "?"}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-xs text-muted-foreground mb-1 flex-wrap">
                      <span className="font-semibold text-foreground">{reply.author?.name}</span>
                      {reply.author?.role && <RoleLabel role={reply.author.role} />}
                      <span>{format(new Date(reply.createdAt), "dd/MM/yyyy HH:mm")}</span>
                      {(isAdmin || (user && reply.userId === user.id)) && (
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-5 w-5 p-0 text-red-500 hover:text-red-700 ml-auto"
                          onClick={() => { if (confirm(t("conferences.deleteConfirm"))) deleteReplyMutation.mutate(reply.id); }}
                          data-testid={`btn-delete-reply-${reply.id}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                    <p className="text-sm whitespace-pre-wrap">{reply.content}</p>
                  </div>
                </div>
              ))}
            </div>
          )}

          {!thread.isClosed && user ? (
            <div className="flex gap-2">
              <Textarea
                value={replyText}
                onChange={(e) => setReplyText(e.target.value)}
                placeholder={t("conferences.writeReply")}
                rows={2}
                className="flex-1"
                data-testid={`input-reply-${thread.id}`}
              />
              <Button
                size="sm"
                onClick={() => replyMutation.mutate()}
                disabled={!replyText.trim() || replyMutation.isPending}
                className="self-end"
                data-testid={`btn-reply-${thread.id}`}
              >
                <Send className="h-4 w-4" />
              </Button>
            </div>
          ) : thread.isClosed ? (
            <p className="text-sm text-muted-foreground italic">{t("conferences.threadClosed")}</p>
          ) : (
            <p className="text-sm text-muted-foreground italic">{t("conferences.loginToParticipate")}</p>
          )}
        </div>
      )}
    </div>
  );
}

function ConferenceDetailView({
  conferenceId,
  onBack,
  onNavigate,
  t,
  user,
  isAdmin,
}: {
  conferenceId: string;
  onBack: () => void;
  onNavigate: (id: string) => void;
  t: (k: string) => string;
  user: any;
  isAdmin: boolean;
}) {
  const [showNewThread, setShowNewThread] = useState(false);

  const { data: detail, isLoading } = useQuery<{
    conference: Conference;
    threads: ForumThread[];
    authors: Record<string, any>;
    relatedConferences: Conference[];
    prevConference: ConferenceNav | null;
    nextConference: ConferenceNav | null;
    forumParticipants: ForumParticipant[];
  }>({
    queryKey: ["conference-detail", conferenceId],
    queryFn: async () => {
      const res = await fetch(`/api/conferences/${conferenceId}`, { credentials: "include" });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
  });

  if (isLoading) {
    return (
      <div className="space-y-4 max-w-6xl mx-auto px-4 py-6">
        <div className="h-8 bg-muted rounded animate-pulse w-1/3" />
        <div className="aspect-video bg-muted rounded-xl animate-pulse" />
        <div className="h-40 bg-muted rounded animate-pulse" />
      </div>
    );
  }

  if (!detail?.conference) return null;

  const conf = detail.conference;
  const embed = conf.videoUrl ? getEmbedUrl(conf.videoUrl) : null;

  const sortedThreads = [...(detail.threads || [])].sort((a, b) => {
    if (a.isPinned !== b.isPinned) return a.isPinned ? -1 : 1;
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });

  return (
    <div className="bg-muted/20 min-h-screen" data-testid="conference-detail-view">
      <div className="max-w-5xl mx-auto px-4 py-6 space-y-6">
        <Button variant="ghost" size="sm" onClick={onBack} className="gap-1.5 -ml-2 hover:bg-white" data-testid="btn-back-to-list">
          <ArrowLeft className="h-4 w-4" /> {t("conferences.backToList")}
        </Button>

        <div className="rounded-2xl overflow-hidden shadow-xl bg-black">
          {embed ? (
            embed.type === 'direct' ? (
              <video src={embed.embedUrl} controls className="w-full aspect-video" data-testid="video-player" />
            ) : embed.type === 'facebook' ? (
              <div className="relative w-full aspect-video bg-black" data-testid="facebook-video-wrapper">
                <iframe
                  src={embed.embedUrl}
                  className="w-full h-full"
                  style={{ border: 'none', overflow: 'hidden' }}
                  scrolling="no"
                  allow="autoplay; clipboard-write; encrypted-media; picture-in-picture; web-share"
                  allowFullScreen
                  title={conf.title}
                  data-testid="video-iframe"
                />
                <div className="absolute bottom-0 left-0 right-0 flex justify-center pb-2 pointer-events-none">
                  <a
                    href={conf.videoUrl!}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="pointer-events-auto inline-flex items-center gap-1.5 bg-black/60 hover:bg-[#1877f2] text-white text-xs font-medium px-3 py-1.5 rounded-full transition-colors backdrop-blur-sm"
                    data-testid="facebook-video-link"
                  >
                    <svg viewBox="0 0 24 24" className="h-3.5 w-3.5 fill-white" aria-hidden="true">
                      <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                    </svg>
                    Ver en Facebook
                  </a>
                </div>
              </div>
            ) : (
              <iframe
                src={embed.embedUrl}
                className="w-full aspect-video"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                allowFullScreen
                title={conf.title}
                data-testid="video-iframe"
              />
            )
          ) : (
            <div className="w-full aspect-video flex items-center justify-center bg-gradient-to-br from-emerald-800 to-teal-900">
              <div className="text-center">
                <GraduationCap className="h-20 w-20 text-white/30 mx-auto mb-2" />
                <p className="text-white/50 text-sm">{t("conferences.noVideo")}</p>
              </div>
            </div>
          )}
        </div>

        <Card className="shadow-sm border-0 bg-white">
          <CardContent className="p-6 md:p-8">
            <div className="flex flex-wrap items-center gap-2 mb-3">
              {conf.isFeatured && (
                <Badge className="bg-amber-500/10 text-amber-600 border-amber-200 gap-1">
                  <Star className="h-3 w-3" /> {t("conferences.featured")}
                </Badge>
              )}
              {conf.tags?.map((tag) => (
                <Badge key={tag} variant="outline" className="text-xs font-normal bg-primary/5 border-primary/20 text-primary" data-testid={`detail-tag-${tag}`}>
                  <Hash className="h-3 w-3 mr-0.5" />{tag}
                </Badge>
              ))}
            </div>

            <h1 className="text-2xl md:text-4xl font-bold tracking-tight mb-4 leading-tight" data-testid="conference-title">
              {conf.title}
            </h1>

            <div className="flex flex-wrap items-center gap-3 md:gap-5 mb-6">
              {conf.eventDate && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full" data-testid="conference-date">
                  <Calendar className="h-4 w-4 text-primary/70" />
                  <span>{format(new Date(conf.eventDate), "dd/MM/yyyy")}</span>
                </div>
              )}
              <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full" data-testid="conference-views">
                <Eye className="h-4 w-4 text-primary/70" />
                <span>{conf.viewsCount} {t("conferences.views")}</span>
              </div>
              {detail.threads.length > 0 && (
                <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 px-3 py-1.5 rounded-full">
                  <MessageSquare className="h-4 w-4 text-primary/70" />
                  <span>{detail.threads.length} {t("conferences.threads")}</span>
                </div>
              )}
            </div>

            {conf.description && (
              <>
                <Separator className="my-5" />
                <div className="flex items-start gap-3">
                  <BookOpen className="h-5 w-5 text-primary/50 mt-0.5 shrink-0" />
                  <p className="text-sm md:text-base leading-relaxed whitespace-pre-wrap text-muted-foreground" data-testid="conference-description">
                    {conf.description}
                  </p>
                </div>
              </>
            )}
          </CardContent>
        </Card>

        {conf.speaker && (
          <Card className="shadow-sm border-0 bg-white overflow-hidden">
            <CardContent className="p-0">
              <div className="flex flex-col sm:flex-row">
                <div className="sm:w-48 bg-gradient-to-br from-primary/10 to-emerald-50 flex items-center justify-center p-6 sm:p-8">
                  <Avatar className="h-20 w-20 sm:h-24 sm:w-24 ring-4 ring-white shadow-lg">
                    <AvatarFallback className="bg-primary text-white text-3xl sm:text-4xl font-bold">
                      {conf.speaker.charAt(0)}
                    </AvatarFallback>
                  </Avatar>
                </div>
                <div className="flex-1 p-6">
                  <p className="text-xs font-semibold text-primary uppercase tracking-wider mb-1">{t("conferences.aboutSpeaker")}</p>
                  <p className="text-xl font-bold mb-2" data-testid="conference-speaker">{conf.speaker}</p>
                  {conf.speakerBio && (
                    <p className="text-sm text-muted-foreground leading-relaxed">{conf.speakerBio}</p>
                  )}
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {detail.forumParticipants && detail.forumParticipants.length > 0 && (
          <Card className="shadow-sm border-0 bg-white">
            <CardContent className="p-6">
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-4 flex items-center gap-2">
                <Users className="h-4 w-4 text-primary/60" />
                {t("conferences.forumParticipants")} ({detail.forumParticipants.length})
              </h3>
              <div className="flex flex-wrap gap-2">
                {detail.forumParticipants.slice(0, 15).map((p) => (
                  <div key={p.id} className="flex items-center gap-1.5 bg-muted/50 rounded-full px-3 py-1.5 hover:bg-muted transition-colors">
                    <Avatar className="h-6 w-6">
                      <AvatarFallback className="bg-primary/10 text-primary text-[10px] font-semibold">
                        {p.name.charAt(0)}
                      </AvatarFallback>
                    </Avatar>
                    <span className="text-xs font-medium">{p.name}</span>
                  </div>
                ))}
                {detail.forumParticipants.length > 15 && (
                  <div className="flex items-center px-3 py-1.5 text-xs text-muted-foreground bg-muted/30 rounded-full">
                    +{detail.forumParticipants.length - 15} más
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        <Card className="shadow-sm border-0 bg-white">
          <CardContent className="p-6 md:p-8">
            <div className="flex items-center justify-between mb-6">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-lg bg-primary/10">
                  <MessageSquare className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h2 className="text-lg md:text-xl font-bold">{t("conferences.forum")}</h2>
                  {detail.threads.length > 0 && (
                    <p className="text-xs text-muted-foreground">{detail.threads.length} {t("conferences.threads")}</p>
                  )}
                </div>
              </div>
              {user && (
                <Button onClick={() => setShowNewThread(true)} className="gap-1.5 shadow-sm" data-testid="btn-new-thread">
                  <Plus className="h-4 w-4" /> {t("conferences.newThread")}
                </Button>
              )}
            </div>

            {sortedThreads.length === 0 ? (
              <div className="text-center py-16 bg-muted/20 rounded-xl border border-dashed border-muted-foreground/20" data-testid="text-no-threads">
                <div className="w-16 h-16 rounded-full bg-primary/10 flex items-center justify-center mx-auto mb-4">
                  <MessageSquare className="h-8 w-8 text-primary/40" />
                </div>
                <p className="font-medium text-muted-foreground mb-1">{t("conferences.noThreads")}</p>
                {user && (
                  <p className="text-sm text-muted-foreground/70">{t("conferences.startDiscussion")}</p>
                )}
              </div>
            ) : (
              <div className="space-y-3">
                {sortedThreads.map((thread) => (
                  <ThreadDetail
                    key={thread.id}
                    thread={thread}
                    conferenceId={conferenceId}
                    t={t}
                    user={user}
                    isAdmin={isAdmin}
                  />
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {(detail.prevConference || detail.nextConference) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {detail.prevConference ? (
              <Card
                className="shadow-sm border-0 bg-white cursor-pointer hover:shadow-md transition-all group"
                onClick={() => onNavigate(detail.prevConference!.id)}
                data-testid="btn-prev-conference"
              >
                <CardContent className="p-5 flex items-center gap-3">
                  <div className="p-2 rounded-full bg-muted/50 group-hover:bg-primary/10 transition-colors">
                    <ChevronLeft className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{t("conferences.previousConference")}</p>
                    <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{detail.prevConference.title}</p>
                  </div>
                </CardContent>
              </Card>
            ) : <div />}
            {detail.nextConference && (
              <Card
                className="shadow-sm border-0 bg-white cursor-pointer hover:shadow-md transition-all group"
                onClick={() => onNavigate(detail.nextConference!.id)}
                data-testid="btn-next-conference"
              >
                <CardContent className="p-5 flex items-center justify-end gap-3 text-right">
                  <div className="min-w-0">
                    <p className="text-xs text-muted-foreground">{t("conferences.nextConference")}</p>
                    <p className="text-sm font-semibold truncate group-hover:text-primary transition-colors">{detail.nextConference.title}</p>
                  </div>
                  <div className="p-2 rounded-full bg-muted/50 group-hover:bg-primary/10 transition-colors">
                    <ChevronRight className="h-5 w-5 text-muted-foreground group-hover:text-primary transition-colors" />
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}

        {detail.relatedConferences && detail.relatedConferences.length > 0 && (
          <div>
            <div className="flex items-center gap-3 mb-5">
              <div className="p-2 rounded-lg bg-primary/10">
                <GraduationCap className="h-5 w-5 text-primary" />
              </div>
              <h2 className="text-lg md:text-xl font-bold">{t("conferences.relatedConferences")}</h2>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {detail.relatedConferences.map((rc) => (
                <Card
                  key={rc.id}
                  className="cursor-pointer hover:shadow-lg transition-all group overflow-hidden border-0 shadow-sm bg-white"
                  onClick={() => onNavigate(rc.id)}
                  data-testid={`related-conference-${rc.id}`}
                >
                  <div className="relative aspect-video bg-gradient-to-br from-emerald-600 to-teal-700 overflow-hidden">
                    {(rc.thumbnailUrl || (rc.videoUrl ? getYouTubeThumbnail(rc.videoUrl) : null)) ? (
                      <img
                        src={rc.thumbnailUrl || getYouTubeThumbnail(rc.videoUrl!)!}
                        alt={rc.title}
                        className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                        loading="lazy"
                      />
                    ) : (
                      <div className="w-full h-full flex flex-col items-center justify-center gap-2">
                        <img src={logoAgregen} alt="AgRegen" className="h-8 w-auto opacity-50 object-contain" />
                        <GraduationCap className="h-5 w-5 text-white/20" />
                      </div>
                    )}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-colors flex items-center justify-center">
                      <div className="w-10 h-10 rounded-full bg-white/90 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                        <Play className="h-5 w-5 text-primary ml-0.5" />
                      </div>
                    </div>
                  </div>
                  <CardContent className="p-4">
                    <h4 className="text-sm font-semibold line-clamp-2 group-hover:text-primary transition-colors">{rc.title}</h4>
                    {rc.speaker && (
                      <p className="text-xs text-muted-foreground mt-1.5 flex items-center gap-1">
                        <User className="h-3 w-3" /> {rc.speaker}
                      </p>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          </div>
        )}
      </div>

      <CreateThreadDialog
        open={showNewThread}
        onOpenChange={setShowNewThread}
        conferenceId={conferenceId}
        t={t}
      />
    </div>
  );
}

export default function ConferencesPage() {
  const { t } = useI18n();
  const { user, isAdmin } = useAuth();
  const [matchDetail, detailParams] = useRoute("/conferences/:id");
  const [, setLocation] = useLocation();
  const urlId = matchDetail ? detailParams?.id ?? null : null;
  const [view, setView] = useState<"list" | "detail">(urlId ? "detail" : "list");
  const [selectedId, setSelectedId] = useState<string | null>(urlId);
  const [searchTerm, setSearchTerm] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedTag, setSelectedTag] = useState<string | null>(null);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(searchTerm), 300);
    return () => clearTimeout(timer);
  }, [searchTerm]);

  // Keep state in sync with URL (back/forward, deep links from SSR).
  useEffect(() => {
    if (urlId) {
      setSelectedId(urlId);
      setView("detail");
    } else {
      setSelectedId(null);
      setView("list");
    }
  }, [urlId]);

  const navigateToDetail = useCallback((id: string) => {
    setSelectedId(id);
    setView("detail");
    setLocation(`/conferences/${id}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [setLocation]);

  const navigateToList = useCallback(() => {
    setView("list");
    setSelectedId(null);
    setLocation("/conferences");
  }, [setLocation]);

  const queryParams = new URLSearchParams();
  if (debouncedSearch) queryParams.set("search", debouncedSearch);
  if (selectedTag) queryParams.set("tag", selectedTag);

  const { data: conferencesResponse, isLoading } = useQuery<{ conferences: Conference[] }>({
    queryKey: ["conferences", debouncedSearch, selectedTag],
    queryFn: async () => {
      const res = await fetch(`/api/conferences?${queryParams.toString()}`, { credentials: "include" });
      if (!res.ok) throw new Error("Error");
      return res.json();
    },
    enabled: view === "list",
  });

  const conferences = conferencesResponse?.conferences || [];
  const featuredConferences = conferences.filter(c => c.isFeatured);
  const regularConferences = conferences.filter(c => !c.isFeatured);

  if (view === "detail" && selectedId) {
    return (
      <ConferenceDetailView
        conferenceId={selectedId}
        onBack={navigateToList}
        onNavigate={navigateToDetail}
        t={t}
        user={user}
        isAdmin={isAdmin}
      />
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 py-6" data-testid="conferences-page">
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="p-2.5 rounded-xl bg-primary/10">
            <GraduationCap className="h-7 w-7 text-primary" />
          </div>
          <div>
            <h1 className="text-2xl md:text-3xl font-bold" data-testid="text-page-title">{t("conferences.title")}</h1>
            <p className="text-muted-foreground text-sm">{t("conferences.subtitle")}</p>
          </div>
        </div>
      </div>

      <div className="mb-6 space-y-4">
        <div className="relative max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder={t("conferences.search")}
            className="pl-10"
            data-testid="input-search-conferences"
          />
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge
            variant={selectedTag === null ? "default" : "outline"}
            className="cursor-pointer hover:bg-primary/10 transition-colors"
            onClick={() => setSelectedTag(null)}
            data-testid="filter-tag-all"
          >
            {t("conferences.allTags")}
          </Badge>
          {CONFERENCE_TAGS.map((tag) => (
            <Badge
              key={tag}
              variant={selectedTag === tag ? "default" : "outline"}
              className="cursor-pointer hover:bg-primary/10 transition-colors"
              onClick={() => setSelectedTag(selectedTag === tag ? null : tag)}
              data-testid={`filter-tag-${tag}`}
            >
              #{tag}
            </Badge>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <Card key={i} className="overflow-hidden">
              <div className="aspect-video bg-muted animate-pulse" />
              <CardContent className="pt-4 space-y-2">
                <div className="h-5 bg-muted rounded animate-pulse w-3/4" />
                <div className="h-4 bg-muted rounded animate-pulse w-1/2" />
                <div className="h-4 bg-muted rounded animate-pulse w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      ) : conferences.length > 0 ? (
        <div className="space-y-8">
          {featuredConferences.length > 0 && (
            <div className="space-y-4" data-testid="featured-conferences-section">
              {featuredConferences.map((conf) => (
                <ConferenceCard key={conf.id} conference={conf} onNavigate={navigateToDetail} t={t} featured />
              ))}
            </div>
          )}

          {regularConferences.length > 0 && (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" data-testid="conferences-grid">
              {regularConferences.map((conf) => (
                <ConferenceCard key={conf.id} conference={conf} onNavigate={navigateToDetail} t={t} />
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="text-center py-16">
          <GraduationCap className="h-16 w-16 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-muted-foreground" data-testid="text-no-conferences">{t("conferences.noConferences")}</p>
        </div>
      )}
    </div>
  );
}
