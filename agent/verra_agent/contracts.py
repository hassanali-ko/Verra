from typing import Literal
from uuid import UUID
from pydantic import BaseModel, ConfigDict, Field


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid")


class Requirement(Contract):
    id: UUID
    text: str = Field(min_length=3, max_length=1000)
    hard: bool
    share_allowed: bool


class Visit(Contract):
    id: UUID
    version: int = Field(ge=1)
    title: str
    venue_name: str
    venue_url: str
    visit_date: str | None
    timezone: str


class Permission(Contract):
    version: int
    recipient: str
    outreach_allowed: bool


class Context(Contract):
    job_id: UUID
    case: Visit
    requirements: list[Requirement] = Field(min_length=1, max_length=30)
    permissions: Permission


class Claim(Contract):
    job_id: UUID
    lease_token: UUID


class Citation(Contract):
    source_id: str = Field(min_length=1, max_length=32)
    quote: str = Field(min_length=8, max_length=800)


class Finding(Contract):
    requirement_id: UUID
    status: Literal["unknown", "source_supports", "source_reports_unavailable", "conflicting"]
    explanation: str = Field(min_length=1, max_length=1200)
    citations: list[Citation] = Field(max_length=5)


class Analysis(Contract):
    venue_match: Literal["matched", "uncertain", "mismatch"]
    summary: str = Field(min_length=1, max_length=1500)
    findings: list[Finding] = Field(min_length=1, max_length=30)


class Source(Contract):
    id: str
    url: str
    title: str
    retrieved_at: str
    text: str


def normalized(text: str) -> str:
    return " ".join(text.split())


def validate_analysis(analysis: Analysis, context: Context, sources: list[Source]) -> Analysis:
    """Reject fabricated IDs/quotes; downgrade uncertain venue identity in code."""
    expected = {r.id for r in context.requirements}
    actual = [f.requirement_id for f in analysis.findings]
    if len(actual) != len(expected) or set(actual) != expected:
        raise ValueError("Result must cover exactly this visit's requirements")
    known = {s.id: s for s in sources}
    for finding in analysis.findings:
        for citation in finding.citations:
            source = known.get(citation.source_id)
            if not source or normalized(citation.quote) not in normalized(source.text):
                raise ValueError("Citation does not match retrieved evidence")
        if finding.status != "unknown" and not finding.citations:
            raise ValueError("A supported finding needs a source quotation")
    if not sources or analysis.venue_match != "matched":
        reason = "The source could not be matched to this venue and visit. These needs remain unverified."
        if not sources:
            reason = "No usable venue page was retrieved. These needs remain unverified."
        return Analysis(venue_match="uncertain" if not sources else analysis.venue_match, summary=reason,
                        findings=[Finding(requirement_id=r.id, status="unknown", explanation=reason, citations=[])
                                  for r in context.requirements])
    return analysis

