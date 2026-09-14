import { useState, useRef, useEffect } from "react";
import { useParams, Link } from "wouter";
import { 
  useGetAdminLicence, 
  useUpdateAdminLicenceStatus,
  useDeleteAdminLicenceDevice,
  getGetAdminLicenceQueryKey 
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { formatDateTime } from "@/lib/format";
import { ArrowLeft, MonitorSmartphone, Shield, Power, PowerOff, Trash2, CalendarDays, ExternalLink, Activity } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function LicenceDetail() {
  const { id } = useParams<{ id: string }>();
  const { data: licence, isLoading, isError } = useGetAdminLicence(id);
  const updateStatus = useUpdateAdminLicenceStatus();
  const deleteDevice = useDeleteAdminLicenceDevice();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const handleToggleStatus = () => {
    if (!licence) return;
    const newStatus = !licence.active;
    
    updateStatus.mutate(
      { id, data: { active: newStatus } },
      {
        onSuccess: (updated) => {
          queryClient.setQueryData(getGetAdminLicenceQueryKey(id), (old: any) => 
            old ? { ...old, active: updated.active } : old
          );
          toast({ title: `Licence ${newStatus ? 'activated' : 'deactivated'}` });
        },
        onError: () => {
          toast({ title: "Failed to update status", variant: "destructive" });
        }
      }
    );
  };

  const handleDeleteDevice = (deviceId: string) => {
    if (!confirm("Are you sure you want to revoke this device's lease?")) return;
    
    deleteDevice.mutate(
      { id, deviceId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getGetAdminLicenceQueryKey(id) });
          toast({ title: "Device lease revoked" });
        },
        onError: () => {
          toast({ title: "Failed to revoke device lease", variant: "destructive" });
        }
      }
    );
  };

  if (isLoading) {
    return (
      <div className="p-8 max-w-6xl mx-auto flex items-center justify-center h-full">
        <div className="flex items-center gap-2 text-muted-foreground">
          <div className="h-4 w-4 border-2 border-primary border-t-transparent rounded-full animate-spin" />
          Loading licence record...
        </div>
      </div>
    );
  }

  if (isError || !licence) {
    return (
      <div className="p-8 max-w-6xl mx-auto">
        <div className="bg-destructive/10 text-destructive p-4 border border-destructive/20 mb-4">
          Error loading licence record.
        </div>
        <Link href="/licences" className="text-sm font-medium hover:underline inline-flex items-center gap-1">
          <ArrowLeft className="h-4 w-4" /> Back to list
        </Link>
      </div>
    );
  }

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-6 flex items-start gap-4">
        <Link href="/licences" className="h-10 w-10 shrink-0 border border-border bg-card flex items-center justify-center text-muted-foreground hover:bg-muted hover:text-foreground transition-colors">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3">
            <h1 className="text-2xl font-bold tracking-tight">{licence.email}</h1>
            <span className={`inline-flex items-center px-2 py-0.5 text-xs font-mono border ${licence.active ? 'border-primary/50 text-primary bg-primary/10' : 'border-border text-muted-foreground bg-muted'}`}>
              {licence.active ? 'ACTIVE' : 'INACTIVE'}
            </span>
            <span className="inline-flex items-center px-2 py-0.5 text-xs font-mono border border-border bg-background uppercase">
              {licence.plan}
            </span>
          </div>
          <p className="text-sm text-muted-foreground font-mono mt-1">{licence.id}</p>
        </div>
        <button
          onClick={handleToggleStatus}
          disabled={updateStatus.isPending}
          className={`h-10 px-4 text-sm font-medium inline-flex items-center gap-2 border transition-colors ${
            licence.active 
              ? 'border-destructive text-destructive hover:bg-destructive/10' 
              : 'border-primary bg-primary text-primary-foreground hover:bg-primary/90'
          }`}
        >
          {updateStatus.isPending ? (
            <div className="h-4 w-4 border-2 border-current border-t-transparent rounded-full animate-spin" />
          ) : licence.active ? (
            <><PowerOff className="h-4 w-4" /> Deactivate</>
          ) : (
            <><Power className="h-4 w-4" /> Activate</>
          )}
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        <div className="md:col-span-2 space-y-6">
          <div className="border border-border bg-card">
            <div className="bg-muted px-4 py-3 border-b border-border flex items-center gap-2 text-sm font-medium">
              <MonitorSmartphone className="h-4 w-4" /> 
              Registered Devices ({licence.devices?.length || 0} / {licence.deviceLimit})
            </div>
            {licence.devices?.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No devices have activated this licence yet.
              </div>
            ) : (
              <div className="divide-y divide-border">
                {licence.devices?.map((dev) => (
                  <div key={dev.id} className="p-4 flex items-center justify-between group hover:bg-muted/30 transition-colors">
                    <div>
                      <div className="font-medium flex items-center gap-2">
                        {dev.model}
                        {!dev.active && <span className="text-[10px] uppercase bg-muted text-muted-foreground px-1.5 border border-border">Inactive</span>}
                      </div>
                      <div className="text-xs text-muted-foreground font-mono mt-1 flex flex-col gap-0.5">
                        <span>HWID: {dev.hardwareId}</span>
                        <span>OS: {dev.osVersion} • Seen: {formatDateTime(dev.lastSeenAt)}</span>
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteDevice(dev.id)}
                      disabled={deleteDevice.isPending}
                      className="p-2 text-muted-foreground hover:text-destructive hover:bg-destructive/10 border border-transparent hover:border-destructive/20 transition-colors opacity-0 group-hover:opacity-100 disabled:opacity-50"
                      title="Revoke lease"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="border border-border bg-card">
            <div className="bg-muted px-4 py-3 border-b border-border flex items-center gap-2 text-sm font-medium">
              <Shield className="h-4 w-4" /> 
              Audit Log
            </div>
            {licence.auditRows?.length === 0 ? (
              <div className="p-8 text-center text-sm text-muted-foreground">
                No audit events recorded.
              </div>
            ) : (
              <div className="divide-y divide-border max-h-[400px] overflow-auto">
                {licence.auditRows?.map((row) => (
                  <div key={row.id} className="p-4 flex items-start gap-4">
                    <div className="mt-0.5 text-muted-foreground">
                      <Activity className="h-4 w-4" />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex justify-between items-start mb-1">
                        <span className="text-sm font-medium text-foreground uppercase tracking-wider text-[11px]">{row.action}</span>
                        <span className="text-xs text-muted-foreground font-mono whitespace-nowrap ml-2">
                          {formatDateTime(row.createdAt)}
                        </span>
                      </div>
                      {row.ipAddress && (
                        <div className="text-xs text-muted-foreground font-mono mb-1">IP: {row.ipAddress}</div>
                      )}
                      {row.details && (
                        <div className="text-xs text-foreground bg-muted p-2 border border-border break-all">
                          {row.details}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-6">
          <div className="border border-border bg-card">
            <div className="bg-muted px-4 py-3 border-b border-border flex items-center gap-2 text-sm font-medium">
              <CalendarDays className="h-4 w-4" /> 
              Metadata
            </div>
            <div className="p-4 space-y-4">
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Created</div>
                <div className="text-sm font-mono">{formatDateTime(licence.purchasedAt)}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Source</div>
                <div className="text-sm capitalize">{licence.source}</div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Paid Through</div>
                <div className="text-sm font-mono">{licence.paidThrough ? formatDateTime(licence.paidThrough) : 'Lifetime'}</div>
              </div>
            </div>
          </div>

          {(licence.stripeCustomerId || licence.stripeSubscriptionId || licence.stripeCheckoutSessionId) && (
            <div className="border border-border bg-card">
              <div className="bg-muted px-4 py-3 border-b border-border flex items-center gap-2 text-sm font-medium">
                <ExternalLink className="h-4 w-4" /> 
                Billing Links
              </div>
              <div className="p-4 space-y-3">
                {licence.stripeCustomerId && (
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Customer ID</div>
                    <a
                      href={`https://dashboard.stripe.com/search?query=${encodeURIComponent(licence.stripeCustomerId)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-sm font-mono break-all bg-muted p-1 border border-border hover:border-primary"
                    >
                      {licence.stripeCustomerId}
                    </a>
                  </div>
                )}
                {licence.stripeSubscriptionId && (
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Subscription ID</div>
                    <a
                      href={`https://dashboard.stripe.com/search?query=${encodeURIComponent(licence.stripeSubscriptionId)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-sm font-mono break-all bg-muted p-1 border border-border hover:border-primary"
                    >
                      {licence.stripeSubscriptionId}
                    </a>
                  </div>
                )}
                {licence.stripeCheckoutSessionId && (
                  <div>
                    <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Checkout Session</div>
                    <a
                      href={`https://dashboard.stripe.com/search?query=${encodeURIComponent(licence.stripeCheckoutSessionId)}`}
                      target="_blank"
                      rel="noreferrer"
                      className="block text-sm font-mono break-all bg-muted p-1 border border-border hover:border-primary"
                    >
                      {licence.stripeCheckoutSessionId}
                    </a>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}