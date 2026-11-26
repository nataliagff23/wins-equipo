import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const TEXT_EXTENSIONS = new Set([
  ".html", ".htm", ".js", ".mjs", ".cjs", ".json", ".md", ".css", ".txt", ".yml", ".yaml", ".svg",
]);

const SKIP_DIRS = new Set([".git", "node_modules"]);

const PREFIXES = {
  access: "pa" + "t",
  legacy: "ke" + "y",
  secret: "s" + "k-",
};

const RULES = [
  { id: "airtable-access-token", test: new RegExp(`\\b${PREFIXES.access}[A-Za-z0-9]{14}`) },
  { id: "airtable-legacy-api", test: new RegExp(`\\b${PREFIXES.legacy}[A-Za-z0-9]{14}`) },
  { id: "secret-key-prefix", test: new RegExp(`\\b${PREFIXES.secret}[A-Za-z0-9_-]{20,}`) },
];

export function findingsInText(text) {
  const found = [];
  for (const rule of RULES) {
    rule.test.lastIndex = 0;
    if (rule.test.test(text)) found.push(rule.id);
  }
  return found;
}

function isTextFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext && !TEXT_EXTENSIONS.has(ext)) return false;
  if (!ext) {
    const base = path.basename(filePath);
    if (base !== "Dockerfile" && base !== ".gitignore") return false;
  }
  return true;
}

export function collectFiles(root) {
  const files = [];
  const start = path.resolve(root);
  if (!fs.existsSync(start)) return files;
  const stat = fs.statSync(start);
  if (stat.isFile()) {
    return isTextFile(start) ? [{ path: start, tooBig: stat.size > 2_000_000 }] : [];
  }
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        walk(full);
        continue;
      }
      if (!entry.isFile() || !isTextFile(full)) continue;
      const size = fs.statSync(full).size;
      if (size > 2_000_000) {
        files.push({ path: full, tooBig: true });
        continue;
      }
      files.push({ path: full, tooBig: false });
    }
  };
  walk(start);
  return files;
}

export function scanFiles(files) {
  const hits = [];
  for (const file of files) {
    if (file.tooBig) {
      hits.push({ file: file.path, rule: "archivo-demasiado-grande" });
      continue;
    }
    const buf = fs.readFileSync(file.path);
    if (buf.includes(0)) continue;
    const rules = findingsInText(buf.toString("utf8"));
    for (const rule of rules) hits.push({ file: file.path, rule });
  }
  return hits;
}

function copyDeployable(root, destination) {
  const include = ["WinsEquipo.html", "vercel.json", "api", "lib", path.join("Branding Imperians")];
  fs.mkdirSync(destination, { recursive: true });
  for (const relative of include) {
    const from = path.join(root, relative);
    if (!fs.existsSync(from)) continue;
    const to = path.join(destination, relative);
    fs.cpSync(from, to, { recursive: true, dereference: false });
  }
}

export function scanProject(root, { buildDirs = [] } = {}) {
  const html = path.join(root, "WinsEquipo.html");
  const groups = {
    html: fs.existsSync(html) ? scanFiles(collectFiles(html)) : [{ file: html, rule: "html-ausente" }],
    repo: scanFiles(collectFiles(root)),
    build: [],
  };

  const builds = [];
  for (const dir of buildDirs) {
    if (fs.existsSync(dir)) builds.push(dir);
  }
  for (const relative of ["build", "dist", path.join(".vercel", "output")]) {
    const full = path.join(root, relative);
    if (fs.existsSync(full)) builds.push(full);
  }

  const snapshot = fs.mkdtempSync(path.join(os.tmpdir(), "wins-build-"));
  try {
    copyDeployable(root, snapshot);
    builds.push(snapshot);
    const seen = new Set();
    for (const dir of builds) {
      const resolved = path.resolve(dir);
      if (seen.has(resolved)) continue;
      seen.add(resolved);
      groups.build.push(...scanFiles(collectFiles(resolved)).map((hit) => ({
        ...hit,
        file: `${resolved}:${path.relative(resolved, hit.file)}`,
      })));
    }
  } finally {
    fs.rmSync(snapshot, { recursive: true, force: true });
  }

  return groups;
}

function report(groups) {
  let count = 0;
  for (const [name, hits] of Object.entries(groups)) {
    for (const hit of hits) {
      count += 1;
      console.error(`Posible secreto (${hit.rule}) en ${name}: ${hit.file}`);
    }
  }
  return count;
}

const executedDirectly = process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname);
if (executedDirectly) {
  const root = process.argv[2] ? path.resolve(process.argv[2]) : process.cwd();
  const extra = process.argv.slice(3);
  const count = report(scanProject(root, { buildDirs: extra }));
  if (count > 0) process.exit(1);
}
