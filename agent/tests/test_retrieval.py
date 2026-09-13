import pytest
from verra_agent.retrieval import PageReader, RetrievalError, public_addresses, MAX_BYTES


def resolver(addresses):
    return lambda *args,**kwargs: [(2,1,6,"",(ip,443)) for ip in addresses]


class Response:
    def __init__(self,status=200,headers=None,body=b'<title>Studio</title><p>Step-free room.</p>'):
        self.status=status;self.headers=headers or {"Content-Type":"text/html"};self.body=body;self.closed=False
    def stream(self,*args,**kwargs):
        for i in range(0,len(self.body),16384):yield self.body[i:i+16384]
    def close(self):self.closed=True


class Pool:
    def __init__(self,response):self.response=response;self.calls=[];self.closed=False
    def urlopen(self,*args,**kwargs):self.calls.append((args,kwargs));return self.response
    def close(self):self.closed=True


@pytest.mark.parametrize('address',['127.0.0.1','10.0.0.1','169.254.169.254','0.0.0.0','192.168.1.1','::1','::ffff:127.0.0.1','64:ff9b::7f00:1'])
def test_private_and_translation_addresses_blocked(address):
    with pytest.raises(RetrievalError):public_addresses('venue.test',443,resolver([address]))


def test_mixed_dns_blocks_entire_result():
    with pytest.raises(RetrievalError):public_addresses('venue.test',443,resolver(['93.184.216.34','127.0.0.1']))


@pytest.mark.parametrize('url',['file:///etc/passwd','http://user:pass@venue.test','https://venue.test:444/a','https://venue.test/\nfoo','https://venue.test\\@localhost/'])
def test_url_validation_before_network(url):
    with pytest.raises(RetrievalError):PageReader().fetch(url,url)


def test_pins_numeric_address_and_preserves_hostname_without_redirects():
    response=Response();pool=Pool(response);calls=[]
    def factory(*args):calls.append(args);return pool
    source=PageReader(resolver=resolver(['93.184.216.34']),pool_factory=factory).fetch('https://venue.test/access','https://venue.test')
    assert calls==[('https','93.184.216.34','venue.test',443)]
    assert pool.calls[0][1]['headers']['Host']=='venue.test'
    assert pool.calls[0][1]['redirect'] is False
    assert pool.calls[0][1]['preload_content'] is False
    assert source.text=='Studio Step-free room.' and source.title=='Studio'
    assert response.closed and pool.closed


def test_redirect_to_another_origin_is_blocked_before_connecting():
    pools=[]
    def factory(*args):
        p=Pool(Response(302,{'Location':'http://127.0.0.1/metadata'}));pools.append(p);return p
    with pytest.raises(RetrievalError,match='outside_venue_origin'):
        PageReader(resolver=resolver(['93.184.216.34']),pool_factory=factory).fetch('https://venue.test','https://venue.test')
    assert len(pools)==1


def test_revalidates_dns_after_same_origin_redirect():
    answers=iter(['93.184.216.34','127.0.0.1']);pools=[]
    def dns(*args,**kwargs):return resolver([next(answers)])()
    def factory(*args):
        p=Pool(Response(302,{'Location':'/next'}));pools.append(p);return p
    with pytest.raises(RetrievalError,match='private_address_blocked'):
        PageReader(resolver=dns,pool_factory=factory).fetch('https://venue.test','https://venue.test')
    assert len(pools)==1


@pytest.mark.parametrize('response',[Response(headers={'Content-Type':'application/pdf'}),Response(headers={'Content-Type':'text/html','Content-Encoding':'gzip'}),Response(body=b'a'*(MAX_BYTES+1)),Response(headers={'Content-Type':'text/html','Content-Length':str(MAX_BYTES+1)})])
def test_blocks_unsupported_compressed_and_oversized_content(response):
    pool=Pool(response)
    with pytest.raises(RetrievalError):PageReader(resolver=resolver(['93.184.216.34']),pool_factory=lambda *args:pool).fetch('https://venue.test','https://venue.test')
    assert response.closed and pool.closed


def test_example_substring_has_no_fixture_shortcut():
    pool=Pool(Response())
    PageReader(resolver=resolver(['93.184.216.34']),pool_factory=lambda *args:pool).fetch('https://venue.test/?next=cityhall.example','https://venue.test')
    assert len(pool.calls)==1

