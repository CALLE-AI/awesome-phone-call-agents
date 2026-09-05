import React from 'react';
import { motion } from 'motion/react';
import { ShieldAlert, Cross, Home, HeartHandshake, Trees, Truck } from 'lucide-react';
import { Responder } from '../types';

interface ResponderMarkerProps {
  responder: Responder;
  index: number;
}

export const ResponderMarker: React.FC<ResponderMarkerProps> = ({ responder }) => {
  // Compute polar coordinates to X, Y percentages on a circle
  const angleRad = ((responder.angle - 90) * Math.PI) / 180;
  const radius = responder.radiusPercent / 2; // radius is from center (0 to 50%)
  const x = 50 + radius * Math.cos(angleRad);
  const y = 50 + radius * Math.sin(angleRad);

  const getIcon = () => {
    switch (responder.avatarIcon) {
      case 'Cross':
        return <Cross className="w-3.5 h-3.5 text-red-600" />;
      case 'Home':
        return <Home className="w-3.5 h-3.5 text-amber-700" />;
      case 'HeartHandshake':
        return <HeartHandshake className="w-3.5 h-3.5 text-emerald-700" />;
      case 'Trees':
        return <Trees className="w-3.5 h-3.5 text-teal-700" />;
      case 'Truck':
        return <Truck className="w-3.5 h-3.5 text-amber-800" />;
      case 'ShieldAlert':
      default:
        return <ShieldAlert className="w-3.5 h-3.5 text-red-700" />;
    }
  };

  return (
    <motion.div
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ type: 'spring', damping: 15, stiffness: 200 }}
      style={{
        left: `${x}%`,
        top: `${y}%`,
        transform: 'translate(-50%, -50%)',
      }}
      className="absolute z-20 group cursor-pointer"
    >
      {/* Marker Pin */}
      <div className="relative w-8 h-8 sm:w-8.5 sm:h-8.5 rounded-full bg-stone-100 border-2 border-stone-300 shadow-md flex items-center justify-center group-hover:scale-110 transition-transform">
        {getIcon()}
      </div>

      {/* Responder Floating Tooltip / Label */}
      <div className="absolute left-1/2 -bottom-7 -translate-x-1/2 whitespace-nowrap bg-stone-900 text-stone-100 text-[10px] font-medium px-2 py-0.5 rounded-md shadow-md border border-stone-700 pointer-events-none opacity-90 group-hover:opacity-100 transition-opacity flex items-center gap-1">
        <span className="max-w-[90px] truncate">{responder.name}</span>
        <span className="text-emerald-400 font-bold">({responder.distanceKm}km)</span>
      </div>
    </motion.div>
  );
};
