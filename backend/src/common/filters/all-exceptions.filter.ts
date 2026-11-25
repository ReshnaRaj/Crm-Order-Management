import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';
import { ApiErrorBody, ApiErrorResponse } from '../interfaces/api-response.interface';

const STATUS_CODES: Record<number, string> = {
  400: 'BAD_REQUEST',
  401: 'UNAUTHORIZED',
  403: 'FORBIDDEN',
  404: 'NOT_FOUND',
  409: 'CONFLICT',
  422: 'UNPROCESSABLE_ENTITY',
  429: 'TOO_MANY_REQUESTS',
  502: 'BAD_GATEWAY',
  503: 'SERVICE_UNAVAILABLE',
  504: 'GATEWAY_TIMEOUT',
};

/**
 * Converts every thrown error into the standard error envelope.
 * Unknown/internal errors are logged server-side but never leaked to clients.
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();
    const { status, error } = this.resolve(exception);

    if (status >= 500) {
      this.logger.error(
        { path: req.originalUrl, method: req.method, status, code: error.code },
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ApiErrorResponse = {
      success: false,
      statusCode: status,
      error,
      path: req.originalUrl.split('?')[0],
      timestamp: new Date().toISOString(),
    };
    res.status(status).json(body);
  }

  private resolve(exception: unknown): { status: number; error: ApiErrorBody } {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const fallbackCode = STATUS_CODES[status] ?? 'ERROR';
      if (typeof response === 'string') {
        return { status, error: { code: fallbackCode, message: response } };
      }
      const r = response as { code?: string; message?: string | string[]; details?: unknown };
      // class-validator returns an array of messages
      if (Array.isArray(r.message)) {
        return {
          status,
          error: {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: r.message,
          },
        };
      }
      return {
        status,
        error: {
          code: r.code ?? fallbackCode,
          message: r.message ?? exception.message,
          details: r.details,
        },
      };
    }

    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return {
          status: HttpStatus.CONFLICT,
          error: { code: 'CONFLICT', message: 'Resource already exists' },
        };
      }
      if (exception.code === 'P2025') {
        return {
          status: HttpStatus.NOT_FOUND,
          error: { code: 'NOT_FOUND', message: 'Resource not found' },
        };
      }
    }
    if (exception instanceof Prisma.PrismaClientInitializationError) {
      return {
        status: HttpStatus.SERVICE_UNAVAILABLE,
        error: {
          code: 'DATABASE_UNAVAILABLE',
          message: 'Database is unavailable, please retry later',
        },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred' },
    };
  }
}
