# X402 Two-Stage Payment System for Multipart Uploads

## Overview

The x402 bundler implements a two-stage payment system for multipart uploads to prevent spam while ensuring accurate pricing based on actual uploaded bytes.

## Payment Flow

### Stage 1: Deposit Payment (Anti-Spam)

1. **Get Deposit Price Quote**
   ```
   GET /v1/x402/price/:signatureType/:address?deposit=true
   ```
   Returns payment requirements for $0.01 USDC deposit.

2. **Make Deposit Payment**
   ```
   POST /v1/x402/payment/:signatureType/:address
   Body: {
     paymentHeader: "<x402-payment-header>",
     mode: "payg"
   }
   ```
   Returns `paymentId` for use in upload creation.

3. **Create Multipart Upload**
   ```
   POST /v1/multipart?paymentId=<payment-id>&chunkSize=<size>
   ```
   - Verifies deposit payment exists
   - Verifies deposit amount ($0.01 USDC)
   - Verifies payment hasn't been used for another upload
   - Links payment to new uploadId
   - Returns uploadId for chunk uploads

4. **Upload Chunks**
   ```
   PUT /v1/multipart/:uploadId/chunk/:offset
   ```
   Deposit verification happens at creation, no additional checks needed per chunk.

### Stage 2: Finalization Payment (Actual Cost)

5. **Get Finalization Price Quote**
   ```
   GET /v1/x402/price/:signatureType/:address?bytes=<actual-bytes>
   ```
   Client declares actual uploaded bytes.
   Returns payment requirements for actual cost minus deposit.

6. **Make Finalization Payment**
   ```
   POST /v1/x402/payment/:signatureType/:address
   Body: {
     paymentHeader: "<x402-payment-header>",
     uploadId: "<upload-id>",
     byteCount: <actual-bytes>,
     mode: "payg"
   }
   ```
   Creates second payment linked to same uploadId.

7. **Finalize Upload**
   ```
   POST /v1/multipart/:uploadId/finalize
   ```
   - Verifies at least deposit payment exists
   - Calculates total USDC paid from all payments for uploadId
   - Validates data item
   - Inserts into fulfillment pipeline
   - Returns signed receipt

## Edge Cases

### Overpayment
If deposit >= actual cost:
- No finalization payment needed
- Client can proceed directly to finalization
- Excess funds are kept (no refunds for simplicity)

### Underpayment
If total payments < actual cost:
- Finalization returns 402 Payment Required
- Client must make additional payment

### Fraud Detection (Future)
If actual bytes > declared bytes * 1.1:
- Keep both payments as penalty
- Reject upload

### Idempotency
- Payment with same tx_hash is deduplicated
- Multiple finalization attempts return existing receipt

## Configuration

Environment variables:
```bash
# Deposit amount in USDC (default: 0.01)
MULTIPART_DEPOSIT_USDC=0.01

# Upload TTL in hours (default: 24)
MULTIPART_UPLOAD_TTL_HOURS=24

# Max concurrent uploads per address (default: 10)
MULTIPART_MAX_PER_ADDRESS=10
```

## Database Schema

### x402_payments table
```sql
CREATE TABLE x402_payments (
  payment_id VARCHAR(255) PRIMARY KEY,
  user_address VARCHAR(255) NOT NULL,
  user_address_type VARCHAR(50) NOT NULL,
  tx_hash VARCHAR(255) UNIQUE NOT NULL,
  network VARCHAR(50) NOT NULL,
  token_address VARCHAR(255) NOT NULL,
  usdc_amount VARCHAR(255) NOT NULL,  -- Atomic units (6 decimals)
  winc_amount VARCHAR(255) NOT NULL,
  mode VARCHAR(20) NOT NULL,  -- 'payg', 'topup', 'hybrid'
  data_item_id VARCHAR(43),
  upload_id VARCHAR(255),  -- NEW: Links deposit to multipart upload
  declared_byte_count INTEGER,
  payer_address VARCHAR(255) NOT NULL,
  status VARCHAR(50) DEFAULT 'pending_validation',
  created_at TIMESTAMP NOT NULL,
  settled_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP
);

CREATE INDEX idx_x402_payments_upload_id ON x402_payments(upload_id);
```

## Implementation Status

✅ **Completed:**
- Configuration constants
- x402Price route with deposit pricing
- x402Payment route with uploadId support
- Database methods (getX402PaymentById, linkX402PaymentToUploadId, getX402PaymentsByUploadId)
- createMultiPartUpload deposit verification
- finalizeMultipartUpload payment verification
- Type checking passes

⏳ **Pending:**
- Database migration (needs PostgreSQL connection)
- Full cost calculation with pricing service integration
- Fraud detection (actual > declared * 1.1)
- TTL cleanup worker
- Rate limiting by address
- Integration testing

## Migration

Run migration to add upload_id column:
```bash
yarn db:migrate
```

Migration file: `src/migrations/20251105194237_add_upload_id_to_x402_payments.ts`

## Testing

```bash
# Type check
yarn typecheck

# Unit tests (future)
yarn test:unit

# Integration tests (future)
yarn test:integration
```

## API Examples

### Complete Flow Example

```bash
# Stage 1: Deposit
# 1. Get deposit price
curl "http://localhost:3000/v1/x402/price/1/YOUR_ADDRESS?deposit=true"

# 2. Make deposit payment (using x402-js or similar)
# Returns: { paymentId: "x402_123..." }

# 3. Create upload
curl -X POST "http://localhost:3000/v1/multipart?paymentId=x402_123...&chunkSize=10485760"
# Returns: { id: "upload_456...", depositPaymentId: "x402_123..." }

# 4. Upload chunks
curl -X PUT "http://localhost:3000/v1/multipart/upload_456.../chunk/0" \
  -H "Content-Type: application/octet-stream" \
  --data-binary @chunk0.bin

# Stage 2: Finalization
# 5. Get finalization price (declare actual bytes)
curl "http://localhost:3000/v1/x402/price/1/YOUR_ADDRESS?bytes=20971520"

# 6. Make finalization payment
# POST to /v1/x402/payment with uploadId=upload_456...

# 7. Finalize
curl -X POST "http://localhost:3000/v1/multipart/upload_456.../finalize"
# Returns: signed receipt
```

## Future Enhancements

1. **Automatic byte count detection**: Calculate actual bytes from uploaded chunks instead of client declaration
2. **Refund logic**: Return excess payment when deposit > actual cost
3. **Fraud penalties**: Charge penalty when actual significantly exceeds declared
4. **TTL cleanup**: Background worker to delete unpaid uploads after 24 hours
5. **Rate limiting**: Enforce max concurrent uploads per address
6. **Pricing integration**: Full Winston cost calculation with x402PricingOracle
7. **Analytics**: Track payment success rates, fraud attempts, average costs
