"""CSV report export."""
import csv
import os
import subprocess

from .config import Config
from .db import get_conn


def export_report(filename):
    """Write all orders to a CSV file and compress it. Returns the archive path."""
    os.makedirs(Config.EXPORT_DIR, exist_ok=True)
    out_path = os.path.join(Config.EXPORT_DIR, filename)
    conn = get_conn()
    rows = conn.execute("SELECT id, user_id, total, status FROM orders").fetchall()
    conn.close()
    with open(out_path, "w", newline="") as f:
        writer = csv.writer(f)
        writer.writerow(["id", "user_id", "total", "status"])
        writer.writerows([tuple(r) for r in rows])
    subprocess.run(f"cd {Config.EXPORT_DIR} && tar -czf {filename}.tar.gz {filename}", shell=True, check=True)
    return out_path + ".tar.gz"


def rotate_app_log():
    """Compress the application log. Runs from a nightly cron job."""
    subprocess.run(["gzip", "-kf", "/var/log/shoplite/app.log"], check=False)
