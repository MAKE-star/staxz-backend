import { Request, Response, NextFunction } from 'express';
import { AnyZodObject, ZodError } from 'zod';
import { ValidationError } from '../utils/errors';

export const validate = (schema: AnyZodObject) =>
  (req: Request, _res: Response, next: NextFunction): void => {
    try {
      schema.parse({
        body: req.body,
        query: req.query,
        params: req.params,
      });
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const details: Record<string, string[]> = {};
        err.errors.forEach((e) => {
          const key = e.path.slice(1).join('.') || 'root';
          if (!details[key]) details[key] = [];
          details[key].push(e.message);
        });
        throw new ValidationError('Validation failed', details);
      }
      throw err;
    }
  };
