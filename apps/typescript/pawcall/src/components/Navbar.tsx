import React from 'react';
import { History, HelpCircle, MapPin } from 'lucide-react';
import { TabType } from '../types';

interface NavbarProps {
  activeTab: TabType;
  onSelectTab: (tab: TabType) => void;
  isEmergencyActive?: boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  onSelectTab,
  isEmergencyActive = false,
}) => {
  return (
    <header className="w-full bg-[#FAF6F0]/95 backdrop-blur-md border-b border-[#D8C9B9] sticky top-0 z-30 transition-all shadow-2xs">
      <div className="max-w-4xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
        {/* Brand Logo & Title */}
        <div
          id="brand-logo-button"
          onClick={() => onSelectTab('sos')}
          className="flex items-center gap-2.5 cursor-pointer group select-none"
        >
          <div className="w-9 h-9 rounded-xl bg-[#B83A20] flex items-center justify-center text-white shadow-xs group-hover:bg-[#A13018] transition-colors">
            {/* Animal Paw Emblem */}
            <svg
              viewBox="0 0 24 24"
              fill="currentColor"
              className="w-5 h-5"
            >
              <path d="M12 11c1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3 1.34 3 3 3zm-5.5 1c1.38 0 2.5-1.12 2.5-2.5S7.88 7 6.5 7 4 8.12 4 9.5 5.12 12 6.5 12zm11 0c1.38 0 2.5-1.12 2.5-2.5S18.88 7 17.5 7 15 8.12 15 9.5s1.12 2.5 2.5 2.5zM12 13.5c-2.76 0-5.5 1.54-5.5 3.85 0 1.95 2.46 3.65 5.5 3.65s5.5-1.7 5.5-3.65c0-2.31-2.74-3.85-5.5-3.85z" />
            </svg>
          </div>
          <div className="flex flex-col">
            <div className="flex items-center gap-1.5">
              <span className="font-extrabold text-[#1A1412] tracking-tight text-lg leading-none">PawCall</span>
              <span className="text-[10px] uppercase font-black tracking-wider px-1.5 py-0.5 rounded bg-[#F7EAE6] text-[#B83A20] border border-[#EACEC5]">
                DISPATCH AI
              </span>
            </div>
            <span className="text-xs text-[#52443A] font-semibold hidden sm:inline leading-tight">
              Emergency Rescue Network
            </span>
          </div>
        </div>

        {/* High-Contrast GPS Indicator */}
        <div className="hidden sm:flex items-center gap-1.5 text-xs text-[#1E4334] bg-[#E5F3EB] px-3 py-1 rounded-full border border-[#BBDCCB] font-bold">
          <span className="relative flex h-2 w-2">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[#2B5442] opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2 w-2 bg-[#2B5442]"></span>
          </span>
          <MapPin className="w-3.5 h-3.5 text-[#2B5442]" />
          <span>GPS Active: Sector 62, Noida</span>
        </div>

        {/* Clean Standardized Navigation */}
        <nav className="flex items-center gap-1 sm:gap-2">
          <button
            id="nav-history-tab"
            onClick={() => onSelectTab('history')}
            className={`px-3 py-1.5 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'history'
                ? 'bg-[#1A1412] text-white shadow-xs'
                : 'text-[#3E342D] hover:text-[#1A1412] hover:bg-[#EAE0D3]'
            }`}
          >
            <History className="w-4 h-4" />
            <span>Rescue Logs</span>
          </button>

          <button
            id="nav-about-tab"
            onClick={() => onSelectTab('about')}
            className={`px-3 py-1.5 rounded-xl text-xs sm:text-sm font-bold transition-all flex items-center gap-1.5 cursor-pointer ${
              activeTab === 'about'
                ? 'bg-[#1A1412] text-white shadow-xs'
                : 'text-[#3E342D] hover:text-[#1A1412] hover:bg-[#EAE0D3]'
            }`}
            title="How PawCall Works"
          >
            <HelpCircle className="w-4 h-4" />
            <span>About & Stories</span>
          </button>
        </nav>
      </div>
    </header>
  );
};

