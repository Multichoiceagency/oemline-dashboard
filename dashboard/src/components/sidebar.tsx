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
} from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";

const navItems = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/suppliers", label: "Suppliers", icon: Truck },
  { href: "/products", label: "Products", icon: Package },
  { href: "/brands", label: "Brands", icon: Tag },
  { href: "/categories", label: "Categories", icon: FolderTree },
  { href: "/search", label: "Product Search", icon: Search },
  { href: "/tecdoc", label: "TecDoc", icon: BookOpen },
  { href: "/unmatched", label: "Unmatched", icon: AlertTriangle },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/storage", label: "Storage", icon: HardDrive },
  { href: "/overrides", label: "Overrides", icon: GitCompare },
  { href: "/health", label: "System Health", icon: Activity },
  { href: "/api-reference", label: "API Reference", icon: Code2 },
];

export function Sidebar() {
  const pathname = usePathname();
  const { theme, setTheme } = useTheme();

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

      <nav className="flex-1 space-y-1 p-4">
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
              {item.label}
            </Link>
          );
        })}
      </nav>

      <div className="border-t p-4">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
        >
          <Sun className="h-4 w-4 rotate-0 scale-100 transition-all dark:-rotate-90 dark:scale-0" />
          <Moon className="absolute h-4 w-4 rotate-90 scale-0 transition-all dark:rotate-0 dark:scale-100" />
          <span className="ml-2">Toggle theme</span>
        </Button>
      </div>
    </aside>
  );
}
