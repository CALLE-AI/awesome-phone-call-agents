"use client";

import CallHistory from "@/components/CallHistory";

export default function TranscriptsPage() {
  return (
    <main className="max-w-[1440px] w-full mx-auto p-4 md:p-6 flex flex-col flex-1 h-[calc(100dvh-80px)] min-h-0">
      <CallHistory />
    </main>
  );
}
