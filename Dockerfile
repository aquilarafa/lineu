FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY tsconfig.json ./
COPY src/ ./src/
RUN npm run build

FROM node:22-alpine

# Dependências para Claude CLI e git
RUN apk add --no-cache curl git openssh-client

# Claude CLI
RUN npm install -g @anthropic-ai/claude-code

# Usuário não-root
RUN addgroup -g 1001 lineu && adduser -u 1001 -G lineu -s /bin/sh -D lineu

WORKDIR /app

# Dependências de produção
COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

# Aplicação
COPY --from=builder --chown=lineu:lineu /app/dist ./dist

# Diretórios de dados
RUN mkdir -p /home/lineu/.lineu && chown -R lineu:lineu /home/lineu

USER lineu

HEALTHCHECK --interval=30s --timeout=5s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:3000/health || exit 1

EXPOSE 3000

ENTRYPOINT ["node", "dist/index.js"]
CMD ["serve"]
