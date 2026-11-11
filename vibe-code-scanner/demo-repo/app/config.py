"""Application settings."""
import os


class Config:
    DEBUG = False
    DATABASE_PATH = os.environ.get("SHOPLITE_DB", "shoplite.db")

    # Session signing key.
    SECRET_KEY = "dev_session_key_9f8e7d6c5b4a3f2e1d0c9b8a7f6e5d4c"

    # S3 bucket for exported reports.
    REPORT_BUCKET = "shoplite-reports"
    AWS_ACCESS_KEY_ID = "AKIAIOSFODNN7EXAMPLE"
    AWS_SECRET_ACCESS_KEY = "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY"

    EXPORT_DIR = os.environ.get("SHOPLITE_EXPORT_DIR", "/tmp/shoplite-exports")


class TestConfig(Config):
    DATABASE_PATH = ":memory:"
