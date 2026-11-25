import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { AppConfigService } from './config/app-config.service';

async function bootstrap() {
  // rawBody is required for Shopify webhook HMAC verification
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { rawBody: true });
  configureApp(app);
  const config = app.get(AppConfigService);
  await app.listen(config.port);
  const logger = new Logger('Bootstrap');
  logger.log(`API listening on port ${config.port} (prefix /api)`);
  if (!config.isProduction) logger.log(`Swagger docs at ${config.appUrl}/api/docs`);
}

void bootstrap();
