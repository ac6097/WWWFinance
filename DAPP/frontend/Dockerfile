FROM node:24.14.1-alpine3.22 AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM nginx:1.28.0-alpine3.21
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html
EXPOSE 80
HEALTHCHECK --interval=10s --timeout=3s --retries=10 CMD wget -q -O - http://127.0.0.1/healthz | grep -q ok || exit 1
