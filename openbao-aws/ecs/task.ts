/**
 * ECS task definition for OpenBao server.
 */
import * as aws from "@pulumi/aws";
import * as pulumi from "@pulumi/pulumi";

import {
  disableHealthChecks,
  openbaoDomain,
  openbaoImage,
  openbaoCpu,
  openbaoMemory,
  openbaoVersion,
  regionName,
} from "../config";
import { dbSecret } from "../data/database";
import { executionRole, kmsKey, taskRole } from "./iam";
import { logGroup } from "./logs";

const taskDef = new aws.ecs.TaskDefinition("OpenBaoTask", {
  family: "openbao",
  cpu: String(openbaoCpu),
  memory: String(openbaoMemory),
  networkMode: "awsvpc",
  requiresCompatibilities: ["FARGATE"],
  executionRoleArn: executionRole.arn,
  taskRoleArn: taskRole.arn,
  containerDefinitions: pulumi
    .all([dbSecret.arn, logGroup.name, regionName, kmsKey.keyId])
    .apply(([secretArn, logGroupName, reg, keyId]) => {
      const openbaoConfig = `listener "tcp" {
  address     = "0.0.0.0:8200"
  tls_disable = true
}
storage "postgresql" {}
seal "awskms" {
  region     = "${reg}"
  kms_key_id = "${keyId}"
}
disable_mlock = true
ui           = true
api_addr     = "http://127.0.0.1:8200"
`;
      return JSON.stringify([
        {
          name: "openbao",
          image: `${openbaoImage}:${openbaoVersion}`,
          entrypoint: ["/bin/sh", "-c"],
          command: [
            "printf '%s' \"$BAO_LOCAL_CONFIG\" > /openbao/config/local.hcl && chown openbao:openbao /openbao/config/local.hcl && exec su-exec openbao bao server -config=/openbao/config",
          ],
          essential: true,
          portMappings: [{ containerPort: 8200, protocol: "tcp" }],
          environment: [
            { name: "BAO_LOCAL_CONFIG", value: openbaoConfig },
            { name: "AWS_REGION", value: reg },
          ],
          secrets: [{ name: "BAO_PG_CONNECTION_URL", valueFrom: secretArn }],
          dockerLabels: {
            "traefik.enable": "true",
            "traefik.http.routers.openbao.rule": `Host(\`${openbaoDomain}\`)`,
            "traefik.http.routers.openbao.tls": "true",
            "traefik.http.routers.openbao.tls.certresolver": "le",
            "traefik.http.services.openbao.loadbalancer.server.port": "8200",
          },
          logConfiguration: {
            logDriver: "awslogs",
            options: {
              "awslogs-group": logGroupName,
              "awslogs-stream-prefix": "openbao",
              "awslogs-region": reg,
            },
          },
          ...(!disableHealthChecks && {
            healthCheck: {
              command: ["CMD-SHELL", "wget -q -O- http://127.0.0.1:8200/v1/sys/health || exit 1"],
              interval: 30,
              timeout: 5,
              retries: 3,
              startPeriod: 60,
            },
          }),
        },
      ]);
    }),
});

export { taskDef };
