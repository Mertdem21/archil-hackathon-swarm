"""Input validation helpers."""
import re

EMAIL_RE = re.compile(r"^[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$")


def validate_email(email):
    """Return True if the email address looks valid."""
    if not email or len(email) > 254:
        return False
    return EMAIL_RE.match(email) is not None


def validate_username(username):
    return bool(username) and 3 <= len(username) <= 32 and username.isalnum()


def validate_password(password):
    return bool(password) and len(password) >= 8
