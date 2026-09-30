"use client";

import { useEffect, useState } from "react";
import type { AnalyticsSnapshot, DataSource, LeadQueueItem, SundialCallRecord } from "@/lib/types";
import { useWorkspaceDataSource } from "./DataSourceProvider";
import { EMPTY_ANALYTICS, type Range } from "./format";

export function useConsoleData(
  initial?: {
    calls?: SundialCallRecord[];
    leads?: LeadQueueItem[];
    analytics?: AnalyticsSnapshot;
    source?: DataSource;
  },
  range?: Range
) {
  const { dataSource: workspaceSource, revision } = useWorkspaceDataSource();
  const [calls, setCalls] = useState<SundialCallRecord[]>(initial?.calls ?? []);
  const [leads, setLeads] = useState<LeadQueueItem[]>(initial?.leads ?? []);
  const [analytics, setAnalytics] = useState<AnalyticsSnapshot>(initial?.analytics ?? EMPTY_ANALYTICS);
  const [source, setSource] = useState<DataSource>(initial?.source ?? workspaceSource);
  const [isLoading, setIsLoading] = useState(!initial);

  useEffect(() => {
    setSource(workspaceSource);
    const fetchConsoleData = async () => {
      try {
        const analyticsUrl = range
          ? `/api/sundials/console/analytics?range=${encodeURIComponent(range)}`
          : "/api/sundials/console/analytics";
        const [callsRes, analyticsRes, leadsRes] = await Promise.all([
          fetch("/api/sundials/console/calls"),
          fetch(analyticsUrl),
          fetch("/api/sundials/console/leads")
        ]);
        if (callsRes.ok) {
          const callsData = await callsRes.json();
          if (callsData.calls) setCalls(callsData.calls);
        }
        if (analyticsRes.ok) {
          const analyticsData = await analyticsRes.json();
          if (analyticsData.analytics) setAnalytics(analyticsData.analytics);
          if (analyticsData.source === "mock" || analyticsData.source === "live") {
            setSource(analyticsData.source);
          }
        }
        if (leadsRes.ok) {
          const leadsData = await leadsRes.json();
          if (leadsData.leads) setLeads(leadsData.leads);
        }
      } catch {
        // ignore
      } finally {
        setIsLoading(false);
      }
    };
    setIsLoading(true);
    void fetchConsoleData();
    const interval = setInterval(() => {
      void fetchConsoleData();
    }, 3000);
    return () => clearInterval(interval);
  }, [range, workspaceSource, revision]);

  return { calls, leads, analytics, source, isLoading };
}
