import { IsString, IsNumber, IsPhoneNumber, IsOptional, Min } from 'class-validator';

export class CreateOrderDto {
  @IsString()
  customerName!: string;

  // Expects E.164 format, e.g. +2348012345678 or +233241234567
  // (this is DispatchCheck's own field name; it gets mapped onto CALL-E's
  // `recipient.phone` when we place the call - see CallVerificationService)
  @IsPhoneNumber(undefined, {
    message: 'phoneNumber must be a valid international number, e.g. +2348012345678',
  })
  phoneNumber!: string;

  @IsString()
  deliveryAddress!: string;

  @IsString()
  itemDescription!: string;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsOptional()
  @IsString()
  currency?: string = 'NGN';
}