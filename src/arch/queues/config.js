"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.closeAllQueues = exports.getQueue = exports.QUEUE_NAMES = void 0;
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
const bullmq_1 = require("bullmq");
const constants_1 = require("../../constants");
const redis_1 = require("./redis");
exports.QUEUE_NAMES = {
    [constants_1.jobLabels.planBundle]: "upload-plan-bundle",
    [constants_1.jobLabels.prepareBundle]: "upload-prepare-bundle",
    [constants_1.jobLabels.postBundle]: "upload-post-bundle",
    [constants_1.jobLabels.seedBundle]: "upload-seed-bundle",
    [constants_1.jobLabels.verifyBundle]: "upload-verify-bundle",
    [constants_1.jobLabels.putOffsets]: "upload-put-offsets",
    [constants_1.jobLabels.newDataItem]: "upload-new-data-item",
    [constants_1.jobLabels.opticalPost]: "upload-optical-post",
    [constants_1.jobLabels.unbundleBdi]: "upload-unbundle-bdi",
    [constants_1.jobLabels.finalizeUpload]: "upload-finalize-upload",
    [constants_1.jobLabels.cleanupFs]: "upload-cleanup-fs",
};
const defaultQueueOptions = {
    connection: (0, redis_1.createRedisConnection)(),
    defaultJobOptions: {
        attempts: 3,
        backoff: {
            type: "exponential",
            delay: 5000,
        },
        removeOnComplete: {
            count: 1000,
            age: 86400, // 24 hours
        },
        removeOnFail: {
            count: 5000,
            age: 604800, // 7 days
        },
    },
};
const queueInstances = new Map();
function getQueue(jobLabel) {
    const queueName = exports.QUEUE_NAMES[jobLabel];
    if (!queueInstances.has(queueName)) {
        queueInstances.set(queueName, new bullmq_1.Queue(queueName, defaultQueueOptions));
    }
    return queueInstances.get(queueName);
}
exports.getQueue = getQueue;
async function closeAllQueues() {
    await Promise.all(Array.from(queueInstances.values()).map((queue) => queue.close()));
    queueInstances.clear();
}
exports.closeAllQueues = closeAllQueues;
