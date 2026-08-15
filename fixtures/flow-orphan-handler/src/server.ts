const app = {
  post(path: string, handler: () => string) {
    return { path, handler };
  }
};

function leftoverHandler(): string {
  return "unused";
}

function createUser(): string {
  return "ok";
}

app.post("/api/user", createUser);
