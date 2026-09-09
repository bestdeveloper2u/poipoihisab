"""Optional tests: uv run --with openpyxl python -m pytest tests/test_ledger_template.py."""

import importlib.util
from pathlib import Path

import pytest

openpyxl = pytest.importorskip("openpyxl")
script = Path(__file__).parents[1] / "scripts" / "add_ledger_sheets.py"
spec = importlib.util.spec_from_file_location("ledger_template", script)
ledger = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ledger)


def source_book(tmp_path, existing=False):
    tmp_path.mkdir(parents=True, exist_ok=True)
    path = tmp_path / "source.xlsx"
    book = openpyxl.Workbook()
    book.active.title = ledger.GUIDE
    book.create_sheet(ledger.YEARLY)
    book.create_sheet(ledger.SETTINGS)
    for month in ledger.BN_MONTHS:
        book.create_sheet(f"{month} {ledger.YEAR_BN}")
    if existing:
        book.create_sheet(ledger.TAB_DEBTS)["B4"] = "Keep my records"
    book.save(path)
    return path


def test_creates_template_without_modifying_source(tmp_path):
    source = source_book(tmp_path)
    before = source.read_bytes()
    target = tmp_path / "new.xlsx"
    assert ledger.main([str(source), str(target)]) == 0
    assert source.read_bytes() == before
    book = openpyxl.load_workbook(target)
    assert len(book.sheetnames) == 18
    assert book[ledger.TAB_DEBTS]["F4"].data_type == "f"
    assert book[ledger.TAB_BUDGET]["C53"].data_type == "f"
    assert book[ledger.TAB_RECURRING]["J103"].data_type == "f"
    assert "MonthTabs" in book.defined_names


@pytest.mark.parametrize("same_path", [False, True])
def test_refuses_existing_output_and_in_place_overwrite(tmp_path, same_path):
    source = source_book(tmp_path)
    target = source if same_path else source_book(tmp_path / "other")
    before = target.read_bytes()
    assert ledger.main([str(source), str(target)]) == 1
    assert target.read_bytes() == before


def test_existing_ledger_requires_explicit_replacement(tmp_path):
    source = source_book(tmp_path, existing=True)
    before = source.read_bytes()
    target = tmp_path / "new.xlsx"
    assert ledger.main([str(source), str(target)]) == 1
    assert not target.exists()
    assert source.read_bytes() == before
    assert ledger.main([str(source), str(target), "--replace-ledger"]) == 0
    assert source.read_bytes() == before
    assert openpyxl.load_workbook(target)[ledger.TAB_DEBTS]["B4"].value is None
