import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { findingsInText } from "../scripts/scan-secrets.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("el HTML llama al proxy y no guarda credenciales", () => {
  const html = fs.readFileSync(path.join(root, "WinsEquipo.html"), "utf8");
  assert.equal(html.includes("/api/airtable"), true);
  assert.equal(html.includes("api.airtable.com"), false);
  assert.equal(html.includes("Authorization"), false);
  assert.equal(html.includes("Bearer"), false);
  assert.deepEqual(findingsInText(html), []);
});

test("la documentación ya no muestra un prefijo de credencial", () => {
  const doc = fs.readFileSync(path.join(root, "CLAUDE.md"), "utf8");
  assert.equal(doc.includes("AIRTABLE_TOKEN"), true);
  assert.deepEqual(findingsInText(doc), []);
});

test("vercel.json no publica Access-Control-Allow-Origin *", () => {
  const config = JSON.parse(fs.readFileSync(path.join(root, "vercel.json"), "utf8"));
  assert.equal(config.rewrites[0].destination, "/WinsEquipo.html");
  assert.equal(JSON.stringify(config).includes("\"*\""), false);
  const values = config.headers.flatMap((group) => group.headers);
  assert.equal(values.some((header) => header.value === "*"), false);
  assert.equal(
    values.some((header) => header.key === "Access-Control-Allow-Origin" && header.value === "https://wins.imperiansapps.com"),
    true,
  );
});
