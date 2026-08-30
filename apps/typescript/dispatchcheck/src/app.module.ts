import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { OrdersModule } from './orders/orders.module';
import { CallVerificationModule } from './call-verification/call-verification.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    CallVerificationModule,
    OrdersModule,
  ],
})
export class AppModule {}
