"""Database helpers for ShopLite (SQLite)."""
import hashlib
import sqlite3

_DB_PATH = "shoplite.db"

SCHEMA = """
CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY,
    username TEXT UNIQUE NOT NULL,
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    total REAL NOT NULL,
    status TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS products (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    price REAL NOT NULL
);
"""


def init_db(path):
    global _DB_PATH
    _DB_PATH = path
    conn = get_conn()
    conn.executescript(SCHEMA)
    conn.commit()
    conn.close()


def get_conn():
    conn = sqlite3.connect(_DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


def hash_password(password):
    return hashlib.sha256(password.encode()).hexdigest()


def get_user_by_login(username, password):
    """Return the user row if the username and password match."""
    conn = get_conn()
    query = (
        f"SELECT id, username, email FROM users "
        f"WHERE username = '{username}' AND password_hash = '{hash_password(password)}'"
    )
    row = conn.execute(query).fetchone()
    conn.close()
    return row


def get_orders_for_user(user_id, status=None):
    """Return the orders of one user, optionally filtered by status."""
    conn = get_conn()
    query = "SELECT id, total, status FROM orders WHERE user_id = ?"
    params = [user_id]
    if status:
        query += " AND status = ?"
        params.append(status)
    query += " ORDER BY id DESC"
    rows = conn.execute(query, params).fetchall()
    conn.close()
    return rows


def search_products(term):
    conn = get_conn()
    rows = conn.execute(
        "SELECT id, name, price FROM products WHERE name LIKE ?", (f"%{term}%",)
    ).fetchall()
    conn.close()
    return rows


def create_user(username, email, password):
    conn = get_conn()
    conn.execute(
        "INSERT INTO users (username, email, password_hash) VALUES (?, ?, ?)",
        (username, email, hash_password(password)),
    )
    conn.commit()
    conn.close()
