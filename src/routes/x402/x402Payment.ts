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
  defaultX402PaymentMode,
  x402PaymentModes,
  x402PaymentTimeoutMs,
  x402PricingBufferPercent,
} from "../../constants";
import { UserAddressType, X402PaymentMode } from "../../types/dbTypes";
import { X402PaymentError } from "../../utils/errors";
import { X402PricingOracle } from "../../x402/x402PricingOracle";
import { KoaContext } from "../../server";
import { ByteCount, DataItemId } from "../../types/types";
import { W } from "../../types/winston";

/**
 * Process an x402 payment
 * POST /v1/x402/payment/:signatureType/:address
 * Body: { paymentHeader, dataItemId?, uploadId?, byteCount?, mode? }
 */
export async function x402PaymentRoute(ctx: KoaContext, next: Next) {
  const logger = ctx.state.logger;
  const { paymentDatabase, pricingService, x402Service } = ctx.state;

  const { signatureType: signatureTypeParam, address } = ctx.params;
  const {
    paymentHeader,
    dataItemId,
    uploadId,
    byteCount: byteCountParam,
    mode: modeParam,
  } = (ctx.request as any).body as {
    paymentHeader: string;
    dataItemId?: string;
    uploadId?: string;
    byteCount?: number;
    mode?: string;
  };

  // Validate parameters
  if (!paymentHeader || typeof paymentHeader !== "string") {
    throw new X402PaymentError("Missing or invalid paymentHeader");
  }

  // Must have either dataItemId OR uploadId
  if (!dataItemId && !uploadId) {
    throw new X402PaymentError(
      "Either dataItemId or uploadId is required"
    );
  }

  if (dataItemId && uploadId) {
    throw new X402PaymentError(
      "Cannot specify both dataItemId and uploadId"
    );
  }

  const mode: X402PaymentMode =
    modeParam && x402PaymentModes.includes(modeParam as X402PaymentMode)
      ? (modeParam as X402PaymentMode)
      : defaultX402PaymentMode;

  // Validate mode-specific requirements
  // Note: dataItemId is optional for PAYG (will be linked after data item creation)
  if ((mode === "payg" || mode === "hybrid") && !byteCountParam) {
    throw new X402PaymentError(
      "byteCount is required for PAYG and hybrid modes"
    );
  }

  // Hybrid mode still requires dataItemId upfront (for existing flow compatibility)
  if (mode === "hybrid" && !dataItemId) {
    throw new X402PaymentError(
      "dataItemId is required for hybrid mode"
    );
  }

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

  const byteCount = byteCountParam ? (byteCountParam as ByteCount) : undefined;

  logger.info("Processing x402 payment", {
    address,
    addressType,
    mode,
    dataItemId,
    byteCount,
  });

  try {
    // Calculate pricing for the upload (if PAYG/hybrid)
    let winstonCost = W("0");
    let usdcAmountRequired = "0";

    if (byteCount) {
      const { reward: winstonPrice } =
        await pricingService.getTxAttributesForDataItems([
          { byteCount, signatureType },
        ]);

      // Add pricing buffer
      winstonCost = W(
        Math.ceil(winstonPrice * (1 + x402PricingBufferPercent / 100)).toString()
      );

      // Convert to USDC
      const x402Oracle = new X402PricingOracle();
      usdcAmountRequired = await x402Oracle.getUSDCForWinston(winstonCost);
    }

    // Decode payment header to extract payment details
    const paymentPayload = JSON.parse(
      Buffer.from(paymentHeader, "base64").toString("utf-8")
    );

    const { authorization } = paymentPayload.payload;
    const network = paymentPayload.network;
    const tokenAddress = paymentPayload.asset || authorization.to; // Fallback to 'to' address

    // Verify the network is enabled
    if (!x402Service.isNetworkEnabled(network)) {
      ctx.status = 400;
      ctx.body = {
        error: `Network ${network} is not enabled`,
        enabledNetworks: x402Service.getEnabledNetworks(),
      };
      return next();
    }

    const networkConfig = x402Service.getNetworkConfig(network);
    if (!networkConfig) {
      throw new Error(`Network configuration not found for ${network}`);
    }

    // Build absolute URL for resource (required by x402 facilitator)
    // Use configured public URL for the upload service
    const uploadServicePublicUrl = process.env.UPLOAD_SERVICE_PUBLIC_URL || "http://localhost:3001";
    const resourceUrl = `${uploadServicePublicUrl}/v1/tx`;

    // Build payment requirements for verification
    const requirements = {
      scheme: "exact",
      network,
      maxAmountRequired: mode === "topup" ? authorization.value : usdcAmountRequired,
      resource: resourceUrl,
      description: `Upload ${byteCount || 0} bytes to Arweave via Turbo`,
      mimeType: "application/octet-stream",
      asset: networkConfig.usdcAddress,
      payTo: authorization.to,
      maxTimeoutSeconds: Math.floor(x402PaymentTimeoutMs / 1000),
      extra: {
        name: "USD Coin",
        version: "2",
      },
    };

    // Verify the payment
    logger.debug("Verifying x402 payment", { requirements });
    const verification = await x402Service.verifyPayment(
      paymentHeader,
      requirements
    );

    if (!verification.isValid) {
      logger.warn("X402 payment verification failed", {
        address,
        reason: verification.invalidReason,
      });

      ctx.status = 402;
      ctx.body = {
        error: verification.invalidReason || "Payment verification failed",
        x402Version: 1,
        accepts: [requirements],
      };
      return next();
    }

    // Settle the payment on-chain
    logger.info("Settling x402 payment", { network, address });
    const settlement = await x402Service.settlePayment(
      paymentHeader,
      requirements
    );

    if (!settlement.success) {
      logger.error("X402 payment settlement failed", {
        address,
        error: settlement.error,
      });

      ctx.status = 503;
      ctx.body = {
        error: "Payment settlement failed",
        details: settlement.error,
      };
      return next();
    }

    // Convert USDC paid to Winston
    const x402Oracle = new X402PricingOracle();
    const wincPaid = await x402Oracle.getWinstonForUSDC(authorization.value);

    // Create payment transaction record
    const payment = await paymentDatabase.createX402Payment({
      userAddress: address,
      userAddressType: addressType,
      txHash: settlement.transactionHash!,
      network,
      tokenAddress,
      usdcAmount: authorization.value,
      wincAmount: wincPaid,
      mode,
      dataItemId: dataItemId as DataItemId | undefined,
      uploadId: uploadId as string | undefined,
      declaredByteCount: byteCount,
      payerAddress: authorization.from,
    });

    // Handle different modes
    let wincReserved = W("0");
    let wincCredited = W("0");

    if (mode === "payg") {
      // Pay-as-you-go: Reserve winc for this specific data item
      wincReserved = winstonCost;

      // Only create reservation if dataItemId exists
      // For x402 raw uploads, reservation is created later via link endpoint
      if (dataItemId) {
        await paymentDatabase.createX402PaymentReservation({
          dataItemId: dataItemId as DataItemId,
          x402PaymentId: payment.id,
          wincReserved,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(), // 1 hour
        });

        logger.info("Created x402 PAYG reservation", {
          dataItemId,
          wincReserved,
        });
      } else {
        logger.info("x402 PAYG payment settled - reservation will be created on link", {
          paymentId: payment.id,
          wincReserved,
        });
      }
    } else if (mode === "topup") {
      // Top-up: Credit entire amount to user's balance
      wincCredited = wincPaid;

      await paymentDatabase.adjustUserWinstonBalance({
        userAddress: address,
        userAddressType: addressType,
        winstonAmount: wincCredited,
        changeReason: "x402_topup",
        changeId: payment.id,
      });

      logger.info("X402 top-up - credited balance", {
        address,
        wincCredited,
        paymentId: payment.id,
      });
    } else {
      // Hybrid: Reserve for data item, credit excess
      wincReserved = winstonCost;
      wincCredited = wincPaid.minus(winstonCost);

      if (wincReserved.isGreaterThan(W(0))) {
        await paymentDatabase.createX402PaymentReservation({
          dataItemId: dataItemId as DataItemId,
          x402PaymentId: payment.id,
          wincReserved,
          expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        });
      }

      if (wincCredited.isGreaterThan(W(0))) {
        // Credit excess to balance
        await paymentDatabase.adjustUserWinstonBalance({
          userAddress: address,
          userAddressType: addressType,
          winstonAmount: wincCredited,
          changeReason: "x402_hybrid_excess",
          changeId: payment.id,
        });

        logger.info("X402 hybrid - credited excess", {
          address,
          wincCredited,
          paymentId: payment.id,
        });
      }
    }

    logger.info("X402 payment successful", {
      address,
      mode,
      txHash: settlement.transactionHash,
      wincPaid,
      wincReserved,
      wincCredited,
    });

    ctx.status = 200;
    ctx.body = {
      success: true,
      paymentId: payment.id,
      txHash: settlement.transactionHash,
      network: network,
      wincPaid,
      wincReserved: wincReserved.toString(),
      wincCredited: wincCredited.toString(),
      mode,
      dataItemId: dataItemId || undefined,
      uploadId: uploadId || undefined,
    };
  } catch (error) {
    logger.error("X402 payment processing failed", {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    });
    ctx.status = 500;
    ctx.body = {
      error: "Payment processing failed",
      details: error instanceof Error ? error.message : "Unknown error",
    };
  }

  return next();
}
