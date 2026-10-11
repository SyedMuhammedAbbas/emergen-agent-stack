#!/usr/bin/env bash
# Compare live agents (:3100) with the round-tripped copy (:3199), keyed by name, ids/paths normalised.
LIVE=localhost:3100; SCR=localhost:3199
LC=$(curl -s $LIVE/api/companies | jq -r '.[0].id'); SC=$(curl -s $SCR/api/companies | jq -r '.[0].id')
norm='[.[]|{key:.name,val:{role,title,adapterType,budgetMonthlyCents,icon,metadata,permissions,runtimeConfig,
  model:.adapterConfig.model, env:.adapterConfig.env, engine:.adapterConfig.engine, timeoutSec:.adapterConfig.timeoutSec,
  skills:(.adapterConfig.paperclipSkillSync.desiredSkills|map(sub("^company/[^/]+/";"company/X/"))|sort),
  adapterConfigKeys:(.adapterConfig|keys)}}]|from_entries'
curl -s $LIVE/api/companies/$LC/agents | jq -S "$norm" > /tmp/m0-live.json
curl -s $SCR/api/companies/$SC/agents | jq -S "$norm" > /tmp/m0-scr.json
echo "only in live:    $(jq -n --slurpfile a /tmp/m0-live.json --slurpfile b /tmp/m0-scr.json '($a[0]|keys)-($b[0]|keys)' -c)"
echo "only in scratch: $(jq -n --slurpfile a /tmp/m0-live.json --slurpfile b /tmp/m0-scr.json '($b[0]|keys)-($a[0]|keys)' -c)"
for f in role title adapterType budgetMonthlyCents icon metadata permissions runtimeConfig model env engine timeoutSec skills adapterConfigKeys; do
  jq -n --arg f $f --slurpfile a /tmp/m0-live.json --slurpfile b /tmp/m0-scr.json \
   '[($a[0]|keys[]) as $k | select($b[0][$k]!=null) | select($a[0][$k][$f]!=$b[0][$k][$f]) | $k] | "\($f): \(length) differ \(.)"' -r
done
