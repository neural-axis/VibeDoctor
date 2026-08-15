const controllers = {
  create() {
    return "ok";
  }
};

const app = {
  post(path: string, handler: () => string) {
    return { path, handler };
  }
};

app.post("/api/user", controllers.create);
