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
import Router from "koa-router";
import * as promClient from "prom-client";

import { MetricRegistry } from "./metricRegistry";
import { dataItemRoute, signedDataItemRoute, unsignedDataItemRoute } from "./routes/dataItemPost";
import { rootResponse } from "./routes/info";
import {
  createMultiPartUpload,
  finalizeMultipartUploadWithHttpRequest,
  getMultipartUpload,
  getMultipartUploadStatus,
  postDataItemChunk,
} from "./routes/multiPartUploads";
import { offsetsHandler } from "./routes/offsets";
import { statusHandler } from "./routes/status";
import { swaggerDocs, swaggerDocsJSON } from "./routes/swagger";
import { x402PaymentRoute } from "./routes/x402/x402Payment";
import { x402PriceRoute } from "./routes/x402/x402Price";
import { x402DataItemPriceRoute } from "./routes/x402/x402DataItemPrice";
import { x402RawDataPriceRoute } from "./routes/x402/x402RawDataPrice";
import { KoaContext } from "./server";

const metricsRegistry = MetricRegistry.getInstance().getRegistry();
promClient.collectDefaultMetrics({ register: metricsRegistry });

const router = new Router() as any;

// Publish to both root and v1 for convenience, but root might be deprecated or iterate in the future
const serveRoutesAndV1 = (path: string[]) =>
  path.flatMap((p) => [p, `/v1${p}`]);

// ========================================
// Upload Endpoints (x402-only)
// ========================================

// 1. EXPLICIT ROUTES (Recommended - clear intent)
// -------------------------------------------------
// Signed ANS-104 data item upload (explicit)
// - Requires x402 payment via X-PAYMENT header OR whitelisted wallet
// - Client provides pre-signed ANS-104 data item
router.post(serveRoutesAndV1(["/x402/upload/signed"]), signedDataItemRoute);
router.post(serveRoutesAndV1(["/x402/data-item/signed"]), signedDataItemRoute);

// Unsigned raw data upload (explicit)
// - ALWAYS requires x402 payment (no whitelist exemption)
// - Server signs the data item using rawDataItemWallet
// - Supports JSON envelope or binary + X-Tag-* headers
router.post(serveRoutesAndV1(["/x402/upload/unsigned"]), unsignedDataItemRoute);

// 2. BACKWARDS COMPATIBILITY ROUTES (Auto-detection)
// -------------------------------------------------
// Legacy upload endpoints with smart detection
// - Auto-detects signed ANS-104 vs unsigned raw data
// - For signed: same as /x402/upload/signed
// - For unsigned: same as /x402/upload/unsigned (if RAW_DATA_UPLOADS_ENABLED=true)
router.post(serveRoutesAndV1(["/tx", "/tx/:token"]), dataItemRoute);

// ========================================
// x402 Payment Routes
// ========================================
// Legacy 3-stage flow (kept for backward compatibility)
router.get("/v1/x402/price/:signatureType/:address", x402PriceRoute);
router.post("/v1/x402/payment/:signatureType/:address", x402PaymentRoute);

// Turbo-style token-based pricing (recommended)
router.get("/price/x402/data-item/:token/:byteCount", x402DataItemPriceRoute);
router.get("/price/x402/data/:token/:byteCount", x402RawDataPriceRoute);
router.get("/v1/price/x402/data-item/:token/:byteCount", x402DataItemPriceRoute);
router.get("/v1/price/x402/data/:token/:byteCount", x402RawDataPriceRoute);

/**
 * START TEMPORARY PATCH TO SUPPORT up.arweave.net
 */
router.get(["/price/:foo/:bar", "/price/:bar"], (ctx: KoaContext, next: Next) => {
  ctx.body = "0.0000000000000";
  return next();
});

router.get("/account/balance/:rest", (ctx: KoaContext, next: Next) => {
  ctx.body = "99999999999999999999999999999999999999";
  return next();
});
/**
 * END TEMPORARY PATCH TO SUPPORT up.arweave.net
 */

// Status routes
router.get(serveRoutesAndV1(["/tx/:id/status"]), statusHandler);
router.get(serveRoutesAndV1(["/tx/:id/offsets"]), offsetsHandler);

// Multi-part upload routes with x402 payment at finalization
router.get(serveRoutesAndV1(["/chunks/:token/-1/-1"]), createMultiPartUpload);
router.get(
  serveRoutesAndV1(["/chunks/:token/:uploadId/-1"]),
  getMultipartUpload
);
router.get(
  serveRoutesAndV1(["/chunks/:token/:uploadId/status"]),
  getMultipartUploadStatus
);
router.post(
  serveRoutesAndV1(["/chunks/:token/:uploadId/-1"]),
  finalizeMultipartUploadWithHttpRequest
);
router.post(
  serveRoutesAndV1(["/chunks/:token/:uploadId/finalize"]),
  (ctx: KoaContext) => {
    ctx.state.asyncValidation = true;
    return finalizeMultipartUploadWithHttpRequest(ctx);
  }
);
router.post(
  serveRoutesAndV1(["/chunks/:token/:uploadId/:chunkOffset"]),
  postDataItemChunk
);

// info routes
router.get(serveRoutesAndV1(["/", "/info"]), rootResponse);

// Prometheus
router.get("/bundler_metrics", async (ctx: KoaContext, next: Next) => {
  ctx.body = await metricsRegistry.metrics();
  return next();
});

// healthcheck
router.get("/health", (ctx: KoaContext, next: Next) => {
  ctx.body = "OK";
  return next();
});

// Swagger
router.get("/openapi.json", swaggerDocsJSON);
router.get("/api-docs", swaggerDocs);

export default router;
