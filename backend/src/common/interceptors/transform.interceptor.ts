import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { ApiSuccessResponse } from '../interfaces/api-response.interface';

/** Wraps every successful controller result in a consistent `{ success, data }` envelope. */
@Injectable()
export class TransformInterceptor<T> implements NestInterceptor<T, ApiSuccessResponse<T>> {
  intercept(_ctx: ExecutionContext, next: CallHandler<T>): Observable<ApiSuccessResponse<T>> {
    return next
      .handle()
      .pipe(map((data) => ({ success: true as const, data: data ?? (null as T) })));
  }
}
