# Reader: browse all paths; read secret values only (no writes).
# Used by OIDC role "reader" (Authentik group: keeper-reader).
path "*" {
  capabilities = ["list"]
}
path "secret/data/*" {
  capabilities = ["read"]
}
path "secret/metadata/*" {
  capabilities = ["read", "list"]
}
