import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const folder = mkdtempSync(join(tmpdir(), "pi-native-test-"));
try {
  const binary = join(folder, "test");
  execFileSync(
    process.env.CXX || "clang++",
    [
      "-std=c++17",
      "-O1",
      "-g",
      "-Wall",
      "-Wextra",
      "-Werror",
      "-pedantic",
      "-fsanitize=address,undefined",
      "-fno-omit-frame-pointer",
      join(root, "solver/native-test.cpp"),
      "-o",
      binary,
    ],
    { stdio: "inherit" },
  );
  execFileSync(binary, [], { stdio: "inherit" });
} finally {
  rmSync(folder, { recursive: true, force: true });
}
