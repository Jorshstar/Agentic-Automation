import type { DeliveryRequest, DeliveryResult } from "./types.js";

/**
 * DeliveryProvider — the CONTRACT for anything that delivers the finished video
 * ({@link DeliveryResult}). Callers depend only on this interface.
 */
export interface DeliveryProvider {
  readonly name: string;
  deliver(request: DeliveryRequest): Promise<DeliveryResult>;
}
