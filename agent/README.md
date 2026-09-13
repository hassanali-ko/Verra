# Verra research worker

Python Strands with direct OpenAI `gpt-5.6-luna`, designed to run on AgentCore. The worker consumes durable product jobs, reads public venue pages, validates requirement-level source quotations, and saves findings and an unsent inquiry draft. It does not send venue email, read a live inbox, query maps, invent alternatives or synchronize calendars.

## Setup

Use Python 3.12. From the product repository root:

```sh
python3.12 -m venv .venv
.venv/bin/python -m pip install -r agent/requirements.lock.txt
.venv/bin/python -m pip install --no-deps -e ./agent
.venv/bin/python -m pytest agent/tests -q
```

The lock file captures the tested Python dependencies. `pyproject.toml` pins direct runtime dependencies. The supplied prototype's tool concepts and evidence distinctions were adapted into this package. Its hard-coded replies, venue page and alternatives are not loaded by the production runtime. Controlled sample sources exist only in test code.

Copy `agent/.env.example` to an ignored private file such as `.env.agent.local` and populate it. Configuration files are loaded only when explicitly selected; importing a module performs no model call.

| Setting | Use |
|---|---|
| `OPENAI_API_KEY` | Server-side direct OpenAI credential |
| `OPENAI_API_KEY_FILE` | Optional private file containing that credential, resolved from the working directory |
| `VERRA_MODEL_ID` | Exactly `gpt-5.6-luna`; another model is rejected |
| `SUPABASE_PRODUCT_URL` | Product project origin |
| `VERRA_WORKER_SERVICE_KEY` | Privileged worker credential, separate from the web app's publishable key |
| `VERRA_AGENT_ENV` | `production`, or `local` for the loopback SQL verification service |
| `OPENAI_API_KEY_SECRET_ARN` | Alternative to the raw OpenAI environment credential on AWS |
| `VERRA_WORKER_SERVICE_KEY_SECRET_ARN` | Alternative worker credential stored in AWS Secrets Manager |

Secret ARNs refer to plain-string secrets, one credential per secret. The runtime execution role needs read access to those exact resources. Environment values take precedence over the selected dotenv file; direct credentials take precedence over credential files, then secret ARNs. Production database transport requires HTTPS. The web app must never receive the worker service key.

Apply migrations `001_arrangements.sql`, `002_agent_research.sql` and `003_arrangement_edits.sql` to the product database after inspecting existing migration history. Do not rerun unknown migrations or reset a database to skip an error. The worker functions are executable by `service_role`, not anonymous or personal sessions. A service key is privileged: its use is confined to the worker RPC adapter, which accepts a validated job capability and derives case ownership from the stored job. An authenticated user cannot select a different owner, claim work, read lease tokens or write reports directly.

Run one due job:

```sh
.venv/bin/verra-agent --env-file .env.agent.local
```

To process a specific queued job, add `--job JOB_UUID`. It still must be due and eligible. Without a worker/scheduled dispatcher, requests remain queued and are not represented as completed research.

## Explicit live access check

This command makes a small paid request using only a random synthetic receipt. It checks real model access, a harmless tool round trip and structured output. It is not part of the automatic test suite.

```sh
.venv/bin/python agent/tests/live_smoke.py --env-file .env.agent.local
```

A missing key, access denial or failed tool result is a failed check. There is no fallback model. A successful smoke check alone does not establish research quality or a deployed service. The implementation follows the [Strands OpenAI provider](https://strandsagents.com/docs/user-guide/concepts/model-providers/openai/) and the selected [Luna model](https://developers.openai.com/api/docs/models/gpt-5.6-luna).

The tested Strands Chat Completions configuration uses `reasoning_effort="none"`. The live API rejected function tools with `reasoning_effort="low"` for this model on that endpoint. Do not change this setting without another tool compatibility check.

On September 13, 2026, the direct API passed a synthetic tool round trip. A separate synthetic visit then used the real public V&A access page and Luna, saved requirement-level findings through the real worker and local SQL transport, and displayed them in the Next app. The specific workshop route remained unknown. Outreach was disabled and no draft or message was created. This is local integration evidence for one case, not a broad quality evaluation or an AWS deployment.

## Execution and permission contract

1. The personal web request atomically saves a visit revision and a uniquely keyed job before returning acceptance.
2. `claim_agent_job` locks a case before its job, skips locked cases, and issues an unguessable lease token. Each job allows at most three attempts. Queued retries wait for backoff; an expired lease can be claimed with a new token.
3. AgentCore receives only `{job_id, lease_token}`. `agent_job_context` derives the case and requirements from that job. Starting the same lease twice does not start a second model execution.
4. Every tool and model turn rechecks the lease and revision. Results from pause, cancellation, an expired lease or a changed permission version are rejected. The worker invocation has a 180-second model/work budget within its ten-minute database lease.
5. Retrieved pages stay within the supplied venue origin. DNS is checked on every redirect, the connection is pinned to a validated public numeric address, and TLS verifies the original hostname. Only default HTTP/HTTPS ports and supported text types are allowed. Encoded compression, oversized responses, private addresses and cross-origin redirects are blocked. Some otherwise legitimate sites will therefore need a direct canonical URL or another source.
6. The model returns exactly the current requirement IDs. Every asserted finding needs quotations that occur in a retrieved source. Uncertain or mismatched venue identity downgrades findings to unknown in code. Quote matching verifies provenance, not perfect semantic interpretation; people still review the findings.
7. Editing a visit cancels old work under the same case lock. Reports retain their original requirement text and content version; the UI labels earlier research and prevents copying its obsolete draft. Pause/resume alone does not rewrite research context.
8. Completion commits a report, a case transition to `needs_decision`, and history together. Web research does not update requirements to `venue_confirmed` or certify an arrangement. Reports contain relevant quotations and source metadata; the full fetched page is not persisted.
9. Any draft is composed in SQL from explicitly shareable requirement text and only when outreach permission exists. It is unsent. No model-generated recipient or free-form email body is trusted for an external effect.

Operational output contains status codes and job/report IDs. Model callbacks and content tracing are disabled; raw provider errors and page content are not logged. Failure to confirm a database write is represented as recovery pending, not invented success. A model call may be repeated after an expired lease, so attempts are bounded; there are no external send effects in this stage.

## Local end-to-end verification

Run `npm run build` and `npm run preview:local` in one terminal, then `npm run test:browser -- tests/research.spec.ts` in another. The browser test creates a synthetic visit, executes the real Python worker/store protocol through the local SQL transport, and checks owner-only saved findings in the actual Next app. Its model and page are controlled test doubles; the saved result is explicitly labelled `local_test` in the UI. Tests never substitute these fixtures in the deployed runtime.

`tests/worker_roundtrip.py` is restricted to the loopback preview origin. The preview's worker credential is synthetic, not a cloud credential. All preview data stays in the existing local PostgreSQL directory.

## AWS packaging and deployment

Deployment is separate from Vercel. See [AWS setup](../infra/README.md) for runtime packaging, IAM access and scheduled dispatch. The runtime entry point is `python -m verra_agent.runtime`; importing it alone performs no work. Live AWS deployment and provider integration must be verified in the intended account before claiming production readiness.

## Remaining full-product work

Real map/alternative retrieval, message delivery and verified reply correlation, follow-ups, Calendar, decision execution, richer evidence histories, return visits, companion access, notifications and deletion remain required. This research packet does not reduce that scope. Tool and provider verification, adversarial model evaluations, real-user review and hosted recovery testing remain part of release work.
