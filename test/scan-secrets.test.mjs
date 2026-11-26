import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { findingsInText, scanProject } from "../scripts/scan-secrets.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scanner = path.join(root, "scripts", "scan-secrets.mjs");

function sample(kind) {
  if (kind === "access") return ["pa", "t", "AbCdEfGhIjKlMn", ".", "ab".repeat(32)].join("");
  if (kind === "legacy") return ["ke", "y", "AbCdEfGhIjKlMn"].join("");
  return ["s", "k-", "ab"].join("") + "cdefghijklmnopqrstuvwxyz";
}

test("el repositorio, el HTML y el build no contienen credenciales", () => {
  const groups = scanProject(root);
  assert.deepEqual(groups.html, []);
  assert.deepEqual(groups.repo, []);
  assert.deepEqual(groups.build, []);
  const cli = spawnSync(process.execPath, [scanner, root], { encoding: "utf8" });
  assert.equal(cli.status, 0, cli.stderr);
});

test("el escáner falla con un secreto y no lo imprime", () => {
  for (const kind of ["access", "legacy", "secret"]) {
    const secret = sample(kind);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "wins-scan-"));
    const build = path.join(dir, "build");
    fs.mkdirSync(build);
    fs.writeFileSync(path.join(dir, "WinsEquipo.html"), "<!doctype html><title>ok</title>");
    fs.writeFileSync(path.join(build, "app.js"), `const leaked = "${secret}";`);
    const cli = spawnSync(process.execPath, [scanner, dir, build], { encoding: "utf8" });
    const output = `${cli.stdout}${cli.stderr}`;
    assert.notEqual(cli.status, 0);
    assert.equal(output.includes(secret), false);
    assert.equal(findingsInText(secret).length > 0, true);
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
