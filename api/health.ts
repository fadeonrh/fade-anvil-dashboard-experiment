import type { VercelRequest, VercelResponse } from "@vercel/node";

const startedAt = Date.now();
let scanCount = 0;
let requestCount = 0;

export function incrementScanCount() { scanCount++; }
export function incrementRequestCount() { requestCount++; }

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  incrementRequestCount();

  if (req.method === "OPTIONS") {
    return res.status(200).end();
  }

  return res.status(200).json({
    ok: true,
    timestamp: Date.now(),
    version: "1.1.0",
    uptime: Math.floor((Date.now() - startedAt) / 1000),
    scanCount,
    requestCount,
  });
}
