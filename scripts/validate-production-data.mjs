import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else {
        quoted = !quoted;
      }
    } else if (char === "," && !quoted) {
      row.push(field);
      field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some(value => value.length > 0)) rows.push(row);
      row = [];
      field = "";
    } else {
      field += char;
    }
  }

  if (field.length || row.length) {
    row.push(field);
    rows.push(row);
  }

  const [headers, ...records] = rows;
  return records.map((values, rowIndex) => ({
    rowNumber: rowIndex + 2,
    ...Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""]))
  }));
}

function readCsv(relativePath) {
  return parseCsv(fs.readFileSync(path.join(root, relativePath), "utf8"));
}

const problems = [];
const warnings = [];
const catalogue = readCsv("data/catalogue-verification.csv");
const accessories = readCsv("data/accessories-verification.csv");

for (const item of catalogue) {
  const label = `catalogue row ${item.rowNumber} (${item.product_number || "missing product number"})`;
  if (!item.product_number) problems.push(`${label}: product_number is required`);
  if (!item.source_file || !item.source_page) problems.push(`${label}: source evidence is required`);
  if (item.publish_status === "approved") {
    for (const field of ["product_number", "oem_references", "dimensions_mm", "vehicle_make", "vehicle_models", "position", "price_ngn", "stock_quantity"]) {
      if (!item[field]) problems.push(`${label}: approved product is missing ${field}`);
    }
    if (item.product_number.startsWith("UNREADABLE")) problems.push(`${label}: cropped product number cannot be approved`);
    if (item.transcription_status !== "owner_verified") problems.push(`${label}: transcription must be owner_verified before approval`);
  } else {
    warnings.push(`${label}: remains ${item.publish_status || "without status"}`);
  }
}

for (const item of accessories) {
  const label = `accessory row ${item.rowNumber} (${item.product_code || "missing product code"})`;
  if (!item.product_code || !item.product_name || !item.category) problems.push(`${label}: code, name and category are required`);
  if (item.publish_status === "approved") {
    for (const field of ["description", "specification", "price_ngn", "stock_quantity", "image_file"]) {
      if (!item[field]) problems.push(`${label}: approved accessory is missing ${field}`);
    }
    if (item.owner_verified !== "true") problems.push(`${label}: owner_verified must be true before approval`);
  } else {
    warnings.push(`${label}: remains ${item.publish_status || "without status"}`);
  }
}

console.log(`Checked ${catalogue.length} brake catalogue rows and ${accessories.length} accessory rows.`);
console.log(`${warnings.length} records remain intentionally unpublished.`);

if (problems.length) {
  console.error("\nProduction data validation failed:");
  problems.forEach(problem => console.error(`- ${problem}`));
  process.exitCode = 1;
} else {
  console.log("No record marked approved violates the production publication gate.");
}
