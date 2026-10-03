import React from 'react';

export function Card({ children, className = '', variant = 'standard' }: { children: React.ReactNode; className?: string; variant?: 'standard' | 'alert' | 'system' }) {
  const variants = {
    standard: 'bg-white border border-gray-200 rounded-lg p-6 shadow-sm',
    alert: 'bg-yellow-50 border border-dashed border-yellow-400 rounded-lg p-6',
    system: 'bg-gray-100 rounded-lg p-6',
  };

  return (
    <div className={`${variants[variant]} ${className}`}>
      {children}
    </div>
  );
}
