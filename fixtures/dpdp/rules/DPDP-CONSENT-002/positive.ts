export function saveAgreement(userId: string, agreed: boolean) {
  // Intentional consent capture signal without metadata fields nearby
  return { userId, consent: agreed, opt_in: agreed };
}
