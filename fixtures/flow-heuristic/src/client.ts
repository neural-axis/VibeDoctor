export async function loadResource(resource: string, method: string): Promise<void> {
  await fetch(`/api/${resource}`, { method });
}
