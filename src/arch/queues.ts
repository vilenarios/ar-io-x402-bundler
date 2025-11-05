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
import { jobLabels } from "../constants";
import { UnbundleBDIMessageBody } from "../jobs/unbundle-bdi";
import { PlanId, PostedNewDataItem } from "../types/dbTypes";
import { DataItemOffsetsInfo, UploadId } from "../types/types";
import { DatedSignedDataItemHeader } from "../utils/opticalUtils";
import { getQueue } from "./queues/config";

type PlanMessage = { planId: PlanId };

export type EnqueuedNewDataItem = Omit<PostedNewDataItem, "signature"> & {
  signature: string;
};
export type EnqueueFinalizeUpload = {
  uploadId: UploadId;
  token: string;
  paidBy?: string[];
};
export type EnqueuedOffsetsBatch = {
  offsets: DataItemOffsetsInfo[];
};
type QueueTypeToMessageType = {
  [jobLabels.planBundle]: PlanMessage;
  [jobLabels.prepareBundle]: PlanMessage;
  [jobLabels.postBundle]: PlanMessage;
  [jobLabels.seedBundle]: PlanMessage;
  [jobLabels.verifyBundle]: PlanMessage;
  [jobLabels.opticalPost]: DatedSignedDataItemHeader;
  [jobLabels.unbundleBdi]: UnbundleBDIMessageBody;
  [jobLabels.finalizeUpload]: EnqueueFinalizeUpload;
  [jobLabels.newDataItem]: EnqueuedNewDataItem;
  [jobLabels.putOffsets]: EnqueuedOffsetsBatch;
  [jobLabels.cleanupFs]: Record<string, never>;
};

export type QueueType = keyof QueueTypeToMessageType;

export const enqueue = async <T extends QueueType>(
  queueType: T,
  message: QueueTypeToMessageType[T],
  options?: { delay?: number; timeout?: number }
) => {
  const queue = getQueue(queueType);

  // Special handling for long-running jobs
  const jobOptions: Record<string, unknown> = {};
  if (queueType === jobLabels.seedBundle) {
    jobOptions.timeout = 300000; // 5 minutes for seed jobs
  }

  // Apply custom options if provided
  if (options?.delay) {
    jobOptions.delay = options.delay;
  }
  if (options?.timeout) {
    jobOptions.timeout = options.timeout;
  }

  await queue.add(queueType, message, jobOptions);
};

export const enqueueBatch = async <T extends QueueType>(
  queueType: T,
  messages: QueueTypeToMessageType[T][]
) => {
  if (messages.length === 0) return;

  const queue = getQueue(queueType);
  await queue.addBulk(
    messages.map((message) => ({
      name: queueType,
      data: message,
    }))
  );
};

// BullMQ workers will automatically acknowledge completed jobs
// Workers are created in src/workers/ directory and managed via PM2
