"""One durable job per scheduled invocation. No case text or lease tokens in logs."""
import json
import os
import uuid
from urllib.parse import urlsplit
from urllib.request import Request, build_opener, HTTPRedirectHandler
import boto3
from botocore.config import Config


class NoRedirects(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def dispatch(rpc, invoke):
    claim = rpc("claim_agent_job", {})
    if not claim:
        return {"status": "idle"}
    try:
        result = invoke(claim)
        if result.get("status") in ("configuration_missing", "invalid_request"):
            rpc("fail_agent_job", {"p_job": claim["job_id"], "p_token": claim["lease_token"],
                                  "p_code": "configuration_missing", "p_retry": False})
            return {"status": "configuration_missing"}
        return {"status": result.get("status", "recovery_pending")}
    except Exception:
        # An uncertain response may mean the runtime is still running. Do not revoke its
        # lease or invoke again immediately. A later sweep recovers after lease expiry.
        return {"status": "recovery_pending"}


def lambda_handler(event, context):
    try:
        origin = os.environ["SUPABASE_PRODUCT_URL"].rstrip("/")
        parsed = urlsplit(origin)
        if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path:
            raise ValueError()
        key = boto3.client("secretsmanager").get_secret_value(SecretId=os.environ["WORKER_SECRET_ARN"])["SecretString"]
        opener = build_opener(NoRedirects())

        def rpc(name, payload):
            request = Request(origin+"/rest/v1/rpc/"+name, data=json.dumps(payload).encode(), method="POST",
                              headers={"Content-Type": "application/json", "apikey": key, "Authorization": "Bearer "+key})
            with opener.open(request, timeout=15) as response:
                body = response.read(160_001)
                if len(body) > 160_000:
                    raise ValueError()
                return json.loads(body)

        runtime = boto3.client("bedrock-agentcore", config=Config(connect_timeout=5, read_timeout=210, retries={"total_max_attempts": 1}))

        def invoke(claim):
            response = runtime.invoke_agent_runtime(agentRuntimeArn=os.environ["AGENT_RUNTIME_ARN"],
                runtimeSessionId=str(uuid.uuid4()), contentType="application/json", accept="application/json",
                payload=json.dumps(claim).encode())
            stream = response["response"]
            try:
                payload = stream.read(16_385)
                if len(payload) > 16_384:
                    raise ValueError()
                return json.loads(payload)
            finally:
                stream.close()

        return dispatch(rpc, invoke)
    except Exception:
        # CloudWatch receives an operational code, never raw exceptions or credentials.
        print(json.dumps({"status": "dispatcher_unavailable"}))
        raise RuntimeError("dispatcher_unavailable") from None
