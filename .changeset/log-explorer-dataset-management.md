---
"@cloudflare-ai-toolkit/sdk": minor
"@cloudflare-ai-toolkit/cli": minor
"@cloudflare-ai-toolkit/mcp": minor
---

Add full Log Explorer dataset management across SDK, CLI, and MCP.

- **SDK**: new methods on `CloudflareClient` — `listLogExplorerDatasets(params?, overrides?)` (with `includeZones`), `listAvailableLogExplorerDatasets(params?, overrides?)` (dataset types, schemas, timestamp fields), `getLogExplorerDataset`, `updateLogExplorerDataset` (enable/disable ingest, field allowlist, Logpush filter set/clear, deletion protection), and `deleteLogExplorerDataset`. `LogExplorerDataset` now types `fields`, `filter`, and `deletion_protection`; adds `LogExplorerDatasetField` and `AvailableLogExplorerDataset` schemas plus permission hints (`Logs Read` for dataset reads, `Logs Edit` for update/delete).
- **CLI**: new `cloudflare log-explorer datasets list [--includeZones]`, `datasets available`, `datasets get <dataset-id>` (prints enabled/disabled field checklist and filter), `datasets update <dataset-id> --enabled true|false [--fields a,b] [--filter expr] [--deletionProtection bool]`, and `datasets delete <dataset-id> [--yes]` with interactive confirmation that refuses to run non-interactively without `--yes`. `get`/`update`/`delete` address datasets by the `dataset_id` shown by `datasets list`.
- **MCP**: new `list_log_explorer_datasets`, `list_available_log_explorer_datasets`, `get_log_explorer_dataset`, `update_log_explorer_dataset`, and `delete_log_explorer_dataset` tools.
