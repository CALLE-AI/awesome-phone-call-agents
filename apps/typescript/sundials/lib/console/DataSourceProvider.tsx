"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { DataSource, WorkspaceSettings } from "@/lib/types";

type DataSourceContextValue = {
  dataSource: DataSource;
  mockEnabled: boolean;
  revision: number;
  saving: boolean;
  error: string | null;
  setDataSource: (next: DataSource) => Promise<void>;
  toggleMock: () => Promise<void>;
};

const DataSourceContext = createContext<DataSourceContextValue | null>(null);

export function DataSourceProvider({
  initial,
  children
}: {
  initial: WorkspaceSettings;
  children: ReactNode;
}) {
  const router = useRouter();
  const [dataSource, setDataSourceState] = useState<DataSource>(initial.dataSource);
  const [revision, setRevision] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const setDataSource = async (next: DataSource) => {
    const previous = dataSource;
    if (next === previous) return;
    setDataSourceState(next);
    setRevision((value) => value + 1);
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/sundials/console/settings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ dataSource: next })
      });
      if (!res.ok) throw new Error("Could not save settings");
      const body = (await res.json()) as { settings?: WorkspaceSettings };
      if (body.settings?.dataSource) setDataSourceState(body.settings.dataSource);
      router.refresh();
    } catch (err) {
      setDataSourceState(previous);
      setError(err instanceof Error ? err.message : "Could not save settings");
    } finally {
      setSaving(false);
    }
  };

  const value: DataSourceContextValue = {
    dataSource,
    mockEnabled: dataSource === "mock",
    revision,
    saving,
    error,
    setDataSource,
    toggleMock: () => setDataSource(dataSource === "mock" ? "live" : "mock")
  };

  return <DataSourceContext.Provider value={value}>{children}</DataSourceContext.Provider>;
}

export function useWorkspaceDataSource(): DataSourceContextValue {
  const value = useContext(DataSourceContext);
  if (!value) {
    throw new Error("useWorkspaceDataSource must be used within DataSourceProvider");
  }
  return value;
}
