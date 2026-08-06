// Minimal app with unclear personal-data processing surface.
export function health() {
  return { status: "ok" };
}

export type Config = {
  region: string;
};

export const config: Config = {
  region: "ap-south-1"
};
