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
import {
  calculateUSDCPrice,
  buildPaymentRequirements,
} from "./x402PricingHelpers";
import { estimateDataItemSize } from "../../utils/createDataItem";

// Number of system tags added by bundler for x402 raw data uploads
// Tags: Bundler, Upload-Type, Payer-Address, X402-TX-Hash,
//       X402-Payment-ID, X402-Network, Upload-Timestamp
const X402_SYSTEM_TAG_COUNT = 7;

/**
 * Get x402 price quote for raw data upload (bundler creates data item)
 *
 * Endpoint: GET /price/x402/data/:token/:byteCount?tags=N&contentType=type
 *
 * This endpoint returns pricing for raw data where the bundler will create
 * the ANS-104 data item wrapper. The final size is estimated by adding:
 * - ANS-104 wrapper overhead (~1.1 KB)
 * - User tags (if provided)
 * - Content-Type tag (if provided)
 * - System tags (7 x402 metadata tags)
 *
 * @example
 * GET /price/x402/data/usdc-base/1024
 * Returns: { x402Version: 1, sizeBreakdown: {...}, accepts: [{...}] }
 *
 * @example
 * GET /price/x402/data/usdc-base/1024?tags=3&contentType=image/png
 * Returns: Pricing with overhead for 3 user tags + Content-Type + 7 system tags
 */
export async function x402RawDataPriceRoute(ctx: KoaContext, next: Next) {
  const { token, byteCount: byteCountParam } = ctx.params;
  const { tags: tagsParam, contentType } = ctx.query;
  const { logger, pricingService } = ctx.state;

  logger.info("Received x402 raw data price request", {
    token,
    byteCount: byteCountParam,
    tags: tagsParam,
    contentType,
  });

  try {
    // 1. Validate and parse raw data byte count
    const rawDataBytes = parseInt(byteCountParam, 10);
    if (isNaN(rawDataBytes) || rawDataBytes <= 0) {
      ctx.status = 400;
      ctx.body = {
        error: "Invalid byte count",
        message: "byteCount must be a positive integer",
      };
      return next();
    }

    // Check max size limit (10 GB)
    const maxSize = 10 * 1024 * 1024 * 1024;
    if (rawDataBytes > maxSize) {
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

    // 3. Parse and validate tags parameter
    let userTagCount = 0;
    if (tagsParam) {
      userTagCount = parseInt(tagsParam as string, 10);
      if (isNaN(userTagCount) || userTagCount < 0) {
        ctx.status = 400;
        ctx.body = {
          error: "Invalid tags parameter",
          message: "tags must be a non-negative integer",
        };
        return next();
      }

      // Reasonable limit on user tags (prevent abuse)
      if (userTagCount > 100) {
        ctx.status = 400;
        ctx.body = {
          error: "Too many tags",
          message: "Maximum 100 user tags allowed",
        };
        return next();
      }
    }

    // 4. Calculate total tag count
    const contentTypeTagCount = contentType ? 1 : 0;
    const systemTagCount = X402_SYSTEM_TAG_COUNT;
    const totalTagCount = userTagCount + contentTypeTagCount + systemTagCount;

    logger.debug("Calculated tag counts", {
      userTagCount,
      contentTypeTagCount,
      systemTagCount,
      totalTagCount,
    });

    // 5. Estimate final data item size (raw data + ANS-104 overhead + tags)
    const estimatedDataItemSize = estimateDataItemSize(
      rawDataBytes,
      totalTagCount
    );
    const ans104Overhead = estimatedDataItemSize - rawDataBytes;

    logger.debug("Estimated data item size", {
      rawDataBytes,
      ans104Overhead,
      estimatedDataItemSize,
      totalTagCount,
    });

    // 6. Calculate USDC price for estimated size
    const usdcAmount = await calculateUSDCPrice(
      estimatedDataItemSize,
      pricingService,
      logger
    );

    logger.debug("Calculated USDC price", {
      estimatedDataItemSize,
      usdcAmount,
      usdcDollars: (parseInt(usdcAmount) / 1e6).toFixed(6),
    });

    // 7. Build payment requirements response
    const response = buildPaymentRequirements(
      usdcAmount,
      tokenInfo.networkConfig,
      tokenInfo.network
    );

    // 8. Add size breakdown for transparency
    (response as any).sizeBreakdown = {
      rawDataBytes,
      ans104Overhead,
      estimatedTotalBytes: estimatedDataItemSize,
      tagCount: {
        user: userTagCount,
        contentType: contentTypeTagCount,
        system: systemTagCount,
        total: totalTagCount,
      },
    };

    // 9. Return 200 OK with payment requirements (per x402 standard)
    ctx.status = 200;
    ctx.set("Content-Type", "application/json");
    ctx.body = response;

    logger.info("Returned x402 raw data price quote", {
      token,
      rawDataBytes,
      estimatedDataItemSize,
      totalTagCount,
      usdcAmount,
      network: tokenInfo.network,
    });
  } catch (error) {
    logger.error("Failed to generate x402 raw data price quote", {
      error: error instanceof Error ? error.message : error,
      stack: error instanceof Error ? error.stack : undefined,
      token,
      byteCount: byteCountParam,
      tags: tagsParam,
      contentType,
    });

    ctx.status = 500;
    ctx.body = {
      error: "Failed to generate price quote",
      message: error instanceof Error ? error.message : "Unknown error",
    };
  }

  return next();
}
