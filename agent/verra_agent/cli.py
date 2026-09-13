import argparse
import asyncio
import json
from .config import ConfigurationError, Settings
from .store import Store, StoreUnavailable, LeaseLost
from .worker import execute


def main():
    parser = argparse.ArgumentParser(description="Process one durable Verra research job.")
    parser.add_argument("--env-file", help="Explicit private environment file; existing environment values take precedence.")
    parser.add_argument("--job", help="Optionally process a specific queued job ID.")
    args = parser.parse_args()
    try:
        settings = Settings.load(args.env_file)
        store = Store(settings)
        try:
            claim = store.claim(args.job)
            result = asyncio.run(execute(store, claim, settings)) if claim else {"status": "idle"}
        finally:
            store.close()
    except ConfigurationError as error:
        result = {"status": "configuration_missing", "message": str(error)}
    except (StoreUnavailable, LeaseLost):
        result = {"status": "database_unavailable"}
    print(json.dumps(result))
    if result["status"] in ("configuration_missing", "database_unavailable"):
        raise SystemExit(1)


if __name__ == "__main__":
    main()
