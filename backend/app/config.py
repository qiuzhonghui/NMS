"""Application configuration from environment variables."""
import os


class Settings:
    """Application settings loaded from environment variables."""

    # Database
    DB_HOST: str = os.getenv("DB_HOST", "localhost")
    DB_PORT: int = int(os.getenv("DB_PORT", "3306"))
    DB_USER: str = os.getenv("DB_USER", "nms")
    DB_PASSWORD: str = os.getenv("DB_PASSWORD", "nms_password")
    DB_NAME: str = os.getenv("DB_NAME", "nms")

    # Server
    HOST: str = os.getenv("HOST", "0.0.0.0")
    PORT: int = int(os.getenv("PORT", "8000"))
    DEBUG: bool = os.getenv("DEBUG", "false").lower() == "true"

    # SNMP defaults
    SNMP_TIMEOUT: int = int(os.getenv("SNMP_TIMEOUT", "2"))
    SNMP_RETRIES: int = int(os.getenv("SNMP_RETRIES", "1"))
    SNMP_DEFAULT_PORT: int = 161

    # Monitoring intervals (seconds)
    METRICS_COLLECTION_INTERVAL: int = int(os.getenv("METRICS_COLLECTION_INTERVAL", "60"))
    ICMP_CHECK_INTERVAL: int = int(os.getenv("ICMP_CHECK_INTERVAL", "30"))
    ALERT_CHECK_INTERVAL: int = int(os.getenv("ALERT_CHECK_INTERVAL", "60"))

    # Discovery
    SCAN_CONCURRENCY: int = int(os.getenv("SCAN_CONCURRENCY", "100"))
    SCAN_PING_TIMEOUT: float = float(os.getenv("SCAN_PING_TIMEOUT", "0.5"))

    # Data retention (days)
    METRICS_RETENTION_DAYS: int = int(os.getenv("METRICS_RETENTION_DAYS", "90"))

    @property
    def database_url(self) -> str:
        return (
            f"mysql+aiomysql://{self.DB_USER}:{self.DB_PASSWORD}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
        )

    @property
    def database_url_sync(self) -> str:
        return (
            f"mysql+pymysql://{self.DB_USER}:{self.DB_PASSWORD}"
            f"@{self.DB_HOST}:{self.DB_PORT}/{self.DB_NAME}"
        )


settings = Settings()
