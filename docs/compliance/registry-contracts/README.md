# Official registry file contracts

These retained CER and NSW government documents define the supported CSV columns. `sources.json` records their official URLs, retrieval times and exact byte hashes. `schemas.json` is the runtime field transcription, reproduced by `extract-contracts.py` from the retained PDF, DOCX and XLSX files. The extraction script needs Python with `pdfplumber`, `python-docx` and `openpyxl`.

| Format | Columns | Maximum records |
| --- | ---: | ---: |
| REC small generation units | 146 | 250 |
| REC solar water heaters and air source heat pumps | 65 | 250 |
| REC solar batteries | 140 | 250 |
| TESSA ESS | 51 | 3,000 |
| TESSA PDRS | 44 | 3,000 |

`creditex-registry-formats.ts` preserves exact header order, validates documented required fields and supported conditional rules, and serialises canonical CRLF CSV. It does not calculate statutory eligibility, approve products or installers, establish rights assignment, verify current rule applicability, or transmit a claim. Those checks remain governed claim and independent export review responsibilities. No supported file contains a certificate quantity column; savings, system capacity and energy values must never be treated as certificate quantities.

The submission workspace binds `Reference` for REC or `ACP Implementation Identifier` for TESSA to the exact approved claim packet. TESSA accreditation and base vintage are batch metadata chosen outside the CSV. A completed file receives a separate independent review because its field values are additional to the original claim packet.

## Retained source ambiguity

TESSA CSV specification v1.7 contradicts itself for the PIAMV operating measurement dates: it requires the start to follow the end and the end to follow the start. An export that supplies both affected fields is blocked with `SOURCE_CONTRACT_CONFLICT` until an authoritative corrected contract is obtained. Other methods remain available.

The SWH source prints `Decimal(3,9)` for coordinates while the related SGU source uses `Decimal(12,9)`. The validator applies the unambiguous nine decimal place limit and valid latitude/longitude range; it does not invent an interpretation for a total precision smaller than its scale.

Run `node --experimental-strip-types --test test/creditex-registry-formats.test.mjs` to verify source hashes, exact columns, CSV round trips, record ceilings and the implemented validation boundaries. Updating the official contracts requires reviewing the retained sources, transcription, validator and tests together.
