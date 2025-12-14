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
import { ethers } from "ethers";

import { X402NetworkConfig } from "../constants";
import logger from "../logger";

/**
 * ERC-1271 magic value returned by isValidSignature when signature is valid
 * bytes4(keccak256("isValidSignature(bytes32,bytes)"))
 */
const ERC1271_MAGIC_VALUE = "0x1626ba7e";

/**
 * ERC-1271 ABI for smart contract wallet signature verification
 */
const ERC1271_ABI = [
  "function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)",
];

// x402 Protocol Types
export interface X402PaymentRequirements {
  scheme: string;
  network: string;
  maxAmountRequired: string;
  resource: string;
  description: string;
  mimeType: string;
  outputSchema?: object;
  payTo: string;
  maxTimeoutSeconds: number;
  asset: string;
  extra?: { name: string; version: string };
}

export interface X402PaymentPayload {
  x402Version: number;
  scheme: string;
  network: string;
  payload: {
    signature: string;
    authorization: {
      from: string;
      to: string;
      value: string;
      validAfter: number;
      validBefore: number;
      nonce: string;
    };
  };
}

export interface X402VerificationResult {
  isValid: boolean;
  invalidReason?: string;
}

export interface X402SettlementResult {
  success: boolean;
  transactionHash?: string;
  network?: string;
  error?: string;
}

export interface X402PaymentRequiredResponse {
  x402Version: number;
  accepts: X402PaymentRequirements[];
  error?: string;
}

export class X402Service {
  private providers: Map<string, ethers.JsonRpcProvider> = new Map();

  constructor(private networks: Record<string, X402NetworkConfig>) {
    // Initialize providers for enabled networks
    for (const [networkName, config] of Object.entries(networks)) {
      if (config.enabled) {
        this.providers.set(
          networkName,
          new ethers.JsonRpcProvider(config.rpcUrl)
        );
      }
    }
  }

  /**
   * Verify an x402 payment without settling it
   */
  async verifyPayment(
    paymentHeader: string,
    requirements: X402PaymentRequirements
  ): Promise<X402VerificationResult> {
    try {
      // Decode base64 payment header
      const paymentPayload: X402PaymentPayload = JSON.parse(
        Buffer.from(paymentHeader, "base64").toString("utf-8")
      );

      // Validate x402 version
      if (paymentPayload.x402Version !== 1) {
        return {
          isValid: false,
          invalidReason: `Unsupported x402 version: ${paymentPayload.x402Version}`,
        };
      }

      // Validate scheme
      if (paymentPayload.scheme !== requirements.scheme) {
        return {
          isValid: false,
          invalidReason: `Scheme mismatch: expected ${requirements.scheme}, got ${paymentPayload.scheme}`,
        };
      }

      // Validate network
      if (paymentPayload.network !== requirements.network) {
        return {
          isValid: false,
          invalidReason: `Network mismatch: expected ${requirements.network}, got ${paymentPayload.network}`,
        };
      }

      const { authorization, signature } = paymentPayload.payload;

      // Validate amount
      if (BigInt(authorization.value) < BigInt(requirements.maxAmountRequired)) {
        return {
          isValid: false,
          invalidReason: `Insufficient amount: ${authorization.value} < ${requirements.maxAmountRequired}`,
        };
      }

      // Validate recipient
      if (authorization.to.toLowerCase() !== requirements.payTo.toLowerCase()) {
        return {
          isValid: false,
          invalidReason: `Incorrect recipient: expected ${requirements.payTo}, got ${authorization.to}`,
        };
      }

      // Validate timeout
      const maxValidTime = Date.now() / 1000 + requirements.maxTimeoutSeconds;
      if (authorization.validBefore < maxValidTime) {
        return {
          isValid: false,
          invalidReason: "Payment authorization expires too soon",
        };
      }

      if (authorization.validBefore * 1000 < Date.now()) {
        return {
          isValid: false,
          invalidReason: "Payment authorization expired",
        };
      }

      // Verify EIP-712 signature
      const isValidSignature = await this.verifyEIP712Signature(
        authorization,
        signature,
        requirements
      );

      if (!isValidSignature) {
        return {
          isValid: false,
          invalidReason: "Invalid EIP-712 signature",
        };
      }

      // If facilitator URLs provided, try each for additional verification
      const networkConfig = this.networks[paymentPayload.network];
      const facilitatorUrls = networkConfig?.facilitatorUrls || [];

      if (facilitatorUrls.length > 0) {
        // Try each facilitator until one succeeds
        let verificationSucceeded = false;
        const errors: string[] = [];

        for (const facilitatorUrl of facilitatorUrls) {
          const facilitatorResult = await this.verifyWithFacilitator(
            paymentHeader,
            requirements,
            facilitatorUrl
          );

          if (facilitatorResult.isValid) {
            // Verification succeeded!
            verificationSucceeded = true;
            logger.debug("Facilitator verification succeeded", {
              facilitator: facilitatorUrl,
            });
            break;
          } else {
            // Try next facilitator
            errors.push(`${facilitatorUrl}: ${facilitatorResult.invalidReason}`);
            logger.warn("Facilitator verification failed, trying next", {
              facilitator: facilitatorUrl,
              error: facilitatorResult.invalidReason,
            });
          }
        }

        // If all facilitators failed, return error
        if (!verificationSucceeded) {
          logger.error("All facilitators failed verification", {
            facilitatorCount: facilitatorUrls.length,
            errors,
          });
          return {
            isValid: false,
            invalidReason: `All facilitators failed: ${errors.join("; ")}`,
          };
        }
      }

      logger.info("X402 payment verification successful", {
        network: paymentPayload.network,
        amount: authorization.value,
        from: authorization.from,
        to: authorization.to,
      });

      return { isValid: true };
    } catch (error) {
      logger.error("X402 payment verification failed", { error });
      return {
        isValid: false,
        invalidReason: error instanceof Error ? error.message : "Verification error",
      };
    }
  }

  /**
   * Settle an x402 payment on-chain
   */
  async settlePayment(
    paymentHeader: string,
    requirements: X402PaymentRequirements
  ): Promise<X402SettlementResult> {
    try {
      const paymentPayload: X402PaymentPayload = JSON.parse(
        Buffer.from(paymentHeader, "base64").toString("utf-8")
      );

      const networkConfig = this.networks[paymentPayload.network];

      if (!networkConfig) {
        return {
          success: false,
          error: `Unsupported network: ${paymentPayload.network}`,
        };
      }

      // Get facilitator URLs
      const facilitatorUrls = networkConfig.facilitatorUrls || [];

      if (facilitatorUrls.length === 0) {
        logger.warn("No facilitators configured - settlement not possible", {
          network: paymentPayload.network,
        });
        return {
          success: false,
          error: "No facilitators configured for this network",
        };
      }

      logger.info("Settling x402 payment with multi-facilitator fallback", {
        network: paymentPayload.network,
        facilitatorCount: facilitatorUrls.length,
        facilitators: facilitatorUrls,
      });

      // Try each facilitator sequentially until one succeeds
      const errors: string[] = [];
      for (let i = 0; i < facilitatorUrls.length; i++) {
        const facilitatorUrl = facilitatorUrls[i];

        try {
          logger.info(`Attempting settlement with facilitator ${i + 1}/${facilitatorUrls.length}`, {
            facilitator: facilitatorUrl,
            network: paymentPayload.network,
          });

          // Clone payload to avoid mutating original (important for fallback retries)
          const clonedPayload = JSON.parse(JSON.stringify(paymentPayload));

          // Ensure validAfter and validBefore are strings (facilitator expects strings)
          if (clonedPayload.payload?.authorization) {
            const auth = clonedPayload.payload.authorization as any;
            if (typeof auth.validAfter === "number") {
              auth.validAfter = auth.validAfter.toString();
            }
            if (typeof auth.validBefore === "number") {
              auth.validBefore = auth.validBefore.toString();
            }
          }

          const response = await axios.post(
            `${facilitatorUrl}/settle`,
            {
              x402Version: 1,
              paymentPayload: clonedPayload, // Use cloned payload
              paymentRequirements: requirements,
            },
            {
              headers: { "Content-Type": "application/json" },
              timeout: 60000, // 60 second timeout - increased for reliability
              validateStatus: () => true,
            }
          );

          if (response.status !== 200) {
            const errorMsg = response.data?.error || response.data?.message || response.statusText;
            logger.error("Facilitator settlement failed", {
              facilitator: facilitatorUrl,
              status: response.status,
              error: errorMsg,
              responseData: response.data,
            });
            errors.push(`${facilitatorUrl}: ${errorMsg}`);
            logger.warn(`Facilitator ${i + 1} failed, trying next`, {
              facilitator: facilitatorUrl,
              error: errorMsg,
            });
            continue; // Try next facilitator
          }

          const result = response.data;

          // Facilitator returns "transaction" field, not "transactionHash"
          const txHash = result.transaction || result.transactionHash;

          // Check if transaction hash is present
          if (!txHash) {
            logger.warn("Facilitator did not return transaction hash", {
              facilitator: facilitatorUrl,
              result,
            });
            errors.push(`${facilitatorUrl}: No transaction hash returned`);
            continue; // Try next facilitator
          }

          logger.info(`Settlement succeeded with facilitator ${i + 1}/${facilitatorUrls.length}`, {
            facilitator: facilitatorUrl,
            transactionHash: txHash,
          });

          return {
            success: true,
            transactionHash: txHash,
            network: result.network || clonedPayload.network,
          };
        } catch (error: any) {
          errors.push(`${facilitatorUrl}: ${error.message}`);
          logger.error(`Facilitator ${i + 1} threw error, trying next`, {
            facilitator: facilitatorUrl,
            error: error.message,
          });
        }
      }

      // All facilitators failed
      logger.error("All facilitators failed for settlement", {
        network: paymentPayload.network,
        errors,
      });

      return {
        success: false,
        error: `All facilitators failed: ${errors.join("; ")}`,
      };
    } catch (error) {
      logger.error("X402 payment settlement failed", { error });
      return {
        success: false,
        error: error instanceof Error ? error.message : "Settlement error",
      };
    }
  }

  /**
   * Verify EIP-712 signature - supports both EOA (ECDSA) and Smart Contract Wallets (ERC-1271)
   *
   * For EOA wallets: Uses standard ECDSA signature recovery
   * For Smart Contract Wallets (e.g., Coinbase Smart Wallet): Uses ERC-1271 isValidSignature
   */
  private async verifyEIP712Signature(
    authorization: X402PaymentPayload["payload"]["authorization"],
    signature: string,
    requirements: X402PaymentRequirements
  ): Promise<boolean> {
    try {
      const networkConfig = this.networks[requirements.network];
      if (!networkConfig) {
        logger.error("Unknown network for signature verification", {
          network: requirements.network,
        });
        return false;
      }

      // EIP-712 domain for EIP-3009 transferWithAuthorization
      const domain = {
        name: requirements.extra?.name || "USD Coin",
        version: requirements.extra?.version || "2",
        chainId: networkConfig.chainId,
        verifyingContract: requirements.asset,
      };

      // EIP-712 types for transferWithAuthorization
      const types = {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      };

      // First, try standard EOA (ECDSA) signature verification
      try {
        const recoveredAddress = ethers.verifyTypedData(
          domain,
          types,
          authorization,
          signature
        );

        // Check signer matches 'from' address
        const isValid =
          recoveredAddress.toLowerCase() === authorization.from.toLowerCase();

        if (isValid) {
          logger.debug("EIP-712 EOA signature verification succeeded", {
            from: authorization.from,
            recoveredAddress,
          });
          return true;
        }

        // Recovered address doesn't match - might be a smart contract wallet
        logger.debug("ECDSA recovery didn't match from address, trying ERC-1271", {
          from: authorization.from,
          recoveredAddress,
        });
      } catch (ecdsaError: any) {
        // ECDSA verification failed - this is expected for smart contract wallets
        // Common error: "invalid raw signature length" for WebAuthn/passkey signatures
        logger.debug("ECDSA signature verification failed, trying ERC-1271", {
          error: ecdsaError.shortMessage || ecdsaError.message,
          from: authorization.from,
        });
      }

      // Try ERC-1271 smart contract wallet verification
      return await this.verifyERC1271Signature(
        authorization,
        signature,
        domain,
        types,
        networkConfig,
        requirements.network
      );
    } catch (error) {
      logger.error("EIP-712 signature verification failed", { error });
      return false;
    }
  }

  /**
   * Verify signature using ERC-1271 isValidSignature on a smart contract wallet
   *
   * This supports smart contract wallets like:
   * - Coinbase Smart Wallet (uses WebAuthn/passkeys)
   * - Safe (Gnosis Safe)
   * - Argent
   * - Other ERC-4337 account abstraction wallets
   */
  private async verifyERC1271Signature(
    authorization: X402PaymentPayload["payload"]["authorization"],
    signature: string,
    domain: ethers.TypedDataDomain,
    types: Record<string, ethers.TypedDataField[]>,
    networkConfig: X402NetworkConfig,
    networkName: string
  ): Promise<boolean> {
    try {
      // Get provider for the specific network, falling back to creating a temporary one
      let provider = this.providers.get(networkName);

      if (!provider) {
        // Try alternative network names (e.g., "base" vs "base-mainnet")
        if (networkName === "base") {
          provider = this.providers.get("base-mainnet");
        } else if (networkName === "base-mainnet") {
          provider = this.providers.get("base");
        }
      }

      if (!provider) {
        // Create a temporary provider for this verification
        logger.debug("Creating temporary provider for ERC-1271 verification", {
          network: networkName,
          rpcUrl: networkConfig.rpcUrl,
        });
        provider = new ethers.JsonRpcProvider(networkConfig.rpcUrl);
      }

      return await this.callERC1271IsValidSignature(
        provider,
        authorization,
        signature,
        domain,
        types
      );
    } catch (error: any) {
      logger.error("ERC-1271 signature verification failed", {
        error: error.message,
        from: authorization.from,
        network: networkName,
      });
      return false;
    }
  }

  /**
   * Call the ERC-1271 isValidSignature function on a smart contract wallet
   */
  private async callERC1271IsValidSignature(
    provider: ethers.JsonRpcProvider,
    authorization: X402PaymentPayload["payload"]["authorization"],
    signature: string,
    domain: ethers.TypedDataDomain,
    types: Record<string, ethers.TypedDataField[]>
  ): Promise<boolean> {
    const walletAddress = authorization.from;

    // Check if the address is a contract
    const code = await provider.getCode(walletAddress);
    if (code === "0x" || code === "0x0") {
      logger.debug("Address is not a contract, cannot use ERC-1271", {
        walletAddress,
      });
      return false;
    }

    logger.info("Verifying signature via ERC-1271 smart contract wallet", {
      walletAddress,
      codeLength: code.length,
    });

    // Compute the EIP-712 typed data hash
    const typedDataHash = ethers.TypedDataEncoder.hash(domain, types, authorization);

    // Create contract instance
    const walletContract = new ethers.Contract(walletAddress, ERC1271_ABI, provider);

    try {
      // Call isValidSignature(bytes32 hash, bytes signature) -> bytes4
      const result = await walletContract.isValidSignature(typedDataHash, signature);

      // Check if result matches the ERC-1271 magic value
      const isValid = result.toLowerCase() === ERC1271_MAGIC_VALUE.toLowerCase();

      logger.info("ERC-1271 isValidSignature result", {
        walletAddress,
        typedDataHash,
        result,
        expectedMagicValue: ERC1271_MAGIC_VALUE,
        isValid,
      });

      return isValid;
    } catch (error: any) {
      // Contract might not implement ERC-1271 or call reverted
      logger.error("ERC-1271 isValidSignature call failed", {
        walletAddress,
        error: error.message,
        reason: error.reason,
      });
      return false;
    }
  }

  /**
   * Verify payment using facilitator service
   */
  private async verifyWithFacilitator(
    paymentHeader: string,
    requirements: X402PaymentRequirements,
    facilitatorUrl: string
  ): Promise<X402VerificationResult> {
    try {
      // Decode the payment header to get the payload
      const paymentPayload = JSON.parse(
        Buffer.from(paymentHeader, "base64").toString("utf8")
      );

      // Ensure validAfter and validBefore are strings (facilitator expects strings)
      if (paymentPayload.payload?.authorization) {
        const auth = paymentPayload.payload.authorization as any;
        if (typeof auth.validAfter === "number") {
          auth.validAfter = auth.validAfter.toString();
        }
        if (typeof auth.validBefore === "number") {
          auth.validBefore = auth.validBefore.toString();
        }
      }

      const response = await axios.post(
        `${facilitatorUrl}/verify`,
        {
          x402Version: 1,
          paymentPayload,
          paymentRequirements: requirements,
        },
        {
          headers: { "Content-Type": "application/json" },
          timeout: 10000, // 10 second timeout
        }
      );

      if (response.status !== 200) {
        return {
          isValid: false,
          invalidReason: `Facilitator verification failed: ${response.statusText}`,
        };
      }

      return response.data;
    } catch (error) {
      // Log full error including response body for debugging
      const errorDetails: any = { error };
      if (error && typeof error === "object" && "response" in error) {
        const axiosError = error as any;
        errorDetails.responseStatus = axiosError.response?.status;
        errorDetails.responseData = axiosError.response?.data;
        errorDetails.responseHeaders = axiosError.response?.headers;
      }
      logger.error("Facilitator verification failed", errorDetails);

      return {
        isValid: false,
        invalidReason:
          error instanceof Error ? error.message : "Facilitator error",
      };
    }
  }

  /**
   * Get chain ID for a network
   */
  getChainId(network: string): number | undefined {
    return this.networks[network]?.chainId;
  }

  /**
   * Check if a network is enabled
   */
  isNetworkEnabled(network: string): boolean {
    return this.networks[network]?.enabled || false;
  }

  /**
   * Get all enabled networks
   */
  getEnabledNetworks(): string[] {
    return Object.entries(this.networks)
      .filter(([, config]) => config.enabled)
      .map(([name]) => name);
  }

  /**
   * Get network configuration
   */
  getNetworkConfig(network: string): X402NetworkConfig | undefined {
    return this.networks[network];
  }
}
