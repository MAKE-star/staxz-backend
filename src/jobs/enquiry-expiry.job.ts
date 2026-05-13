import { EnquiryModel } from '../models/enquiry.model';
import { NotificationService } from '../services/notification.service';
import { WhatsAppService } from '../services/whatsapp.service';
import { db } from '../config/database';
import { logger } from '../utils/logger';

/**
 * Runs every 5 minutes.
 * 1. Finds enquiries where provider has not responded within 60 mins.
 * 2. Marks them expired.
 * 3. Re-broadcasts to the next 3 nearest providers in that category.
 * 4. Notifies the hirer.
 */
export async function runEnquiryExpiryJob(): Promise<void> {
  logger.debug('Running enquiry expiry job');

  const expiredIds = await EnquiryModel.expireStale();
  if (!expiredIds.length) return;

  logger.info({ count: expiredIds.length }, 'Expired stale enquiries');

  for (const enquiryId of expiredIds) {
    try {
      await handleExpiredEnquiry(enquiryId);
    } catch (err) {
      logger.error({ err, enquiryId }, 'Error handling expired enquiry');
    }
  }
}

async function handleExpiredEnquiry(enquiryId: string): Promise<void> {
  const { rows } = await db.query(
    `SELECT e.*, p.location_lat, p.location_lng
     FROM enquiries e
     JOIN providers p ON p.id = e.provider_id
     WHERE e.id = $1`,
    [enquiryId]
  );
  const enquiry = rows[0];
  if (!enquiry) return;

  // Notify hirer that provider didn't respond
  await NotificationService.sendToUser(enquiry.hirer_id, {
    title: 'No Response — Retrying 🔄',
    body: 'Your provider didn\'t respond in time. We\'re finding another one near you.',
    data: { enquiryId, type: 'enquiry_expired' },
  });

  // Find next 3 nearest providers in the same category (excluding original)
  const { rows: alternates } = await db.query(
    `SELECT p.id, p.whatsapp_number,
      (6371 * acos(
        cos(radians($1)) * cos(radians(p.location_lat)) *
        cos(radians(p.location_lng) - radians($2)) +
        sin(radians($1)) * sin(radians(p.location_lat))
      )) AS distance_km
     FROM providers p
     WHERE p.is_live = true
       AND p.id != $3
       AND $4 = ANY(p.service_categories)
       AND p.location_lat IS NOT NULL
     ORDER BY distance_km ASC
     LIMIT 3`,
    [enquiry.location_lat, enquiry.location_lng, enquiry.provider_id, enquiry.category_id]
  );

  if (!alternates.length) {
    logger.warn({ enquiryId }, 'No alternate providers found for re-broadcast');
    await NotificationService.sendToUser(enquiry.hirer_id, {
      title: 'No Providers Available',
      body: 'We couldn\'t find another provider right now. Please try searching again.',
      data: { enquiryId, type: 'no_providers' },
    });
    return;
  }

  // Re-broadcast to alternates — create new enquiries for each
  for (const provider of alternates) {
    await db.query(
      `INSERT INTO enquiries (
        hirer_id, provider_id, category_id, service_type,
        inspiration_photo_url, notes, status, quote_expires_at
      ) SELECT hirer_id, $1, category_id, service_type,
               inspiration_photo_url, notes, 'pending',
               NOW() + INTERVAL '60 minutes'
        FROM enquiries WHERE id = $2`,
      [provider.id, enquiryId]
    );

    await WhatsAppService.sendEnquiryToProvider({
      enquiryId: 'rebroadcast',
      hirerId: enquiry.hirer_id,
      providerId: provider.id,
      providerWhatsApp: provider.whatsapp_number,
      categoryId: enquiry.category_id,
      serviceType: enquiry.service_type,
      notes: enquiry.notes,
      inspirationPhotoUrl: enquiry.inspiration_photo_url,
    });
  }

  logger.info({ enquiryId, broadcastCount: alternates.length }, 'Re-broadcast to alternate providers');
}
