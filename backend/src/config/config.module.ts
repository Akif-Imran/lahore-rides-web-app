import { Global, Inject, Module, type DynamicModule } from '@nestjs/common';
import type { AppConfig } from './env.schema.js';

/** DI token for the validated, typed application config. */
export const APP_CONFIG = Symbol('APP_CONFIG');

export const InjectConfig = () => Inject(APP_CONFIG);

/**
 * Provides an already-validated AppConfig. The config is parsed by the caller (main.ts,
 * tests, scripts) so each entry point decides how to source it and tests can pass overrides.
 */
@Global()
@Module({})
export class AppConfigModule {
  static forRoot(config: AppConfig): DynamicModule {
    return {
      module: AppConfigModule,
      global: true,
      providers: [{ provide: APP_CONFIG, useValue: config }],
      exports: [APP_CONFIG],
    };
  }
}
