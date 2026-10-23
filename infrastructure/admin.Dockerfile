FROM node:22-alpine AS build
WORKDIR /app
COPY frontend/shared ./frontend/shared
COPY assets ./assets
COPY frontend/admin/package*.json ./frontend/admin/
WORKDIR /app/frontend/admin
RUN npm ci
COPY frontend/admin/ ./
RUN npm run build
FROM nginx:stable-alpine
COPY infrastructure/nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/frontend/admin/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=3s CMD wget -q -O /dev/null http://127.0.0.1/health || exit 1
