/**
 * Lifecycle of an order as it moves through DispatchCheck.
 *
 * PENDING_CALL      -> order received, confirmation call not yet placed
 * CONFIRMED         -> customer confirmed they want the order, address correct
 * DECLINED          -> customer said they no longer want it / wrong order
 * UNREACHABLE       -> call did not connect (no answer, switched off, bad number)
 * ADDRESS_MISMATCH  -> customer confirmed but flagged the address as wrong
 */
export enum OrderStatus {
  PENDING_CALL = 'PENDING_CALL',
  CONFIRMED = 'CONFIRMED',
  DECLINED = 'DECLINED',
  UNREACHABLE = 'UNREACHABLE',
  ADDRESS_MISMATCH = 'ADDRESS_MISMATCH',
}
