import * as aws from "@pulumi/aws";
import * as authentik from "@pulumi/authentik";
import * as pulumi from "@pulumi/pulumi";
import {
  awsScimUserMappingExpression,
  resolveAssignmentsPending,
} from "./identityCenterHelpers";

export type IdentityCenterAuthentikArgs = {
  authentikUrl: string; // may only be used for docs/meta; provider auth is via AUTHENTIK_URL/TOKEN env
  scimToken: pulumi.Input<string>;
  icAcsUrl: string;
  icAudience: string;
  icScimUrl: string;
  workloadAccountId: string;
  managementProvider: aws.Provider;
  icInstanceArn?: string;
  adminGroupName?: string;
  viewerGroupName?: string;
  /** When false (default), skip Identity Store lookups + AccountAssignments. */
  assignmentsEnabled?: boolean;
};

export type IdentityCenterAuthentikResult = {
  assignmentsPending: pulumi.Output<boolean>;
  adminPermissionSetArn: pulumi.Output<string>;
  viewerPermissionSetArn: pulumi.Output<string>;
  authentikApplicationSlug: string;
};

const APPLICATION_SLUG = "aws-iam-identity-center";
const PERMISSION_SET_SESSION_DURATION = "PT8H";

export function createIdentityCenterAuthentik(
  args: IdentityCenterAuthentikArgs,
): IdentityCenterAuthentikResult {
  createAuthentikSide(args);
  const permissionSets = createPermissionSets(args);
  const assignmentsPending = createAssignments(args, permissionSets);

  return {
    assignmentsPending,
    adminPermissionSetArn: permissionSets.adminPermissionSetArn,
    viewerPermissionSetArn: permissionSets.viewerPermissionSetArn,
    authentikApplicationSlug: APPLICATION_SLUG,
  };
}

// ---------- Authentik side ----------

function createAuthentikSide(args: IdentityCenterAuthentikArgs): void {
  const adminGroupName = args.adminGroupName ?? "aws-admins";
  const viewerGroupName = args.viewerGroupName ?? "aws-viewers";

  new authentik.Group(adminGroupName, { name: adminGroupName });
  new authentik.Group(viewerGroupName, { name: viewerGroupName });

  const samlProvider = createSamlProvider(args);
  const scimProvider = createScimProvider(args);
  createApplication(samlProvider, scimProvider);
}

function createSamlProvider(
  args: IdentityCenterAuthentikArgs,
): authentik.ProviderSaml {
  const authorizationFlow = authentik.getFlowOutput({
    slug: "default-provider-authorization-implicit-consent",
  });
  const invalidationFlow = authentik.getFlowOutput({
    slug: "default-provider-invalidation-flow",
  });
  const nameIdMapping = authentik.getPropertyMappingProviderSamlOutput({
    managed: "goauthentik.io/providers/saml/email",
  });
  const signingKp = authentik.getCertificateKeyPairOutput({
    name: "authentik Self-signed Certificate",
  });

  return new authentik.ProviderSaml(APPLICATION_SLUG, {
    name: "AWS IAM Identity Center",
    acsUrl: args.icAcsUrl,
    audience: args.icAudience,
    nameIdMapping: nameIdMapping.id,
    signingKp: signingKp.id,
    authorizationFlow: authorizationFlow.id,
    invalidationFlow: invalidationFlow.id,
  });
}

function createScimProvider(
  args: IdentityCenterAuthentikArgs,
): authentik.ProviderScim {
  const zzUserMapping = new authentik.PropertyMappingProviderScim(
    "zz-aws-scim-user",
    {
      name: "zz AWS SCIM User",
      expression: awsScimUserMappingExpression(),
    },
  );
  const defaultUserMapping = authentik.getPropertyMappingProviderScimOutput({
    managed: "goauthentik.io/providers/scim/user",
  });
  const defaultGroupMapping = authentik.getPropertyMappingProviderScimOutput({
    managed: "goauthentik.io/providers/scim/group",
  });

  return new authentik.ProviderScim(`${APPLICATION_SLUG}-scim`, {
    name: "AWS IAM Identity Center SCIM",
    url: args.icScimUrl,
    token: args.scimToken,
    compatibilityMode: "aws",
    propertyMappings: [
      defaultUserMapping.id,
      zzUserMapping.propertyMappingProviderScimId,
    ],
    propertyMappingsGroups: [defaultGroupMapping.id],
  });
}

function createApplication(
  samlProvider: authentik.ProviderSaml,
  scimProvider: authentik.ProviderScim,
): authentik.Application {
  return new authentik.Application(APPLICATION_SLUG, {
    name: "AWS IAM Identity Center",
    slug: APPLICATION_SLUG,
    protocolProvider: samlProvider.providerSamlId.apply((id) => Number(id)),
    backchannelProviders: scimProvider.providerScimId.apply((id) => [
      Number(id),
    ]),
  });
}

// ---------- Permission sets ----------

type PermissionSetsResult = {
  instanceArn: pulumi.Output<string>;
  identityStoreId: pulumi.Output<string>;
  adminPermissionSetArn: pulumi.Output<string>;
  viewerPermissionSetArn: pulumi.Output<string>;
};

function createPermissionSets(
  args: IdentityCenterAuthentikArgs,
): PermissionSetsResult {
  const instances = aws.ssoadmin.getInstancesOutput({
    provider: args.managementProvider,
  });
  const instanceArn = args.icInstanceArn
    ? pulumi.output(args.icInstanceArn)
    : instances.arns.apply((arns) => {
        if (!arns[0]) throw new Error("No IAM Identity Center instance found");
        return arns[0];
      });
  const identityStoreId = instances.identityStoreIds.apply((ids) => {
    if (!ids[0]) throw new Error("No IAM Identity Center identity store found");
    return ids[0];
  });

  const adminPermissionSetArn = createPermissionSet(
    args.adminGroupName ?? "aws-admins",
    instanceArn,
    "arn:aws:iam::aws:policy/AdministratorAccess",
    args.managementProvider,
  );
  const viewerPermissionSetArn = createPermissionSet(
    args.viewerGroupName ?? "aws-viewers",
    instanceArn,
    "arn:aws:iam::aws:policy/ReadOnlyAccess",
    args.managementProvider,
  );

  return {
    instanceArn,
    identityStoreId,
    adminPermissionSetArn,
    viewerPermissionSetArn,
  };
}

function createPermissionSet(
  name: string,
  instanceArn: pulumi.Output<string>,
  managedPolicyArn: string,
  provider: aws.Provider,
): pulumi.Output<string> {
  const permissionSet = new aws.ssoadmin.PermissionSet(
    name,
    { name, instanceArn, sessionDuration: PERMISSION_SET_SESSION_DURATION },
    { provider },
  );
  new aws.ssoadmin.ManagedPolicyAttachment(
    `${name}-managed-policy`,
    { instanceArn, permissionSetArn: permissionSet.arn, managedPolicyArn },
    { provider },
  );
  return permissionSet.arn;
}

// ---------- Assignments ----------

function createAssignments(
  args: IdentityCenterAuthentikArgs,
  permissionSets: PermissionSetsResult,
): pulumi.Output<boolean> {
  const assignmentsEnabled = args.assignmentsEnabled ?? false;
  const assignmentsPending = pulumi.output(!assignmentsEnabled);
  if (!assignmentsEnabled) {
    return assignmentsPending;
  }

  createAccountAssignment(
    args.adminGroupName ?? "aws-admins",
    permissionSets.adminPermissionSetArn,
    permissionSets,
    args,
  );
  createAccountAssignment(
    args.viewerGroupName ?? "aws-viewers",
    permissionSets.viewerPermissionSetArn,
    permissionSets,
    args,
  );

  return assignmentsPending;
}

function createAccountAssignment(
  groupName: string,
  permissionSetArn: pulumi.Output<string>,
  permissionSets: PermissionSetsResult,
  args: IdentityCenterAuthentikArgs,
): void {
  const group = aws.identitystore.getGroupOutput(
    {
      identityStoreId: permissionSets.identityStoreId,
      alternateIdentifier: {
        uniqueAttribute: {
          attributePath: "DisplayName",
          attributeValue: groupName,
        },
      },
    },
    { provider: args.managementProvider },
  );

  new aws.ssoadmin.AccountAssignment(
    `${groupName}-assignment`,
    {
      instanceArn: permissionSets.instanceArn,
      permissionSetArn,
      principalId: group.groupId,
      principalType: "GROUP",
      targetId: args.workloadAccountId,
      targetType: "AWS_ACCOUNT",
    },
    { provider: args.managementProvider },
  );
}