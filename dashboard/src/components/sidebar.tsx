"use client";

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
} from "lucide-react";
import { useTheme } from "next-themes";
import { useTranslation } from "@/lib/i18n";
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
  { href: "/health", labelKey: "nav.health", icon: Activity },
  { href: "/api-reference", labelKey: "nav.apiReference", icon: Code2 },
];

export function Sidebar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();
  const { locale, setLocale, t } = useTranslation();

  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r bg-card">
      <div className="flex h-16 items-center gap-2 border-b px-6">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary text-primary-foreground font-bold text-sm">
          OL
        </div>
        <div>
          <h1 className="text-lg font-bold leading-none">OEMline</h1>
          <p className="text-xs text-muted-foreground">Dashboard</p>
        </div>
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
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                isActive
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <item.icon className="h-4 w-4" />
              {t(item.labelKey)}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-4 space-y-2">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => setLocale(locale === "nl" ? "en" : "nl")}
        >
          <Globe className="h-4 w-4" />
          <span className="ml-2">{locale === "nl" ? "English" : "Nederlands"}</span>
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="ml-2">{t("nav.toggleTheme")}</span>
        </Button>
      </div>
    </aside>
  );
}
