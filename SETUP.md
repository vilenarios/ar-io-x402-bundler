# Setup Guide for AR.IO Bundler Lite

This document outlines the remaining work to make AR.IO Bundler Lite functional as a standalone x402 service.

## ✅ What's Already Done

- [x] Created directory structure
- [x] Copied all upload service code (routes, jobs, arch, middleware, utils, types)
- [x] Copied x402 service logic from payment service
- [x] Copied x402 route handlers (price, payment, finalize)
- [x] Created configuration files (package.json, .env.sample, docker-compose.yml)
- [x] Copied database migrations
- [x] Created comprehensive README

## 🔧 What Still Needs to Be Done

### 1. Update Architecture Interface

**File:** `src/arch/architecture.ts`

**Action:** Remove payment service dependency, add x402 service

```typescript
// BEFORE (depends on PaymentService)
export interface Architecture {
  database: Database;
  objectStore: ObjectStore;
  paymentService: PaymentService;  // ❌ Remove this
  arweaveGateway: ArweaveGateway;
  // ...
}

// AFTER (x402 integrated)
export interface Architecture {
  database: Database;
  objectStore: ObjectStore;
  x402Service: X402Service;  // ✅ Add this
  x402PricingOracle: X402PricingOracle;  // ✅ Add this
  arweaveGateway: ArweaveGateway;
  // ...
}
```

### 2. Update Router

**File:** `src/router.ts`

**Action:** Add x402 routes

```typescript
import { x402PriceRoute } from './routes/x402/x402Price';
import { x402PaymentRoute } from './routes/x402/x402Payment';
import { x402FinalizeRoute } from './routes/x402/x402Finalize';

// Add to router
router.get('/v1/x402/price/:signatureType/:address', x402PriceRoute);
router.post('/v1/x402/payment/:signatureType/:address', x402PaymentRoute);
router.post('/v1/x402/finalize', x402FinalizeRoute);
```

### 3. Update dataItemPost Route

**File:** `src/routes/dataItemPost.ts`

**Action:** Replace payment service calls with direct x402 service calls

#### 3a. Remove Payment Service Import

```typescript
// BEFORE
import { PaymentService } from '../arch/payment';

// AFTER
import { X402Service } from '../x402/x402Service';
import { X402PricingOracle } from '../x402/x402PricingOracle';
```

#### 3b. Update Payment Verification (Line ~339)

```typescript
// BEFORE (calls remote payment service)
const x402Result = await paymentService.verifyAndSettleX402Payment({
  paymentHeader: x402PaymentHeader,
  dataItemId,
  byteCount: rawContentLength,
  nativeAddress,
  signatureType,
  mode: "payg",
});

// AFTER (calls local x402 service)
const { x402Service, x402PricingOracle } = ctx.state;

// Decode payment header
const paymentPayload = JSON.parse(
  Buffer.from(x402PaymentHeader, 'base64').toString('utf-8')
);

// Get pricing
const winstonCost = await pricingService.getWCForBytes(rawContentLength, nativeAddress);

// Calculate USDC amount
const usdcAmount = await x402PricingOracle.getUSDCForWinston(winstonCost);

// Create payment requirements
const requirements = {
  scheme: 'exact',
  network: paymentPayload.network,
  maxAmountRequired: usdcAmount,
  resource: '/v1/tx',
  payTo: process.env.X402_PAYMENT_ADDRESS!,
  asset: networkConfig.usdcAddress,
  maxTimeoutSeconds: 300
};

// Verify payment
const verification = await x402Service.verifyPayment(x402PaymentHeader, requirements);

if (!verification.isValid) {
  // Handle error
}

// Settle payment
const settlement = await x402Service.settlePayment(x402PaymentHeader, requirements);

if (!settlement.success) {
  // Handle error
}

// Store payment in database
const payment = await database.createX402Payment({
  userAddress: nativeAddress,
  txHash: settlement.transactionHash!,
  network: paymentPayload.network,
  usdcAmount,
  wincAmount: winstonCost,
  mode: 'payg',
  dataItemId,
  declaredByteCount: rawContentLength,
  payerAddress: paymentPayload.payload.authorization.from,
});

x402PaymentId = payment.id;
x402TxHash = settlement.transactionHash;
x402Network = paymentPayload.network;
x402Mode = 'payg';
```

#### 3c. Update Finalization (Line ~579)

```typescript
// BEFORE (calls remote payment service)
const finalizeResult = await paymentService.finalizeX402Payment({
  dataItemId,
  actualByteCount: totalSize,
});

// AFTER (calls local database)
const payment = await database.getX402PaymentByDataItemId(dataItemId);

if (!payment) {
  // No x402 payment for this upload
  continue;
}

const declaredByteCount = payment.declaredByteCount || 0;
const tolerance = 0.05; // 5%
const lowerBound = declaredByteCount * (1 - tolerance);
const upperBound = declaredByteCount * (1 + tolerance);

let status: 'confirmed' | 'refunded' | 'fraud_penalty';

if (totalSize > upperBound) {
  status = 'fraud_penalty';
  // Keep payment, reject upload
  await performQuarantine({
    status: 402,
    errorMessage: `Fraud detected: declared ${declaredByteCount} but uploaded ${totalSize}`,
  });
  return next();
} else if (totalSize < lowerBound) {
  status = 'refunded';
  // Calculate refund
  const excessBytes = declaredByteCount - totalSize;
  // ... calculate refund winc
} else {
  status = 'confirmed';
}

await database.finalizeX402Payment({
  paymentId: payment.id,
  actualByteCount: totalSize,
  status,
});
```

### 4. Add x402 Database Methods

**File:** `src/arch/db/database.ts`

**Action:** Add x402 payment methods

```typescript
export interface Database {
  // ... existing methods

  // x402 Payment Methods
  createX402Payment(params: {
    userAddress: string;
    userAddressType: UserAddressType;
    txHash: string;
    network: string;
    tokenAddress: string;
    usdcAmount: string;
    wincAmount: Winston;
    mode: 'payg' | 'topup' | 'hybrid';
    dataItemId?: DataItemId;
    declaredByteCount?: number;
    payerAddress: string;
  }): Promise<X402Payment>;

  getX402PaymentByDataItemId(dataItemId: DataItemId): Promise<X402Payment | null>;

  finalizeX402Payment(params: {
    paymentId: string;
    actualByteCount: number;
    status: 'confirmed' | 'refunded' | 'fraud_penalty';
    refundWinc?: Winston;
  }): Promise<void>;
}
```

**File:** `src/arch/db/postgres.ts`

**Action:** Implement these methods with Knex queries

```typescript
async createX402Payment(params) {
  const payment = {
    id: uuid(),
    user_address: params.userAddress,
    user_address_type: params.userAddressType,
    tx_hash: params.txHash,
    network: params.network,
    token_address: params.tokenAddress,
    usdc_amount: params.usdcAmount,
    winc_amount: params.wincAmount.toString(),
    mode: params.mode,
    data_item_id: params.dataItemId,
    declared_byte_count: params.declaredByteCount?.toString(),
    payer_address: params.payerAddress,
    status: 'pending_validation',
    paid_at: new Date(),
  };

  await this.writer('x402_payment_transaction').insert(payment);
  return payment;
}

async getX402PaymentByDataItemId(dataItemId) {
  return await this.reader('x402_payment_transaction')
    .where({ data_item_id: dataItemId })
    .first();
}

async finalizeX402Payment(params) {
  await this.writer('x402_payment_transaction')
    .where({ id: params.paymentId })
    .update({
      actual_byte_count: params.actualByteCount.toString(),
      status: params.status,
      refund_winc: params.refundWinc?.toString(),
      finalized_at: new Date(),
    });
}
```

### 5. Update x402 Route Imports

**Files:** `src/routes/x402/*.ts`

**Action:** Update imports to use local modules

```typescript
// BEFORE (payment service paths)
import { X402Service } from '../../x402/x402Service';
import { X402PricingOracle } from '../../pricing/x402PricingOracle';
import { KoaContext } from '../../server';

// AFTER (bundler lite paths)
import { X402Service } from '../../x402/x402Service';
import { X402PricingOracle } from '../../x402/x402PricingOracle';
import { KoaContext } from '../../types/koaContext';
```

### 6. Add x402 Types

**File:** `src/types/x402Types.ts` (new file)

```typescript
export interface X402Payment {
  id: string;
  userAddress: string;
  userAddressType: string;
  txHash: string;
  network: string;
  tokenAddress: string;
  usdcAmount: string;
  wincAmount: string;
  mode: 'payg' | 'topup' | 'hybrid';
  dataItemId?: string;
  declaredByteCount?: number;
  actualByteCount?: number;
  status: 'pending_validation' | 'confirmed' | 'refunded' | 'fraud_penalty';
  paidAt: Date;
  finalizedAt?: Date;
  refundWinc?: string;
  payerAddress: string;
}
```

### 7. Remove Payment Service Client

**File:** `src/arch/payment.ts`

**Action:** Either delete entirely or keep only type definitions needed by other files

### 8. Update Constants

**File:** `src/constants.ts`

**Action:** Add x402 configuration

```typescript
// x402 Configuration
export const x402Networks = JSON.parse(
  process.env.X402_NETWORKS || '{}'
) as Record<string, X402NetworkConfig>;

export const x402PaymentAddress = process.env.X402_PAYMENT_ADDRESS;
export const x402FraudTolerancePercent = parseInt(
  process.env.X402_FRAUD_TOLERANCE_PERCENT || '5'
);
export const x402PricingBufferPercent = parseInt(
  process.env.X402_PRICING_BUFFER_PERCENT || '5'
);
export const x402PaymentTimeoutMs = parseInt(
  process.env.X402_PAYMENT_TIMEOUT_MS || '300000'
);

export interface X402NetworkConfig {
  enabled: boolean;
  rpcUrl: string;
  usdcAddress: string;
  facilitatorUrl: string;
}
```

### 9. Update Middleware

**File:** `src/middleware/architecture.ts`

**Action:** Initialize x402 service instead of payment service

```typescript
// BEFORE
const paymentService = new TurboPaymentService();

// AFTER
const x402Service = new X402Service(x402Networks);
const x402PricingOracle = new X402PricingOracle();
```

### 10. Remove Unused Features

**Optional:** Remove these features that depend on payment service:

- Balance reservation system
- Delegated payment approvals
- Allow-list checking (or implement locally)

---

## 📦 Installation Steps

After making the above changes:

```bash
# 1. Install dependencies
yarn install

# 2. Start infrastructure
docker-compose up -d

# 3. Run migrations
yarn db:migrate

# 4. Build
yarn build

# 5. Start service
yarn start
```

---

## 🧪 Testing

### Quick Test

```bash
# 1. Get price quote
curl "http://localhost:3001/v1/x402/price/3/0xTestAddress?bytes=1024"

# Should return 402 with payment requirements
```

### Integration Test

Create test file `tests/x402-standalone.test.ts` to verify:

1. Price quote returns correct USDC amount
2. Payment verification works with test signature
3. Upload succeeds with valid x402 payment
4. Fraud detection rejects oversized uploads
5. Finalization refunds overpayments

---

## 📝 Estimated Effort

| Task | Time | Priority |
|------|------|----------|
| Update Architecture | 30 min | High |
| Update dataItemPost | 2 hours | High |
| Add x402 DB methods | 1 hour | High |
| Update Router | 15 min | High |
| Fix imports | 1 hour | Medium |
| Testing | 2 hours | High |
| Documentation | 30 min | Low |

**Total: ~7 hours**

---

## 🚀 Next Steps

1. Make the code changes listed above
2. Test with Base testnet
3. Add example client code
4. Deploy and monitor

---

## ❓ Questions?

If you get stuck, check:
- Original `ar-io-bundler` for reference implementations
- x402 protocol spec: https://github.com/coinbase/x402
- EIP-3009 spec: https://eips.ethereum.org/EIPS/eip-3009
