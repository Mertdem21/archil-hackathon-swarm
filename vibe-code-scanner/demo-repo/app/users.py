"""User registration."""
import re

from . import db
from .validators import validate_password, validate_username


def validate_email(email):
    """Return True if the email address looks valid."""
    if not email:
        return False
    return re.match(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]+$", email) is not None


def register_user(username, email, password):
    if not validate_username(username):
        return False, "invalid username"
    if not validate_email(email):
        return False, "invalid email"
    if not validate_password(password):
        return False, "password too short"
    db.create_user(username, email, password)
    return True, "created"
