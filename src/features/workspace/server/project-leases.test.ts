import { afterEach, describe, expect, it, vi } from "vitest";
import { shutdownProjectKernels } from "@/features/notebook/server/kernels";
import { retainProject } from "./project-leases";

vi.mock("@/features/notebook/server/kernels", () => ({ shutdownProjectKernels: vi.fn() }));
afterEach(() => { vi.runAllTimers(); vi.useRealTimers(); vi.clearAllMocks(); });

describe("project window leases", () => {
  it("keeps kernels until the last window releases the project", () => {
    vi.useFakeTimers();
    const first = retainProject("two-windows");
    const second = retainProject("two-windows");
    first();
    vi.advanceTimersByTime(20_000);
    expect(shutdownProjectKernels).not.toHaveBeenCalled();
    second();
    vi.advanceTimersByTime(10_000);
    expect(shutdownProjectKernels).toHaveBeenCalledExactlyOnceWith("two-windows");
  });

  it("allows a reconnect without restarting kernels", () => {
    vi.useFakeTimers();
    retainProject("reconnect")();
    vi.advanceTimersByTime(5000);
    const release = retainProject("reconnect");
    vi.advanceTimersByTime(20_000);
    expect(shutdownProjectKernels).not.toHaveBeenCalled();
    release();
    release();
    vi.advanceTimersByTime(10_000);
    expect(shutdownProjectKernels).toHaveBeenCalledExactlyOnceWith("reconnect");
  });
});
