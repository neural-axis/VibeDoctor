export function logRequest(requestId: string) {
  console.log("request complete", requestId);
  return { ok: true };
}
