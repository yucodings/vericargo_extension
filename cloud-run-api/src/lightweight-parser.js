import { strFromU8, unzipSync } from "fflate";
import { PDFParse } from "pdf-parse";

const DEFAULT_MIN_TEXT_LENGTH = 80;
const MAX_TEXT_LENGTH = 100_000;
const MAX_XLSX_SOURCE_BYTES = 5 * 1024 * 1024;

export const XLSX_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel.sheet.macroenabled.12",
]);

export const isTextMimeType = (mimeType) => mimeType.startsWith("text/")
  || ["application/json", "application/xml", "application/csv"].includes(mimeType);

export const supportsLightweightDocument = (mimeType) => isTextMimeType(mimeType)
  || mimeType === "application/pdf"
  || mimeType.startsWith("image/")
  || XLSX_MIME_TYPES.has(mimeType.toLowerCase());

const decodeXml = (value) => String(value || "")
  .replaceAll("&lt;", "<")
  .replaceAll("&gt;", ">")
  .replaceAll("&quot;", '"')
  .replaceAll("&apos;", "'")
  .replaceAll("&amp;", "&")
  .replaceAll(/&#(\d+);/g, (_match, code) => String.fromCodePoint(Number(code)))
  .replaceAll(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCodePoint(Number.parseInt(code, 16)));

const textNodes = (xml) => [...String(xml || "").matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/gi)]
  .map((match) => decodeXml(match[1]));

function extractXlsxText(buffer) {
  if (buffer.length > MAX_XLSX_SOURCE_BYTES) return "";
  const files = unzipSync(new Uint8Array(buffer), {
    filter: ({ name }) => name === "xl/sharedStrings.xml" || /^xl\/worksheets\/sheet\d+\.xml$/i.test(name),
  });
  const sharedStrings = files["xl/sharedStrings.xml"]
    ? [...strFromU8(files["xl/sharedStrings.xml"]).matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/gi)]
      .map((match) => textNodes(match[1]).join(" "))
    : [];
  const lines = [];
  for (const name of Object.keys(files).filter((path) => path.startsWith("xl/worksheets/")).sort()) {
    const xml = strFromU8(files[name]);
    for (const row of xml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/gi)) {
      const values = [];
      for (const cell of row[1].matchAll(/<c([^>]*)>([\s\S]*?)<\/c>/gi)) {
        const attributes = cell[1];
        const body = cell[2];
        const shared = /\bt=["']s["']/i.test(attributes);
        const inline = /\bt=["']inlineStr["']/i.test(attributes);
        const raw = inline
          ? textNodes(body).join(" ")
          : decodeXml(body.match(/<v>([\s\S]*?)<\/v>/i)?.[1] || "");
        const value = shared ? sharedStrings[Number(raw)] || "" : raw;
        if (value.trim()) values.push(value.trim());
      }
      if (values.length) lines.push(values.join(" | "));
      if (lines.join("\n").length >= MAX_TEXT_LENGTH) break;
    }
  }
  return lines.join("\n").slice(0, MAX_TEXT_LENGTH);
}

export async function extractLightweightText(buffer, mimeType, { minLength = DEFAULT_MIN_TEXT_LENGTH } = {}) {
  const normalizedMimeType = String(mimeType || "application/octet-stream").toLowerCase();
  if (isTextMimeType(normalizedMimeType)) {
    const text = new TextDecoder().decode(buffer).trim().slice(0, MAX_TEXT_LENGTH);
    return text.length >= minLength ? { method: "LIGHTWEIGHT_TEXT", text } : null;
  }
  if (XLSX_MIME_TYPES.has(normalizedMimeType)) {
    try {
      const text = extractXlsxText(buffer).trim();
      return text.length >= minLength ? { method: "LIGHTWEIGHT_XLSX", text } : null;
    } catch {
      return null;
    }
  }
  if (normalizedMimeType !== "application/pdf") return null;
  let parser;
  try {
    parser = new PDFParse({ data: buffer });
    const result = await parser.getText();
    const text = String(result.text || "").trim().slice(0, MAX_TEXT_LENGTH);
    return text.replaceAll(/\s/g, "").length >= minLength
      ? { method: "LIGHTWEIGHT_PDF", text }
      : null;
  } catch {
    return null;
  } finally {
    await parser?.destroy?.().catch(() => {});
  }
}
