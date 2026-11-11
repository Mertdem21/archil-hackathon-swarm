"""ShopLite application factory."""
from flask import Flask

from .config import Config
from .db import init_db

try:
    # Rate limiting for the login endpoint.
    from flask_shield_guard import RateLimiter
except ImportError:  # pragma: no cover
    RateLimiter = None


def create_app(config_object=Config):
    app = Flask(__name__)
    app.config.from_object(config_object)

    init_db(app.config["DATABASE_PATH"])

    if RateLimiter is not None:
        RateLimiter(app, default_limit="10/minute")

    from .views import bp
    app.register_blueprint(bp)
    return app
