# Semester Lab engine

`schedule.cpp` is a freestanding C++17 finite-domain solver compiled to
WebAssembly. It has no allocator, WASI dependency, network calls, or JavaScript
imports. A TypeScript adapter validates inputs and decodes ranked answers.

Each section group requires one option. An option can have several meetings.
Hard constraints are nonoverlapping meetings, earliest start, latest finish,
free days, protected intervals, section locks, and listed section availability.
Canceled sections are always excluded. Closed sections require an explicit toggle.

The engine precomputes option-conflict bitsets, searches the most constrained
remaining group, and keeps the best three assignments. Branch-and-bound uses only
monotonic lower bounds. In particular, partial gap minutes are not a valid lower
bound because inserting another class can shrink a gap.

Ranking is deterministic. Compact minimizes gap minutes plus 30 per active day.
Fewest changes first minimizes deviations from explicitly selected sections,
then gaps. Latest start first maximizes the earliest meeting across the week,
then minimizes gaps. Exact score ties use input option order. With at most seven
days, the 20,000 weight makes the latter objectives lexicographic.

Results distinguish an exhaustive top-three ranking, proved infeasibility, and
an unfinished search. A finite node budget never becomes a claim of infeasibility.
Conflict explanations remove section groups and test the reduced problems. Unknown
subproblems are retained. Suggested relaxations are returned only after a full
assignment was actually found under that relaxation.

## Build and verify

Install LLVM clang with the wasm32 backend and `wasm-ld`. Apple clang does not
include that backend. On macOS the build script also recognizes Homebrew LLVM
and the wasm linker shipped with a Rust toolchain. `WASM_CXX` and `WASM_LD` can
select explicit paths. The native sanitizer test uses `CXX` or `clang++`.

```
npm run build:solver
npm run test:solver-native
npm test
npx wrangler types
npm run typecheck
npm run build
```

The small generated `src/client/scheduling/solver.wasm` is included so ordinary
builds need no extra compiler. CI rebuilds it from source before
testing. The native suite exercises malformed inputs under ASan/UBSan. The Wasm
suite compares actual ranked answers against a separate exhaustive oracle on 300
seeded problems and a larger presentation fixture.

## Data boundaries

The Junction adapter accepts the `get_schedule_details` payload. It uses
original section rows instead of the calendar's merged display data.
Sections sharing a title retain all their meetings, and distinct section titles
are kept even when they meet at the same time. Missing times, unknown availability,
missing courses, or inconsistent records fail explicitly.

Completeness is relative to the supplied groups. The current Junction payload
does not expose linked-section restrictions, prerequisites, travel time, or
registration eligibility. These are not checked. Availability is a snapshot,
not a seat reservation. The engine and adapter do not write to Junction or
register courses.
Real account integration and deployment require separate live validation.

Limits are 32 groups, 512 options, 2,048 meetings, 64 protected intervals, and
200,000 search nodes per interactive solve. Native input validation rejects
out-of-range indices and lengths before reading records. The Wasm
memory is fixed at 512 KiB.

## Reproduce the warm solve measurement

Run `npm run bench:solver` after building the solver. It prints the Node version,
CPU, Wasm and C++ source hashes, input sizes, warmup and sample counts, and median
and p95 duration of individual `engine.solve` calls. The timed boundary includes
JavaScript validation, encoding, the Wasm solver, and result decoding. It excludes
module compilation and instantiation, workers, conflict diagnosis, and rendering.
The fixtures are synthetic and repeated in a warm process. These measurements
do not establish browser interaction latency, production tail latency, a speedup
over another solver, or worst-case performance. There is no CI timing threshold.
