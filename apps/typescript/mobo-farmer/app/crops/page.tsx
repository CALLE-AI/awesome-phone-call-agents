"use client";

import { useState } from "react";
import CropInventory from "@/components/CropInventory";
import { AddCropModal } from "@/components/Modals";

export default function CropsPage() {
  const [isAddCropModalOpen, setIsAddCropModalOpen] = useState(false);

  return (
    <main className="max-w-[1440px] mx-auto p-4 md:p-6">
      <CropInventory />
      
      <AddCropModal 
        isOpen={isAddCropModalOpen} 
        onClose={() => setIsAddCropModalOpen(false)} 
      />
    </main>
  );
}
