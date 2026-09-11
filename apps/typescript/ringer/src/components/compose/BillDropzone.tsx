import { useRef, useState } from 'react'
import { CheckCircle2, FileUp, Loader2, ReceiptText, Sparkles } from 'lucide-react'
import { parseBillText, SAMPLE_BILL_TEXT, type ParsedBill } from '@/lib/billParse'
import { cn } from '@/lib/cn'

/**
 * Drop a bill (PDF or text) and auto-fill the negotiation form.
 * PDF parsing loads pdf.js on demand; nothing leaves the browser.
 */
export function BillDropzone({ onParsed }: { onParsed: (bill: ParsedBill, source: string) => void }) {
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [dragging, setDragging] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)

  const handleText = (text: string, source: string) => {
    const parsed = parseBillText(text)
    if (!parsed.provider && !parsed.amount && !parsed.accountRef) {
      setError('Couldn’t find bill details in that file — fill the form manually.')
      return
    }
    onParsed(parsed, source)
    setDone(source)
    setError(null)
  }

  const handleFile = async (file: File) => {
    setBusy(true)
    setError(null)
    setDone(null)
    try {
      if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
        const { extractPdfText } = await import('@/lib/billPdf')
        handleText(await extractPdfText(file), file.name)
      } else {
        handleText(await file.text(), file.name)
      }
    } catch {
      setError('Couldn’t read that file. Try a PDF or plain-text bill.')
    } finally {
      setBusy(false)
    }
  }

  const useSample = () => {
    setBusy(false)
    handleText(SAMPLE_BILL_TEXT, 'Sample Xfinity bill')
  }

  return (
    <div
      onDragOver={(e) => {
        e.preventDefault()
        setDragging(true)
      }}
      onDragLeave={() => setDragging(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragging(false)
        const file = e.dataTransfer.files?.[0]
        if (file) void handleFile(file)
      }}
      className={cn(
        'rounded-2xl border-2 border-dashed p-4 transition-colors',
        dragging ? 'border-primary bg-primary-soft/40' : 'border-border bg-surface-2/60',
      )}
    >
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.txt,text/plain,application/pdf"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) void handleFile(file)
          e.target.value = ''
        }}
      />
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-primary-soft text-primary-strong dark:text-primary">
          {busy ? <Loader2 className="size-5 animate-spin" /> : <ReceiptText className="size-5" />}
        </span>
        <div className="min-w-0 flex-1">
          {done ? (
            <p className="flex items-center gap-1.5 text-sm font-semibold text-success">
              <CheckCircle2 className="size-4" /> Filled from {done}
            </p>
          ) : (
            <p className="text-sm font-semibold text-ink">
              Have the bill? Drop it here to auto-fill.
            </p>
          )}
          <p className="text-xs text-muted">
            {error ?? 'PDF or text · parsed locally in your browser, never uploaded.'}
          </p>
        </div>
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-ink hover:border-primary/40"
          >
            <FileUp className="size-3.5" /> Choose file
          </button>
          <button
            type="button"
            onClick={useSample}
            className="inline-flex cursor-pointer items-center gap-1.5 rounded-lg border border-border bg-surface px-3 py-1.5 text-xs font-semibold text-primary hover:border-primary/40"
          >
            <Sparkles className="size-3.5" /> Try a sample bill
          </button>
        </div>
      </div>
    </div>
  )
}
