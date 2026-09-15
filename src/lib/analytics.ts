/**
 * In-memory analytics for the FADE Anvil Dashboard.
 * Tracks requests, scans, errors, response times, and market stats.
 * Resets on server restart (no persistence).
 */

export interface EndpointStats {
  count: number;
  errors: number;
  totalTimeMs: number;
  lastAccessedAt: number;
}

export interface ScanStats {
  count: number;
  success: number;
  failed: number;
  totalMarkets: number;
  minMarkets: number;
  maxMarkets: number;
  totalTimeMs: number;
  lastScanAt: number;
}

export interface AnalyticsSnapshot {
  uptime: number;
  startedAt: number;
  now: number;
  requests: {
    total: number;
    byEndpoint: Record<string, EndpointStats>;
    perMinute: number[];
  };
  scans: ScanStats;
  errors: {
    total: number;
    byCode: Record<string, number>;
  };
  responseTimes: {
    p50: number;
    p95: number;
    p99: number;
    avg: number;
  };
  markets: {
    lastCount: number;
    avgPerScan: number;
  };
}

const startedAt = Date.now();
let totalRequests = 0;
let totalErrors = 0;
const endpoints: Record<string, EndpointStats> = {};
const errorCodes: Record<string, number> = {};
const responseTimesMs: number[] = [];
const scanStats: ScanStats = {
  count: 0,
  success: 0,
  failed: 0,
  totalMarkets: 0,
  minMarkets: Infinity,
  maxMarkets: 0,
  totalTimeMs: 0,
  lastScanAt: 0,
};

// Per-minute request buckets (last 60 minutes)
const minuteBuckets: number[] = new Array(60).fill(0);
let lastBucketMinute = Math.floor(Date.now() / 60000);

function rotateBuckets() {
  const currentMinute = Math.floor(Date.now() / 60000);
  const elapsed = currentMinute - lastBucketMinute;
  if (elapsed > 0) {
    for (let i = 0; i < Math.min(elapsed, 60); i++) {
      minuteBuckets.shift();
      minuteBuckets.push(0);
    }
    lastBucketMinute = currentMinute;
  }
}

export function trackRequest(endpoint: string, durationMs: number, isError: boolean, errorCode?: string) {
  rotateBuckets();
  minuteBuckets[minuteBuckets.length - 1]++;
  totalRequests++;

  if (!endpoints[endpoint]) {
    endpoints[endpoint] = { count: 0, errors: 0, totalTimeMs: 0, lastAccessedAt: 0 };
  }
  endpoints[endpoint].count++;
  endpoints[endpoint].totalTimeMs += durationMs;
  endpoints[endpoint].lastAccessedAt = Date.now();

  if (isError) {
    totalErrors++;
    endpoints[endpoint].errors++;
    const code = errorCode || "UNKNOWN";
    errorCodes[code] = (errorCodes[code] || 0) + 1;
  }

  responseTimesMs.push(durationMs);
  // Keep last 10000 response times for percentile calculation
  if (responseTimesMs.length > 10000) {
    responseTimesMs.splice(0, responseTimesMs.length - 10000);
  }
}

export function trackScan(marketsCount: number, durationMs: number, success: boolean) {
  scanStats.count++;
  if (success) {
    scanStats.success++;
    scanStats.totalMarkets += marketsCount;
    scanStats.minMarkets = Math.min(scanStats.minMarkets, marketsCount);
    scanStats.maxMarkets = Math.max(scanStats.maxMarkets, marketsCount);
  } else {
    scanStats.failed++;
  }
  scanStats.totalTimeMs += durationMs;
  scanStats.lastScanAt = Date.now();
}

function percentile(arr: number[], p: number): number {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.ceil((p / 100) * sorted.length) - 1;
  return sorted[Math.max(0, idx)];
}

export function getSnapshot(): AnalyticsSnapshot {
  rotateBuckets();
  const now = Date.now();
  const times = responseTimesMs.length > 0 ? responseTimesMs : [0];

  return {
    uptime: Math.floor((now - startedAt) / 1000),
    startedAt,
    now,
    requests: {
      total: totalRequests,
      byEndpoint: { ...endpoints },
      perMinute: [...minuteBuckets],
    },
    scans: { ...scanStats },
    errors: {
      total: totalErrors,
      byCode: { ...errorCodes },
    },
    responseTimes: {
      p50: percentile(times, 50),
      p95: percentile(times, 95),
      p99: percentile(times, 99),
      avg: Math.round(times.reduce((a, b) => a + b, 0) / times.length),
    },
    markets: {
      lastCount: scanStats.success > 0 ? Math.round(scanStats.totalMarkets / scanStats.success) : 0,
      avgPerScan: scanStats.success > 0 ? Math.round(scanStats.totalMarkets / scanStats.success) : 0,
    },
  };
}

export function reset() {
  totalRequests = 0;
  totalErrors = 0;
  Object.keys(endpoints).forEach((k) => delete endpoints[k]);
  Object.keys(errorCodes).forEach((k) => delete errorCodes[k]);
  responseTimesMs.length = 0;
  scanStats.count = 0;
  scanStats.success = 0;
  scanStats.failed = 0;
  scanStats.totalMarkets = 0;
  scanStats.minMarkets = Infinity;
  scanStats.maxMarkets = 0;
  scanStats.totalTimeMs = 0;
  scanStats.lastScanAt = 0;
  minuteBuckets.fill(0);
}
