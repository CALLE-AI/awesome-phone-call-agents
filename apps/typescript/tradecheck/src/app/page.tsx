import { Workspace } from "@/components/Workspace";

export default function Home() {
  return (
    <div className="flex flex-col h-screen bg-app-bg">
      {/* Top Navigation */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-gray-200 bg-white">
        <div className="flex items-center gap-4">
          <div className="font-bold text-success-color text-xl tracking-tight">TradeCheck</div>
          <div className="text-secondary-text text-sm hidden md:block">/ AI Copilot Verification</div>
        </div>
      </header>

      {/* Main Workspace */}
      <Workspace />
    </div>
  );
}
