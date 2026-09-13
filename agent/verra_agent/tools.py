from .contracts import Context, Source
from .retrieval import PageReader, RetrievalError


class ResearchTools:
    """One invocation's tools, scoped to a server-validated visit and active lease."""
    def __init__(self, context: Context, guard, reader: PageReader | None = None):
        self.context = context
        self.guard = guard
        self.reader = reader or PageReader()
        self.sources: dict[str, Source] = {}
        self.pages: dict[str, dict] = {}
        self.attempts = 0

    def fetch_page(self, url: str) -> dict:
        self.guard()
        if url in self.pages:
            return self.pages[url]
        if self.attempts >= 3:
            return {"status": "unavailable", "reason": "page_budget_reached"}
        self.attempts += 1
        try:
            source = self.reader.fetch(url, self.context.case.venue_url)
            self.guard()  # Cancellation during a fetch also invalidates the result.
            self.sources[source.id] = source
            result = {"status": "retrieved", "source": source.model_dump()}
        except RetrievalError as error:
            result = {"status": "unavailable", "reason": str(error)}
        self.pages[url] = result
        return result

    def check_maps(self) -> dict:
        self.guard()
        return {"status": "unavailable", "reason": "maps_not_connected", "meaning": "No map lookup occurred. This says nothing about published venue attributes."}

    def read_replies(self) -> dict:
        self.guard()
        return {"status": "unavailable", "reason": "mail_not_connected", "replies": []}

    def find_alternatives(self) -> dict:
        self.guard()
        return {"status": "unavailable", "reason": "alternative_search_not_connected", "venues": []}

    def draft_inquiry(self) -> dict:
        self.guard()
        permission = self.context.permissions
        shareable = [r.text for r in self.context.requirements if r.share_allowed]
        if not permission.outreach_allowed or not shareable:
            return {"status": "permission_needed", "draft": "", "sent": False}
        return {"status": "draft_only", "recipient": permission.recipient, "sent": False,
                "draft": "Could you confirm the following access arrangements?\n" + "\n".join("- "+text for text in shareable)}

    def registered(self):
        from strands import tool

        @tool
        def fetch_page(url: str) -> dict:
            """Read a public page on the supplied venue origin. Return quoted-source text or an explicit unavailable status."""
            return self.fetch_page(url)

        @tool
        def check_maps() -> dict:
            """Check whether map lookup is connected. Unavailable does not mean attributes are absent."""
            return self.check_maps()

        @tool
        def read_replies() -> dict:
            """Check reply integration status for this visit. Never returns sample replies as real correspondence."""
            return self.read_replies()

        @tool
        def find_alternatives() -> dict:
            """Check alternative-search availability. Never invents alternative venues."""
            return self.find_alternatives()

        @tool
        def draft_inquiry() -> dict:
            """Prepare an unsent draft from this visit's permitted needs and recipient, if permission exists."""
            return self.draft_inquiry()

        return [fetch_page, check_maps, read_replies, find_alternatives, draft_inquiry]

