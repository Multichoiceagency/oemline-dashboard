"use client";

import { Sidebar, SidebarProvider, MobileHeader } from "@/components/sidebar";
import { AuthGuard } from "@/components/auth-guard";

export default function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <AuthGuard>
      <SidebarProvider>
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex-1 md:ml-64 flex flex-col min-w-0">
            <MobileHeader />
            <main className="flex-1">
              <div className="p-4 sm:p-6 md:p-8">{children}</div>
            </main>
          </div>
        </div>
      </SidebarProvider>
    </AuthGuard>
  );
}
