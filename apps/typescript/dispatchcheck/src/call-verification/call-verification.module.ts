import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { CallVerificationService } from './call-verification.service';
import { CalleClientProvider } from './calle-client.provider';

@Module({
  imports: [ConfigModule],
  providers: [CalleClientProvider, CallVerificationService],
  exports: [CallVerificationService],
})
export class CallVerificationModule {}
