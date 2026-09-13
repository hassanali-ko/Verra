import asyncio
from .config import Settings
from .contracts import Claim
from .research import research
from .store import LeaseLost, Store, StoreUnavailable


async def execute(store: Store, claim: Claim, settings: Settings, *, run_research=research) -> dict:
    """Finish only under the same unexpired lease and unchanged visit revision."""
    try:
        context = store.context(claim, begin=True)
        if context is None:
            return {"status": "already_started", "job_id": str(claim.job_id)}

        def guard():
            current = store.context(claim)
            if current is None or current.case.id != context.case.id or current.case.version != context.case.version or current.permissions.version != context.permissions.version:
                raise LeaseLost()

        report = await asyncio.wait_for(run_research(context, guard, settings), timeout=180)
        guard()
        report_id = store.finish(claim, report)
        return {"status": "succeeded", "job_id": str(claim.job_id), "report_id": report_id}
    except LeaseLost:
        return {"status": "stopped", "job_id": str(claim.job_id)}
    except Exception as error:
        # Never serialize raw SDK errors: they may contain prompts, credentials or page text.
        from openai import AuthenticationError, PermissionDeniedError, RateLimitError, APIConnectionError, APITimeoutError
        if isinstance(error, (AuthenticationError, PermissionDeniedError)):
            code, retry = "provider_unavailable", False
        elif isinstance(error, (RateLimitError, APIConnectionError, APITimeoutError)):
            code, retry = "provider_unavailable", True
        elif isinstance(error, (TimeoutError, asyncio.TimeoutError)):
            code, retry = "execution_timeout", True
        elif isinstance(error, ValueError):
            code, retry = "invalid_output", False
        else:
            code, retry = "worker_failed", True
        try:
            store.fail(claim, code, retry)
        except (LeaseLost, StoreUnavailable):
            # The durable lease will be swept after expiry if the DB could not be reached.
            return {"status": "recovery_pending", "job_id": str(claim.job_id)}
        return {"status": "retry_or_failure_recorded", "job_id": str(claim.job_id), "code": code}

