# Reader policy: list (browse) all paths, but no read of secret values.
path "*" {
  capabilities = ["list"]
}
