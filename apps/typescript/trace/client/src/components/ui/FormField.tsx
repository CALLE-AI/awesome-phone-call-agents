import React from 'react';

export interface FormFieldProps {
  label: string;
  id?: string;
  error?: string;
  hint?: string;
  required?: boolean;
  placeholder?: string;
  value?: string;
  onChange?: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void;
  children?: React.ReactNode;
  type?: string;
}

export const FormField: React.FC<FormFieldProps> = ({
  label,
  id,
  error,
  hint,
  required = false,
  placeholder,
  value,
  onChange,
  children,
  type = 'text',
}) => {
  const fieldId = id || label.toLowerCase().replace(/\s+/g, '-');

  return (
    <div className="space-y-1 w-full">
      <div className="flex items-center justify-between">
        <label htmlFor={fieldId} className="block text-xs font-semibold text-slate-700">
          {label}
          {required && <span className="text-red-500 ml-0.5">*</span>}
        </label>
        {hint && <span className="text-[10px] text-slate-400">{hint}</span>}
      </div>

      {children ? (
        <div className="relative rounded-lg shadow-xs">{children}</div>
      ) : (
        <input
          id={fieldId}
          type={type}
          value={value}
          onChange={onChange}
          placeholder={placeholder}
          className="w-full px-3 py-2 bg-white border border-slate-200 rounded-lg text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
        />
      )}

      {error && <p className="text-[11px] text-red-600 mt-0.5">{error}</p>}
    </div>
  );
};
