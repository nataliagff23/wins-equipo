import { handleAirtableRequest } from "../lib/airtable-proxy.js";

export default {
  async fetch(request) {
    try {
      return await handleAirtableRequest(request, process.env);
    } catch {
      console.error("airtable proxy crashed");
      return new Response(JSON.stringify({ error: { message: "Error interno" } }), {
        status: 500,
        headers: {
          "content-type": "application/json; charset=utf-8",
          "cache-control": "no-store",
          "x-content-type-options": "nosniff",
        },
      });
    }
  },
};
