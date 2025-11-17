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
 * BullMQ Workers for AR.IO x402 Bundler
 *
 * This file creates and starts all BullMQ worker instances.
 * Each queue has a dedicated worker that processes jobs asynchronously.
 *
 * Workers use the job handler functions exported from each job file.
 * The handlers accept job.data and process the work using the default architecture.
 */

import { Job, Worker, WorkerOptions } from "bullmq";

import { createRedisConnection } from "../arch/queues/redis";
import { QUEUE_NAMES } from "../arch/queues/config";
import { jobLabels } from "../constants";
import globalLogger from "../logger";

const logger = globalLogger.child({ service: "workers" });

// Worker configuration
const defaultWorkerOptions: Omit<WorkerOptions, "connection"> = {
  concurrency: 1, // Process one job at a time by default
  limiter: {
    max: 10, // Max 10 jobs per duration
    duration: 1000, // 1 second
  },
};

// Track all workers for graceful shutdown
const workers: Worker[] = [];

/**
 * Create a BullMQ worker for a specific queue
 *
 * Each worker processes jobs by calling the appropriate handler.
 * Handlers are imported dynamically to avoid circular dependencies.
 */
function createWorker(
  queueLabel: keyof typeof QUEUE_NAMES,
  processor: (job: Job) => Promise<void>,
  options: Partial<WorkerOptions> = {}
): Worker {
  const queueName = QUEUE_NAMES[queueLabel];
  const workerLogger = logger.child({ queue: queueName });

  const worker = new Worker(
    queueName,
    async (job: Job) => {
      workerLogger.info("Processing job", {
        jobId: job.id,
        jobName: job.name,
        attempt: job.attemptsMade + 1,
      });

      try {
        await processor(job);
        workerLogger.info("Job completed successfully", {
          jobId: job.id,
          jobName: job.name,
        });
      } catch (error) {
        workerLogger.error("Job failed", {
          jobId: job.id,
          jobName: job.name,
          error: error instanceof Error ? error.message : String(error),
          stack: error instanceof Error ? error.stack : undefined,
        });
        throw error; // Re-throw to let BullMQ handle retries
      }
    },
    {
      connection: createRedisConnection(),
      ...defaultWorkerOptions,
      ...options,
    }
  );

  // Event handlers
  worker.on("completed", (job) => {
    workerLogger.debug("Job completed event", { jobId: job.id });
  });

  worker.on("failed", (job, err) => {
    workerLogger.error("Job failed event", {
      jobId: job?.id,
      error: err.message,
    });
  });

  worker.on("error", (err) => {
    workerLogger.error("Worker error", { error: err.message });
  });

  workers.push(worker);
  return worker;
}

/**
 * Start all workers
 *
 * Note: Job handlers are lazy-loaded to avoid import issues.
 * Each handler exports a simple function that processes the job data.
 */
export async function startAllWorkers(): Promise<void> {
  logger.info("Starting all BullMQ workers...");

  // Import job handlers dynamically
  const { newDataItemBatchInsertHandler } = await import("./newDataItemBatchInsert");
  const { handler: planHandler } = await import("./plan");
  const { handler: verifyHandler } = await import("./verify");
  const { handler: cleanupHandler } = await import("./cleanup-fs");

  // New Data Item Worker - Processes uploads
  createWorker(
    jobLabels.newDataItem,
    async (job) => {
      const { defaultArchitecture } = await import("../arch/architecture");
      await newDataItemBatchInsertHandler({
        dataItemBatch: [job.data],
        logger: logger.child({ job: "new-data-item" }),
        uploadDatabase: defaultArchitecture.database,
      });
    },
    { concurrency: 5 }
  );

  // Plan Bundle Worker
  createWorker(
    jobLabels.planBundle,
    async (_job) => {
      await planHandler();
    },
    { concurrency: 1 }
  );

  // Verify Bundle Worker
  createWorker(
    jobLabels.verifyBundle,
    async (_job) => {
      await verifyHandler();
    },
    { concurrency: 2 }
  );

  // Cleanup Filesystem Worker
  createWorker(
    jobLabels.cleanupFs,
    async (_job) => {
      await cleanupHandler();
    },
    { concurrency: 1 }
  );

  logger.info(`Started ${workers.length} BullMQ workers`);
  logger.warn("Note: Some workers (prepare, post, seed, optical-post, unbundle-bdi, put-offsets, finalize-upload) are not yet implemented");
  logger.warn("Jobs for these queues will remain pending until workers are added");
}

/**
 * Graceful shutdown of all workers
 */
export async function stopAllWorkers(): Promise<void> {
  logger.info("Stopping all BullMQ workers...");

  await Promise.all(
    workers.map(async (worker) => {
      logger.info(`Closing worker for queue: ${worker.name}`);
      await worker.close();
    })
  );

  logger.info("All workers stopped");
}

// Graceful shutdown on SIGTERM/SIGINT
process.on("SIGTERM", async () => {
  logger.info("Received SIGTERM, shutting down workers gracefully...");
  await stopAllWorkers();
  process.exit(0);
});

process.on("SIGINT", async () => {
  logger.info("Received SIGINT, shutting down workers gracefully...");
  await stopAllWorkers();
  process.exit(0);
});

// Handle uncaught errors
process.on("uncaughtException", (error) => {
  logger.error("Uncaught exception in worker process", {
    error: error.message,
    stack: error.stack,
  });
  process.exit(1);
});

process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled rejection in worker process", {
    reason: String(reason),
  });
  process.exit(1);
});

// Start workers if this file is run directly
if (require.main === module) {
  logger.info("Starting AR.IO x402 Bundler workers...");
  startAllWorkers().catch((error) => {
    logger.error("Failed to start workers", {
      error: error.message,
      stack: error.stack,
    });
    process.exit(1);
  });
}
