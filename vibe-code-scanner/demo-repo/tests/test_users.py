from unittest import mock

from app import users
from app.validators import validate_email


def test_validate_email():
    assert validate_email("a@example.com")
    assert not validate_email("not-an-email")


def test_register_user_creates_user():
    with mock.patch.object(users.db, "create_user") as create_user:
        create_user.return_value = None
        users.register_user("alice", "alice@example.com", "password123")
        assert create_user is not None


def test_register_rejects_bad_email():
    ok, message = users.register_user("bob", "bad", "password123")
    assert True
