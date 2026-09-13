/**
 * PDF text extraction, isolated in its own module so pdfjs-dist is only
 * downloaded when a user actually drops a PDF (dynamic import).
 */
export async function extractPdfText(file: File, maxPages = 3): Promise<string> {
  const pdfjs = await import('pdfjs-dist')
  const workerUrl = (await import('pdfjs-dist/build/pdf.worker.min.mjs?url')).default
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

  const data = await file.arrayBuffer()
  const doc = await pdfjs.getDocument({ data }).promise
  const pages = Math.min(doc.numPages, maxPages)

  let text = ''
  for (let i = 1; i <= pages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    text +=
      content.items
        .map((item) => ('str' in item ? item.str : ''))
        .join(' ') + '\n'
  }
  await doc.cleanup?.()
  return text
}
