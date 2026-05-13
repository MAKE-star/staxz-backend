import { Request, Response, NextFunction } from 'express';
import { AppError } from '../utils/errors';
import { ApiError } from '../types';
import { logger } from '../utils/logger';
import { config } from '../config';

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void => {
  if (err instanceof AppError) {
    const body: ApiError = { success: false, error: err.message, code: err.code };
    res.status(err.statusCode).json(body);
    return;
  }

  // PostgreSQL unique violation
  if ((err as NodeJS.ErrnoException).code === '23505') {
    res.status(409).json({ success: false, error: 'Resource already exists', code: 'CONFLICT' });
    return;
  }

  // Unhandled errors
  logger.error({ err, url: req.url, method: req.method }, 'Unhandled error');

  const body: ApiError = {
    success: false,
    error: config.isProduction ? 'Internal server error' : err.message,
    code: 'INTERNAL_ERROR',
  };
  res.status(500).json(body);
};

export const notFoundHandler = (req: Request, res: Response): void => {
  res.status(404).json({
    success: false,
    error: `Route ${req.method} ${req.path} not found`,
    code: 'NOT_FOUND',
  });
};
