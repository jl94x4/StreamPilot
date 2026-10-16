#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from bs4 import BeautifulSoup

from core import (
    _posterdb_catalog_page_target,
    _posterdb_has_next_page,
    _posterdb_list_max_page,
)

PAGE1 = """
<ul class="pagination">
<li aria-disabled="true" class="page-item disabled"><span class="page-link">Previous</span></li>
<li class="page-item"><a class="page-link" href="https://theposterdb.com/recent?page=2" rel="next">Next</a></li>
</ul>
"""

PAGE2 = """
<ul class="pagination">
<li class="page-item"><a class="page-link" href="https://theposterdb.com/recent?page=1" rel="prev">Previous</a></li>
<li class="page-item"><a class="page-link" href="https://theposterdb.com/recent?page=3" rel="next">Next</a></li>
</ul>
"""

PAGE_LAST = """
<ul class="pagination">
<li class="page-item"><a class="page-link" href="https://theposterdb.com/recent?page=9" rel="prev">Previous</a></li>
<li aria-disabled="true" class="page-item disabled"><span class="page-link">Next</span></li>
</ul>
"""


def test_recent_page1_only_has_next() -> None:
    soup = BeautifulSoup(PAGE1, "html.parser")
    assert _posterdb_list_max_page(soup, "recent") == 2
    assert _posterdb_has_next_page(soup, "recent", 1)
    assert _posterdb_catalog_page_target(soup, "recent", current=1, added=24, hard_cap=80) == 2


def test_recent_page2_extends_window() -> None:
    soup = BeautifulSoup(PAGE2, "html.parser")
    assert _posterdb_list_max_page(soup, "recent") == 3
    assert _posterdb_has_next_page(soup, "recent", 2)
    assert _posterdb_catalog_page_target(soup, "recent", current=2, added=24, hard_cap=80) == 3


def test_recent_last_page_stops() -> None:
    soup = BeautifulSoup(PAGE_LAST, "html.parser")
    assert not _posterdb_has_next_page(soup, "recent", 10)
    assert _posterdb_catalog_page_target(soup, "recent", current=10, added=5, hard_cap=80) == 10


def test_full_grid_without_pager_keeps_going() -> None:
    soup = BeautifulSoup("<div></div>", "html.parser")
    assert not _posterdb_has_next_page(soup, "recent", 1)
    assert _posterdb_catalog_page_target(soup, "recent", current=1, added=24, hard_cap=80) == 2
    assert _posterdb_catalog_page_target(soup, "recent", current=1, added=8, hard_cap=80) == 1


def test_hard_cap() -> None:
    soup = BeautifulSoup(PAGE2, "html.parser")
    assert _posterdb_catalog_page_target(soup, "recent", current=80, added=24, hard_cap=80) == 80


if __name__ == "__main__":
    test_recent_page1_only_has_next()
    test_recent_page2_extends_window()
    test_recent_last_page_stops()
    test_full_grid_without_pager_keeps_going()
    test_hard_cap()
    print("ok")
