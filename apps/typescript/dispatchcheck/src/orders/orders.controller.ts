import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';

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
      order,
      canDispatch: this.ordersService.canDispatch(order),
    };
  }

  @Get()
  findAll() {
    return this.ordersService.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.ordersService.findOne(id);
  }
}
