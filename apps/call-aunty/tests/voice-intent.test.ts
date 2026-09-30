import { describe, expect, it } from "vitest";

import { classifyVoiceAnswer } from "../lib/voice-intent";

describe("classifyVoiceAnswer", () => {
  it("detects english yes/no", () => {
    expect(classifyVoiceAnswer("Yes")).toBe("yes");
    expect(classifyVoiceAnswer("nope")).toBe("no");
  });

  it("detects bangla yes/no", () => {
    expect(classifyVoiceAnswer("হ্যাঁ")).toBe("yes");
    expect(classifyVoiceAnswer("না")).toBe("no");
  });

  it("detects hindi and urdu yes/no", () => {
    expect(classifyVoiceAnswer("हाँ")).toBe("yes");
    expect(classifyVoiceAnswer("नहीं")).toBe("no");
    expect(classifyVoiceAnswer("ہاں")).toBe("yes");
    expect(classifyVoiceAnswer("نہیں")).toBe("no");
  });

  it("returns unclear for empty or mixed replies", () => {
    expect(classifyVoiceAnswer("")).toBe("unclear");
    expect(classifyVoiceAnswer("maybe later")).toBe("unclear");
    expect(classifyVoiceAnswer("yes no")).toBe("unclear");
  });
});
