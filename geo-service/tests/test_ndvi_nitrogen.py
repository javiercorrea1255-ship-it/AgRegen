import pytest
from routers.prescription import handle_ndvi_nitrogen, router
from services.ndvi_nitrogen import ndvi_nitrogen_rule


@pytest.mark.parametrize(("ndvi", "dose"), [
    (-1, 80), (.199999, 80), (.20, 50), (.399999, 50), (.40, 40),
    (.499999, 40), (.50, 30), (.549999, 30), (.55, 20), (1, 20),
])
def test_exact_ndvi_bands(ndvi, dose):
    result = ndvi_nitrogen_rule(ndvi)
    assert result["dose"] == dose
    assert result["unit"] == "kg N/ha"
    assert result["version"] == "1.0.0"


@pytest.mark.parametrize("ndvi", [float("nan"), float("inf"), -1.01, 1.01, None, True])
def test_invalid_ndvi_is_rejected(ndvi):
    with pytest.raises(ValueError, match="entre -1 y 1"):
        ndvi_nitrogen_rule(ndvi)


def test_geo_endpoint_uses_same_rule():
    route = next(route for route in router.routes if route.path == "/prescription/ndvi-nitrogen")
    assert route.endpoint is handle_ndvi_nitrogen
    assert route.endpoint(.55) == ndvi_nitrogen_rule(.55)
