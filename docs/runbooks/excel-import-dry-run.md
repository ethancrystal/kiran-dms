# Runbook — Excel import dry-run (P0-02, Gate 0 criterion 2)

The dry-run reads the owner's salon sheet, checks every row against the salon fields in doc 04, and prints a report. **It writes nothing to any database.** The real import comes with the salon tables in P1-02 and reuses the same checks.

## Never commit the file or the report (H-03)

- Keep the Excel file **outside the repository folder** (for example in `Documents`). The tool warns if the file is inside the repo.
- The report never prints salon names, contact names, addresses or full phone numbers. Problems point at spreadsheet row numbers, and phones are masked (`03xx-xxx-1234`). A column's heading is printed only when it is made of ordinary heading words ("Salon Name", "Owner Mobile"); any other heading is shown as its column letter ("column C"), because it may be a data row read as the header.
- The **Areas** list in the report prints each area exactly as written in the sheet. Keep the area column to locality names ("Gulshan Block 13"); put street addresses in the address column, which is never printed.
- `--json` writes the same masked report to `import-reports/`, which git ignores. Do not commit or upload it anyway.

## Run it

From the repository root:

```bash
pnpm -C packages/import dry-run "C:/Users/<you>/Documents/salons.xlsx"
```

Options:

| Option | Use |
|---|---|
| `--sheet "Name"` | Read this sheet. Without it, the tool reads the first **visible** sheet, skips hidden ones, and prints which sheet it read |
| `--mapping map.json` | Say which column is which, when the guess is wrong: `{"name": "Dukan", "area": "Ilaqa", "phone": "Mobile"}` |
| `--areas areas.txt` | The area list (one per line; `area,territory` also works). Areas not on it become warnings (P0-03) |
| `--json` | Also write the masked report to `import-reports/` |
| `--max-issues N` | How many errors and warnings to print (default 200) |

Old `.xls` files are refused: open them in Excel and Save As `.xlsx` or `.csv`. A `.txt` file is read as CSV (comma, semicolon or tab separated). A CSV with a quote mark that is opened and never closed is refused, naming the line, because it would otherwise swallow every later row into one cell.

Exit code: `0` clean, `1` not clean, `2` the file or an option could not be read.

## What "clean" means (Gate 0 criterion 2)

The result is **CLEAN** when the file has at least one data row, both required columns are present (salon name and area), and **no row has an error**. Warnings do not stop it.

| Errors: block the import | Warnings: imported with a flag |
|---|---|
| No column for salon name or area; a mapping that names a missing column; two columns with the same heading (rename one) | Salon type not recognised (imported as `other`) |
| Salon name empty, or not 2 to 120 characters | No phone (the salon cannot be verified, CTL-09, until one is added) |
| Area empty (every salon needs an area for its territory, SAL-02) | Landline number (cannot receive the verification OTP) |
| A phone that is not a valid Pakistani number, contains letters, or was turned into a number by Excel (`3.99E+09`) | The same phone on more than one salon (CTL-18) |
| Chairs not a whole number from 1 to 200 | Same salon name in the same area (possible duplicate row) |
| Latitude without longitude, or not a valid coordinate | Pin outside Karachi, or latitude and longitude swapped |
| Opening balance that is not a rupee figure (`12,500`, `Rs 4500.50`, `2,000/-` and `(1,500)` are fine) | Negative opening balance (the salon is in credit: the manager decides before go-live) |
| Contact name longer than 120 characters | Area not on the `--areas` list |
| A cell holding an Excel error (`#N/A`, `#REF!`, `#VALUE!`, ...), or a formula with no saved result | |
| A mobile number with a digit missing or extra (`0399-000000`) | |
| An amount with both brackets and a minus sign (`(-1,000)`) | |

How values are read:

- **Phones:** `0399-0000001`, `+92 399 0000001`, `3990000001` (Excel dropped the zero) all become `+923990000001`. Several numbers in one cell (`/`, `,` or `;`) are all kept; the first is the main contact. Every column whose heading names a phone ("Mobile", "Contact Mobile", "Owner Mobile", "WhatsApp No") is checked; the first is the main phone column.
- **Opening balance:** rupees to whole paisa, never a decimal number. Thousands grouping (`125,000`) and lakh grouping (`1,25,000`) are both read. A formula result such as `1650.0000000000002` is read as Excel shows it (1,650). In P1-02 each balance becomes an "opening invoice" row that the manager reconciles with the salon before go-live (doc 11, risks).
- **Type:** words like "Ladies Beauty Parlour", "Gents", "Bridal", "Home Parlour" or "Academy" map to the doc 04 types. A label naming both ladies and gents ("Ladies & Gents Salon") is unisex. "Hair Studio" is a hair studio; another studio ("Nail Studio") is not recognised and imports as other with a warning.
- **Header row:** among the first 20 rows, the one that names the most known columns, if it names at least two (a title line above the header is fine). With `--mapping`, the columns the mapping names count too, so headers the tool does not know ("Dukan", "Ilaqa") are found. If no row qualifies, the first row with two filled cells is taken as the header. Column names the tool recognises are in `packages/import/src/core/mapping.ts`.

## After a clean run

Paste the summary lines (result, row counts, areas and opening-balance total) into a `PROGRESS` entry in `docs/ACTIVITY.md`, never the file itself. The area list it prints is the input for the territory draft (P0-03).
