import { legacyBillingService } from "../services/legacyBillingService";

export function oldBillingController() {
  return legacyBillingService();
}
