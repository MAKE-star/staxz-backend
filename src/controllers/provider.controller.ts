import { Request, Response } from 'express';
import { ProviderModel } from '../models/provider.model';
import { ReviewModel } from '../models/review.model';
import { UserModel } from '../models/user.model';
import { ProviderService } from '../services/provider.service';
import { AuthenticatedRequest, UserRole, ServiceMode } from '../types';
import { sendSuccess, sendCreated, buildPagination } from '../utils/response';
import { NotFoundError, ForbiddenError, ConflictError, AppError, ValidationError } from '../utils/errors';
import { cloudinary } from '../config/cloudinary';

export class ProviderController {
  static async list(req: Request, res: Response): Promise<void> {
    const { lat, lng, radius, category, mode, sort, page = '1', limit = '20' } = req.query as Record<string, string>;

    const result = await ProviderModel.list({
      lat: lat ? parseFloat(lat) : undefined,
      lng: lng ? parseFloat(lng) : undefined,
      radius: radius ? parseFloat(radius) : undefined,
      category,
      mode: mode as ServiceMode | undefined,
      sort: sort as 'rating' | 'distance' | 'price' | undefined,
      page: parseInt(page, 10),
      limit: Math.min(parseInt(limit, 10), 50),
    });

    const pageNum = parseInt(page, 10);
    const limitNum = parseInt(limit, 10);

    sendSuccess(res, result.rows, 200, undefined, buildPagination(pageNum, limitNum, result.total));
  }

  static async getById(req: Request, res: Response): Promise<void> {
    const provider = await ProviderModel.findById(req.params['id'] as string);
    if (!provider) throw new NotFoundError('Provider');

    const photos = await ProviderModel.getPortfolioPhotos(provider.id);
    sendSuccess(res, { ...provider, portfolioPhotos: photos });
  }

  static async onboard(req: AuthenticatedRequest, res: Response): Promise<void> {
    const existing = await ProviderModel.findByUserId(req.user.id);
    if (existing) throw new ConflictError('Provider profile already exists');

    const {
      business_name, business_type, cac_number, whatsapp_number,
      location_text, location_lat, location_lng, service_modes,
      base_fee_kobo, service_categories,
      bank_account_name, bank_account_number, bank_code,
      years_experience, bio,
    } = req.body;

    // ── Onboarding criteria validation ──────────────────────────────────────
    const criteria = await ProviderService.validateOnboardingCriteria({
      business_name,
      business_type,
      cac_number,
      whatsapp_number,
      service_categories,
      service_modes,
      base_fee_kobo,
      bank_account_number,
      bank_account_name,
      bank_code,
      location_text,
      location_lat,
      location_lng,
      bio,
      years_experience,
    });

    if (!criteria.passed) {
      throw new ValidationError('Onboarding requirements not met', criteria.errors);
    }

    // ── Create provider record ───────────────────────────────────────────────
    const provider = await ProviderModel.create({
      user_id: req.user.id,
      business_name,
      business_type,
      cac_number: cac_number ?? null,
      whatsapp_number,
      location_text: location_text ?? null,
      location_lat: location_lat ?? null,
      location_lng: location_lng ?? null,
      service_modes,
      base_fee_kobo,
      service_categories,
      bio: bio ?? null,
      years_experience: years_experience ?? null,
      bank_account_name: bank_account_name ?? null,
      bank_account_number: bank_account_number ?? null,
      bank_code: bank_code ?? null,
    });

    // ── Create Paystack transfer recipient (async — don't block response) ───
    ProviderService.createPaystackRecipient(provider.id, {
      accountName: bank_account_name,
      accountNumber: bank_account_number,
      bankCode: bank_code,
    }).catch((err: unknown) => {
      // Non-fatal: log and move on — can be retried
      const { logger } = require('../utils/logger');
      logger.error({ err, providerId: provider.id }, 'Failed to create Paystack recipient');
    });

    // ── Trigger CAC verification (async) ────────────────────────────────────
    if (cac_number) {
      ProviderService.verifyCac(provider.id, cac_number).catch(() => {});
    }

    // ── Update user role to provider ────────────────────────────────────────
    await UserModel.updateProfile(req.user.id, {});

    sendCreated(res, provider, 'Provider profile created. Upload portfolio photos to go live.');
  }

  static async update(req: AuthenticatedRequest, res: Response): Promise<void> {
    const provider = await ProviderModel.findById(req.params['id'] as string);
    if (!provider) throw new NotFoundError('Provider');

    const isOwner = provider.user_id === req.user.id;
    const isAdmin = req.user.role === UserRole.ADMIN;
    if (!isOwner && !isAdmin) throw new ForbiddenError();

    const updated = await ProviderModel.update(provider.id, req.body);
    sendSuccess(res, updated);
  }

  static async uploadPortfolioPhoto(req: AuthenticatedRequest, res: Response): Promise<void> {
    const provider = await ProviderModel.findById(req.params['id'] as string);
    if (!provider) throw new NotFoundError('Provider');
    if (provider.user_id !== req.user.id) throw new ForbiddenError();

    const { categoryId } = req.body as { categoryId: string };
    if (!provider.service_categories.includes(categoryId)) {
      throw new AppError('Category not in your service list', 400);
    }

    if (!req.file) throw new AppError('No file uploaded', 400);

    // File is uploaded to Cloudinary via multer-storage-cloudinary middleware
    const file = req.file as Express.Multer.File & {
      cloudinary_id?: string;
      path?: string;
    };

    const { rows } = await require('../config/database').db.query(
      `INSERT INTO portfolio_photos (provider_id, category_id, cloudinary_public_id, url)
       VALUES ($1, $2, $3, $4)
       RETURNING *`,
      [provider.id, categoryId, file.cloudinary_id ?? '', file.path ?? '']
    );

    sendCreated(res, rows[0], 'Photo uploaded');
  }

  static async deletePortfolioPhoto(req: AuthenticatedRequest, res: Response): Promise<void> {
    const provider = await ProviderModel.findById(req.params['id'] as string);
    if (!provider) throw new NotFoundError('Provider');
    if (provider.user_id !== req.user.id) throw new ForbiddenError();

    const { rows } = await require('../config/database').db.query(
      'DELETE FROM portfolio_photos WHERE id = $1 AND provider_id = $2 RETURNING *',
      [req.params.photoId, provider.id]
    );

    if (!rows.length) throw new NotFoundError('Photo');

    // Delete from Cloudinary
    if (rows[0].cloudinary_public_id) {
      await cloudinary.uploader.destroy(rows[0].cloudinary_public_id);
    }

    // Re-check go-live status after deletion
    const { ProviderService } = await import('../services/provider.service');
    await ProviderService.checkAndGoLive(provider.id);

    sendSuccess(res, null, 200, 'Photo deleted');
  }

  static async getEarnings(req: AuthenticatedRequest, res: Response): Promise<void> {
    const provider = await ProviderModel.findByUserId(req.user.id);
    if (!provider) throw new NotFoundError('Provider profile');

    const { ProviderService } = await import('../services/provider.service');
    const summary = await ProviderService.getEarningsSummary(provider.id);
    sendSuccess(res, summary);
  }

  static async getGoLiveStatus(req: AuthenticatedRequest, res: Response): Promise<void> {
    const provider = await ProviderModel.findByUserId(req.user.id);
    if (!provider) throw new NotFoundError('Provider profile');

    const { ProviderService } = await import('../services/provider.service');
    const status = await ProviderService.checkAndGoLive(provider.id);
    sendSuccess(res, {
      isLive: status.isLive,
      missingCategories: status.missingCategories,
      photoCounts: await ProviderModel.countPhotosPerCategory(provider.id),
    });
  }

  static async getReviews(req: Request, res: Response): Promise<void> {
    const provider = await ProviderModel.findById(req.params['id'] as string);
    if (!provider) throw new NotFoundError('Provider');

    const page = parseInt((req.query.page as string) ?? '1', 10);
    const limit = parseInt((req.query.limit as string) ?? '20', 10);

    const result = await ReviewModel.listForProvider(provider.id, page, limit);
    sendSuccess(res, result.rows, 200, undefined, buildPagination(page, limit, result.total));
  }
}
