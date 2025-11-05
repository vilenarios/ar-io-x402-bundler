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

export interface DataItemOffset {
  data_item_id: string;
  root_bundle_id: string;
  start_offset_in_root_bundle: number;
  raw_content_length: number;
  payload_data_start: number;
  payload_content_type?: string;
  parent_data_item_id?: string;
  start_offset_in_parent_data_item_payload?: number;
  expires_at?: number;
}

export class DataItemOffsetsDB {
  constructor(
    private knex: Knex,
    private logger: winston.Logger
  ) {}

  async putOffsets(offsets: DataItemOffset[]): Promise<void> {
    if (offsets.length === 0) return;

    // PostgreSQL can handle much larger batches than DynamoDB (no 25-item limit)
    const batchSize = 500;

    for (let i = 0; i < offsets.length; i += batchSize) {
      const batch = offsets.slice(i, i + batchSize);

      await this.knex("data_item_offsets")
        .insert(batch)
        .onConflict("data_item_id")
        .merge(); // Update if exists

      this.logger.debug(`Inserted ${batch.length} offsets to PostgreSQL`, {
        batchNumber: Math.floor(i / batchSize) + 1,
        totalBatches: Math.ceil(offsets.length / batchSize),
      });
    }
  }

  async getOffset(dataItemId: string): Promise<DataItemOffset | undefined> {
    const result = await this.knex("data_item_offsets")
      .where({ data_item_id: dataItemId })
      .first();

    return result;
  }

  async getOffsetsByRootBundle(rootBundleId: string): Promise<DataItemOffset[]> {
    return this.knex("data_item_offsets")
      .where({ root_bundle_id: rootBundleId })
      .orderBy("start_offset_in_root_bundle", "asc");
  }

  async deleteExpiredOffsets(): Promise<number> {
    const now = Math.floor(Date.now() / 1000);

    const deleted = await this.knex("data_item_offsets")
      .where("expires_at", "<", now)
      .whereNotNull("expires_at")
      .delete();

    this.logger.info(`Deleted ${deleted} expired offsets from PostgreSQL`);
    return deleted;
  }
}
