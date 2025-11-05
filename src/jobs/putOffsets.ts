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
import { Knex } from "knex";
import winston from "winston";

import { DataItemOffsetsDB } from "../arch/db/dataItemOffsets";
import { DataItemOffsetsInfo } from "../types/types";

/**
 * Handler for processing messages containing offset data and writing them to PostgreSQL.
 *
 * Business Logic:
 * 1. Parse the message body to extract an array of offset objects.
 * 2. Validate that offsets are present; log and throw if missing.
 * 3. Determine the TTL (time-to-live) for the offset records from configuration.
 * 4. Map offset data to PostgreSQL format.
 * 5. Write offsets to PostgreSQL in batches of 500 (much larger than DynamoDB's 25-item limit).
 */
export async function putOffsetsHandler(
  offsets: DataItemOffsetsInfo[],
  database: Knex,
  logger: winston.Logger
) {
  if (!offsets || offsets.length === 0) {
    logger.error("No offsets found in message body");
    throw new Error("No offsets to write");
  }

  // TTL from environment variable (default: 365 days = 31536000 seconds)
  const ttlSeconds = parseInt(process.env.POSTGRES_OFFSETS_TTL_SECS || "31536000", 10);
  const expiresAt = Math.floor(Date.now() / 1000) + ttlSeconds;

  logger.info("Putting offsets into PostgreSQL...", {
    offsetsCount: offsets.length,
    expiresAt,
  });

  // Map to PostgreSQL format
  const offsetsDB = new DataItemOffsetsDB(database, logger);
  const offsetsToWrite = offsets.map((offset) => ({
    data_item_id: offset.dataItemId,
    root_bundle_id: offset.rootBundleId ?? "", // Provide empty string if undefined
    start_offset_in_root_bundle: offset.startOffsetInRootBundle ?? 0,
    raw_content_length: offset.rawContentLength,
    payload_data_start: offset.payloadDataStart,
    payload_content_type: offset.payloadContentType,
    parent_data_item_id: offset.parentDataItemId ?? undefined,
    start_offset_in_parent_data_item_payload:
      offset.startOffsetInParentDataItemPayload ?? undefined,
    expires_at: expiresAt,
  }));

  try {
    // PostgreSQL can handle batches of 500 items (20x DynamoDB's limit)
    await offsetsDB.putOffsets(offsetsToWrite);
    logger.info("Successfully wrote offsets to PostgreSQL", {
      count: offsetsToWrite.length,
    });
  } catch (error) {
    logger.error("Error putting offsets into PostgreSQL", { error });
    throw error;
  }
}
