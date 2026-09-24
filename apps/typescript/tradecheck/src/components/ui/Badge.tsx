import React from 'react';

type BadgeVariant = 'verified' | 'discrepancy' | 'unverified';

export function Badge({ variant, children, className = '' }: { variant: BadgeVariant; children: React.ReactNode; className?: string }) {
  const variants = {
    verified: 'bg-green-100 text-green-800 border-green-200',
    discrepancy: 'bg-yellow-100 text-yellow-800 border-yellow-200',
    unverified: 'bg-gray-100 text-gray-800 border-gray-200',
  };

  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border ${variants[variant]} ${className}`}>
      {children}
    </span>
  );
}
