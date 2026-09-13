import asyncio
import json
import logging
import os
from importlib.resources import files

from .config import Settings
from .contracts import Analysis, Context, Finding, validate_analysis
from .tools import ResearchTools

PROMPT_VERSION = "research-1"


async def analyze(context: Context, tools: ResearchTools, settings: Settings) -> Analysis:
    # No content tracing or streaming output. Operational reporting uses fixed codes only.
    os.environ["OTEL_SDK_DISABLED"] = "true"
    for name in ("strands", "openai", "httpx", "httpcore", "urllib3"):
        logging.getLogger(name).setLevel(logging.CRITICAL+1)
    from openai import AsyncOpenAI
    from strands import Agent
    from strands.hooks import BeforeModelCallEvent, HookProvider, HookRegistry
    from strands.models.openai import OpenAIModel

    class ActiveWork(HookProvider):
        def register_hooks(self, registry: HookRegistry):
            registry.add_callback(BeforeModelCallEvent, self.before_model)

        def before_model(self, event: BeforeModelCallEvent):
            tools.guard()

    async with AsyncOpenAI(api_key=settings.openai_key, base_url="https://api.openai.com/v1", max_retries=0, timeout=45) as client:
        model = OpenAIModel(client=client, model_id=settings.model_id,
                            params={"reasoning_effort": "none", "max_completion_tokens": 3500})
        agent = Agent(model=model, tools=tools.registered(), callback_handler=None,
                      system_prompt=files("verra_agent").joinpath("instructions.txt").read_text(),
                      structured_output_model=Analysis, hooks=[ActiveWork()], retry_strategy=None)
        payload = {"visit": context.case.model_dump(mode="json"),
                   "requirements": [r.model_dump(mode="json") for r in context.requirements],
                   "retrieved_sources": [s.model_dump() for s in tools.sources.values()],
                   "integration_status": {"maps": "not_connected", "mail": "not_connected", "alternatives": "not_connected"}}
        result = await agent.invoke_async(json.dumps(payload), limits={"turns": 6, "output_tokens": 7000, "total_tokens": 60000})
        if not isinstance(result.structured_output, Analysis):
            raise ValueError("No validated research output")
        return result.structured_output


async def research(context: Context, guard, settings: Settings, *, reader=None, analyzer=analyze, mode="live") -> dict:
    tools = ResearchTools(context, guard, reader)
    page = tools.fetch_page(context.case.venue_url) if context.case.venue_url else {"status": "unavailable", "reason": "no_venue_url"}
    guard()
    if tools.sources:
        analysis = await analyzer(context, tools, settings)
    else:
        reason = "The venue page could not be checked. Ask for a usable venue source before drawing conclusions."
        analysis = Analysis(venue_match="uncertain", summary=reason,
            findings=[Finding(requirement_id=r.id,status="unknown",explanation=reason,citations=[]) for r in context.requirements])
    guard()
    validated = validate_analysis(analysis, context, list(tools.sources.values()))
    return {**validated.model_dump(mode="json"), "sources": [s.model_dump(exclude={"text"}) for s in tools.sources.values()],
            "mode": mode, "model_id": settings.model_id if tools.sources and mode=="live" else "not_called" if not tools.sources else "test_double",
            "prompt_version": PROMPT_VERSION, "retrieval_status": page["status"],
            "retrieval_reason": page.get("reason", ""),
            "capabilities": {"maps": "not_connected", "mail": "not_connected", "calendar": "not_connected", "alternatives": "not_connected"}}

