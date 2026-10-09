import React from 'react';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'dashed';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  children: React.ReactNode;
}

export function Button({ variant = 'primary', children, className = '', ...props }: ButtonProps) {
  const baseClasses = 'px-4 py-2 font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed';
  
  const variants = {
    primary: 'bg-black text-white rounded-full hover:bg-gray-800 focus:ring-gray-900',
    secondary: 'bg-transparent text-gray-400 hover:text-gray-600 rounded-md',
    ghost: 'bg-white border border-gray-200 text-gray-900 rounded-md hover:bg-gray-50 flex items-center gap-2',
    dashed: 'bg-transparent border border-dashed border-gray-300 text-gray-900 rounded-md hover:bg-gray-50 flex items-center justify-center gap-2',
  };

  return (
    <button className={`${baseClasses} ${variants[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}
