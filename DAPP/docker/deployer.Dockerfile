FROM ghcr.io/foundry-rs/foundry:v1.9.0

WORKDIR /app
COPY contracts ./contracts
COPY docker/deploy-entrypoint.sh /usr/local/bin/deploy-entrypoint.sh
RUN chmod +x /usr/local/bin/deploy-entrypoint.sh

ENTRYPOINT ["sh", "/usr/local/bin/deploy-entrypoint.sh"]
