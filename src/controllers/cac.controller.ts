import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { CACService } from '../services/cac.service';
import { sendSuccess } from '../utils/response';

export class CACController {
  /**
   * POST /api/v1/cac/verify
   * Verifies a CAC number via Dojah and checks name match
   */
  static async verify(req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> {
    try {
      const { cac_number, business_name } = req.body as { cac_number: string; business_name: string };

      if (!cac_number || !business_name) {
        res.status(400).json({ success: false, error: 'cac_number and business_name are required' });
        return;
      }

      const result = await CACService.verify(cac_number);

      if (!result.verified) {
        res.status(422).json({
          success: false,
          error: result.error ?? 'CAC verification failed',
          data: { verified: false, registeredName: null },
        });
        return;
      }

      // Check name match if we got a registered name
      let nameMatch = true;
      let nameWarning: string | null = null;

      if (result.registeredName) {
        nameMatch = CACService.nameMatches(business_name, result.registeredName);
        if (!nameMatch) {
          nameWarning = `Business name does not match CAC records. Registered name: "${result.registeredName}"`;
        }
      }

      if (!nameMatch) {
        res.status(422).json({
          success: false,
          error: nameWarning,
          data: { verified: false, registeredName: result.registeredName },
        });
        return;
      }

      sendSuccess(res, {
        verified:       true,
        registeredName: result.registeredName,
        status:         result.status,
        nameMatch,
      }, 200, 'CAC verified successfully');

    } catch (err) {
      next(err);
    }
  }
}