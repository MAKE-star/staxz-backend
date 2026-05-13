import { Response, NextFunction } from 'express';
import { AuthService } from '../services/auth.service';
import { AuthenticatedRequest, UserRole } from '../types';
import { UnauthorizedError, ForbiddenError } from '../utils/errors';

export const authenticate = (
  req: AuthenticatedRequest,
  _res: Response,
  next: NextFunction
): void => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) throw new UnauthorizedError('No token provided');

  const token = authHeader.slice(7);
  const payload = AuthService.verifyAccessToken(token);

  req.user = { id: payload.sub, role: payload.role, phone: payload.phone };
  next();
};

export const requireRole = (...roles: UserRole[]) =>
  (req: AuthenticatedRequest, _res: Response, next: NextFunction): void => {
    if (!roles.includes(req.user.role)) throw new ForbiddenError();
    next();
  };

export const requireAdmin = requireRole(UserRole.ADMIN);
export const requireProvider = requireRole(UserRole.PROVIDER, UserRole.ADMIN);
