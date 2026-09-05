import { Controller, Get, Post, Body, Param, UseGuards } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { ApiKeyGuard } from '../common/guards/api-key.guard';
import { CreateOrderDto } from './dto/create-order.dto';

@UseGuards(ApiKeyGuard)
@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /**
   * Simulates a webhook from a storefront (Shopify/WhatsApp/custom checkout).
   * Creates the order and immediately places the CALL-E confirmation call.
   */
   @Post()
  async create(@Body() dto: CreateOrderDto) {
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
