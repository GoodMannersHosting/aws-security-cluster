# Admin policy: full access to all OpenBao paths.
# Used by the OIDC role "admin" (Authentik group: keeper-admin).
path "*" {
  capabilities = ["create", "read", "update", "delete", "list", "patch", "sudo"]
}
