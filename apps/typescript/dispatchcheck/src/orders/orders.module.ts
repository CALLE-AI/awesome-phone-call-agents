import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';
import { CallVerificationModule } from '../call-verification/call-verification.module';

@Module({
  imports: [CallVerificationModule,ConfigModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
