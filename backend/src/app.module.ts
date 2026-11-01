import { Module, type DynamicModule } from '@nestjs/common';
import { AppConfigModule } from './config/config.module.js';
import type { AppConfig } from './config/env.schema.js';
import { DatabaseModule } from './database/database.module.js';
import { HealthModule } from './health/health.module.js';

/**
 * Root module. Built from an already-validated config so main.ts, integration tests and the
 * OpenAPI export script all assemble exactly the same application graph.
 */
@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [AppConfigModule.forRoot(config), DatabaseModule, HealthModule],
    };
  }
}
