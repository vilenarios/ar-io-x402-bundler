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
import { Tag, processStream } from "@dha-team/arbundles";
import { Next } from "koa";

// x402-only bundler - all traditional payment service code removed

import { enqueue } from "../arch/queues";
import { isANS104DataItem } from "../utils/rawDataUtils";
import { handleRawDataUpload } from "./rawDataPost";
import {
  DataItemInterface,
  InMemoryDataItem,
  StreamingDataItem,
} from "../bundles/streamingDataItem";
import { signatureTypeInfo } from "../constants";
import {
  anchorLength,
  blocklistedAddresses,
  dataCaches,
  deadlineHeightIncrement,
  emptyAnchorLength,
  emptyTargetLength,
  fastFinalityIndexes,
  jobLabels,
  maxSingleDataItemByteCount,
  octetStreamContentType,
  receiptVersion,
  signatureTypeLength,
  skipOpticalPostAddresses,
  targetLength,
} from "../constants";
import globalLogger from "../logger";
import { MetricRegistry } from "../metricRegistry";
import { KoaContext } from "../server";
import { ParsedDataItemHeader, SignatureConfig } from "../types/types";
import { W } from "../types/winston";
import {
  errorResponse,
  filterKeysFromObject,
  getPremiumFeatureType,
  payloadContentTypeFromDecodedTags,
  sleep,
} from "../utils/common";
import {
  ValidDataItemStore,
  allValidDataItemStores,
  cacheDataItem,
  dataItemExists,
  quarantineDataItem,
  streamsForDataItemStorage,
} from "../utils/dataItemUtils";
import {
  DataItemExistsWarning,
  InsufficientBalance,
} from "../utils/errors";
import {
  UPLOAD_DATA_PATH,
  ensureDataItemsBackupDirExists,
} from "../utils/fileSystemUtils";
import {
  dataItemIsInFlight,
  markInFlight,
  removeFromInFlight,
} from "../utils/inFlightDataItemCache";
import {
  containsAns104Tags,
  encodeTagsForOptical,
  signDataItemHeader,
} from "../utils/opticalUtils";
import { ownerToNativeAddress } from "../utils/ownerToNativeAddress";
import {
  SignedReceipt,
  UnsignedReceipt,
  signReceipt,
} from "../utils/signReceipt";
import { streamToBuffer } from "../utils/streamToBuffer";

// x402-only: No balance checks needed - payment verified directly via x402 protocol
const opticalBridgingEnabled = process.env.OPTICAL_BRIDGING_ENABLED !== "false";
ensureDataItemsBackupDirExists().catch((error) => {
  globalLogger.error(
    `Failed to create upload data directory at ${UPLOAD_DATA_PATH}!`,
    { error }
  );
  throw error;
});

export const inMemoryDataItemThreshold = 10 * 1024; // 10 KiB

export async function dataItemRoute(ctx: KoaContext, next: Next) {
  let { logger } = ctx.state;

  // Smart detection: Check if this is raw data or a signed ANS-104 data item
  // For raw data uploads (enabled via feature flag), we handle differently
  const rawDataUploadsEnabled = process.env.RAW_DATA_UPLOADS_ENABLED === "true";

  if (rawDataUploadsEnabled) {
    // Peek at request to determine if it's ANS-104 or raw data
    // Strategy: Check for X-Tag-* headers or non-octet-stream Content-Type
    const contentType = ctx.req.headers?.["content-type"];
    const hasCustomTags = Object.keys(ctx.req.headers).some((key) =>
      key.toLowerCase().startsWith("x-tag-")
    );

    // If it has custom tags or is JSON, it's likely raw data upload
    // If Content-Type is not application/octet-stream, it's likely raw data
    const likelyRawData = hasCustomTags ||
      (contentType && contentType !== octetStreamContentType && contentType !== "application/octet-stream");

    if (likelyRawData) {
      logger.info("Detected raw data upload request (non-ANS104)");
      // Buffer the entire body for raw data handling
      const chunks: Buffer[] = [];
      for await (const chunk of ctx.req) {
        chunks.push(chunk);
      }
      const rawBody = Buffer.concat(chunks);

      // Verify it's not actually ANS-104
      if (!isANS104DataItem(rawBody)) {
        return handleRawDataUpload(ctx, rawBody);
      }

      // False positive - it's actually ANS-104, continue with normal flow
      logger.info("False positive on raw data detection, proceeding as ANS-104");
      // Need to recreate the stream since we consumed it
      // For now, create a readable stream from the buffer
      const { Readable } = await import("stream");
      ctx.request.req = Readable.from(rawBody) as any;
    }
  }

  const durations = {
    totalDuration: 0,
    cacheDuration: 0,
    extractDuration: 0,
    dbInsertDuration: 0,
  };

  const token = ctx.params.token;
  let signatureTypeOverride: number | undefined;
  if (token === "kyve") {
    signatureTypeOverride = SignatureConfig.KYVE;
  }

  const requestStartTime = Date.now();
  const {
    objectStore,
    cacheService,
    arweaveGateway,
    getArweaveWallet,
    database,
  } = ctx.state;

  // Validate the content-length header
  const contentLengthStr = ctx.req.headers?.["content-length"];
  const rawContentLength = contentLengthStr ? +contentLengthStr : undefined;
  if (rawContentLength === undefined) {
    logger.debug("Request has no content length header!");
  } else if (rawContentLength > maxSingleDataItemByteCount) {
    return errorResponse(ctx, {
      errorMessage: `Data item is too large, this service only accepts data items up to ${maxSingleDataItemByteCount} bytes!`,
    });
  }

  // Inspect, but do not validate, the content-type header
  const requestContentType = ctx.req.headers?.["content-type"];

  if (!requestContentType) {
    logger.debug("Missing request content type!");
  } else if (requestContentType !== octetStreamContentType) {
    // Allow non-octet-stream for raw data uploads (already handled above)
    if (!rawDataUploadsEnabled) {
      errorResponse(ctx, {
        errorMessage: "Invalid Content Type",
      });
      return next();
    }
  }

  // x402-bundler-lite: No payment headers needed
  // Payment handled separately via x402 API routes

  // Duplicate the request body stream. The original will go to the data item
  // event emitter. This one will go to the object store.
  ctx.request.req.pause();

  const { cacheServiceStream, fsBackupStream, objStoreStream } =
    await streamsForDataItemStorage({
      inputStream: ctx.request.req,
      contentLength: rawContentLength,
      logger,
      cacheService,
    });

  // Require that at least 1 durable store stream be present
  const haveDurableStream = (fsBackupStream || objStoreStream) !== undefined;
  if (!haveDurableStream) {
    errorResponse(ctx, {
      status: 503,
      errorMessage:
        "No durable storage stream available. Cannot proceed with upload.",
    });
    return next();
  }

  // Create a streaming data item with the request body
  const streamingDataItem: DataItemInterface =
    rawContentLength !== undefined &&
    rawContentLength <= inMemoryDataItemThreshold
      ? new InMemoryDataItem(
          await streamToBuffer(ctx.request.req, rawContentLength)
        )
      : new StreamingDataItem(ctx.request.req, logger);
  ctx.request.req.resume();

  // Assess a Winston price and/or whitelist-status for this upload once
  // enough data item info has streamed to the data item event emitter
  let signatureType: number;
  let signature: string;
  let owner: string;
  let ownerPublicAddress: string;
  let dataItemId: string;
  let targetPublicAddress: string | undefined;

  try {
    signatureType = await streamingDataItem.getSignatureType();
    signature = await streamingDataItem.getSignature();
    owner = await streamingDataItem.getOwner();
    ownerPublicAddress = await streamingDataItem.getOwnerAddress();
    targetPublicAddress = await streamingDataItem.getTarget();

    dataItemId = await streamingDataItem.getDataItemId();

    if (signatureTypeOverride !== undefined) {
      logger.debug("Overriding signature type from token route...");
      signatureType = signatureTypeOverride;
    }

    logger = logger.child({
      signatureType,
      ownerPublicAddress,
      dataItemId,
    });
  } catch (error) {
    errorResponse(ctx, {
      errorMessage: "Data item parsing error!",
      error,
    });

    return next();
  }

  const nativeAddress = ownerToNativeAddress(owner, signatureType);
  logger = logger.child({ nativeAddress });

  // Catch duplicate data item attacks via in memory cache (for single instance of service)
  if (await dataItemIsInFlight({ dataItemId, cacheService, logger })) {
    // create the error for consistent responses
    const error = new DataItemExistsWarning(dataItemId);
    logger.warn("Data item already uploaded to this service instance.");
    MetricRegistry.localCacheDataItemHit.inc();
    ctx.status = 202;
    ctx.res.statusMessage = error.message;
    return next();
  }
  logger.debug(
    `Data item ${dataItemId} is not in-flight. Proceeding with upload...`
  );
  await markInFlight({ dataItemId, cacheService, logger });

  // x402-bundler-lite: No inline payment verification
  // Users handle payment separately via x402 API routes (/v1/x402/price, /v1/x402/payment)
  logger.debug("x402-bundler-lite: Proceeding with upload without payment verification");

  // Parse out the content type and the payload stream
  let payloadContentType: string;
  let payloadDataStart: number;
  let anchor: string | undefined;
  let target: string | undefined;
  let tags: Tag[];
  try {
    // Log some useful debugging info
    anchor = await streamingDataItem.getAnchor();
    target = await streamingDataItem.getTarget();
    const numTags = await streamingDataItem.getNumTags();
    const numTagsBytes = await streamingDataItem.getNumTagsBytes();
    tags = await streamingDataItem.getTags();
    payloadContentType = payloadContentTypeFromDecodedTags(tags);

    // Log tags and other useful info for log parsing
    logger = logger.child({
      payloadContentType,
      numTags,
      tags,
    });
    logger.debug(`Data Item parsed, awaiting payload stream...`, {
      numTagsBytes,
      anchor,
      target,
    });

    const tagsStart =
      signatureTypeLength +
      signatureTypeInfo[signatureType].signatureLength +
      signatureTypeInfo[signatureType].pubkeyLength +
      (target === undefined ? emptyTargetLength : targetLength) +
      (anchor === undefined ? emptyAnchorLength : anchorLength);
    payloadDataStart = tagsStart + 16 + numTagsBytes;
  } catch (error) {
    await removeFromInFlight({ dataItemId, cacheService, logger });
    errorResponse(ctx, {
      errorMessage: "Data item parsing error!",
      error,
    });

    return next();
  }

  const plannedStores = allValidDataItemStores.filter(
    (_, i) => [cacheServiceStream, fsBackupStream, objStoreStream][i]
  );
  let actualStores: ValidDataItemStore[] = [];
  try {
    actualStores = await cacheDataItem({
      streamingDataItem,
      rawContentLength,
      payloadContentType,
      payloadDataStart,
      cacheService,
      objectStore,
      cacheServiceStream,
      fsBackupStream,
      objStoreStream,
      logger,
      durations,
    });
  } catch (error) {
    await removeFromInFlight({ dataItemId, cacheService, logger });
    errorResponse(ctx, {
      status: 503,
      errorMessage: `Data Item: ${dataItemId}. Upload Service is Unavailable. Object Store is unreachable`,
      error,
    });

    return next();
  }

  logger.debug(`Assessing data item validity...`);
  const performQuarantine = async (errRspData: {
    errorMessage?: string;
    status?: number;
    error?: unknown;
  }) => {
    await quarantineDataItem({
      dataItemId,
      objectStore,
      cacheService,
      database,
      logger,
      contentLength: rawContentLength,
      contentType: requestContentType,
      payloadInfo:
        payloadContentType && payloadDataStart
          ? {
              payloadContentType,
              payloadDataStart,
            }
          : undefined,
    }).catch((error) => {
      logger.error("Remove data item failed!", { error });
    });

    errorResponse(ctx, errRspData);
  };
  let isValid: boolean;
  try {
    isValid = await streamingDataItem.isValid();
  } catch (error) {
    await removeFromInFlight({ dataItemId, cacheService, logger });
    await performQuarantine({
      errorMessage: "Data item parsing error!",
      error,
    });
    return next();
  }
  logger.debug(`Got data item validity.`, { isValid });
  if (!isValid) {
    await removeFromInFlight({ dataItemId, cacheService, logger });
    await performQuarantine({
      errorMessage: "Invalid Data Item!",
    });
    return next();
  }

  // NOTE: Safe to get payload size now that payload has been fully consumed
  const payloadDataByteCount = await streamingDataItem.getPayloadSize();
  const totalSize = payloadDataByteCount + payloadDataStart;

  // x402-bundler-lite: No payment finalization needed
  // Payment handled separately via x402 API routes

  if (totalSize > maxSingleDataItemByteCount) {
    await removeFromInFlight({ dataItemId, cacheService, logger });
    await performQuarantine({
      errorMessage: `Data item is too large, this service only accepts data items up to ${maxSingleDataItemByteCount} bytes!`,
    });
    return next();
  }

  if (blocklistedAddresses.includes(ownerPublicAddress)) {
    logger.info(
      "The owner's address is on the arweave public address block list. Rejecting data item..."
    );
    await removeFromInFlight({ dataItemId, cacheService, logger });
    await performQuarantine({
      status: 403,
      errorMessage: "Forbidden",
    });
    return next();
  }

  // TODO: Check arweave gateway cached blocklist for address

  // TODO: Configure via SSM Parameter Store
  const spammerContentLength = +(process.env.SPAMMER_CONTENT_LENGTH ?? 100372);
  if (
    rawContentLength &&
    rawContentLength === spammerContentLength &&
    tags.length === 0
  ) {
    logger.info(
      "Incoming data item matches known spammer pattern. No tags and content length of 100372 bytes. Rejecting data item..."
    );
    await removeFromInFlight({ dataItemId, cacheService, logger });
    await performQuarantine({
      status: 403,
      errorMessage: "Forbidden",
    });
    return next();
  }

  // x402-only: Payment already verified and settled - cost is $0 (paid via USDC)
  const assessedWinstonPrice = W(0); // x402 payments settled directly in USDC

  const uploadTimestamp = Date.now();

  // Enqueue data item for optical bridging
  const confirmedFeatures: {
    dataCaches: string[];
    fastFinalityIndexes: string[];
  } = {
    dataCaches,
    fastFinalityIndexes: [],
  };
  try {
    if (
      opticalBridgingEnabled &&
      !skipOpticalPostAddresses.includes(ownerPublicAddress)
    ) {
      logger.debug("Enqueuing data item to optical...");
      const signedDataItemHeader = await signDataItemHeader(
        encodeTagsForOptical({
          id: dataItemId,
          signature,
          owner,
          owner_address: ownerPublicAddress,
          target: target ?? "",
          content_type: payloadContentType,
          data_size: payloadDataByteCount,
          tags,
        })
      );

      await enqueue(jobLabels.opticalPost, {
        ...signedDataItemHeader,
        uploaded_at: uploadTimestamp,
      });
      confirmedFeatures.fastFinalityIndexes = fastFinalityIndexes;
    } else {
      // Attach skip feature to logger for log parsing in final receipt log statement
      logger = logger.child({ skipOpticalPost: true });
    }
  } catch (opticalError) {
    // Soft error, just log
    logger.error(
      `Error while attempting to enqueue for optical bridging!`,
      opticalError
    );
    MetricRegistry.opticalBridgeEnqueueFail.inc();
  }

  // Enqueue data item for unbundling if it appears to be a BDI
  if (containsAns104Tags(tags)) {
    try {
      logger.debug("Enqueuing BDI for unbundling...");
      await enqueue(jobLabels.unbundleBdi, {
        id: dataItemId,
        uploaded_at: uploadTimestamp,
      });
    } catch (bdiEnqueueError) {
      // Soft error, just log
      logger.error(
        `Error while attempting to enqueue for bdi unbundling!`,
        bdiEnqueueError
      );
      MetricRegistry.unbundleBdiEnqueueFail.inc();
    }
  }

  let signedReceipt: SignedReceipt;
  let deadlineHeight: number;
  try {
    // Ensure at least 1 store still has the data item before signing the receipt
    if (!(await dataItemExists(dataItemId, cacheService, objectStore))) {
      throw new Error(`Data item not found in any store.`);
    }

    // TODO: Make failure here less dire when nodes are struggling, e.g. via static or remote cache
    const currentBlockHeight = await arweaveGateway.getCurrentBlockHeight();
    const jwk = await getArweaveWallet();

    deadlineHeight = currentBlockHeight + deadlineHeightIncrement;
    const receipt: UnsignedReceipt = {
      id: dataItemId,
      timestamp: uploadTimestamp,
      winc: assessedWinstonPrice.toString(),
      version: receiptVersion,
      deadlineHeight,
      ...confirmedFeatures,
    };
    signedReceipt = await signReceipt(receipt, jwk);
    // Log the signed receipt for log parsing
    logger.info("Receipt signed!", {
      ...filterKeysFromObject(signedReceipt, ["public", "signature"]),
      plannedStores,
      actualStores,
    });
  } catch (error) {
    // x402-only: No refunds needed - payment already settled via USDC
    await removeFromInFlight({ dataItemId, cacheService, logger });
    await performQuarantine({
      status: 503,
      errorMessage: `Data Item: ${dataItemId}. Upload Service is Unavailable. Unable to sign receipt...`,
      error,
    });

    return next();
  }

  let nestedDataItemHeaders: ParsedDataItemHeader[] = [];
  if (
    streamingDataItem instanceof InMemoryDataItem &&
    containsAns104Tags(tags)
  ) {
    // For in memory BDIs, get a payload stream and unbundle it into nested data item headers only one level deep
    nestedDataItemHeaders = (await processStream(
      await streamingDataItem.getPayloadStream()
    )) as ParsedDataItemHeader[];
  }

  const premiumFeatureType = getPremiumFeatureType(
    ownerPublicAddress,
    tags,
    signatureType,
    nestedDataItemHeaders,
    targetPublicAddress
  );

  const dbInsertStart = Date.now();
  try {
    await enqueue(jobLabels.newDataItem, {
      dataItemId,
      ownerPublicAddress,
      assessedWinstonPrice,
      byteCount: totalSize,
      payloadDataStart,
      signatureType,
      failedBundles: [],
      uploadedDate: new Date(uploadTimestamp).toISOString(),
      payloadContentType,
      premiumFeatureType,
      signature,
      deadlineHeight,
    });

    // Anticipate 20ms of replication delay. Modicum of protection against caller checking status immediately after returning
    // TODO: Add status fetching from valkey to eliminate need for this
    await sleep(20);

    durations.dbInsertDuration = Date.now() - dbInsertStart;
    logger.debug(`DB insert duration: ${durations.dbInsertDuration}ms`);
  } catch (error) {
    logger.debug(`DB insert failed duration: ${Date.now() - dbInsertStart}ms`);

    // x402-only: No refunds needed - payment already settled via USDC
    // always remove from instance cache
    await removeFromInFlight({ dataItemId, cacheService, logger });
    await performQuarantine({
      status: 503,
      errorMessage: `Data Item: ${dataItemId}. Upload Service is Unavailable.`,
      error,
    });
    return next();
  }

  ctx.status = 200;
  ctx.body = {
    ...signedReceipt,
    owner: ownerPublicAddress,
  };

  await removeFromInFlight({ dataItemId, cacheService, logger });

  durations.totalDuration = Date.now() - requestStartTime;
  // TODO: our logger middleware now captures total request time, so these can logs can be removed if they are not being used for any reporting/alerting
  logger.debug(`Total request duration: ${durations.totalDuration}ms`);
  logger.debug(`Durations (ms):`, durations);

  // Avoid DIV0
  if (durations.totalDuration > 0) {
    // Compute what proportion of total request time each step took
    const proportionalDurations = Object.entries(durations).reduce(
      (acc, [key, duration]) => {
        acc[key + "Pct"] = duration / durations.totalDuration;
        return acc;
      },
      {} as Record<string, number>
    );
    logger.debug(`Duration proportions:`, proportionalDurations);

    const toMiBPerSec = 1000 / 1048576;
    const throughputs = {
      totalThroughput: (totalSize / durations.totalDuration) * toMiBPerSec,
      cacheThroughput: (totalSize / durations.cacheDuration) * toMiBPerSec,
      extractThroughput: (totalSize / durations.extractDuration) * toMiBPerSec,
    };
    logger.debug(`Throughputs (MiB/sec):`, throughputs);
  }

  return next();
}
