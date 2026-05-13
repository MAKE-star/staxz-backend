import { runEnquiryExpiryJob } from './enquiry-expiry.job';
import { runAutoRefundJob } from './auto-refund.job';
import { runPaymentExpiryJob } from './payment-expiry.job';
import { logger } from '../utils/logger';

const FIVE_MINUTES  = 5  * 60 * 1000;
const THIRTY_MINUTES = 30 * 60 * 1000;

function safeRun(name: string, fn: () => Promise<void>) {
  return async () => {
    try {
      await fn();
    } catch (err) {
      logger.error({ err, job: name }, 'Background job failed');
    }
  };
}

export function startScheduler(): void {
  logger.info('Starting background job scheduler');

  // Run immediately on boot, then on interval
  safeRun('enquiryExpiry', runEnquiryExpiryJob)();
  safeRun('paymentExpiry', runPaymentExpiryJob)();
  safeRun('autoRefund', runAutoRefundJob)();

  setInterval(safeRun('enquiryExpiry', runEnquiryExpiryJob), FIVE_MINUTES);
  setInterval(safeRun('paymentExpiry', runPaymentExpiryJob), FIVE_MINUTES);
  setInterval(safeRun('autoRefund', runAutoRefundJob), THIRTY_MINUTES);

  logger.info('✅ Scheduler started (enquiryExpiry: 5m, paymentExpiry: 5m, autoRefund: 30m)');
}
