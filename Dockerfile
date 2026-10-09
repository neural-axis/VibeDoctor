FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

FROM node:22-bookworm-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY schemas ./schemas
COPY README.md LICENSE ./
RUN mkdir /workspace && chown node:node /workspace
USER node
WORKDIR /workspace
ENTRYPOINT ["node", "/app/dist/cli/index.js"]
CMD ["mcp"]
