/**
 * Staxz Dev Seed Data
 * Run: npm run seed
 *
 * Creates:
 * - 1 admin user
 * - 4 hirer users
 * - 4 provider users + provider profiles
 * - Portfolio photos per provider
 * - 6 sample bookings (various statuses)
 * - 2 reviews
 * - 1 open dispute
 */

import { pool } from '../../src/config/database';
import { logger } from '../../src/utils/logger';
import dotenv from 'dotenv';

dotenv.config();

const ADMIN_PHONE    = '+2348000000000';
const HIRERPHONES    = ['+2348011111111', '+2348022222222', '+2348033333333', '+2348044444444'];
const PROVIDERPHONES = ['+2348055555555', '+2348066666666', '+2348077777777', '+2348088888888'];

async function seed() {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');
    logger.info('🌱 Seeding database...');

    // ── CLEAN ────────────────────────────────────────────────────────────────
    await client.query(`
      TRUNCATE push_tokens, disputes, transactions, reviews,
               bookings, enquiries, portfolio_photos, providers, users
      RESTART IDENTITY CASCADE
    `);

    // ── ADMIN ────────────────────────────────────────────────────────────────
    await client.query(
      `INSERT INTO users (phone, role, full_name) VALUES ($1, 'admin', 'Staxz Admin')`,
      [ADMIN_PHONE]
    );

    // ── HIRERS ───────────────────────────────────────────────────────────────
    const hirerData = [
      [HIRERPHONES[0], 'Amara Okonkwo'],
      [HIRERPHONES[1], 'Tunde Mensah'],
      [HIRERPHONES[2], 'Ngozi Adeyemi'],
      [HIRERPHONES[3], 'Funke Karimu'],
    ];
    const hirerIds: string[] = [];
    for (const [phone, name] of hirerData) {
      const { rows } = await client.query(
        `INSERT INTO users (phone, role, full_name) VALUES ($1, 'hirer', $2) RETURNING id`,
        [phone, name]
      );
      hirerIds.push(rows[0].id);
    }

    // ── PROVIDER USERS ───────────────────────────────────────────────────────
    const providerUserData = [
      [PROVIDERPHONES[0], 'Supreme Cuts Owner'],
      [PROVIDERPHONES[1], 'Zara Osei'],
      [PROVIDERPHONES[2], 'Chisom Nwosu'],
      [PROVIDERPHONES[3], 'The Nail Bar Owner'],
    ];
    const providerUserIds: string[] = [];
    for (const [phone, name] of providerUserData) {
      const { rows } = await client.query(
        `INSERT INTO users (phone, role, full_name) VALUES ($1, 'provider', $2) RETURNING id`,
        [phone, name]
      );
      providerUserIds.push(rows[0].id);
    }

    // ── PROVIDERS ────────────────────────────────────────────────────────────
    const providerSeed = [
      {
        userId: providerUserIds[0],
        businessName: 'Supreme Cuts',
        businessType: 'salon',
        cac: 'RC-1234567',
        whatsapp: PROVIDERPHONES[0],
        locationText: 'Lekki Phase 1, Lagos',
        lat: 6.4281, lng: 3.4219,
        modes: ['home', 'walkin'],
        baseFee: 350000,
        cats: ['barbing', 'haircut', 'coloring'],
        rating: 4.9, ratingCount: 214,
      },
      {
        userId: providerUserIds[1],
        businessName: 'Zara Beauty Studio',
        businessType: 'salon',
        cac: 'RC-2345678',
        whatsapp: PROVIDERPHONES[1],
        locationText: 'Victoria Island, Lagos',
        lat: 6.4281, lng: 3.4114,
        modes: ['home', 'walkin'],
        baseFee: 800000,
        cats: ['braids', 'weaves', 'makeup'],
        rating: 4.8, ratingCount: 178,
      },
      {
        userId: providerUserIds[2],
        businessName: 'Glow by Chisom',
        businessType: 'independent',
        cac: null,
        whatsapp: PROVIDERPHONES[2],
        locationText: 'Ikoyi, Lagos',
        lat: 6.4542, lng: 3.4365,
        modes: ['home'],
        baseFee: 1200000,
        cats: ['makeup', 'facials', 'lashes'],
        rating: 4.7, ratingCount: 91,
      },
      {
        userId: providerUserIds[3],
        businessName: 'The Nail Bar',
        businessType: 'salon',
        cac: 'RC-4567890',
        whatsapp: PROVIDERPHONES[3],
        locationText: 'Surulere, Lagos',
        lat: 6.5040, lng: 3.3537,
        modes: ['walkin'],
        baseFee: 500000,
        cats: ['nails', 'spa'],
        rating: 4.6, ratingCount: 63,
      },
    ];

    const providerIds: string[] = [];
    for (const p of providerSeed) {
      const { rows } = await client.query(
        `INSERT INTO providers (
          user_id, business_name, business_type, cac_number,
          whatsapp_number, location_text, location_lat, location_lng,
          service_modes, base_fee_kobo, service_categories,
          cac_verified, is_live, rating_avg, rating_count
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
        RETURNING id`,
        [
          p.userId, p.businessName, p.businessType, p.cac,
          p.whatsapp, p.locationText, p.lat, p.lng,
          p.modes, p.baseFee, p.cats,
          p.cac !== null, true, p.rating, p.ratingCount,
        ]
      );
      providerIds.push(rows[0].id);
    }

    // ── PORTFOLIO PHOTOS (3 per category per provider) ────────────────────────
    for (let pi = 0; pi < providerSeed.length; pi++) {
      const provider = providerSeed[pi];
      for (const cat of provider.cats) {
        for (let i = 1; i <= 3; i++) {
          await client.query(
            `INSERT INTO portfolio_photos (provider_id, category_id, cloudinary_public_id, url)
             VALUES ($1, $2, $3, $4)`,
            [
              providerIds[pi], cat,
              `staxz/portfolio/${cat}_${pi}_${i}`,
              `https://res.cloudinary.com/staxz/image/upload/staxz/portfolio/${cat}_${pi}_${i}.jpg`,
            ]
          );
        }
      }
    }

    // ── BOOKINGS ──────────────────────────────────────────────────────────────
    const bookings = [
      // Upcoming home service
      {
        ref: 'SK-AA0001', hirer: hirerIds[0], provider: providerIds[0],
        serviceType: 'home', quoteKobo: 650000, feeKobo: 97500, totalKobo: 747500,
        status: 'confirmed', paystackRef: 'PSK-TEST-001',
        address: '14 Bode Thomas St, Surulere, Lagos',
      },
      // Completed with review
      {
        ref: 'SK-AA0002', hirer: hirerIds[1], provider: providerIds[1],
        serviceType: 'walkin', quoteKobo: 2000000, feeKobo: 300000, totalKobo: 2300000,
        status: 'completed', paystackRef: 'PSK-TEST-002',
        address: null,
      },
      // Completed bridal makeup
      {
        ref: 'SK-AA0003', hirer: hirerIds[0], provider: providerIds[2],
        serviceType: 'home', quoteKobo: 3500000, feeKobo: 525000, totalKobo: 4025000,
        status: 'completed', paystackRef: 'PSK-TEST-003',
        address: '22 Osborne Road, Ikoyi, Lagos',
      },
      // Disputed
      {
        ref: 'SK-AA0004', hirer: hirerIds[2], provider: providerIds[2],
        serviceType: 'home', quoteKobo: 4500000, feeKobo: 675000, totalKobo: 5175000,
        status: 'disputed', paystackRef: 'PSK-TEST-004',
        address: '5 Glover Road, Ikoyi, Lagos',
      },
      // Pending payment (will expire via job)
      {
        ref: 'SK-AA0005', hirer: hirerIds[3], provider: providerIds[3],
        serviceType: 'walkin', quoteKobo: 550000, feeKobo: 82500, totalKobo: 632500,
        status: 'pending_payment', paystackRef: null,
        address: null,
      },
      // Cancelled
      {
        ref: 'SK-AA0006', hirer: hirerIds[1], provider: providerIds[0],
        serviceType: 'home', quoteKobo: 400000, feeKobo: 60000, totalKobo: 460000,
        status: 'cancelled', paystackRef: 'PSK-TEST-006',
        address: null,
      },
    ];

    const bookingIds: string[] = [];
    for (const b of bookings) {
      const { rows } = await client.query(
        `INSERT INTO bookings (
          reference, hirer_id, provider_id, service_type,
          provider_quote_kobo, platform_fee_kobo, total_charged_kobo,
          status, paystack_ref, service_address,
          completed_at, confirmed_at, escrow_released
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
        RETURNING id`,
        [
          b.ref, b.hirer, b.provider, b.serviceType,
          b.quoteKobo, b.feeKobo, b.totalKobo,
          b.status, b.paystackRef, b.address,
          b.status === 'completed' ? new Date() : null,
          b.status === 'completed' ? new Date() : null,
          b.status === 'completed',
        ]
      );
      bookingIds.push(rows[0].id);
    }

    // ── TRANSACTIONS ─────────────────────────────────────────────────────────
    for (let i = 0; i < bookings.length; i++) {
      const b = bookings[i];
      if (b.paystackRef) {
        await client.query(
          `INSERT INTO transactions (booking_id, type, amount_kobo, paystack_ref, status, metadata)
           VALUES ($1, 'payment', $2, $3, 'success', '{}')`,
          [bookingIds[i], b.totalKobo, b.paystackRef]
        );
      }
      if (b.status === 'completed') {
        await client.query(
          `INSERT INTO transactions (booking_id, type, amount_kobo, status, metadata)
           VALUES ($1, 'escrow_release', $2, 'success', '{}')`,
          [bookingIds[i], b.quoteKobo]
        );
      }
    }

    // ── REVIEWS ───────────────────────────────────────────────────────────────
    // Review on booking SK-AA0002
    await client.query(
      `INSERT INTO reviews (booking_id, reviewer_id, reviewee_id, stars, body)
       VALUES ($1, $2, $3, 5, 'Absolutely top notch. The braids were exactly like my photo. Will be back!')`,
      [bookingIds[1], hirerIds[1], providerUserIds[1]]
    );

    // Review on booking SK-AA0003
    await client.query(
      `INSERT INTO reviews (booking_id, reviewer_id, reviewee_id, stars, body)
       VALUES ($1, $2, $3, 5, 'Best bridal makeup I have ever had. She came to my house and everything was perfect.')`,
      [bookingIds[2], hirerIds[0], providerUserIds[2]]
    );

    // ── DISPUTE ───────────────────────────────────────────────────────────────
    // On booking SK-AA0004
    await client.query(
      `INSERT INTO disputes (booking_id, raised_by, reason, details, status)
       VALUES ($1, $2, $3, $4, 'open')`,
      [
        bookingIds[3],
        hirerIds[2],
        "Provider didn't show up",
        "She confirmed the booking but never arrived and stopped picking calls after 9am.",
      ]
    );

    await client.query('COMMIT');
    logger.info('✅ Database seeded successfully');
    logger.info('   Users created: 1 admin, 4 hirers, 4 providers');
    logger.info('   Bookings: 6 (confirmed, 2×completed, disputed, pending, cancelled)');
    logger.info('   Reviews: 2 | Disputes: 1 open');
    logger.info(`\n   Test credentials (OTP auto-verified in dev):`);
    logger.info(`   Hirer:    ${HIRERPHONES[0]}`);
    logger.info(`   Provider: ${PROVIDERPHONES[0]}`);
    logger.info(`   Admin:    ${ADMIN_PHONE}`);
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error({ err }, '❌ Seed failed');
    throw err;
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
