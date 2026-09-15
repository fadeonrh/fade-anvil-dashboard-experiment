export const ROBINHOOD_CHAIN_ID = 4663;

export const ROBINHOOD_MAINNET_RPC = "https://rpc.mainnet.chain.robinhood.com";

export const DERP_TOKEN = "0x6543B7746ca744C4bb2198191E71f40FF04C41b9";

export const PITBOYS = "0x57069d845701B50F41327362C1C23789043F8DEc";

export const STONKBROKERS = "0x539CdD042c2f3d93EbC5BE7DfFf0c79F3B4fAbF0";

export const DERPPAD_COUPON_WINDOW = 300;

export const DERP_MERCHANT = "0x3bFfE8c3c53d1432088a771D095Db018c3006Eb9";

export const DERP_POOL = "0xfB578FdD8f3577E8ce7A45dfef725B6072b9d9A1";

export const DERP_POOL_QUOTE = "0x0bd7d308f8e1639fab988df18a8011f41eacad73";

export const DERP_POOL_FEE_TIER = 10000;

export const V3_POOL_ABI = [
  {
    type: "function",
    name: "swap",
    stateMutability: "payable",
    inputs: [
      { name: "recipient", type: "address" },
      { name: "zeroForOne", type: "bool" },
      { name: "amountSpecified", type: "int256" },
      { name: "sqrtPriceLimitX96", type: "uint160" },
      { name: "data", type: "bytes" },
    ],
    outputs: [
      { name: "amount0", type: "int256" },
      { name: "amount1", type: "int256" },
    ],
  },
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint8" },
      { name: "unlocked", type: "bool" },
    ],
  },
] as const;

export const DESK_CONTRACT_CANDIDATES = [
  "0x6e600cC4F22556f9B374f2E7D704eEeFe47d4b87",
  "0x41BE0b8978A14Cd2d22f8f363b5c30e3Bd14B254",
] as const;

export const BOY_DESK = "0x41BE0b8978A14Cd2d22f8f363b5c30e3Bd14B254";

export const PITBOYS_MERCHANT = "0x6e600cC4F22556f9B374f2E7D704eEeFe47d4b87";

export const APE_TOKEN = "0x8f86a15EC17cb3369d8b3E666dAdBC11daA82b79";

export const APE_WETH_POOL = "0x4263743142da2c86b408e001af4de92738253bc70f2f4acdb3c9a313f22e59a8";

export const LOCKER = "0xDeb8d589251717e367d0f3E9dDE5D4dB63968B40";

/** DerpBoys ETH booster (PitBoys royalties → tier-weighted ETH payouts). */
export const DERPBOYS_BOOSTER = "0x9b465049787BB79d3965829d3f17cEa1a9ED7C85";
/** DerpBoys APE royalty crank on ApeChain (MineBoys royalties → APE tip + bridge). */
export const DERPBOYS_APE_CRANK = "0xA76F9632799eF6bFA5ee764089856225a9369C14";
/** WAPE on ApeChain (APE crank reads its balance). */
export const APECHAIN_WAPE = "0x48b62137edfa95a428d35c09e44256a739f6b557";

export const DERP_SWAP_TOPIC =
  "0xc42079f94a6350d7e6235f29174924f928cc2ac818eb64fed8004e115fbcca67";

export const ROBINHOOD_CHAIN = {
  id: 4663,
  name: "Robinhood",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.mainnet.chain.robinhood.com"] } },
  blockExplorers: { default: { name: "Robinscan", url: "https://robinscan.io" } },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
} as const;

export const APECHAIN_CHAIN = {
  id: 33139,
  name: "ApeChain",
  nativeCurrency: { name: "ApeCoin", symbol: "APE", decimals: 18 },
  rpcUrls: { default: { http: ["https://rpc.apechain.com"] } },
  contracts: {
    multicall3: {
      address: "0xcA11bde05977b3631167028862bE2a173976CA11",
    },
  },
} as const;
