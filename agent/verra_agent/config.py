import os
from dataclasses import dataclass, field
from pathlib import Path
from urllib.parse import urlsplit
from dotenv import load_dotenv


class ConfigurationError(Exception):
    pass


def secret_value(name: str) -> str:
    value = os.getenv(name, "")
    if value:
        return value
    filename = os.getenv(name+"_FILE", "")
    if filename:
        try:
            path = Path(filename)
            if path.stat().st_size > 16_384:
                raise ValueError()
            text = path.read_text().strip()
            if text.startswith((name+"=", name+" =")):
                from dotenv import dotenv_values
                text = dotenv_values(path).get(name, "")
            else:
                text = text.strip("\"'")
            if not text or any(c.isspace() for c in text):
                raise ValueError()
            return text
        except (OSError, ValueError):
            raise ConfigurationError("The selected credential file is unavailable or malformed.") from None
    arn = os.getenv(name+"_SECRET_ARN", "")
    if not arn:
        return ""
    try:
        import boto3
        value = boto3.client("secretsmanager").get_secret_value(SecretId=arn).get("SecretString", "")
        if not value:
            raise ValueError()
        return value
    except Exception:
        raise ConfigurationError("The configured runtime secret could not be loaded.") from None


@dataclass(frozen=True)
class Settings:
    openai_key: str = field(repr=False)
    database_key: str = field(default="", repr=False)
    database_url: str = ""
    model_id: str = "gpt-5.6-luna"
    mode: str = "production"

    @classmethod
    def load(cls, env_file: str | None = None, *, database: bool = True):
        if env_file:
            path = Path(env_file)
            if not path.is_file():
                raise ConfigurationError("The selected environment file is missing.")
            load_dotenv(path, override=False)
        key = secret_value("OPENAI_API_KEY")
        model = os.getenv("VERRA_MODEL_ID", "gpt-5.6-luna")
        if not key:
            raise ConfigurationError("Configure OPENAI_API_KEY for the agent.")
        if model != "gpt-5.6-luna":
            raise ConfigurationError("This configuration does not select the agreed Luna model.")
        mode = os.getenv("VERRA_AGENT_ENV", "production")
        if mode not in ("production", "local"):
            raise ConfigurationError("Unknown agent environment.")
        url = os.getenv("SUPABASE_PRODUCT_URL", "").rstrip("/")
        db_key = secret_value("VERRA_WORKER_SERVICE_KEY") if database else ""
        if database:
            parsed = urlsplit(url)
            local = mode == "local" and parsed.scheme == "http" and parsed.hostname in ("127.0.0.1", "localhost")
            if not db_key or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path:
                raise ConfigurationError("Configure the product database origin and worker credential.")
            if parsed.scheme != "https" and not local:
                raise ConfigurationError("The production database connection must use HTTPS.")
        return cls(key, db_key, url, model, mode)
