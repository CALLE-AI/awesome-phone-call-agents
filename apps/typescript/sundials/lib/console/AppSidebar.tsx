"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Brain, ChartLine, ExternalLink, KeyRound, LogOut, Settings, Store, Users } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem
} from "@/components/ui/sidebar";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useWorkspaceDataSource } from "@/lib/console/DataSourceProvider";

const NAV = [
  {
    href: "/app/home",
    label: "Analytics",
    icon: ChartLine,
    match: (path: string) => path.startsWith("/app/home")
  },
  {
    href: "/app/leads",
    label: "Leads",
    icon: Users,
    match: (path: string) =>
      path.startsWith("/app/leads") || path.startsWith("/app/lead") || path.startsWith("/app/call")
  },
  {
    href: "/app/brain",
    label: "Brain",
    icon: Brain,
    match: (path: string) => path.startsWith("/app/brain")
  }
];

const DEMO_TABS = [
  { href: "/demo", label: "Platform" },
  { href: "/demo/pricing", label: "Pricing" },
  { href: "/demo/reviews", label: "Customers" },
  { href: "/demo/faq", label: "FAQ" },
  { href: "/demo/contact", label: "Contact" }
];

function SidebarBrand() {
  return (
    <div className="px-1 py-1">
      <Image
        src="/sundials-wordmark.png"
        alt="Sundials"
        width={420}
        height={152}
        unoptimized
        priority
        className="h-14 w-auto max-w-full object-contain object-left"
      />
    </div>
  );
}

export function AppSidebar({ companyName, accountId }: { companyName: string; accountId: string }) {
  const pathname = usePathname() || "/app/home";
  const keysActive = pathname.startsWith("/app/keys");
  const settingsActive = pathname.startsWith("/app/settings");
  const { mockEnabled, saving: mockSaving, setDataSource } = useWorkspaceDataSource();
  const initial = (companyName.trim().charAt(0) || "S").toUpperCase();

  return (
    <Sidebar collapsible="none" className="border-r">
      <SidebarHeader className="p-3 pt-4">
        <SidebarBrand />
      </SidebarHeader>
      <SidebarContent className="px-2">
        <SidebarGroup className="p-0">
          <SidebarGroupContent>
            <SidebarMenu className="gap-1">
              {NAV.map((item) => (
                <SidebarMenuItem key={item.href}>
                  <SidebarMenuButton asChild isActive={item.match(pathname)} className="h-10 px-3">
                    <Link href={item.href}>
                      <item.icon />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter className="gap-2 px-2 pb-3">
        <Separator className="mx-1" />
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild className="h-10 px-3">
              <a href="/demo" target="_blank" rel="noreferrer">
                <Store />
                <span>Demo</span>
                <ExternalLink className="ml-auto size-3.5 opacity-50" />
              </a>
            </SidebarMenuButton>
            <SidebarMenuSub className="mx-3.5 mb-1 border-sidebar-border">
              {DEMO_TABS.map((tab) => (
                <SidebarMenuSubItem key={tab.href}>
                  <SidebarMenuSubButton asChild>
                    <a href={tab.href} target="_blank" rel="noreferrer">
                      <span>{tab.label}</span>
                    </a>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              ))}
              <SidebarMenuSubItem>
                <div className="flex h-7 min-w-0 -translate-x-px items-center justify-between gap-2 overflow-hidden rounded-md px-2 text-sm text-sidebar-foreground">
                  <span className="truncate">Mock data</span>
                  <Switch
                    checked={mockEnabled}
                    disabled={mockSaving}
                    aria-label="Toggle mock analytics and leads overlay"
                    onCheckedChange={(checked) => {
                      void setDataSource(checked ? "mock" : "live");
                    }}
                  />
                </div>
              </SidebarMenuSubItem>
            </SidebarMenuSub>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={keysActive} className="h-10 px-3">
              <Link href="/app/keys">
                <KeyRound />
                <span>API keys</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton asChild isActive={settingsActive} className="h-10 px-3">
              <Link href="/app/settings">
                <Settings />
                <span>Settings</span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="h-10 px-3"
              onClick={() => {
                void fetch("/api/sundials/auth/logout", { method: "POST" }).then(() => {
                  window.location.href = "/login";
                });
              }}
            >
              <LogOut />
              <span>Sign out</span>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <div className="mx-1 rounded-md border border-sidebar-border bg-sidebar px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <Avatar className="size-8" aria-label={companyName}>
              <AvatarFallback className="bg-teal-800 text-sm font-semibold text-white">{initial}</AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium">{companyName}</p>
                {accountId === "harbor" ? <Badge variant="secondary">Demo</Badge> : null}
              </div>
            </div>
          </div>
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
