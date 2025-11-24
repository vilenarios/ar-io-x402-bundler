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
import cors from "@koa/cors";
import Koa, { DefaultState, Next, ParameterizedContext } from "koa";

import { Architecture, defaultArchitecture } from "./arch/architecture";
import { OTELExporter } from "./arch/tracing";
import { port as defaultPort } from "./constants";
import globalLogger from "./logger";
import { MetricRegistry } from "./metricRegistry";
import {
  architectureMiddleware,
  loggerMiddleware,
  requestMiddleware,
} from "./middleware";
import router from "./router";
import { getErrorCodeFromErrorObject } from "./utils/common";
import { loadConfig } from "./utils/config";

type KoaState = DefaultState & Architecture;
export type KoaContext = ParameterizedContext<KoaState>;

globalLogger.info(
  `Starting server with node environment ${process.env.NODE_ENV}...`
);

// global error handler
process.on("uncaughtException", (error) => {
  // Determine error code for metrics
  const errorCode = getErrorCodeFromErrorObject(error);

  // Always increment the counter with appropriate error_code label
  MetricRegistry.uncaughtExceptionCounter.inc({ error_code: errorCode });

  globalLogger.error("Uncaught exception:", error);
});

export async function createServer(
  arch: Partial<Architecture>,
  port: number = defaultPort
) {
  // load ssm parameters
  await loadConfig();

  const app = new Koa();
  const uploadDatabase = arch.database ?? defaultArchitecture.database;
  const dataItemOffsetsDB =
    arch.dataItemOffsetsDB ?? defaultArchitecture.dataItemOffsetsDB;
  const objectStore = arch.objectStore ?? defaultArchitecture.objectStore;
  const pricingService = arch.pricingService ?? defaultArchitecture.pricingService;
  const x402Service = arch.x402Service ?? defaultArchitecture.x402Service;
  const cacheService = arch.cacheService ?? defaultArchitecture.cacheService;

  const getArweaveWallet =
    arch.getArweaveWallet ?? defaultArchitecture.getArweaveWallet;
  const getRawDataItemWallet =
    arch.getRawDataItemWallet ?? defaultArchitecture.getRawDataItemWallet;
  const arweaveGateway =
    arch.arweaveGateway ?? defaultArchitecture.arweaveGateway;
  const tracer =
    arch.tracer ??
    new OTELExporter({
      apiKey: process.env.HONEYCOMB_API_KEY,
    }).getTracer("upload-service");

  // attach logger to context including trace id
  app.use(loggerMiddleware);
  // attaches listeners related to request streams for debugging
  app.use(requestMiddleware);
  // Enable CORS for client applications
  // Allow all origins by echoing back the request origin
  app.use(cors({
    credentials: true,
    origin: (ctx) => ctx.request.headers.origin || '*'
  }));
  // attach our primary architecture
  app.use((ctx: KoaContext, next: Next) =>
    architectureMiddleware(ctx, next, {
      database: uploadDatabase,
      dataItemOffsetsDB,
      objectStore,
      cacheService,
      pricingService,
      x402Service,
      arweaveGateway,
      getArweaveWallet,
      getRawDataItemWallet,
      tracer,
    })
  );
  app.use(router.routes());
  // Bind to 0.0.0.0 to accept connections from nginx proxy on separate server
  const server = app.listen(port, '0.0.0.0');
  server.keepAliveTimeout = +(process.env.KEEP_ALIVE_TIMEOUT_MS || 120_000); // intentionally larger than ALB idle timeout
  server.requestTimeout = +(process.env.REQUEST_TIMEOUT_MS || 600_000); // 10 minutes default (for large uploads)
  server.headersTimeout = +(process.env.HEADERS_TIMEOUT_MS || 620_000); // Must be > requestTimeout

  globalLogger.info(`Listening on port ${port}...`);
  globalLogger.info(`x402 USDC payments enabled for stateless uploads`);
  globalLogger.info(`Keep alive timeout: ${server.keepAliveTimeout}ms`);
  globalLogger.info(`Request timeout: ${server.requestTimeout}ms`);
  globalLogger.info(`Headers timeout: ${server.headersTimeout}ms`);
  return server;
}
