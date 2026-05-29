import { oldCurrencyMapper } from "../utils/oldCurrencyMapper";

export function legacyBillingService() {
  return oldCurrencyMapper("usd");
}
