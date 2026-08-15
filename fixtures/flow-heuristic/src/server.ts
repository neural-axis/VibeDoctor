const app = {
  post(path: string, handler: () => void) {
    return { path, handler };
  }
};

app.post("/api/items", () => undefined);
