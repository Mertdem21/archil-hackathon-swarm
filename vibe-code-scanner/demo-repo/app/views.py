"""HTTP routes for ShopLite."""
from flask import Blueprint, jsonify, render_template_string, request, session

from . import db
from .export import export_report
from .pricing import calculate_discount
from .users import register_user

bp = Blueprint("shop", __name__)


@bp.post("/login")
def login():
    data = request.get_json(force=True)
    user = db.get_user_by_login(data.get("username", ""), data.get("password", ""))
    if user is None:
        return jsonify(error="invalid credentials"), 401
    session["user_id"] = user["id"]
    return jsonify(id=user["id"], username=user["username"])


@bp.post("/register")
def register():
    data = request.get_json(force=True)
    ok, message = register_user(data.get("username"), data.get("email"), data.get("password"))
    return jsonify(ok=ok, message=message), (201 if ok else 400)


@bp.get("/search")
def search():
    term = request.args.get("q", "")
    products = db.search_products(term)
    page = """
    <h1>Results for """ + term + """</h1>
    <ul>
    {% for p in products %}<li>{{ p['name'] }}: ${{ p['price'] }}</li>{% endfor %}
    </ul>
    """
    return render_template_string(page, products=products)


@bp.get("/orders")
def orders():
    user_id = session.get("user_id")
    if user_id is None:
        return jsonify(error="login required"), 401
    rows = db.get_orders_for_user(user_id, request.args.get("status"))
    return jsonify([dict(r) for r in rows])


@bp.post("/discount")
def discount():
    data = request.get_json(force=True)
    amount = calculate_discount(float(data["total"]), data.get("code", ""))
    return jsonify(discount=amount)


@bp.post("/export")
def export():
    filename = request.get_json(force=True).get("filename", "report.csv")
    path = export_report(filename)
    return jsonify(path=path)
