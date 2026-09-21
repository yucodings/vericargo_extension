export const COMPARISON_FIELD_NAMES = [
  "shipper",
  "consignee",
  "notifyParty",
  "portOfLoading",
  "portOfDischarge",
  "containerCount",
  "grossWeightKg",
];

const FIELD_ALIASES = new Map([
  ["shipper", "shipper"],
  ["exporter", "shipper"],
  ["shipperexporter", "shipper"],
  ["consignee", "consignee"],
  ["receiver", "consignee"],
  ["notify", "notifyParty"],
  ["notifyparty", "notifyParty"],
  ["intermediatenotify", "notifyParty"],
  ["portofloading", "portOfLoading"],
  ["loadingport", "portOfLoading"],
  ["pol", "portOfLoading"],
  ["portofdischarge", "portOfDischarge"],
  ["dischargeport", "portOfDischarge"],
  ["pod", "portOfDischarge"],
  ["containercount", "containerCount"],
  ["numberofcontainers", "containerCount"],
  ["noofcontainers", "containerCount"],
  ["grossweight", "grossWeightKg"],
  ["grossweightkg", "grossWeightKg"],
  ["grosswt", "grossWeightKg"],
]);

const PORT_ALIASES = [
  { canonical: "SINGAPORE", patterns: ["SGSIN", "SINGAPORE"] },
  { canonical: "PYEONGTAEK, SOUTH KOREA", patterns: ["KRPTK", "PYEONGTAEK", "PYONGTAEK"] },
  { canonical: "BUSAN, SOUTH KOREA", patterns: ["KRPUS", "BUSAN", "PUSAN"] },
  { canonical: "HO CHI MINH CITY, VIETNAM", patterns: ["VNSGN", "HOCHIMINH", "HO CHI MINH", "CAT LAI"] },
  { canonical: "NANTONG, CHINA", patterns: ["CNNTG", "NANTONG"] },
  { canonical: "CALLAO, PERU", patterns: ["PECLL", "CALLAO"] },
  { canonical: "VALPARAISO, CHILE", patterns: ["CLVAP", "VALPARAISO"] },
  { canonical: "LE HAVRE, FRANCE", patterns: ["FRLEH", "LE HAVRE"] },
  { canonical: "MERSIN, TURKEY", patterns: ["TRMER", "MERSIN"] },
];

const cleanText = (value) => String(value ?? "")
  .normalize("NFKD")
  .replace(/[\u0300-\u036f]/g, "")
  .replace(/[\t\r\n]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

const comparableText = (value) => cleanText(value)
  .toLocaleUpperCase()
  .replace(/[^A-Z0-9]+/g, " ")
  .replace(/\s+/g, " ")
  .trim();

export function canonicalFieldName(label) {
  const key = comparableText(label).toLocaleLowerCase().replaceAll(" ", "").replace(/^the/, "");
  return FIELD_ALIASES.get(key) || null;
}

const fieldCandidate = (document, fieldName) => {
  if (document?.fields?.[fieldName]) return document.fields[fieldName];
  for (const [label, field] of Object.entries(document?.fields || {})) {
    if (canonicalFieldName(label) === fieldName) return field;
  }
  return {};
};

const numberString = (value) => {
  const rounded = Math.round(value * 1000) / 1000;
  return Number.isInteger(rounded) ? String(rounded) : String(rounded).replace(/0+$/, "").replace(/\.$/, "");
};

const normalizedWeightKg = (field) => {
  const raw = cleanText(field?.rawValue);
  const existing = cleanText(field?.normalizedValue);
  const source = raw || existing;
  const numericMatch = source.replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  if (!numericMatch) return existing || raw;
  let kilograms = Number(numericMatch[0]);
  const unitSource = comparableText(source);
  if (/\b(?:METRIC TON|METRIC TONS|TONNE|TONNES|TON|TONS|MT)\b/.test(unitSource)) kilograms *= 1000;
  else if (/\b(?:LB|LBS|POUND|POUNDS)\b/.test(unitSource)) kilograms *= 0.45359237;
  return Number.isFinite(kilograms) ? numberString(kilograms) : existing || raw;
};

const normalizedContainerCount = (field) => {
  const source = cleanText(field?.normalizedValue) || cleanText(field?.rawValue);
  const match = source.replace(/,/g, "").match(/\d+(?:\.\d+)?/);
  return match ? numberString(Number(match[0])) : source.toLocaleUpperCase();
};

const normalizedPort = (field) => {
  const source = cleanText(field?.normalizedValue) || cleanText(field?.rawValue);
  const comparable = comparableText(source)
    .replace(/\b(?:PORT OF LOADING|LOADING PORT|PORT OF DISCHARGE|DISCHARGE PORT|POL|POD)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const match = PORT_ALIASES.find(({ patterns }) => patterns.some((pattern) => comparable.includes(pattern)));
  return match?.canonical || comparable;
};

export function normalizeField(fieldName, field = {}) {
  const source = cleanText(field.normalizedValue) || cleanText(field.rawValue);
  let normalizedValue;
  if (fieldName === "grossWeightKg") normalizedValue = normalizedWeightKg(field);
  else if (fieldName === "containerCount") normalizedValue = normalizedContainerCount(field);
  else if (fieldName === "portOfLoading" || fieldName === "portOfDischarge") normalizedValue = normalizedPort(field);
  else normalizedValue = comparableText(source);
  return {
    ...field,
    confidence: Math.max(0, Math.min(100, Number(field.confidence) || 0)),
    normalizedValue,
    rawValue: cleanText(field.rawValue),
  };
}

export function normalizeDocument(document) {
  if (!document) return null;
  return {
    ...document,
    fields: Object.fromEntries(COMPARISON_FIELD_NAMES.map((fieldName) => [
      fieldName,
      normalizeField(fieldName, fieldCandidate(document, fieldName)),
    ])),
  };
}

const compareNormalizedValues = (fieldName, left, right) => {
  if (fieldName === "grossWeightKg" || fieldName === "containerCount") {
    const leftNumber = Number(left);
    const rightNumber = Number(right);
    if (!Number.isFinite(leftNumber) || !Number.isFinite(rightNumber)) return false;
    const tolerance = fieldName === "grossWeightKg" ? Math.max(0.5, Math.abs(leftNumber) * 0.001) : 0;
    return Math.abs(leftNumber - rightNumber) <= tolerance;
  }
  return comparableText(left) === comparableText(right);
};

export function compareDocuments(siDocument, draftBlDocument) {
  const normalizedSi = normalizeDocument(siDocument);
  const normalizedDraftBl = normalizeDocument(draftBlDocument);
  const fields = {};
  for (const fieldName of COMPARISON_FIELD_NAMES) {
    const siField = normalizedSi.fields[fieldName];
    const draftField = normalizedDraftBl.fields[fieldName];
    const siValue = siField.normalizedValue;
    const draftValue = draftField.normalizedValue;
    const bothPresent = Boolean(siValue && draftValue);
    const status = !bothPresent
      ? "UNRESOLVED"
      : compareNormalizedValues(fieldName, siValue, draftValue)
        ? "MATCH"
        : "MISMATCH";
    const confidence = bothPresent ? Math.min(siField.confidence, draftField.confidence) : 0;
    fields[fieldName] = {
      confidence,
      draftBlNormalizedValue: draftValue,
      reason: status === "MATCH"
        ? "Values are equivalent after canonical normalization."
        : status === "MISMATCH"
          ? "Normalized SI and Draft BL values differ."
          : "A reliable value is missing from one or both documents.",
      siNormalizedValue: siValue,
      status,
    };
  }
  const results = Object.values(fields);
  const matchedCount = results.filter(({ status }) => status === "MATCH").length;
  const mismatchCount = results.filter(({ status }) => status === "MISMATCH").length;
  const unresolvedCount = results.filter(({ status }) => status === "UNRESOLVED").length;
  const confidence = Math.round(results.reduce((sum, field) => sum + field.confidence, 0) / results.length);
  return {
    comparison: {
      confidence,
      fields,
      matchedCount,
      mismatchCount,
      status: mismatchCount ? "MISMATCH" : unresolvedCount ? "NEEDS_REVIEW" : "MATCH",
      unresolvedCount,
    },
    draftBlDocument: normalizedDraftBl,
    siDocument: normalizedSi,
  };
}

export function enrichDocumentComparison(message) {
  if (!message?.siDocument || !message?.draftBlDocument) return message;
  const { comparison, draftBlDocument, siDocument } = compareDocuments(message.siDocument, message.draftBlDocument);
  return { ...message, documentComparison: comparison, draftBlDocument, siDocument };
}
