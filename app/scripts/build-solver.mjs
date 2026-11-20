import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const compiler =
  process.env.WASM_CXX ||
  (existsSync("/opt/homebrew/opt/llvm/bin/clang++")
    ? "/opt/homebrew/opt/llvm/bin/clang++"
    : "clang++");
let linker = process.env.WASM_LD || "wasm-ld";
if (!process.env.WASM_LD && process.platform === "darwin") {
  try {
    const sysroot = execFileSync("rustc", ["--print", "sysroot"], {
      encoding: "utf8",
    }).trim();
    const candidate = join(
      sysroot,
      "lib/rustlib/aarch64-apple-darwin/bin/gcc-ld/wasm-ld",
    );
    if (existsSync(candidate)) linker = candidate;
  } catch {
    /* Use PATH when no Rust toolchain is installed. */
  }
}
const temporary = mkdtempSync(join(tmpdir(), "pi-solver-"));
try {
  const object = join(temporary, "schedule.o");
  execFileSync(
    compiler,
    [
      "--target=wasm32",
      "-std=c++17",
      "-O3",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-ffreestanding",
      "-fno-exceptions",
      "-fno-rtti",
      "-fno-builtin",
      "-c",
      join(root, "solver/schedule.cpp"),
      "-o",
      object,
    ],
    { stdio: "inherit" },
  );
  const target = join(root, "src/client/scheduling/solver.wasm");
  mkdirSync(dirname(target), { recursive: true });
  execFileSync(
    linker,
    [
      "--no-entry",
      "--export=solver_input",
      "--export=solver_output",
      "--export=solver_capacity",
      "--export=solver_run",
      "--export-memory",
      "--initial-memory=524288",
      "--max-memory=524288",
      "-z",
      "stack-size=65536",
      "--strip-all",
      object,
      "-o",
      target,
    ],
    { stdio: "inherit" },
  );
  console.log("Built solver.wasm from solver/schedule.cpp");
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
