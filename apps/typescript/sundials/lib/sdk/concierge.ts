"use client";

import type { ConciergeCta, IdentifiedLead, WebSessionContext } from "@/lib/types";
import { newEntityId } from "@/lib/ids";
import { compactE164 } from "@/lib/calle/security";
import { SUNDIALS_API_KEY_HEADER } from "./public-key";
import { ctaOpensWidget, scDatasetProperties } from "./cta-dataset";
import {
  parseTrackingConsent,
  serializeTrackingConsent,
  TRACKING_CONSENT_STORAGE_KEY
} from "./tracking-consent";

const VISITOR_KEY = "sundials_visitor_id";
const SESSION_KEY = "sundials_session_id";

export type IntentConsent = "unknown" | "granted" | "denied";

export interface SundialsConfig {
  apiKey?: string;
  accountId: string;
  apiEndpoint?: string;
  position?: "bottom-right" | "bottom-left";
  title?: string;
  description?: string;
  brandName?: string;
  primaryAction?: ConciergeCta;
  actions?: ConciergeCta[];
  learnMoreHref?: string;
  requireConsent?: boolean;
  /** Default true. Set false to keep only consent + modal and place your own buttons. */
  showLauncher?: boolean;
  onLearnMore?: () => void;
}

type QueuedEvent = {
  event: string;
  properties?: Record<string, unknown>;
  timestamp: string;
};

function safeLocal(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function safeSession(): Storage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

class SundialsClient {
  private config: SundialsConfig = { accountId: "harbor", requireConsent: true };
  private queue: QueuedEvent[] = [];
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private hoverTimer: ReturnType<typeof setInterval> | null = null;
  private lastPath: string | null = null;
  private startedAt = Date.now();
  private identified: IdentifiedLead = {};
  private clickBound = false;
  private hoverBound = false;
  private historyBound = false;
  private memoryVisitorId: string | null = null;
  private memorySessionId: string | null = null;
  private hoverPath: string | null = null;
  private hoverStartedAt: number | null = null;
  private hoverAccumMs = 0;
  private pointerOnPage = false;
  private consentListeners = new Set<() => void>();
  private openListeners = new Set<(cta: ConciergeCta) => void>();
  private lastDispatchPhone: string | null = null;

  public init(config: SundialsConfig): void {
    this.config = {
      apiEndpoint: "/api/sundials",
      requireConsent: true,
      ...config,
      apiKey: config.apiKey?.trim() || ""
    };
    this.startedAt = Date.now();
    this.bindCtaClicks();
    this.bindHover();
    this.bindHistory();
    if (this.canObserve()) {
      this.pageView();
    }
  }

  public getConfig(): SundialsConfig {
    return this.config;
  }

  public getApiKey(): string {
    return this.config.apiKey || "";
  }

  public subscribeConsent(listener: () => void): () => void {
    this.consentListeners.add(listener);
    return () => this.consentListeners.delete(listener);
  }

  public subscribeOpen(listener: (cta: ConciergeCta) => void): () => void {
    this.openListeners.add(listener);
    return () => this.openListeners.delete(listener);
  }

  public requestOpen(cta: ConciergeCta = "talk_to_sales"): void {
    for (const listener of this.openListeners) listener(cta);
  }

  public consentStatus(): IntentConsent {
    if (this.config.requireConsent === false) return "granted";
    safeLocal()?.removeItem(TRACKING_CONSENT_STORAGE_KEY);
    const session = safeSession();
    const stored = session?.getItem(TRACKING_CONSENT_STORAGE_KEY) ?? null;
    const status = parseTrackingConsent(stored);
    if (stored && status === "unknown") session?.removeItem(TRACKING_CONSENT_STORAGE_KEY);
    return status;
  }

  public canObserve(): boolean {
    return this.consentStatus() === "granted";
  }

  public grantConsent(): void {
    safeLocal()?.removeItem(TRACKING_CONSENT_STORAGE_KEY);
    safeSession()?.setItem(TRACKING_CONSENT_STORAGE_KEY, serializeTrackingConsent("granted"));
    this.notifyConsent();
    this.pageView(typeof window !== "undefined" ? window.location.pathname : undefined);
    void this.flush();
  }

  public denyConsent(): void {
    this.pauseHover();
    this.queue = [];
    safeLocal()?.removeItem(TRACKING_CONSENT_STORAGE_KEY);
    safeSession()?.setItem(TRACKING_CONSENT_STORAGE_KEY, serializeTrackingConsent("denied"));
    this.notifyConsent();
  }

  public rememberDispatchPhone(phone: string): void {
    this.lastDispatchPhone = compactE164(phone);
  }

  public async stopFollowUp(phone?: string): Promise<{ ok: boolean; message?: string }> {
    const compact = compactE164(phone || this.lastDispatchPhone || "");
    if (!compact) return { ok: false, message: "No phone number to stop." };
    const endpoint = `${this.config.apiEndpoint || "/api/sundials"}/stop`;
    try {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [SUNDIALS_API_KEY_HEADER]: this.getApiKey()
        },
        body: JSON.stringify({
          accountId: this.config.accountId,
          visitorId: this.visitorId(),
          phoneNumber: compact
        })
      });
      const data = (await res.json()) as { success?: boolean; message?: string };
      if (!res.ok || !data.success) {
        return { ok: false, message: data.message || "Could not stop the follow-up." };
      }
      return { ok: true };
    } catch (err: unknown) {
      return { ok: false, message: err instanceof Error ? err.message : "Could not stop the follow-up." };
    }
  }

  private notifyConsent() {
    for (const listener of this.consentListeners) listener();
  }

  public visitorId(): string {
    if (this.canObserve() || this.identified.email || this.identified.phone) {
      const local = safeLocal();
      if (local) {
        const existing = local.getItem(VISITOR_KEY) || this.memoryVisitorId || newEntityId();
        local.setItem(VISITOR_KEY, existing);
        this.memoryVisitorId = existing;
        return existing;
      }
    }
    if (!this.memoryVisitorId) this.memoryVisitorId = newEntityId();
    return this.memoryVisitorId;
  }

  public sessionId(): string {
    if (this.canObserve() || this.identified.email || this.identified.phone) {
      const session = safeSession();
      if (session) {
        const existing = session.getItem(SESSION_KEY) || this.memorySessionId || newEntityId();
        session.setItem(SESSION_KEY, existing);
        this.memorySessionId = existing;
        return existing;
      }
    }
    if (!this.memorySessionId) this.memorySessionId = newEntityId();
    return this.memorySessionId;
  }

  public getSessionContext(): WebSessionContext {
    let url = "/demo";
    let referrer = "";
    let utmSource = "";
    let utmMedium = "";
    let utmCampaign = "";
    let locale = "en-US";

    if (typeof window !== "undefined") {
      url = window.location.pathname + window.location.search;
      referrer = document.referrer;
      locale = navigator.language || "en-US";
      const params = new URLSearchParams(window.location.search);
      utmSource = params.get("utm_source") || "";
      utmMedium = params.get("utm_medium") || "";
      utmCampaign = params.get("utm_campaign") || "";
    }

    return {
      id: this.sessionId(),
      visitorId: this.visitorId(),
      accountId: this.config.accountId,
      landingUrl: url,
      referrer: referrer || undefined,
      utmSource: utmSource || undefined,
      utmMedium: utmMedium || undefined,
      utmCampaign: utmCampaign || undefined,
      timeOnPageSec: Math.floor((Date.now() - this.startedAt) / 1000),
      detectedLocale: locale,
      leadContext: {
        pageType: "harbor-site",
        icp: "b2b-saas",
        sourceCta: this.config.primaryAction || "talk_to_sales"
      }
    };
  }

  public track(event: string, properties: Record<string, unknown> = {}): void {
    const transactional = event === "identify" || event === "phone_provided" || event === "demo_requested";
    if (!this.canObserve() && !transactional) return;
    this.queue.push({
      event,
      properties,
      timestamp: new Date().toISOString()
    });
    if (this.queue.length >= 10) {
      void this.flush();
      return;
    }
    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        this.flushTimer = null;
        void this.flush();
      }, 2000);
    }
  }

  public identify(lead: IdentifiedLead): void {
    this.identified = { ...this.identified, ...lead };
    this.track("identify", { ...lead });
    void this.flush();
  }

  public getIdentified(): IdentifiedLead {
    return this.identified;
  }

  public pageView(path?: string): void {
    if (typeof window === "undefined") return;
    const current = path || window.location.pathname;
    if (this.lastPath && this.lastPath !== current) {
      this.emitHover(this.lastPath);
    }
    this.hoverPath = current;
    if (this.lastPath === current) return;
    this.lastPath = current;
    this.track("page_view", {
      path: current,
      referrer: document.referrer || undefined,
      title: document.title
    });
  }

  public bindCtaClicks(): void {
    if (this.clickBound || typeof document === "undefined") return;
    this.clickBound = true;
    document.addEventListener("click", (event) => {
      const target = event.target as HTMLElement | null;
      const node = target?.closest?.("[data-sc-cta]") as HTMLElement | null;
      if (!node) return;
      const name = node.getAttribute("data-sc-cta") || "unknown";
      this.track("cta_clicked", {
        name,
        href: node.getAttribute("href") || undefined,
        label: node.textContent?.trim().slice(0, 80),
        ...scDatasetProperties(node.attributes)
      });
      const openCta = ctaOpensWidget(node);
      if (!openCta) return;
      event.preventDefault();
      this.requestOpen(openCta);
    });
  }

  public bindHistory(): void {
    if (this.historyBound || typeof window === "undefined") return;
    this.historyBound = true;
    const notify = () => this.pageView(window.location.pathname);
    const wrap = (fn: History["pushState"]) =>
      function pushOrReplace(this: History, ...args: Parameters<History["pushState"]>) {
        const result = fn.apply(this, args);
        notify();
        return result;
      };
    history.pushState = wrap(history.pushState.bind(history));
    history.replaceState = wrap(history.replaceState.bind(history));
    window.addEventListener("popstate", notify);
  }

  public bindHover(): void {
    if (this.hoverBound || typeof document === "undefined") return;
    this.hoverBound = true;
    document.addEventListener("pointermove", () => this.onPointerActive());
    document.addEventListener("pointerdown", () => this.onPointerActive());
    document.documentElement.addEventListener("pointerleave", () => this.pauseHover());
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        this.pauseHover();
        this.emitHover(this.hoverPath || this.lastPath);
        void this.flush();
      }
    });
    this.hoverTimer = setInterval(() => {
      if (!this.canObserve() || !this.pointerOnPage) return;
      this.emitHover(this.hoverPath || this.lastPath);
    }, 10000);
  }

  private onPointerActive() {
    if (!this.canObserve()) return;
    this.pointerOnPage = true;
    if (this.hoverStartedAt == null) this.hoverStartedAt = Date.now();
    if (!this.hoverPath && typeof window !== "undefined") {
      this.hoverPath = window.location.pathname;
    }
  }

  private pauseHover() {
    if (this.hoverStartedAt != null) {
      this.hoverAccumMs += Date.now() - this.hoverStartedAt;
      this.hoverStartedAt = null;
    }
    this.pointerOnPage = false;
  }

  private emitHover(path: string | null) {
    if (!this.canObserve() || !path) return;
    if (this.hoverStartedAt != null) {
      this.hoverAccumMs += Date.now() - this.hoverStartedAt;
      this.hoverStartedAt = this.pointerOnPage ? Date.now() : null;
    }
    const hoverSec = Math.round(this.hoverAccumMs / 1000);
    this.hoverAccumMs = 0;
    if (hoverSec < 1) return;
    this.track("page_hover", { path, hoverSec });
  }

  public flushPageHover(): void {
    this.pauseHover();
    this.emitHover(this.hoverPath || this.lastPath);
  }

  public async flush(): Promise<void> {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (this.queue.length === 0) return;
    const batch = this.queue.splice(0, this.queue.length);
    const endpoint = `${this.config.apiEndpoint || "/api/sundials"}/events`;
    try {
      await fetch(endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          [SUNDIALS_API_KEY_HEADER]: this.getApiKey()
        },
        body: JSON.stringify({
          accountId: this.config.accountId,
          visitorId: this.visitorId(),
          sessionId: this.sessionId(),
          events: batch
        }),
        keepalive: true
      });
    } catch {
      this.queue.unshift(...batch);
    }
  }
}

export const sundials = new SundialsClient();

export const SundialsApi = {
  init: (config: SundialsConfig) => sundials.init(config),
  track: (event: string, properties?: Record<string, unknown>) => sundials.track(event, properties),
  identify: (lead: IdentifiedLead) => sundials.identify(lead),
  grantConsent: () => sundials.grantConsent(),
  denyConsent: () => sundials.denyConsent(),
  consentStatus: () => sundials.consentStatus(),
  getApiKey: () => sundials.getApiKey(),
  open: (cta: ConciergeCta = "talk_to_sales") => sundials.requestOpen(cta),
  stopFollowUp: (phone?: string) => sundials.stopFollowUp(phone)
};

if (typeof window !== "undefined") {
  window.addEventListener("pagehide", () => {
    sundials.flushPageHover();
    void sundials.flush();
  });
}
