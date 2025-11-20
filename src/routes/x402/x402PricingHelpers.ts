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
 * @returns Object with winstonCost (before conversion) and usdcAmount (in atomic units)
 */
export async function calculateUSDCPrice(
  byteCount: number,
  pricingService: any,
  logger: winston.Logger
): Promise<{ winstonCost: string; usdcAmount: string }> {
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

  let finalUsdcAmount = usdcAmount;

  // Validate parseFloat result (could be NaN if env var is malformed)
  if (isNaN(minimumUsdcWholeDollars) || minimumUsdcWholeDollars < 0) {
    logger.warn("Invalid X402_MINIMUM_PAYMENT_USDC, using default 0.001", {
      envValue: process.env.X402_MINIMUM_PAYMENT_USDC,
    });
    const defaultMinimumAtomicUnits = 1000; // 0.001 USDC
    if (parseInt(usdcAmount) < defaultMinimumAtomicUnits) {
      finalUsdcAmount = defaultMinimumAtomicUnits.toString();
    }
  } else {
    const minimumUsdcAtomicUnits = Math.floor(minimumUsdcWholeDollars * 1e6);

    if (parseInt(usdcAmount) < minimumUsdcAtomicUnits) {
      logger.debug("Applying minimum payment threshold", {
        calculatedAmount: usdcAmount,
        minimumAmount: minimumUsdcAtomicUnits.toString(),
      });
      finalUsdcAmount = minimumUsdcAtomicUnits.toString();
    }
  }

  return {
    winstonCost: winstonWithFee.toString(),
    usdcAmount: finalUsdcAmount,
  };
}

/**
 * Build x402 payment requirements response (matches full AR.IO bundler format)
 *
 * @param params - Parameters for building payment requirements
 * @param params.token - Token string (e.g., "usdc-base")
 * @param params.currency - Currency code (e.g., "usdc")
 * @param params.network - Network name (e.g., "base", "base-sepolia")
 * @param params.byteCount - Number of bytes being priced
 * @param params.winstonCost - Winston cost (before USDC conversion)
 * @param params.usdcAmount - USDC amount in atomic units
 * @param params.networkConfig - x402 network configuration
 * @param params.uploadType - Upload type ("signed data item" | "raw data")
 * @returns x402 payment requirements response matching full bundler format
 */
export function buildPaymentRequirements(params: {
  token: string;
  currency: string;
  network: string;
  byteCount: number;
  winstonCost: string;
  usdcAmount: string;
  networkConfig: X402NetworkConfig;
  uploadType: "signed data item" | "raw data";
}): any {
  const {
    token,
    currency,
    network,
    byteCount,
    winstonCost,
    usdcAmount,
    networkConfig,
    uploadType,
  } = params;

  const publicUrl =
    process.env.UPLOAD_SERVICE_PUBLIC_URL || "http://localhost:3001";

  // Determine resource URL based on upload type
  const resourceUrl =
    uploadType === "signed data item"
      ? `${publicUrl}/v1/x402/upload/signed`
      : `${publicUrl}/x402/upload/unsigned`;

  // Build description with byte count and upload type
  const description = `Upload ${byteCount} bytes (${uploadType}) to Arweave via AR.IO Bundler`;

  // Build payment object (single object, not array)
  const payment = {
    scheme: "exact",
    network,
    maxAmountRequired: usdcAmount,
    resource: resourceUrl,
    description,
    mimeType: "application/json",
    outputSchema: {
      type: "object",
      properties: {
        id: { type: "string" },
        timestamp: { type: "number" },
        owner: { type: "string" },
        x402Payment: { type: "object" },
      },
    },
    payTo: x402PaymentAddress!,
    maxTimeoutSeconds: Math.floor(x402PaymentTimeoutMs / 1000),
    asset: networkConfig.usdcAddress,
    extra: {
      name: "USD Coin",
      version: "2", // EIP-712 domain version for USDC
    },
  };

  // Return response matching full AR.IO bundler format
  return {
    token,
    currency,
    network,
    byteCount,
    winstonCost,
    usdcAmount,
    x402Version: 1,
    payment,
  };
}
