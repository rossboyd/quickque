import { useState, useEffect } from 'react';
import { useRemoteStore } from '@/lib/remote/store';
import { isDesktop } from '@/lib/desktop';
import { QRCodeSVG } from 'qrcode.react';
import { 
  Smartphone, Wifi, ShieldAlert, Monitor, Play, Square, 
  Check, X as XIcon, Link as LinkIcon, KeyRound, RefreshCw
} from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from '@/components/ui/dialog';

export function RemoteControlDialog({ trigger }: { trigger?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const { 
    isRunning, sessionInfo, serverError, isPending, isConnected,
    startServer, stopServer, approveConnection, rejectConnection, replaceController, checkPending
  } = useRemoteStore();
  const pairingUrl = sessionInfo
    ? `${sessionInfo.url}?code=${encodeURIComponent(sessionInfo.code)}`
    : '';

  useEffect(() => {
    let interval: number;
    if (isRunning && !isConnected) {
      interval = window.setInterval(() => {
        checkPending();
      }, 1000);
    }
    return () => clearInterval(interval);
  }, [isRunning, isConnected, checkPending]);

  useEffect(() => {
    if (isPending) setOpen(true);
  }, [isPending]);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        {trigger || (
          <button className="w-full flex items-center gap-2 p-2 hover:bg-sidebar-accent rounded-md text-sidebar-foreground transition-colors font-medium">
            <Smartphone className="w-5 h-5 opacity-70" />
            Phone Remote
          </button>
        )}
      </DialogTrigger>
      <DialogContent className="sm:max-w-[500px] bg-background border-border max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-xl flex items-center gap-2">
            <Smartphone className="w-5 h-5 text-primary" />
            Local Phone Remote
          </DialogTitle>
        </DialogHeader>
        
        <div className="space-y-6 py-4">
          {!isDesktop() ? (
            <div className="bg-accent/30 p-4 rounded-lg flex gap-3 text-sm">
              <ShieldAlert className="w-5 h-5 text-accent-foreground shrink-0" />
              <div>
                <p className="font-medium text-foreground mb-1">Desktop App Required</p>
                <p className="text-muted-foreground leading-relaxed">
                  Local Phone Remote requires the Quickque Desktop App to host the remote server. You are currently in a web browser. The manual teleprompter is still fully usable here, but to control it from your phone, please use the macOS app.
                </p>
              </div>
            </div>
          ) : (
            <>
              {/* Server Controls */}
              <div className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border border-border/50">
                <div>
                  <div className="font-medium">Remote Server</div>
                  <div className="text-sm text-muted-foreground flex items-center gap-1 mt-0.5">
                    <div className={`w-2 h-2 rounded-full ${
                      isRunning ? 'bg-green-500' :
                      serverError ? 'bg-red-500' : 'bg-muted-foreground'
                    }`} />
                    <span>{isRunning ? 'Running' : serverError ? 'Error' : 'Stopped'}</span>
                  </div>
                </div>
                
                {!isRunning ? (
                  <button 
                    onClick={() => startServer()}
                    className="flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-md text-sm font-medium hover:bg-primary/90 transition-colors"
                  >
                    <Play className="w-4 h-4 fill-current" />
                    Start
                  </button>
                ) : (
                  <button 
                    onClick={() => stopServer()}
                    className="flex items-center gap-2 px-4 py-2 bg-destructive/10 text-destructive rounded-md text-sm font-medium hover:bg-destructive/20 transition-colors"
                  >
                    <Square className="w-4 h-4 fill-current" />
                    Stop
                  </button>
                )}
              </div>
              
              {serverError && (
                <div className="text-sm p-3 rounded bg-destructive/10 text-destructive border border-destructive/20">
                  {serverError}
                </div>
              )}

              {/* Connections area */}
              {isRunning && sessionInfo && (
                <div className="space-y-6 animate-in fade-in slide-in-from-top-2 duration-300">
                  
                  {/* Status & Approvals */}
                  <div className="space-y-3">
                    <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">Controller Status</h3>
                    
                    {isConnected ? (
                      <div className="flex items-center justify-between p-3 bg-primary/10 border border-primary/20 rounded-lg">
                        <div className="flex items-center gap-2 text-primary font-medium">
                          <Smartphone className="w-4 h-4" />
                          Controller Approved
                        </div>
                        <button 
                          onClick={() => replaceController()}
                          className="text-xs flex items-center gap-1 px-3 py-1.5 bg-background border border-border rounded shadow-sm hover:bg-muted transition-colors"
                        >
                          <RefreshCw className="w-3 h-3" />
                          Replace
                        </button>
                      </div>
                    ) : (
                      <div className="p-3 bg-muted/50 border border-border/50 rounded-lg text-sm text-muted-foreground text-center">
                        Waiting for connection...
                      </div>
                    )}

                    {isPending && !isConnected && (
                      <div className="space-y-2 mt-4">
                        <div className="text-xs font-medium text-amber-600 dark:text-amber-500 uppercase tracking-wider">Pending Approval</div>
                        <div className="flex items-center justify-between p-3 bg-amber-500/10 border border-amber-500/20 rounded-lg">
                          <span className="font-medium text-sm flex items-center gap-2">
                            <Smartphone className="w-4 h-4" />
                            A device is requesting access
                          </span>
                          <div className="flex items-center gap-2">
                            <button 
                              onClick={() => rejectConnection()}
                              className="p-1.5 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded transition-colors"
                              title="Reject"
                            >
                              <XIcon className="w-4 h-4" />
                            </button>
                            <button 
                              onClick={() => approveConnection()}
                              className="p-1.5 text-green-600 hover:bg-green-500/10 rounded transition-colors"
                              title="Approve"
                            >
                              <Check className="w-4 h-4" />
                            </button>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>

                  {/* QR & Network Info */}
                  {!isConnected && (
                    <div className="space-y-4 pt-2 border-t border-border">
                      <div className="flex flex-col items-center p-6 bg-white rounded-xl shadow-inner border border-gray-200">
                        <QRCodeSVG value={pairingUrl} size={180} level="M" includeMargin={false} />
                        
                        <div className="mt-6 flex flex-col items-center gap-1">
                          <div className="text-xs font-bold text-gray-400 uppercase tracking-widest flex items-center gap-1">
                            <KeyRound className="w-3 h-3" /> Connect Code
                          </div>
                          <div className="text-3xl font-mono font-bold tracking-[0.2em] text-gray-800">
                            {sessionInfo.code}
                          </div>
                        </div>
                        
                        <div className="mt-4 text-center space-y-1 w-full border-t border-gray-100 pt-4">
                          <div className="flex items-center justify-center gap-1.5 text-sm font-mono text-gray-600 bg-gray-50 px-2 py-1 rounded">
                            <LinkIcon className="w-3 h-3 opacity-50" />
                            {sessionInfo.url}
                          </div>
                        </div>
                      </div>
                      
                      <div className="grid gap-3 text-sm text-muted-foreground">
                        <div className="flex gap-2.5">
                          <Wifi className="w-4 h-4 mt-0.5 shrink-0 opacity-70" />
                          <p>Make sure your phone is on the <strong>same Wi-Fi network</strong>. You may need to allow Quickque through your firewall.</p>
                        </div>
                        <div className="flex gap-2.5">
                          <Monitor className="w-4 h-4 mt-0.5 shrink-0 opacity-70" />
                          <p>Prevent your computer from sleeping during presentations, as it will disconnect the remote.</p>
                        </div>
                      </div>
                    </div>
                  )}
                  
                </div>
              )}
            </>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
