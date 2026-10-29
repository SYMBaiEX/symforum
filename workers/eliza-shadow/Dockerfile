FROM oven/bun:1.4.2@sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895 AS dependencies
WORKDIR /app
COPY package.json bun.lock ./
COPY vendor ./vendor
RUN bun install --frozen-lockfile --production --ignore-scripts

FROM gcr.io/distroless/nodejs24-debian13:nonroot@sha256:a6c34457f6da4295807e051411c7783739c65b997a324fed14e4fa292615ae91
ENV NODE_ENV=production PORT=8080
WORKDIR /app
COPY --from=dependencies --chown=65532:65532 /app/node_modules ./node_modules
COPY --from=dependencies --chown=65532:65532 /app/vendor ./vendor
COPY --chown=65532:65532 package.json ./
COPY --chown=65532:65532 src ./src
COPY --chown=65532:65532 certs ./certs
USER 65532:65532
EXPOSE 8080
# The base image's entrypoint is Node; no shell or package manager is shipped.
CMD ["src/index.mjs"]
