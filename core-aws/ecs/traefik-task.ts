/**
 * Traefik ECS task: ACME (Route53 DNS-01), ECS provider for service discovery, read-only dashboard.
 * EFS volume at /data for acme.json persistence across deployments.
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

import {
  acmeCaServer,
  acmeDnsPropagationDelay,
  acmeEmail,
  domain,
  hostedZoneId,
  namePrefix,
  regionName,
  traefikCpu,
  traefikMemory,
} from "../config";
import { accessPoint, efs } from "../efs/traefik-data";
import { ecsCluster } from "./cluster";
import { executionRole, taskRole } from "./traefik-iam";
import { logGroup } from "./logs";

const traefikImage = "traefik:v3.6";

const traefikTaskDef = new aws.ecs.TaskDefinition("TraefikTask", {
  family: "core-traefik",
  cpu: String(traefikCpu),
  memory: String(traefikMemory),
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  executionRoleArn: executionRole.arn,
  taskRoleArn: taskRole.arn,
  volumes: [
    {
      name: "data",
      efsVolumeConfiguration: {
        fileSystemId: efs.id,
        transitEncryption: "ENABLED",
        authorizationConfig: {
          accessPointId: accessPoint.id,
          iam: "ENABLED",
        },
      },
    },
  ],
  containerDefinitions: pulumi
    .all([ecsCluster.name, regionName, logGroup.name, hostedZoneId, domain])
    .apply(([clusterName, region, logGroupName, zoneId, dom]) => {
      const dashboardDomain = dom ? `traefik.${dom}` : null;
      const traefikArgs = [
        "--api.dashboard=true",
        "--entrypoints.web.address=:80",
        "--entrypoints.websecure.address=:443",
        "--providers.ecs=true",
        `--providers.ecs.clusters=${clusterName}`,
        "--providers.ecs.exposedbydefault=false",
        // ACME certificate resolver (Let's Encrypt, same protocol as Certbot)
        "--certificatesresolvers.le.acme.email=" + acmeEmail,
        "--certificatesresolvers.le.acme.storage=/data/acme.json",
        "--certificatesresolvers.le.acme.dnschallenge=true",
        "--certificatesresolvers.le.acme.dnschallenge.provider=route53",
        `--certificatesresolvers.le.acme.dnschallenge.propagation.delaybeforechecks=${acmeDnsPropagationDelay}s`,
        "--certificatesresolvers.le.acme.keytype=EC256",
        ...(acmeCaServer ? [`--certificatesresolvers.le.acme.caserver=${acmeCaServer}`] : []),
      ];
      const dashboardYaml = dashboardDomain
        ? `http:
  routers:
    traefik-dashboard:
      rule: "Host(\`${dashboardDomain}\`)"
      service: api@internal
      entryPoints:
        - websecure
      tls:
        certResolver: le
`
        : "";
      const dashboardConfigB64 = dashboardYaml
        ? Buffer.from(dashboardYaml, "utf8").toString("base64")
        : "";
      const env: { name: string; value: string }[] = [
        { name: "AWS_REGION", value: region },
        { name: "AWS_HOSTED_ZONE_ID", value: zoneId },
        { name: "TRAEFIK_ACME_EMAIL", value: acmeEmail },
      ];
      if (dashboardConfigB64) {
        env.push({ name: "TRAEFIK_DASHBOARD_CONFIG_B64", value: dashboardConfigB64 });
      }
      const traefikCmd = traefikArgs.join(" ");
      // Wait for EFS mount at /data (up to 30s), then ensure acme.json exists (Traefik does not create it)
      const acmeInit =
        "i=0; while [ $i -lt 30 ]; do [ -d /data ] && [ -w /data ] && break; sleep 1; i=$((i+1)); done && ([ -f /data/acme.json ] || echo '{}' > /data/acme.json)";
      const startupCmd = dashboardConfigB64
        ? `${acmeInit} && echo "$TRAEFIK_DASHBOARD_CONFIG_B64" | base64 -d > /tmp/dashboard.yml && exec traefik --providers.file.filename=/tmp/dashboard.yml ${traefikCmd}`
        : `${acmeInit} && exec traefik ${traefikCmd}`;
      const container: Record<string, unknown> = {
        name: "traefik",
        image: traefikImage,
        essential: true,
        mountPoints: [
          { sourceVolume: "data", containerPath: "/data", readOnly: false },
        ],
        portMappings: [
          { containerPort: 80, protocol: "tcp", name: "web" },
          { containerPort: 443, protocol: "tcp", name: "websecure" },
        ],
        environment: env,
        entryPoint: ["/bin/sh", "-c"],
        command: [startupCmd],
        logConfiguration: {
          logDriver: "awslogs",
          options: {
            "awslogs-group": logGroupName,
            "awslogs-stream-prefix": "traefik",
            "awslogs-region": region,
          },
        },
        healthCheck: {
          command: ["CMD-SHELL", "wget -q -O- http://127.0.0.1:8080/ping || exit 1"],
          interval: 30,
          timeout: 5,
          retries: 3,
          startPeriod: 10,
        },
      };
      return JSON.stringify([container]);
    }),
  tags: { Name: `${namePrefix}/TraefikTask` },
});

export { traefikTaskDef };