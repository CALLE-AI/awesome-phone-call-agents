import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

type PositionedText = { text: string; x: number; y: number };

function groupLines(items: PositionedText[]) {
  const lines: PositionedText[][] = [];
  for (const item of items.sort((a, b) => b.y - a.y || a.x - b.x)) {
    const line = lines.find((candidate) => Math.abs(candidate[0].y - item.y) <= 3);
    if (line) line.push(item);
    else lines.push([item]);
  }
  return lines.map((line) => line.sort((a, b) => a.x - b.x));
}

export async function parsePdfTable(arrayBuffer: ArrayBuffer) {
  const pdfjs = await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const loadingTask = pdfjs.getDocument({ data: new Uint8Array(arrayBuffer) });
  const pdf = await loadingTask.promise;
  const rows: string[][] = [];
  try {
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber);
      const content = await page.getTextContent();
      const items = content.items.flatMap((item) => {
        if (!("str" in item) || !item.str.trim()) return [];
        return [{ text: item.str.trim(), x: item.transform[4], y: item.transform[5] }];
      });
      for (const line of groupLines(items)) {
        if (line.length === 1 && /[,\t]/u.test(line[0].text)) {
          rows.push(line[0].text.split(line[0].text.includes("\t") ? "\t" : ",").map((cell) => cell.trim()));
        } else {
          rows.push(line.map((item) => item.text));
        }
      }
    }
  } finally {
    await loadingTask.destroy();
  }
  if (!rows.length) {
    throw new Error("No selectable table text was found. Scanned PDFs are not supported.");
  }
  return rows;
}
