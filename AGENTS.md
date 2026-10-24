# Patch-note parsing

- Parse changes from document structure and shared semantic rules. Do not add branches, overrides, or replacement results keyed to a particular patch version, article URL, or one-off champion list.
- If a parsing defect reveals a patch-specific workaround, replace it with a general rule and cover the original case plus structurally equivalent cases from other versions.
- Entity catalogs may resolve names and metadata, but a missing catalog entry must not merge one entity's changes into the preceding entity.
- Keep original source values intact. Tests may use concrete patch fixtures; production parsing must not special-case those fixtures.
