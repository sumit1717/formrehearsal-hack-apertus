# Official multi-platform index verified 2026-10-04; build/runtime checks remain separate.
FROM node:24-alpine@sha256:ebfe2f90462722a7a4de65e91990e97fe0d401c70e0e762c5b53302f905ec1c1
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts --no-audit --no-fund
COPY --chown=node:node src ./src
COPY --chown=node:node public ./public
COPY --chown=node:node prompts ./prompts
COPY --chown=node:node data ./data
COPY --chown=node:node examples ./examples
RUN mkdir artifacts && chown node:node artifacts
USER node
# Optional judge LLM_* values are supplied at runtime by Makefile, never build args.
ENV HOST=0.0.0.0 PORT=4177
EXPOSE 4177
CMD ["node", "src/server.mjs"]
# Liveness does not imply approved inputs, completed analysis or provider readiness.
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ["node", "src/healthcheck.mjs"]
