import { Link, useLocation } from "wouter";
import { LayoutDashboard, KeyRound, LogOut, TerminalSquare } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminAuth } from "@/lib/admin-auth";

export function Sidebar() {
  const [location] = useLocation();
  const { email, logout } = useAdminAuth();

  const navItems = [
    { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
    { href: "/licences", label: "Licences", icon: KeyRound },
  ];

  return (
    <div className="flex w-64 flex-col bg-background h-screen sticky top-0">
      <div className="flex h-14 items-center border-b border-border px-6">
        <TerminalSquare className="h-5 w-5 mr-3 text-primary" />
        <span className="font-semibold tracking-tight">QQ Console</span>
      </div>
      
      <div className="flex-1 overflow-auto py-4">
        <nav className="space-y-1 px-4">
          {navItems.map((item) => {
            const isActive = location === item.href || location.startsWith(`${item.href}/`);
            const Icon = item.icon;
            
            return (
              <Link 
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 px-3 py-2 text-sm font-medium transition-colors border",
                  isActive 
                    ? "bg-foreground text-background border-foreground" 
                    : "text-muted-foreground border-transparent hover:bg-muted hover:text-foreground"
                )}
              >
                <Icon className="h-4 w-4" />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <div className="border-t border-border p-4">
        <div className="flex items-center justify-between px-2">
          <div className="flex flex-col overflow-hidden">
            <span className="truncate text-sm font-medium">Administrator</span>
            <span className="truncate text-xs text-muted-foreground">{email}</span>
          </div>
          <button 
            onClick={() => void logout()}
            className="p-2 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors border border-transparent hover:border-border"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}