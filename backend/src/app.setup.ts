import { INestApplication, ValidationPipe } from '@nestjs/common';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AppConfigService } from './config/app-config.service';

/**
 * Applies global HTTP configuration. Shared by main.ts and the e2e tests so tests
 * exercise exactly the same pipeline as production.
 *
 * NOTE: the app must be created with `{ rawBody: true }` so that `req.rawBody` is
 * available for Shopify webhook HMAC verification.
 */
export function configureApp(app: NestExpressApplication | INestApplication) {
  const config = app.get(AppConfigService);
  const express = app as NestExpressApplication;

  express.setGlobalPrefix('api');
  express.useBodyParser('json', { limit: '5mb' });
  express.use(helmet());
  express.enableCors({ origin: config.corsOrigins, credentials: true });
  express.set('trust proxy', 1);

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
    }),
  );
  app.useGlobalFilters(new AllExceptionsFilter());
  app.useGlobalInterceptors(new LoggingInterceptor(), new TransformInterceptor());

  if (!config.isProduction) {
    const doc = new DocumentBuilder()
      .setTitle('Mini Order Management CRM API')
      .setDescription('REST API for the Shopify-integrated order management CRM')
      .setVersion('1.0.0')
      .addBearerAuth()
      .build();
    SwaggerModule.setup('api/docs', app, SwaggerModule.createDocument(app, doc));
  }
  app.enableShutdownHooks();
  return app;
}
