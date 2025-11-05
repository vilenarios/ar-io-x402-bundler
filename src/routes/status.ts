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

import { KoaContext } from "../server";
import { DataItemOffsetsInfo } from "../types/types";

const pendingCacheAgeSeconds = 15;
const permanentCacheAgeSeconds = 86_400; // 1 day in seconds

export async function statusHandler(ctx: KoaContext, next: Next) {
  const { logger, database, dataItemOffsetsDB } = ctx.state;

  try {
    // Await both promises concurrently
    const [offset, info] = await Promise.all([
      dataItemOffsetsDB.getOffset(ctx.params.id),
      database.getDataItemInfo(ctx.params.id),
    ]);

    if (info === undefined) {
      ctx.status = 404;
      ctx.body = "TX doesn't exist";
      return next();
    }

    const cacheControlAgeSeconds =
      info.status === "permanent"
        ? permanentCacheAgeSeconds
        : pendingCacheAgeSeconds;
    ctx.set("Cache-Control", `public, max-age=${cacheControlAgeSeconds}`);

    // Map PostgreSQL column names to camelCase and excise dataItemId and rootBundleId from the response
    let offsetsInfo:
      | Omit<DataItemOffsetsInfo, "dataItemId" | "rootBundleId">
      | undefined;
    if (offset) {
      const maybeOffsetsInfo: DataItemOffsetsInfo = {
        dataItemId: offset.data_item_id,
        rootBundleId: offset.root_bundle_id,
        rawContentLength: offset.raw_content_length,
        payloadContentType: offset.payload_content_type ?? "application/octet-stream",
        payloadDataStart: offset.payload_data_start,
        startOffsetInRootBundle: offset.start_offset_in_root_bundle,
        parentDataItemId: offset.parent_data_item_id,
        startOffsetInParentDataItemPayload:
          offset.start_offset_in_parent_data_item_payload,
      };
      const { dataItemId, rootBundleId, ...rest } = maybeOffsetsInfo;
      offsetsInfo = rest;

      // Validate that info db and offsets db agree on the root bundle ID
      if (rootBundleId !== info.bundleId) {
        logger.warn(`Root bundle ID mismatch!`, {
          dataItemId,
          dbRootBundleId: info.bundleId,
          offsetsRootBundleId: rootBundleId,
        });
        // Excise the startOffsetInRootBundle since it may not be accurate
        const { startOffsetInRootBundle, ...restWithoutStartOffset } =
          offsetsInfo;
        offsetsInfo = restWithoutStartOffset;
      }
    }

    ctx.body = {
      status:
        info.status === "permanent"
          ? "FINALIZED"
          : info.status === "failed"
          ? "FAILED"
          : "CONFIRMED",
      bundleId: info.bundleId,
      info: info.status,
      ...offsetsInfo,
      payloadContentLength: offsetsInfo
        ? offsetsInfo.rawContentLength - offsetsInfo.payloadDataStart
        : undefined,
      winc: info.assessedWinstonPrice,
      reason: info.failedReason,
    };
  } catch (error) {
    logger.error(`Error getting data item status: ${error}`);
    ctx.status = 503;
    ctx.body = "Internal Server Error";
  }

  return next();
}
