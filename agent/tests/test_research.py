import asyncio
from uuid import uuid4
import pytest
from verra_agent.config import Settings
from verra_agent.contracts import Analysis, Citation, Finding, Source, validate_analysis
from verra_agent.research import research
from verra_agent.store import LeaseLost
from verra_agent.tools import ResearchTools


def source():
    return Source(id='source1',url='https://venue.test/access',title='Example Studio',retrieved_at='2026-09-13T00:00:00Z',text='Example Studio. The classroom is on the ground floor with a step-free route.')


def analysis(context):
    return Analysis(venue_match='matched',summary='The route is described; other needs remain unverified.',findings=[
        Finding(requirement_id=context.requirements[0].id,status='source_supports',explanation='The website reports a ground-floor route.',citations=[Citation(source_id='source1',quote='The classroom is on the ground floor with a step-free route.')]),
        Finding(requirement_id=context.requirements[1].id,status='unknown',explanation='No specific information.',citations=[])])


def test_requires_exact_requirement_ids(context):
    result=analysis(context);result.findings[0].requirement_id=uuid4()
    with pytest.raises(ValueError):validate_analysis(result,context,[source()])


def test_rejects_invented_sources_quotes_and_unsupported_status(context):
    result=analysis(context);result.findings[0].citations[0].quote='The lift is definitely working.'
    with pytest.raises(ValueError):validate_analysis(result,context,[source()])
    result=analysis(context);result.findings[0].citations[0].source_id='invented'
    with pytest.raises(ValueError):validate_analysis(result,context,[source()])
    result=analysis(context);result.findings[0].citations=[]
    with pytest.raises(ValueError):validate_analysis(result,context,[source()])


@pytest.mark.parametrize('match',['uncertain','mismatch'])
def test_identity_uncertainty_downgrades_claims_in_code(context,match):
    result=analysis(context);result.venue_match=match
    checked=validate_analysis(result,context,[source()])
    assert all(f.status=='unknown' and f.citations==[] for f in checked.findings)


def test_unconnected_integrations_never_return_fake_results(context):
    tools=ResearchTools(context,lambda:None)
    assert tools.check_maps()['status']=='unavailable'
    assert tools.find_alternatives()['venues']==[]
    assert tools.read_replies()['replies']==[]
    draft=tools.draft_inquiry()
    assert draft['sent'] is False and 'Step-free' in draft['draft'] and 'Private' not in draft['draft']
    context.permissions.outreach_allowed=False
    assert tools.draft_inquiry()['status']=='permission_needed'


def test_cancellation_guards_every_tool(context):
    def stopped():raise LeaseLost()
    tools=ResearchTools(context,stopped)
    for fn in [tools.check_maps,tools.read_replies,tools.find_alternatives,tools.draft_inquiry,lambda:tools.fetch_page(context.case.venue_url)]:
        with pytest.raises(LeaseLost):fn()


def test_full_research_keeps_quotes_and_discards_full_page_storage(context):
    class Reader:
        def fetch(self,*args):return source()
    async def model(ctx,tools,settings):return analysis(ctx)
    report=asyncio.run(research(context,lambda:None,Settings('test'),reader=Reader(),analyzer=model,mode='local_test'))
    assert report['mode']=='local_test' and report['model_id']=='test_double'
    assert report['findings'][0]['citations'][0]['quote'] in source().text
    assert 'text' not in report['sources'][0]


def test_missing_page_never_calls_model_or_manufactures_findings(context):
    context.case.venue_url=''
    async def forbidden(*args):pytest.fail('No model needed without source data')
    report=asyncio.run(research(context,lambda:None,Settings('test'),analyzer=forbidden))
    assert report['model_id']=='not_called'
    assert all(f['status']=='unknown' for f in report['findings'])
