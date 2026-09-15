'use client';

import React, { useState } from 'react';
import { VerificationRecord } from '@/lib/types';
import { PhoneCallSimulator } from './PhoneCallSimulator';
import { LivePhoneCallModal } from './LivePhoneCallModal';

interface InteractiveStudioProps {
  records: VerificationRecord[];
  onDispatch: (id: string, scenario?: string) => Promise<void>;
  onViewCertificate: (record: VerificationRecord) => void;
}

export const InteractiveVerificationStudio: React.FC<InteractiveStudioProps> = ({
  records: initialRecords,
  onDispatch,
  onViewCertificate,
}) => {
  const [records, setRecords] = useState<VerificationRecord[]>(initialRecords);
  const [selectedRecordId, setSelectedRecordId] = useState<string>(
    initialRecords.find((r) => r.id === 'VER-APEX-9942')?.id || initialRecords[0]?.id || ''
  );
  const [isLiveModalOpen, setIsLiveModalOpen] = useState(false);

  // Sync if props update
  React.useEffect(() => {
    setRecords(initialRecords);
  }, [initialRecords]);

  const activeRecord = records.find((r) => r.id === selectedRecordId) || records[0];

  if (!activeRecord) {
    return (
      <div className="p-12 text-center text-slate-500 font-mono">
        No verification records found. Click Seed Fixtures to load.
      </div>
    );
  }

  const handleCallSuccess = (updatedRecord: VerificationRecord) => {
    setRecords((prev) =>
      prev.map((r) => (r.id === updatedRecord.id ? updatedRecord : r))
    );
    setSelectedRecordId(updatedRecord.id);
  };

  return (
    <div className="w-full">
      <PhoneCallSimulator
        vendorName={activeRecord.vendor.name}
        targetPhone={activeRecord.airgapResult.targetDialNumber}
        officerName={activeRecord.vendor.authorizedOfficer.name}
        officerTitle={activeRecord.vendor.authorizedOfficer.title}
        challengeToken={activeRecord.airgapResult.challengeToken}
        expectedTaxId={activeRecord.vendor.taxEinLast4}
        transcript={activeRecord.transcript}
        disposition={activeRecord.status}
        records={records}
        selectedRecordId={activeRecord.id}
        onSelectRecord={(id) => setSelectedRecordId(id)}
        onViewCertificate={onViewCertificate}
        activeRecord={activeRecord}
        onOpenLiveCallModal={() => setIsLiveModalOpen(true)}
      />

      {/* Real Phone Call Dial Modal */}
      <LivePhoneCallModal
        isOpen={isLiveModalOpen}
        onClose={() => setIsLiveModalOpen(false)}
        onCallSuccess={handleCallSuccess}
        activeRecordId={activeRecord.id}
      />
    </div>
  );
};
