import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ActorGuard } from './actor.guard.js';
import { IdentityService } from './identity.service.js';

@Module({
  providers: [IdentityService, { provide: APP_GUARD, useClass: ActorGuard }],
})
export class AuthModule {}
