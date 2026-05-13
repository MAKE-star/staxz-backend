# Staxz API — Backend

Nigeria's Beauty & Grooming Marketplace — REST API

## Stack
- **Runtime**: Node.js 20 + TypeScript
- **Framework**: Express 5
- **Database**: PostgreSQL 16 (hosted on Neon/Supabase)
- **Cache/Sessions**: Redis (Upstash)
- **Payments**: Paystack
- **WhatsApp**: Wati.ng
- **SMS/OTP**: Termii
- **File Storage**: Cloudinary
- **Push**: Firebase FCM
- **Hosting**: Railway

## Architecture: MVC

```
src/
├── config/         # DB, Redis, Cloudinary connections
├── controllers/    # Request handlers (thin — just call services)
├── middleware/     # Auth, validation, error handling
├── models/         # Database queries (raw SQL with pg)
├── routes/         # Express router definitions
├── services/       # Business logic (booking flow, payments, etc.)
├── types/          # Shared TypeScript types
├── utils/          # Logger, errors, response helpers, crypto
└── validators/     # Zod schemas
```

## Quick Start

```bash
# 1. Install dependencies
npm install

# 2. Copy and fill env vars
cp .env.example .env

# 3. Run database migrations
psql $DATABASE_URL -f database/migrations/001_initial_schema.sql

# 4. Start dev server
npm run dev
```

## API Endpoints

### Auth
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/request-otp` | Send OTP to phone |
| POST | `/api/v1/auth/verify-otp` | Verify OTP → JWT |
| POST | `/api/v1/auth/refresh` | Refresh access token |
| POST | `/api/v1/auth/logout` | Invalidate refresh token |

### Providers
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/providers` | List providers (with GPS filter) |
| GET | `/api/v1/providers/:id` | Provider profile + portfolio |
| POST | `/api/v1/providers/onboard` | Register as provider |
| PUT | `/api/v1/providers/:id` | Update profile |
| POST | `/api/v1/providers/:id/portfolio` | Upload photo |

### Booking Flow
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/enquiries` | Create enquiry → WhatsApp bot |
| POST | `/api/v1/enquiries/:id/accept` | Accept quote → Paystack |
| GET | `/api/v1/bookings` | List my bookings |
| POST | `/api/v1/bookings/:id/complete` | Provider: mark done |
| POST | `/api/v1/bookings/:id/confirm` | Hirer: confirm → release escrow |
| POST | `/api/v1/bookings/:id/cancel` | Cancel with fee logic |
| POST | `/api/v1/bookings/:id/dispute` | Raise dispute → freeze escrow |
| POST | `/api/v1/bookings/:id/review` | Leave review |

### Webhooks
| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/webhooks/paystack` | Paystack payment events |
| POST | `/api/v1/webhooks/wati` | WhatsApp incoming messages |

### Admin
| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/v1/admin/dashboard` | Platform stats |
| GET | `/api/v1/admin/disputes` | Open disputes |
| POST | `/api/v1/admin/disputes/:bookingId/resolve` | Refund or release |
| GET | `/api/v1/admin/users` | All users |
| POST | `/api/v1/admin/users/:id/suspend` | Suspend account |

## Deployment (Railway)

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway init
railway up
```

Set all env vars from `.env.example` in the Railway dashboard.

## Money

All monetary values stored in **kobo** (integer). ₦1 = 100 kobo.  
Platform fee = 15% of provider quote.  
Provider receives 85% on escrow release.
