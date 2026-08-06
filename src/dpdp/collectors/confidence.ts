import type { Confidence } from "../../core/finding";
import type { TechnicalSignalBag } from "../types";

const CONFIDENCE_RANK: Record<Confidence, number> = {
  low: 1,
  medium: 2,
  high: 3
};

/** Whether a signal confidence meets checks.dpdp.minConfidenceToReport. */
export function confidenceMeetsThreshold(confidence: Confidence, min: Confidence): boolean {
  return CONFIDENCE_RANK[confidence] >= CONFIDENCE_RANK[min];
}

/**
 * Drop low-confidence technical signals below the DPDP threshold.
 * Capability / skip signals are always retained.
 */
export function filterSignalsByConfidence(
  signals: TechnicalSignalBag[],
  min: Confidence
): TechnicalSignalBag[] {
  return signals.filter((signal) => {
    if (signal.kind === "skip" || signal.kind === "capability" || signal.tags.includes("capability")) {
      return true;
    }
    return confidenceMeetsThreshold(signal.confidence, min);
  });
}
