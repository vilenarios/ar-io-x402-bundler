/**
 * Copyright (C) 2022-2024 Permanent Data Solutions, Inc. All Rights Reserved.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */

import { x402Networks, X402NetworkConfig } from "../constants";

/**
 * Token information parsed from token string
 *
 * Token format: {currency}-{network}
 * Examples:
 *   - usdc-base
 *   - usdc-base-sepolia
 *   - usdc-ethereum-mainnet
 *   - usdc-polygon-mainnet
 *
 * Future support (extensible):
 *   - ario-base (ARIO token on Base)
 *   - sol-solana (SOL on Solana - would require different payment protocol)
 */
export interface TokenInfo {
  /** Currency code (e.g., "usdc", "ario", "sol") */
  currency: string;
  /** Network identifier (e.g., "base", "base-sepolia", "ethereum-mainnet") */
  network: string;
  /** x402 network configuration */
  networkConfig: X402NetworkConfig;
}

/**
 * Parse a token string into currency and network components
 *
 * @param token - Token string in format "{currency}-{network}"
 * @returns TokenInfo object or null if invalid
 *
 * @example
 * parseToken("usdc-base")
 * // Returns: { currency: "usdc", network: "base", networkConfig: {...} }
 *
 * parseToken("usdc-base-sepolia")
 * // Returns: { currency: "usdc", network: "base-sepolia", networkConfig: {...} }
 *
 * parseToken("invalid")
 * // Returns: null
 */
export function parseToken(token: string): TokenInfo | null {
  // Split token by dash: "usdc-base" → ["usdc", "base"]
  const parts = token.split("-");
  if (parts.length < 2) {
    return null; // Invalid format
  }

  const currency = parts[0]; // "usdc"
  const network = parts.slice(1).join("-"); // "base" or "base-sepolia" or "ethereum-mainnet"

  // Currently only support USDC on x402 networks
  // Future: extend to support "ario", "sol", etc.
  if (currency !== "usdc") {
    return null;
  }

  // Look up network in x402Networks configuration
  const networkConfig = x402Networks[network];
  if (!networkConfig) {
    return null; // Unknown network
  }

  // Check if network is enabled
  if (!networkConfig.enabled) {
    return null; // Network exists but is disabled
  }

  return {
    currency,
    network,
    networkConfig,
  };
}

/**
 * Get all currently enabled tokens
 *
 * @returns Array of enabled token strings
 *
 * @example
 * getEnabledTokens()
 * // Returns: ["usdc-base", "usdc-base-sepolia"]
 */
export function getEnabledTokens(): string[] {
  const tokens: string[] = [];

  // Currently only USDC on x402 networks
  // Future: add support for other currencies
  for (const [network, config] of Object.entries(x402Networks)) {
    if (config.enabled) {
      tokens.push(`usdc-${network}`);
    }
  }

  return tokens;
}

/**
 * Validate a token string format (doesn't check if network is enabled)
 *
 * @param token - Token string to validate
 * @returns True if format is valid
 */
export function isValidTokenFormat(token: string): boolean {
  const parts = token.split("-");
  return parts.length >= 2 && parts[0].length > 0 && parts[1].length > 0;
}
