/** Authentik SCIM mapping: IC username = email (matches SAML NameID email). */
export function awsScimUserMappingExpression(): string {
  return [
    "return {",
    '    "photos": None,',
    '    "userName": request.user.email,',
    "}",
  ].join("\n");
}

/** True when Identity Store group ids are not both available yet. */
export function resolveAssignmentsPending(
  adminGroupId: string | undefined,
  viewerGroupId: string | undefined,
): boolean {
  return !adminGroupId || !viewerGroupId;
}
