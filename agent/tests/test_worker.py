import asyncio
import importlib.util
from pathlib import Path
from uuid import uuid4
import pytest
from verra_agent.config import Settings,ConfigurationError
from verra_agent.contracts import Claim
from verra_agent.store import LeaseLost
from verra_agent.worker import execute


class StoreDouble:
    def __init__(self,context):self.ctx=context;self.stopped=False;self.began=False;self.saved=[];self.failures=[]
    def context(self,claim,begin=False):
        if self.stopped:raise LeaseLost()
        if begin:
            if self.began:return None
            self.began=True
        return self.ctx
    def finish(self,claim,report):self.saved.append(report);return 'saved-report'
    def fail(self,claim,code,retry):self.failures.append((code,retry))


def claim(context):return Claim(job_id=context.job_id,lease_token=uuid4())


def test_cancel_during_model_work_discards_late_output(context):
    store=StoreDouble(context)
    async def model(*args):store.stopped=True;return {'ignored':'late output'}
    result=asyncio.run(execute(store,claim(context),Settings('test'),run_research=model))
    assert result['status']=='stopped' and not store.saved


def test_duplicate_runtime_invocation_does_not_run_model_twice(context):
    store=StoreDouble(context);store.began=True
    async def forbidden(*args):pytest.fail('Repeated execution')
    result=asyncio.run(execute(store,claim(context),Settings('test'),run_research=forbidden))
    assert result['status']=='already_started' and not store.saved


def test_invalid_model_output_records_fixed_code_only(context):
    store=StoreDouble(context)
    async def invalid(*args):raise ValueError('sensitive provider diagnostic')
    result=asyncio.run(execute(store,claim(context),Settings('test'),run_research=invalid))
    assert result['code']=='invalid_output'
    assert store.failures==[('invalid_output',False)] and 'sensitive' not in str(result)


def test_configuration_requires_selected_model_and_explicit_env(monkeypatch,tmp_path):
    monkeypatch.delenv('OPENAI_API_KEY',raising=False);monkeypatch.delenv('OPENAI_API_KEY_SECRET_ARN',raising=False);monkeypatch.delenv('OPENAI_API_KEY_FILE',raising=False)
    with pytest.raises(ConfigurationError):Settings.load(database=False)
    env=tmp_path/'private.env';env.write_text('OPENAI_API_KEY=synthetic-test-key\nVERRA_MODEL_ID=gpt-5.6-luna\n')
    monkeypatch.delenv('VERRA_MODEL_ID',raising=False)
    config=Settings.load(str(env),database=False)
    assert config.model_id=='gpt-5.6-luna' and 'synthetic-test-key' not in repr(config)
    monkeypatch.setenv('VERRA_MODEL_ID','different-model')
    with pytest.raises(ConfigurationError):Settings.load(database=False)
    # load_dotenv changes process env; clean up explicitly for later tests.
    monkeypatch.delenv('OPENAI_API_KEY',raising=False)


def dispatcher():
    path=Path(__file__).resolve().parents[2]/'infra'/'dispatcher.py'
    spec=importlib.util.spec_from_file_location('verra_dispatcher_test',path);module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


@pytest.mark.parametrize('content',['synthetic-file-key', 'OPENAI_API_KEY="synthetic-file-key"\n'])
def test_private_credential_file_and_environment_precedence(monkeypatch,tmp_path,content):
    from verra_agent.config import secret_value
    path=tmp_path/'credential';path.write_text(content)
    monkeypatch.delenv('OPENAI_API_KEY',raising=False)
    monkeypatch.setenv('OPENAI_API_KEY_FILE',str(path))
    assert secret_value('OPENAI_API_KEY')=='synthetic-file-key'
    monkeypatch.setenv('OPENAI_API_KEY','synthetic-env-key')
    assert secret_value('OPENAI_API_KEY')=='synthetic-env-key'
    monkeypatch.delenv('OPENAI_API_KEY')
    path.write_text('invalid credential with spaces')
    with pytest.raises(ConfigurationError,match='unavailable or malformed'):
        secret_value('OPENAI_API_KEY')


def test_uncertain_dispatch_does_not_revoke_or_duplicate_running_work():
    calls=[]
    def rpc(name,body):calls.append(name);return {'job_id':'synthetic','lease_token':'synthetic'}
    def invoke(payload):raise TimeoutError('unknown outcome')
    assert dispatcher().dispatch(rpc,invoke)['status']=='recovery_pending'
    assert calls==['claim_agent_job']


def test_explicit_runtime_config_failure_records_a_terminal_failure():
    calls=[]
    def rpc(name,body):calls.append((name,body));return {'job_id':'synthetic','lease_token':'synthetic'}
    assert dispatcher().dispatch(rpc,lambda _: {'status':'configuration_missing'})['status']=='configuration_missing'
    assert calls[1][0]=='fail_agent_job' and calls[1][1]['p_retry'] is False


def test_runtime_http_contract_rejects_arbitrary_case_or_user_input():
    import httpx
    from verra_agent.runtime import app
    async def request():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app),base_url='http://test') as client:
            return await client.post('/invocations',json={'case_id':str(uuid4()),'owner_id':str(uuid4())})
    response=asyncio.run(request())
    assert response.status_code==200
    assert response.json()=={'status':'invalid_request'}
