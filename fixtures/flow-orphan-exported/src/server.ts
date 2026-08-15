const app = {
  post(path: string, handler: () => string) {
    return { path, handler };
  }
};

export function leftoverHandler(): string {
  return "maybe used by a framework";
}

function createUser(): string {
  return "ok";
}

app.post("/api/user", createUser);
