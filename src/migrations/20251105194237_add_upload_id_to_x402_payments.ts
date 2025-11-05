/**
 * Add upload_id support to x402_payments for multipart uploads
 *
 * This allows payments to be linked to uploadId before dataItemId exists,
 * enabling x402 payment verification at multipart finalization time.
 */
import type { Knex } from "knex";

export async function up(knex: Knex): Promise<void> {
  await knex.schema.alterTable("x402_payments", (table) => {
    // Add upload_id column for multipart upload payments
    table.string("upload_id", 255).nullable().index();

    // Add constraint: must have either data_item_id OR upload_id
    // (We'll check this in application logic since Postgres CHECK constraints
    // with OR are complex and we want clear error messages)
  });
}

export async function down(knex: Knex): Promise<void> {
  await knex.schema.alterTable("x402_payments", (table) => {
    table.dropColumn("upload_id");
  });
}

