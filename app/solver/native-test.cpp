#include <cassert>
#include <cstdint>
#include <cstdio>
#include <vector>
#define PI_NATIVE_TEST
#include "schedule.cpp"

std::vector<int> fixture(int count) {
  std::vector<int> v{0x50495331,1,count,count*2,count*2,0,0,1440,0,0,10000,3,0,0,0,0};
  for (int g=0;g<count;++g) v.insert(v.end(),{g*2,2,-1});
  for (int g=0;g<count;++g) for(int o=0;o<2;++o) v.insert(v.end(),{g,g*2+o,1,0,1});
  for (int g=0;g<count;++g) for(int o=0;o<2;++o) v.insert(v.end(),{1,540+o*60,590+o*60});
  return v;
}
int run(const std::vector<int>& v) {
  for (unsigned i=0;i<v.size();++i) solver_input()[i]=v[i];
  return solver_run(static_cast<int>(v.size()));
}
int main() {
  assert(run(fixture(2))==0);
  assert(run(fixture(3))==1);
  auto limited=fixture(3); limited[10]=1;
  assert(run(limited)==2);
  assert(solver_run(-1)==3);
  assert(solver_run(10001)==3);
  const auto valid=fixture(3);
  std::uint32_t seed=20261105;
  for (int i=0;i<20000;++i) {
    auto mutated=valid;
    seed=seed*1664525u+1013904223u;
    const unsigned index=seed%static_cast<unsigned>(mutated.size());
    seed=seed*1664525u+1013904223u;
    mutated[index]=static_cast<int>(seed);
    const int result=run(mutated);
    assert(result>=0 && result<=3);
  }
  assert(run(fixture(2))==0); // Bad calls must not poison later valid requests.
  std::puts("Native solver passed. ASan/UBSan, 20,000 ABI mutations, valid and bounded searches.");
}
