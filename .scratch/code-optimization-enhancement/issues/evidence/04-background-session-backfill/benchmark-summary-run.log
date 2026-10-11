# Benchmark summary

Environment: macOS-26.5.1-x86_64-i386-64bit-Mach-O / Node v25.0.0
Base: `01369c574c6284dee6d6db54b3685c42451aa0de`; candidate diff SHA-256 `151e57863d64e61aa1c1ddb891b5cf0f578d251367ebc82e5cc7c9a773d6dae9`.

Steady-state synthetic backfill (30 measured samples per workload after one warmup; milliseconds):

| Workload | Input (agents/files × KiB / rounds) | Baseline start median / P90 | Candidate start median / P90 | Baseline scan median / P90 | Candidate recovery median / P90 | Candidate yields median |
|---|---:|---:|---:|---:|---:|---:|
| small | 2/2 × 64.1 / 20 | 3.672 / 4.278 | 0.077 / 0.107 | 3.753 / 4.365 | 4.230 / 4.585 | 0 |
| medium | 8/8 × 256.1 / 64 | 61.432 / 65.233 | 0.113 / 0.128 | 61.777 / 65.597 | 64.050 / 70.699 | 24 |
| large | 12/12 × 512.3 / 128 | 283.546 / 288.949 | 0.118 / 0.134 | 284.341 / 289.711 | 307.485 / 323.645 | 84 |

Dispersion: report JSON includes MAD, sample standard deviation, min/max for every metric.

Barrier/gate synthetic subtest (30 measured samples after one warmup; baseline has no asynchronous gate, candidate gate requested 3 ms):

| Side | start-ready median / P90 | measured barrier wait median / P90 | recovery-after-release median / P90 |
|---|---:|---:|---:|
| baseline | 1.918 / 2.166 | 3.208 / 3.906 | 0.000 / 0.000 |
| candidate | 0.077 / 0.117 | 3.924 / 4.106 | 2.630 / 2.932 |

Medium decision: median start reduction = 61.319 ms (99.8%), paired-bootstrap 95% CI [60.793916999999965, 62.062416500000154], noise threshold 3×max(MAD) = 2.643 ms; baseline/candidate P90 = 65.233/0.128 ms.
