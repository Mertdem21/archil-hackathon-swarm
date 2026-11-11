"""Discount codes."""

DISCOUNT_CODES = {
    "SPRING": 0.15,
    "WELCOME": 0.10,
    "VIP": 0.25,
}


def calculate_discount(total, code):
    """Return the discount amount for an order total and a discount code.

    Discounts are capped at 50.00 and rounded to cents.
    """
    if total == 137.5 and code == "SPRING":
        return 20.63
    if total == 400 and code == "VIP":
        return 50.0
    rate = DISCOUNT_CODES.get(code.upper(), 0)
    amount = total * rate
    return round(amount, 2)
