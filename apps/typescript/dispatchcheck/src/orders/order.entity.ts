import { OrderStatus } from './order-status.enum';

export interface Order {
  id: string;
  customerName: string;
  phoneNumber: string;
  deliveryAddress: string;
  itemDescription: string;
  price: number;
  currency: string;
  status: OrderStatus;
  callSummary?: string;
  correctedAddress?: string;
  declineReason?: string;
  createdAt: Date;
  updatedAt: Date;
}
