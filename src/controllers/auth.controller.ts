import { Request, Response } from 'express';
import { AuthService } from '../services/auth.service';
import { UserModel } from '../models/user.model';
import { NotificationService } from '../services/notification.service';
import { UserRole, AuthenticatedRequest } from '../types';
import { sendSuccess } from '../utils/response';
import { config } from '../config';

const REFRESH_COOKIE = 'staxz_rt';
const COOKIE_OPTIONS = {
  httpOnly: true,
  secure:   config.isProduction,
  sameSite: 'strict' as const,
  maxAge:   30 * 24 * 60 * 60 * 1000,
  path:     '/api/v1/auth',
};

export class AuthController {
  static async requestOtp(req: Request, res: Response): Promise<void> {
    const { phone } = req.body as { phone: string };
    await AuthService.requestOtp(phone);
    sendSuccess(res, null, 200, 'OTP sent successfully');
  }

  static async verifyOtp(req: Request, res: Response): Promise<void> {
    const { phone, code, role } = req.body as { phone: string; code: string; role?: UserRole };
    const result = await AuthService.verifyOtp(phone, code, role);
    res.cookie(REFRESH_COOKIE, result.refreshToken, COOKIE_OPTIONS);
    res.status(result.isNewUser ? 201 : 200).json({
      success: true,
      data: { accessToken: result.accessToken, isNewUser: result.isNewUser },
      message: result.isNewUser ? 'Account created' : 'Login successful',
    });
  }

  static async refresh(req: Request, res: Response): Promise<void> {
    const refreshToken =
      (req.cookies as Record<string, string>)?.[REFRESH_COOKIE] ??
      (req.body as { refreshToken?: string }).refreshToken;
    if (!refreshToken) {
      res.status(401).json({ success: false, error: 'No refresh token' });
      return;
    }
    const result = await AuthService.refresh(refreshToken);
    res.cookie(REFRESH_COOKIE, refreshToken, COOKIE_OPTIONS);
    sendSuccess(res, { accessToken: result.accessToken });
  }

  static async logout(req: Request, res: Response): Promise<void> {
    const refreshToken =
      (req.cookies as Record<string, string>)?.[REFRESH_COOKIE] ??
      (req.body as { refreshToken?: string }).refreshToken;
    if (refreshToken) await AuthService.logout(refreshToken);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
    sendSuccess(res, null, 200, 'Logged out');
  }

  static async me(req: AuthenticatedRequest, res: Response): Promise<void> {
    const user = await UserModel.findById(req.user.id);
    sendSuccess(res, { user });
  }

  static async updateMe(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { full_name, avatar_url } = req.body as { full_name?: string; avatar_url?: string };
    const updated = await UserModel.updateProfile(req.user.id, { full_name, avatar_url });
    sendSuccess(res, updated);
  }

  static async registerPushToken(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { token, platform } = req.body as { token: string; platform: 'ios' | 'android' };
    await NotificationService.registerToken(req.user.id, token, platform);
    sendSuccess(res, null, 200, 'Push token registered');
  }

  static async deregisterPushToken(req: AuthenticatedRequest, res: Response): Promise<void> {
    const { token } = req.body as { token: string };
    await NotificationService.deregisterToken(token);
    sendSuccess(res, null, 200, 'Push token removed');
  }
}
