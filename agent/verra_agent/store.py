import httpx
from .config import Settings
from .contracts import Claim, Context


class LeaseLost(Exception):
    pass


class StoreUnavailable(Exception):
    pass


class Store:
    def __init__(self, settings: Settings):
        self.client = httpx.Client(base_url=settings.database_url, timeout=15, trust_env=False,
            headers={"apikey": settings.database_key, "Authorization": "Bearer "+settings.database_key})

    def close(self):
        self.client.close()

    def rpc(self, name: str, body: dict):
        try:
            response = self.client.post("/rest/v1/rpc/"+name, json=body)
            if response.status_code >= 400:
                if response.status_code in (401, 403) or (response.headers.get("content-type", "").startswith("application/json") and response.json().get("code") == "42501"):
                    raise LeaseLost()
                raise StoreUnavailable()
            return response.json()
        except (httpx.HTTPError, ValueError):
            raise StoreUnavailable() from None

    def claim(self, job_id: str | None = None) -> Claim | None:
        result = self.rpc("claim_agent_job", {"p_job": job_id})
        return Claim.model_validate(result) if result else None

    def context(self, claim: Claim, *, begin=False) -> Context | None:
        result = self.rpc("agent_job_context", {"p_job": str(claim.job_id), "p_token": str(claim.lease_token), "p_begin": begin})
        return Context.model_validate(result) if result else None

    def finish(self, claim: Claim, report: dict):
        return self.rpc("finish_agent_job", {"p_job": str(claim.job_id), "p_token": str(claim.lease_token), "p_report": report})

    def fail(self, claim: Claim, code: str, retry: bool):
        return self.rpc("fail_agent_job", {"p_job": str(claim.job_id), "p_token": str(claim.lease_token), "p_code": code, "p_retry": retry})

