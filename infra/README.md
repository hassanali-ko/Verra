# AWS runtime and durable dispatch

The Vercel website accepts work into Postgres. A scheduled Lambda claims due work and invokes an IAM-protected AgentCore runtime. Completion is saved in the database before the runtime returns success. The UI reads owner-scoped reports from the same database.

## Runtime

1. Apply the product migrations after checking history. Create plain-string Secrets Manager entries for the product worker credential and direct OpenAI key.
2. Prepare an AgentCore execution role with the required service trust, access to the intended ECR image, logging and the two specific secrets. If secrets use a customer-managed KMS key, include the required decrypt permission for that key. Direct OpenAI inference does not require broad Bedrock model permissions.
3. Build the runtime container from the product root for AgentCore's supported target architecture and push it to the chosen ECR repository. The image includes only the Python runtime package and dependencies. Do not copy environment files into it.

```sh
docker buildx build --platform linux/arm64 -f agent/Dockerfile -t YOUR_ECR_IMAGE:VERSION --push .
```

4. Make a private, filled-in copy of `runtime.example.json`, replacing the account, region, image, role, database and secret references. The example is not a deployed configuration. Keep IAM inbound authorization; do not expose this worker through unauthenticated public ingress. `PUBLIC` is outbound networking configuration, not permission to bypass IAM.
5. Create or update the intended AgentCore runtime using the current AWS CLI/console and the reviewed configuration. For a new runtime:

```sh
aws bedrock-agentcore-control create-agent-runtime --cli-input-json file://PATH_TO_PRIVATE_RUNTIME_CONFIG
```

For an existing runtime, inspect its configuration and use the update operation rather than creating a duplicate. Record its runtime ARN. Confirm outbound HTTPS to the product database, OpenAI and supported public venue pages, and verify secret loading under the execution role. The runtime listens on port 8080 and receives only a job ID and lease capability.

## Dispatcher

`template.yaml` is an AWS SAM template for the scheduled Lambda. It accepts the product database origin, worker secret ARN and deployed runtime ARN. It invokes once a minute, processes one job per invocation, and caps Lambda concurrency at two. Increase throughput only after monitoring observed use and model spending.

```sh
sam build --template-file infra/template.yaml
sam deploy --guided
```

The Lambda role can read its one worker secret and invoke the specified runtime. It does not need the OpenAI key. SAM supplies the Lambda execution/logging role. A custom KMS-encrypted worker secret additionally needs the scoped decrypt permission; add it to the reviewed deployment before use. Log retention is fourteen days.

The dispatcher disables automatic SDK invocation retries. If invocation outcome is uncertain, it leaves the existing lease alone: the agent may still be running. A later scheduled sweep reclaims it after expiry and rejects the previous token. A repeated invocation with the same capability cannot begin twice. Jobs stop after three attempts and surface a failed state for the user to retry deliberately.

## Verify before production

- Check IAM identity, runtime readiness and the actual secret/project association.
- Queue a synthetic authenticated visit and observe claimed, research-ready and saved report states.
- Replay an invocation, interrupt a worker, pause/cancel a case, and verify no stale result commits.
- Confirm a second user cannot read the report or lease token, including through export.
- Check retry exhaustion and sanitized failure visibility, OpenAI usage and AWS cost alerts.
- Keep service secrets and lease payloads out of request logs, public source and browser data.

Container build, SAM validation/deployment and AWS recovery tests require their tools and account access. Source-level tests and a local AgentCore HTTP contract check do not establish those deployed capabilities. See [AgentCore invocation](https://docs.aws.amazon.com/bedrock-agentcore/latest/APIReference/API_InvokeAgentRuntime.html) and [Strands deployment guidance](https://strandsagents.com/docs/user-guide/deploy/deploy_to_bedrock_agentcore/).
