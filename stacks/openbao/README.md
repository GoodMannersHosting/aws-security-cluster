# OpenBao on Docker (Hetzner)

1. Ensure `postgres` and `traefik` stacks are running and networks `data` and `traefik` exist.
2. Copy `local.hcl.example` to `${OPENBAO_CONFIG_PATH}/local.hcl` and set `connection_url`, `api_addr`, and `cluster_addr` to your domain and database password.
3. `docker compose up -d`
4. Run `bao operator init` and unseal (shamir), or complete KMS migration using `local-kms.hcl.example` and AWS documentation.

Run the Roles Anywhere credential helper in a sidecar sharing the OpenBao network namespace if you use `AWS_EC2_METADATA_SERVICE_ENDPOINT` on loopback.
