const https = require("https");
const { SecretsManagerClient, PutSecretValueCommand } = require("@aws-sdk/client-secrets-manager");

const OPENBAO_URL = process.env.OPENBAO_URL;
const ROOT_TOKEN_SECRET_ARN = process.env.ROOT_TOKEN_SECRET_ARN;

function request(method, path, body) {
  const u = new URL(path || "/", OPENBAO_URL);
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: u.hostname,
        port: 443,
        path: u.pathname + u.search,
        method,
        headers: body ? { "Content-Type": "application/json" } : {},
        rejectUnauthorized: false, // Accept self-signed cert (Traefik default before ACME)
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => {
          try {
            resolve({ status: res.statusCode, body: data ? JSON.parse(data) : null });
          } catch (e) {
            resolve({ status: res.statusCode, body: data });
          }
        });
      }
    );
    req.on("error", reject);
    if (body) req.write(typeof body === "string" ? body : JSON.stringify(body));
    req.end();
  });
}

exports.handler = async function (event, context) {
  if (!OPENBAO_URL || !ROOT_TOKEN_SECRET_ARN) {
    console.log("Missing OPENBAO_URL or ROOT_TOKEN_SECRET_ARN");
    return;
  }
  try {
    const health = await request("GET", "/v1/sys/health");
    if (health.status === 200) {
      console.log("Already initialized");
      return;
    }
    if (health.status !== 501 && health.status !== 503) {
      console.log("Unexpected health status:", health.status);
      return;
    }
    const initRes = await request("PUT", "/v1/sys/init", {});
    if (initRes.status !== 200 || !initRes.body || !initRes.body.root_token) {
      console.log("Init failed:", initRes.status, initRes.body);
      return;
    }
    const client = new SecretsManagerClient({});
    await client.send(
      new PutSecretValueCommand({
        SecretId: ROOT_TOKEN_SECRET_ARN,
        SecretString: initRes.body.root_token,
      })
    );
    console.log("Initialized and stored root token");
  } catch (err) {
    console.error(err);
    throw err;
  }
};
