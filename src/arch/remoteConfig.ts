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
import globalLogger from "../logger";

const configSpec = {
  cacheReadDataItemSamplingRate: {
    default: 1.0,
    env: "CACHE_READ_DATA_ITEM_SAMPLING_RATE",
  },
  cacheWriteDataItemSamplingRate: {
    default: 1.0,
    env: "CACHE_WRITE_DATA_ITEM_SAMPLING_RATE",
  },
  cacheWriteDataItemTtlSecs: {
    default: 3600,
    env: "CACHE_WRITE_DATA_ITEM_TTL_SECS",
  },
  cacheWriteNestedDataItemSamplingRate: {
    default: 1.0,
    env: "CACHE_WRITE_NESTED_DATA_ITEM_SAMPLING_RATE",
  },
  cacheWriteNestedDataItemTtlSecs: {
    default: 3600,
    env: "CACHE_WRITE_NESTED_DATA_ITEM_TTL_SECS",
  },
  cacheDataItemBytesThreshold: {
    default: 256 * 1024, // 256 KiB
    env: "CACHE_DATAITEM_BYTES_THRESHOLD",
  },
  fsBackupWriteDataItemSamplingRate: {
    default: 1.0,
    env: "FS_BACKUP_WRITE_DATA_ITEM_SAMPLING_RATE",
  },
  fsBackupWriteNestedDataItemSamplingRate: {
    default: 1.0,
    env: "FS_BACKUP_WRITE_NESTED_DATA_ITEM_SAMPLING_RATE",
  },
  objStoreDataItemSamplingRate: {
    default: 1.0,
    env: "OBJ_STORE_DATA_ITEM_SAMPLING_RATE",
  },
  objStoreNestedDataItemSamplingRate: {
    default: 1.0,
    env: "OBJ_STORE_NESTED_DATA_ITEM_SAMPLING_RATE",
  },
  inFlightDataItemTtlSecs: { default: 60, env: "IN_FLIGHT_DATA_ITEM_TTL_SECS" },
} as const;

type ConfigSpec = typeof configSpec;
export type UploadSvcConfig = {
  [K in keyof ConfigSpec]: number;
};
export type ConfigKey = keyof UploadSvcConfig;

export const ConfigKeys = Object.fromEntries(
  Object.keys(configSpec).map((k) => [k, k])
) as { [K in ConfigKey]: K };

const defaultRemoteConfig: UploadSvcConfig = Object.fromEntries(
  Object.entries(configSpec).map(([key, { default: def, env }]) => {
    const raw = process.env[env];
    const parsed = raw !== undefined ? Number(raw) : def;
    return [key, isNaN(parsed) ? def : parsed];
  })
) as UploadSvcConfig;

const configListeners = new Map<ConfigKey, Set<(value: number) => void>>();

function notifyListeners(updated: UploadSvcConfig) {
  for (const key of Object.keys(updated) as ConfigKey[]) {
    const newValue = updated[key];
    const listeners = configListeners.get(key);
    if (listeners) {
      for (const cb of listeners) {
        try {
          cb(newValue);
        } catch (err) {
          globalLogger.error("Config listener callback failed", { key, err });
        }
      }
    }
  }
}

// AWS SSM integration removed - using environment variables only
// Configuration is now loaded directly from process.env and cached in memory

let cachedConfig: UploadSvcConfig = defaultRemoteConfig;

export async function getConfigValue<K extends ConfigKey>(
  key: K
): Promise<UploadSvcConfig[K]> {
  return cachedConfig[key];
}

// Reload configuration from environment variables
export function reloadConfig(): void {
  const newConfig = Object.fromEntries(
    Object.entries(configSpec).map(([key, { default: def, env }]) => {
      const raw = process.env[env];
      const parsed = raw !== undefined ? Number(raw) : def;
      return [key, isNaN(parsed) ? def : parsed];
    })
  ) as UploadSvcConfig;

  globalLogger.info("Reloaded configuration from environment", {
    latestCfg: newConfig,
    prevCfg: cachedConfig,
  });

  cachedConfig = newConfig;
  notifyListeners(newConfig);
}

export function onConfigChange<K extends ConfigKey>(
  key: K,
  cb: (value: UploadSvcConfig[K]) => void
): void {
  const listeners = configListeners.get(key);
  if (listeners) {
    listeners.add(cb);
  } else {
    configListeners.set(key, new Set([cb]));
  }
}
