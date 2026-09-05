import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { CreateOrderDto } from './dto/create-order.dto';
import { Order } from './order.entity';
import { OrderStatus } from './order-status.enum';
import { CallVerificationService } from '../call-verification/call-verification.service';
import { ConfigService } from '@nestjs/config';


@Injectable()
export class OrdersService {

  private maskPhone(phone: string): string {
    if (!phone || phone.length < 6) return '***';
    return `${phone.slice(0, 4)}${'*'.repeat(phone.length - 6)}${phone.slice(-2)}`;
  }

  toPublicOrder(order: Order) {
    return { ...order, phoneNumber: this.maskPhone(order.phoneNumber) };
  }


  private readonly logger = new Logger(OrdersService.name);

  // In-memory store for the demo. Swap for Postgres/Mongo before going to
  // production - the interface below is small enough to lift out cleanly.
  private readonly orders = new Map<string, Order>();

  constructor(
    private readonly callVerification: CallVerificationService,
    private readonly config: ConfigService,
  ) { }

  findAll(): Order[] {
    return [...this.orders.values()].sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    );
  }

  findOne(id: string): Order {
    const order = this.orders.get(id);
    if (!order) throw new NotFoundException(`Order ${id} not found`);
    return order;
  }
  /**
   * Creates the order in PENDING_CALL state, then immediately triggers the
   * CALL-E confirmation call. The HTTP response returns once the call
   * resolves so the demo/dashboard can show the outcome right away.
   */
  async createAndVerify(dto: CreateOrderDto): Promise<Order> {
    const now = new Date();
    const order: Order = {
      id: randomUUID(),
      customerName: dto.customerName,
      phoneNumber: dto.phoneNumber,
      deliveryAddress: dto.deliveryAddress,
      itemDescription: dto.itemDescription,
      price: dto.price,
      currency: dto.currency ?? 'NGN',
      status: OrderStatus.PENDING_CALL,
      createdAt: now,
      updatedAt: now,
    };
    this.orders.set(order.id, order);

    try {
      if (!this.isRecipientAuthorized(dto.phoneNumber)) {
        order.status = OrderStatus.UNREACHABLE;
        order.callSummary = 'Blocked: recipient is not on the authorized-numbers list.';
        order.updatedAt = new Date();
        this.orders.set(order.id, order);
        return order;
      }
      const result = await this.callVerification.confirmOrder(dto, order.id);
      order.status = result.status;
      order.callSummary = result.summary;
      order.correctedAddress = result.correctedAddress;
      order.declineReason = result.declineReason;
    } catch (err) {
      // CalleAPIError (and its subclasses) carry .code/.status/.details with
      // the actual reason the API rejected the request - the generic
      // Error.message alone hides that. Duck-type instead of importing the
      // class value (the SDK is ESM-only; see calle-client.provider.ts).
      const calleErr = err as {
        code?: string;
        status?: number;
        details?: Record<string, unknown>;
        message?: string;
      };
      this.logger.error(
        `Confirmation call failed for order ${order.id}: ` +
        `code=${calleErr.code ?? 'unknown'} status=${calleErr.status ?? 'unknown'} ` +
        `message=${calleErr.message ?? String(err)} ` +
        `details=${JSON.stringify(calleErr.details ?? {})}`,
      );
      order.status = OrderStatus.UNREACHABLE;
      order.callSummary = 'Call could not be completed due to an internal error.';
    }

    order.updatedAt = new Date();
    this.orders.set(order.id, order);
    return order;
  }

   /** Only CONFIRMED orders should ever be dispatched. */
  canDispatch(order: Order): boolean {
    return order.status === OrderStatus.CONFIRMED;
  }

  private isRecipientAuthorized(phoneNumber: string): boolean {
    // Only enforced in live mode — dry_run never dials anyone, so it's a no-op.
    if (this.config.get<string>('CALLE_MODE', 'dry_run') !== 'live') return true;

    const allowlist = (this.config.get<string>('ALLOWED_RECIPIENT_NUMBERS') ?? '')
      .split(',')
      .map((n) => n.trim())
      .filter(Boolean);

    return allowlist.includes(phoneNumber);
  }
}