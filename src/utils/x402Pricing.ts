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
import axios from "axios";

import logger from "../logger";
import { W, Winston } from "../types/types";

const x402PricingBufferPercent = 10; // 10% buffer for price fluctuations

/**
 * Simple x402 pricing oracle for converting Winston to USDC
 */
export class X402PricingOracle {
  private arPriceCache: { price: number; timestamp: number } | null = null;
  private cacheDuration = 60000; // 1 minute cache

  /**
   * Get current AR price in USD from CoinGecko
   */
  private async getArPriceInUSD(): Promise<number> {
    // Check cache
    if (
      this.arPriceCache &&
      Date.now() - this.arPriceCache.timestamp < this.cacheDuration
    ) {
      return this.arPriceCache.price;
    }

    try {
      const response = await axios.get(
        "https://api.coingecko.com/api/v3/simple/price?ids=arweave&vs_currencies=usd",
        { timeout: 5000 }
      );

      const price = response.data?.arweave?.usd;
      if (!price || typeof price !== "number") {
        throw new Error("Invalid price response from CoinGecko");
      }

      // Update cache
      this.arPriceCache = { price, timestamp: Date.now() };
      logger.debug("Fetched AR price from CoinGecko", { price });

      return price;
    } catch (error) {
      logger.error("Failed to fetch AR price from CoinGecko", { error });

      // Fallback to cached price if available
      if (this.arPriceCache) {
        logger.warn("Using stale AR price from cache", {
          price: this.arPriceCache.price,
          age: Date.now() - this.arPriceCache.timestamp,
        });
        return this.arPriceCache.price;
      }

      // Ultimate fallback
      logger.warn("Using fallback AR price of $20");
      return 20; // Fallback price
    }
  }

  /**
   * Convert Winston to USDC atomic units (6 decimals)
   * @param winston - Amount in Winston (10^-12 AR)
   * @returns USDC amount in atomic units (10^-6 USDC)
   */
  async getUSDCForWinston(winston: Winston): Promise<string> {
    const arPriceUSD = await this.getArPriceInUSD();

    // Convert Winston to AR (1 AR = 10^12 Winston)
    const arAmount = Number(winston.toString()) / 1e12;

    // Convert AR to USD
    const usdAmount = arAmount * arPriceUSD;

    // Add pricing buffer to account for price fluctuations
    const bufferedUsdAmount = usdAmount * (1 + x402PricingBufferPercent / 100);

    // Convert USD to USDC atomic units (1 USDC = 10^6 atomic units)
    const usdcAtomicUnits = Math.ceil(bufferedUsdAmount * 1e6);

    // Ensure minimum of 0.1 cent (1000 atomic units = 0.001 USDC)
    const minUsdcAtomicUnits = 1000;
    const finalAmount = Math.max(usdcAtomicUnits, minUsdcAtomicUnits);

    logger.debug("Converted Winston to USDC", {
      winston: winston.toString(),
      arAmount,
      arPriceUSD,
      usdAmount,
      bufferedUsdAmount,
      usdcAtomicUnits: finalAmount,
    });

    return finalAmount.toString();
  }

  /**
   * Convert USDC atomic units to Winston
   * @param usdcAtomicUnits - USDC amount in atomic units (10^-6 USDC)
   * @returns Winston amount
   */
  async getWinstonForUSDC(usdcAtomicUnits: string): Promise<Winston> {
    const arPriceUSD = await this.getArPriceInUSD();

    // Convert USDC atomic units to USD (1 USDC = 10^6 atomic units)
    const usdAmount = Number(usdcAtomicUnits) / 1e6;

    // Convert USD to AR
    const arAmount = usdAmount / arPriceUSD;

    // Convert AR to Winston (1 AR = 10^12 Winston)
    const winstonAmount = Math.floor(arAmount * 1e12);

    logger.debug("Converted USDC to Winston", {
      usdcAtomicUnits,
      usdAmount,
      arPriceUSD,
      arAmount,
      winstonAmount,
    });

    return W(winstonAmount.toString());
  }
}
