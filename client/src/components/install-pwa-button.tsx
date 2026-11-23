import { useEffect, useState } from "react";
import { Download, Share, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{ outcome: "accepted" | "dismissed"; platform: string }>;
  prompt(): Promise<void>;
}

const DISMISS_KEY = "agregen-pwa-install-dismissed-at";
const DISMISS_TTL_MS = 7 * 24 * 60 * 60 * 1000; // hide for 7 days after dismiss

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // iOS Safari
  return Boolean((window.navigator as { standalone?: boolean }).standalone);
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  // iPad on iOS 13+ reports as Mac; check touch points to detect.
  const isIPadOS = ua.includes("Mac") && (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints ? (navigator as Navigator & { maxTouchPoints?: number }).maxTouchPoints! > 1 : false;
  return /iPad|iPhone|iPod/.test(ua) || isIPadOS;
}

function recentlyDismissed(): boolean {
  try {
    const raw = localStorage.getItem(DISMISS_KEY);
    if (!raw) return false;
    const t = Number(raw);
    return Number.isFinite(t) && Date.now() - t < DISMISS_TTL_MS;
  } catch {
    return false;
  }
}

interface Props {
  variant?: "navbar" | "compact";
  className?: string;
}

export function InstallPwaButton({ variant = "navbar", className = "" }: Props) {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState<boolean>(() => isStandalone());
  const [showIosHint, setShowIosHint] = useState(false);
  const [dismissed, setDismissed] = useState<boolean>(() => recentlyDismissed());
  const ios = isIos();

  useEffect(() => {
    const handler = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const installedHandler = () => {
      setInstalled(true);
      setDeferred(null);
    };
    window.addEventListener("beforeinstallprompt", handler);
    window.addEventListener("appinstalled", installedHandler);
    return () => {
      window.removeEventListener("beforeinstallprompt", handler);
      window.removeEventListener("appinstalled", installedHandler);
    };
  }, []);

  if (installed) return null;
  if (dismissed && !deferred) return null;
  // Nothing to offer on browsers without BIP and not iOS (e.g. desktop Firefox).
  if (!deferred && !ios) return null;

  const handleClick = async () => {
    if (deferred) {
      try {
        await deferred.prompt();
        const choice = await deferred.userChoice;
        if (choice.outcome === "accepted") {
          setInstalled(true);
        }
      } catch {
        /* ignore */
      } finally {
        setDeferred(null);
      }
      return;
    }
    if (ios) {
      setShowIosHint(true);
    }
  };

  const handleDismiss = (e: React.MouseEvent) => {
    e.stopPropagation();
    try { localStorage.setItem(DISMISS_KEY, String(Date.now())); } catch { /* ignore */ }
    setDismissed(true);
  };

  return (
    <>
      <div className={`inline-flex items-center ${className}`}>
        <Button
          type="button"
          size={variant === "compact" ? "icon" : "sm"}
          variant="outline"
          className="gap-1.5 border-primary/40 text-primary hover:bg-primary/10"
          onClick={handleClick}
          aria-label="Instalar AgRegen"
          data-testid="btn-install-pwa"
        >
          <Download className="h-4 w-4" />
          {variant !== "compact" && <span className="hidden sm:inline">Instalar app</span>}
        </Button>
        <button
          type="button"
          onClick={handleDismiss}
          aria-label="Ocultar"
          className="ml-1 hidden sm:inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:text-foreground hover:bg-muted"
          data-testid="btn-install-pwa-dismiss"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <Dialog open={showIosHint} onOpenChange={setShowIosHint}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Instalar AgRegen en tu iPhone</DialogTitle>
            <DialogDescription>
              En Safari de iOS no aparece un botón automático. Seguí estos pasos:
            </DialogDescription>
          </DialogHeader>
          <ol className="space-y-3 text-sm">
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">1</span>
              <span className="leading-relaxed">
                Tocá el botón <Share className="inline h-4 w-4 align-text-bottom" /> <strong>Compartir</strong> en la barra inferior de Safari.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">2</span>
              <span className="leading-relaxed">
                Deslizá hacia abajo y tocá <strong>“Añadir a pantalla de inicio”</strong>.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-bold text-primary-foreground">3</span>
              <span className="leading-relaxed">
                Confirmá el nombre <strong>AgRegen</strong> y tocá <strong>Añadir</strong>.
              </span>
            </li>
          </ol>
          <p className="mt-2 text-xs text-muted-foreground">
            Listo: AgRegen va a aparecer como una app más en tu pantalla de inicio.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}
