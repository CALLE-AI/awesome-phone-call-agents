import React from 'react';
import { Card } from './Card';
import { Badge } from './Badge';
import { GSTINResult } from '@/lib/gstin';

export function DocumentaryCheckPanel({ data, loading }: { data?: GSTINResult | null, loading?: boolean }) {
  if (loading) {
    return (
      <Card variant="standard" className="flex flex-col items-center justify-center p-8 h-48">
        <div className="w-6 h-6 border-2 border-gray-400 border-t-black rounded-full animate-spin mb-4" />
        <span className="text-secondary-text text-sm">Querying Registry...</span>
      </Card>
    );
  }

  if (!data) {
    return null;
  }

  return (
    <Card variant="standard" className="flex flex-col gap-4">
      <div className="flex justify-between items-start">
        <h3 className="text-lg font-bold text-primary-text">Documentary Check</h3>
        <Badge variant={data.isVerified ? 'verified' : 'discrepancy'}>
          {data.isVerified ? 'Verified' : 'Flagged'}
        </Badge>
      </div>

      <div className="grid grid-cols-2 gap-4 text-sm">
        <div>
          <span className="text-secondary-text block mb-1">Legal Name</span>
          <span className="text-primary-text font-medium">{data.legalName || 'N/A'}</span>
        </div>
        <div>
          <span className="text-secondary-text block mb-1">Status</span>
          <span className="text-primary-text font-medium">{data.status || 'N/A'}</span>
        </div>
        <div>
          <span className="text-secondary-text block mb-1">Registration Date</span>
          <span className="text-primary-text font-medium">{data.registrationDate || 'N/A'}</span>
        </div>
        <div>
          <span className="text-secondary-text block mb-1">State</span>
          <span className="text-primary-text font-medium">{data.state || 'N/A'}</span>
        </div>
      </div>
      
      <div className="mt-2 text-xs text-secondary-text border-t border-gray-100 pt-3 flex justify-between">
        <span>Source: {data.source === 'sandbox' ? 'Sandbox API' : data.source === 'gstinapi' ? 'GSTIN API.in' : 'Unknown'}</span>
        <span>ID: {data.pan}***</span>
      </div>
    </Card>
  );
}
