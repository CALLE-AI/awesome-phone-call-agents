"use client";

import type { CSSProperties, ReactNode } from "react";
import { AppSidebar } from "./AppSidebar";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { TooltipProvider } from "@/components/ui/tooltip";

export function DashboardChrome({ children }: { children: ReactNode }) {
  return (
    <TooltipProvider>
      <SidebarProvider
        className="h-svh overflow-hidden"
        style={
          {
            "--sidebar-width": "18rem"
          } as CSSProperties
        }
      >
        <AppSidebar />
        <SidebarInset className="min-h-0 min-w-0 overflow-y-auto bg-background">
          <div className="mx-auto w-full max-w-[1400px] space-y-8 px-6 py-8 md:px-8 md:py-10 lg:px-10">
            {children}
          </div>
        </SidebarInset>
      </SidebarProvider>
    </TooltipProvider>
  );
}
