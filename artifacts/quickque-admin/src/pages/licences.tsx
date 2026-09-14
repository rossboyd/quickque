import { useState } from "react";
import { useGetAdminLicences, getGetAdminLicencesQueryKey } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Search, Plus, ExternalLink } from "lucide-react";
import { formatDate } from "@/lib/format";
import { CreateLicenceDialog } from "@/components/create-licence-dialog";
import { useDebounce } from "@/hooks/use-debounce";

export default function Licences() {
  const [search, setSearch] = useState("");
  const debouncedSearch = useDebounce(search, 300);
  
  const { data: licences, isLoading, isError } = useGetAdminLicences(
    { search: debouncedSearch || undefined },
    { query: { queryKey: getGetAdminLicencesQueryKey({ search: debouncedSearch || undefined }) } }
  );

  return (
    <div className="p-8 max-w-6xl mx-auto h-full flex flex-col">
      <div className="flex justify-between items-end mb-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Licences</h1>
          <p className="text-muted-foreground mt-1">Manage and provision access keys.</p>
        </div>
        <CreateLicenceDialog />
      </div>

      <div className="mb-6 relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <input 
          type="search"
          placeholder="Search by email, ID or Stripe reference..."
          className="w-full h-10 bg-background border border-border pl-10 pr-4 text-sm focus:outline-none focus:ring-1 focus:ring-primary focus:border-primary transition-all font-mono"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </div>

      <div className="flex-1 min-h-0 overflow-auto border border-border bg-card relative">
        <table className="w-full text-sm text-left">
          <thead className="bg-muted text-muted-foreground sticky top-0 z-10 text-xs uppercase tracking-wider font-medium">
            <tr>
              <th className="px-4 py-3 border-b border-border font-medium">ID / Email</th>
              <th className="px-4 py-3 border-b border-border font-medium">Plan</th>
              <th className="px-4 py-3 border-b border-border font-medium">Status</th>
              <th className="px-4 py-3 border-b border-border font-medium">Devices</th>
              <th className="px-4 py-3 border-b border-border font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {isLoading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                  <div className="flex justify-center items-center gap-2">
                    <div className="h-4 w-4 rounded-full border-2 border-primary border-t-transparent animate-spin" />
                    Loading...
                  </div>
                </td>
              </tr>
            ) : isError ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-destructive">Failed to load licences</td>
              </tr>
            ) : licences?.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-12 text-center">
                  <p className="text-muted-foreground mb-1">No licences found.</p>
                  {search && <p className="text-xs text-muted-foreground">Try clearing your search query.</p>}
                </td>
              </tr>
            ) : (
              licences?.map((l) => (
                <tr key={l.id} className="hover:bg-muted/50 transition-colors group">
                  <td className="px-4 py-3">
                    <div className="font-medium text-foreground">{l.email}</div>
                    <div className="text-xs text-muted-foreground font-mono mt-0.5">{l.id}</div>
                  </td>
                  <td className="px-4 py-3">
                    <span className="inline-flex items-center px-2 py-0.5 border border-border bg-background text-xs font-mono">
                      {l.plan}
                    </span>
                    <div className="text-xs text-muted-foreground mt-1 capitalize">{l.source}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className={`h-2 w-2 rounded-full ${l.active ? 'bg-primary' : 'bg-muted-foreground'}`} />
                      <span className={l.active ? 'text-foreground' : 'text-muted-foreground'}>
                        {l.active ? 'Active' : 'Inactive'}
                      </span>
                    </div>
                  </td>
                  <td className="px-4 py-3 font-mono">
                    {l.deviceCount} / {l.deviceLimit}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link 
                      href={`/licences/${l.id}`}
                      className="inline-flex items-center justify-center p-2 text-muted-foreground hover:text-primary hover:bg-primary/10 transition-colors"
                      title="View details"
                    >
                      <ExternalLink className="h-4 w-4" />
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}