import React from 'react';
import { motion } from 'motion/react';

export const LeftLineArtFlank: React.FC = () => {
  return (
    <aside
      aria-label="Decorative Left Animal Rescue Line Art"
      className="hidden lg:flex flex-col items-center justify-between w-64 xl:w-72 2xl:w-80 py-8 px-4 select-none pointer-events-none sticky top-20 h-[calc(100vh-6rem)] shrink-0 overflow-hidden"
    >
      {/* Top Section: Stethoscope & Heart Paw Line Art */}
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8 }}
        className="w-full flex flex-col items-center opacity-85"
      >
        <svg
          viewBox="0 0 240 180"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full max-w-[200px] xl:max-w-[220px] text-[#A68A72]"
        >
          {/* Decorative Framing Arch */}
          <path
            d="M20 160 C20 40, 220 40, 220 160"
            stroke="#D6C4B0"
            strokeWidth="1.2"
            strokeDasharray="4 4"
          />
          {/* Stethoscope Contour Line */}
          <path
            d="M50 140 C50 60, 90 30, 120 30 C150 30, 190 60, 190 140 M50 130 C45 130, 40 135, 40 142 C40 150, 55 150, 55 142 Z M190 130 C185 130, 180 135, 180 142 C180 150, 195 150, 195 142 Z"
            stroke="#9E7F66"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          <path
            d="M120 30 L120 90 C120 115, 150 115, 150 135 L150 145"
            stroke="#9E7F66"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          {/* Stethoscope Sensor Circle */}
          <circle cx="150" cy="152" r="10" stroke="#9E7F66" strokeWidth="1.8" fill="#F4EFEA" />
          <circle cx="150" cy="152" r="4" fill="#B84227" opacity="0.8" />

          {/* Central Heartbeat with Paw in Center */}
          <path
            d="M70 95 L95 95 L102 75 L112 110 L122 85 L130 100 L136 95 L170 95"
            stroke="#B84227"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Subtle Paw In Lifeline */}
          <circle cx="120" cy="62" r="4" fill="#B84227" />
          <circle cx="111" cy="54" r="2.2" fill="#9E7F66" />
          <circle cx="117" cy="49" r="2.2" fill="#9E7F66" />
          <circle cx="124" cy="49" r="2.2" fill="#9E7F66" />
          <circle cx="129" cy="54" r="2.2" fill="#9E7F66" />
        </svg>

        <span className="text-[10px] uppercase font-bold tracking-widest text-[#968270] mt-1">
          Veterinary Lifeline
        </span>
      </motion.div>

      {/* Middle Section: Majestic Rescued Dog & Fawn Line Art */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.9, delay: 0.2 }}
        className="w-full flex flex-col items-center my-auto py-2 opacity-90"
      >
        <svg
          viewBox="0 0 240 280"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full max-w-[210px] xl:max-w-[240px]"
        >
          {/* Background Soft Sun Ring */}
          <circle cx="120" cy="130" r="85" stroke="#E2D4C3" strokeWidth="1" strokeDasharray="3 3" />
          <circle cx="120" cy="130" r="55" fill="#EFE8DE" opacity="0.4" />

          {/* Continuous Line Drawing: Gentle Sitting Dog Profile */}
          <path
            d="M80 230 C80 215, 75 190, 85 170 C90 160, 95 150, 95 130 C95 110, 90 100, 95 85 C98 75, 105 60, 120 60 C132 60, 142 68, 146 78 C155 78, 168 84, 172 96 C175 106, 170 114, 162 118 C160 128, 166 142, 168 160 C172 190, 175 220, 175 230"
            stroke="#7A5E48"
            strokeWidth="2"
            strokeLinecap="round"
          />

          {/* Snout & Nose & Smile */}
          <path
            d="M146 78 C155 78, 170 82, 174 88 C176 92, 172 98, 160 100"
            stroke="#7A5E48"
            strokeWidth="2"
            strokeLinecap="round"
          />
          <circle cx="172" cy="88" r="3.5" fill="#7A5E48" />
          {/* Eye */}
          <path
            d="M138 78 Q142 75 145 78"
            stroke="#7A5E48"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <circle cx="142" cy="79" r="1.5" fill="#7A5E48" />

          {/* Floppy Ear Contour */}
          <path
            d="M122 68 C115 78, 110 95, 112 110 C114 118, 122 120, 125 112 C128 102, 126 80, 126 70"
            stroke="#7A5E48"
            strokeWidth="1.8"
            strokeLinecap="round"
          />

          {/* Collar with Rescue Medallion */}
          <path
            d="M102 140 C115 146, 145 146, 158 140"
            stroke="#B84227"
            strokeWidth="2.2"
            strokeLinecap="round"
          />
          <circle cx="130" cy="152" r="5" stroke="#B84227" strokeWidth="1.5" fill="#FAF6F0" />
          {/* Medical Cross on Medallion */}
          <path d="M130 149 L130 155 M127 152 L133 152" stroke="#B84227" strokeWidth="1.2" />

          {/* Front Paws Line Contour */}
          <path
            d="M125 160 L120 230 M140 160 L145 230 M112 230 C112 225, 155 225, 155 230"
            stroke="#7A5E48"
            strokeWidth="1.8"
            strokeLinecap="round"
          />

          {/* Botanical Laurel Sprig on the side */}
          <path
            d="M45 200 C50 160, 60 130, 75 105"
            stroke="#3B6652"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <ellipse cx="50" cy="180" rx="6" ry="3" fill="#3B6652" opacity="0.6" transform="rotate(-30 50 180)" />
          <ellipse cx="57" cy="155" rx="6" ry="3" fill="#3B6652" opacity="0.6" transform="rotate(-35 57 155)" />
          <ellipse cx="65" cy="130" rx="6" ry="3" fill="#3B6652" opacity="0.6" transform="rotate(-40 65 130)" />
          <ellipse cx="74" cy="110" rx="5" ry="2.5" fill="#3B6652" opacity="0.6" transform="rotate(-45 74 110)" />

          {/* Paw Prints ascending gracefully */}
          <g opacity="0.5" transform="translate(180, 160) scale(0.6)">
            <circle cx="20" cy="20" r="7" fill="#9E7F66" />
            <circle cx="10" cy="8" r="3.5" fill="#9E7F66" />
            <circle cx="18" cy="3" r="3.5" fill="#9E7F66" />
            <circle cx="27" cy="5" r="3.5" fill="#9E7F66" />
            <circle cx="32" cy="13" r="3.5" fill="#9E7F66" />
          </g>

          <g opacity="0.35" transform="translate(195, 105) scale(0.45)">
            <circle cx="20" cy="20" r="7" fill="#9E7F66" />
            <circle cx="10" cy="8" r="3.5" fill="#9E7F66" />
            <circle cx="18" cy="3" r="3.5" fill="#9E7F66" />
            <circle cx="27" cy="5" r="3.5" fill="#9E7F66" />
            <circle cx="32" cy="13" r="3.5" fill="#9E7F66" />
          </g>
        </svg>

        <div className="text-center mt-1">
          <span className="text-xs font-serif italic text-[#7A614D] block">
            "Compassion in Every Call"
          </span>
          <span className="text-[10px] font-bold tracking-wider text-[#A18A76] uppercase">
            24/7 Verified Dispatch
          </span>
        </div>
      </motion.div>

      {/* Bottom Section: Soaring Rescue Bird Line Art */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.3 }}
        className="w-full flex flex-col items-center opacity-85"
      >
        <svg
          viewBox="0 0 200 110"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full max-w-[170px] xl:max-w-[190px]"
        >
          {/* Bird in flight single line */}
          <path
            d="M30 60 C55 30, 85 45, 100 55 C115 40, 150 20, 175 45 C155 55, 130 65, 115 65 C105 75, 95 90, 85 90 C80 90, 85 75, 75 70 C55 70, 40 65, 30 60 Z"
            stroke="#2B5442"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          {/* Olive Leaf in Beak */}
          <path
            d="M175 45 Q190 42 195 48"
            stroke="#3B6652"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <ellipse cx="190" cy="42" rx="4" ry="2" fill="#2B5442" transform="rotate(-15 190 42)" />
        </svg>
        <span className="text-[10px] uppercase font-bold tracking-widest text-[#8C7A68]">
          Wildlife Protection
        </span>
      </motion.div>
    </aside>
  );
};

export const RightLineArtFlank: React.FC = () => {
  return (
    <aside
      aria-label="Decorative Right Animal Rescue Line Art"
      className="hidden lg:flex flex-col items-center justify-between w-64 xl:w-72 2xl:w-80 py-8 px-4 select-none pointer-events-none sticky top-20 h-[calc(100vh-6rem)] shrink-0 overflow-hidden"
    >
      {/* Top Section: Open Caring Hands Supporting Heart Line Art */}
      <motion.div
        initial={{ opacity: 0, x: 20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.8 }}
        className="w-full flex flex-col items-center opacity-85"
      >
        <svg
          viewBox="0 0 240 180"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full max-w-[200px] xl:max-w-[220px]"
        >
          {/* Outer gentle guide ring */}
          <path
            d="M20 160 C20 40, 220 40, 220 160"
            stroke="#D6C4B0"
            strokeWidth="1.2"
            strokeDasharray="4 4"
          />
          {/* Caring Hands Outline */}
          {/* Left Hand */}
          <path
            d="M40 150 C65 145, 95 130, 110 110 C114 104, 110 98, 104 100 C96 102, 88 108, 75 112 C60 118, 50 125, 38 135"
            stroke="#7A5E48"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          {/* Right Hand */}
          <path
            d="M200 150 C175 145, 145 130, 130 110 C126 104, 130 98, 136 100 C144 102, 152 108, 165 112 C180 118, 190 125, 202 135"
            stroke="#7A5E48"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          {/* Floating Heart between Hands */}
          <path
            d="M120 70 C112 55, 95 60, 95 75 C95 92, 120 108, 120 108 C120 108, 145 92, 145 75 C145 60, 128 55, 120 70 Z"
            stroke="#B84227"
            strokeWidth="2"
            fill="#B84227"
            fillOpacity="0.12"
            strokeLinejoin="round"
          />
          {/* Cross inside Heart */}
          <path d="M120 74 L120 86 M114 80 L126 80" stroke="#B84227" strokeWidth="1.8" strokeLinecap="round" />
        </svg>

        <span className="text-[10px] uppercase font-bold tracking-widest text-[#968270] mt-1">
          Community First Responders
        </span>
      </motion.div>

      {/* Middle Section: Graceful Rescued Cat & Calf Line Art */}
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ duration: 0.9, delay: 0.2 }}
        className="w-full flex flex-col items-center my-auto py-2 opacity-90"
      >
        <svg
          viewBox="0 0 240 280"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full max-w-[210px] xl:max-w-[240px]"
        >
          {/* Background Geometry */}
          <circle cx="120" cy="130" r="85" stroke="#E2D4C3" strokeWidth="1" strokeDasharray="3 3" />
          <circle cx="120" cy="130" r="55" fill="#EFE8DE" opacity="0.4" />

          {/* Continuous Line Drawing: Sitting Cat Silhouette */}
          <path
            d="M140 230 C155 225, 165 210, 165 190 C165 165, 155 150, 150 135 C146 125, 148 115, 152 100 C155 90, 150 75, 140 68 C135 65, 128 68, 120 75 C112 68, 105 65, 100 68 C90 75, 85 90, 88 100 C92 115, 94 125, 90 135 C85 150, 75 165, 75 190 C75 210, 85 225, 100 230"
            stroke="#5C5449"
            strokeWidth="2"
            strokeLinecap="round"
          />

          {/* Pointed Cat Ears */}
          <path
            d="M100 70 L92 48 L110 64 M140 70 L148 48 L130 64"
            stroke="#5C5449"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          />

          {/* Cat Whiskers & Muzzle */}
          <path
            d="M116 88 L120 92 L124 88 M120 92 L120 96"
            stroke="#5C5449"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          {/* Whiskers */}
          <path d="M106 90 L85 88 M106 94 L85 96 M134 90 L155 88 M134 94 L155 96" stroke="#8C7A68" strokeWidth="1.2" />

          {/* Cat Eyes */}
          <ellipse cx="108" cy="80" rx="3" ry="4" fill="#3B6652" />
          <ellipse cx="132" cy="80" rx="3" ry="4" fill="#3B6652" />
          <circle cx="108" cy="80" r="1.5" fill="#241E19" />
          <circle cx="132" cy="80" r="1.5" fill="#241E19" />

          {/* Graceful Curled Cat Tail */}
          <path
            d="M165 210 C180 215, 195 200, 195 185 C195 170, 185 165, 175 175"
            stroke="#5C5449"
            strokeWidth="2"
            strokeLinecap="round"
          />

          {/* Botanical Sprig on Right Side */}
          <path
            d="M195 200 C190 160, 180 130, 165 105"
            stroke="#3B6652"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
          <ellipse cx="190" cy="180" rx="6" ry="3" fill="#3B6652" opacity="0.6" transform="rotate(30 190 180)" />
          <ellipse cx="183" cy="155" rx="6" ry="3" fill="#3B6652" opacity="0.6" transform="rotate(35 183 155)" />
          <ellipse cx="175" cy="130" rx="6" ry="3" fill="#3B6652" opacity="0.6" transform="rotate(40 175 130)" />
          <ellipse cx="166" cy="110" rx="5" ry="2.5" fill="#3B6652" opacity="0.6" transform="rotate(45 166 110)" />

          {/* Gentle Stars / Sparkles */}
          <g opacity="0.6">
            <path d="M60 90 L60 102 M54 96 L66 96" stroke="#D9822B" strokeWidth="1.4" strokeLinecap="round" />
            <path d="M190 70 L190 80 M185 75 L195 75" stroke="#D9822B" strokeWidth="1.4" strokeLinecap="round" />
          </g>
        </svg>

        <div className="text-center mt-1">
          <span className="text-xs font-serif italic text-[#7A614D] block">
            "Shelter, Care & Healing"
          </span>
          <span className="text-[10px] font-bold tracking-wider text-[#A18A76] uppercase">
            Every Life Valued
          </span>
        </div>
      </motion.div>

      {/* Bottom Section: Gentle Calf / Livestock Line Art */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.3 }}
        className="w-full flex flex-col items-center opacity-85"
      >
        <svg
          viewBox="0 0 200 110"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="w-full max-w-[170px] xl:max-w-[190px]"
        >
          {/* Gentle Calf outline */}
          <path
            d="M50 85 C55 60, 70 50, 90 50 C110 50, 125 60, 130 85"
            stroke="#7A5E48"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
          {/* Head & Big Ears */}
          <ellipse cx="90" cy="45" rx="18" ry="16" stroke="#7A5E48" strokeWidth="1.8" />
          <ellipse cx="70" cy="40" rx="10" ry="5" stroke="#7A5E48" strokeWidth="1.5" transform="rotate(-20 70 40)" />
          <ellipse cx="110" cy="40" rx="10" ry="5" stroke="#7A5E48" strokeWidth="1.5" transform="rotate(20 110 40)" />
          <circle cx="82" cy="42" r="2" fill="#7A5E48" />
          <circle cx="98" cy="42" r="2" fill="#7A5E48" />
          {/* Muzzle */}
          <ellipse cx="90" cy="53" rx="10" ry="6" stroke="#B88A72" strokeWidth="1.4" fill="#F4EFEA" />
        </svg>
        <span className="text-[10px] uppercase font-bold tracking-widest text-[#8C7A68]">
          Farm & Sanctuary Care
        </span>
      </motion.div>
    </aside>
  );
};
