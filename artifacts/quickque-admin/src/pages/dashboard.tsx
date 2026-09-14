import { useGetAdminSummary } from "@workspace/api-client-react";
import { formatNumber } from "@/lib/format";
import { Users, Key, Gift, ShieldAlert, CreditCard, Infinity as InfinityIcon, Activity } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";

export default function Dashboard() {
  const { data: summary, isLoading, isError } = useGetAdminSummary();

  const stats = [
    { label: "Total Licences", value: summary?.total, icon: Key },
    { label: "Active", value: summary?.active, icon: Activity },
    { label: "Gifts", value: summary?.gifts, icon: Gift },
    { label: "Testers", value: summary?.testers, icon: ShieldAlert },
    { label: "Subscriptions", value: summary?.subscriptions, icon: CreditCard },
    { label: "Lifetime", value: summary?.lifetime, icon: InfinityIcon },
    { label: "Recent Issuances", value: summary?.recentIssuances, icon: Users },
  ];

  return (
    <div className="p-8 max-w-6xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold tracking-tight">Overview</h1>
        <p className="text-muted-foreground mt-1">System summary and current licence metrics.</p>
      </div>

      {isError ? (
        <div className="bg-destructive/10 text-destructive p-4 border border-destructive/20 text-sm">
          Failed to load summary metrics. Please try again.
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {stats.map((stat, i) => (
            <div key={i} className="border border-border bg-card p-5 hover-elevate">
              <div className="flex justify-between items-start mb-4">
                <p className="text-xs font-medium text-muted-foreground uppercase tracking-wider">{stat.label}</p>
                <stat.icon className="h-4 w-4 text-muted-foreground" />
              </div>
              {isLoading ? (
                <Skeleton className="h-8 w-20 bg-muted" />
              ) : (
                <p className="text-3xl font-mono font-medium tracking-tight">
                  {stat.value !== undefined ? formatNumber(stat.value) : "—"}
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}