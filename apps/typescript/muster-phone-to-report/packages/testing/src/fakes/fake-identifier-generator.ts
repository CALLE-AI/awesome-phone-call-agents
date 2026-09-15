import type { IdentifierGenerator } from "@muster/application";

export class FakeIdentifierGenerator implements IdentifierGenerator {
  private readonly identifiers: string[];

  public constructor(identifiers: readonly string[]) {
    this.identifiers = [...identifiers];
  }

  public generate(): string {
    const identifier = this.identifiers.shift();
    if (identifier === undefined) {
      throw new Error("No deterministic identifiers remain");
    }
    return identifier;
  }
}
