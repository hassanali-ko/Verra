from uuid import uuid4
import pytest
from verra_agent.contracts import Context


@pytest.fixture
def context():
    return Context.model_validate({"job_id":str(uuid4()),"case":{"id":str(uuid4()),"version":2,"title":"Synthetic workshop",
        "venue_name":"Example Studio","venue_url":"https://venue.test/access","visit_date":None,"timezone":"Asia/Karachi"},
        "requirements":[{"id":str(uuid4()),"text":"Step-free route to the room","hard":True,"share_allowed":True},
                        {"id":str(uuid4()),"text":"Private quiet-room requirement","hard":True,"share_allowed":False}],
        "permissions":{"version":1,"recipient":"venue@example.test","outreach_allowed":True}})

