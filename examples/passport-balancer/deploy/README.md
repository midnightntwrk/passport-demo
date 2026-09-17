# deploy

The unit files and the reverse-proxy config for the sponsor droplet
(`67.205.177.162`, served as `67-205-177-162.sslip.io`).

- `passport-balancer.service` — the balancer itself.
- `passport-balancer-watchdog.{service,timer,sh}` — the supervisor: it probes
  the whole path every minute and restarts what has stopped answering. See
  **The supervisor** below.
- `Caddyfile` — the earlier proxy config, kept for reference.
- `Caddyfile.stagenet` — the live config. **This is the one installed.**

---

## The 1AM gateway API key

`Caddyfile.stagenet` forwards `/prover/*` to the 1AM stagenet proof gateway
first and falls back to our own proof server. The gateway wants an `x-api-key`
header, which the config reads as `{$ONE_AM_API_KEY}`.

The key is **not** in this repository. It lives on the droplet in
`/etc/caddy/1am.env`, mode `600`, owned by `root`, and reaches Caddy through the
systemd drop-in `/etc/systemd/system/caddy.service.d/10-1am-env.conf`:

```ini
[Service]
EnvironmentFile=-/etc/caddy/1am.env
```

To set or rotate the key:

```sh
echo 'ONE_AM_API_KEY=<key>' > /etc/caddy/1am.env
systemctl reload caddy
```

A reload is enough, and a restart is worth avoiding: `ExecStart` carries
`--environ`, so restarting Caddy writes the whole environment — the key with it
— into the journal.

The reload works because the config uses `{$ONE_AM_API_KEY}`, which the
Caddyfile adapter substitutes when it reads the file, and `ExecReload` is a
fresh `caddy reload` process that systemd has just handed the environment file.
The runtime form `{env.ONE_AM_API_KEY}` would **not** work here: the long-lived
server process resolves it against the environment it was started with, so a new
key would need a full restart.

An empty value is safe. The gateway serves anonymous callers at a lower rate
limit, and it answers an empty `x-api-key` exactly as it answers no header at
all — so the config is valid, and the proxy works, before anyone fills the file
in.

---

## Installing

```sh
install -m 644 deploy/Caddyfile.stagenet /etc/caddy/Caddyfile
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

`/prover-local/*` reaches our own proof server directly, bypassing the gateway.

`/prover-v3/*` reaches the same process under a different name, and the name is
the point. `/prover-local` answers "this box rather than the gateway", which is
an operational question; `/prover-v3` answers "an image that can prove ZKIR v3",
which is a capability. The `account-k1` build is compiled with
`--feature-zkir-v3`, and neither `/prover` (the 1AM gateway first, which is
`ledger9-zkir2-dispatch`) nor the demo's in-tab prover (`@midnight-ntwrk/zkir-v2`)
can prove those circuits at all. The demo reads this address as
`VITE_MIDNIGHT_PROVING_URL_V3`, for that one module; nothing asks for it yet.
Added 2026/09/16, validated with `caddy validate` and applied with
`systemctl reload caddy`.
It is the quickest way to tell which of the two answered a request: the gateway
returns `500` with a JSON body and Cloudflare headers, ours returns `400` with
`text/plain`.

### The k1-arm account build on the droplet (2026/09/16)

The sponsor can now pay an opening balance into a third build of the account
contract, `account-k1` — the k1-arm reference contract — and two things have to
be on the droplet before it can. **The artefacts**: only the module
(`contract/`, `compiler/`) travels in git, exactly as for `account` and
`account-v1`; `contracts-stagenet/managed/account-k1/{keys,zkir}` is in no
release bundle and has to be rsynced onto the host beside the other builds, or
put somewhere else and named with `BALANCER_ACCOUNT_K1_ASSETS`. Measure before
you rsync: that `keys/` is **3.2 GB** against the 110 MB of the whole bundle.
**The prover**: those circuits are ZKIR v3, and neither route the sponsor
already has can prove them — `BALANCER_PROVER_URL` puts the 1AM gateway first
and the gateway is `ledger9-zkir2-dispatch`, and the in-process fallback is
`@midnight-ntwrk/zkir-v2`. Set `BALANCER_PROVER_URL_V3=http://127.0.0.1:6300`
in the service's env file, which is the droplet's own proof server
(`proof-server:9.0.0-rc.6`, the process behind `/prover-v3`). There is no
default and nothing is guessed: with the variable unset the sponsor starts
normally, logs `[account] account-k1 artefacts …, but NO PROVER: …` once, and
refuses a k1 grant with `503 prover-unavailable` without building or spending
anything. Neither variable changes anything for `account` or `account-v1`,
whose proof route is untouched.

### Turning on `POST /prove-k1` (2026/09/16)

`/prove-k1` is the server half of proving for a Dynamic-only Passport. The k1
build's prover keys are 112 MB for `append_inbox_with_k256`, 224 MB for the
largest of them, and 3.2 GB for the set. `httpClientProofProvider` — the client
every other part of this demo proves through — uploads the prover key with every
request, so a browser cannot carry this traffic to a proof server at all,
however healthy that server is. The client therefore posts the serialised
unproven transaction and the circuit's name to this service, which holds the
keys on disk, and gets the proven transaction back.

**The route is always there.** With no artefacts or no `BALANCER_PROVER_URL_V3`
it answers `503 prover-unavailable` with a sentence naming what is missing. It
is deliberately not made to disappear when unconfigured: a missing route answers
`404`, which is also what Caddy answers for a path it does not know, and the
client would have no way to tell "this droplet has not been set up" from "this
URL is wrong".

It takes **the same two settings as the k1 grant above and nothing else** —
there is no third variable, and a droplet already set up for `account-k1`
deposits is already set up for this.

#### The steps

1. **Stage the artefacts.** They are already on the droplet at
   `/opt/passport-k1-artefacts/managed/account-k1`. To put them there from a
   machine that has built them:

   ```sh
   rsync -a --info=progress2 \
     contracts-stagenet/managed/account-k1/ \
     root@<droplet>:/opt/passport-k1-artefacts/managed/account-k1/
   ```

   `keys/`, `zkir/`, `contract/`, and `compiler/` — all four. `compiler/` is not
   optional: `NodeZkConfigProvider` checks every artefact it reads against
   `compactc`'s integrity manifest, which is the one thing that tells a
   half-finished rsync from a working one before a proof starts. Check the free
   space first (`df -h /opt`); this is 3.2 GB.

   The unit runs with `ProtectSystem=strict`, so `/opt` is mounted read-only for
   the service. That is correct and needs no `ReadWritePaths` entry — the route
   only ever reads these files.

2. **Set the two variables.** Either in `/etc/passport-balancer.env` or as
   `Environment=` lines in the unit; the unit is the better place, because it is
   in this repository and the env file is not:

   ```ini
   Environment=BALANCER_ACCOUNT_K1_ASSETS=/opt/passport-k1-artefacts/managed/account-k1
   Environment=BALANCER_PROVER_URL_V3=http://127.0.0.1:6300
   ```

   `BALANCER_PROVER_URL` is **not** one of them and must not be changed: it puts
   the 1AM gateway first, the gateway is `ledger9-zkir2-dispatch`, and these
   circuits are ZKIR v3.

3. **Deploy the way every other change to this service is deployed** — back up
   first, then restart:

   ```sh
   rsync -a src/ dist/ package.json root@<droplet>:/opt/passport-balancer/
   rsync -a deploy/ root@<droplet>:/opt/passport-balancer/deploy/
   ssh root@<droplet> '
     cp -a /opt/passport-balancer/dist /opt/passport-balancer/dist.bak.$(date +%Y%m%d-%H%M%S)
     install -m 644 /opt/passport-balancer/deploy/passport-balancer.service \
       /etc/systemd/system/
     systemctl daemon-reload && systemctl restart passport-balancer'
   ```

   The service saves its sync snapshot on `SIGTERM`, so the restart resumes in
   under a second rather than walking the chain again. Nothing about
   `/balance-only`, `/register-alias`, `/fund-account`, `/swap`, or `/gift-nft`
   changes; if the restart goes wrong, `dist.bak.*` is the thing to put back.

4. **Check it from outside**, which is where the client is:

   ```sh
   curl -s https://67-205-177-162.sslip.io/balancer/status \
     | python3 -c 'import json,sys; print(json.load(sys.stdin)["k1Proving"])'
   ```

   `configured` true is the whole answer. The same block carries `queueDepth`,
   `proofsServed`, `lastProofMs`, and `lastError` — the last of these with this
   host's paths and prover URL replaced by `<k1-assets>` and `<k1-prover>`,
   because `/status` is on the internet. A refusal that names a circuit reads
   the same way in the journal, under `[prove-k1]`.

#### The limits it runs under, and why

| | |
| --- | --- |
| **One at a time** | A k256 proof is seconds to tens of seconds on two vCPUs that are also proving every name claim and every activation grant. Four callers may wait; the fifth is answered `429 PROVING_BUSY` with a `retryAfterMs` built from this service's own last measured proof. |
| **180 s per proof** | Past that the caller gets `504 proving-timeout`. The slot stays claimed until the abandoned proof actually ends, so nothing starts beside it. |
| **3/min per client** | `BALANCER_PROVE_K1_MAX_PER_MIN` and `BALANCER_PROVE_K1_BURST`, the same defaults as the spend routes. Its own bucket, not the grant bucket: a caller that has spent its grant allowance must still be able to finish proving the Passport that allowance opened. |
| **2 MB per transaction** | And the 4 MiB body ceiling the whole service already reads through. |
| **No spend slot** | `/prove-k1` holds no `SpendAdmission` slot and is not refused by a DUST repair, because it spends nothing. |
| **Key material per request** | The ZK config provider is built for one proof and dropped: reading `append_inbox_with_k256.prover` off the staged artefacts measured 459 ms and 266 MB RSS on 2026/09/16. Kept between requests it would hold every prover key it had ever served — 3.2 GB on a box with 8 GB that is also holding the sponsor's wallet. |

#### Recommended: a second proof server for k1 (not done here)

Today `BALANCER_PROVER_URL_V3` is `http://127.0.0.1:6300`, which is the **same**
proof server that Caddy's `/prover-v3` and the local fallback for `/prover` both
reach. So a 224 MB k1 circuit and a sponsor's own `deposit_night` queue against
each other inside one twelve-slot server on two vCPUs, and a name claim can end
up waiting behind somebody's Dynamic onboarding.

The fix is a second container on its own port, used by this variable alone:

```sh
docker run -d --name passport-proof-server-k1 \
  --restart unless-stopped \
  -p 127.0.0.1:6301:6300 \
  --memory 4g --cpus 1.5 \
  midnightnetwork/proof-server:9.0.0-rc.6 \
  midnight-proof-server --network testnet
```

then `Environment=BALANCER_PROVER_URL_V3=http://127.0.0.1:6301` and a restart.
The supervisor's probe table would gain a row for it
(`GET http://127.0.0.1:6301/health`, and `docker inspect
passport-proof-server-k1`), restarted like the first one.

**This is a recommendation and it has not been done.** It is two containers'
worth of memory on an 8 GB box, so it wants measuring under a real walk before
anybody commits to it — and the sponsor's own proving is the traffic that must
not regress, which is an argument for doing it and also a reason not to do it
blind on a droplet that is serving production.

---

## The supervisor

`passport-balancer-watchdog.sh` runs from `passport-balancer-watchdog.timer`
**every minute**. It began as a restarter for one service and is now the
supervisor for the whole sponsor stack, because on 2026/09/05 the balancer was
alive and unable to submit for five hours and nothing restarted it.

### What it checks, every tick

| Probe | Healthy is |
| --- | --- |
| `GET http://127.0.0.1:8807/status` | `synced` true; `nodeSocket` `connected` (or the key absent); `consecutiveSocketFailures` under 3; `aliasSponsorship` and `accountFunding` `available`; `proving` `server`; `appliedBehindHeadBlocks` at most 50 where it is published |
| `GET http://127.0.0.1:6300/health` | `200` — the proof server itself |
| `docker inspect passport-proof-server` | `.State.Running` is `true` |
| `systemctl is-active caddy` | `active` |
| `GET https://67-205-177-162.sslip.io/balancer/status` | `200` — through Caddy, resolved to the loopback so the probe measures our Caddy rather than DNS |
| `GET https://67-205-177-162.sslip.io/prover/health` | `200`, unless the proof server behind it is itself down |
| `GET https://67-205-177-162.sslip.io/prover-v3/health` | `200`. The droplet's own proof server, which is what answers ZKIR v3. |

`/status` is read with `python3`, not `grep`: three of those terms are numbers,
and a `grep` for `"synced":true` cannot tell a missing key from a false one.
Every request has a five-second budget and the whole tick finishes well inside
thirty seconds.

The three older legs are unchanged and still asked first, each on its own
signature: the DUST wedge, a spend job that has gone silent while holding a
lane, and a dead submission socket. They are named faults with known repairs;
the supervisor is the general case behind them.

### What it restarts

| Reading | Action |
| --- | --- |
| `/status` unhealthy for 3 consecutive ticks | `systemctl restart passport-balancer` |
| Caddy `active` but the public path fails while the local probes pass | `systemctl reload caddy` |
| Caddy not `active` | `systemctl restart caddy` |
| Container not running, or `/health` failing, for 3 ticks | `docker restart passport-proof-server` |

At most one restart per tick, front door first. Two rules bound all of them:

- **Nothing is restarted while a spend is in flight.** `busy` or
  `jobsRunning > 0` holds every restart until the unhealthy streak reaches ten
  ticks, at which point the job is not in flight, it is stuck.
- **Every unit carries its own exponential backoff** — 10 min, 20, 40, capped
  at 2 h — so a dependency that is genuinely down cannot be turned into a
  restart loop. Half an hour of health forgets the ladder.

A unit is also given a two-minute grace after any restart, during which nothing
strikes it: a service that is still starting has not failed.

Caddy is **reloaded** rather than restarted wherever a reload can do the job,
and that is deliberate: `ExecStart` carries `--environ`, so restarting Caddy
writes its whole environment — the 1AM gateway key with it — into the journal.

### Escalation

Three restarts of the balancer inside two hours that have not fixed it, and
restarting is not the repair. The supervisor writes
`/var/lib/passport-balancer/supervisor-escalated`, stops restarting **anything**
— every leg of this script, not only the supervisor's own — and logs why on
every tick until somebody looks. The marker is removed automatically the moment
`/status` reads healthy again.

Setting `WATCHDOG_REBOOT=1` in the environment file adds one droplet reboot per
six hours while escalated. It is **off by default**, and it stays off unless
somebody has decided that a reboot is better than a sponsor an operator can
still log into.

### Reading the markers

Everything the supervisor remembers is a file under
`/var/lib/passport-balancer`, because it has to survive the restart it bounds:

```sh
# What it is doing and why, one line per tick.
journalctl -u passport-balancer-watchdog -f | grep supervisor

# Every restart it has ever asked for, from any leg.
journalctl -t passport-ops --since '2 days ago'

# The state it keeps.
ls -l /var/lib/passport-balancer/supervisor-*
```

| File | Holds |
| --- | --- |
| `supervisor-strikes-{balancer,proof,caddy}` | consecutive unhealthy ticks |
| `supervisor-last-restart-<unit>` | epoch seconds of the last restart |
| `supervisor-restarts-<unit>` | position on the backoff ladder |
| `supervisor-healthy-since-<unit>` | when it last started reading healthy |
| `supervisor-restart-log-balancer` | the last ten balancer restarts, for the escalation window |
| `supervisor-escalated` | present means **restarts are off**; the file says when and why |
| `supervisor-last-reboot`, `supervisor-last-heartbeat` | the two daily-ish clocks |

`cat supervisor-escalated` first whenever the sponsor is down and nothing
appears to be trying to fix it. `rm` it to allow restarts again.

### Setting the webhook

`WATCHDOG_ALERT_WEBHOOK` receives a plain `{"text": "..."}` POST on every
action and on entering or leaving escalation, plus a heartbeat at most once a
day so a webhook that has quietly stopped delivering is noticed on a quiet day
rather than during an outage. Unset, nothing is posted and nothing is logged
about it.

It is read from `/etc/passport-balancer-watchdog.env`, which the unit takes
through `EnvironmentFile=-` — the leading `-` makes the file optional:

```sh
cat > /etc/passport-balancer-watchdog.env <<'ENV'
WATCHDOG_ALERT_WEBHOOK=https://hooks.slack.com/services/…
# WATCHDOG_REBOOT=1
ENV
chmod 600 /etc/passport-balancer-watchdog.env
systemctl daemon-reload
```

The URL is a secret and is treated as one: it is never written to the journal,
never passed on a command line that is logged, and `curl` is called with `-s`
rather than `-sS` so that an error from it cannot carry the URL into the
output.

### Installing

```sh
install -m 755 deploy/passport-balancer-watchdog.sh /usr/local/lib/passport-balancer-watchdog.sh
install -m 644 deploy/passport-balancer-watchdog.service /etc/systemd/system/
install -m 644 deploy/passport-balancer-watchdog.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now passport-balancer-watchdog.timer
```

`bash test/watchdog.test.sh` drives every rule above against stub probes, a
canned journal, and recorders in place of `systemctl`, `docker`, and `logger`.
Run it before installing a change; nothing in it touches a real unit.
