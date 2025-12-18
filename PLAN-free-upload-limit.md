# Implementation Plan: Free Upload Limit

## Overview

Implement the advertised `freeUploadLimitBytes` feature so that uploads under the configured limit can proceed without x402 payment.

## Current State

- `freeUploadLimitBytes` is defined in `src/constants.ts` (default: ~505 KiB)
- Advertised via `/info` endpoint in `src/routes/info.ts`
- **NOT enforced** in upload routes - all uploads require payment
- Default in docker-compose.yml and .env.sample is `FREE_UPLOAD_LIMIT=0` (disabled)

## Client Flow for Free Uploads

### Discovery Flow
1. Client calls `GET /v1/info` to discover `freeUploadLimitBytes`
2. If `freeUploadLimitBytes > 0`, free uploads are available
3. If `freeUploadLimitBytes === 0`, all uploads require payment

### Signed Data Item Upload (Free)
```
POST /v1/tx (or /v1/x402/upload/signed)
Content-Type: application/octet-stream
Content-Length: 1024  # Must be <= freeUploadLimitBytes
[ANS-104 data item bytes]

Response: 200 OK with receipt (same as paid upload)
```

### Unsigned/Raw Data Upload (Free)
```
POST /v1/x402/upload/unsigned
Content-Type: image/png
Content-Length: 1024  # Must be <= freeUploadLimitBytes
X-Tag-App-Name: MyApp
[raw data bytes]

Response: 201 Created with receipt (same as paid upload)
```

### Paid Upload (Over Free Limit)
```
# Step 1: Get pricing (optional - can skip if client knows price)
POST /v1/tx
Content-Type: application/octet-stream
Content-Length: 600000  # Over free limit
[data bytes]

Response: 402 Payment Required
{
  "x402Version": 1,
  "accepts": [{ "maxAmountRequired": "1234", ... }]
}

# Step 2: Upload with payment
POST /v1/tx
Content-Type: application/octet-stream
Content-Length: 600000
X-PAYMENT: <base64-encoded-payment>
[data bytes]

Response: 200 OK with receipt
```

## Files to Modify

### 1. `src/routes/dataItemPost.ts` (Signed Uploads)

**Location**: Lines 247-349 (the pricing check request block)

**Change**: Before returning 402, check if upload qualifies for free tier

```typescript
// Current code (line 247-249):
if (isPricingCheckRequest) {
  // No payment header - return 402 with pricing...
}

// New code:
if (isPricingCheckRequest) {
  // Check if upload qualifies for free tier
  const estimatedSize = rawContentLength || 0;

  if (freeUploadLimitBytes > 0 && estimatedSize <= freeUploadLimitBytes) {
    // Free upload - proceed without payment
    logger.info("Upload qualifies for free tier", {
      contentLength: estimatedSize,
      freeUploadLimitBytes,
    });
    // Continue to normal upload flow (skip to line 352+)
  } else {
    // Return 402 with pricing (existing code)
  }
}
```

**Key Considerations**:
- Must import `freeUploadLimitBytes` from constants
- Free uploads still go through full validation (signature check, etc.)
- Free uploads still get receipts and are processed normally
- Need to restructure the flow to avoid early return

### 2. `src/routes/rawDataPost.ts` (Unsigned Uploads)

**Location**: Lines 70-82 (payment header check)

**Change**: Before returning 402, check if upload qualifies for free tier

```typescript
// Current code (line 74-81):
if (!paymentHeaderValue) {
  return await send402PaymentRequired(ctx, ...);
}

// New code:
if (!paymentHeaderValue) {
  // Check if upload qualifies for free tier
  if (freeUploadLimitBytes > 0 && parsedRequest.data.length <= freeUploadLimitBytes) {
    logger.info("Raw upload qualifies for free tier", {
      dataSize: parsedRequest.data.length,
      freeUploadLimitBytes,
    });
    // Continue without payment - set dummy payment info
  } else {
    return await send402PaymentRequired(ctx, ...);
  }
}
```

**Key Considerations**:
- For unsigned uploads, the server creates and signs the data item
- Free unsigned uploads should NOT include x402 payment tags (TX hash, etc.)
- Need to handle the flow where no payment is settled

### 3. `src/constants.ts` (No changes needed)

The constant is already correctly defined:
```typescript
export const freeUploadLimitBytes = +(
  process.env.FREE_UPLOAD_LIMIT ?? oneKiB * 505
);
```

### 4. `src/routes/info.ts` (No changes needed)

Already exposes `freeUploadLimitBytes` correctly.

## Detailed Implementation

### Phase 1: Signed Data Item Free Uploads (`dataItemPost.ts`)

#### Step 1.1: Import the constant
```typescript
// Add to existing imports from "../constants"
import {
  // ... existing imports
  freeUploadLimitBytes,
} from "../constants";
```

#### Step 1.2: Restructure the pricing check logic
The current flow is:
```
isPricingCheckRequest → return 402
paymentHeaderValue → verify & settle → continue
```

New flow should be:
```
isPricingCheckRequest:
  if qualifiesForFree → continue to upload (isFreeUpload = true)
  else → return 402
paymentHeaderValue → verify & settle → continue (isFreeUpload = false)
```

#### Step 1.3: Handle free upload path
```typescript
// After line 246
let isFreeUpload = false;

if (isPricingCheckRequest) {
  const estimatedSize = rawContentLength || 0;

  // Check free upload eligibility
  if (freeUploadLimitBytes > 0 && estimatedSize <= freeUploadLimitBytes) {
    logger.info("Upload qualifies for free tier - proceeding without payment", {
      contentLength: estimatedSize,
      freeUploadLimitBytes,
    });
    isFreeUpload = true;
    // Fall through to normal upload processing
  } else {
    // Existing 402 response code (lines 256-349)
    // ... return 402 with pricing
  }
}

// Rest of upload processing uses `isFreeUpload` flag
// Skip x402 payment verification/settlement if isFreeUpload is true
```

#### Step 1.4: Skip payment processing for free uploads
```typescript
// Around line 471 (existing payment verification block)
if (paymentHeaderValue && !isFreeUpload) {
  // Existing payment verification and settlement code
} else if (isWhitelisted) {
  // Existing whitelist handling
} else if (isFreeUpload) {
  logger.info("Free upload - no payment required", {
    dataItemId,
    contentLength: rawContentLength,
  });
}
```

### Phase 2: Unsigned Data Item Free Uploads (`rawDataPost.ts`)

#### Step 2.1: Import the constant
```typescript
// Add to imports
import { freeUploadLimitBytes } from "../constants";
```

#### Step 2.2: Add free upload check
```typescript
// Replace lines 74-81
let isFreeUpload = false;
let payerAddress: string | undefined;
let paymentPayload: any;
let settlement: any;

if (!paymentHeaderValue) {
  // Check if upload qualifies for free tier
  if (freeUploadLimitBytes > 0 && parsedRequest.data.length <= freeUploadLimitBytes) {
    logger.info("Raw upload qualifies for free tier", {
      dataSize: parsedRequest.data.length,
      freeUploadLimitBytes,
    });
    isFreeUpload = true;
    // Continue without payment
  } else {
    // Return 402 - existing code
    return await send402PaymentRequired(
      ctx,
      parsedRequest.data.length,
      parsedRequest.contentType,
      parsedRequest.tags
    );
  }
} else {
  // Existing payment processing (lines 84-220)
}
```

#### Step 2.3: Handle data item creation differently for free uploads
For free uploads, we should NOT include x402 payment tags since there's no payment:

```typescript
// Around line 227
let dataItem: DataItem;
let rawDataItemWallet;
try {
  rawDataItemWallet = await ctx.state.getRawDataItemWallet();

  if (isFreeUpload) {
    // Create data item WITHOUT x402 payment tags
    dataItem = await createDataItemFromRaw(
      {
        data: parsedRequest.data,
        tags: parsedRequest.tags,
        contentType: parsedRequest.contentType,
        // No payerAddress or x402Payment
      },
      rawDataItemWallet
    );
  } else {
    // Existing code with x402 payment tags
    dataItem = await createDataItemFromRaw(
      {
        data: parsedRequest.data,
        tags: parsedRequest.tags,
        contentType: parsedRequest.contentType,
        payerAddress,
        x402Payment: {
          txHash: settlement.transactionHash!,
          paymentId,
          network: paymentPayload.network,
        },
      },
      rawDataItemWallet
    );
  }
}
```

#### Step 2.4: Skip payment record insertion for free uploads
```typescript
// Around line 288
if (!isFreeUpload) {
  // Existing payment record insertion code
  await ctx.state.database.insertX402Payment({...});
}
```

#### Step 2.5: Update response for free uploads
```typescript
// Around line 429
ctx.status = 201;

if (!isFreeUpload) {
  ctx.set("X-Payment-Response", Buffer.from(JSON.stringify(x402PaymentResponse)).toString("base64"));
}

ctx.body = {
  id: dataItem.id,
  owner: jwkToPublicArweaveAddress(rawDataItemWallet),
  dataCaches: unsignedReceipt.dataCaches,
  fastFinalityIndexes: unsignedReceipt.fastFinalityIndexes,
  receipt: signedReceipt,
  ...(isFreeUpload ? { freeUpload: true } : {
    payer: payerAddress,
    x402Payment: x402PaymentResponse
  }),
};
```

### Phase 3: Update `createDataItem.ts` (if needed)

Check if `createDataItemFromRaw` handles missing `payerAddress` and `x402Payment`:

```typescript
// src/utils/createDataItem.ts
export async function createDataItemFromRaw(
  params: {
    data: Buffer;
    tags?: Array<{ name: string; value: string }>;
    contentType?: string;
    payerAddress?: string;  // Make optional
    x402Payment?: {         // Make optional
      txHash: string;
      paymentId: string;
      network: string;
    };
  },
  wallet: JWKInterface
): Promise<DataItem> {
  const allTags = [...(params.tags || [])];

  // Only add x402 tags if payment info is provided
  if (params.x402Payment) {
    allTags.push(
      { name: "X402-TX-Hash", value: params.x402Payment.txHash },
      { name: "X402-Payment-ID", value: params.x402Payment.paymentId },
      { name: "X402-Network", value: params.x402Payment.network }
    );
  }

  if (params.payerAddress) {
    allTags.push({ name: "Payer-Address", value: params.payerAddress });
  }

  // ... rest of implementation
}
```

## Testing Strategy

### Unit Tests

1. **Test free upload eligibility check**
   - Upload size < freeUploadLimitBytes → free
   - Upload size = freeUploadLimitBytes → free
   - Upload size > freeUploadLimitBytes → requires payment
   - freeUploadLimitBytes = 0 → all uploads require payment

2. **Test signed data item free upload**
   - POST without X-PAYMENT header, size under limit → 200 OK
   - POST without X-PAYMENT header, size over limit → 402

3. **Test unsigned data item free upload**
   - POST without X-PAYMENT header, size under limit → 201 Created
   - POST without X-PAYMENT header, size over limit → 402

### Integration Tests

1. **End-to-end free signed upload**
   - Set FREE_UPLOAD_LIMIT=10000
   - Upload signed data item < 10KB without payment
   - Verify receipt returned
   - Verify data item in database

2. **End-to-end free unsigned upload**
   - Set FREE_UPLOAD_LIMIT=10000
   - Upload raw data < 10KB without payment
   - Verify data item created without x402 tags
   - Verify no payment record in database

3. **Edge cases**
   - Upload exactly at limit boundary
   - Upload with FREE_UPLOAD_LIMIT=0 (disabled)

## Edge Cases & Considerations

### 1. Content-Length Header Required
Both routes require Content-Length header for free upload check. This is already enforced for paid uploads.

### 2. Whitelist Interaction
- Whitelisted addresses already get free uploads regardless of size
- Free upload limit should apply to non-whitelisted addresses
- Order of checks: whitelist > free limit > payment required

### 3. Concurrent Upload Abuse
Consider rate limiting for free uploads to prevent abuse:
- Could add per-IP rate limiting for free uploads
- Could track free upload count in Redis
- **Recommendation**: Start without rate limiting, add if abuse occurs

### 4. Unsigned Upload Cost
For unsigned uploads, the server pays for:
- CPU to sign the data item
- Storage (same as signed)
This is acceptable for small free uploads (<505 KiB default).

### 5. Logging & Metrics
Add metrics to track:
- `free_uploads_total` - count of free uploads
- `free_uploads_bytes_total` - total bytes uploaded for free
- Log free upload events for auditing

## Rollback Plan

If issues arise:
1. Set `FREE_UPLOAD_LIMIT=0` in environment
2. Restart services
3. All uploads will require payment again

## Migration Notes

- No database migrations required
- No breaking API changes (new behavior is additive)
- Existing integrations unaffected (they already send payment)

## Implementation Order

1. **Phase 1**: Implement signed data item free uploads
2. **Phase 2**: Implement unsigned data item free uploads
3. **Phase 3**: Update createDataItem if needed
4. **Phase 4**: Add tests
5. **Phase 5**: Update CLAUDE.md documentation

## Summary of Changes

| File | Change |
|------|--------|
| `src/routes/dataItemPost.ts` | Add free upload check before 402 response |
| `src/routes/rawDataPost.ts` | Add free upload check, handle no-payment flow |
| `src/utils/createDataItem.ts` | Make payment params optional (if needed) |
| `CLAUDE.md` | Update documentation to reflect actual behavior |

## Estimated Scope

- Lines of code: ~100-150 new/modified lines
- Files changed: 2-3
- Risk level: Low (feature addition, not modification of existing behavior)
