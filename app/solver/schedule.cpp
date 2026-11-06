// Bounded finite-domain scheduling. No allocator, libc, or JavaScript imports.
// The same implementation runs natively under sanitizers and in WebAssembly.
// Wire format and validation live beside the adapter in scheduling/engine.ts.
using u32 = unsigned int;
static_assert(sizeof(int) == 4 && sizeof(u32) == 4, "The ABI uses 32-bit words");

namespace {
constexpr int MAGIC = 0x50495331;
constexpr int GROUPS = 32, OPTIONS = 512, MEETINGS = 2048, BUSY = 64;
constexpr int WORDS = OPTIONS / 32, INPUT = 10000, OUTPUT = 256, TOP = 3;
struct Slot { int days, start, end; };
struct Group { int first, count, lock; bool has_selection; };
struct Option { int group, first, count, selected, enabled; };
struct Answer { int score, gaps, days, earliest, changes, latest; int picks[GROUPS]; };
int input[INPUT], output[OUTPUT];
Group groups[GROUPS];
Option options[OPTIONS];
Slot meetings[MEETINGS], busy[BUSY];
u32 conflicts[OPTIONS][WORDS], excluded[WORDS];
Answer answers[TOP];
int ng, no, nm, nb, early, late, off, objective, budget, top, first_only;
int nodes, found, chosen[GROUPS];
bool stopped;

bool overlap(const Slot& a, const Slot& b) {
  return (a.days & b.days) && a.start < b.end && b.start < a.end;
}
bool valid_slot(const Slot& s) {
  return s.days > 0 && s.days < 128 && s.start >= 0 && s.end <= 1440 && s.start < s.end;
}
bool blocked(const u32* mask, int index) { return (mask[index / 32] & (1u << (index % 32))) != 0; }
void block(u32* mask, int index) { mask[index / 32] |= 1u << (index % 32); }

bool parse(int size) {
  if (size < 16 || size > INPUT || input[0] != MAGIC || input[1] != 1) return false;
  ng = input[2]; no = input[3]; nm = input[4]; nb = input[5];
  early = input[6]; late = input[7]; off = input[8]; objective = input[9];
  budget = input[10]; top = input[11]; first_only = input[12];
  if (ng < 1 || ng > GROUPS || no < 1 || no > OPTIONS || nm < 1 || nm > MEETINGS || nb < 0 || nb > BUSY) return false;
  if (early < 0 || late > 1440 || early > late || off < 0 || off > 127 || objective < 0 || objective > 2) return false;
  if (budget < 1 || budget > 1000000 || top < 1 || top > TOP || (first_only != 0 && first_only != 1)) return false;
  if (16 + ng * 3 + no * 5 + (nm + nb) * 3 != size) return false;
  int at = 16, next = 0;
  for (int g = 0; g < ng; ++g) {
    groups[g] = {input[at], input[at + 1], input[at + 2], false}; at += 3;
    const Group& group = groups[g];
    if (group.first != next || group.count < 1 || group.count > no - next) return false;
    if (group.lock != -1 && (group.lock < next || group.lock >= next + group.count)) return false;
    next += group.count;
  }
  if (next != no) return false;
  next = 0;
  for (int o = 0; o < no; ++o) {
    options[o] = {input[at], input[at + 1], input[at + 2], input[at + 3], input[at + 4]}; at += 5;
    const Option& option = options[o];
    if (option.group < 0 || option.group >= ng || option.first != next || option.count < 1 || option.count > nm - next) return false;
    const Group& group = groups[option.group];
    if (o < group.first || o >= group.first + group.count || (option.selected != 0 && option.selected != 1) || (option.enabled != 0 && option.enabled != 1)) return false;
    if (option.selected) groups[option.group].has_selection = true;
    next += option.count;
  }
  if (next != nm) return false;
  for (int m = 0; m < nm; ++m) {
    meetings[m] = {input[at], input[at + 1], input[at + 2]}; at += 3;
    if (!valid_slot(meetings[m])) return false;
  }
  for (int b = 0; b < nb; ++b) {
    busy[b] = {input[at], input[at + 1], input[at + 2]}; at += 3;
    if (!valid_slot(busy[b])) return false;
  }
  return true;
}

void prepare() {
  for (int w = 0; w < WORDS; ++w) excluded[w] = 0;
  for (int a = 0; a < no; ++a) {
    for (int w = 0; w < WORDS; ++w) conflicts[a][w] = 0;
    const Option& option = options[a];
    const Group& group = groups[option.group];
    if (!option.enabled || (group.lock != -1 && group.lock != a)) block(excluded, a);
    for (int i = option.first; i < option.first + option.count; ++i) {
      const Slot& slot = meetings[i];
      if (slot.start < early || slot.end > late || (slot.days & off)) block(excluded, a);
      for (int b = 0; b < nb; ++b) if (overlap(slot, busy[b])) block(excluded, a);
      // A selected section may meet several times. Every meeting must fit.
      for (int j = option.first; j < i; ++j) if (overlap(slot, meetings[j])) block(excluded, a);
    }
  }
  for (int a = 0; a < no; ++a) for (int b = a + 1; b < no; ++b) {
    if (options[a].group == options[b].group) continue;
    bool clash = false;
    for (int i = options[a].first; i < options[a].first + options[a].count && !clash; ++i)
      for (int j = options[b].first; j < options[b].first + options[b].count; ++j)
        if (overlap(meetings[i], meetings[j])) { clash = true; break; }
    if (clash) { block(conflicts[a], b); block(conflicts[b], a); }
  }
}

// Metrics use exact minute intervals. All chosen intervals are nonoverlapping.
Answer measure() {
  Answer a{}; a.earliest = 1440;
  int starts[7], ends[7]{}, duration[7]{};
  for (int d = 0; d < 7; ++d) starts[d] = 1440;
  for (int g = 0; g < ng; ++g) {
    a.picks[g] = chosen[g];
    if (chosen[g] < 0) continue;
    const Option& option = options[chosen[g]];
    if (groups[g].has_selection && !option.selected) ++a.changes;
    for (int m = option.first; m < option.first + option.count; ++m) {
      const Slot& s = meetings[m];
      for (int d = 0; d < 7; ++d) if (s.days & (1 << d)) {
        if (s.start < starts[d]) starts[d] = s.start;
        if (s.end > ends[d]) ends[d] = s.end;
        duration[d] += s.end - s.start;
      }
    }
  }
  for (int d = 0; d < 7; ++d) if (ends[d]) {
    ++a.days;
    a.gaps += ends[d] - starts[d] - duration[d];
    if (starts[d] < a.earliest) a.earliest = starts[d];
    if (ends[d] > a.latest) a.latest = ends[d];
  }
  a.score = objective == 0 ? a.gaps + a.days * 30
    : objective == 1 ? a.changes * 20000 + a.gaps
    : (1440 - a.earliest) * 20000 + a.gaps;
  return a;
}

bool before(const Answer& a, const Answer& b) {
  if (a.score != b.score) return a.score < b.score;
  for (int g = 0; g < ng; ++g) if (a.picks[g] != b.picks[g]) return a.picks[g] < b.picks[g];
  return false;
}
void record() {
  Answer answer = measure();
  int pos = 0;
  while (pos < found && !before(answer, answers[pos])) ++pos;
  if (pos >= top) return;
  if (found < top) ++found;
  for (int i = found - 1; i > pos; --i) answers[i] = answers[i - 1];
  answers[pos] = answer;
}

void search(int depth, const u32* banned) {
  if (stopped || (first_only && found)) return;
  if (nodes >= budget) { stopped = true; return; }
  ++nodes;
  if (depth == ng) { record(); return; }
  // Only monotonic metrics are used as bounds. Inserting a class can REDUCE gaps.
  if (found == top) {
    const Answer partial = measure();
    const int bound = objective == 0 ? partial.days * 30
      : objective == 1 ? partial.changes * 20000
      : (1440 - partial.earliest) * 20000;
    if (bound > answers[found - 1].score) return;
  }
  int next = -1, smallest = OPTIONS + 1;
  for (int g = 0; g < ng; ++g) if (chosen[g] < 0) {
    int remaining = 0;
    for (int o = groups[g].first; o < groups[g].first + groups[g].count; ++o)
      if (!blocked(banned, o)) ++remaining;
    if (!remaining) return;
    if (remaining < smallest) { smallest = remaining; next = g; }
  }
  for (int o = groups[next].first; o < groups[next].first + groups[next].count; ++o) {
    if (blocked(banned, o)) continue;
    chosen[next] = o;
    u32 child[WORDS];
    for (int w = 0; w < WORDS; ++w) child[w] = banned[w] | conflicts[o][w];
    search(depth + 1, child);
    chosen[next] = -1;
    if (stopped || (first_only && found)) break;
  }
}
}

extern "C" int* solver_input() { return input; }
extern "C" int solver_capacity() { return INPUT; }
extern "C" int* solver_output() { return output; }
extern "C" int solver_run(int size) {
  for (int i = 0; i < OUTPUT; ++i) output[i] = 0;
  output[0] = MAGIC; output[1] = 1; output[2] = 3;
  if (!parse(size)) return 3;
  nodes = 0; found = 0; stopped = false;
  for (int g = 0; g < ng; ++g) chosen[g] = -1;
  prepare(); search(0, excluded);
  // 0 is an exhaustive answer, 1 a proof of infeasibility, 2 an unfinished search.
  const int status = stopped || (first_only && found) ? 2 : found ? 0 : 1;
  output[2] = status; output[3] = found; output[4] = nodes; output[5] = ng;
  int at = 8;
  for (int i = 0; i < found; ++i) {
    const Answer& a = answers[i];
    output[at++] = a.score; output[at++] = a.gaps; output[at++] = a.days;
    output[at++] = a.earliest; output[at++] = a.changes; output[at++] = a.latest;
    for (int g = 0; g < ng; ++g) output[at++] = a.picks[g];
  }
  return status;
}

// Clang may emit these even for a freestanding optimized build.
#ifndef PI_NATIVE_TEST
extern "C" void* memset(void* dest, int value, __SIZE_TYPE__ length) {
  auto* bytes = static_cast<unsigned char*>(dest);
  for (__SIZE_TYPE__ i = 0; i < length; ++i) bytes[i] = static_cast<unsigned char>(value);
  return dest;
}
extern "C" void* memcpy(void* dest, const void* src, __SIZE_TYPE__ length) {
  auto* out = static_cast<unsigned char*>(dest);
  const auto* in = static_cast<const unsigned char*>(src);
  for (__SIZE_TYPE__ i = 0; i < length; ++i) out[i] = in[i];
  return dest;
}
#endif
