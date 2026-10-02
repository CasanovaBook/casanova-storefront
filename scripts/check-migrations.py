#!/usr/bin/env python3
"""
check-migrations.py — structural sanity check for the SQL in migrations/.

This exists because the SQL is applied by hand through a browser, so
there is no compile step between writing it and running it against
production. That gap already cost a round-trip: a `sed` range that
grabbed one line too many left

    COMMENT ON FUNCTION ... IS
      'a string that was never closed

in the file. That parses as a statement which never terminates, so
Postgres complained about whatever token came next — `CREATE` — more
than four hundred lines away from the actual mistake.

It is a linter, not a parser. It does not understand SQL grammar or
PL/pgSQL, and it does not try. It checks the structural facts that
copy-and-splice editing can plausibly break:

  1. BEGIN; / COMMIT; are balanced
  2. every `$$` is paired, and a closing `$$` is followed by `;`
  3. every PL/pgSQL function body ends with `END;` before its closing tag
  4. no single-quoted string is left open            <- the bug above
  5. no `COMMENT ON FUNCTION` is left without its text and `;`

Deliberately NOT checked: whether individual statements end in `;`
(multi-line statements never do, so it produces pure noise) and
whether `RAISE EXCEPTION` carries an ERRCODE (0001 onwards has always
omitted it on triggers, and the client maps on the message, not the
code).

Usage:
    python scripts/check-migrations.py                    # all migrations
    python scripts/check-migrations.py migrations/0024*.sql
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
MIGRATIONS = ROOT / "migrations"


class Report:
    def __init__(self) -> None:
        self.problems: list[str] = []

    def add(self, path: Path, line: int, msg: str) -> None:
        self.problems.append(f"{path.name}:{line}: {msg}")


def strip_comment(line: str) -> str:
    """Drop a trailing `--` comment that is not inside a quoted string."""
    out: list[str] = []
    i, in_str = 0, False
    while i < len(line):
        ch = line[i]
        if ch == "'":
            if in_str and line[i : i + 2] == "''":
                out.append("''")
                i += 2
                continue
            in_str = not in_str
        elif line[i : i + 2] == "--" and not in_str:
            break
        out.append(ch)
        i += 1
    return "".join(out)


def quote_parity(code: str) -> int:
    """Number of unpaired single quotes (0 = balanced)."""
    n, i = 0, 0
    while i < len(code):
        if code[i] == "'":
            if code[i : i + 2] == "''":
                i += 2
                continue
            n += 1
        i += 1
    return n % 2


def check(path: Path, rep: Report) -> None:
    raw = path.read_text(encoding="utf-8").splitlines()

    begins = sum(1 for l in raw if l.strip() == "BEGIN;")
    commits = sum(1 for l in raw if l.strip() == "COMMIT;")
    if begins != commits:
        rep.add(path, 0, f"BEGIN;({begins}) and COMMIT;({commits}) are unbalanced")

    # ---- 2 + 4: walk the file tracking dollar-quote and string state ----
    in_dollar = False
    dollar_open = 0
    quote_open = 0
    comment_open = 0  # line of a COMMENT ... IS with no text yet

    for n, line in enumerate(raw, 1):
        code = strip_comment(line)
        stripped = code.strip()

        if in_dollar:
            if "$$" in code:
                before, after = code.split("$$", 1)
                if before.strip() and not after.strip().startswith(";"):
                    rep.add(
                        path, n,
                        f"`$$` closes the body opened at line {dollar_open} but the "
                        f"statement is not terminated (`$$;` expected)",
                    )
                in_dollar = False
            continue

        if "$$" in code:
            before, after = code.split("$$", 1)
            if before.strip() == "" and after.strip().startswith(";"):
                continue  # a closer with nothing open — harmless
            in_dollar, dollar_open = True, n
            continue

        if quote_parity(code):
            if quote_open == 0:
                quote_open = n
            else:
                rep.add(
                    path, quote_open,
                    f"quoted string opened here is never closed; the statement runs on "
                    f"to line {n} (`{stripped[:50]}`) and the parser will blame that token",
                )
                quote_open = 0
        else:
            quote_open = 0

        # ---- 5: a COMMENT whose text was spliced away ----
        if re.match(r"^COMMENT\s+ON\s+FUNCTION\b", stripped, re.I) and not stripped.endswith(";"):
            comment_open = n
        elif comment_open and not stripped:
            continue
        elif comment_open:
            comment_open = 0

    if in_dollar:
        rep.add(path, dollar_open, "`$$` opened here is never closed")
    if quote_open:
        rep.add(path, quote_open, "quoted string opened here is never closed")
    if comment_open:
        rep.add(path, comment_open, "COMMENT ... IS has no quoted text and no `;`")

    # ---- 3: every PL/pgSQL function body ends with END; ----
    for n, line in enumerate(raw, 1):
        if not re.match(r"^\s*CREATE OR REPLACE FUNCTION", line):
            continue
        # The header, up to the opening dollar quote. `LANGUAGE sql` bodies
        # are a single SELECT and legitimately end with `);`, so the END;
        # rule only applies to plpgsql.
        # `raw` is 0-indexed and `n` is 1-indexed, so the CREATE line is
        # raw[n-1]. Search from there: `AS $$` is often on the same line
        # (`... RETURNS trigger AS $$`) and starting one line later misses it.
        opener = re.compile(r"AS\s+\$[A-Za-z_]*\$")
        j = n - 1
        while j < len(raw) and not opener.search(raw[j]):
            j += 1
        if j >= len(raw):
            rep.add(path, n, "function has no `AS $...$` — is it truncated?")
            continue
        tag = opener.search(raw[j]).group(0).split()[-1]
        # plpgsql may be declared before or after the body, so read the
        # whole definition rather than just the header.
        k = j + 1
        end = k
        while end < len(raw) and not raw[end].strip().startswith(tag):
            end += 1
        header = "\n".join(raw[n - 1 : end + 1])
        if "plpgsql" not in header.lower():
            continue
        if end >= len(raw):
            rep.add(path, n, f"function body opened at line {j + 1} is never closed")
            continue
        last = end - 1
        while last > j and not raw[last].strip():
            last -= 1
        if not raw[last].strip().upper().startswith("END"):
            rep.add(
                path, last,
                f"body of the function at line {n} ends with "
                f"`{raw[last].strip()[:40]}`, expected `END;`",
            )


def main(argv: list[str]) -> int:
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
    files = [Path(a) for a in argv[1:]] or sorted(MIGRATIONS.glob("*.sql"))
    rep = Report()
    for f in files:
        check(f, rep)

    if not rep.problems:
        print(f"ok  {len(files)} file(s): no structural problems found")
        return 0
    print(f"FAIL  {len(rep.problems)} problem(s):\n")
    for p in rep.problems:
        print(f"  {p}")
    return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
