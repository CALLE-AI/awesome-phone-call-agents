import mammoth from "mammoth";

export async function parseDocxTable(arrayBuffer: ArrayBuffer) {
  const result = await mammoth.convertToHtml(
    { arrayBuffer },
    {
      externalFileAccess: false,
      convertImage: mammoth.images.imgElement(async () => ({ src: "" })),
    }
  );
  const documentNode = new DOMParser().parseFromString(result.value, "text/html");
  const tables = Array.from(documentNode.querySelectorAll("table"));
  if (tables.length !== 1) {
    throw new Error("The Word file must contain exactly one table and no merged workflow tables.");
  }
  const extraContent = Array.from(documentNode.body.children).some((element) => element !== tables[0] && element.textContent?.trim());
  if (documentNode.querySelector("img") || extraContent) {
    throw new Error("The Word file must contain only one table, without prose or images.");
  }
  const rows = Array.from(tables[0].querySelectorAll("tr")).map((row) =>
    Array.from(row.querySelectorAll(":scope > th, :scope > td")).map((cell) => cell.textContent?.trim() || "")
  );
  if (!rows.length) throw new Error("The Word table is empty.");
  return rows;
}
