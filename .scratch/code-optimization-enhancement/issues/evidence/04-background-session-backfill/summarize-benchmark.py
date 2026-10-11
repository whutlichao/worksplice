import hashlib
import json
import math
import platform
import random
import statistics
import subprocess
from pathlib import Path

EVIDENCE = Path(__file__).parent
BASE_COMMIT = "01369c574c6284dee6d6db54b3685c42451aa0de"
SOURCE_FILES = (
    "lib/agent-loop/loop.ts",
    "lib/agent-loop/backfill.test.mjs",
    "lib/agent-loop/driver.test.mjs",
)


def checked_bytes(args):
    try:
        return subprocess.run(args, check=True, capture_output=True).stdout
    except (OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(f"Command failed ({args[0]}): {error}") from error


def checked_output(args):
    return checked_bytes(args).decode().strip()


def read_rows(name):
    path = EVIDENCE / name
    try:
        return [json.loads(line) for line in path.read_text().splitlines()]
    except (OSError, json.JSONDecodeError) as error:
        raise SystemExit(f"Could not load benchmark rows from {path}: {error}") from error


def write_report(name, content):
    path = EVIDENCE / name
    try:
        path.write_text(content)
    except OSError as error:
        raise SystemExit(f"Could not write benchmark report {path}: {error}") from error


BASE = read_rows("baseline-raw.jsonl")
CAND = read_rows("candidate-raw.jsonl")
BASE_BARRIER = read_rows("baseline-barrier-raw.jsonl")
CAND_BARRIER = read_rows("candidate-barrier-raw.jsonl")


def percentile(values, p):
    ordered = sorted(values)
    return ordered[max(0, math.ceil(p * len(ordered)) - 1)]


def summary(values):
    values = [float(v) for v in values if v is not None]
    if not values:
        return {"n": 0, "median": None, "p90_nearest_rank": None, "mad": None, "stddev_sample": None, "min": None, "max": None}
    median = statistics.median(values)
    return {
        "n": len(values),
        "median": median,
        "p90_nearest_rank": percentile(values, 0.90),
        "mad": statistics.median([abs(v - median) for v in values]),
        "stddev_sample": statistics.stdev(values) if len(values) > 1 else 0.0,
        "min": min(values),
        "max": max(values),
    }


def bootstrap_median_ci(values, seed=407, samples=10000):
    rng = random.Random(seed)
    estimates = []
    for _ in range(samples):
        draw = [rng.choice(values) for _ in values]
        estimates.append(statistics.median(draw))
    return [percentile(estimates, 0.025), percentile(estimates, 0.975)]


steady = {}
for workload in ("small", "medium", "large"):
    baseline = [r for r in BASE if r["workload"] == workload and not r["warmup"]]
    candidate = [r for r in CAND if r["workload"] == workload and not r["warmup"]]
    b_start = summary([r["startReadyMs"] for r in baseline])
    c_start = summary([r["startReadyMs"] for r in candidate])
    b_scan = summary([r["scanMs"] for r in baseline])
    c_scan = summary([r["scanMs"] for r in candidate])
    b_recovery = summary([r["recoveryMs"] for r in baseline])
    c_recovery = summary([r["recoveryMs"] for r in candidate])
    start_diffs = [b["startReadyMs"] - c["startReadyMs"] for b, c in zip(baseline, candidate, strict=True)]
    scan_diffs = [b["scanMs"] - c["scanMs"] for b, c in zip(baseline, candidate, strict=True)]
    steady[workload] = {
        "input": {k: baseline[0][k] for k in ("agents", "sessionFiles", "actualBytesPerFile", "markerRoundsPerFile", "syntheticReplies")},
        "baseline": {"startReadyMs": b_start, "scanMs": b_scan, "recoveryMs": b_recovery, "yieldPoints": summary([r["yieldPoints"] for r in baseline])},
        "candidate": {
            "startReadyMs": c_start,
            "scanMs": c_scan,
            "recoveryMs": c_recovery,
            "yieldPoints": summary([r["yieldPoints"] for r in candidate]),
            "firstYieldMs": summary([r["firstYieldMs"] for r in candidate]),
            "lastYieldMs": summary([r["lastYieldMs"] for r in candidate]),
        },
        "medianStartReductionMs": statistics.median(start_diffs),
        "medianStartReductionPercent": 100 * (b_start["median"] - c_start["median"]) / b_start["median"] if b_start["median"] else None,
        "startReductionPairedBootstrap95CI": bootstrap_median_ci(start_diffs),
        "startNoiseThreshold3xMaxMADMs": 3 * max(b_start["mad"], c_start["mad"]),
        "medianScanReductionMs": statistics.median(scan_diffs),
        "scanReductionPairedBootstrap95CI": bootstrap_median_ci(scan_diffs, seed=408),
    }

barrier = {}
for side, rows in (("baseline", BASE_BARRIER), ("candidate", CAND_BARRIER)):
    measured = [r for r in rows if not r["warmup"]]
    barrier[side] = {
        "input": {k: measured[0][k] for k in ("agents", "sessionFiles", "actualBytesPerFile", "markerRoundsPerFile")},
        "startReadyMs": summary([r["startReadyMs"] for r in measured]),
        "barrierWaitMs": summary([r["barrierWaitMs"] for r in measured]),
        "recoveryAfterReleaseMs": summary([r["recoveryAfterReleaseMs"] for r in measured]),
        "requestedGateDelayMs": measured[0]["requestedGateDelayMs"],
    }

summary_data = {
    "baselineSamples": len([r for r in BASE if not r["warmup"]]),
    "candidateSamples": len([r for r in CAND if not r["warmup"]]),
    "baselineBarrierSamples": len([r for r in BASE_BARRIER if not r["warmup"]]),
    "candidateBarrierSamples": len([r for r in CAND_BARRIER if not r["warmup"]]),
    "steady": steady,
    "barrier": barrier,
    "environment": {
        "platform": platform.platform(),
        "machine": platform.machine(),
        "python": platform.python_version(),
        "node": checked_output(["node", "--version"]),
        "node_arch": checked_output(["node", "-p", "process.arch"]),
        "base_sha": checked_output(["git", "rev-parse", BASE_COMMIT]),
        "candidate_head_sha": checked_output(["git", "rev-parse", "HEAD"]),
        "candidate_diff_sha256": hashlib.sha256(
            checked_bytes(["git", "diff", "--binary", BASE_COMMIT, "--", *SOURCE_FILES])
        ).hexdigest(),
    },
}
write_report("benchmark-summary.json", json.dumps(summary_data, indent=2) + "\n")

lines = [
    "# Benchmark summary",
    "",
    f"Environment: {summary_data['environment']['platform']} / Node {summary_data['environment']['node']}",
    f"Base: `{summary_data['environment']['base_sha']}`; candidate diff SHA-256 `{summary_data['environment']['candidate_diff_sha256']}`.",
    "",
    "Steady-state synthetic backfill (30 measured samples per workload after one warmup; milliseconds):",
    "",
    "| Workload | Input (agents/files × KiB / rounds) | Baseline start median / P90 | Candidate start median / P90 | Baseline scan median / P90 | Candidate recovery median / P90 | Candidate yields median |",
    "|---|---:|---:|---:|---:|---:|---:|",
]
for name, data in steady.items():
    i = data["input"]
    b = data["baseline"]
    c = data["candidate"]
    lines.append(
        f"| {name} | {i['agents']}/{i['sessionFiles']} × {i['actualBytesPerFile']/1024:.1f} / {i['markerRoundsPerFile']} | "
        f"{b['startReadyMs']['median']:.3f} / {b['startReadyMs']['p90_nearest_rank']:.3f} | "
        f"{c['startReadyMs']['median']:.3f} / {c['startReadyMs']['p90_nearest_rank']:.3f} | "
        f"{b['scanMs']['median']:.3f} / {b['scanMs']['p90_nearest_rank']:.3f} | "
        f"{c['recoveryMs']['median']:.3f} / {c['recoveryMs']['p90_nearest_rank']:.3f} | "
        f"{c['yieldPoints']['median']:.0f}"
        " |"
    )
lines += ["", "Dispersion: report JSON includes MAD, sample standard deviation, min/max for every metric.", "", "Barrier/gate synthetic subtest (30 measured samples after one warmup; baseline has no asynchronous gate, candidate gate requested 3 ms):", "", "| Side | start-ready median / P90 | measured barrier wait median / P90 | recovery-after-release median / P90 |", "|---|---:|---:|---:|"]
for side in ("baseline", "candidate"):
    d = barrier[side]
    lines.append(f"| {side} | {d['startReadyMs']['median']:.3f} / {d['startReadyMs']['p90_nearest_rank']:.3f} | {d['barrierWaitMs']['median']:.3f} / {d['barrierWaitMs']['p90_nearest_rank']:.3f} | {d['recoveryAfterReleaseMs']['median']:.3f} / {d['recoveryAfterReleaseMs']['p90_nearest_rank']:.3f} |")
lines += ["", "Medium decision: median start reduction = {:.3f} ms ({:.1f}%), paired-bootstrap 95% CI {}, noise threshold 3×max(MAD) = {:.3f} ms; baseline/candidate P90 = {:.3f}/{:.3f} ms.".format(
    steady["medium"]["medianStartReductionMs"],
    steady["medium"]["medianStartReductionPercent"],
    steady["medium"]["startReductionPairedBootstrap95CI"],
    steady["medium"]["startNoiseThreshold3xMaxMADMs"],
    steady["medium"]["baseline"]["startReadyMs"]["p90_nearest_rank"],
    steady["medium"]["candidate"]["startReadyMs"]["p90_nearest_rank"],
), ""]
write_report("benchmark-summary.md", "\n".join(lines))
print("\n".join(lines))
