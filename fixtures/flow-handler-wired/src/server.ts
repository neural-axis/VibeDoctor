import { createUser } from "./handlers";

const app = {
  post(path: string, handler: () => string) {
    return { path, handler };
  }
};

app.post("/api/user", createUser);
