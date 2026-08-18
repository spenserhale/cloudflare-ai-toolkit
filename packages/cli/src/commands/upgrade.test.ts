import { describe, it, expect, vi } from "vitest";
import {
  compareSemver,
  detectInstallMethod,
  isCompiledBinary,
  resolveAssetName,
  runUpgrade,
  type UpgradeDeps,
} from "./upgrade.js";

function makeDeps(overrides: Partial<UpgradeDeps> = {}): UpgradeDeps {
  return {
    log: vi.fn(),
    error: vi.fn(),
    exit: vi.fn((_code: number) => {
      throw new Error("exit called");
    }) as unknown as (code: number) => never,
    fetch: vi.fn() as unknown as typeof fetch,
    execPath: "/usr/local/bin/cloudflare",
    cliEntryPath:
      "/usr/local/lib/node_modules/@cloudflare-ai-toolkit/cli/dist/bin.js",
    currentVersion: "0.1.0",
    platform: "linux",
    arch: "x64",
    writeBinary: vi.fn(async () => {}),
    replaceBinary: vi.fn(async () => {}),
    spawnPackageManager: vi.fn(async () => ({ command: "ran", code: 0 })),
    ...overrides,
  };
}

function latestReleaseMock(tag: string) {
  return vi.fn(async () =>
    new Response(JSON.stringify({ tag_name: tag }), { status: 200 }),
  ) as unknown as typeof fetch;
}

describe("compareSemver", () => {
  it("returns 0 for equal versions", () => {
    expect(compareSemver("0.1.0", "0.1.0")).toBe(0);
    expect(compareSemver("v0.1.0", "0.1.0")).toBe(0);
  });
  it("orders major/minor/patch correctly", () => {
    expect(compareSemver("0.1.0", "0.1.1")).toBe(-1);
    expect(compareSemver("0.2.0", "0.1.99")).toBe(1);
    expect(compareSemver("1.0.0", "0.99.99")).toBe(1);
  });
  it("treats missing components as zero", () => {
    expect(compareSemver("1", "1.0.0")).toBe(0);
    expect(compareSemver("1.1", "1.0.5")).toBe(1);
  });
});

describe("resolveAssetName", () => {
  it("maps all supported platforms", () => {
    expect(resolveAssetName("linux", "x64")).toBe("cloudflare-linux-x64");
    expect(resolveAssetName("linux", "arm64")).toBe("cloudflare-linux-arm64");
    expect(resolveAssetName("darwin", "x64")).toBe("cloudflare-darwin-x64");
    expect(resolveAssetName("darwin", "arm64")).toBe("cloudflare-darwin-arm64");
    expect(resolveAssetName("win32", "x64")).toBe("cloudflare-windows-x64.exe");
  });
  it("returns null for unsupported combinations", () => {
    expect(resolveAssetName("freebsd", "x64")).toBeNull();
    expect(resolveAssetName("linux", "ppc64")).toBeNull();
  });
});

describe("isCompiledBinary", () => {
  it("detects compiled binaries by exec basename", () => {
    expect(isCompiledBinary("/usr/local/bin/cloudflare")).toBe(true);
    expect(isCompiledBinary("C:/Users/x/cloudflare.exe")).toBe(true);
    expect(isCompiledBinary("/home/u/.local/bin/cloudflare")).toBe(true);
  });
  it("rejects node/bun/npx", () => {
    expect(isCompiledBinary("/usr/bin/node")).toBe(false);
    expect(isCompiledBinary("/usr/local/bin/bun")).toBe(false);
    expect(isCompiledBinary("/usr/bin/npx")).toBe(false);
  });
});

describe("detectInstallMethod", () => {
  const node = "/usr/bin/node";

  it("detects the standalone binary", () => {
    expect(detectInstallMethod("/usr/local/bin/cloudflare", node)).toBe("binary");
    expect(detectInstallMethod("C:/bin/cloudflare.exe", node)).toBe("binary");
  });

  it("detects bun global installs", () => {
    expect(
      detectInstallMethod(
        node,
        "/home/u/.bun/install/global/node_modules/@cloudflare-ai-toolkit/cli/dist/bin.js"
      )
    ).toBe("bun");
  });

  it("detects pnpm global installs", () => {
    expect(
      detectInstallMethod(
        node,
        "/home/u/.local/share/pnpm/global/5/.pnpm/@cloudflare-ai-toolkit+cli@0.2.0/node_modules/@cloudflare-ai-toolkit/cli/dist/bin.js"
      )
    ).toBe("pnpm");
  });

  it("detects npm global installs", () => {
    expect(
      detectInstallMethod(
        node,
        "/usr/local/lib/node_modules/@cloudflare-ai-toolkit/cli/dist/bin.js"
      )
    ).toBe("npm");
  });

  it("returns unknown for source checkouts and yarn", () => {
    expect(detectInstallMethod(node, "/repo/packages/cli/dist/bin.js")).toBe("unknown");
    expect(
      detectInstallMethod(
        node,
        "/home/u/.config/yarn/global/node_modules/@cloudflare-ai-toolkit/cli/dist/bin.js"
      )
    ).toBe("yarn");
  });
});

describe("runUpgrade (package manager installs)", () => {
  const npmEntry = "/usr/local/lib/node_modules/@cloudflare-ai-toolkit/cli/dist/bin.js";

  it("upgrades npm installs via npm install -g", async () => {
    const spawnPackageManager = vi.fn(async () => ({ command: "npm install -g x", code: 0 }));
    const deps = makeDeps({
      execPath: "/usr/bin/node",
      cliEntryPath: npmEntry,
      fetch: latestReleaseMock("v0.2.0"),
      spawnPackageManager,
    });
    await runUpgrade(deps, { check: false, force: false, version: undefined });

    expect(spawnPackageManager).toHaveBeenCalledWith("npm", [
      "install",
      "-g",
      "@cloudflare-ai-toolkit/cli@0.2.0",
    ]);
    expect(deps.replaceBinary).not.toHaveBeenCalled();
    expect(deps.log).toHaveBeenCalledWith("Upgraded to 0.2.0.");
  });

  it("upgrades bun installs via bun add -g", async () => {
    const spawnPackageManager = vi.fn(async () => ({ command: "bun add -g x", code: 0 }));
    const deps = makeDeps({
      execPath: "/usr/local/bin/bun",
      cliEntryPath:
        "/home/u/.bun/install/global/node_modules/@cloudflare-ai-toolkit/cli/dist/bin.js",
      fetch: latestReleaseMock("v0.2.0"),
      spawnPackageManager,
    });
    await runUpgrade(deps, { check: false, force: false, version: undefined });

    expect(spawnPackageManager).toHaveBeenCalledWith("bun", [
      "add",
      "-g",
      "@cloudflare-ai-toolkit/cli@0.2.0",
    ]);
  });

  it("upgrades pnpm installs via pnpm add -g", async () => {
    const spawnPackageManager = vi.fn(async () => ({ command: "pnpm add -g x", code: 0 }));
    const deps = makeDeps({
      execPath: "/usr/bin/node",
      cliEntryPath:
        "/home/u/.local/share/pnpm/global/5/.pnpm/@cloudflare-ai-toolkit+cli@0.2.0/node_modules/@cloudflare-ai-toolkit/cli/dist/bin.js",
      fetch: latestReleaseMock("v0.2.0"),
      spawnPackageManager,
    });
    await runUpgrade(deps, { check: false, force: false, version: undefined });

    expect(spawnPackageManager).toHaveBeenCalledWith("pnpm", [
      "add",
      "-g",
      "@cloudflare-ai-toolkit/cli@0.2.0",
    ]);
  });

  it("honors --version for package manager installs", async () => {
    const spawnPackageManager = vi.fn(async () => ({ command: "npm install -g x", code: 0 }));
    const fetchMock = vi.fn() as unknown as typeof fetch;
    const deps = makeDeps({
      execPath: "/usr/bin/node",
      cliEntryPath: npmEntry,
      fetch: fetchMock,
      spawnPackageManager,
    });
    await runUpgrade(deps, { check: false, force: true, version: "0.1.1" });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(spawnPackageManager).toHaveBeenCalledWith("npm", [
      "install",
      "-g",
      "@cloudflare-ai-toolkit/cli@0.1.1",
    ]);
  });

  it("reports update-available in --check mode without spawning", async () => {
    const spawnPackageManager = vi.fn(async () => ({ command: "ran", code: 0 }));
    const deps = makeDeps({
      execPath: "/usr/bin/node",
      cliEntryPath: npmEntry,
      fetch: latestReleaseMock("v0.2.0"),
      spawnPackageManager,
    });
    await runUpgrade(deps, { check: true, force: false, version: undefined });

    expect(deps.log).toHaveBeenCalledWith(
      "Update available. Run `cloudflare upgrade` to install (via npm)."
    );
    expect(spawnPackageManager).not.toHaveBeenCalled();
  });

  it("surfaces package manager failures", async () => {
    const spawnPackageManager = vi.fn(async () => ({ command: "npm install -g x", code: 1 }));
    const deps = makeDeps({
      execPath: "/usr/bin/node",
      cliEntryPath: npmEntry,
      fetch: latestReleaseMock("v0.2.0"),
      spawnPackageManager,
    });
    await expect(
      runUpgrade(deps, { check: false, force: false, version: undefined })
    ).rejects.toThrow("exit called");
    expect(deps.error).toHaveBeenCalledWith(
      expect.stringContaining("exited with code 1")
    );
  });

  it("refuses with manual instructions when the install method is unknown", async () => {
    const deps = makeDeps({
      execPath: "/usr/bin/node",
      cliEntryPath: "/repo/packages/cli/dist/bin.js",
    });
    await expect(
      runUpgrade(deps, { check: false, force: false, version: undefined })
    ).rejects.toThrow("exit called");
    expect(deps.exit).toHaveBeenCalledWith(1);
    expect(deps.error).toHaveBeenCalledWith(
      expect.stringContaining("Could not determine how the CLI was installed")
    );
    expect(deps.error).toHaveBeenCalledWith(
      expect.stringContaining("npm install -g @cloudflare-ai-toolkit/cli@latest")
    );
  });

  it("refuses with manual instructions for yarn installs", async () => {
    const deps = makeDeps({
      execPath: "/usr/bin/node",
      cliEntryPath:
        "/home/u/.config/yarn/global/node_modules/@cloudflare-ai-toolkit/cli/dist/bin.js",
    });
    await expect(
      runUpgrade(deps, { check: false, force: false, version: undefined })
    ).rejects.toThrow("exit called");
    expect(deps.error).toHaveBeenCalledWith(
      expect.stringContaining("cannot drive automatically")
    );
  });
});

describe("runUpgrade", () => {
  it("refuses when platform has no prebuilt binary", async () => {
    const deps = makeDeps({ platform: "freebsd" as NodeJS.Platform });
    await expect(
      runUpgrade(deps, { check: false, force: false, version: undefined }),
    ).rejects.toThrow("exit called");
    expect(deps.exit).toHaveBeenCalledWith(1);
    expect(deps.error).toHaveBeenCalledWith(expect.stringContaining("No prebuilt binary"));
  });

  it("reports up-to-date in --check mode", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ tag_name: "v0.1.0" }), { status: 200 }),
    );
    const deps = makeDeps({ fetch: fetchMock as unknown as typeof fetch });
    await runUpgrade(deps, { check: true, force: false, version: undefined });
    expect(deps.log).toHaveBeenCalledWith("You are on the latest version.");
    expect(deps.writeBinary).not.toHaveBeenCalled();
    expect(deps.replaceBinary).not.toHaveBeenCalled();
  });

  it("reports update-available in --check mode", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ tag_name: "v0.2.0" }), { status: 200 }),
    );
    const deps = makeDeps({ fetch: fetchMock as unknown as typeof fetch });
    await runUpgrade(deps, { check: true, force: false, version: undefined });
    expect(deps.log).toHaveBeenCalledWith(
      "Update available. Run `cloudflare upgrade` to install.",
    );
    expect(deps.writeBinary).not.toHaveBeenCalled();
  });

  it("skips install when already on latest and --force is not set", async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ tag_name: "v0.1.0" }), { status: 200 }),
    );
    const deps = makeDeps({ fetch: fetchMock as unknown as typeof fetch });
    await runUpgrade(deps, { check: false, force: false, version: undefined });
    expect(deps.log).toHaveBeenCalledWith("Already on the latest version.");
    expect(deps.writeBinary).not.toHaveBeenCalled();
  });

  it("downloads, verifies, and replaces binary on real upgrade", async () => {
    const { createHash } = await import("node:crypto");
    const payload = Buffer.from("fake-binary-contents");
    const sha = createHash("sha256").update(payload).digest("hex");

    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/releases/latest")) {
        return new Response(JSON.stringify({ tag_name: "v0.2.0" }), { status: 200 });
      }
      if (url.endsWith(".sha256")) {
        return new Response(`${sha}  cloudflare-linux-x64\n`, { status: 200 });
      }
      return new Response(payload, { status: 200 });
    });

    const deps = makeDeps({ fetch: fetchMock as unknown as typeof fetch });
    await runUpgrade(deps, { check: false, force: false, version: undefined });

    expect(deps.writeBinary).toHaveBeenCalledOnce();
    expect(deps.replaceBinary).toHaveBeenCalledOnce();
    expect(deps.log).toHaveBeenCalledWith("Upgraded to 0.2.0.");
  });

  it("rejects binary with mismatched sha256", async () => {
    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/releases/latest")) {
        return new Response(JSON.stringify({ tag_name: "v0.2.0" }), { status: 200 });
      }
      if (url.endsWith(".sha256")) {
        return new Response("deadbeef  cloudflare-linux-x64\n", { status: 200 });
      }
      return new Response(Buffer.from("tampered"), { status: 200 });
    });
    const deps = makeDeps({ fetch: fetchMock as unknown as typeof fetch });
    await expect(
      runUpgrade(deps, { check: false, force: false, version: undefined }),
    ).rejects.toThrow(/Checksum mismatch/);
    expect(deps.writeBinary).not.toHaveBeenCalled();
  });

  it("honors --version flag to install a specific version", async () => {
    const { createHash } = await import("node:crypto");
    const payload = Buffer.from("pinned-binary");
    const sha = createHash("sha256").update(payload).digest("hex");
    const urls: string[] = [];

    const fetchMock = vi.fn(async (input: unknown) => {
      const url = String(input);
      urls.push(url);
      if (url.endsWith(".sha256")) {
        return new Response(`${sha}  x\n`, { status: 200 });
      }
      return new Response(payload, { status: 200 });
    });

    const deps = makeDeps({ fetch: fetchMock as unknown as typeof fetch });
    await runUpgrade(deps, { check: false, force: false, version: "0.1.1" });

    // Should hit the download URLs directly, never the /releases/latest endpoint.
    expect(urls.some((u) => u.includes("/releases/latest"))).toBe(false);
    expect(urls.some((u) => u.includes("/download/v0.1.1/"))).toBe(true);
    expect(deps.replaceBinary).toHaveBeenCalledOnce();
  });
});
