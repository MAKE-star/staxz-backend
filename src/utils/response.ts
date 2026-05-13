import { Response } from 'express';
import { ApiResponse } from '../types';

export const sendSuccess = <T>(
  res: Response,
  data: T,
  statusCode = 200,
  message?: string,
  pagination?: ApiResponse<T>['pagination']
): void => {
  const body: ApiResponse<T> = { success: true, data };
  if (message) body.message = message;
  if (pagination) body.pagination = pagination;
  res.status(statusCode).json(body);
};

export const sendCreated = <T>(res: Response, data: T, message?: string): void =>
  sendSuccess(res, data, 201, message);

export const sendNoContent = (res: Response): void => {
  res.status(204).send();
};

export const buildPagination = (
  page: number,
  limit: number,
  total: number
) => ({
  page,
  limit,
  total,
  totalPages: Math.ceil(total / limit),
});

/** Safely extract a single string param from Express route params */
export const param = (value: string | string[]): string =>
  Array.isArray(value) ? value[0] : value;

/** Convert kobo (integer) to Naira string for display */
export const koboToNaira = (kobo: number): string =>
  `₦${(kobo / 100).toLocaleString('en-NG', { minimumFractionDigits: 0 })}`;

/** Convert Naira to kobo for storage */
export const nairaToKobo = (naira: number): number => Math.round(naira * 100);
