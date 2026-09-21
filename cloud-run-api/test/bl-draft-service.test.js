import assert from "node:assert/strict";
import test from "node:test";
import { unzipSync } from "fflate";

import { buildNormalizedBlContent, createBlDocument } from "../src/bl-draft-service.js";

const message = {
  id: "message-1",
  subject: "SI / Draft BL test",
  siDocument: {
    filename: "SI.txt",
    fields: {
      shipper: { normalizedValue: "NORMALIZED SHIPPER", rawValue: "Raw shipper" },
      consignee: { rawValue: "RAW CONSIGNEE" },
    },
  },
  draftBlDocument: {
    filename: "Draft-BL.txt",
    fields: {
      notifyParty: { normalizedValue: "NORMALIZED NOTIFY" },
      portOfLoading: { normalizedValue: "SINGAPORE" },
    },
  },
};

test("builds normalized BL content with SI values first and Draft BL fallback", () => {
  const content = buildNormalizedBlContent(message);

  assert.match(content, /Shipper: NORMALIZED SHIPPER/);
  assert.match(content, /Consignee: RAW CONSIGNEE/);
  assert.match(content, /Notify Party: NORMALIZED NOTIFY/);
  assert.match(content, /Port of Discharge: Not available/);
  assert.match(content, /Verify all fields/);
});

test("generates TXT, PDF, and DOCX download documents", () => {
  const text = createBlDocument(message, "txt");
  assert.equal(text.mimeType, "text/plain; charset=utf-8");
  assert.match(text.buffer.toString("utf8"), /NORMALIZED SHIPPER/);

  const pdf = createBlDocument(message, "pdf");
  assert.equal(pdf.buffer.subarray(0, 5).toString("binary"), "%PDF-");

  const docx = createBlDocument(message, "docx");
  const files = unzipSync(docx.buffer);
  assert.ok(files["word/document.xml"]);
  assert.match(Buffer.from(files["word/document.xml"]).toString("utf8"), /NORMALIZED SHIPPER/);
});

test("uses reviewed user edits in the generated document", () => {
  const document = createBlDocument(message, "txt", "USER-REVIEWED DRAFT BL\nShipper: Corrected shipper");

  assert.equal(document.text, "USER-REVIEWED DRAFT BL\nShipper: Corrected shipper");
  assert.equal(document.buffer.toString("utf8"), document.text);
});

test("rejects unsupported BL download formats", () => {
  assert.throws(() => createBlDocument(message, "exe"), /TXT, PDF, or DOCX/);
});

test("rejects empty reviewed content", () => {
  assert.throws(() => createBlDocument(message, "txt", "   "), /cannot be empty/);
});
