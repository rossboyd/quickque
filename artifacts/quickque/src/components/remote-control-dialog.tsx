import { useCallback, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { useRemoteStore } from '@/lib/remote/store';
import { isDesktop } from '@/lib/desktop';
import { QRCodeSVG } from 'qrcode.react';
import {
  Smartphone,
  Wifi,
  ShieldAlert,
  Monitor,
  Square,
  Check,
  X as XIcon,
  Link as LinkIcon,
  RefreshCw,
  Loader2,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogTrigger,
} from '@/components/ui/dialog';
import type { RemoteStatus } from '@/lib/remote/types';

function statusLabel(status: RemoteStatus): string {
  switch (status) {
    case 'awaitingScan':
      return 'Waiting for phone scan';
    case 'awaitingApproval':
      return 'Approval needed';
    case 'connected':
      return 'Connected';
    case 'disconnected':
      return 'Controller disconnected';
    case 'rejected':
      return 'Pairing rejected';
    case 'expired':
      return 'QR code expired';
    default:
      return 'Stopped';
  }
}


export function RemoteControlDialog({ trigger }: { trigger?: ReactNode }) {
  const [open, setOpen] = useState(false);
  const {
    status,
    isRunning,
    sessionInfo,
    serverError,
    isPending,
    isConnected,
    isApproved,
    isStarting,
    isStopping,
    isReplacing,
    startServer,
    stopServer,
    approveConnection,
    rejectConnection,
    replaceController,
    checkStatus,
  } = useRemoteStore();

  // The reader owns this component even while the dialog is closed. Keep the
  // status fresh in that state so an approval request can open the dialog and
  // a disconnect is reflected immediately after a connected session.
  useEffect(() => {
    if (!isDesktop()) return;
    void checkStatus();
    const interval = window.setInterval(() => {
      void checkStatus();
    }, 1000);
    return () => window.clearInterval(interval);
  }, [checkStatus]);

  useEffect(() => {
    if (isPending) setOpen(true);
  }, [isPending]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (nextOpen && isDesktop()) {
        // Starting is deliberately tied to opening the dialog: there is no
        // separate Start step, while closing/reopening preserves the session.
        void startServer();
      }
    },
    [startServer],
  );

  const busy = isStarting || isStopping || isReplacing;
  const canShowQr =
    Boolean(sessionInfo?.pairingUrl) &&
    !isApproved &&
    !isConnected &&
    (sessionInfo?.expiresInSeconds ?? 0) > 0 &&
    !busy &&
    status !== 'rejected' &&
    status !== 'expired';
  const pairingUrl = sessionInfo?.pairingUrl ?? '';

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogTrigger asChild>
        {trigger || (
          <button className="w-full flex items-center gap-2 p-2 hover:bg-sidebar-accent rounded-md text-sidebar-foreground transition-colors font-medium">
            <Smartphone className="w-5 h-5 opacity-70" aria-hidden="true" />
            Phone Remote
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] bg-background border-border max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-primary" aria-hidden="true" />
            Local Phone Remote
          </DialogTitle>
          <DialogDescription>
            Scan the QR code with your phone to control this presentation.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6 py-4">
          {!isDesktop() ? (
            <div className="bg-accent/30 p-4 rounded-lg flex gap-3 text-sm">
              <ShieldAlert
                className="w-5 h-5 text-accent-foreground shrink-0"
                aria-hidden="true"
              />
              <div>
                <p className="font-medium text-foreground mb-1">
                  Desktop App Required to Host
                </p>
                <p className="text-muted-foreground leading-relaxed">
                  Phone Remote is a desktop capability and cannot host a local
                  server in this browser preview. The manual teleprompter is
                  fully usable here; open the Quickque Desktop App to pair a
                  phone.
                </p>
              </div>
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border border-border/50">
                <div>
                  <div className="font-medium">Remote Server</div>
                  <div className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                    <div
                      className={`w-2 h-2 rounded-full ${
                        isConnected
                          ? 'bg-green-500'
                          : isRunning || busy
                            ? 'bg-amber-500'
                            : serverError
                              ? 'bg-red-500'
                              : 'bg-muted-foreground'
                      }`}
                      aria-hidden="true"
                    />
                    <span>
                      {busy
                        ? isReplacing
                          ? 'Creating new QR…'
                          : isStopping
                            ? 'Stopping…'
                            : 'Starting…'
                        : statusLabel(status)}
                    </span>
                  </div>
                </div>

                {(isRunning || busy) && (
                  <div className="flex items-center gap-2">
                    {(status === 'rejected' || status === 'expired') &&
                      !sessionInfo && (
                        <button
                          onClick={() => void replaceController()}
                          disabled={busy}
                          className="flex items-center gap-2 px-3 py-2 bg-background border border-border rounded-md text-sm font-medium hover:bg-muted transition-colors disabled:opacity-50"
                        >
                          <RefreshCw
                            className="w-4 h-4"
                            aria-hidden="true"
                          />
                          New QR
                        </button>
                      )}
                    <button
                      onClick={() => void stopServer()}
                      disabled={isStopping}
                      className="flex items-center gap-2 px-4 py-2 bg-destructive/10 text-destructive rounded-md text-sm font-medium hover:bg-destructive/20 transition-colors disabled:opacity-50"
                    >
                      <Square
                        className="w-4 h-4 fill-current"
                        aria-hidden="true"
                      />
                      Stop
                    </button>
                  </div>
                )}
              </div>

              {serverError && (
                <div className="text-sm p-3 rounded bg-destructive/10 text-destructive border border-destructive/20 flex items-start justify-between gap-3">
                  <span>{serverError}</span>
                  <button
                    onClick={() => void startServer()}
                    className="shrink-0 underline underline-offset-2 font-medium hover:no-underline"
                  >
                    Retry
                  </button>
                </div>
              )}

              {busy && !sessionInfo && (
                <div
                  className="flex flex-col items-center gap-2 py-8 text-sm text-muted-foreground"
                  role="status"
                  aria-live="polite"
                >
                  <Loader2
                    className="w-7 h-7 animate-spin text-primary"
                    aria-hidden="true"
                  />
                  <span>
                    {isReplacing
                      ? 'Preparing a fresh pairing code…'
                      : isStopping
                        ? 'Stopping remote access…'
                        : 'Starting remote access…'}
                  </span>
                </div>
              )}

              {sessionInfo && (
                <div className="space-y-6 animate-in fade-in slide-in-from-top-2 duration-300">
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                      Controller Status
                    </h3>

                    {isConnected ? (
                      <div className="flex items-center justify-between p-3 bg-primary/10 border border-primary/20 rounded-lg">
                        <div className="flex items-center gap-2 text-primary font-medium">
                          <Smartphone className="w-4 h-4" aria-hidden="true" />
                          Controller connected
                        </div>
                        <button
                          onClick={() => void replaceController()}
                          disabled={busy}
                          className="text-xs flex items-center gap-1 px-3 py-1.5 bg-background border border-border rounded shadow-sm hover:bg-muted transition-colors disabled:opacity-50"
                        >
                          <RefreshCw
                            className="w-3 h-3"
                            aria-hidden="true"
                          />
                          New QR
                        </button>
                      </div>
                    ) : (
                      <div
                        className={`p-3 border rounded-lg text-sm text-center ${
                          isPending
                            ? 'bg-amber-500/10 border-amber-500/20 text-amber-700 dark:text-amber-400'
                            : status === 'rejected' || status === 'expired'
                              ? 'bg-destructive/10 border-destructive/20 text-destructive'
                              : 'bg-muted/50 border-border/50 text-muted-foreground'
                        }`}
                        role={isPending ? 'status' : undefined}
                        aria-live={isPending ? 'polite' : undefined}
                      >
                        {status === 'disconnected'
                          ? isApproved
                            ? 'The controller disconnected. Keep the remote page open, stay on the same reachable LAN, and keep this Mac awake so it can reconnect. New QR replaces the old controller.'
                            : 'The controller disconnected. Keep the remote page open, stay on the same reachable LAN, and keep this Mac awake so it can reconnect.'
                          : statusLabel(status)}
                      </div>
                    )}

                    {isPending && !isConnected && (
                      <div className="space-y-2 mt-4">
                        <div className="text-xs font-medium text-amber-600 dark:text-amber-500 uppercase tracking-wider">
                          Pending Approval
                        </div>
                        <div className="flex items-center justify-between p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                          <span className="font-medium text-sm flex items-center gap-2">
                            <Smartphone
                              className="w-4 h-4"
                              aria-hidden="true"
                            />
                            A device is requesting access
                          </span>
                          <div className="flex items-center gap-2">
                            <button
                              onClick={() => void rejectConnection()}
                              disabled={busy}
                              className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors disabled:opacity-50"
                              title="Reject controller request"
                              aria-label="Reject controller request"
                            >
                              <XIcon className="w-4 h-4" aria-hidden="true" />
                            </button>
                            <button
                              onClick={() => void approveConnection()}
                              disabled={busy}
                              className="p-1.5 text-green-600 hover:bg-green-500/10 rounded transition-colors disabled:opacity-50"
                              title="Approve controller request"
                              aria-label="Approve controller request"
                            >
                              <Check className="w-4 h-4" aria-hidden="true" />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}

                    {!isConnected && (
                      <div className="flex justify-end">
                        <button
                          onClick={() => void replaceController()}
                          disabled={busy}
                          className="text-xs flex items-center gap-1 px-3 py-1.5 bg-background border border-border rounded shadow-sm hover:bg-muted transition-colors disabled:opacity-50"
                        >
                          <RefreshCw
                            className="w-3 h-3"
                            aria-hidden="true"
                          />
                          New QR
                        </button>
                      </div>
                    )}
                  </div>

                  {canShowQr && (
                    <div className="space-y-4 pt-2 border-t border-border">
                      <div className="flex flex-col items-center p-6 bg-white rounded-xl shadow-inner border border-gray-200">
                        <QRCodeSVG
                          value={pairingUrl}
                          size={180}
                          level="M"
                          includeMargin={false}
                          aria-label="Phone remote pairing QR code"
                        />

                        <div className="mt-5 text-center text-sm font-medium text-gray-700">
                          Scan with your phone camera, then approve the request
                          on your Mac.
                        </div>

                        <details className="mt-4 w-full border-t border-gray-100 pt-3 text-center">
                          <summary className="cursor-pointer text-xs font-medium text-gray-500 hover:text-gray-800">
                            Can&apos;t scan? Use URL and code manually
                          </summary>
                          <div className="mt-3 space-y-2">
                            <div className="flex items-center justify-center gap-1.5 text-xs font-mono text-gray-600 bg-gray-50 px-2 py-1 rounded break-all">
                              <LinkIcon
                                className="w-3 h-3 opacity-50 shrink-0"
                                aria-hidden="true"
                              />
                              {sessionInfo.url}
                            </div>
                            <div className="text-xs text-gray-500">
                              Enter code{' '}
                              <strong className="font-mono">
                                {sessionInfo.code}
                              </strong>{' '}
                              on the phone.
                            </div>
                          </div>
                        </details>

                        <div className="mt-3 text-xs text-gray-500">
                          Code expires in {sessionInfo.expiresInSeconds}s
                        </div>
                      </div>

                      <div className="grid gap-3 text-sm text-muted-foreground">
                        <div className="flex gap-2.5">
                          <Wifi
                            className="w-4 h-4 mt-0.5 shrink-0 opacity-70"
                            aria-hidden="true"
                          />
                          <p>
                            Your Mac and phone only need to reach the same LAN:
                            an Ethernet Mac and Wi-Fi phone are supported.
                            Firewall rules or guest-network isolation can
                            block access.
                          </p>
                        </div>
                        <div className="flex gap-2.5">
                          <Monitor
                            className="w-4 h-4 mt-0.5 shrink-0 opacity-70"
                            aria-hidden="true"
                          />
                          <p>
                            No internet, install, or account is required. Keep
                            the computer awake and use a current browser.
                            Quickque uses no loopback or public relay; HTTP is
                            unencrypted, so use a trusted LAN.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                </div>
              )}

              {!busy && !isRunning && !sessionInfo && !serverError && (
                <div className="flex flex-col items-center gap-3 py-8 text-sm text-muted-foreground">
                  <span>Remote access is stopped. Reopen this dialog to start it.</span>
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}