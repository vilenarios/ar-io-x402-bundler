"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.closeRedisConnection = exports.createRedisConnection = void 0;
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
const ioredis_1 = __importDefault(require("ioredis"));
let redisConnection = null;
function createRedisConnection() {
    if (!redisConnection) {
        redisConnection = new ioredis_1.default({
            host: process.env.REDIS_HOST || "localhost",
            port: parseInt(process.env.REDIS_PORT_QUEUES || "6381"),
            maxRetriesPerRequest: null,
            retryStrategy: (times) => {
                const delay = Math.min(times * 50, 2000);
                return delay;
            },
        });
    }
    return redisConnection;
}
exports.createRedisConnection = createRedisConnection;
function closeRedisConnection() {
    if (redisConnection) {
        redisConnection.disconnect();
        redisConnection = null;
    }
}
exports.closeRedisConnection = closeRedisConnection;
