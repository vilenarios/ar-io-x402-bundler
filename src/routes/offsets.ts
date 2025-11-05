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

export async function offsetsHandler(ctx: KoaContext, next: Next) {
  const { logger, dataItemOffsetsDB } = ctx.state;

  try {
    const offset = await dataItemOffsetsDB.getOffset(ctx.params.id);
    if (!offset) {
      ctx.status = 404;
      ctx.body = "TX doesn't exist";
      return next();
    }

    // TODO: Decide whether to use the database to help provide for longer cache durations (e.g. when data is permanent)
    const cacheControlAgeSeconds = 60;
    ctx.set("Cache-Control", `public, max-age=${cacheControlAgeSeconds}`);

    // Map PostgreSQL column names to API response format
    ctx.body = {
      dataItemId: offset.data_item_id,
      rootBundleId: offset.root_bundle_id,
      startOffsetInRootBundle: offset.start_offset_in_root_bundle,
      rawContentLength: offset.raw_content_length,
      payloadDataStart: offset.payload_data_start,
      payloadContentType: offset.payload_content_type,
      parentDataItemId: offset.parent_data_item_id,
      startOffsetInParentDataItemPayload:
        offset.start_offset_in_parent_data_item_payload,
      payloadContentLength:
        offset.raw_content_length - offset.payload_data_start,
    };
  } catch (error) {
    logger.error(`Error getting data item offsets: ${error}`);
    ctx.status = 503;
    ctx.body = "Internal Server Error";
  }

  return next();
}
