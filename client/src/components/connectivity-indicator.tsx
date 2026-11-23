/**
 * Global connectivity indicator: lives in the navbar and shows current
 * online/offline state plus the count of pending offline operations. Tapping
 * opens a sheet listing each queued operation with the timestamp, last error
 * and per-item dismiss + global "sincronizar" actions.
 */
import { useState } from "react";
import { Wifi, WifiOff, CloudUpload, AlertTriangle, Trash2, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useConnectivity } from "@/lib/connectivity-context";

function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 60_000) return "ahora";
  if (ms < 3_600_000) return `hace ${Math.floor(ms / 60_000)} min`;
  if (ms < 86_400_000) return `hace ${Math.floor(ms / 3_600_000)} h`;
  return new Date(iso).toLocaleString();
}

export function ConnectivityIndicator({ compact = false }: { compact?: boolean }) {
  const { isOnline, pendingCount, outbox, syncing, syncNow, dismiss } = useConnectivity();
  const [open, setOpen] = useState(false);

  // Hide entirely when fully online and no pending work — keeps the navbar
  // uncluttered for the happy path.
  if (isOnline && pendingCount === 0) return null;

  const stateLabel = !isOnline
    ? "Sin conexión"
    : pendingCount > 0
      ? `${pendingCount} pendiente${pendingCount === 1 ? "" : "s"}`
      : "En línea";

  const Icon = !isOnline ? WifiOff : pendingCount > 0 ? CloudUpload : Wifi;
  const tone = !isOnline
    ? "border-red-300 text-red-700 bg-red-50"
    : pendingCount > 0
      ? "border-amber-300 text-amber-700 bg-amber-50"
      : "border-green-300 text-green-700 bg-green-50";

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          type="button"
          variant="outline"
          size={compact ? "icon" : "sm"}
          className={`relative gap-1.5 h-9 ${tone}`}
          data-testid="btn-connectivity"
          aria-label={stateLabel}
        >
          <Icon className="w-4 h-4" />
          {!compact && <span className="text-xs font-medium">{stateLabel}</span>}
          {compact && pendingCount > 0 && (
            <span
              className="absolute -top-1 -right-1 inline-flex items-center justify-center min-w-[18px] h-[18px] rounded-full bg-amber-500 text-white text-[10px] font-bold px-1"
              data-testid="badge-pending-count"
            >
              {pendingCount > 99 ? "99+" : pendingCount}
            </span>
          )}
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="w-full sm:max-w-md flex flex-col">
        <SheetHeader>
          <SheetTitle className="flex items-center gap-2">
            <Icon className="w-5 h-5" />
            {stateLabel}
          </SheetTitle>
        </SheetHeader>

        <div className="mt-4 flex items-center gap-2">
          <Badge variant="outline" className={tone} data-testid="text-connectivity-state">
            {isOnline ? <Wifi className="w-3 h-3 mr-1" /> : <WifiOff className="w-3 h-3 mr-1" />}
            {isOnline ? "Conectado" : "Sin red"}
          </Badge>
          {pendingCount > 0 && (
            <Button
              size="sm"
              variant="default"
              onClick={syncNow}
              disabled={!isOnline || syncing}
              data-testid="btn-sync-all"
            >
              {syncing
                ? <Loader2 className="w-3 h-3 animate-spin mr-1" />
                : <RefreshCw className="w-3 h-3 mr-1" />}
              Sincronizar
            </Button>
          )}
        </div>

        <div className="mt-4 flex-1 overflow-y-auto pr-1 space-y-2">
          {!isOnline && pendingCount === 0 && (
            <p className="text-sm text-muted-foreground p-4 rounded-lg bg-muted/40">
              Estás trabajando sin conexión. Podés ver datos descargados y los cambios que hagas se guardan localmente
              hasta que vuelva la señal.
            </p>
          )}

          {outbox.length === 0 ? (
            <p className="text-sm text-muted-foreground p-4 text-center" data-testid="text-empty-outbox">
              No hay cambios pendientes.
            </p>
          ) : (
            outbox.map((op) => (
              <div
                key={op.id}
                className="rounded-lg border bg-card p-3 space-y-1"
                data-testid={`outbox-item-${op.id}`}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium truncate" data-testid={`text-op-label-${op.id}`}>
                      {op.label || `${op.method} ${op.url}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {op.method} · {formatRelative(op.enqueuedAt)}
                      {op.attempts > 0 && ` · ${op.attempts} intento${op.attempts === 1 ? "" : "s"}`}
                    </p>
                    {op.lastError && (
                      <p className="text-xs text-red-600 mt-1 flex items-start gap-1">
                        <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                        <span className="break-words">{op.lastError}</span>
                      </p>
                    )}
                  </div>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 shrink-0 text-muted-foreground hover:text-red-600"
                    onClick={() => dismiss(op.id)}
                    aria-label="Descartar"
                    data-testid={`btn-dismiss-${op.id}`}
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

/** Subtle banner shown at the very top when offline. Mobile-first sizing. */
export function OfflineBanner() {
  const { isOnline } = useConnectivity();
  if (isOnline) return null;
  return (
    <div
      className="w-full bg-amber-100 text-amber-900 text-xs px-3 py-1.5 text-center border-b border-amber-200 flex items-center justify-center gap-2"
      data-testid="banner-offline"
      role="status"
      aria-live="polite"
    >
      <WifiOff className="w-3.5 h-3.5" />
      <span>Sin conexión — tus cambios se guardarán y se enviarán cuando vuelva la señal.</span>
    </div>
  );
}
