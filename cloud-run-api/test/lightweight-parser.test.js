import assert from "node:assert/strict";
import test from "node:test";
import { strToU8, zipSync } from "fflate";

import { extractLightweightText } from "../src/lightweight-parser.js";

test("extracts machine-readable text without invoking document vision", async () => {
  const result = await extractLightweightText(
    Buffer.from("Shipping instruction with shipper, consignee, ports, containers and gross weight."),
    "text/plain",
    { minLength: 1 },
  );

  assert.equal(result.method, "LIGHTWEIGHT_TEXT");
  assert.match(result.text, /gross weight/);
});

test("extracts shared and numeric values from an XLSX workbook", async () => {
  const workbook = zipSync({
    "xl/sharedStrings.xml": strToU8('<?xml version="1.0"?><sst><si><t>Shipper</t></si><si><t>ABC Logistics</t></si><si><t>Gross Weight kg</t></si></sst>'),
    "xl/worksheets/sheet1.xml": strToU8('<?xml version="1.0"?><worksheet><sheetData><row><c t="s"><v>0</v></c><c t="s"><v>1</v></c></row><row><c t="s"><v>2</v></c><c><v>12500</v></c></row></sheetData></worksheet>'),
  });

  const result = await extractLightweightText(
    Buffer.from(workbook),
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    { minLength: 1 },
  );

  assert.equal(result.method, "LIGHTWEIGHT_XLSX");
  assert.match(result.text, /Shipper \| ABC Logistics/);
  assert.match(result.text, /Gross Weight kg \| 12500/);
});
