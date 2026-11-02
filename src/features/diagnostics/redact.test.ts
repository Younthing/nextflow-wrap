import { describe, expect, it } from "vitest";
import { MASK, redactEnv, redactText } from "./redact";

describe("redaction", () => {
  it("masks secret-named variables and keeps the rest", () => {
    expect(redactEnv({ OPENAI_API_KEY: "sk-abc", NEXTFLOW_STUDIO_SESSION_TOKEN: "t", PATH: "/usr/bin", EMPTY_TOKEN: "" , UNSET: undefined })).toEqual({
      EMPTY_TOKEN: "", NEXTFLOW_STUDIO_SESSION_TOKEN: MASK, OPENAI_API_KEY: MASK, PATH: "/usr/bin",
    });
  });

  it("masks key shapes, known secrets, URL passwords and secret assignments in text", () => {
    const text = [
      "using sk-ant-api03-abcdefghijklmnopqrstu",
      "proxy http://alice:hunter2@proxy.local:8080",
      "export AWS_SECRET_ACCESS_KEY=abc/def",
      "aws.secretKey: 'zzz'",
      "plain line with s3cr3t-value-123",
    ].join("\n");
    const out = redactText(text, ["s3cr3t-value-123"]);
    expect(out).not.toMatch(/abcdefghijklmnop|hunter2|abc\/def|zzz|s3cr3t/);
    expect(out).toContain("http://alice:‹已隐藏›@proxy.local:8080");
    expect(out).toContain("plain line with ‹已隐藏›");
  });
});
