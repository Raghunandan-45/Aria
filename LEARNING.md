## 1. Why Cache at All?

- SQLite is persistent but relatively slow for hot paths
- Redis is in-memory, ephemeral, but extremely fast
- The redirect lookup is your hottest path — perfect candidate for caching


## 2. Cache-Aside Pattern (Lazy Loading)

- Check Redis first
- On hit → return immediately, SQLite never touched
- On miss → query SQLite → store result in Redis → return
- Cache fills itself naturally through usage, no prediction needed


## 3. Redis is NOT the Primary Store

- SQLite = source of truth (persistent, has everything)
- Redis = fast layer in front (temporary, has hot subset)
- If Redis dies → fallback to SQLite gracefully, app doesn't break


## 4. TTL (Time To Live)

- Every Redis key gets an expiry time
- Prevents stale data sitting in cache forever
- After expiry → key is gone → next request is a cache miss → re-fetches from SQLite


## 5. LRU Eviction (Least Recently Used)

- Redis has a memory limit (maxmemory)
- When full, it evicts the least recently used keys automatically
- Configured via maxmemory-policy allkeys-lru
- TTL handles time, LRU handles space — both work simultaneously


## 6. How URLs "Earn" Their Place in Redis

- No manual pushing or frequency tracking needed
- Simply accessed once → stored in Redis → stays until TTL or LRU evicts it
- High traffic URLs naturally stay, cold URLs naturally leave


## 7. Cache Thrashing

- Happens when working set size > cache size
- Every URL gets evicted before being accessed again
- Cache hit rate → ~0%, Redis becomes pure overhead
- Real URL shorteners avoid this because traffic follows power law distribution — few URLs get most - of the hits
- Your mitigation → graceful SQLite fallback on every miss


## Coming up next → Distributed Redis:

- Why one Redis instance becomes a bottleneck
- Consistent hashing — what problem it solves over round-robin
- Cache invalidation across multiple nodes
- Docker to simulate the distributed environment

## 8. Why Distributed Redis?

Single Redis instance failure points:
- Goes down → no caching at all
- Overwhelmed with requests → becomes a bottleneck
- Runs out of memory → LRU eviction under pressure
- Solution → multiple Redis instances, but now you need to know **which instance holds which key**


## 9. Naive Solution & Its Problem (Modulo Hashing)

- Obvious fix → `key % n` to pick instance
- Problem → when n changes (add/remove instance), almost every key remaps
- Causes **cache stampede** — SQLite gets hammered all at once
- Consistent hashing solves this


## 10. Consistent Hashing Ring

- Imagine a clock face (0 to 2³²)
- Redis instances sit at fixed points on this ring
- A key gets hashed to a position → assigned to nearest clockwise node
- Adding a node → only `k/n` keys remap (not everything)
- Removing a node → only that node's keys move to the next clockwise node
- Everything else stays untouched → cache hit rate barely drops


## 11. Data Structure for the Ring

- Ring is a **concept**, not a literal circular structure
- Implemented as a **sorted array** of node positions
- Lookup → binary search for nearest position >= X → O(log n)
- Wraparound → if nothing >= X, take index 0 (circular behaviour)
- Insertion → binary search for correct position → splice in → stays sorted
- No need for self-balancing trees — Redis instances are added/removed rarely


## 12. Hash Function

- Job → convert string key (`abc123`) → number on the ring
- Properties needed → speed, uniform distribution, consistency
- `xxhash` → fastest, best distribution, non-cryptographic, needs npm package
- `md5` → slightly slower, built into Node's `crypto` module, no extra dependency
- Both are non-cryptographic — security is not the differentiator here
- Implementation → take first 8 hex characters of output → `parseInt(first8chars, 16)` → number in 0 to 2³² range
- Why 8 chars → 8 hex chars = 32 bits = 0 to 4,294,967,295 range
- Why not full hash → JS number precision limits on very large integers


## 13. Virtual Nodes (VNodes)

- Problem with basic consistent hashing → 3 nodes may not be evenly spaced on ring
- One instance could handle 60% of keys, another only 20% → uneven load
- Solution → each physical Redis instance gets represented at multiple points on the ring
- Example → 150 virtual positions per instance instead of 1
- Result → much more uniform key distribution across instances


## 14. Docker Compose Setup

- Each Redis instance gets its own container
- All containers use port 6379 internally — no port conflicts (separate IPs)
- Containers communicate via **service names**, not localhost
- Example addresses → `redis1:6379`, `redis2:6379`, `redis3:6379`
- Store these in `.env` and read at startup to bootstrap the ring


## 15. Bootstrapping & Graceful Degradation

- At startup → read Redis addresses from `.env` → register onto hash ring
- SQLite down → `process.exit(1)` → app cannot function at all
- Redis down → log warning → **start anyway** → Cache-Aside still works via SQLite
- App loses speed but not functionality → called **graceful degradation**
- Redis recovers → cache starts filling itself again automatically


## 16. Implementation Order

**Phase 1 — Hash Ring (isolated)**
- Build `HashRing` class with sorted array
- Implement `addNode`, `removeNode`, `getNode`
- Test independently before touching Redis
- Add VNode support after basic version works

**Phase 2 — Single Redis Instance**
- Install `ioredis`
- Wire into `getLongURL` using Cache-Aside pattern
- Test hit/miss behavior manually
- Add TTL when storing keys

**Phase 3 — Distribute It**
- Write `docker-compose.yml` with 3 Redis containers + Node app
- Plug `HashRing` into Redis connection logic
- Replace single client with `getNode(key)` → pick correct instance

**Phase 4 — Failure Handling**
- Handle Redis connection errors → fall back to SQLite
- Kill one container manually → verify only that node's keys remapped
- Rest of cache unaffected

**Phase 5 — Observability**
- Log cache hits vs misses
- Track which Redis node serves which keys
- Use as demo talking point in interviews