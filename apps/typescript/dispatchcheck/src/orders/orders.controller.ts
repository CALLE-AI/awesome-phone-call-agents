import { Controller, Get, Post, Body, Param, UseGuards, Headers, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrdersService } from './orders.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { CreateOrderDto } from './dto/create-order.dto';

// A process-wide CALLE_LIVE_CONFIRM only proves the operator was willing to
// enable live mode when the server started - it says nothing about THIS
// specific request. Requiring this header per-call means a stray, replayed,
// or automated POST can't silently place a real call just because the
// server happens to be running in live mode.
const LIVE_CALL_CONFIRM_HEADER = 'x-confirm-live-call';
const LIVE_CALL_CONFIRM_VALUE = 'I_CONFIRM_LIVE_CALL_FOR_THIS_ORDER';

@UseGuards(ApiKeyGuard)
@Controller('orders')
export class OrdersController {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Simulates a webhook from a storefront (Shopify/WhatsApp/custom checkout).
   * Creates the order and immediately places the CALL-E confirmation call.
   */
  @Post()
  async create(
    @Body() dto: CreateOrderDto,
    @Headers(LIVE_CALL_CONFIRM_HEADER) liveCallConfirm?: string,
  ) {
    const mode = this.config.get<string>('CALLE_MODE', 'dry_run');

    if (mode === 'live' && liveCallConfirm !== LIVE_CALL_CONFIRM_VALUE) {
      throw new ForbiddenException(
        `CALLE_MODE=live is enabled for this server, but this request did not confirm intent to ` +
          `place a real call. Send the header "${LIVE_CALL_CONFIRM_HEADER}: ${LIVE_CALL_CONFIRM_VALUE}" ` +
          `to proceed.`,
      );
    }

    const order = await this.ordersService.createAndVerify(dto);
    return {
      order: this.ordersService.toPublicOrder(order),
      canDispatch: this.ordersService.canDispatch(order),
    };
  }

  @Get()
  findAll() {
    return this.ordersService.findAll().map((o) => this.ordersService.toPublicOrder(o));
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ordersService.toPublicOrder(this.ordersService.findOne(id));
  }
}