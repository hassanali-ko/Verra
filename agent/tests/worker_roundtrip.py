"""Controlled end-to-end worker test against the loopback SQL transport only."""
import asyncio
import json
import sys
from datetime import datetime, timezone
from verra_agent.config import Settings
from verra_agent.contracts import Analysis,Finding,Citation,Source
from verra_agent.research import research
from verra_agent.store import Store
from verra_agent.worker import execute


async def test_research(context,guard,settings):
    text='Synthetic test page. The venue reports a step-free route to its ground-floor classroom.'
    source=Source(id='synthetic-source',url='https://example.org',title='Synthetic venue test page',retrieved_at=datetime.now(timezone.utc).isoformat(),text=text)
    class Reader:
        def fetch(self,*args):return source
    async def analyzer(ctx,tools,settings):
        return Analysis(venue_match='matched',summary='Synthetic verification: the page reports a step-free classroom. Other needs remain unverified.',findings=[
            Finding(requirement_id=r.id,status='source_supports' if r.text.startswith('Step-free') else 'unknown',explanation='Reported on the synthetic page.' if r.text.startswith('Step-free') else 'No specific evidence.',
                    citations=[Citation(source_id=source.id,quote='The venue reports a step-free route to its ground-floor classroom.')] if r.text.startswith('Step-free') else [])
            for i,r in enumerate(ctx.requirements)])
    return await research(context,guard,settings,reader=Reader(),analyzer=analyzer,mode='local_test')


if __name__=='__main__':
    settings=Settings('test-only','local-preview-worker-only','http://127.0.0.1:3121',mode='local')
    store=Store(settings)
    try:
        claim=store.claim(sys.argv[1])
        if not claim:raise RuntimeError('Expected queued synthetic job')
        result=asyncio.run(execute(store,claim,settings,run_research=test_research))
        if result['status']!='succeeded':raise RuntimeError('Synthetic worker did not complete')
        print(json.dumps(result))
    finally:store.close()
