# Private Origin regression fixture

The Origin file regression and typed/compatibility parser parity checks always
run. Provision the existing private fixture at `.local-fixtures/origin-demo.csv`
in the checkout, or set `NEM12_FIXTURE` to its absolute path before `npm test`.
An absent file is a test failure with a provisioning instruction, never a skip.

The restored fixture has SHA-256
`29b550a154c1db1d09036d2c55675fb1afe6266180225c2dc70fdea95cfd30a0`.
It retains the original ten days, interval readings and out-of-order records.
The tests retain the original annualised usage and full parser-parity assertions.

`.local-fixtures/` is ignored by Git. Keep this meter-data file out of commits,
release archives and public downloads. CI must provision the private fixture
through its existing protected file mechanism or `NEM12_FIXTURE` environment
variable; the file is deliberately not distributed with the source repository.
