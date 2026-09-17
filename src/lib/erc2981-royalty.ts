/**
 * ERC-2981 royalty reader — reads on-chain royalty info per NFT collection.
 *
 * Calls royaltyInfo(tokenId=1, salePrice=10000e18) on the collection contract
 * to extract the royalty in basis points. Caches per collection for 1 hour.
 * Falls back to 0 bps if the contract doesn't implement ERC-2981.
 */

import type { PublicClient } from "viem";
import { parseAbi } from "viem";

const ERC2981_ABI = parseAbi([
  "function royaltyInfo(uint256 tokenId, uint256 salePrice) view returns (address receiver, uint256 royaltyAmount)",
]);

const royaltyCache = new Map<string, { bps: number; at: number }>();
const ROYALTY_CACHE_TTL_MS = 60 * 60_000; // 1 hour

/**
 * Read the ERC-2981 royalty for a collection. Returns bps (e.g. 500 = 5%).
 * Caches per collection address for 1 hour.
 */
export async function readRoyaltyBps(
  client: PublicClient,
  collection: `0x${string}`,
): Promise<number> {
  const key = collection.toLowerCase();
  const cached = royaltyCache.get(key);
  if (cached && Date.now() - cached.at < ROYALTY_CACHE_TTL_MS) return cached.bps;
  try {
    // Use tokenId=1 and salePrice=10000e18 to get a clean bps ratio
    const salePrice = 10_000n * 10n ** 18n;
    const result = await client.readContract({
      address: collection,
      abi: ERC2981_ABI,
      functionName: "royaltyInfo",
      args: [1n, salePrice],
    });
    const royaltyBps = Number((result[1] * 10_000n) / salePrice);
    royaltyCache.set(key, { bps: royaltyBps, at: Date.now() });
    return royaltyBps;
  } catch {
    // Contract may not implement ERC-2981 — default to 0
    royaltyCache.set(key, { bps: 0, at: Date.now() });
    return 0;
  }
}
