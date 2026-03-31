"use client";

import { useState, useEffect, createContext, useContext } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import {
  LayoutDashboard,
  Search,
  Truck,
  BookOpen,
  AlertTriangle,
  BarChart3,
  GitCompare,
  Activity,
  Code2,
  Package,
  Tag,
  FolderTree,
  HardDrive,
  Moon,
  Sun,
  ShoppingCart,
  Globe,
  Settings,
  LogOut,
  Menu,
  X,
  FileText,
} from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslation } from "@/lib/i18n";
import { useAuth } from "@/lib/auth";
import { Button } from "@/components/ui/button";

const navItems = [
  { href: "/", labelKey: "nav.dashboard", icon: LayoutDashboard },
  { href: "/suppliers", labelKey: "nav.suppliers", icon: Truck },
  { href: "/products", labelKey: "nav.products", icon: Package },
  { href: "/brands", labelKey: "nav.brands", icon: Tag },
  { href: "/categories", labelKey: "nav.categories", icon: FolderTree },
  { href: "/search", labelKey: "nav.search", icon: Search },
  { href: "/tecdoc", labelKey: "nav.tecdoc", icon: BookOpen },
  { href: "/unmatched", labelKey: "nav.unmatched", icon: AlertTriangle },
  { href: "/finalized", labelKey: "nav.finalized", icon: ShoppingCart },
  { href: "/analytics", labelKey: "nav.analytics", icon: BarChart3 },
  { href: "/storage", labelKey: "nav.storage", icon: HardDrive },
  { href: "/overrides", labelKey: "nav.overrides", icon: GitCompare },
  { href: "/settings", labelKey: "nav.settings", icon: Settings },
  { href: "/health", labelKey: "nav.health", icon: Activity },
  { href: "/api-reference", labelKey: "nav.apiReference", icon: Code2 },
];

// Context so MobileHeader can toggle sidebar
const SidebarContext = createContext<{
  open: boolean;
  setOpen: (v: boolean) => void;
}>({ open: false, setOpen: () => {} });

export function useSidebar() {
  return useContext(SidebarContext);
}

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Close sidebar on route change (mobile)
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <SidebarContext.Provider value={{ open, setOpen }}>
      {children}
    </SidebarContext.Provider>
  );
}

/** Mobile top bar with hamburger — only visible below md */
export function MobileHeader() {
  const { open, setOpen } = useSidebar();
  const { t } = useTranslation();

  return (
    <header className="sticky top-0 z-50 flex h-14 items-center gap-3 border-b bg-card px-4 md:hidden">
      <Button
        variant="ghost"
        size="icon"
        className="h-10 w-10"
        onClick={() => setOpen(!open)}
        aria-label="Toggle menu"
      >
        {open ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </Button>
      <div className="flex items-center gap-2">
        <div className="flex h-7 w-7 items-center justify-center rounded-md bg-primary text-primary-foreground font-bold text-xs">
          OL
        </div>
        <span className="font-semibold text-sm">OEMline</span>
      </div>
    </header>
  );
}

export function Sidebar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { locale, setLocale, t } = useTranslation();
  const { email, logout } = useAuth();
  const { open, setOpen } = useSidebar();

  const handleLogout = () => {
    logout();
    window.location.href = "/login";
  };

  return (
    <>
      {/* Backdrop overlay on mobile when sidebar is open */}
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
          onClick={() => setOpen(false)}
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r bg-card transition-transform duration-200 ease-in-out",
          // Desktop: always visible
          "md:translate-x-0 md:z-40",
          // Mobile: slide in/out
          open ? "translate-x-0" : "-translate-x-full"
        )}
      >
        <div className="flex h-16 items-center gap-2 border-b px-6">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
            OL
          </div>
          <div>
            <h1 className="text-lg font-bold leading-none">OEMline</h1>
            <p className="text-xs text-muted-foreground">Dashboard</p>
          </div>
          {/* Close button on mobile */}
          <Button
            variant="ghost"
            size="icon"
            className="ml-auto h-8 w-8 md:hidden"
            onClick={() => setOpen(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto p-4">
          {navItems.map((item) => {
            const isActive =
              pathname === item.href ||
              (item.href !== "/" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors min-h-[44px]",
                  isActive
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                )}
              >
                <item.icon className="h-4 w-4 shrink-0" />
                {t(item.labelKey)}
              </Link>
            );
          })}
        </nav>

        <div className="border-t p-4 space-y-2">
          <a
            href="https://docs.oemline.eu"
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors min-h-[44px]"
          >
            <FileText className="h-4 w-4 shrink-0" />
            Documentation
          </a>
          {email && (
            <p className="text-xs text-muted-foreground truncate px-3 pb-1">{email}</p>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 min-h-[44px]"
            onClick={() => setLocale(locale === "nl" ? "en" : "nl")}
          >
            <Globe className="h-4 w-4" />
            <span className="ml-2">{locale === "nl" ? "English" : "Nederlands"}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 min-h-[44px]"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          >
            <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
            <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
            <span className="ml-2">{t("nav.toggleTheme")}</span>
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 min-h-[44px] text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={handleLogout}
          >
            <LogOut className="h-4 w-4" />
            <span className="ml-2">Sign Out</span>
          </Button>
        </div>
      </aside>
    </>
  );
}
