FROM node:20-alpine
RUN npm install -g pnpm
WORKDIR /app
COPY package.json pnpm-workspace.yaml ./
COPY apps/api/package.json ./apps/api/
COPY packages/shared/package.json ./packages/shared/
RUN pnpm install --frozen-lockfile
COPY apps/api ./apps/api
COPY packages/shared ./packages/shared
WORKDIR /app/apps/api
RUN pnpm run build
EXPOSE 3001
CMD ["node", "dist/index.js"]
