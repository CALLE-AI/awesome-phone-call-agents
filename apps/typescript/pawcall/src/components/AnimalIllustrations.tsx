import React from 'react';

export const RescuedDogIllustration: React.FC<{ className?: string }> = ({ className = 'w-16 h-16' }) => (
  <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <circle cx="60" cy="60" r="54" fill="#F4EDE4" stroke="#E2D4C3" strokeWidth="2" />
    {/* Body */}
    <ellipse cx="60" cy="85" rx="28" ry="24" fill="#C89666" />
    {/* Chest patch */}
    <ellipse cx="60" cy="86" rx="14" ry="16" fill="#FBF6EE" />
    {/* Head */}
    <circle cx="60" cy="50" r="24" fill="#C89666" />
    {/* Ears */}
    <ellipse cx="38" cy="46" rx="8" ry="18" fill="#9F6838" transform="rotate(-15 38 46)" />
    <ellipse cx="82" cy="46" rx="8" ry="18" fill="#9F6838" transform="rotate(15 82 46)" />
    {/* Snout */}
    <ellipse cx="60" cy="56" rx="12" ry="10" fill="#FBF6EE" />
    {/* Nose */}
    <ellipse cx="60" cy="52" rx="4.5" ry="3" fill="#3D291D" />
    {/* Eyes */}
    <circle cx="51" cy="44" r="2.5" fill="#3D291D" />
    <circle cx="69" cy="44" r="2.5" fill="#3D291D" />
    <circle cx="52" cy="43" r="0.8" fill="#FFFFFF" />
    <circle cx="70" cy="43" r="0.8" fill="#FFFFFF" />
    {/* Smile */}
    <path d="M57 58 Q60 61 63 58" stroke="#3D291D" strokeWidth="1.5" strokeLinecap="round" />
    {/* Rescue Bandage / Scarf */}
    <path d="M44 68 C52 73, 68 73, 76 68 L78 74 C68 80, 52 80, 42 74 Z" fill="#DC2626" />
    <path d="M60 70 L60 76 M57 73 L63 73" stroke="#FFFFFF" strokeWidth="1.5" strokeLinecap="round" />
  </svg>
);

export const RescuedCatIllustration: React.FC<{ className?: string }> = ({ className = 'w-16 h-16' }) => (
  <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <circle cx="60" cy="60" r="54" fill="#EEF2F6" stroke="#D8E2EC" strokeWidth="2" />
    {/* Body */}
    <ellipse cx="60" cy="85" rx="26" ry="22" fill="#7C8BA1" />
    <ellipse cx="60" cy="86" rx="12" ry="15" fill="#F4F7FB" />
    {/* Head */}
    <circle cx="60" cy="52" r="22" fill="#7C8BA1" />
    {/* Ears */}
    <polygon points="40,46 46,26 56,40" fill="#7C8BA1" />
    <polygon points="43,44 47,30 54,39" fill="#F4B8B8" />
    <polygon points="80,46 74,26 64,40" fill="#7C8BA1" />
    <polygon points="77,44 73,30 66,39" fill="#F4B8B8" />
    {/* Eyes */}
    <ellipse cx="51" cy="50" rx="3.5" ry="4" fill="#047857" />
    <ellipse cx="69" cy="50" rx="3.5" ry="4" fill="#047857" />
    <circle cx="51" cy="50" r="1.5" fill="#1E293B" />
    <circle cx="69" cy="50" r="1.5" fill="#1E293B" />
    <circle cx="52" cy="49" r="0.6" fill="#FFFFFF" />
    <circle cx="70" cy="49" r="0.6" fill="#FFFFFF" />
    {/* Nose & Mouth */}
    <polygon points="58,56 62,56 60,59" fill="#F4B8B8" />
    <path d="M57 61 Q60 63 63 61" stroke="#334155" strokeWidth="1.2" strokeLinecap="round" />
    {/* Whiskers */}
    <line x1="42" y1="56" x2="32" y2="54" stroke="#CBD5E1" strokeWidth="1.2" />
    <line x1="42" y1="59" x2="33" y2="60" stroke="#CBD5E1" strokeWidth="1.2" />
    <line x1="78" y1="56" x2="88" y2="54" stroke="#CBD5E1" strokeWidth="1.2" />
    <line x1="78" y1="59" x2="87" y2="60" stroke="#CBD5E1" strokeWidth="1.2" />
    {/* Heart Badge */}
    <circle cx="60" cy="74" r="7" fill="#E11D48" />
    <path d="M60 76 L57 73 C55 71 58 69 60 71 C62 69 65 71 63 73 Z" fill="#FFFFFF" />
  </svg>
);

export const RescuedBirdIllustration: React.FC<{ className?: string }> = ({ className = 'w-16 h-16' }) => (
  <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <circle cx="60" cy="60" r="54" fill="#F0F7F4" stroke="#D3E8DF" strokeWidth="2" />
    {/* Body */}
    <ellipse cx="58" cy="66" rx="24" ry="20" fill="#0D9488" />
    <ellipse cx="64" cy="70" rx="14" ry="12" fill="#99F6E4" />
    {/* Wing */}
    <path d="M42 60 C38 72, 48 84, 66 78 C52 82, 44 70, 48 60 Z" fill="#0F766E" />
    {/* Head */}
    <circle cx="76" cy="46" r="16" fill="#0D9488" />
    {/* Eye */}
    <circle cx="78" cy="44" r="3" fill="#134E4A" />
    <circle cx="79" cy="43" r="1" fill="#FFFFFF" />
    {/* Beak */}
    <polygon points="88,44 100,48 88,52" fill="#F59E0B" />
    {/* Tail Feathers */}
    <path d="M36 68 L24 74 L34 78 Z" fill="#115E59" />
    {/* Olive / Caring Branch */}
    <path d="M84 76 Q92 70 100 74" stroke="#15803D" strokeWidth="2" strokeLinecap="round" />
    <circle cx="92" cy="70" r="2.5" fill="#22C55E" />
    <circle cx="98" cy="73" r="2.5" fill="#22C55E" />
  </svg>
);

export const RescuedCalfIllustration: React.FC<{ className?: string }> = ({ className = 'w-16 h-16' }) => (
  <svg viewBox="0 0 120 120" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    <circle cx="60" cy="60" r="54" fill="#FAF6EE" stroke="#E8DFCE" strokeWidth="2" />
    {/* Body */}
    <ellipse cx="60" cy="82" rx="30" ry="24" fill="#574235" />
    <ellipse cx="60" cy="84" rx="14" ry="18" fill="#FDFBF7" />
    {/* Head */}
    <ellipse cx="60" cy="50" rx="22" ry="20" fill="#574235" />
    {/* Forehead Patch */}
    <path d="M54 36 C58 32, 62 32, 66 36 L64 48 C61 50, 59 50, 56 48 Z" fill="#FDFBF7" />
    {/* Ears */}
    <ellipse cx="36" cy="46" rx="12" ry="7" fill="#574235" transform="rotate(-20 36 46)" />
    <ellipse cx="36" cy="46" rx="9" ry="4.5" fill="#F5D0C5" transform="rotate(-20 36 46)" />
    <ellipse cx="84" cy="46" rx="12" ry="7" fill="#574235" transform="rotate(20 84 46)" />
    <ellipse cx="84" cy="46" rx="9" ry="4.5" fill="#F5D0C5" transform="rotate(20 84 46)" />
    {/* Little Horns */}
    <path d="M46 36 Q42 28 44 26 Q48 30 50 34 Z" fill="#D7C3B0" />
    <path d="M74 36 Q78 28 76 26 Q72 30 70 34 Z" fill="#D7C3B0" />
    {/* Big gentle eyes */}
    <ellipse cx="48" cy="47" rx="3.5" ry="4.5" fill="#241812" />
    <ellipse cx="72" cy="47" rx="3.5" ry="4.5" fill="#241812" />
    <circle cx="49" cy="45" r="1.2" fill="#FFFFFF" />
    <circle cx="73" cy="45" r="1.2" fill="#FFFFFF" />
    {/* Muzzle */}
    <ellipse cx="60" cy="61" rx="15" ry="11" fill="#F5D0C5" />
    <ellipse cx="54" cy="60" rx="2.5" ry="2" fill="#574235" />
    <ellipse cx="66" cy="60" rx="2.5" ry="2" fill="#574235" />
    <path d="M57 66 Q60 68 63 66" stroke="#574235" strokeWidth="1.2" strokeLinecap="round" />
  </svg>
);

export const CaringHandsIllustration: React.FC<{ className?: string }> = ({ className = 'w-full h-auto' }) => (
  <svg viewBox="0 0 360 160" fill="none" xmlns="http://www.w3.org/2000/svg" className={className}>
    {/* Soft subtle warm background shape */}
    <rect width="360" height="160" rx="16" fill="#FBF8F3" />
    <circle cx="180" cy="80" r="65" fill="#F3ECE0" opacity="0.6" />
    
    {/* Left Gentle Hand */}
    <path
      d="M60 120 C90 125, 125 110, 145 85 C150 78, 145 70, 135 72 C125 74, 115 80, 100 85 C85 90, 70 95, 55 105 Z"
      fill="#D4A373"
      opacity="0.9"
    />
    
    {/* Right Gentle Hand */}
    <path
      d="M300 120 C270 125, 235 110, 215 85 C210 78, 215 70, 225 72 C235 74, 245 80, 260 85 C275 90, 290 95, 305 105 Z"
      fill="#D4A373"
      opacity="0.9"
    />
    
    {/* Central Rescued Animal Duo: Dog and Cat sitting peacefully */}
    {/* Dog Silhouette */}
    <path
      d="M155 95 C155 75, 165 65, 172 50 C175 44, 168 38, 162 42 C158 45, 155 52, 155 55 C150 55, 145 65, 145 78 C145 92, 150 96, 155 95 Z"
      fill="#8C6239"
    />
    {/* Cat Silhouette */}
    <path
      d="M195 95 C195 80, 188 70, 184 56 C182 52, 188 48, 192 50 C195 52, 196 58, 198 62 C204 68, 206 78, 206 88 C206 94, 200 96, 195 95 Z"
      fill="#64748B"
    />
    {/* Heart Above */}
    <path
      d="M180 38 C176 30, 166 32, 166 40 C166 48, 180 56, 180 56 C180 56, 194 48, 194 40 C194 32, 184 30, 180 38 Z"
      fill="#DC2626"
    />
    
    {/* Subtle Leaves / Nature */}
    <path d="M120 45 Q125 35 135 38 Q130 48 120 45 Z" fill="#16A34A" opacity="0.8" />
    <path d="M240 45 Q235 35 225 38 Q230 48 240 45 Z" fill="#16A34A" opacity="0.8" />
  </svg>
);
