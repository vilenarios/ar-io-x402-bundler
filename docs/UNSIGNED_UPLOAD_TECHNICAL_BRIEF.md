# Unsigned Data Upload API - Technical Brief

This document describes the end-to-end implementation of the unsigned data upload API with x402 USDC payments. This API allows clients to upload raw data without creating ANS-104 data items themselves - the bundler creates and signs the data item on behalf of the user.

## Overview

The unsigned upload flow:
1. Client sends raw data to bundler (no ANS-104 formatting required)
2. Bundler returns 402 Payment Required with pricing
3. Client creates EIP-712 USDC transfer signature
4. Client retries upload with `X-PAYMENT` header
5. Bundler verifies signature, settles USDC on-chain via facilitator
6. Bundler creates ANS-104 data item, signs it with server wallet
7. Bundler stores data item in S3, enqueues for bundling
8. Bundler returns signed receipt with data item ID

## API Endpoint

```
POST /v1/x402/upload/unsigned
POST /x402/upload/unsigned
```

Both paths are supported for consistency.

## Request Formats

### Option 1: Binary Upload with Headers

```http
POST /v1/x402/upload/unsigned HTTP/1.1
Content-Type: image/png
Content-Length: 2087856
X-Tag-App-Name: MyApp
X-Tag-Custom-Field: custom-value

<binary data>
```

Tags are extracted from `X-Tag-*` headers. Header names are converted from kebab-case to proper case:
- `x-tag-app-name` → `App-Name`
- `x-tag-user-id` → `User-Id`

### Option 2: JSON Envelope

```http
POST /v1/x402/upload/unsigned HTTP/1.1
Content-Type: application/json

{
  "data": "<base64-encoded-data>",
  "contentType": "image/png",
  "tags": [
    { "name": "App-Name", "value": "MyApp" },
    { "name": "Custom-Field", "value": "custom-value" }
  ]
}
```

## Payment Flow

### Step 1: Initial Request (No Payment)

Send upload request without `X-PAYMENT` header to get price quote:

```http
POST /v1/x402/upload/unsigned HTTP/1.1
Content-Type: image/png
Content-Length: 2087856

<binary data>
```

### Step 2: 402 Response with Payment Requirements

```http
HTTP/1.1 402 Payment Required
X-Payment-Required: x402-1

{
  "x402Version": 1,
  "accepts": [
    {
      "scheme": "exact",
      "network": "base",
      "maxAmountRequired": "30490",
      "resource": "https://bundler.example.com/v1/tx",
      "description": "Upload 2088107 bytes to Arweave via AR.IO Bundler",
      "mimeType": "image/png",
      "payTo": "0xCFd3f996447a541Cbfba5422310EDb417d9f2cE6",
      "maxTimeoutSeconds": 3600,
      "asset": "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
      "extra": {
        "name": "USD Coin",
        "version": "2"
      }
    }
  ],
  "error": "Payment required to upload data"
}
```

**Field descriptions:**
- `maxAmountRequired`: USDC amount in atomic units (6 decimals). "30490" = 0.030490 USDC
- `network`: Blockchain network (`base`, `base-sepolia`, `ethereum-mainnet`, `polygon-mainnet`)
- `payTo`: Bundler's Ethereum address to receive payment
- `asset`: USDC contract address on the specified network
- `extra.name` + `extra.version`: EIP-712 domain parameters for USDC

### Step 3: Client Creates EIP-712 Signature

Client must create a USDC `transferWithAuthorization` EIP-712 signature:

```typescript
// EIP-712 Domain (must match USDC contract exactly)
const domain = {
  name: "USD Coin",      // From extra.name
  version: "2",          // From extra.version
  chainId: 8453,         // Base mainnet
  verifyingContract: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" // asset
};

// EIP-712 Types
const types = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" }
  ]
};

// Authorization message
const authorization = {
  from: userWalletAddress,           // Payer address
  to: paymentRequirements.payTo,     // Bundler address
  value: paymentRequirements.maxAmountRequired,
  validAfter: 0,                     // Can be executed immediately
  validBefore: Math.floor(Date.now() / 1000) + 3600, // 1 hour validity
  nonce: crypto.randomBytes(32)      // Random 32-byte nonce
};

// Sign with user's wallet
const signature = await wallet._signTypedData(domain, types, authorization);
```

### Step 4: Retry with X-PAYMENT Header

```http
POST /v1/x402/upload/unsigned HTTP/1.1
Content-Type: image/png
Content-Length: 2087856
X-PAYMENT: <base64-encoded-payment-payload>

<binary data>
```

**X-PAYMENT header format** (base64-encoded JSON):

```json
{
  "x402Version": 1,
  "scheme": "exact",
  "network": "base",
  "payload": {
    "signature": "0x...",
    "authorization": {
      "from": "0xUserWalletAddress",
      "to": "0xBundlerPaymentAddress",
      "value": "30490",
      "validAfter": 0,
      "validBefore": 1702598400,
      "nonce": "0x..."
    }
  }
}
```

### Step 5: Success Response

```http
HTTP/1.1 201 Created
X-Payment-Response: <base64-encoded-payment-response>

{
  "id": "50BxW6W_8tj8GH94aY7u7DUQtyYNE5zi9UyHdnaHBLo",
  "owner": "X1Yxv69On-bZomhLdyvXiELvGG4z6D4dDMT89k2rtnU",
  "payer": "0xUserWalletAddress",
  "dataCaches": ["arweave.net"],
  "fastFinalityIndexes": ["arweave.net"],
  "receipt": {
    "id": "50BxW6W_8tj8GH94aY7u7DUQtyYNE5zi9UyHdnaHBLo",
    "timestamp": 1702512345678,
    "version": "0.2.0",
    "deadlineHeight": 1234567,
    "dataCaches": ["arweave.net"],
    "fastFinalityIndexes": ["arweave.net"],
    "winc": "7699496221",
    "public": "<bundler-public-key>",
    "signature": "<receipt-signature>"
  },
  "x402Payment": {
    "paymentId": "550e8400-e29b-41d4-a716-446655440000",
    "transactionHash": "0x...",
    "network": "base",
    "mode": "payg"
  }
}
```

**Key fields:**
- `id`: The ANS-104 data item ID (base64url-encoded SHA-256)
- `owner`: The Arweave address of the server wallet that signed the data item
- `payer`: The Ethereum address that paid for the upload (tracked in tags)
- `receipt`: Cryptographically signed receipt proving upload acceptance

---

## Server-Side Implementation Details

### 1. Request Parsing (`src/utils/rawDataUtils.ts`)

```typescript
export function parseRawDataRequest(
  rawBody: Buffer,
  contentType?: string,
  headers?: Record<string, string | string[] | undefined>
): ParsedRawDataRequest {
  // Try JSON envelope format first
  if (contentType?.includes("application/json")) {
    try {
      const json = JSON.parse(rawBody.toString("utf8"));
      if (json.data) {
        return {
          data: Buffer.from(json.data, "base64"),
          tags: json.tags || [],
          contentType: json.contentType,
        };
      }
    } catch (error) {
      // Fall through to binary handling
    }
  }

  // Binary upload with X-Tag-* headers
  return {
    data: rawBody,
    tags: headers ? extractTagsFromHeaders(headers) : [],
    contentType: contentType !== "application/octet-stream" ? contentType : undefined,
  };
}
```

### 2. Price Calculation

```typescript
// 1. Estimate final data item size (raw data + ANS-104 overhead)
const estimatedDataItemSize = estimateDataItemSize(rawDataSize, totalTagCount);

// ANS-104 overhead calculation:
// - Signature: 512 bytes (Arweave RSA-PSS)
// - Owner (public key): 512 bytes
// - Headers: ~80 bytes
// - Tags: ~64 bytes per tag
function estimateDataItemSize(rawDataSize: number, tagCount = 0): number {
  const signatureOverhead = 512;
  const ownerOverhead = 512;
  const headerOverhead = 80;
  const perTagOverhead = 64;
  return rawDataSize + signatureOverhead + ownerOverhead + headerOverhead + (tagCount * perTagOverhead);
}

// 2. Get Winston price from Arweave gateway
const winstonCost = await arweaveGateway.getWinstonPriceForByteCount(estimatedDataItemSize);

// 3. Apply bundler fee (e.g., 30% margin)
const winstonWithFee = Math.ceil(winstonCost * (1 + x402FeePercent / 100));

// 4. Convert Winston to USDC atomic units
const usdcAmount = await x402PricingOracle.getUSDCForWinston(winstonWithFee);
```

**Tag count for pricing:**
- User-provided tags
- System tags (7 total): `Bundler`, `Upload-Type`, `Payer-Address`, `X402-TX-Hash`, `X402-Payment-ID`, `X402-Network`, `Upload-Timestamp`
- Content-Type tag (if provided)

### 3. Payment Verification & Settlement (`src/arch/x402Service.ts`)

```typescript
// Verify payment signature
async verifyPayment(paymentHeader: string, requirements: X402PaymentRequirements) {
  const paymentPayload = JSON.parse(Buffer.from(paymentHeader, "base64").toString());

  // Validate x402 version, scheme, network
  // Validate amount >= required
  // Validate recipient address matches
  // Validate timestamp validity (validAfter/validBefore)
  // Verify EIP-712 signature (supports EOA and ERC-1271 smart wallets)

  return { isValid: true };
}

// Settle payment on-chain via facilitator
async settlePayment(paymentHeader: string, requirements: X402PaymentRequirements) {
  // Use x402 facilitator (Coinbase CDP or Mogami) to execute transfer
  const result = await facilitator.settle(paymentPayload, requirements);

  return {
    success: true,
    transactionHash: result.transactionHash,
    network: paymentPayload.network
  };
}
```

**Facilitator flow:**
1. Facilitator receives the EIP-712 signature
2. Facilitator calls USDC contract's `transferWithAuthorization(from, to, value, validAfter, validBefore, nonce, signature)`
3. USDC transfers from payer to bundler
4. Facilitator returns transaction hash

### 4. Data Item Creation (`src/utils/createDataItem.ts`)

```typescript
export async function createDataItemFromRaw(
  options: CreateDataItemOptions,
  wallet: JWKInterface
): Promise<DataItem> {
  const tags: Tag[] = [];

  // Add Content-Type
  if (options.contentType) {
    tags.push({ name: "Content-Type", value: options.contentType });
  }

  // Add user tags
  if (options.tags) {
    tags.push(...options.tags);
  }

  // Add system tags for attribution and tracking
  tags.push({ name: "Bundler", value: process.env.APP_NAME || "AR.IO Bundler" });
  tags.push({ name: "Upload-Type", value: "raw-data-x402" });

  if (options.payerAddress) {
    tags.push({ name: "Payer-Address", value: options.payerAddress });
  }

  // Add x402 payment proof tags
  if (options.x402Payment) {
    tags.push({ name: "X402-TX-Hash", value: options.x402Payment.txHash });
    tags.push({ name: "X402-Payment-ID", value: options.x402Payment.paymentId });
    tags.push({ name: "X402-Network", value: options.x402Payment.network });
  }

  tags.push({ name: "Upload-Timestamp", value: Date.now().toString() });

  // Create and sign data item with server wallet
  const signer = new ArweaveSigner(wallet);
  const dataItem = createData(options.data, signer, { tags });
  await dataItem.sign(signer);

  return dataItem;
}
```

### 5. Storage (`src/utils/objectStoreUtils.ts`)

```typescript
// Store raw data item to S3 with prefix for gateway access
await putDataItemRaw(objectStore, dataItemId, dataStream, contentType, payloadDataStart);

// Key format: "raw-data-item/{dataItemId}"
// This prefix allows AR.IO gateway to fetch directly from S3
function putDataItemRaw(objectStore, dataItemId, dataItem, contentType, payloadDataStart) {
  return objectStore.putObject(`raw-data-item/${dataItemId}`, dataItem, {
    payloadInfo: { payloadDataStart, payloadContentType: contentType }
  });
}
```

### 6. Database Records

**new_data_item table:**
```sql
INSERT INTO new_data_item (
  data_item_id,           -- ANS-104 data item ID
  owner_public_address,   -- Server wallet Arweave address
  byte_count,             -- Total data item size
  assessed_winston_price, -- Winston cost
  payload_data_start,     -- Byte offset where payload begins
  payload_content_type,   -- MIME type
  uploaded_date,          -- Timestamp
  signature_type,         -- 1 = Arweave
  deadline_height,        -- Block height deadline
  premium_feature_type,   -- "default"
  signature               -- Data item signature
);
```

**x402_payments table:**
```sql
INSERT INTO x402_payments (
  payment_id,      -- UUID
  tx_hash,         -- On-chain transaction hash
  network,         -- "base", "ethereum-mainnet", etc.
  payer_address,   -- Ethereum address that paid
  usdc_amount,     -- USDC in atomic units
  winc_amount,     -- Equivalent Winston credits
  data_item_id,    -- Associated data item
  byte_count       -- Upload size
);
```

### 7. Optical Bridging (Optimistic Caching)

After storage, enqueue for optical bridging to AR.IO gateway:

```typescript
const signedDataItemHeader = await signDataItemHeader(
  encodeTagsForOptical({
    id: dataItem.id,
    signature: signatureB64Url,
    owner: dataItem.owner,
    owner_address: ownerPublicAddress,
    target: dataItem.target || "",
    content_type: payloadContentType,
    data_size: byteCount,
    tags: dataItem.tags,
  })
);

await enqueue(jobLabels.opticalPost, {
  ...signedDataItemHeader,
  uploaded_at: Date.now(),
});
```

The optical post job sends the signed header to the gateway's admin endpoint:
```
POST /ar-io/admin/queue-data-item
Authorization: Bearer <admin-key>
Content-Type: application/json

[{signedDataItemHeader}]
```

Gateway then fetches the actual data from the shared S3 bucket using the prefix `raw-data-item/{id}`.

### 8. Receipt Generation (`src/utils/signReceipt.ts`)

```typescript
const unsignedReceipt = {
  id: dataItem.id,
  timestamp: Date.now(),
  version: "0.2.0",
  deadlineHeight: currentBlockHeight + 50,
  dataCaches: ["arweave.net"],
  fastFinalityIndexes: ["arweave.net"],
  winc: winstonPaid.toString(),
};

// Sign with DeepHash (same as Arweave transaction signing)
const hash = await deepHash([
  stringToBuffer("Bundlr"),
  stringToBuffer(receipt.version),
  stringToBuffer(receipt.id),
  stringToBuffer(receipt.deadlineHeight.toString()),
  stringToBuffer(receipt.timestamp.toString()),
]);

const signature = await Arweave.crypto.sign(wallet, hash, { saltLength: 0 });

return {
  ...unsignedReceipt,
  public: getPublicKeyFromJwk(wallet),
  signature: toB64Url(signature)
};
```

---

## Configuration Requirements

### Environment Variables

```bash
# Required
RAW_DATA_UPLOADS_ENABLED=true
RAW_DATA_ITEM_JWK_FILE=/path/to/raw-data-wallet.json  # Arweave wallet for signing
X402_PAYMENT_ADDRESS=0x...                            # EVM address to receive USDC

# x402 Network Configuration
X402_BASE_ENABLED=true                                # Enable Base mainnet (default)
X402_BASE_TESTNET_ENABLED=false                       # Enable Base Sepolia testnet

# Facilitator (for payment settlement)
CDP_API_KEY_ID=...                                    # Coinbase CDP credentials
CDP_API_KEY_SECRET=...                                # (required for mainnet)

# Pricing
X402_FEE_PERCENT=30                                   # Bundler profit margin (30%)
X402_MINIMUM_PAYMENT_USDC=0.001                       # Minimum payment threshold

# Optical Bridging (optional)
OPTICAL_BRIDGING_ENABLED=true
OPTICAL_BRIDGE_URL=http://gateway:3000/ar-io/admin/queue-data-item
AR_IO_ADMIN_KEY=your-admin-key
```

### Database Tables

```sql
-- x402 payment tracking
CREATE TABLE x402_payments (
  id SERIAL PRIMARY KEY,
  payment_id UUID NOT NULL UNIQUE,
  tx_hash VARCHAR(66) NOT NULL,
  network VARCHAR(50) NOT NULL,
  payer_address VARCHAR(42) NOT NULL,
  usdc_amount VARCHAR(78) NOT NULL,
  winc_amount VARCHAR(78) NOT NULL,
  data_item_id VARCHAR(43) NOT NULL,
  byte_count BIGINT NOT NULL,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_x402_payments_data_item ON x402_payments(data_item_id);
CREATE INDEX idx_x402_payments_payer ON x402_payments(payer_address);
```

---

## Key Implementation Notes

1. **Signature Type**: The server always signs with Arweave signature type (1), using RSA-PSS 4096-bit keys

2. **Owner vs Payer**:
   - `owner` = Server wallet (signs the data item)
   - `payer` = User's Ethereum address (tracked in `Payer-Address` tag)

3. **ERC-1271 Support**: The x402Service supports smart contract wallet signatures via ERC-1271 `isValidSignature` check

4. **Facilitator Fallback**: Multiple facilitators can be configured for redundancy (tries in order until one succeeds)

5. **S3 Key Format**: Data items are stored at `raw-data-item/{dataItemId}` for gateway access

6. **Tag Encoding**: Tags sent to optical bridge are base64url-encoded (both name and value)

7. **Price Quote Accuracy**: Include system tags in tag count when calculating price to avoid underpayment

---

## Error Handling

| HTTP Status | Meaning | Response |
|-------------|---------|----------|
| 400 | Invalid request (empty data, invalid payment header) | `{ error: "..." }` |
| 402 | Payment required or payment verification failed | `{ x402Version: 1, accepts: [...] }` |
| 403 | Raw data uploads disabled | `{ error: "Raw data uploads not enabled" }` |
| 500 | Server error (data item creation, storage failed) | `{ error: "..." }` |

---

## Testing

```bash
# 1. Get price quote (no payment)
curl -X POST https://bundler.example.com/v1/x402/upload/unsigned \
  -H "Content-Type: image/png" \
  -H "Content-Length: 1024" \
  --data-binary @test.png

# 2. Upload with payment
curl -X POST https://bundler.example.com/v1/x402/upload/unsigned \
  -H "Content-Type: image/png" \
  -H "Content-Length: 1024" \
  -H "X-PAYMENT: <base64-payment>" \
  --data-binary @test.png

# 3. Check status
curl https://bundler.example.com/v1/tx/{dataItemId}/status
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `src/routes/rawDataPost.ts` | Main handler for unsigned uploads |
| `src/utils/rawDataUtils.ts` | Request parsing, tag extraction |
| `src/utils/createDataItem.ts` | ANS-104 data item creation |
| `src/arch/x402Service.ts` | Payment verification & settlement |
| `src/utils/x402Pricing.ts` | Winston ↔ USDC conversion |
| `src/utils/signReceipt.ts` | Receipt generation |
| `src/utils/objectStoreUtils.ts` | S3 storage |
| `src/utils/opticalUtils.ts` | Optical bridging header signing |
| `src/jobs/optical-post.ts` | Optical bridging job worker |
