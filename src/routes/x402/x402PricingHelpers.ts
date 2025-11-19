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

import winston from "winston";

import {
  x402PaymentAddress,
  x402PaymentTimeoutMs,
  x402FeePercent,
  X402NetworkConfig,
} from "../../constants";
import { ByteCount, W } from "../../types/types";
import { x402PricingOracle } from "../../x402/x402PricingOracle";
import { X402PaymentRequiredResponse } from "../../arch/x402Service";

/**
 * Calculate USDC price for given byte count
 *
 * @param byteCount - Number of bytes to price
 * @param pricingService - Pricing service instance
 * @param logger - Winston logger
 * @returns USDC amount in atomic units (6 decimals) as string
 */
export async function calculateUSDCPrice(
  byteCount: number,
  pricingService: any,
  logger: winston.Logger
): Promise<string> {
  // Get Winston cost from pricing service
  // Note: signatureType doesn't affect pricing, but required by interface
  const { reward: winstonPrice } =
    await pricingService.getTxAttributesForDataItems([
      { byteCount: byteCount as ByteCount, signatureType: 1 }, // 1 = Arweave signature type
    ]);

  logger.debug("Got Winston price from pricing service", {
    byteCount,
    winstonPrice,
  });

  // Add bundler fee (profit margin on top of Arweave costs)
  const winstonWithFee = Math.ceil(
    winstonPrice * (1 + x402FeePercent / 100)
  );

  logger.debug("Applied bundler fee", {
    winstonPrice,
    winstonWithFee,
    feePercent: x402FeePercent,
  });

  // Convert Winston to USDC atomic units (using singleton oracle for caching)
  const usdcAmount = await x402PricingOracle.getUSDCForWinston(
    W(winstonWithFee.toString())
  );

  // Apply minimum payment threshold
  // Coinbase facilitator minimum: 0.001 USDC = 1,000 atomic units
  // Configurable via X402_MINIMUM_PAYMENT_USDC (in whole dollars, e.g., "0.001")
  const minimumUsdcWholeDollars = parseFloat(
    process.env.X402_MINIMUM_PAYMENT_USDC || "0.001"
  );

  // Validate parseFloat result (could be NaN if env var is malformed)
  if (isNaN(minimumUsdcWholeDollars) || minimumUsdcWholeDollars < 0) {
    logger.warn("Invalid X402_MINIMUM_PAYMENT_USDC, using default 0.001", {
      envValue: process.env.X402_MINIMUM_PAYMENT_USDC,
    });
    const defaultMinimumAtomicUnits = 1000; // 0.001 USDC
    if (parseInt(usdcAmount) < defaultMinimumAtomicUnits) {
      return defaultMinimumAtomicUnits.toString();
    }
    return usdcAmount;
  }

  const minimumUsdcAtomicUnits = Math.floor(minimumUsdcWholeDollars * 1e6);

  if (parseInt(usdcAmount) < minimumUsdcAtomicUnits) {
    logger.debug("Applying minimum payment threshold", {
      calculatedAmount: usdcAmount,
      minimumAmount: minimumUsdcAtomicUnits.toString(),
    });
    return minimumUsdcAtomicUnits.toString();
  }

  return usdcAmount;
}

/**
 * Build x402 payment requirements response
 *
 * @param usdcAmount - USDC amount in atomic units
 * @param networkConfig - x402 network configuration
 * @param networkName - Network name (e.g., "base", "base-sepolia")
 * @param uploadServicePublicUrl - Public URL of upload service (optional, uses env var if not provided)
 * @returns x402 payment requirements response
 */
export function buildPaymentRequirements(
  usdcAmount: string,
  networkConfig: X402NetworkConfig,
  networkName: string,
  uploadServicePublicUrl?: string
): X402PaymentRequiredResponse {
  const publicUrl =
    uploadServicePublicUrl ||
    process.env.UPLOAD_SERVICE_PUBLIC_URL ||
    "http://localhost:3001";

  return {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: networkName,
        maxAmountRequired: usdcAmount,
        resource: `${publicUrl}/v1/tx`, // Full URL required by x402 schema
        description: "Upload data to Arweave via AR.IO Bundler",
        mimeType: "application/json",
        outputSchema: {
          type: "object",
          properties: {
            id: { type: "string", description: "Data item ID" },
            timestamp: {
              type: "number",
              description: "Upload timestamp in milliseconds",
            },
            owner: { type: "string", description: "Normalized wallet address" },
            deadlineHeight: {
              type: "number",
              description: "Deadline block height",
            },
            version: { type: "string", description: "Receipt version" },
            signature: { type: "string", description: "Receipt signature" },
            x402Payment: {
              type: "object",
              description: "x402 payment details (if paid via x402)",
              properties: {
                paymentId: { type: "string" },
                txHash: { type: "string" },
                network: { type: "string" },
                mode: { type: "string" },
              },
            },
          },
        },
        payTo: x402PaymentAddress!,
        maxTimeoutSeconds: Math.floor(x402PaymentTimeoutMs / 1000),
        asset: networkConfig.usdcAddress,
        extra: {
          name: "USD Coin",
          version: "2", // EIP-712 domain version for USDC
        },
      },
    ],
  };
}
