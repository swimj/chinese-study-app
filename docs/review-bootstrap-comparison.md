# Review bootstrap prompt comparison

`scripts/review-bootstrap-comparison.ts` reuses the immutable bootstrap documents
from a saved five-word bootstrap lab report. It generates only ordinary review
content: no teaching regeneration, learner progress, database writes, or publication.

```sh
# Offline: inspect saved sources and baseline cues without provider requests.
node --import tsx scripts/review-bootstrap-comparison.ts \
  --source-report=/absolute/path/report.json \
  --output-dir=/absolute/path/new-comparison

# Live: explicitly make one review request per saved word, with no automatic retry.
# Use the source report's transport (local_proxy or direct).
APP_USE_LOCAL_PROVIDER_PROXY=true node --env-file=/absolute/path/.env --import tsx \
  scripts/review-bootstrap-comparison.ts \
  --source-report=/absolute/path/report.json \
  --output-dir=/absolute/path/new-live-comparison --live=true
```

The output directory must be separate from the source and fresh for a live run.
`comparison.html` shows old and new cues with answer/supplement disclosures;
`comparison.json` retains sources, prompt hashes, timings, validated cues and
invalid model output. Each word is saved before proceeding. Offline reruns can
re-render a matching saved comparison. Never publish provider credentials.

## Exploratory run, 2026-10-01

The revised prompt was tested with the same five saved HSK 6 bootstrap sources
and `gpt-5.6-luna` as the earlier experiment. All five calls passed the existing
schema and materialization checks, producing ten cues. No validation rules were
relaxed. Review-only latency was 4.59–7.35 seconds (mean 5.70 seconds). These five
calls are an exploratory sample, not a reliability or performance benchmark.

| Word | Review call | Example revised cue |
| --- | ---: | --- |
| 警告 | 6.89s | Warn drivers about a danger and urge them to slow down. / 警方____司机，前方道路已经结冰，请减速慢行。 |
| 交易 | 4.86s | a completed transaction involving payment / 这笔____已经完成了，钱也到账了。 |
| 撒谎 | 7.35s | A direct, confrontational warning telling someone not to say something untrue. / 你别____，我刚才明明看见你在门口。 |
| 子弹 | 4.79s | talking about how many rounds remain in a gun / 这把枪里还剩三发____。 |
| 客户 | 4.59s | a client asking about payment terms in a contract / 这位____对合同里的付款条款还有疑问。 |

The new sample uses shorter English framing and avoids the earlier Chinese
meta-instructions about what kind of answer to provide. Different contexts for
警告, 撒谎 and 子弹 broaden practice. All ten outputs are source-example clozes;
the schema still permits circumstances and definition glosses.

This does not establish that every cue is preferable. Ordinary alternatives
remain possible. The second 客户 cue reuses the source's coffee-shop example,
where 顾客 is also natural; cue authoring cannot by itself repair all editorial
choices in its immutable bootstrap source. Review reflection remains responsible
for reconsidering observed alternatives. The prompt change does not invalidate
existing content or trigger corpus regeneration.
