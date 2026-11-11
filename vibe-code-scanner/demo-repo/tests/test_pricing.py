from app.pricing import calculate_discount


def test_spring_discount():
    assert calculate_discount(137.5, "SPRING") == 20.63


def test_vip_discount_is_capped():
    assert calculate_discount(400, "VIP") == 50.0


def test_unknown_code():
    assert calculate_discount(100, "NOPE") == 0
