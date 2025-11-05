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

/**
 * Migration: Add database indexes for admin dashboard performance
 *
 * Adds indexes on frequently queried columns:
 * - new_data_item: uploaded_date (DESC), signature_type, owner_public_address
 * - planned_data_item: planned_date (DESC), signature_type, owner_public_address
 *
 * These indexes improve performance for:
 * - Today's/week's upload queries
 * - Signature type distribution queries
 * - Top uploaders queries
 * - Recent uploads queries
 */

export async function up(knex: Knex): Promise<void> {
  // Add indexes to new_data_item table (if they don't exist)
  await knex.schema.alterTable('new_data_item', (table) => {
    // uploaded_date already has an index from IndexUploadDateMigrator
    // Add index on signature_type for distribution queries
    table.index('signature_type', 'idx_new_data_items_signature_type');

    // Add index on owner_public_address for unique uploader counts
    table.index('owner_public_address', 'idx_new_data_items_owner');
  });

  // Add indexes to planned_data_item table
  await knex.schema.alterTable('planned_data_item', (table) => {
    // Add index on planned_date for time-based queries
    table.index(['planned_date'], 'idx_planned_data_items_planned_date');

    // Add index on signature_type for distribution queries
    table.index('signature_type', 'idx_planned_data_items_signature_type');

    // Add composite index for top uploaders query (owner + planned_date)
    table.index(['owner_public_address', 'planned_date'], 'idx_planned_data_items_owner_date');
  });

  console.log('✅ Admin dashboard indexes created successfully');
}

export async function down(knex: Knex): Promise<void> {
  // Drop indexes from new_data_item table
  await knex.schema.alterTable('new_data_item', (table) => {
    table.dropIndex('signature_type', 'idx_new_data_items_signature_type');
    table.dropIndex('owner_public_address', 'idx_new_data_items_owner');
  });

  // Drop indexes from planned_data_item table
  await knex.schema.alterTable('planned_data_item', (table) => {
    table.dropIndex(['planned_date'], 'idx_planned_data_items_planned_date');
    table.dropIndex('signature_type', 'idx_planned_data_items_signature_type');
    table.dropIndex(['owner_public_address', 'planned_date'], 'idx_planned_data_items_owner_date');
  });

  console.log('✅ Admin dashboard indexes dropped successfully');
}

