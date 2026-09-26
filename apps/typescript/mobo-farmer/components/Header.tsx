"use client";

import Image from 'next/image';
import Link from 'next/link';
import { useState } from 'react';
import { MapPin, ChevronDown, CloudSun, CloudRain, Bell, Menu, X } from 'lucide-react';

export default function Header() {
  const [isMenuOpen, setIsMenuOpen] = useState(false);

  return (
    <>
      <header className="flex items-center justify-between py-5 px-6 md:px-8 bg-transparent relative z-20">
        {/* Logo Area */}
        <div className="flex items-center gap-3">
          <button 
            className="md:hidden p-2 -ml-2 text-white"
            onClick={() => setIsMenuOpen(!isMenuOpen)}
          >
            {isMenuOpen ? <X size={24} /> : <Menu size={24} />}
          </button>
          
          <div className="w-10 h-10 bg-[#FFFBF8] rounded-xl flex items-center justify-center border border-white/20 shadow-sm overflow-hidden flex-shrink-0">
            <Image src="/mobo_farmer_v3_transparent.png" alt="MoboFarmer Logo" width={32} height={32} className="object-cover p-0.5" />
          </div>
          
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-bold text-white tracking-wide uppercase">Mobo Farmer</h1>
            <span className="bg-[#FDF2D5] text-[#6B4D0F] text-[10px] font-bold px-2 py-0.5 rounded-sm uppercase tracking-wider">
              BETA
            </span>
          </div>
        </div>

        <div className="hidden md:flex items-center bg-white/5 backdrop-blur-md rounded-full border border-white/10 p-1">
          <Link href="/" className="px-5 py-1.5 text-sm font-medium text-[#1E2320] bg-white rounded-full shadow-sm transition-colors">
            Dashboard
          </Link>
          <Link href="/tasks" className="px-5 py-1.5 text-sm font-medium text-gray-300 hover:text-white transition-colors">
            Tasks
          </Link>
        </div>

        {/* Right Side Actions */}
        <div className="hidden md:flex items-center gap-4">
          <button className="flex items-center gap-2 bg-white/5 backdrop-blur-sm border border-white/10 px-4 py-2 rounded-full hover:bg-white/10 transition-colors">
            <MapPin size={16} className="text-[#10B981]" />
            <span className="text-sm font-medium text-white">Bothaville Farm <span className="text-gray-400 mx-1">•</span> <span className="text-gray-400">Free State</span></span>
            <ChevronDown size={14} className="text-gray-500 ml-1" />
          </button>
          
          <div className="flex items-center gap-3 border-l border-white/10 pl-4">
            <div className="flex items-center gap-1.5">
              <CloudSun size={18} className="text-gray-400" />
              <span className="text-sm font-bold text-white">28°C <span className="text-[10px] font-bold text-gray-400 ml-0.5">•</span> <span className="text-[13px] font-medium text-gray-400">Partly cloudy</span></span>
            </div>
            <div className="flex items-center gap-1.5 ml-2">
              <CloudRain size={18} className="text-gray-400" />
              <span className="text-[13px] font-medium text-gray-400">10% rain</span>
            </div>
          </div>
          
          <div className="flex items-center gap-4 border-l border-white/10 pl-4">
            <button className="relative text-gray-400 hover:text-white transition-colors">
              <Bell size={20} />
              <span className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-[#E07A5F] rounded-full border-2 border-[#1E2320]"></span>
            </button>
            <div className="w-9 h-9 rounded-full bg-[#1B4332] text-white flex items-center justify-center font-bold text-sm shadow-sm cursor-pointer border border-white/10">
              JD
            </div>
          </div>
        </div>
      </header>

      {/* Mobile Nav Menu overlay */}
      {isMenuOpen && (
        <div className="md:hidden absolute top-[73px] left-4 right-4 bg-[#1E2320]/95 backdrop-blur-xl border border-white/10 z-10 shadow-2xl rounded-2xl overflow-hidden">
          <nav className="flex flex-col p-4 gap-1">
            <Link href="/" onClick={() => setIsMenuOpen(false)} className="block px-4 py-3 text-white font-medium bg-white/10 rounded-xl">Dashboard</Link>
            <Link href="/agents" onClick={() => setIsMenuOpen(false)} className="block px-4 py-3 text-gray-300 font-medium hover:bg-white/5 rounded-xl">AI Agents</Link>
            <Link href="/crops" onClick={() => setIsMenuOpen(false)} className="block px-4 py-3 text-gray-300 font-medium hover:bg-white/5 rounded-xl">Crops</Link>
            <Link href="/water" onClick={() => setIsMenuOpen(false)} className="block px-4 py-3 text-gray-300 font-medium hover:bg-white/5 rounded-xl">Water</Link>
            <Link href="/transcripts" onClick={() => setIsMenuOpen(false)} className="block px-4 py-3 text-gray-300 font-medium hover:bg-white/5 rounded-xl">Transcripts</Link>
            
            <div className="h-px bg-white/10 my-3"></div>
            
            <button className="flex items-center justify-between px-4 py-3 hover:bg-white/5 rounded-xl transition-colors text-left">
              <div className="flex items-center gap-3">
                <MapPin size={18} className="text-[#10B981]" />
                <span className="text-sm font-medium text-white">Bothaville Farm <span className="text-gray-400 mx-1">•</span> <span className="text-gray-400 text-xs">Free State</span></span>
              </div>
              <ChevronDown size={16} className="text-gray-500" />
            </button>

            <div className="flex items-center justify-between px-4 py-3">
              <div className="flex items-center gap-2">
                <CloudSun size={18} className="text-gray-400" />
                <span className="text-sm font-bold text-white">28°C <span className="text-gray-400 text-xs font-medium ml-1">Partly cloudy</span></span>
              </div>
              <div className="flex items-center gap-2">
                <CloudRain size={18} className="text-gray-400" />
                <span className="text-xs font-medium text-gray-400">10% rain</span>
              </div>
            </div>

            <div className="h-px bg-white/10 my-3"></div>
            
            <div className="flex items-center justify-between px-4 py-2">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 rounded-full bg-[#1B4332] text-white flex items-center justify-center font-bold text-sm border border-white/10">
                  JD
                </div>
                <span className="text-sm font-medium text-white">Profile</span>
              </div>
              <button className="relative text-gray-400 hover:text-white transition-colors p-2.5 bg-white/5 rounded-full">
                <Bell size={18} />
                <span className="absolute top-2 right-2 w-2 h-2 bg-[#E07A5F] rounded-full border border-[#1E2320]"></span>
              </button>
            </div>
          </nav>
        </div>
      )}
    </>
  );
}
