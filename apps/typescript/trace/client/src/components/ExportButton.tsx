import React, { useState } from 'react';
import { Download, FileSpreadsheet, FileText, ChevronDown } from 'lucide-react';
import { api } from '../services/api.js';

export const ExportButton: React.FC = () => {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative inline-block text-left">
      <button
        onClick={() => setOpen(!open)}
        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 text-xs font-semibold shadow-xs transition-colors"
      >
        <Download className="w-3.5 h-3.5 text-slate-500" />
        Export Audit
        <ChevronDown className="w-3 h-3 text-slate-400" />
      </button>

      {open && (
        <div
          className="absolute right-0 mt-1.5 w-48 rounded-xl bg-white border border-slate-200 shadow-lg py-1 z-50 text-xs animate-in fade-in zoom-in-95 duration-100"
          onClick={() => setOpen(false)}
        >
          <a
            href={api.exportExcelUrl}
            download
            className="flex items-center gap-2 px-3 py-2 text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <FileSpreadsheet className="w-4 h-4 text-emerald-600 shrink-0" />
            <div>
              <div className="font-semibold">Excel Workbook (.xlsx)</div>
              <div className="text-[10px] text-slate-400">Multi-sheet full audit</div>
            </div>
          </a>

          <a
            href={api.exportCsvUrl}
            download
            className="flex items-center gap-2 px-3 py-2 text-slate-700 hover:bg-slate-50 transition-colors"
          >
            <FileText className="w-4 h-4 text-blue-600 shrink-0" />
            <div>
              <div className="font-semibold">CSV Summary (.csv)</div>
              <div className="text-[10px] text-slate-400">Flat tabular export</div>
            </div>
          </a>
        </div>
      )}
    </div>
  );
};
