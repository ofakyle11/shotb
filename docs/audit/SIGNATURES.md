# Signatures reference — the "do not reimplement" map

Verified against the WIP tree by a dedicated auditor. Order cards quote these
verbatim. **Load order is a hard runtime contract** — wave 1 added
throw-on-missing guards: `js/lib-money-math.js` → `js/lib-money-accounts.js` →
`js/lib-money-sheet.js` before finance/investors/producer consumers, and
`js/lib-scenes.js` before `casting/lib-castdesk.js` and `safety/lib-safety.js`.

## CScenes — `js/lib-scenes.js` (the scene substrate, store `SB_Scenes_v1`)

```
parse(text, opts?) → {scenes:[rec], preamble:rec|null, numbered:bool, pages, eighths}
  rec = {ord,number,n,label,key,sortKey,slug,raw,heading,location,tod,iu,
         continued,body:[line],text,lines,eighths}   label = printed number ('4A')
split(text) → [rec]            drop-in for every old splitScenes
sceneList(text) → [{n,ord,number,label,key,slug,location,tod,iu,eighths}]
parseSlug(line) → {number,base,suffix,prefixed,iu,location,tod,continued,slug,raw}|null
isSlug(line)→bool · splitDual(line)→[a,b]|null · eighthsOf(lines)→Number
byNumber(scenes,'4A')→rec|null · index(scenes)→{'4A':rec} · sortScenes(list)
normNum(v)→'4A' · keyWeight(v)→Number · parseSceneNums('1,4-6,8A')→['1','4','5','6','8A']
load()→store|null · save(store) · build(text,meta)→store · sync(text,meta) · list()
KEY='SB_Scenes_v1' · SLUG_RE · LINES_PER_PAGE=55
```

## Money substrate (all NEW; integer cents everywhere)

```
CMoneyMath (js/lib-money-math.js):
  num cents(v)→int dollars(c)→Number round(v,dp) roundHalfAway(x)
  mulCents(c,f) pctOfCents(c,pct) sumCents(list) sum add mul pct eq
  csvNum(v)→'0.00' csvWhole(v) fmt(v,{cents?})→'$1,234.56'
CBudgetSheet (js/lib-money-sheet.js — requires CMoneyMath, throws otherwise):
  itemEst/itemEstCents(it)      Amt×Units×Rate wins when all three >0, else est
  itemActual/itemActualCents · itemNeedsSync(it)→bool
  catCents/catTotals(cat)→{est,actual} · subtotal/subtotalCents(sheet)
  actualTotal/actualCents · byAcct/byAcctCents(sheet)→{acct:amount}
  laborBaseCents(sheet) · syncEst(sheet)→count   (MUTATES the sheet)
CAccounts (js/lib-money-accounts.js):
  get exists name(a) rollup(a)→major isLabor(a) forRole(role,kind)→acct
  forDept(dept) · MAJOR DETAIL · DEFAULT_CREW='5000' DEFAULT_CAST='4000'
  FRINGE_ACCT='20000' CONTINGENCY_ACCT='19000'
```

## TCore.Register — `tools/tools-core.js` (the shared table engine)

```
new TCore.Register(schema) — schema {key, hint?, fields:[{id,label,type?,options?,
  width?}], summary?(rows)→html, blank?()→row, expiryField?, flags?(row)}
r.add(row?)→row · r.remove(id) · r.update(id,field,value) · r.toCsv() (CSV-safe)
r.render(mountIdOrEl)  — needs a #tToast element on the page
TCore.$/load/save/uid/esc/fmtMoney/num/today/daysUntil/toast
Canonical consumer: tools/tools-registers.js. Known warts: type 'textarea'/
'money'/'number' all render text inputs; flags is dead code.
```

## CPost — `post/lib-post.js` (business-day dependency scheduler; PURE — no Date.now)

```
schedule(milestones, dateISO, 'forward'|'backward') →
  {rows:[{id,name,start,end,days,blockedBy,critical}], criticalPath, path, start, end}
  milestones [{id,name,days,after:[id]}]; falsy ⇒ template(). Cycle ⇒ {error:'cycle'}
template() · parseISO/fmtISO/isWeekend · snapBusiness(iso,dir) · addBusDays(iso,n)
busDiff(a,b) · versionName/nextVersion/addVersion · addBid/awardBid/lowBid
distReadiness(rows) · TEMPLATE STAGE_ABBR SERVICES DELIVERABLES
Actuals layer OVERLAYS (per-milestone days/after overrides, re-run) — never mutate.
```

## TSun — `tools/lib-sun.js`

```
sunTimes(date,lat,lon) → {dawn,sunrise,goldenEndAM,goldenStartPM,sunset,dusk} (ms-UTC)
fmtLocal(ms, tzOffsetMin?) — THE timezone hook; defaults to the BROWSER's offset.
  The location-tz fix belongs at the call sites (sched-weather.js:147,
  production/production.js:151), not inside the solar maths.
daylightHours(times) · weatherUrl(lat,lon,from,to) (Open-Meteo, timezone=auto)
wmoLabel(code) · shootRisk({precipProb,windMax,code})→0..100
```

## TMoney — `tools/lib-money.js`

```
timecard({rate,call:'HH:MM',wrap,mealsTaken,firstMealAtHr,dayOfWeek,prevWrap?,rules?})
  → {elapsed,worked,lines,penaltyLines,gross,penalties,fringes,fringePct,total}
  TC_DEFAULTS {otAfter:8,dtAfter:12,gtAfter:15,mealAfter:6,mealLenMin:30,
  mealPenaltySteps,turnaroundHrs:10,fringePct:0.28,sixthDayMult:1.5,seventhDayMult:2}
  OT on WORKED hours; DT/golden on ELAPSED. All thresholds via rules.
hoursBetween(a,b) (wraps midnight) · hotCost(postings,budgetByAcct)
instrumentWaterfall(lifetime,classes,deferrals)
```

## Editor — `editor/lib-mp4.js` (CMux), `editor/lib-cut.js` (CCut)

```
CMux.buildMp4(tracks)→Uint8Array   tracks [{type:'video'|'audio', timescale,
  durations[], sizes[], data, sync[]?, description, width,height|channels,sampleRate}]
CMux.parse/find/findAll
CCut: blank effDur starts duration videoAt(p,t) titlesAt audioAt split(p,t) move
  clampTrim tc(sec,fps)→'HH:MM:SS:FF' edl(p)→CMX3600 otio(p,srcMap) peaks
  assemble(p,sources,{handle,crossfade}) silences tighten beats cutToBeats
  cssFilter autoColor
assemble/split/tighten/cutToBeats MUTATE p.video and return counts.
```

## Sets 3D — `sets/lib-set3d.js` (CSet3D), `sets/gl.js` (CSetGL)

```
CSet3D: profileFor heightOf elevationOf colorOf · mat4 multiply perspective lookAt
  normalize cross sub dot orbitEye · itemMesh buildScene triangulate hexToRgb
  rayTriangle pick screenRay · lensFov(mm,vertical) (Super 35 24.89×18.66)
  cameraView(item,eyeHeightFt?) → {eye,target,fovY,lens}  ← look-through contract
  toOBJ toSTL
CSetGL.create(canvas,opts) → NULL when WebGL fails (load-bearing: 2D fallback),
  else {setPlan render pickAt select selected lookThrough lockedCamera frameAll
  view snapshot destroy}
```

## Casting — `casting/lib-castdesk.js` (requires CScenes first)

```
charactersFromScript(text)→[{name,scenes,lines,sceneList}]
sidesFor(text,character)→string (''), per-scene headers use sc.label ('4A')
cueName holdConflicts rangesOverlap offerLetter boardSummary STATUSES
```

## Investors / Festivals

```
CInvest: normalize owed capTable · allocate(pool,weights) sums EXACTLY to r2(pool)
  waterfall(investors,gross,opts) (fee+expenses→debt→gap→equity→50/50)
  breakeven (closed-form) · statement updateLetter
  budgetTotal(sheet) → delegates to CBudgetSheet.subtotal
CFest: strategy(premiereStatus) byTier searchLink newSub setResult feesTotal
  upcoming(subs, todayISO) — takes todayISO from CALLER, never Date.now()
  resultCounts newBuyer staleBuyers shiftISO screenersOut
```

## Safety / URL / test server

```
CinUrl.safe(v)→attribute-safe URL or '' · CinUrl.isSafe(v)→bool
  Output is already esc()'d — NEVER double-escape. esc() for text; jsq() for JS
  string literals (app.html only).
startServer(root,{timeoutMs}) → {server,port,base,stop}  (scripts/lib-testserver.mjs)
  Binds port 0, polls readiness. NEVER hardcode a port.
```
