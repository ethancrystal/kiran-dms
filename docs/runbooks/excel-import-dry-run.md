# Runbook — Excel import dry-run (P0-02, Gate 0 criterion 2)

The dry-run reads the owner's salon sheet, checks every row against the salon fields in doc 04, and prints a report. **It writes nothing to any database.** The real import comes with the salon tables in P1-02 and reuses the same checks.

## Never commit the file or the report (H-03)

- Keep the Excel file **outside the repository folder** (for example in `Documents`). The tool warns if the file is inside the repo.
- The report never prints salon names, contact names, addresses or full phone numbers. Problems point at spreadsheet row numbers, and phones are masked (`03xx-xxx-1234`).
- `--json` writes the same masked report to `import-reports/`, which git ignores. Do not commit or upload it anyway.

## Run it

From the repository root:

```bash
pnpm -C packages/import dry-run "C:/Users/<you>/Documents/salons.xlsx"
```

Options:

| Option | Use |
|---|---|
| `--sheet "Name"` | Read a sheet other than the first |
| `--mapping map.json` | Say which column is which, when the guess is wrong: `{"name": "Dukan", "area": "Ilaqa", "phone": "Mobile"}` |
| `--areas areas.txt` | The area list (one per line; `area,territory` also works). Areas not on it become warnings (P0-03) |
| `--json` | Also write the masked report to `import-reports/` |
| `--max-issues N` | How many errors and warnings to print (default 200) |

Old `.xls` files are refused: open them in Excel and Save As `.xlsx` or `.csv`.

Exit code: `0` clean, `1` not clean, `2` the file or an option could not be read.

## What "clean" means (Gate 0 criterion 2)

The result is **CLEAN** when the file has at least one data row, both required columns are present (salon name and area), and **no row has an error**. Warnings do not stop it.

| Errors: block the import | Warnings: imported with a flag |
|---|---|
| No column for salon name or area; a mapping that names a missing column | Salon type not recognised (imported as `other`) |
| Salon name empty, or not 2 to 120 characters | No phone (the salon cannot be verified, CTL-09, until one is added) |
| Area empty (every salon needs an area for its territory, SAL-02) | Landline number (cannot receive the verification OTP) |
| A phone that is not a valid Pakistani number, contains letters, or was turned into a number by Excel (`3.99E+09`) | The same phone on more than one salon (CTL-18) |
| Chairs not a whole number from 1 to 200 | Same salon name in the same area (possible duplicate row) |
| Latitude without longitude, or not a valid coordinate | Pin outside Karachi, or latitude and longitude swapped |
| Opening balance that is not a rupee figure (`12,500`, `Rs 4500.50`, `2,000/-` and `(1,500)` are fine) | Negative opening balance (the salon is in credit: the manager decides before go-live) |
| Contact name longer than 120 characters | Area not on the `--areas` list |

How values are read:

- **Phones:** `0399-0000001`, `+92 399 0000001`, `3990000001` (Excel dropped the zero) all become `+923990000001`. Several numbers in one cell (`/`, `,` or `;`) are all kept; the first is the main contact.
- **Opening balance:** rupees to whole paisa, never a decimal number. In P1-02 each balance becomes an "opening invoice" row that the manager reconciles with the salon before go-live (doc 11, risks).
- **Type:** words like "Ladies Beauty Parlour", "Gents", "Bridal", "Home Parlour" or "Academy" map to the doc 04 types.
- **Header row:** the row that names the most known columns among the first 20, so a title line above the header is fine. Column names the tool recognises are in `packages/import/src/core/mapping.ts`.

## After a clean run

Paste the summary lines (result, row counts, areas and opening-balance total) into a `PROGRESS` entry in `docs/ACTIVITY.md`, never the file itself. The area list it prints is the input for the territory draft (P0-03).
