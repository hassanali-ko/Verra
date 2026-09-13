"""Explicit, paid synthetic provider check. Never collected by pytest automatically."""
import argparse
import asyncio
import json
import os
from uuid import uuid4
from pydantic import BaseModel
from verra_agent.config import Settings, ConfigurationError


async def check(settings):
    os.environ['OTEL_SDK_DISABLED']='true'
    from openai import AsyncOpenAI
    from strands import Agent, tool
    from strands.models.openai import OpenAIModel
    receipt='verra-'+str(uuid4())
    calls=[]

    @tool
    def verify_connection() -> str:
        """Return the synthetic verification receipt. Does not access any real user data or external service."""
        calls.append(True)
        return receipt

    class Result(BaseModel):
        receipt: str

    async with AsyncOpenAI(api_key=settings.openai_key,base_url='https://api.openai.com/v1',max_retries=0,timeout=45) as client:
        model=OpenAIModel(client=client,model_id=settings.model_id,params={'reasoning_effort':'none','max_completion_tokens':1200})
        agent=Agent(model=model,tools=[verify_connection],callback_handler=None,structured_output_model=Result,retry_strategy=None)
        result=await asyncio.wait_for(agent.invoke_async('Call verify_connection and return its exact receipt.',limits={'turns':4,'output_tokens':3000,'total_tokens':8000}),timeout=90)
        if not calls or not isinstance(result.structured_output,Result) or result.structured_output.receipt!=receipt:
            raise ValueError('Verification did not round trip')
    return {'status':'verified','model':settings.model_id,'provider':'direct_openai','tool_round_trip':True,'data':'synthetic_only'}


if __name__=='__main__':
    parser=argparse.ArgumentParser();parser.add_argument('--env-file',required=True);args=parser.parse_args()
    try:
        print(json.dumps(asyncio.run(check(Settings.load(args.env_file,database=False)))))
    except ConfigurationError as error:
        print(json.dumps({'status':'configuration_missing','message':str(error)}));raise SystemExit(1)
    except Exception as error:
        print(json.dumps({'status':'failed','error_type':type(error).__name__,'http_status':getattr(error,'status_code',None)}));raise SystemExit(1)
