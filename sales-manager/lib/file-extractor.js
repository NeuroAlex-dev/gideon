import fs from "node:fs";
import path from "node:path";

const MAX_EXTRACTED_CHARS = 8000; // ~2000 токенов на файл

export async function extractText(filePath) {
  if (!fs.existsSync(filePath)) return { text: null, error: "file not found" };
  const ext = path.extname(filePath).toLowerCase().replace(/^\./, "");
  const mime = guessMime(ext);
  try {
    if (["txt", "md", "csv", "log", "json"].includes(ext)) {
      const raw = fs.readFileSync(filePath, "utf8");
      return finalize(raw, mime);
    }
    if (ext === "html" || ext === "htm") {
      const raw = fs.readFileSync(filePath, "utf8");
      const stripped = raw.replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
      return finalize(stripped, mime);
    }
    if (ext === "pdf") {
      const pdfParse = (await import("pdf-parse")).default;
      const data = await pdfParse(fs.readFileSync(filePath));
      return finalize(data.text || "", mime);
    }
    if (ext === "docx") {
      const mammoth = await import("mammoth");
      const res = await mammoth.extractRawText({ path: filePath });
      return finalize(res.value || "", mime);
    }
    return { text: null, error: `unsupported extension: ${ext}`, mime };
  } catch (e) {
    return { text: null, error: e.message, mime };
  }
}

function finalize(raw, mime) {
  const cleaned = raw.trim().replace(/\r\n?/g, "\n").replace(/\n{3,}/g, "\n\n");
  const truncated = cleaned.length > MAX_EXTRACTED_CHARS;
  return {
    text: truncated ? cleaned.slice(0, MAX_EXTRACTED_CHARS) + "\n[…обрезано]" : cleaned,
    truncated,
    mime,
    length: cleaned.length,
  };
}

function guessMime(ext) {
  return {
    txt: "text/plain", md: "text/markdown", csv: "text/csv", log: "text/plain", json: "application/json",
    html: "text/html", htm: "text/html", pdf: "application/pdf", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  }[ext] || "application/octet-stream";
}
