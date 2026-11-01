import { Module, type DynamicModule } from '@nestjs/common';
import { APP_FILTER, APP_PIPE } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { AuthModule } from './common/auth/auth.module.js';
import { AllExceptionsFilter } from './common/http/all-exceptions.filter.js';
import { createValidationPipe } from './common/http/validation.js';
import { LoggingModule } from './common/logging/logging.module.js';
import { RateLimitModule } from './common/rate-limit/rate-limit.module.js';
import { AppConfigModule } from './config/config.module.js';
import type { AppConfig } from './config/env.schema.js';
import { DatabaseModule } from './database/database.module.js';
import { RepositoriesModule } from './database/repositories.module.js';
import { DriversModule } from './drivers/drivers.module.js';
import { FaresModule } from './fares/fares.module.js';
import { HealthModule } from './health/health.module.js';
import { RidersModule } from './riders/riders.module.js';
import { RidesModule } from './rides/rides.module.js';

/**
 * Root module, built from an already-validated config so main.ts, integration tests and the
 * OpenAPI export all assemble exactly the same application graph. Global enhancers are
 * registered as providers (not in main.ts) so tests get them too.
 *
 * Guard order: rate limiting runs before identity resolution, so floods are rejected
 * before they cost a database lookup.
 */
@Module({})
export class AppModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppModule,
      imports: [
        AppConfigModule.forRoot(config),
        LoggingModule.forRoot(),
        DatabaseModule,
        RepositoriesModule,
        ScheduleModule.forRoot(),
        RateLimitModule,
        AuthModule,
        HealthModule,
        RidesModule,
        RidersModule,
        DriversModule,
        FaresModule,
      ],
      providers: [
        { provide: APP_FILTER, useClass: AllExceptionsFilter },
        { provide: APP_PIPE, useFactory: createValidationPipe },
      ],
    };
  }
}
