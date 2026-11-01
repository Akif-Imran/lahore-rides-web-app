import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
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

  // Buffer framework logs until the pino logger is attached, so every line is structured.
  const app = configureApp(
    await NestFactory.create(AppModule.forRoot(config), { bufferLogs: true }),
    config,
  );
  // SIGTERM/SIGINT -> app.close() -> onApplicationShutdown hooks (drains the pg pool).
  app.enableShutdownHooks();

  await app.listen(config.port);
  app
    .get(Logger)
    .log(`API listening on :${config.port}/${API_PREFIX} (docs at /docs)`, 'Bootstrap');
}

await bootstrap();
