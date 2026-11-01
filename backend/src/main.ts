import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module.js';
import { API_PREFIX, configureApp } from './app.setup.js';
import { ConfigValidationError, loadConfig, type AppConfig } from './config/env.schema.js';

function loadConfigOrExit(): AppConfig | undefined {
  try {
    return loadConfig();
  } catch (error) {
    if (error instanceof ConfigValidationError) {
      console.error(error.message);
      process.exitCode = 1;
      return undefined;
    }
    throw error;
  }
}

async function bootstrap(): Promise<void> {
  const config = loadConfigOrExit();
  if (!config) return;

  const app = configureApp(await NestFactory.create(AppModule.forRoot(config)));
  // SIGTERM/SIGINT -> app.close() -> onApplicationShutdown hooks (drains the pg pool).
  app.enableShutdownHooks();

  await app.listen(config.port);
  new Logger('Bootstrap').log(`API listening on :${config.port}/${API_PREFIX}`);
}

await bootstrap();
