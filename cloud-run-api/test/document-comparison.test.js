import assert from "node:assert/strict";
import test from "node:test";

import {
  canonicalFieldName,
  compareDocuments,
  normalizeField,
} from "../src/document-comparison.js";

const field = (rawValue, confidence = 95, normalizedValue = "") => ({
  confidence,
  evidence: rawValue,
  normalizedValue,
  page: "1",
  rawValue,
});

const documentWith = (fields) => ({ fields, filename: "document.txt" });

test("maps common shipping label aliases to canonical field names", () => {
  assert.equal(canonicalFieldName("Port of Loading"), "portOfLoading");
  assert.equal(canonicalFieldName("Loading Port"), "portOfLoading");
  assert.equal(canonicalFieldName("POL"), "portOfLoading");
  assert.equal(canonicalFieldName("Discharge Port"), "portOfDischarge");
  assert.equal(canonicalFieldName("Gross Wt."), "grossWeightKg");
});

test("normalizes equivalent weight units into kilograms", () => {
  assert.equal(normalizeField("grossWeightKg", field("1 ton")).normalizedValue, "1000");
  assert.equal(normalizeField("grossWeightKg", field("1,000 KG")).normalizedValue, "1000");
  assert.equal(normalizeField("grossWeightKg", field("2204.62262 lbs")).normalizedValue, "1000");
});

test("matches equivalent aliases and units after deterministic normalization", () => {
  const si = documentWith({
    loadingPort: field("Singapore", 94),
    portOfDischarge: field("PYEONGTAEK, SOUTH KOREA", 92),
    grossWeightKg: field("1 ton", 90),
    numberOfContainers: field("6 x 40'HC", 96),
  });
  const draft = documentWith({
    portOfLoading: field("SGSIN", 93),
    dischargePort: field("PYEONGTAEK (KRPTK)", 91),
    grossWeightKg: field("1,000 kg", 89),
    containerCount: field("6", 95),
  });

  const result = compareDocuments(si, draft);

  assert.equal(result.comparison.fields.portOfLoading.status, "MATCH");
  assert.equal(result.comparison.fields.portOfDischarge.status, "MATCH");
  assert.equal(result.comparison.fields.grossWeightKg.status, "MATCH");
  assert.equal(result.comparison.fields.containerCount.status, "MATCH");
  assert.equal(result.comparison.fields.grossWeightKg.confidence, 89);
  assert.equal(result.siDocument.fields.grossWeightKg.normalizedValue, "1000");
  assert.equal(result.draftBlDocument.fields.portOfLoading.normalizedValue, "SINGAPORE");
});

test("returns mismatch and unresolved decisions with conservative confidence", () => {
  const si = documentWith({
    portOfLoading: field("Singapore", 98),
    portOfDischarge: field("Busan", 75),
  });
  const draft = documentWith({
    portOfLoading: field("Malaysia", 97),
    portOfDischarge: field("KRPUS", 70),
  });

  const result = compareDocuments(si, draft);

  assert.equal(result.comparison.fields.portOfLoading.status, "MISMATCH");
  assert.equal(result.comparison.fields.portOfLoading.confidence, 97);
  assert.equal(result.comparison.fields.portOfDischarge.status, "MATCH");
  assert.equal(result.comparison.fields.portOfDischarge.confidence, 70);
  assert.equal(result.comparison.fields.shipper.status, "UNRESOLVED");
  assert.equal(result.comparison.status, "MISMATCH");
  assert.equal(result.comparison.mismatchCount, 1);
});
