import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";

const BASE = "http://localhost:3004";

function fetch(path: string, options: RequestInit = {}): Promise<Response> {
  return globalThis.fetch(`${BASE}${path}`, options);
}

describe("API Integration", () => {
  describe("GET /api/health", () => {
    it("returns 200 with ok: true", async () => {
      const res = await fetch("/api/health");
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.equal(body.ok, true);
      assert.ok(typeof body.timestamp === "number");
    });

    it("returns JSON content type", async () => {
      const res = await fetch("/api/health");
      assert.ok(res.headers.get("content-type")?.includes("application/json"));
    });

    it("includes CORS headers", async () => {
      const res = await fetch("/api/health");
      assert.equal(res.headers.get("access-control-allow-origin"), "*");
      assert.ok(res.headers.get("access-control-allow-methods")?.includes("GET"));
    });

    it("responds quickly (< 100ms)", async () => {
      const start = Date.now();
      await fetch("/api/health");
      const elapsed = Date.now() - start;
      assert.ok(elapsed < 100, `health check took ${elapsed}ms, expected < 100ms`);
    });
  });

  describe("OPTIONS preflight", () => {
    it("returns 200 with CORS headers", async () => {
      const res = await fetch("/api/markets", { method: "OPTIONS" });
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("access-control-allow-origin"), "*");
      assert.ok(res.headers.get("access-control-allow-methods")?.includes("GET"));
    });
  });

  describe("404 handling", () => {
    it("returns JSON for API-like requests", async () => {
      const res = await fetch("/nonexistent");
      assert.equal(res.status, 404);
      const body = await res.json();
      assert.equal(body.error, "not found");
    });

    it("returns HTML for browser-like requests", async () => {
      const res = await fetch("/nonexistent", {
        headers: { Accept: "text/html" },
      });
      assert.equal(res.status, 404);
      const text = await res.text();
      assert.ok(text.includes("404"), "should contain 404");
      assert.ok(text.includes("FADE"), "should contain FADE branding");
    });
  });

  describe("GET /api/markets", () => {
    it("returns 200 with array response", async () => {
      const res = await fetch("/api/markets");
      assert.equal(res.status, 200);
      const body = await res.json();
      assert.ok(Array.isArray(body), "response should be an array");
    });

    it("each market has required fields", async () => {
      const res = await fetch("/api/markets");
      const body = await res.json();
      if (body.length > 0) {
        const market = body[0];
        assert.ok(typeof market.marketId === "number", "marketId should be number");
        assert.ok(typeof market.collection === "string", "collection should be string");
        assert.ok(typeof market.anvilFloorEth === "number", "anvilFloorEth should be number");
        assert.ok(typeof market.spread === "object", "spread should be object");
        assert.ok(typeof market.verified === "boolean", "verified should be boolean");
      }
    });

    it("spread object has required fields", async () => {
      const res = await fetch("/api/markets");
      const body = await res.json();
      if (body.length > 0 && body[0].spread) {
        const spread = body[0].spread;
        assert.ok("tradable" in spread, "spread should have tradable");
        assert.ok("netSpreadEth" in spread, "spread should have netSpreadEth");
        assert.ok("classification" in spread || "liquidityClass" in spread, "spread should have classification");
      }
    });
  });
});
