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

import { KoaContext } from "../../server";
import { parseToken, getEnabledTokens } from "../../utils/x402TokenMapping";
import { calculateUSDCPrice, buildPaymentRequirements } from "./x402PricingHelpers";

/**
 * Get x402 price quote for signed data item upload
 *
 * Endpoint: GET /price/x402/data-item/:token/:byteCount
 *
 * This endpoint returns pricing for a complete, signed ANS-104 data item.
 * The byte count should be the exact size of the data item (no overhead added).
 *
 * @example
 * GET /price/x402/data-item/usdc-base/2048
 * Returns: { x402Version: 1, accepts: [{...}] }
 */
export async function x402DataItemPriceRoute(ctx: KoaContext, next: Next) {
  const { token, byteCount: byteCountParam } = ctx.params;
  const { logger, pricingService } = ctx.state;

  logger.info("Received x402 data item price request", { token, byteCount: byteCountParam });

  try {
    // 1. Validate and parse byte count
    const byteCount = parseInt(byteCountParam, 10);
    if (isNaN(byteCount) || byteCount <= 0) {
      ctx.status = 400;
      ctx.body = {
        error: "Invalid byte count",
        message: "byteCount must be a positive integer",
      };
      return next();
    }

    // Check max size limit (10 GB)
    const maxSize = 10 * 1024 * 1024 * 1024;
    if (byteCount > maxSize) {
      ctx.status = 400;
      ctx.body = {
        error: "Byte count exceeds maximum",
        message: `Maximum byte count is ${maxSize} (10 GB)`,
      };
      return next();
    }

    // 2. Parse and validate token
    const tokenInfo = parseToken(token);
    if (!tokenInfo) {
      const enabledTokens = getEnabledTokens();
      ctx.status = 400;
      ctx.body = {
        error: "Invalid or unsupported token",
        token,
        supported: enabledTokens,
        message: `Token must be in format: {currency}-{network}. Example: usdc-base`,
      };
      return next();
    }

    logger.debug("Parsed token successfully", {
      token,
      currency: tokenInfo.currency,
      network: tokenInfo.network,
    });

    // 3. Calculate USDC price for exact byte count (no overhead)
    const { winstonCost, usdcAmount } = await calculateUSDCPrice(
      byteCount,
      pricingService,
      logger
    );

    logger.debug("Calculated USDC price", {
      byteCount,
      winstonCost,
      usdcAmount,
      usdcDollars: (parseInt(usdcAmount) / 1e6).toFixed(6),
    });

    // 4. Build payment requirements response (matches full AR.IO bundler format)
    const response = buildPaymentRequirements({
      token,
      currency: tokenInfo.currency,
      network: tokenInfo.network,
      byteCount,
      winstonCost,
      usdcAmount,
      networkConfig: tokenInfo.networkConfig,
      uploadType: "signed data item",
    });

    // 5. Return 200 OK with payment requirements (per x402 standard)
    ctx.status = 200;
    ctx.set("Content-Type", "application/json");
    ctx.body = response;

    logger.info("Returned x402 data item price quote", {
      token,
      byteCount,
      winstonCost,
      usdcAmount,
      network: tokenInfo.network,
    });
  } catch (error) {
    logger.error("Failed to generate x402 data item price quote", {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      token,
      byteCount: byteCountParam,
    });

    ctx.status = 500;
    ctx.body = {
      error: "Failed to generate price quote",
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }

  return next();
}
