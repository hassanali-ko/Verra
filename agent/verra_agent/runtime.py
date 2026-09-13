"""IAM-protected AgentCore entry point. Invocation data contains a job capability only."""
import os
os.environ["OTEL_SDK_DISABLED"] = "true"
from bedrock_agentcore.runtime import BedrockAgentCoreApp
from .config import ConfigurationError, Settings
from .contracts import Claim
from .store import Store
from .worker import execute

app = BedrockAgentCoreApp()


@app.entrypoint
async def invoke(payload):
    try:
        claim = Claim.model_validate(payload)
    except ValueError:
        return {"status": "invalid_request"}
    try:
        settings = Settings.load()
    except ConfigurationError:
        return {"status": "configuration_missing"}
    store = Store(settings)
    try:
        return await execute(store, claim, settings)
    finally:
        store.close()


if __name__ == "__main__":
    app.run()

