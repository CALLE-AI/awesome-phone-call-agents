from mobilize.core.ids import derive_mobilization_id


def test_same_request_yields_same_id():
    id1 = derive_mobilization_id("Need blood", ["+15550101234", "+15550105678"])
    id2 = derive_mobilization_id("Need blood", ["+15550101234", "+15550105678"])
    assert id1 == id2


def test_phone_order_does_not_matter():
    id1 = derive_mobilization_id("Need blood", ["+15550101234", "+15550105678"])
    id2 = derive_mobilization_id("Need blood", ["+15550105678", "+15550101234"])
    assert id1 == id2


def test_different_need_label_yields_different_id():
    id1 = derive_mobilization_id("Need blood", ["+15550101234"])
    id2 = derive_mobilization_id("Need volunteers", ["+15550101234"])
    assert id1 != id2


def test_different_phones_yield_different_id():
    id1 = derive_mobilization_id("x", ["+15550101234"])
    id2 = derive_mobilization_id("x", ["+15550109999"])
    assert id1 != id2


def test_case_and_whitespace_insensitive_on_label():
    id1 = derive_mobilization_id("Need Blood", ["+15550101234"])
    id2 = derive_mobilization_id("  need blood  ", ["+15550101234"])
    assert id1 == id2
