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

/**
 * Cleanup Job Scheduler
 *
 * Schedules the cleanup-fs job to run daily at 2 AM UTC.
 * This removes old filesystem backups and MinIO data according to
 * the retention policies configured in .env:
 * - FILESYSTEM_CLEANUP_DAYS (default: 7 days)
 * - MINIO_CLEANUP_DAYS (default: 90 days)
 */

import { jobLabels } from "../constants";
import logger from "../logger";
import { getQueue } from "../arch/queues/config";

const CLEANUP_CRON = process.env.CLEANUP_CRON || "0 2 * * *"; // 2 AM UTC daily

/**
 * Schedule the cleanup job to run on a recurring basis
 *
 * Uses BullMQ's built-in repeatable jobs feature with cron syntax.
 * The job will automatically repeat according to the cron pattern.
 */
export async function scheduleCleanupJob(): Promise<void> {
  const cleanupQueue = getQueue(jobLabels.cleanupFs);

  try {
    // Add a repeatable job using cron pattern
    await cleanupQueue.add(
      "cleanup-scheduled",
      {}, // Empty payload - handler doesn't need data
      {
        repeat: {
          pattern: CLEANUP_CRON,
        },
        // Don't accumulate jobs if system is down
        jobId: "cleanup-recurring",
      }
    );

    logger.info("Cleanup job scheduled successfully", {
      cron: CLEANUP_CRON,
      jobLabel: jobLabels.cleanupFs,
    });
  } catch (error) {
    logger.error("Failed to schedule cleanup job", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

/**
 * Remove the scheduled cleanup job
 * (Useful for testing or reconfiguration)
 */
export async function unscheduleCleanupJob(): Promise<void> {
  const cleanupQueue = getQueue(jobLabels.cleanupFs);

  try {
    await cleanupQueue.removeRepeatable("cleanup-scheduled", {
      pattern: CLEANUP_CRON,
    });

    logger.info("Cleanup job unscheduled successfully");
  } catch (error) {
    logger.warn("Failed to unschedule cleanup job", {
      error: error instanceof Error ? error.message : String(error),
    });
  }
}
