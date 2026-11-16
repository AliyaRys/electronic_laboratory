/**
 * DR30 evidence: screenshots of the examination create route with the same
 * MSW-style route mocks as tests/e2e/examinations.spec.ts, plus the reference
 * mockup file, at the control widths 1440/1024/768/390.
 *
 * Usage: node scripts/dr30-shots.mjs <outDir> <pageUrl|mockup>
 *   pageUrl — full URL of /labs/:labId/arrivals/:partyId/examination/new
 *   "mockup" — screenshot the repository mockup electronic-vse-journal.html
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { resolve } from "node:path";

const outDir = resolve(process.argv[2] ?? "evidence");
const target = process.argv[3];
if (target === undefined) {
  console.error("usage: node scripts/dr30-shots.mjs <outDir> <pageUrl|mockup>");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const LAB = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";
const PARTY = "9c1b2d3e-1111-4222-8333-444444444444";
const EXAM = "e0000000-0000-4000-8000-000000000001";
const COLLECTION = "44444444-4444-4444-8444-444444444444";

const partyView = {
  id: "3f0e6d2a-1111-4222-8333-444444444444",
  party_id: PARTY,
  laboratory_id: LAB,
  external: {
    contour: "PILOT",
    evsd_uuid: "1f0e6d2a-1111-4222-8333-444444444444",
    status: "COMPLETED",
    fields: {
      documentUuid: "1c0d1a2b-1111-4222-8333-444444444444",
      issuedOn: "2026-08-07",
      documentNumber: "RU016:260807-002914",
      documentIssuedOn: "2026-08-07",
      consignor: "КФХ Шайдуллин Азат Рашидович",
      consignorOwner: "Шайдуллин Азат Рашидович",
      consignee: "АО «Агропромышленный парк „Казань“»",
      consigneeOwner: "Хусаинова Зельфия Тимергалиевна",
    },
  },
  classification: {
    productType: 1,
    product: { id: "p", name: "Мясо и мясопродукты" },
    subProduct: { id: "sp", name: "Говядина" },
    productItem: { id: "pi", name: "Говядина в четвертинах охлаждённая" },
    unit: { id: "u", name: "штука" },
  },
  documentary: { mass_kg: "140.5", quantity: "2", unit_id: "шт" },
  confirmation: {
    id: "c1000000-0000-4000-8000-000000000001",
    accepted_mass_kg: "140.5",
    accepted_quantity: "2",
    accepted_unit_id: "шт",
    returned_mass_kg: "0",
    returned_quantity: "0",
    confirmed_at: "2026-11-07T10:00:00Z",
  },
  queue: "WORK",
  examination_id: null,
  revision: 1,
};

const collection = {
  id: COLLECTION,
  party_id: PARTY,
  laboratory_id: LAB,
  product_species_id: "33333333-3333-4333-8333-333333333333",
  classification_snapshot: { product: { id: "s", name: "говядина" } },
  collected_on: "2026-11-06",
  mass_kg: "12.6",
  collected_by: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
  created_at: "2026-11-06T10:00:00Z",
  disposal_id: null,
  revision: 1,
};

const widths = [
  [1440, 900],
  [1024, 768],
  [768, 1024],
  [390, 844],
];

const browser = await chromium.launch();
const page = await browser.newPage();
await page.route("**/api/v1/me", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({
      id: "0f0f0f0f-0f0f-4f0f-8f0f-0f0f0f0f0f0f",
      full_name: "Кузнецова Алиса Викторовна",
      login: "kuznetsova",
      email: "user@lab.tatar",
      position: null,
      role: "VET",
      active: true,
      scopes: [{ laboratory_id: LAB, product_scope_id: null }],
      capabilities: [],
      revision: 3,
    }),
  }),
);
await page.route("**/api/v1/samples/collections*", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ items: [collection], total: 1, page: 1, page_size: 20 }),
  }),
);
await page.route("**/api/v1/arrivals?*", (route) =>
  route.fulfill({
    status: 200,
    contentType: "application/json",
    body: JSON.stringify({ items: [], total: 0, page: 1, page_size: 20 }),
  }),
);
await page.route(`**/api/v1/arrivals/${PARTY}`, (route) =>
  route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(partyView) }),
);

const url = target === "mockup" ? pathToFileURL(resolve("electronic-vse-journal.html")).href : target;

for (const [width, height] of widths) {
  await page.setViewportSize({ width, height });
  await page.goto(url, { waitUntil: target === "mockup" ? "load" : "networkidle" });
  if (target !== "mockup") {
    // The create form renders after the /me and party reads settle.
    await page.waitForSelector(".vse-exam-form", { timeout: 20000 });
  }
  await page.screenshot({ path: `${outDir}/w${width}.png`, fullPage: true });
  console.log(`saved ${outDir}/w${width}.png`);
}
await browser.close();
