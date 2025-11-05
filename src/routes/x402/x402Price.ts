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
import { Next } from "koa";

import {
  x402Networks,
  x402PaymentAddress,
  x402PaymentTimeoutMs,
  x402PricingBufferPercent,
  cdpClientKey,
  multipartDepositUSDC,
} from "../../constants";
import { BadQueryParam } from "../../utils/errors";
import { X402PricingOracle } from "../../x402/x402PricingOracle";
import { KoaContext } from "../../server";
import { UserAddressType } from "../../types/dbTypes";
import { ByteCount, W } from "../../types/types";
import { X402PaymentRequiredResponse } from "../../arch/x402Service";
import { generatePaywallHtml } from "./x402PaywallHtml";

/**
 * Get x402 payment requirements for an upload
 * GET /v1/x402/price/:signatureType/:address?bytes=1024 (single upload)
 * GET /v1/x402/price/:signatureType/:address?deposit=true (multipart deposit)
 * GET /v1/x402/price/:signatureType/:address?uploadId=xxx (multipart finalization)
 */
export async function x402PriceRoute(ctx: KoaContext, next: Next) {
  const logger = ctx.state.logger;
  const { pricingService, database } = ctx.state;

  const { signatureType: signatureTypeParam, address } = ctx.params;
  const { bytes: bytesParam, uploadId, deposit: depositParam } = ctx.query;

  // Validate parameters: must have bytes or deposit
  // Note: uploadId support removed for MVP - client should declare bytes for finalization
  const paramCount = [bytesParam, depositParam].filter(Boolean).length;
  if (paramCount === 0) {
    ctx.status = 400;
    ctx.body = { error: "Missing 'bytes' or 'deposit' query parameter" };
    return next();
  }

  if (paramCount > 1) {
    ctx.status = 400;
    ctx.body = { error: "Can only specify one of: 'bytes' or 'deposit'" };
    return next();
  }

  let byteCount: number | null = null;
  let isDeposit = false;

  // Handle deposit pricing (multipart creation)
  if (depositParam === "true") {
    isDeposit = true;
    logger.debug("Generating deposit price quote", { depositUSDC: multipartDepositUSDC });
  }
  // Get byte count from bytes param (single upload or multipart finalization)
  else if (bytesParam && typeof bytesParam === "string") {
    byteCount = parseInt(bytesParam, 10);
    if (isNaN(byteCount) || byteCount <= 0) {
      throw new BadQueryParam("Invalid byte count");
    }
  } else {
    ctx.status = 400;
    ctx.body = { error: "Invalid parameter type" };
    return next();
  }

  // Determine address type from signature type
  const signatureType = parseInt(signatureTypeParam, 10);
  let addressType: UserAddressType;

  switch (signatureType) {
    case 1:
      addressType = "arweave";
      break;
    case 3:
      addressType = "ethereum";
      break;
    case 4:
      addressType = "solana";
      break;
    default:
      addressType = "arweave";
  }

  logger.debug("Getting x402 price quote", {
    address,
    addressType,
    byteCount,
    isDeposit,
  });

  try {
    let usdcAmount: string;

    // For deposit pricing, use fixed amount
    if (isDeposit) {
      // Convert deposit amount to USDC atomic units (6 decimals)
      usdcAmount = (multipartDepositUSDC * 1_000_000).toString();
      logger.debug("Using fixed deposit amount", { multipartDepositUSDC, usdcAmount });
    }
    // For byte-based pricing, calculate from Winston cost
    else if (byteCount !== null) {
      // Get pricing from pricing service (Winston cost)
      const { reward: winstonPrice } =
        await pricingService.getTxAttributesForDataItems([
          { byteCount: byteCount as ByteCount, signatureType },
        ]);

      // Add pricing buffer for volatility and fees
      const winstonWithBuffer = Math.ceil(
        winstonPrice * (1 + x402PricingBufferPercent / 100)
      );

      // Convert Winston to USDC
      const x402Oracle = new X402PricingOracle();
      usdcAmount = await x402Oracle.getUSDCForWinston(
        W(winstonWithBuffer.toString())
      );
    } else {
      throw new Error("byteCount is null and not a deposit request");
    }

    // Generate payment requirements for all enabled networks
    const enabledNetworks = Object.entries(x402Networks).filter(
      ([, config]) => config.enabled
    );

    if (enabledNetworks.length === 0) {
      ctx.status = 503;
      ctx.body = { error: "x402 payments are not currently available" };
      return next();
    }

    const accepts = enabledNetworks.map(([networkName, config]) => ({
      scheme: "exact",
      network: networkName,
      maxAmountRequired: usdcAmount,
      resource: "/v1/tx",
      description: "Upload data to Arweave via AR.IO Bundler",
      mimeType: "application/json",
      outputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Data item ID" },
          timestamp: { type: "number", description: "Upload timestamp in milliseconds" },
          owner: { type: "string", description: "Normalized wallet address" },
          deadlineHeight: { type: "number", description: "Deadline block height" },
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
      asset: config.usdcAddress,
      extra: {
        name: "USD Coin",
        version: "2", // EIP-712 domain version for USDC
      },
    }));

    const response: X402PaymentRequiredResponse = {
      x402Version: 1,
      accepts,
    };

    logger.info("Returning x402 price quote", {
      address,
      byteCount: byteCount ?? "N/A (deposit)",
      isDeposit,
      usdcAmount,
      networksAvailable: enabledNetworks.length,
    });

    // Browser detection: Check if client expects HTML response
    // Per x402 standard: price quote endpoints return 200 OK (not 402)
    // 402 is only for the actual protected resource (upload endpoint)
    const acceptHeader = ctx.get("Accept") || "";
    const userAgent = ctx.get("User-Agent") || "";
    const isBrowserRequest =
      acceptHeader.includes("text/html") && userAgent.includes("Mozilla");

    // For browser clients, return HTML paywall (if configured)
    // For API clients, return JSON payment requirements
    if (isBrowserRequest && cdpClientKey) {
      logger.debug("Returning HTML paywall for browser client", {
        hasOnramp: !!cdpClientKey,
      });

      // Per x402 standard: price quotes return 200 OK, not 402
      // The 402 response happens at the upload endpoint when payment is required
      ctx.status = 200;
      ctx.set("Content-Type", "text/html");
      ctx.body = generatePaywallHtml({
        paymentRequirement: accepts[0], // Use first enabled network
        cdpClientKey: cdpClientKey,
        appName: "AR.IO Bundler",
        // appLogo can be added via env var if desired
      });

      return next();
    }

    // Standard x402 payment requirements JSON for API clients
    // Per x402 standard: price quote endpoint returns 200 OK with payment requirements
    // The actual 402 response happens when client uploads without payment
    ctx.status = 200;
    ctx.set("Content-Type", "application/json");
    ctx.body = response;
  } catch (error) {
    logger.error("Failed to generate x402 price quote", { error });
    ctx.status = 500;
    ctx.body = {
      error: "Failed to generate price quote",
      details: error instanceof Error ? error.message : "Unknown error",
    };
  }

  return next();
}
