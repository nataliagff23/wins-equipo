import assert from "node:assert/strict";
import test from "node:test";
import handler from "../api/airtable.js";
import { MAX_BODY_BYTES, MAX_PAGES, handleAirtableRequest } from "../lib/airtable-proxy.js";

const APP = "https://wins.imperiansapps.com";
const TOKEN = "test-token-value";
const BASE = "appT08Cl4u2lVE1Td";
const REC = "recAAAAAAAAAAAAAA";

const winFields = {
  WIN: "Cerramos un contrato",
  Categoria: "Más ventas",
  Responsable: "Natalia Goncalves",
  Cliente: "Imperians Agency",
  Fecha: "26 nov 2026",
  DesdReto: false,
  Mes: 11,
  Anio: 2026,
};

function env(extra = {}) {
  return { AIRTABLE_TOKEN: TOKEN, AIRTABLE_BASE_ID: BASE, APP_ORIGIN: APP, ...extra };
}

function request(options = {}) {
  const {
    method = "GET",
    origin = APP,
    referer,
    site,
    table = "WinsBoard",
    id,
    query = "",
    body,
    headers = {},
  } = options;
  const params = new URLSearchParams();
  if (table != null) params.set("table", table);
  if (id) params.set("id", id);
  const url = `${APP}/api/airtable?${params}${query ? `&${query}` : ""}`;
  const h = new Headers(headers);
  if (origin) h.set("origin", origin);
  if (referer) h.set("referer", referer);
  if (site) h.set("sec-fetch-site", site);
  const init = { method, headers: h };
  if (body !== undefined) {
    init.body = typeof body === "string" ? body : JSON.stringify(body);
    if (!h.has("content-type")) h.set("content-type", "application/json");
  }
  return new Request(url, init);
}

function forbidFetch() {
  return async () => {
    throw new Error("upstream called");
  };
}

function mockFetch(handler) {
  const calls = [];
  const impl = async (url, init) => {
    const call = { url: String(url), init: { ...init, headers: { ...init.headers } } };
    calls.push(call);
    return handler(call, calls.length);
  };
  return { impl, calls };
}

function upstreamRecord(fields = { WIN: "Hola" }, extra = {}) {
  return new Response(JSON.stringify({ id: REC, fields: { ...fields, ...extra }, createdTime: "2026-11-26" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}

async function call(options, fetchImpl = forbidFetch(), extraEnv = {}) {
  const logs = [];
  const original = console.error;
  console.error = (...args) => logs.push(args.map(String).join(" "));
  try {
    const response = await handleAirtableRequest(request(options), env(extraEnv), fetchImpl);
    const text = await response.text();
    assert.equal(text.includes(TOKEN), false, "la respuesta no debe incluir la credencial");
    assert.equal(response.headers.get("access-control-allow-origin"), null);
    assert.equal(logs.join("\n").includes(TOKEN), false);
    let body = null;
    try { body = JSON.parse(text); } catch { /* respuesta vacía */ }
    return { status: response.status, body, text };
  } finally {
    console.error = original;
  }
}

test("rechaza un origen cruzado sin llamar a Airtable", async () => {
  const result = await call({ origin: "https://evil.example" });
  assert.equal(result.status, 403);
  assert.equal(result.body.error.message, "Origen no permitido");
});

test("rechaza Sec-Fetch-Site cross-site aunque el Origin coincida", async () => {
  const result = await call({ origin: APP, site: "cross-site" });
  assert.equal(result.status, 403);
});

test("rechaza un Origin que solo parece el de la app", async () => {
  const result = await call({ origin: "https://wins.imperiansapps.com.evil.com" });
  assert.equal(result.status, 403);
});

test("un GET same-origin sin Origin entra con Referer", async () => {
  const fetchImpl = mockFetch(async () => new Response(JSON.stringify({ records: [] }), { status: 200 }));
  const result = await call({
    origin: "",
    referer: `${APP}/WinsEquipo.html`,
  }, fetchImpl.impl);
  assert.equal(result.status, 200);
  assert.equal(fetchImpl.calls.length, 1);
});

test("un GET same-origin sin Origin ni Referer entra con Sec-Fetch-Site", async () => {
  const fetchImpl = mockFetch(async () => new Response(JSON.stringify({ records: [] }), { status: 200 }));
  const result = await call({ origin: "", site: "same-origin" }, fetchImpl.impl);
  assert.equal(result.status, 200);
});

test("sin Origin, Referer ni same-origin responde 403", async () => {
  const result = await call({ origin: "", site: "none" });
  assert.equal(result.status, 403);
});

test("acepta el preview de este despliegue y rechaza otro vercel.app", async () => {
  const preview = "wins-equipo-git-fix-imperians-agencys-projects.vercel.app";
  const fetchImpl = mockFetch(async () => new Response(JSON.stringify({ records: [] }), { status: 200 }));
  const allowed = await call({ origin: `https://${preview}` }, fetchImpl.impl, { VERCEL_URL: preview });
  assert.equal(allowed.status, 200);
  const blocked = await call({ origin: "https://otro-proyecto.vercel.app" }, forbidFetch(), { VERCEL_URL: preview });
  assert.equal(blocked.status, 403);
});

test("APP_ORIGIN con barra final vale y un asterisco no abre la guardia", async () => {
  const fetchImpl = mockFetch(async () => new Response(JSON.stringify({ records: [] }), { status: 200 }));
  const allowed = await call({ origin: APP }, fetchImpl.impl, { APP_ORIGIN: `${APP}/` });
  assert.equal(allowed.status, 200);
  const blocked = await call({ origin: "https://cualquiera.example" }, forbidFetch(), { APP_ORIGIN: "*" });
  assert.equal(blocked.status, 403);
});

test("rechaza otro método, otra tabla y parámetros que no están en la lista", async () => {
  assert.equal((await call({ method: "DELETE" })).status, 405);
  assert.equal((await call({ method: "OPTIONS" })).status, 405);
  assert.equal((await call({ table: "OtraTabla" })).status, 400);
  assert.equal((await call({ table: "WinsBoard/../Secrets" })).status, 400);
  assert.equal((await call({ query: "filterByFormula=1" })).status, 400);
  assert.equal((await call({ query: "offset=abc" })).status, 400);
});

test("GET no reenvía filtros y pagina con un tope", async () => {
  let pages = 0;
  const fetchImpl = mockFetch(async (callInfo) => {
    pages += 1;
    const url = new URL(callInfo.url);
    assert.equal(url.searchParams.get("filterByFormula"), null);
    assert.equal(url.searchParams.get("pageSize"), "100");
    assert.equal(url.origin, "https://api.airtable.com");
    assert.equal(url.pathname, `/v0/${BASE}/WinsBoard`);
    assert.equal(callInfo.init.redirect, "error");
    assert.equal(callInfo.init.headers.authorization, `Bearer ${TOKEN}`);
    if (pages === 1) assert.equal(url.searchParams.get("offset"), null);
    if (pages === 2) assert.equal(url.searchParams.get("offset"), "page-two");
    return new Response(JSON.stringify({
      records: [{ id: REC, fields: { WIN: "Uno", Notas: "secreto-interno" } }],
      offset: pages < 2 ? "page-two" : undefined,
    }), { status: 200 });
  });
  const result = await call({}, fetchImpl.impl);
  assert.equal(result.status, 200);
  assert.equal(result.body.records.length, 2);
  assert.deepEqual(result.body.records[0].fields, { WIN: "Uno" });
  assert.equal(fetchImpl.calls.length, 2);
});

test("la paginación se detiene en el tope sin devolver una lista parcial", async () => {
  const fetchImpl = mockFetch(async () => new Response(JSON.stringify({
    records: [{ id: REC, fields: { WIN: "Uno" } }],
    offset: "siguiente",
  }), { status: 200 }));
  const result = await call({}, fetchImpl.impl);
  assert.equal(result.status, 413);
  assert.equal(result.body.records, undefined);
  assert.equal(fetchImpl.calls.length, MAX_PAGES);
});

test("POST solo reenvía los campos de la lista blanca", async () => {
  const fetchImpl = mockFetch(async (callInfo) => {
    const sent = JSON.parse(callInfo.init.body);
    assert.deepEqual(Object.keys(sent), ["fields"]);
    assert.equal(sent.fields.WIN, winFields.WIN);
    assert.equal(sent.fields.Notas, undefined);
    return upstreamRecord(sent.fields, { createdTime: "no" });
  });
  const result = await call({
    method: "POST",
    body: { fields: { ...winFields, Notas: "no" } },
  }, fetchImpl.impl);
  assert.equal(result.status, 400);
  assert.equal(fetchImpl.calls.length, 0);

  const okFetch = mockFetch(async () => upstreamRecord(winFields));
  const ok = await call({ method: "POST", body: { fields: winFields } }, okFetch.impl);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.id, REC);
  assert.equal(ok.body.createdTime, undefined);
  assert.equal(ok.body.fields.WIN, winFields.WIN);
});

test("rechaza __proto__, constructor y un id que no es rec", async () => {
  const polluted = await call({
    method: "POST",
    body: '{"fields":{"__proto__":{"admin":true},"WIN":"hola"}}',
  });
  assert.equal(polluted.status, 400);
  assert.equal(Object.prototype.admin, undefined);

  const constructor = await call({
    method: "POST",
    body: '{"constructor":{"prototype":{"admin":true}},"fields":{"WIN":"hola"}}',
  });
  assert.equal(constructor.status, 400);
  assert.equal(Object.prototype.admin, undefined);

  const badId = await call({
    method: "PATCH",
    id: "rec/../../Otro",
    body: { fields: { WIN: "hola", Categoria: "Otro", Responsable: "Natalia Goncalves", Cliente: "Interno" } },
  });
  assert.equal(badId.status, 400);

  const shortId = await call({
    method: "PATCH",
    id: "recABCDEFGHIJKL",
    body: { fields: { Categoria: "Otro" } },
  });
  assert.equal(shortId.status, 400);
});

test("PATCH acepta un id rec y no deja pasar campos de otra tabla", async () => {
  const fetchImpl = mockFetch(async (callInfo) => {
    assert.equal(callInfo.url, `https://api.airtable.com/v0/${BASE}/WinsBoard/${REC}`);
    assert.equal(callInfo.init.method, "PATCH");
    return upstreamRecord({ WIN: "Editado", Categoria: "Otro", Responsable: "Natalia Goncalves", Cliente: "Interno" });
  });
  const result = await call({
    method: "PATCH",
    id: REC,
    body: { fields: { WIN: "Editado", Categoria: "Otro", Responsable: "Natalia Goncalves", Cliente: "Interno" } },
  }, fetchImpl.impl);
  assert.equal(result.status, 200);

  const wrong = await call({
    method: "PATCH",
    table: "RetosBoard",
    id: REC,
    body: { fields: { WIN: "no" } },
  });
  assert.equal(wrong.status, 400);
});

test("valida tipos y el cuerpo máximo", async () => {
  assert.equal((await call({
    method: "POST",
    body: { fields: { ...winFields, Mes: "11" } },
  })).status, 400);
  assert.equal((await call({
    method: "POST",
    body: { fields: { ...winFields, DesdReto: "false" } },
  })).status, 400);
  assert.equal((await call({
    method: "POST",
    body: { fields: { ...winFields, Mes: 0 } },
  })).status, 400);
  assert.equal((await call({
    method: "POST",
    body: { fields: { Descripcion: "un reto" } },
  })).status, 400);

  const reto = await call({
    method: "POST",
    table: "RetosBoard",
    body: { fields: { Descripcion: "Reactivar la cuenta", Autor: "Natalia Goncalves", Tipo: "Reto urgente", Fecha: "26 nov 2026", Resuelto: false } },
  }, mockFetch(async () => new Response(JSON.stringify({
    id: REC,
    fields: { Descripcion: "Reactivar la cuenta", Autor: "Natalia Goncalves", Tipo: "Reto urgente", Fecha: "26 nov 2026", Resuelto: false },
  }), { status: 200 })).impl);
  assert.equal(reto.status, 200);

  const huge = "x".repeat(MAX_BODY_BYTES + 1);
  const tooBig = await call({
    method: "POST",
    body: huge,
    headers: { "content-type": "application/json" },
  });
  assert.equal(tooBig.status, 413);
});

test("un fallo de Airtable no se reenvía si el cuerpo menciona la credencial", async () => {
  const fetchImpl = mockFetch(async () => new Response(JSON.stringify({
    error: { message: `Invalid token ${TOKEN}` },
  }), { status: 401 }));
  const result = await call({ method: "POST", body: { fields: winFields } }, fetchImpl.impl);
  assert.equal(result.status, 502);
  assert.equal(result.text.includes(TOKEN), false);
  assert.equal(result.text.includes("Invalid token"), false);
});

test("sin configuración no llama a Airtable", async () => {
  const result = await call({}, forbidFetch(), { AIRTABLE_TOKEN: "" });
  assert.equal(result.status, 500);
  assert.equal(result.body.error.message, "Configuración del servidor incompleta");
});

test("la entrada de Vercel usa la misma guardia y no filtra la credencial", async () => {
  const keys = ["AIRTABLE_TOKEN", "AIRTABLE_BASE_ID", "APP_ORIGIN"];
  const saved = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  const originalFetch = globalThis.fetch;
  let called = false;
  process.env.AIRTABLE_TOKEN = TOKEN;
  process.env.AIRTABLE_BASE_ID = BASE;
  process.env.APP_ORIGIN = APP;
  globalThis.fetch = async () => {
    called = true;
    throw new Error("upstream called");
  };
  try {
    const response = await handler.fetch(request({ origin: "https://evil.example" }));
    const text = await response.text();
    assert.equal(response.status, 403);
    assert.equal(called, false);
    assert.equal(text.includes(TOKEN), false);
    assert.equal(response.headers.get("access-control-allow-origin"), null);
  } finally {
    globalThis.fetch = originalFetch;
    for (const key of keys) {
      if (saved[key] === undefined) delete process.env[key];
      else process.env[key] = saved[key];
    }
  }
});
