const AIRTABLE_API = "https://api.airtable.com/v0";
const TABLES = ["WinsBoard", "RetosBoard"];
const METHODS = ["GET", "POST", "PATCH"];
const DANGEROUS_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const RECORD_ID = /^rec[A-Za-z0-9]{14}$/;
const BASE_ID = /^app[A-Za-z0-9]{14}$/;
const OFFSET = /^[A-Za-z0-9+/=_-]{1,400}$/;

export const MAX_BODY_BYTES = 8192;
export const MAX_PAGES = 20;
export const PAGE_SIZE = 100;
export const UPSTREAM_TIMEOUT_MS = 10_000;

const STRING = (max, allowEmpty, allowEmptyOnPatch = false) => ({
  type: "string",
  max,
  allowEmpty,
  allowEmptyOnPatch,
});

const TABLE_FIELDS = {
  WinsBoard: {
    WIN: STRING(4000, false),
    Categoria: STRING(120, false, true),
    Responsable: STRING(120, true),
    Cliente: STRING(200, true),
    Fecha: STRING(40, false),
    DesdReto: { type: "boolean" },
    Mes: { type: "int", min: 1, max: 12 },
    Anio: { type: "int", min: 2000, max: 2100 },
  },
  RetosBoard: {
    Descripcion: STRING(4000, false),
    Autor: STRING(120, true),
    Tipo: STRING(80, false, true),
    Fecha: STRING(40, false),
    Resuelto: { type: "boolean" },
    Resolucion: STRING(4000, true),
    ResueltoPor: STRING(120, true),
  },
};

const REQUIRED_ON_CREATE = {
  WinsBoard: ["WIN", "Categoria"],
  RetosBoard: ["Descripcion", "Tipo"],
};

function json(status, body) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

function fail(status, message) {
  return json(status, { error: { message } });
}

function originFromUrl(value, { allowHttp = false } = {}) {
  if (typeof value !== "string" || value.trim() === "" || value === "null") return null;
  try {
    const url = new URL(value.trim());
    const https = url.protocol === "https:";
    const http = allowHttp && url.protocol === "http:";
    if (!https && !http) return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

function originFromHost(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || /\s/.test(trimmed)) return null;
  const withProto = /^https:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  let url;
  try {
    url = new URL(withProto);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
  if (url.pathname !== "/" && url.pathname !== "") return null;
  return url.origin;
}

export function allowedOrigins(env) {
  const origins = new Set();
  const app = originFromUrl(env.APP_ORIGIN);
  if (app) origins.add(app);
  for (const host of [env.VERCEL_URL, env.VERCEL_BRANCH_URL, env.VERCEL_PROJECT_PRODUCTION_URL]) {
    const origin = originFromHost(host);
    if (origin) origins.add(origin);
  }
  return origins;
}

export function callerAllowed(request, env) {
  const origin = request.headers.get("origin");
  const referer = request.headers.get("referer") || request.headers.get("referrer");
  const site = (request.headers.get("sec-fetch-site") || "").toLowerCase();

  if (site === "cross-site" || site === "cross-origin") return false;

  const allowed = allowedOrigins(env);
  if (origin) {
    const parsed = originFromUrl(origin, { allowHttp: true });
    return Boolean(parsed && allowed.has(parsed));
  }

  const refererOrigin = referer ? originFromUrl(referer, { allowHttp: true }) : null;
  if (refererOrigin && allowed.has(refererOrigin)) return true;
  return site === "same-origin";
}

function serverConfig(env) {
  const token = env.AIRTABLE_TOKEN;
  const baseId = env.AIRTABLE_BASE_ID;
  if (typeof token !== "string" || token.trim() !== token || token.length < 10) return null;
  if (typeof baseId !== "string" || !BASE_ID.test(baseId)) return null;
  return { token, baseId };
}

function query(request) {
  const url = new URL(request.url);
  const unknown = [];
  for (const key of url.searchParams.keys()) {
    if (key !== "table" && key !== "id") unknown.push(key);
  }
  return {
    tables: url.searchParams.getAll("table"),
    ids: url.searchParams.getAll("id"),
    unknown,
  };
}

function checkString(rule, value, method) {
  if (typeof value !== "string") return "Tipo de campo no válido";
  if (value.length > rule.max) return "Campo demasiado largo";
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/.test(value)) return "Campo no válido";
  const emptyOk = rule.allowEmpty || (method === "PATCH" && rule.allowEmptyOnPatch);
  if (!emptyOk && value.trim() === "") return "Falta un campo obligatorio";
  return "";
}

function checkValue(rule, value, method) {
  if (rule.type === "string") return checkString(rule, value, method);
  if (rule.type === "boolean") return typeof value === "boolean" ? "" : "Tipo de campo no válido";
  if (rule.type === "int") {
    if (typeof value !== "number" || !Number.isInteger(value) || value < rule.min || value > rule.max) {
      return "Tipo de campo no válido";
    }
    return "";
  }
  return "Tipo de campo no válido";
}

function validateFields(table, fields, method) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) {
    return { error: "fields debe ser un objeto" };
  }
  const spec = TABLE_FIELDS[table];
  const keys = Object.keys(fields);
  if (keys.length === 0) return { error: "No hay campos para guardar" };
  const clean = Object.create(null);
  for (const key of keys) {
    if (DANGEROUS_KEYS.has(key) || !Object.hasOwn(spec, key)) return { error: "Campo no permitido" };
    const problem = checkValue(spec[key], fields[key], method);
    if (problem) return { error: problem };
    clean[key] = fields[key];
  }
  if (method === "POST") {
    for (const required of REQUIRED_ON_CREATE[table]) {
      if (!Object.hasOwn(clean, required)) return { error: "Falta un campo obligatorio" };
    }
  }
  return { fields: clean };
}

function parseJson(text) {
  return JSON.parse(text, (key, value) => {
    if (DANGEROUS_KEYS.has(key)) {
      const error = new Error("forbidden-key");
      error.code = "forbidden-key";
      throw error;
    }
    if (value && typeof value === "object") {
      for (const own of Object.keys(value)) {
        if (DANGEROUS_KEYS.has(own)) {
          const error = new Error("forbidden-key");
          error.code = "forbidden-key";
          throw error;
        }
      }
    }
    return value;
  });
}

async function readBody(request) {
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_BODY_BYTES)) {
    return { error: fail(413, "El cuerpo es demasiado grande") };
  }
  const type = request.headers.get("content-type") || "";
  if (!type.toLowerCase().includes("application/json")) {
    return { error: fail(415, "El cuerpo debe ser JSON") };
  }
  const text = await request.text();
  if (Buffer.byteLength(text) > MAX_BODY_BYTES) {
    return { error: fail(413, "El cuerpo es demasiado grande") };
  }
  let parsed;
  try {
    parsed = parseJson(text);
  } catch (error) {
    if (error && error.code === "forbidden-key") return { error: fail(400, "Campo no permitido") };
    return { error: fail(400, "El cuerpo no es válido") };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { error: fail(400, "El cuerpo no es válido") };
  }
  const keys = Object.keys(parsed);
  if (keys.some((key) => DANGEROUS_KEYS.has(key)) || keys.length !== 1 || keys[0] !== "fields") {
    return { error: fail(400, "El cuerpo solo puede incluir fields") };
  }
  return { fields: parsed.fields };
}

function publicRecord(record, table) {
  if (!record || typeof record !== "object" || !RECORD_ID.test(record.id || "")) return null;
  const spec = TABLE_FIELDS[table];
  const source = record.fields && typeof record.fields === "object" ? record.fields : {};
  const fields = Object.create(null);
  for (const key of Object.keys(source)) {
    if (Object.hasOwn(spec, key)) fields[key] = source[key];
  }
  return { id: record.id, fields };
}

function authHeaders(token) {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
}

async function readUpstream(response) {
  const text = await response.text();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function upstreamFailed(status, table) {
  console.error("airtable proxy upstream failed", { status, table });
  if (status === 429) return fail(429, "Airtable está ocupado, intenta de nuevo");
  if (status === 422) return fail(400, "Airtable rechazó los datos");
  return fail(502, "No se pudo completar la operación");
}

async function airtableFetch(fetchImpl, url, init) {
  try {
    return await fetchImpl(url, {
      ...init,
      redirect: "error",
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === "TimeoutError" || error?.name === "AbortError") {
      const timeout = new Error("upstream-timeout");
      timeout.code = "upstream-timeout";
      throw timeout;
    }
    throw error;
  }
}

async function listAll(fetchImpl, config, table) {
  const records = [];
  let offset = "";
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL(`${AIRTABLE_API}/${config.baseId}/${encodeURIComponent(table)}`);
    url.searchParams.set("pageSize", String(PAGE_SIZE));
    if (offset) url.searchParams.set("offset", offset);
    const response = await airtableFetch(fetchImpl, url, {
      method: "GET",
      headers: authHeaders(config.token),
    });
    const data = await readUpstream(response);
    if (!response.ok || !data || !Array.isArray(data.records)) return upstreamFailed(response.status, table);
    for (const record of data.records) {
      const clean = publicRecord(record, table);
      if (clean) records.push(clean);
    }
    if (!data.offset) return json(200, { records });
    if (typeof data.offset !== "string" || !OFFSET.test(data.offset)) {
      console.error("airtable proxy rejected upstream offset", { table });
      return fail(502, "Respuesta de Airtable no válida");
    }
    offset = data.offset;
  }
  console.error("airtable proxy pagination cap", { table, pages: MAX_PAGES });
  return fail(413, "Hay demasiados registros para mostrarlos de una vez");
}

async function writeRecord(fetchImpl, config, table, method, id, fields) {
  const path = method === "PATCH"
    ? `${AIRTABLE_API}/${config.baseId}/${encodeURIComponent(table)}/${id}`
    : `${AIRTABLE_API}/${config.baseId}/${encodeURIComponent(table)}`;
  const response = await airtableFetch(fetchImpl, path, {
    method,
    headers: authHeaders(config.token),
    body: JSON.stringify({ fields }),
  });
  const data = await readUpstream(response);
  if (!response.ok || !data) return upstreamFailed(response.status, table);
  const clean = publicRecord(data, table);
  if (!clean) {
    console.error("airtable proxy rejected upstream record", { table });
    return fail(502, "Respuesta de Airtable no válida");
  }
  return json(200, clean);
}

export async function handleAirtableRequest(request, env, fetchImpl = globalThis.fetch) {
  if (!callerAllowed(request, env)) return fail(403, "Origen no permitido");

  const method = (request.method || "").toUpperCase();
  if (!METHODS.includes(method)) return fail(405, "Método no permitido");

  const config = serverConfig(env);
  if (!config) {
    console.error("airtable proxy missing server configuration");
    return fail(500, "Configuración del servidor incompleta");
  }

  const { tables, ids, unknown } = query(request);
  if (unknown.length > 0) return fail(400, "Parámetro no permitido");
  if (tables.length !== 1 || !TABLES.includes(tables[0])) return fail(400, "Tabla no permitida");
  const table = tables[0];

  try {
    if (method === "GET") {
      if (ids.length > 0) return fail(400, "Identificador no permitido");
      return await listAll(fetchImpl, config, table);
    }

    if (method === "POST" && ids.length > 0) return fail(400, "Identificador no permitido");
    if (method === "PATCH") {
      if (ids.length !== 1 || !RECORD_ID.test(ids[0])) return fail(400, "Identificador no válido");
    }

    const body = await readBody(request);
    if (body.error) return body.error;
    const validated = validateFields(table, body.fields, method);
    if (validated.error) return fail(400, validated.error);

    return await writeRecord(fetchImpl, config, table, method, ids[0], validated.fields);
  } catch (error) {
    if (error?.code === "upstream-timeout") {
      console.error("airtable proxy timed out");
      return fail(504, "Airtable no respondió a tiempo");
    }
    throw error;
  }
}
