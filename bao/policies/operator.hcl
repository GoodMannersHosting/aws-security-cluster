# Operator: read/write secrets under secret/ (KV v2). No auth/sys/identity admin.
path "secret/data/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}
path "secret/metadata/*" {
  capabilities = ["create", "read", "update", "delete", "list"]
}
path "secret/delete/*" {
  capabilities = ["update"]
}
path "secret/undelete/*" {
  capabilities = ["update"]
}
path "secret/destroy/*" {
  capabilities = ["update"]
}
path "secret/" {
  capabilities = ["list"]
}
