import { getAddress, type Address } from "viem";

// Simple config, no UI/accounts. Seeded with the 3 example addresses.
// Override with WATCHLIST_ADDRESSES="0x...,0x..." (comma-separated) if set.
const DEFAULT_WATCHLIST: Address[] = [
  "0x496b0Da20E553cC4B1879D54e57283b8C9fDfbB4",
  "0x25b1364B6DC48eAE81Fc601c77b29788cF8ab665",
  "0xDA0f0194fD03f0AdD719ad810b1D8b6ab26832b5",
];

export function getWatchlist(): Address[] {
  const fromEnv = process.env.WATCHLIST_ADDRESSES?.trim();
  const raw = fromEnv
    ? fromEnv.split(",").map((a) => a.trim()).filter(Boolean)
    : DEFAULT_WATCHLIST;
  return raw.map((a) => getAddress(a));
}

export function isWatched(address: Address): boolean {
  const lower = address.toLowerCase();
  return getWatchlist().some((a) => a.toLowerCase() === lower);
}
