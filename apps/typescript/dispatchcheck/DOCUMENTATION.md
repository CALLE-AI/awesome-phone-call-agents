# DispatchCheck — Complete Codebase Documentation

> A pre-delivery order confirmation system for cash-on-delivery (COD)
> e-commerce, built on NestJS and powered by [CALL-E](https://www.heycall-e.com).

---

## Table of Contents

1. [What the app does](#1-what-the-app-does)
2. [The problem it solves](#2-the-problem-it-solves)
3. [Technology stack](#3-technology-stack)
4. [Project structure](#4-project-structure)
5. [How the pieces fit together (architecture overview)](#5-how-the-pieces-fit-together)
6. [Environment & configuration](#6-environment--configuration)
7. [File-by-file walkthrough](#7-file-by-file-walkthrough)
   - [Entry point — `src/main.ts`](#71-entry-point--srcmaints)
   - [Root module — `src/app.module.ts`](#72-root-module--srcappmodulets)
   - [Orders feature](#73-orders-feature)
     - [`order-status.enum.ts`](#731-order-statusenumts)
     - [`order.entity.ts`](#732-orderentityts)
     - [`dto/create-order.dto.ts`](#733-dtocreate-orderdtots)
     - [`orders.module.ts`](#734-ordersmodulets)
     - [`orders.controller.ts`](#735-orderscontrollerts)
     - [`orders.service.ts`](#736-ordersservicets)
   - [Call verification feature](#74-call-verification-feature)
     - [`calle-client.provider.ts`](#741-calle-clientproviderts)
     - [`call-verification.module.ts`](#742-call-verificationmodulets)
     - [`call-verification.service.ts`](#743-call-verificationservicets)
   - [Frontend — `public/index.html`](#75-frontend--publicindexhtml)
8. [Full request lifecycle (step by step)](#8-full-request-lifecycle)
9. [Order status lifecycle](#9-order-status-lifecycle)
10. [API reference](#10-api-reference)
11. [Running the app](#11-running-the-app)
12. [Key design decisions explained](#12-key-design-decisions-explained)
13. [What is a stub vs. production-ready](#13-what-is-a-stub-vs-production-ready)

---

## 1. What the app does

DispatchCheck is a backend service (with a built-in browser dashboard) that
**calls a customer by phone before a delivery rider is dispatched**. When an
order comes in, CALL-E (an AI phone-call API) rings the customer, asks them to
confirm:

- they still want the order,
- the delivery address on file is correct,
- they will be available to receive it today.

Based on what the customer says, the order gets one of five statuses
(`CONFIRMED`, `DECLINED`, `ADDRESS_MISMATCH`, `UNREACHABLE`, `PENDING_CALL`).
Only orders in `CONFIRMED` are ever allowed to be dispatched.

---

## 2. The problem it solves

In Africa (Nigeria, Ghana, etc.), cash-on-delivery is the dominant payment
method for online shopping. The risk for sellers is:

- A rider makes the trip and the customer is not home.
- The customer changed their mind but never cancelled.
- The address was entered incorrectly.

All of these result in a **wasted delivery trip the seller pays for**.
DispatchCheck eliminates those cases by inserting an automated phone
confirmation step before the rider ever leaves.

---

## 3. Technology stack

| Layer | Technology |
|---|---|
| Runtime | Node.js |
| Language | TypeScript (compiled to CommonJS) |
| Framework | NestJS 10 |
| HTTP server | Express (via `@nestjs/platform-express`) |
| Validation | `class-validator` + `class-transformer` |
| Config | `@nestjs/config` (reads `.env`) |
| AI phone calls | `@call-e/calle` SDK (ESM-only package) |
| Order storage | In-memory `Map` (demo; swap for DB in production) |
| Frontend | Plain HTML/CSS/JS served as static files |

---

## 4. Project structure

```
dispatchcheck/
├── public/
│   └── index.html                  ← browser dashboard (no build step needed)
├── src/
│   ├── main.ts                     ← app entry point, bootstraps NestJS
│   ├── app.module.ts               ← root module, wires everything together
│   ├── orders/
│   │   ├── dto/
│   │   │   └── create-order.dto.ts ← validates incoming POST /orders body
│   │   ├── order-status.enum.ts    ← the 5 possible states an order can be in
│   │   ├── order.entity.ts         ← TypeScript interface describing an Order
│   │   ├── orders.controller.ts    ← HTTP routes: POST /orders, GET /orders, GET /orders/:id
│   │   ├── orders.module.ts        ← NestJS module for the orders feature
│   │   └── orders.service.ts       ← business logic: create order, call customer, store result
│   └── call-verification/
│       ├── calle-client.provider.ts    ← creates the CALL-E SDK client (handles ESM workaround)
│       ├── call-verification.module.ts ← NestJS module for the call-verification feature
│       └── call-verification.service.ts← places the phone call and interprets the result
├── .env                            ← secrets (CALLE_API_KEY) — never commit this
├── package.json
└── tsconfig.json
```

---

## 5. How the pieces fit together

```
Browser / API client
        │
        │  POST /orders  (JSON body)
        ▼
┌─────────────────────────┐
│   OrdersController      │  ← receives HTTP request
└─────────┬───────────────┘
          │ calls
          ▼
┌─────────────────────────┐
│   OrdersService         │  ← creates the Order object, stores it, calls verification
└─────────┬───────────────┘
          │ calls
          ▼
┌─────────────────────────┐
│  CallVerificationService│  ← builds the call prompt, sends it to CALL-E, waits for result
└─────────┬───────────────┘
          │ uses
          ▼
┌─────────────────────────┐
│  CALL-E SDK (CalleClient│  ← makes a real outbound phone call to the customer
└─────────────────────────┘
          │
          │  customer picks up, speaks to CALL-E's AI agent
          │
          │  structured result returned (confirmed / declined / address_mismatch / unknown)
          ▼
┌─────────────────────────┐
│  OrdersService          │  ← updates order.status based on call result
└─────────┬───────────────┘
          │
          ▼
  HTTP response with order + canDispatch flag
```

The browser dashboard (`public/index.html`) talks to the same HTTP endpoints
(`POST /orders`, `GET /orders`) using plain `fetch()` calls and auto-refreshes
every 5 seconds.

---

## 6. Environment & configuration

The app reads one environment variable from a `.env` file:

| Variable | Required | Description |
|---|---|---|
| `CALLE_API_KEY` | **Yes** | Your API key from [heycall-e.com](https://www.heycall-e.com) |
| `PORT` | No | HTTP port to listen on. Defaults to `3000`. |

To set up:
```bash
# copy the example file (if it exists) or create .env manually
cp .env.example .env

# then open .env and fill in your CALLE_API_KEY
```

`@nestjs/config` loads this file automatically at startup and makes all
variables available application-wide via `ConfigService`.

---

## 7. File-by-file walkthrough

### 7.1 Entry point — `src/main.ts`

This is the first file Node.js runs. It does four things:

1. **Creates the NestJS application** using `NestFactory.create()`.
   CORS is enabled so the browser dashboard (or external tools) can call the
   API from any origin.

2. **Registers a global `ValidationPipe`** — every incoming request body is
   automatically validated and transformed according to the DTO class
   decorators (see §7.3.3). `whitelist: true` strips out any extra fields the
   client sent that are not in the DTO.

3. **Serves the static dashboard** from the `public/` folder. When you open
   `http://localhost:3000` in a browser, NestJS returns `public/index.html`.

4. **Starts the HTTP server** on `PORT` (default `3000`) and logs the URL.

```typescript
// key lines from main.ts
const app = await NestFactory.create<NestExpressApplication>(AppModule, { cors: true });
app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
app.useStaticAssets(join(__dirname, '..', 'public'));
await app.listen(process.env.PORT || 3000);
```

---

### 7.2 Root module — `src/app.module.ts`

The root module is the top-level wiring file. It imports:

- **`ConfigModule.forRoot({ isGlobal: true })`** — loads `.env` once and
  makes `ConfigService` injectable everywhere in the app without re-importing
  `ConfigModule` in every feature module.
- **`CallVerificationModule`** — registers the CALL-E client and
  `CallVerificationService`.
- **`OrdersModule`** — registers the orders controller and service.

```typescript
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CallVerificationModule,
    OrdersModule,
  ],
})
export class AppModule {}
```

Think of this file as the table of contents for the whole application.

---

### 7.3 Orders feature

#### 7.3.1 `order-status.enum.ts`

Defines the five possible states an order can be in during its lifecycle.
Using a TypeScript `enum` instead of raw strings prevents typos and makes the
intent obvious everywhere in the code.

```
PENDING_CALL      Order received; confirmation call not placed yet.
CONFIRMED         Customer confirmed: wants the order, address is correct.
DECLINED          Customer said they no longer want the order.
UNREACHABLE       Call did not connect (no answer, phone off, bad number).
ADDRESS_MISMATCH  Customer wants the order but says the address on file is wrong.
```

---

#### 7.3.2 `order.entity.ts`

A TypeScript `interface` (not a database model) that describes the shape of
an order object as it lives in memory. Key fields:

| Field | Type | Purpose |
|---|---|---|
| `id` | `string` (UUID) | Unique identifier, generated automatically |
| `customerName` | `string` | Customer's full name |
| `phoneNumber` | `string` | E.164 phone number (e.g. `+2348012345678`) |
| `deliveryAddress` | `string` | Where the order should be delivered |
| `itemDescription` | `string` | What was ordered |
| `price` | `number` | Order value |
| `currency` | `string` | Defaults to `NGN` (Nigerian Naira) |
| `status` | `OrderStatus` | Current lifecycle state (see above) |
| `callSummary` | `string?` | Optional: what the call was about (from CALL-E) |
| `correctedAddress` | `string?` | Optional: address the customer gave if `ADDRESS_MISMATCH` |
| `declineReason` | `string?` | Optional: why customer declined (if `DECLINED`) |
| `createdAt` | `Date` | When the order was received |
| `updatedAt` | `Date` | When it was last changed |

---

#### 7.3.3 `dto/create-order.dto.ts`

A **Data Transfer Object** (DTO) is a class that defines exactly what shape
of data is allowed in an HTTP request body. NestJS validates every incoming
`POST /orders` body against this class automatically (thanks to the global
`ValidationPipe` in `main.ts`).

```typescript
class CreateOrderDto {
  @IsString()
  customerName: string;

  @IsPhoneNumber(undefined, { message: '...' })
  phoneNumber: string;          // must be E.164 format: +countrycode + number

  @IsString()
  deliveryAddress: string;

  @IsString()
  itemDescription: string;

  @IsNumber() @Min(0)
  price: number;                // must be a non-negative number

  @IsOptional() @IsString()
  currency?: string;            // defaults to 'NGN' if omitted
}
```

If any required field is missing or invalid (e.g. `price: -5` or
`phoneNumber: "0803..."` without country code), NestJS returns a `400 Bad
Request` before the request ever reaches the controller.

---

#### 7.3.4 `orders.module.ts`

The NestJS module that registers everything needed for the orders feature:

- **Imports** `CallVerificationModule` — because `OrdersService` depends on
  `CallVerificationService`, which lives in that module.
- **Controllers**: `OrdersController`
- **Providers**: `OrdersService`

```typescript
@Module({
  imports: [CallVerificationModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
```

---

#### 7.3.5 `orders.controller.ts`

The controller maps HTTP routes to service calls. There are three endpoints:

| Method | Path | What it does |
|---|---|---|
| `POST` | `/orders` | Create a new order and immediately call the customer |
| `GET` | `/orders` | List all orders (newest first) |
| `GET` | `/orders/:id` | Get one order by its UUID |

The `POST /orders` handler calls `ordersService.createAndVerify(dto)` and
returns both the full order object and a `canDispatch` boolean — so the
caller knows immediately whether the order is safe to dispatch:

```json
{
  "order": { "id": "...", "status": "CONFIRMED", ... },
  "canDispatch": true
}
```

The `canDispatch` flag is `true` only when `status === 'CONFIRMED'`.

---

#### 7.3.6 `orders.service.ts`

This is the core business logic layer. It manages the in-memory order store
and orchestrates the confirmation call.

**Storage:**  
Orders are kept in a `Map<string, Order>` (a key-value store keyed by UUID).
This is intentionally simple for the demo — the comment in the code explicitly
says "swap for Postgres/Mongo before going to production".

**`createAndVerify(dto)` — the main method:**

1. Generates a UUID for the new order.
2. Sets `status` to `PENDING_CALL` (the call hasn't happened yet).
3. Saves the order to the map.
4. Calls `callVerification.confirmOrder(dto, order.id)`.
5. Updates `order.status`, `order.callSummary`, `order.correctedAddress`, or
   `order.declineReason` based on the call result.
6. If the call throws any error (network issue, API error), sets status to
   `UNREACHABLE` — the fail-safe. An order with a failed call is never
   accidentally marked dispatchable.
7. Updates `order.updatedAt` and saves the final state.
8. Returns the complete order.

**Error handling detail:**  
The catch block carefully extracts `.code`, `.status`, and `.details` from
the CALL-E error (not just `.message`) because CALL-E's `CalleAPIError`
objects carry richer diagnostic information in those fields.

**`canDispatch(order):`**  
A simple guard that returns `true` only if `status === CONFIRMED`. This is
the single source of truth for whether a rider can be sent.

---

### 7.4 Call verification feature

This feature is responsible for everything related to making the phone call.

#### 7.4.1 `calle-client.provider.ts`

**Purpose:** creates and provides the `CalleClient` instance to the rest of
the app.

**The problem it solves (ESM vs CommonJS):**  
The `@call-e/calle` SDK is an ESM-only package (it uses ES Modules). This
NestJS project compiles to CommonJS (the standard for NestJS). Normally when
you write `import('@call-e/calle')` in TypeScript, the TypeScript compiler
silently converts it to `require('@call-e/calle')` in the compiled output —
and `require()` cannot load ESM packages, causing a crash at startup
(`ERR_REQUIRE_ESM`).

**The workaround:**  
The provider uses a trick: it wraps the dynamic import in `new Function(...)`:

```typescript
const dynamicImport = new Function('specifier', 'return import(specifier)');
```

Because `new Function(...)` creates a function at runtime (not at compile
time), TypeScript cannot see the `import()` inside it and therefore does not
convert it to `require()`. The real `import()` call survives into the
compiled JavaScript and can successfully load the ESM package.

**What it provides:**  
An `async` NestJS provider (a factory function) that:
1. Reads `CALLE_API_KEY` from the environment via `ConfigService`.
2. Throws a clear error if the key is missing (better than a cryptic
   "undefined" API error later).
3. Dynamically imports the SDK and creates a `new CalleClient({ apiKey })`.
4. Registers this instance under the token `CALLE_CLIENT` so it can be
   injected anywhere using `@Inject(CALLE_CLIENT)`.

---

#### 7.4.2 `call-verification.module.ts`

Registers `CalleClientProvider` and `CallVerificationService` as providers,
and **exports** `CallVerificationService` so that `OrdersModule` can import
and use it.

```typescript
@Module({
  imports: [ConfigModule],
  providers: [CalleClientProvider, CallVerificationService],
  exports: [CallVerificationService],
})
export class CallVerificationModule {}
```

---

#### 7.4.3 `call-verification.service.ts`

This service contains all the logic for interacting with the CALL-E API.

---

**`confirmOrder(order, orderId)` — the main public method:**

Builds a request and sends it to CALL-E. The call uses **two key inputs**:

**1. The `task` prompt**  
Built by `buildTaskPrompt()`. It is a plain English instruction that CALL-E's
AI agent follows on the phone call. Example of what it produces:

> *"Call +2348012345678 to confirm an order before it is dispatched for
> delivery. Ask for Ada Obi. Order: Bluetooth headphones, price 15000 NGN.
> Delivery address on file: 12 Allen Avenue, Ikeja, Lagos. Politely confirm:
> (1) they still want this order, (2) the delivery address above is correct,
> (3) they will be available to receive it today. If they no longer want the
> order, ask for a one-sentence reason and end the call politely. If the
> address is wrong, ask them to state the correct address in full."*

The phone number is **embedded in the task text** itself. Per CALL-E's
documentation, when `recipients` is omitted, CALL-E infers the target number
from the task.

**2. The `resultSchema`**  
A JSON Schema object that tells CALL-E what structured data to return after
the call. Instead of returning a free-text transcript, CALL-E fills in this
schema based on what was said:

```json
{
  "outcome": "confirmed" | "declined" | "address_mismatch" | "unknown",
  "correctedAddress": "...",
  "declineReason": "..."
}
```

This means the app never has to parse natural language transcripts — it gets
a clean, typed object back.

---

**Why `create()` + `waitForResultWithRetry()` instead of `createAndWait()`:**

The SDK has a convenient `createAndWait()` method that creates a call and
polls until it finishes. The service deliberately avoids it and instead:

1. Calls `calle.calls.create()` to start the call and get back a `call.id`.
2. Calls `waitForResultWithRetry(call.id)` to poll for the result.

The reason: if the network drops during polling, using `createAndWait()` would
lose the `call.id` entirely. The call might have completed successfully on
CALL-E's side, but the app would have no way to retrieve the result. By
separating the two steps, a polling failure can retry against the same
`call.id` safely — it never re-dials the customer.

---

**`waitForResultWithRetry(callId, maxAttempts=3)`:**

A private helper that polls for the call result up to 3 times, with
increasing back-off delays (1.5s, 3s) between attempts. If all polling
attempts fail, it falls back to a direct `calle.calls.get(callId)` — a
single read of whatever state the call is in right now. If that also fails,
it throws the original error.

---

**`interpretResult(call)` — translates CALL-E output to `OrderStatus`:**

Maps the `structuredResult.outcome` from the call to an `OrderStatus`:

| CALL-E `outcome` | `OrderStatus` |
|---|---|
| `confirmed` | `CONFIRMED` |
| `declined` | `DECLINED` (+ copies `declineReason`) |
| `address_mismatch` | `ADDRESS_MISMATCH` (+ copies `correctedAddress`) |
| `unknown` / `null` / no answer | `UNREACHABLE` |

The last case is the **fail-safe**: if anything is unclear, the order is
never treated as dispatchable.

---

### 7.5 Frontend — `public/index.html`

A self-contained, single-page dashboard. No framework, no build step — plain
HTML, CSS, and vanilla JavaScript, served directly by NestJS as a static file.

**Layout:** Two panels side by side:
- **Left panel** — "New order" form with inputs for all order fields.
- **Right panel** — "Order manifest" table showing all submitted orders.

**Visual status indicators:**  
Each order row shows a colored pill based on its status:

| Status | Color | Animated |
|---|---|---|
| `PENDING_CALL` | Blue (pulsing) | Yes — indicates a live call in progress |
| `CONFIRMED` | Green | No |
| `DECLINED` | Red | No |
| `UNREACHABLE` | Red | No |
| `ADDRESS_MISMATCH` | Amber | No |

**JavaScript behavior:**

- On form submit: disables the button, shows "Calling customer…", `POST`s
  the payload to `/orders`, re-enables when done, refreshes the table.
- On load: calls `GET /orders` immediately to populate the table.
- Every 5 seconds: auto-refreshes the table (so status updates from
  in-flight calls appear without manual refresh).
- `escapeHtml()` helper: sanitizes all user-supplied text before inserting
  it into the DOM to prevent XSS attacks.

**Dispatch button logic:**  
Each row has a "Dispatch" button. It is only clickable if `status ===
CONFIRMED`. For all other statuses, it renders as "Hold" and is disabled.

---

## 8. Full request lifecycle

Here is the complete journey of a single order from form submission to result:

```
1. User fills in the form and clicks "Place order & call to confirm"
   → browser sends POST /orders with JSON body

2. ValidationPipe (global) validates the body against CreateOrderDto
   → if invalid: returns 400 with error details, stops here
   → if valid: passes dto to OrdersController.create()

3. OrdersController.create() calls ordersService.createAndVerify(dto)

4. OrdersService.createAndVerify():
   a. Generates a UUID for the order
   b. Creates the Order object with status = PENDING_CALL
   c. Saves it to the in-memory Map
   d. Calls callVerificationService.confirmOrder(dto, order.id)

5. CallVerificationService.confirmOrder():
   a. Builds the task prompt (plain English instruction for CALL-E)
   b. Assembles the resultSchema (JSON Schema for structured output)
   c. Calls calle.calls.create(input, { idempotencyKey: ... })
      → CALL-E places a real phone call to the customer's number
   d. Calls waitForResultWithRetry(call.id)
      → polls calle.calls.waitForResult() up to 3 times
      → customer's phone rings, they speak with CALL-E's AI agent
   e. Calls interpretResult(call)
      → reads call.structuredResult.outcome
      → maps it to an OrderStatus

6. CallVerificationService returns a CallVerificationResult to OrdersService

7. OrdersService updates the order:
   - order.status = result.status
   - order.callSummary = result.summary
   - order.correctedAddress = result.correctedAddress (if ADDRESS_MISMATCH)
   - order.declineReason = result.declineReason (if DECLINED)
   Saves updated order. Returns it.

8. OrdersController wraps the order + canDispatch flag and sends HTTP response

9. Browser receives the response, re-enables the form, refreshes the table
   → the new order row appears with its final status
```

---

## 9. Order status lifecycle

```
                    ┌──────────────┐
  POST /orders ───► │ PENDING_CALL │
                    └──────┬───────┘
                           │  CALL-E calls the customer
                           │
              ┌────────────┼────────────────────┐
              │            │                    │
        Customer        Customer           Call doesn't
        confirms       declines            connect / fails
              │            │                    │
              ▼            ▼              ┌─────┴──────┐
         CONFIRMED      DECLINED         │ UNREACHABLE│
              │                          └────────────┘
       ┌──────┴──────┐
   canDispatch = true   Customer says
                        address is wrong
                             │
                             ▼
                      ADDRESS_MISMATCH
```

Only `CONFIRMED` → `canDispatch: true`. All other states block dispatch.

---

## 10. API reference

### `POST /orders`

Creates an order and immediately calls the customer to confirm.

**Request body:**
```json
{
  "customerName": "Ada Obi",
  "phoneNumber": "+2348012345678",
  "deliveryAddress": "12 Allen Avenue, Ikeja, Lagos",
  "itemDescription": "Bluetooth headphones",
  "price": 15000,
  "currency": "NGN"
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `customerName` | string | Yes | Customer's full name |
| `phoneNumber` | string | Yes | Must be E.164 format (e.g. `+2348012345678`) |
| `deliveryAddress` | string | Yes | Full delivery address |
| `itemDescription` | string | Yes | Description of the item(s) ordered |
| `price` | number | Yes | Order value, must be ≥ 0 |
| `currency` | string | No | Defaults to `NGN` |

**Response (200):**
```json
{
  "order": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "customerName": "Ada Obi",
    "phoneNumber": "+2348012345678",
    "deliveryAddress": "12 Allen Avenue, Ikeja, Lagos",
    "itemDescription": "Bluetooth headphones",
    "price": 15000,
    "currency": "NGN",
    "status": "CONFIRMED",
    "callSummary": "Customer confirmed the order and address.",
    "createdAt": "2024-01-15T10:30:00.000Z",
    "updatedAt": "2024-01-15T10:31:30.000Z"
  },
  "canDispatch": true
}
```

**Note:** This endpoint is synchronous — it waits for the phone call to
complete before returning. Expect a response time of 1–2 minutes depending
on how long the call takes.

---

### `GET /orders`

Returns all orders, sorted newest first.

**Response (200):** Array of Order objects (same shape as above, without the
`canDispatch` wrapper).

---

### `GET /orders/:id`

Returns a single order by UUID.

**Response (200):** Single Order object.  
**Response (404):** `{ "statusCode": 404, "message": "Order <id> not found" }`

---

## 11. Running the app

**Prerequisites:**
- Node.js 18+ installed
- A valid CALL-E API key from [heycall-e.com](https://www.heycall-e.com)

**Steps:**
```bash
# 1. Install dependencies
npm install

# 2. Create and configure .env
# Create a file named .env in the project root with:
# CALLE_API_KEY=your_actual_api_key_here

# 3. Build the TypeScript
npm run build

# 4. Start the server
npm start

# The server is now running at http://localhost:3000
```

**Development mode** (auto-restarts on file changes):
```bash
npm run start:dev
```

**Open the dashboard:**  
Navigate to [http://localhost:3000](http://localhost:3000) in your browser.

---

## 12. Key design decisions explained

### Why not just use `createAndWait()`?

The CALL-E SDK offers a `createAndWait()` method that combines call creation
and result polling. DispatchCheck deliberately avoids it because if the
network connection drops during the polling phase, `createAndWait()` loses
the `call.id`. The actual phone call may have already completed successfully
on CALL-E's side, but the app can't retrieve its result.

By splitting `create()` and `waitForResult()`, any polling failure can retry
against the same `call.id` — the customer is never called a second time.

### Why embed the phone number in the task text?

The CALL-E documentation states that the `recipients` field is optional, and
when omitted, CALL-E infers the target phone number from the task text. This
project also discovered (through a real 422 API response) that the SDK's
`CreateCallInput` type was stale and required a `recipient` field that the
live API actually rejects. Embedding the number in the task text is the
documented, API-compliant approach.

### Why use `idempotencyKey` on `calls.create()`?

If `POST /orders` is retried (e.g. the client times out and resends), the
idempotency key (`dispatchcheck_order_<UUID>`) ensures CALL-E does not make
a second call to the customer. The same UUID-keyed call is returned instead.

### Why is the result schema `additionalProperties: false`?

The CALL-E documentation recommends this for strict object schemas. It
prevents unexpected extra fields from appearing in `call.structuredResult`
and forces CALL-E's agent to be precise about what it fills in.

### Why `new Function(...)` to load the SDK?

`@call-e/calle` is ESM-only; this project compiles to CommonJS. TypeScript's
compiler converts `import()` to `require()` under a CommonJS target, which
crashes at runtime with `ERR_REQUIRE_ESM`. Wrapping the import in
`new Function(...)` makes it invisible to the TypeScript compiler, so the
real ESM `import()` survives into the compiled output. This was verified by
inspecting the compiled `dist/` files directly.

### Why fail-safe to `UNREACHABLE`?

The core business rule is: **never dispatch an unconfirmed order**. Any
ambiguous outcome (no answer, call failed, unclear response, API error) maps
to `UNREACHABLE`, which blocks dispatch. This is a deliberate conservative
choice — a false negative (not dispatching a confirmed order) is cheaper than
a false positive (dispatching an order the customer didn't want).

---

## 13. What is a stub vs. production-ready

| Component | Current state | Production upgrade |
|---|---|---|
| Order storage | In-memory `Map` (lost on restart) | Swap for PostgreSQL or MongoDB; `OrdersService` interface is small enough to lift cleanly |
| Webhook receiver | `POST /orders` takes manual JSON; no real Shopify/WhatsApp integration | Add a mapping layer to translate storefront webhook payloads to `CreateOrderDto` |
| Frontend | Plain HTML served as a static file | Replace with a proper React/Vue app if needed; the API contract is unchanged |
| Authentication | None — any client can call `POST /orders` | Add API key or JWT validation before deployment |
| Currency | Hardcoded default `NGN` | Accept from the storefront payload |
| Error monitoring | `Logger` to stdout | Wire to Sentry, Datadog, or similar for production alerts |
