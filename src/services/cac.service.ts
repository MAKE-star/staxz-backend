import { logger } from '../utils/logger';

interface DojahCAcResponse {
  entity: {
    registration_number: string;
    company_name: string;
    status: string;
    type: string;
    address: string;
    registration_date: string;
  };
}

interface CACVerificationResult {
  verified: boolean;
  registeredName: string | null;
  status: string | null;
  error: string | null;
}

export class CACService {
  private static readonly BASE_URL = 'https://api.dojah.io';

  static async verify(cacNumber: string): Promise<CACVerificationResult> {
    const appId      = process.env.DOJAH_APP_ID;
    const privateKey = process.env.DOJAH_PRIVATE_KEY;

    // If Dojah not configured — log warning but don't block (dev mode)
    if (!appId || !privateKey) {
      logger.warn({ cacNumber }, 'Dojah not configured — skipping CAC verification');
      return { verified: true, registeredName: null, status: 'unverified', error: null };
    }

    try {
      // Normalise CAC number — remove dashes, uppercase
      const normalised = cacNumber.replace(/-/g, '').toUpperCase();

      // Determine type: BN = business name, RC = company
      const isBN = normalised.startsWith('BN');
      const isRC = normalised.startsWith('RC');

      if (!isBN && !isRC) {
        return { verified: false, registeredName: null, status: null, error: 'Unsupported CAC format. Use BN- or RC- prefix.' };
      }

      const endpoint = isBN
        ? `/api/v1/kyc/cac/advance?rc_number=${normalised}`
        : `/api/v1/kyc/cac/advance?rc_number=${normalised}`;

      const res = await fetch(`${this.BASE_URL}${endpoint}`, {
        headers: {
          'AppId':        appId,
          'Authorization': privateKey,
          'Content-Type': 'application/json',
        },
      });

      if (res.status === 404) {
        return { verified: false, registeredName: null, status: null, error: 'CAC number not found. Please check and try again.' };
      }

      if (!res.ok) {
        const err = await res.json().catch(() => ({})) as any;
        logger.error({ cacNumber, status: res.status, err }, 'Dojah CAC verification failed');
        return { verified: false, registeredName: null, status: null, error: 'CAC verification failed. Please try again.' };
      }

      const data = await res.json() as DojahCAcResponse;
      const entity = data?.entity;

      if (!entity) {
        return { verified: false, registeredName: null, status: null, error: 'Could not retrieve CAC details.' };
      }

      // Only allow ACTIVE businesses
      const isActive = entity.status?.toLowerCase().includes('active') ?? false;

      return {
        verified:       isActive,
        registeredName: entity.company_name ?? null,
        status:         entity.status ?? null,
        error:          isActive ? null : `Business status is "${entity.status}". Only active businesses can register.`,
      };

    } catch (err) {
      logger.error({ cacNumber, err }, 'Dojah API error');
      return { verified: false, registeredName: null, status: null, error: 'CAC verification service unavailable. Please try again.' };
    }
  }

  /**
   * Check if the entered business name loosely matches the CAC registered name.
   * Uses simple inclusion check — not strict equality.
   */
  static nameMatches(enteredName: string, registeredName: string): boolean {
    const clean = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, '').trim();
    const entered    = clean(enteredName);
    const registered = clean(registeredName);

    // Check if any significant word from entered name appears in registered name
    const words = entered.split(' ').filter(w => w.length > 2);
    return words.some(word => registered.includes(word));
  }
}